<h1 align="center">
  <img src="assets/logo.png" width="140" alt="Leonarr" /><br/>
  Leonarr
</h1>

<p align="center">🇫🇷 Version française (par défaut) : <a href="README.md">README.md</a></p>

Discord bot plugin for [Oscarr](https://github.com/arediss/Oscarr). Lets your users log in with Plex, search TMDB, request movies/TV shows, and check the status of their requests — all from Discord.

Leonarr is **not a standalone bot**: it ships as an Oscarr plugin and reuses Oscarr's own TMDB, Plex auth, and request pipeline (folder rules, quality mappings, blacklist, plugin guards — everything your web UI already enforces).

## Features

- `/login` — Link a Discord user to their Oscarr account via Plex OAuth (PIN flow).
- `/logout` — Unlink.
- `/search <title>` — Search TMDB, browse results with prev/next buttons, one-click request.
- `/status` — Show the user's 10 most recent requests and their statuses.
- `/help` — List commands.

French and English messages (set the default with the `language` plugin setting).

## Requirements

- An Oscarr instance (source or Docker) running **v0.4.2** or later — the plugin engine is required.
- A Discord application + bot token ([discord.com/developers/applications](https://discord.com/developers/applications)).
- Node.js 20+ (same as Oscarr's backend).

## Install

Leonarr lives as its own repository, but at runtime it must be placed inside Oscarr's `packages/plugins/` directory so the plugin engine can discover it.

### 1. Clone Leonarr somewhere convenient

```bash
git clone https://github.com/<you>/Leonarr.git /opt/leonarr
cd /opt/leonarr
npm install
```

### 2. Expose it to Oscarr

The simplest option is a symlink:

```bash
ln -s /opt/leonarr /path/to/Oscarr/packages/plugins/leonarr
```

Leonarr is designed to plug into an **existing Oscarr instance** managed separately. The `docker-compose.yml` at the repo root describes **only** Leonarr — keep your Oscarr stack in its own compose file.

Two ways to wire Leonarr into Oscarr, depending on how your Oscarr mounts its `packages/plugins` directory:

**Option A — shared Docker volume.** If your Oscarr mounts a named volume (e.g. `oscarr-plugins:/app/packages/plugins`), Leonarr can write into it via an init container. The shipped compose file works as-is — it declares `oscarr-plugins` as `external: true` so Docker reuses the volume your Oscarr stack already created.

```bash
cd Leonarr
docker compose up --build      # native ARM build + sync into oscarr-plugins
docker restart oscarr          # Oscarr re-discovers the plugin
```

**Option B — host bind mount.** If your Oscarr mounts a host path directly (e.g. `/Users/you/Docker/oscarr/packages/plugins:/app/packages/plugins`), the simplest approach isn't Docker at all — a straight `rsync` to the host path is enough.

```bash
rsync -avz --delete-after \
  --exclude='.git' --exclude='.github' --exclude='.idea' --exclude='.claude' \
  --exclude='CLAUDE.md' --exclude='node_modules' --exclude='logs' \
  --exclude='*.log' --exclude='.DS_Store' \
  ./ user@host:/Users/you/Docker/oscarr/packages/plugins/leonarr/

# Install the deps on the target via an ephemeral Node container
ssh user@host '
  cd /Users/you/Docker/oscarr/packages/plugins/leonarr && \
  docker run --rm -v "$PWD:/app" -w /app node:20-alpine \
    npm ci --omit=dev --no-audit --no-fund
'

ssh user@host 'docker restart oscarr'
```

If you'd rather still use compose in Option B, edit `docker-compose.yml` to replace `oscarr-plugins:/plugins-out` with the absolute host path (and drop the external `volumes:` section) — see the inline comments in the file.

### 3. Restart Oscarr

On boot, the plugin engine discovers `leonarr`, loads `manifest.json`, runs `register()`, and logs `[PluginEngine] Loaded "leonarr" v0.1.0`. The Discord client stays down until you configure credentials.

### 4. Configure in the admin panel

Open Oscarr → **Admin → Plugins → Leonarr → Settings**. Fill in:

| Setting | Required | Notes |
|---|---|---|
| `botToken` | yes | Discord bot token from the developer portal |
| `clientId` | yes | Application ID (same portal) |
| `guildId` | no | If set, commands are registered to a single guild (instant propagation). Leave empty to register globally (up to 1 h propagation). |
| `language` | no | `fr` (default) or `en` |
| `requireLogin` | no | Default `true` — `/search` and requests require `/login` first. Set to `false` to open `/search` to everyone. |
| `logDir` | no | Rotated log directory. Absolute or relative to the plugin root. Empty = `<plugin>/logs`. |
| `logLevel` | no | `error`, `warn`, `info` (default) or `debug`. |

Then hit **POST /api/plugins/leonarr/restart** (or toggle the plugin off/on in the admin UI) to pick up the new settings. The client logs in and registers its slash commands.

### 5. Invite the bot to your server

From the Discord developer portal, OAuth2 → URL Generator. Scopes: `bot` + `applications.commands`. Permissions: at minimum `Send Messages` and `Embed Links` (also enable `Message Content` if you plan to add prefix commands later).

## Discord bot intents

Leonarr only needs `Guilds` and `Direct Messages` intents. `Message Content` is **not** required — everything goes through slash commands and buttons.

## How `/login` works

1. User runs `/login` (anywhere, including DM).
2. Leonarr creates a Plex PIN via Oscarr's own `services/plex.js`.
3. A DM is sent with a "Sign in with Plex" link button (falls back to an ephemeral reply if DMs are blocked).
4. Leonarr polls the PIN for up to 5 minutes.
5. When the user completes Plex auth, Leonarr fetches the Plex account and upserts the Oscarr `userProvider` row (same semantics as the web login).
6. The Discord ID ↔ Oscarr user ID mapping is stored in the plugin settings blob (`userLinks` key).

If the user already exists in Oscarr (e.g. auto-imported from a Plex server share), the link is added to the existing account — no duplicate users.

## How requests go through

`/search` → pick a result → click **Request**. Under the hood Leonarr calls the same pipeline Oscarr's HTTP API uses:

- `validateRequestBody`
- `runPluginGuard` (other plugins can still veto, e.g. a subscription plugin)
- `isBlacklisted`
- `findOrCreateMedia` (TMDB fetch + DB upsert)
- duplicate check on active requests
- `auto-approve` honoured from `AppSettings`
- `sendToService` (Radarr / Sonarr with folder rules + quality mapping)

The bot never bypasses validation or permissions.

## Logs

Leonarr writes its own rotated log files via **winston** + **winston-daily-rotate-file**, on top of forwarding every call to Oscarr's own logger (so log events remain visible in Oscarr's admin UI).

Two transports:

| File | Contents | Retention | Max size per file |
|---|---|---|---|
| `leonarr-YYYY-MM-DD.log` | Everything (level ≥ `logLevel`) | 14 days | 20 MB (rotates early if exceeded) |
| `leonarr-error-YYYY-MM-DD.log` | Errors only | 30 days | 20 MB |

Archives are gzipped (`.log.gz`). Format: **structured JSON** with `timestamp`, `level`, `message`, `service: "leonarr"`, and full `stack` for errors — perfect for Loki, Grafana, or `jq`.

If winston fails to initialize its transports (permissions, disk full, missing dep), the plugin keeps running: logs flow only to Oscarr's internal logger, and a single warning is emitted at startup.

## Architecture

```
leonarr/
├── manifest.json          # Plugin metadata (settings schema, hooks)
├── index.js               # register(ctx) — entry called by Oscarr's plugin engine
├── package.json           # discord.js dependency
└── src/
    ├── backend.js         # Resolves packages/backend/{src,dist} at runtime
    ├── bot.js             # Discord client lifecycle + event routing
    ├── commands.js        # Slash command definitions + REST registration
    ├── store.js           # Discord ↔ Oscarr user map (plugin settings blob)
    ├── i18n.js            # fr / en strings
    ├── handlers/
    │   ├── login.js       # /login and /logout
    │   ├── search.js      # /search + paging/request buttons
    │   ├── status.js      # /status
    │   └── help.js        # /help
    └── lib/
        ├── plex.js        # PIN flow wrapper
        ├── oscarr.js      # Wrappers around prisma / tmdb / requestService
        └── embeds.js      # Media card + status embeds
```

`src/backend.js` resolves the backend at startup by checking for `packages/backend/src` (dev, tsx) or `packages/backend/dist` (production) — so the same code works against a compiled Docker image and a local dev instance.

## Known limitations (v0.1)

- **TV season selection**: for now `/request` on a TV show requests **all seasons**. Season picker is on the roadmap.
- **No per-plugin disable hook**: Oscarr's plugin engine doesn't fire an `onDisable` callback yet, so disabling the plugin from the admin UI won't stop the Discord client until the next process restart. Use `POST /api/plugins/leonarr/restart` to reset after config changes.
- **Single language per instance**: the `language` setting is global. Per-user locale is not wired yet.
- **Command propagation**: global command registration can take up to an hour to propagate. Use `guildId` during development for instant updates.

## Troubleshooting

**`[Leonarr] Bot token or client ID missing — skipping Discord startup`**
Fill in the plugin settings and hit `POST /api/plugins/leonarr/restart`.

**`Failed to register commands: DiscordAPIError[50001]: Missing Access`**
The bot is not in the guild referenced by `guildId`, or it lacks the `applications.commands` scope. Re-invite it with that scope.

**`Cannot locate Oscarr backend`**
`src/backend.js` couldn't find `packages/backend/src` or `packages/backend/dist`. Check that the plugin directory is actually placed/symlinked inside `packages/plugins/` of the Oscarr monorepo, and that the backend has been built or is running via `tsx`.

**`/login` DM never arrives**
The user has DMs disabled for the server. Leonarr falls back to an ephemeral reply with the same button — tell the user to look at the command's reply instead.

## License

MIT.
