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
 *  Routes: the admin tab surfaces two — `/status` for a health dashboard and `/restart`
 *  for an in-app "reconnect Discord" button. Restart is admin-gated via
 *  registerRoutePermission.
 */
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
      // Admin-only restart (reconnects Discord gateway + re-registers slash commands
      // against current settings). Registered as a plugin permission so the admin can
      // grant it to non-admin roles later if they want a "bot operator" role.
      ctx.registerPluginPermission('leonarr.restart', 'Restart the Leonarr Discord bot');
      ctx.registerRoutePermission('POST:/api/plugins/leonarr/restart', {
        permission: 'leonarr.restart',
      });

      app.get('/status', async () => ({
        running: bot.isRunning(),
        version: manifest.version,
      }));

      app.post('/restart', async (_req, reply) => {
        ctx.log.info('Leonarr /restart invoked');
        await bot.stop(ctx);
        await bot.start(ctx);
        return reply.send({ ok: true, running: bot.isRunning() });
      });
    },
  };
}
