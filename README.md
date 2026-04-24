# Leonarr

Discord bridge for [Oscarr](https://github.com/arediss/Oscarr). Users link their Discord
account once, then search and submit media requests from Discord slash commands. Oscarr's
existing notifications (request approved, media available) reach Discord as DMs.

This plugin targets **Oscarr `>=0.7.0`** (plugin context v1 with the v1.1 additions:
`tmdb`, `requests`, `media`, event bus emissions).

## What it does

| Command | Capability used | What it calls |
|---|---|---|
| `/link` | `users:read`, `settings:plugin` | Sends an ephemeral deep link to Oscarr's Discord OAuth flow. Users grant once, Oscarr stores the Discord ↔ Oscarr mapping in `UserProvider`. |
| `/search <query>` | `tmdb:read`, `users:read`, `requests:write` | TMDB autocomplete via `ctx.tmdb.search`, submit via `ctx.requests.create` (same pipeline as `POST /api/requests`). |
| `/status` | `users:read`, `requests:read`, service ACL | User's latest 10 requests via `ctx.requests.listForUser`, live download progress via `ctx.getArrClients`. |
| `/help` | — | Local help embed. |
| DM on notification | `events`, `users:read` | Subscribes to `user.notification.created` (fired by Oscarr's `safeUserNotify`). No polling. |
| Optional channel post | `events`, `settings:plugin` | When `announceChannelId` is set, subscribes to `media.available` and posts "X is available!" to that channel. |

No backdoor imports. No self-HTTP calls. No cron. No shared user mapping table (Oscarr owns
the `UserProvider` rows).

## Settings

| Key | Type | Required | Purpose |
|---|---|---|---|
| `botToken` | password | yes | Discord bot token (applications → bot → token). |
| `clientId` | string | yes | Discord application id. |
| `guildId` | string | no | Guild id to scope slash commands. Empty = global registration (propagates within an hour). |
| `oauthStateSecret` | password | yes for `/link` | Random ≥16-char string used to HMAC-sign the OAuth `state` param. |
| `announceChannelId` | string | no | Channel id to post `media.available` announcements into. Empty = DMs only. |

Configured via the admin **Plugins → Leonarr** tab after install.

## Setup

1. **Enable Discord OAuth on Oscarr.** Admin → Authentication → Discord provider. Grab the
   client id/secret there and reuse them for the bot.
2. **Create the Discord bot.** <https://discord.com/developers/applications> → New
   Application → Bot → copy the token. Enable the `applications.commands` scope.
3. **Install Leonarr.** Admin → Plugins → Install from URL (point at this repo's release
   tarball) or drop the cloned repo into `~/Oscarr/plugins/plugin-leonarr/` and restart.
4. **Fill the settings** above.
5. **Invite the bot** to your server with the `applications.commands` scope.
6. Users run `/link`, then `/search`.

## Development

```bash
npm install
npm run dev         # esbuild --watch → dist/index.js
npm run typecheck   # tsc --noEmit
```

Bundle stays at ~18 KB minified. Discord.js + native deps are kept external and resolved
from `node_modules/` at runtime.

Types from `@oscarr/shared/pluginContext` are mirrored in `src/types.ts` so this repo
stays standalone (no monorepo link required). When Oscarr's `PluginContext` evolves, keep
`src/types.ts` in sync — typecheck will fail loudly if ctx signatures drift.

## License

MIT.
