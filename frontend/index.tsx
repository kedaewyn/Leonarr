import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiPost, apiPut } from '@oscarr/sdk';
import { MessageSquare, Play, Square, RefreshCw, AlertTriangle, CheckCircle2, Loader2, Eye, EyeOff, Save } from 'lucide-react';

/** Leonarr admin tab.
 *
 *  Layout follows the other Oscarr admin tabs (see packages/frontend/src/pages/admin/*):
 *    - Header: tab title + description + running-state pill
 *    - Action bar: Start / Stop / Restart (disabled when missing required config)
 *    - Settings card: one row per manifest.setting, save button at the bottom
 *
 *  Status polls every 10s when the tab is visible (paused when document.hidden) so the
 *  pill + button disable state reflect reality without a full refresh.
 */

// Keep the setting schema in sync with manifest.settings — order drives display order.
const SETTING_FIELDS: Array<{
  key: string;
  label: string;
  type: 'text' | 'password';
  hint?: string;
  required?: boolean;
}> = [
  { key: 'botToken',          label: 'Discord bot token',       type: 'password', required: true, hint: 'Applications → Bot → Token on the Discord developer portal.' },
  { key: 'clientId',          label: 'Discord application id',  type: 'text',     required: true, hint: 'Applications → General information → Application ID.' },
  { key: 'guildId',           label: 'Guild id (optional)',     type: 'text',                     hint: 'Restrict slash commands to this guild for faster propagation. Leave empty to register globally.' },
  { key: 'oauthStateSecret',  label: 'OAuth state HMAC secret', type: 'password',                 hint: 'Random ≥16-char string. Signs the /link deep-link so a third party cannot forge it. Generate with: openssl rand -base64 32' },
  { key: 'announceChannelId', label: 'Announce channel id',     type: 'text',                     hint: 'Channel id the bot posts "media available" broadcasts to. Empty = DMs only.' },
];

interface StatusPayload {
  running: boolean;
  configured: boolean;
  missing: string[];
  version: string;
}

type Settings = Record<string, string>;

export default function LeonarrAdmin() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [originalSettings, setOriginalSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [reveal, setReveal] = useState<Set<string>>(new Set());

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api('/api/plugins/leonarr/status') as StatusPayload;
      setStatus(s);
    } catch (err) {
      // Non-fatal — keep stale status, don't spam the error banner with network blips.
      console.warn('[leonarr] status poll failed', err);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const s = await api('/api/plugins/leonarr/settings') as Settings;
      // Normalise undefined/null to empty string so inputs stay controlled.
      const normalised: Settings = {};
      for (const f of SETTING_FIELDS) normalised[f.key] = typeof s[f.key] === 'string' ? s[f.key] : '';
      setSettings(normalised);
      setOriginalSettings(normalised);
    } catch (err) {
      setError((err as Error).message || 'Failed to load settings');
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([refreshSettings(), refreshStatus()]);
      setLoading(false);
    })();
  }, [refreshSettings, refreshStatus]);

  // Live status poll — 10s cadence, pauses when the tab is backgrounded so we don't burn
  // requests when nobody's watching.
  useEffect(() => {
    const tick = () => { if (!document.hidden) refreshStatus(); };
    const id = window.setInterval(tick, 10_000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  const dirty = useMemo(
    () => SETTING_FIELDS.some((f) => settings[f.key] !== originalSettings[f.key]),
    [settings, originalSettings],
  );

  const flashNotice = useRef<number | null>(null);
  const showNotice = (msg: string) => {
    setNotice(msg);
    if (flashNotice.current) window.clearTimeout(flashNotice.current);
    flashNotice.current = window.setTimeout(() => setNotice(null), 3000);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPut('/api/plugins/leonarr/settings', settings);
      setOriginalSettings(settings);
      showNotice('Settings saved');
      // Re-probe status immediately — the admin may have just filled a required field, so
      // the `configured` flag (and Start button's enabled state) should flip live.
      await refreshStatus();
    } catch (err) {
      setError((err as Error).message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (action: 'start' | 'stop' | 'restart') => {
    setBusyAction(action);
    setError(null);
    try {
      await apiPost(`/api/plugins/leonarr/${action}`, {});
      showNotice(`Bot ${action === 'restart' ? 'restarted' : action === 'start' ? 'started' : 'stopped'}`);
      await refreshStatus();
    } catch (err) {
      setError((err as Error).message || `${action} failed`);
    } finally {
      setBusyAction(null);
    }
  };

  const toggleReveal = (key: string) => {
    setReveal((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-ndp-text-dim text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading Leonarr settings…
      </div>
    );
  }

  const pill = getStatusPill(status);
  const canStart = !!status?.configured && !status?.running && busyAction === null;
  const canStop = !!status?.running && busyAction === null;
  const canRestart = !!status?.running && busyAction === null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-ndp-surface">
            <MessageSquare className="w-5 h-5 text-ndp-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ndp-text">Leonarr</h1>
            <p className="text-xs text-ndp-text-dim">
              Discord bridge. Users run /link, then /search and /status from Discord.{' '}
              {status && <span>v{status.version}</span>}
            </p>
          </div>
        </div>
        <span className={`text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 ${pill.className}`}>
          <pill.Icon className="w-3.5 h-3.5" />
          {pill.label}
        </span>
      </div>

      {/* Missing-config warning */}
      {status && !status.configured && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-ndp-warning/30 bg-ndp-warning/5 text-xs text-ndp-text">
          <AlertTriangle className="w-4 h-4 text-ndp-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Bot can't start yet.</p>
            <p className="text-ndp-text-dim mt-0.5">Missing required setting{status.missing.length > 1 ? 's' : ''}: <code className="text-ndp-text bg-black/30 px-1 rounded">{status.missing.join(', ')}</code></p>
          </div>
        </div>
      )}

      {/* Control buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => runAction('start')}
          disabled={!canStart}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busyAction === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Start
        </button>
        <button
          onClick={() => runAction('stop')}
          disabled={!canStop}
          className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busyAction === 'stop' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
          Stop
        </button>
        <button
          onClick={() => runAction('restart')}
          disabled={!canRestart}
          className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busyAction === 'restart' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Restart
        </button>
      </div>

      {/* Settings card */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ndp-text mb-1">Settings</h2>
        <p className="text-xs text-ndp-text-dim mb-5">Changes apply after the next Start / Restart.</p>

        <div className="space-y-4">
          {SETTING_FIELDS.map((f) => {
            const isRevealed = reveal.has(f.key);
            const inputType = f.type === 'password' && !isRevealed ? 'password' : 'text';
            return (
              <div key={f.key}>
                <label htmlFor={`leonarr-${f.key}`} className="text-xs font-medium text-ndp-text mb-1 block">
                  {f.label}
                  {f.required && <span className="text-ndp-danger ml-1">*</span>}
                </label>
                <div className="relative">
                  <input
                    id={`leonarr-${f.key}`}
                    type={inputType}
                    value={settings[f.key] ?? ''}
                    onChange={(e) => setSettings((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className={`input w-full ${f.type === 'password' ? 'pr-10' : ''}`}
                    autoComplete="off"
                  />
                  {f.type === 'password' && (
                    <button
                      type="button"
                      onClick={() => toggleReveal(f.key)}
                      aria-label={isRevealed ? 'Hide' : 'Show'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ndp-text-dim hover:text-ndp-text"
                    >
                      {isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                </div>
                {f.hint && <p className="text-[11px] text-ndp-text-dim mt-1">{f.hint}</p>}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          {notice && <span className="text-xs text-ndp-success">{notice}</span>}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-3 rounded-lg border border-ndp-danger/30 bg-ndp-danger/5 text-xs text-ndp-danger">
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

interface Pill {
  label: string;
  className: string;
  Icon: typeof MessageSquare;
}

function getStatusPill(status: StatusPayload | null): Pill {
  if (!status) {
    return { label: 'Unknown', className: 'bg-white/5 text-ndp-text-dim', Icon: Loader2 };
  }
  if (status.running) {
    return { label: 'Running', className: 'bg-ndp-success/10 text-ndp-success', Icon: CheckCircle2 };
  }
  if (!status.configured) {
    return { label: 'Needs config', className: 'bg-ndp-warning/10 text-ndp-warning', Icon: AlertTriangle };
  }
  return { label: 'Stopped', className: 'bg-ndp-danger/10 text-ndp-danger', Icon: Square };
}
