<h1 align="center">
  <img src="assets/logo.png" width="140" alt="Leonarr" /><br/>
  Leonarr
</h1>

<p align="center">🇫🇷 Version française (par défaut) : <a href="README.md">README.md</a></p>

Discord bot plugin for [Oscarr](https://github.com/arediss/Oscarr). Your users sign in with Plex, search TMDB, request movies and TV shows and track their requests from Discord.

Leonarr **isn't a standalone bot**. It ships as an Oscarr plugin and reuses Oscarr's own services directly (TMDB, Plex auth, the full request pipeline with folder rules, quality mappings, blacklist, plugin guards). Whatever your web UI already does, the bot does too, without replaying the logic.

## Features

- `/login` — Link a Discord account to Oscarr via Plex (PIN flow).
- `/logout` — Unlink the account.
- `/search <type> <title>` — Search TMDB filtered by category (Movies / TV / Anime / an Oscarr routing rule), browse results, request in one click.
- `/status` — List your recent requests with filters (downloading, waiting, done) and live progress bars for active downloads.
- `/settings language <fr|en|default>` — Per-user language preference.
- `/help` — List commands.

Messages in French and English. The bot defaults to the user's Discord client locale, with a per-user override via `/settings`.

## Requirements

- An Oscarr instance (source or Docker) running **v0.4.2** or later. The plugin engine is required.
- A Discord application with a bot token from [discord.com/developers/applications](https://discord.com/developers/applications).
- Node.js 20+ (same as Oscarr's backend).

## Install

At runtime, Leonarr has to sit inside Oscarr's `packages/plugins/` directory so the plugin engine picks it up.

### 1. Clone Leonarr

```bash
git clone https://github.com/kedaewyn/Leonarr.git /opt/leonarr
cd /opt/leonarr
npm install
```

### 2. Wire it into Oscarr

The easiest path in dev is a symlink:

```bash
ln -s /opt/leonarr /path/to/Oscarr/packages/plugins/leonarr
```

For Docker setups, Leonarr plugs into an **existing Oscarr instance** managed separately. The `docker-compose.yml` at the repo root describes **only** Leonarr. Keep your Oscarr stack in its own compose file, untouched.

Two wiring options depending on how your Oscarr mounts `packages/plugins`:

**Option A — shared Docker volume.** Your Oscarr mounts a named volume (e.g. `oscarr-plugins:/app/packages/plugins`). Leonarr writes into it via an init container. The shipped compose file works as-is: it declares `oscarr-plugins` as `external: true` and Docker reuses the existing volume.

```bash
cd Leonarr
docker compose up --build      # native ARM build + sync into oscarr-plugins
docker restart oscarr          # Oscarr rediscovers the plugin
```

**Option B — host bind mount.** Your Oscarr mounts a host path directly (e.g. `/Users/you/Docker/oscarr/packages/plugins:/app/packages/plugins`). No Docker needed on the Leonarr side, a straight `rsync` to the host path is enough.

```bash
rsync -avz --delete-after \
  --exclude='.git' --exclude='.github' --exclude='.idea' --exclude='.claude' \
  --exclude='CLAUDE.md' --exclude='node_modules' --exclude='logs' \
  --exclude='*.log' --exclude='.DS_Store' \
  ./ user@host:/Users/you/Docker/oscarr/packages/plugins/leonarr/

# Install deps on the target via an ephemeral Node container
ssh user@host '
  cd /Users/you/Docker/oscarr/packages/plugins/leonarr && \
  docker run --rm -v "$PWD:/app" -w /app node:20-alpine \
    npm ci --omit=dev --no-audit --no-fund
'

ssh user@host 'docker restart oscarr'
```

If you still want to use compose under Option B, edit `docker-compose.yml` to replace `oscarr-plugins:/plugins-out` with the absolute host path and drop the external `volumes:` section. The inline comments in the file show the exact syntax.

### 3. Restart Oscarr

On boot, the plugin engine discovers `leonarr`, loads `manifest.json`, calls `register()` and logs `[PluginEngine] Loaded "leonarr" v0.1.0`. The Discord client stays down until credentials are set in the admin.

### 4. Configure in the admin panel

Open Oscarr → **Admin → Plugins → Leonarr → Settings**. Fill in:

| Setting | Required | Notes |
|---|---|---|
| `botToken` | yes | Discord bot token from the developer portal |
| `clientId` | yes | Application ID (same portal) |
| `guildId` | no | Registers commands on a single guild with instant propagation. Empty = global, up to 1h propagation. |
| `language` | no | `fr` (default) or `en`. Per-user override via `/settings`. |
| `requireLogin` | no | Default `true`. `/search` and requests require `/login` first. |
| `logDir` | no | Rotated log directory. Absolute or relative to the plugin root. Empty = `<plugin>/logs`. |
| `logLevel` | no | `error`, `warn`, `info` (default) or `debug`. |

Then hit **POST /api/plugins/leonarr/restart** (or toggle the plugin in the admin UI) to pick up the new settings. The client logs in and registers its slash commands.

### 5. Invite the bot to your server

From the Discord developer portal, OAuth2 → URL Generator. Scopes: `bot` + `applications.commands`. Minimum permissions: `Send Messages` and `Embed Links`.

## Discord bot intents

Leonarr only needs `Guilds` and `Direct Messages`. The `Message Content` intent is not required, everything goes through slash commands and buttons.

## How `/login` works

1. User runs `/login` (guild channel or DM).
2. Leonarr creates a Plex PIN via Oscarr's own `services/plex.js`.
3. The ephemeral reply contains an embed with a "Sign in with Plex" button.
4. Leonarr polls the PIN for up to 5 minutes.
5. When the user completes Plex auth, Leonarr fetches the Plex account and upserts the Oscarr `userProvider` row with the same semantics as the web login.
6. The Discord ID ↔ Oscarr user ID mapping is stored in the plugin settings under `userLinks`.

If the user already exists in Oscarr (for example auto-imported from a Plex server share), the link is added to the existing account. No duplicate users.

## How requests go through

`/search` → pick a result → click **Request**. Under the hood, Leonarr calls the exact same pipeline as Oscarr's HTTP API:

- `validateRequestBody`
- `runPluginGuard` (other plugins can still veto, e.g. a subscription plugin)
- `isBlacklisted`
- `findOrCreateMedia` (TMDB fetch + DB upsert)
- duplicate check on the same user's active requests
- `auto-approve` honoured from `AppSettings`
- `sendToService` (Radarr or Sonarr with folder rules + quality mapping)

The bot never bypasses validation or permissions. For TV shows, a season picker pops up between the "Request" click and the actual Sonarr send: multi-select with the available seasons plus an "All seasons" shortcut.

## Notifications

When media a Discord user requested becomes available in Plex (Oscarr flips the request to `available`), Leonarr sends them a DM with the poster and title. A cron job every 2 minutes polls Oscarr's `UserNotification` table and dedupes by ID so users never get spammed.

If the user has DMs disabled for the bot, Leonarr falls back to an `@mention` message in the last channel where they ran a slash command.

## Logs

Leonarr writes its own rotated log files via **winston** + **winston-daily-rotate-file**, on top of forwarding every log call to Oscarr's internal logger (still visible in the admin UI).

Two transports:

| File | Contents | Retention | Max size per file |
|---|---|---|---|
| `leonarr-YYYY-MM-DD.log` | Everything (level ≥ `logLevel`) | 14 days | 20 MB, rotates early if exceeded |
| `leonarr-error-YYYY-MM-DD.log` | Errors only | 30 days | 20 MB |

Archives are gzipped (`.log.gz`). Format is structured JSON with `timestamp`, `level`, `message`, `service: "leonarr"` and full `stack` on errors. Direct ingest into Loki, Grafana or `jq`.

If winston fails to initialize its transports (permissions, disk full, missing dep), the plugin keeps running. Logs go only to Oscarr's internal logger and a single warning is emitted at startup.

## Architecture

```
leonarr/
├── manifest.json          # Plugin metadata (settings schema, hooks, cron jobs)
├── index.js               # register(ctx) — entry called by the plugin engine
├── package.json           # discord.js, winston, winston-daily-rotate-file
└── src/
    ├── backend.js         # Resolves packages/backend/{src,dist} at runtime
    ├── bot.js             # Discord client lifecycle + event routing
    ├── commands.js        # Slash commands + REST registration + localization
    ├── store.js           # Plugin settings (user links, locales, channels) with lock
    ├── logger.js          # winston + tee into Oscarr's ctx.log
    ├── notifications.js   # Cron job: DM when requested media becomes available
    ├── i18n.js            # fr/en catalog + t() helper
    ├── handlers/
    │   ├── login.js       # /login and /logout
    │   ├── search.js      # /search + paging + season picker
    │   ├── status.js      # /status with filters + refresh
    │   ├── settings.js    # /settings language
    │   └── help.js        # /help
    └── lib/
        ├── plex.js        # PIN flow wrapper
        ├── oscarr.js      # Wrappers around prisma / tmdb / requestService / queue
        └── embeds.js      # Media card, status list, season picker, badges
```

`src/backend.js` resolves the Oscarr backend at startup by checking for `packages/backend/src` (dev, tsx) or `packages/backend/dist` (production). The same code runs against a compiled Docker image and a local dev instance.

## Known limitations

- **No `onDisable` hook**: Oscarr's plugin engine doesn't fire an `onDisable` callback yet. Disabling the plugin from the admin UI won't stop the Discord client until the next process restart. Use `POST /api/plugins/leonarr/restart` after a config change.
- **Global command propagation**: can take up to an hour. Use `guildId` during development for instant updates.
- **Sonarr + new seasons on existing series**: asking for season 4-5 when Sonarr already has the series only triggers a `search missing`, not a season add. That's an Oscarr behaviour (`services/requestService.js`) rather than a Leonarr bug.

## Troubleshooting

**`[Leonarr] Bot token or client ID missing — skipping Discord startup`**
Fill in the plugin settings and hit `POST /api/plugins/leonarr/restart`.

**`Failed to register commands: DiscordAPIError[50001]: Missing Access`**
The bot isn't in the guild referenced by `guildId`, or it doesn't have the `applications.commands` scope. Re-invite it with that scope.

**`Cannot locate Oscarr backend`**
`src/backend.js` couldn't find `packages/backend/src` or `packages/backend/dist`. Check the plugin directory is placed or symlinked inside `packages/plugins/` of the Oscarr monorepo, and that the backend is either compiled or running via `tsx`.

**`/login` DM never arrives**
As of v0.1, the `/login` flow replies directly inside the command's ephemeral response rather than DMing. If you still see the old DM behaviour, you have an older version of the plugin deployed.

## License

MIT.
