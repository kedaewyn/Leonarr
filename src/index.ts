import type { FastifyInstance } from 'fastify';
import manifest from '../manifest.json' with { type: 'json' };
import { createBot } from './bot.js';
import type { Ctx, PluginRegistration } from './types.js';

/** Plugin entrypoint — Oscarr calls `register(ctx)` once at plugin load.
 *
 *  The Discord client lives inside the returned registration object's onEnable/onDisable
 *  lifecycle, not at module load: a plugin can be disabled or re-enabled at runtime from
 *  the admin UI, and we want the bot to reflect that state (login when enabled, destroy
 *  when disabled). Nothing Discord-related happens until onEnable fires.
 *
 *  Routes:
 *    GET  /status  → { running, configured, missing, version } for the admin tab
 *    POST /start   → start the bot if not running (no-op if running)
 *    POST /stop    → stop the bot if running
 *    POST /restart → stop + start, pick up setting changes
 *
 *  All mutating routes gated by the `leonarr.restart` plugin permission.
 */

/** Settings the bot considers mandatory before it can log in. Checked by /status so the
 *  admin UI can disable Start when any are missing, and echoed in the `missing` array so
 *  the user sees *which* one is blocking. */
const REQUIRED_SETTINGS = ['botToken', 'clientId'] as const;

async function inspectSettings(ctx: Ctx): Promise<{ configured: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const key of REQUIRED_SETTINGS) {
    const v = await ctx.getSetting(key);
    if (typeof v !== 'string' || v.length === 0) missing.push(key);
  }
  return { configured: missing.length === 0, missing };
}

export function register(_ctx: Ctx): PluginRegistration {
  const bot = createBot();

  return {
    manifest,

    async onEnable(ctx: Ctx) {
      ctx.log.info('Leonarr onEnable — starting Discord bot');
      await bot.start(ctx);
    },

    async onDisable(ctx: Ctx) {
      ctx.log.info('Leonarr onDisable — stopping Discord bot');
      await bot.stop(ctx);
    },

    async registerRoutes(app: FastifyInstance, ctx: Ctx) {
      // Admin-only bot control (reconnects Discord gateway + re-registers slash commands
      // against current settings). Registered as a plugin permission so the admin can
      // grant it to non-admin roles later if they want a "bot operator" role.
      ctx.registerPluginPermission('leonarr.restart', 'Start / stop / restart the Leonarr Discord bot');
      ctx.registerRoutePermission('POST:/api/plugins/leonarr/start',   { permission: 'leonarr.restart' });
      ctx.registerRoutePermission('POST:/api/plugins/leonarr/stop',    { permission: 'leonarr.restart' });
      ctx.registerRoutePermission('POST:/api/plugins/leonarr/restart', { permission: 'leonarr.restart' });

      app.get('/status', async () => {
        const { configured, missing } = await inspectSettings(ctx);
        return {
          running: bot.isRunning(),
          configured,
          missing,
          version: manifest.version,
        };
      });

      app.post('/start', async (_req, reply) => {
        ctx.log.info('Leonarr /start invoked');
        await bot.start(ctx);
        return reply.send({ ok: true, running: bot.isRunning() });
      });

      app.post('/stop', async (_req, reply) => {
        ctx.log.info('Leonarr /stop invoked');
        await bot.stop(ctx);
        return reply.send({ ok: true, running: bot.isRunning() });
      });

      app.post('/restart', async (_req, reply) => {
        ctx.log.info('Leonarr /restart invoked');
        await bot.stop(ctx);
        await bot.start(ctx);
        return reply.send({ ok: true, running: bot.isRunning() });
      });
    },
  };
}
