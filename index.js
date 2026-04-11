import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as bot from './src/bot.js';
import { pollAvailableNotifications } from './src/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await readFile(path.join(__dirname, 'manifest.json'), 'utf-8')
);

export async function register(ctx) {
  bot.start(ctx).catch((err) => {
    ctx.log.error(`[Leonarr] Failed to start Discord bot: ${err}`);
  });

  return {
    manifest,

    registerJobs(ctx) {
      return {
        // Polls Oscarr's UserNotification table every 2 minutes (cron in
        // manifest.json) and DMs any Discord-linked user whose requested
        // media just became available in Plex.
        leonarr_notify_poll: async () => {
          const result = await pollAvailableNotifications(ctx);
          if (result.delivered > 0 || result.skipped > 0) {
            ctx.log.info(
              `[Leonarr] notify_poll: processed=${result.processed} delivered=${result.delivered} skipped=${result.skipped}${result.pending ? ` pending=${result.pending}` : ''}`
            );
          }
          return result;
        },
      };
    },

    async registerRoutes(app, ctx) {
      app.get('/status', async () => ({
        running: bot.isRunning(),
        version: manifest.version,
      }));
      app.post('/restart', async (_req, reply) => {
        ctx.log.info('[Leonarr] Restart requested via API');
        try {
          await bot.stop();
          await bot.start(ctx);
          return reply.send({ ok: true, running: bot.isRunning() });
        } catch (err) {
          ctx.log.error(`[Leonarr] Restart failed: ${err}`);
          return reply.status(500).send({ ok: false, error: String(err) });
        }
      });
    },

    async onInstall(ctx) {
      ctx.log.info('[Leonarr] First install — waiting for admin to provide bot credentials');
    },
  };
}
