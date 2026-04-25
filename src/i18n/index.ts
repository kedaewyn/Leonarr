import en from './en.json' with { type: 'json' };
import fr from './fr.json' with { type: 'json' };
import type { Ctx } from '../types.js';

/** Bundles ship both locales in memory — 4 KB each, no need for a loader abstraction.
 *  `lang` resolves to the instance-wide AppSettings.instanceLanguages[0] (see
 *  resolveInstanceLanguage). */

// The English bundle is authoritative for the set of keys — any missing translation in
// another locale falls back to English. Other bundles must be a subset (TS verifies).
type I18nKey = keyof typeof en;
type Bundle = Record<I18nKey, string>;

const BUNDLES: Record<string, Bundle> = {
  en: en as Bundle,
  fr: fr as Bundle,
};
const FALLBACK = 'en';

function interpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (
    vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`
  ));
}

export type TFn = (key: I18nKey, vars?: Record<string, unknown>) => string;

/** Returns a `t(key, vars?)` function scoped to the resolved language — falls back to `en`
 *  per key (not per bundle), so a missing French string still renders the English one
 *  instead of the raw key. */
export function createI18n(lang: string): TFn {
  const normalized = (lang || FALLBACK).split('-')[0].toLowerCase();
  const primary = BUNDLES[normalized] ?? BUNDLES[FALLBACK];
  const fallback = BUNDLES[FALLBACK];
  return (key, vars) => {
    const template = primary[key] ?? fallback[key] ?? key;
    return interpolate(template, vars);
  };
}

/** Resolves the instance language from Oscarr's AppSettings.instanceLanguages JSON array.
 *  Called once per interaction to respect live language changes without a bot restart. */
export async function resolveInstanceLanguage(ctx: Ctx): Promise<string> {
  try {
    const settings = await ctx.getAppSettings();
    const raw = settings?.instanceLanguages;
    const arr = typeof raw === 'string'
      ? (JSON.parse(raw) as unknown)
      : Array.isArray(raw) ? raw : null;
    if (Array.isArray(arr) && typeof arr[0] === 'string') return arr[0];
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}
