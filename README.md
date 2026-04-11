<h1 align="center">
  <img src="assets/logo.png" width="140" alt="Leonarr" /><br/>
  Leonarr
</h1>

<p align="center">🇬🇧 English version: <a href="README.en.md">README.en.md</a></p>

Plugin Discord pour [Oscarr](https://github.com/arediss/Oscarr). Tes utilisateurs se connectent avec Plex, cherchent sur TMDB, demandent des films et séries et suivent leurs demandes depuis Discord.

Leonarr **n'est pas un bot autonome**. Il est packagé comme un plugin Oscarr et réutilise directement les services internes (TMDB, auth Plex, pipeline de requêtes avec folder rules, quality mappings, blacklist, plugin guards). Ce que ton UI web fait déjà s'applique côté Discord sans rejeu de logique.

## Fonctionnalités

- `/login` — Lie un compte Discord à Oscarr via Plex (flow PIN).
- `/logout` — Délie le compte.
- `/search <type> <titre>` — Cherche sur TMDB filtré par catégorie (Films / Séries / Animes / règle Oscarr), navigue entre les résultats, demande en un clic.
- `/status` — Liste tes demandes récentes avec filtres (en cours, en attente, terminé) et barre de progression live des téléchargements en cours.
- `/settings language <fr|en|default>` — Préférence de langue par utilisateur.
- `/help` — Liste les commandes.

Messages en français et en anglais. La langue suit par défaut le client Discord de l'utilisateur, avec override par utilisateur via `/settings`.

## Prérequis

- Une instance Oscarr (source ou Docker) en **v0.4.2** ou plus récente. Le plugin engine est requis.
- Une application Discord avec un bot token. Récupère-les depuis [discord.com/developers/applications](https://discord.com/developers/applications).
- Node.js 20+ (même que le backend Oscarr).

## Installation

Au runtime, Leonarr doit se trouver dans `packages/plugins/` d'Oscarr pour que le plugin engine le découvre.

### 1. Cloner Leonarr

```bash
git clone https://github.com/kedaewyn/Leonarr.git /opt/leonarr
cd /opt/leonarr
npm install
```

### 2. Le brancher sur Oscarr

Le plus simple en dev, c'est un symlink :

```bash
ln -s /opt/leonarr /chemin/vers/Oscarr/packages/plugins/leonarr
```

Pour un setup Docker, Leonarr se branche sur une instance Oscarr **déjà en place** que tu gères séparément. Le `docker-compose.yml` à la racine décrit **uniquement** Leonarr. Ta stack Oscarr reste dans son propre compose, on n'y touche pas.

Deux options de branchement selon comment ton Oscarr monte `packages/plugins` :

**Option A — volume Docker partagé.** Ton Oscarr monte un volume nommé (ex : `oscarr-plugins:/app/packages/plugins`). Leonarr écrit dedans via un init container. Le compose fourni marche tel quel : il déclare `oscarr-plugins` en `external: true` et Docker réutilise le volume existant.

```bash
cd Leonarr
docker compose up --build      # build ARM natif + sync dans oscarr-plugins
docker restart oscarr          # Oscarr redécouvre le plugin
```

**Option B — bind mount hôte.** Ton Oscarr monte un chemin hôte direct (ex : `/Users/toi/Docker/oscarr/packages/plugins:/app/packages/plugins`). Pas besoin de Docker côté Leonarr, un `rsync` direct vers le chemin hôte suffit.

```bash
rsync -avz --delete-after \
  --exclude='.git' --exclude='.github' --exclude='.idea' --exclude='.claude' \
  --exclude='CLAUDE.md' --exclude='node_modules' --exclude='logs' \
  --exclude='*.log' --exclude='.DS_Store' \
  ./ user@host:/Users/toi/Docker/oscarr/packages/plugins/leonarr/

# Installer les deps sur la cible via un container Node éphémère
ssh user@host '
  cd /Users/toi/Docker/oscarr/packages/plugins/leonarr && \
  docker run --rm -v "$PWD:/app" -w /app node:20-alpine \
    npm ci --omit=dev --no-audit --no-fund
'

ssh user@host 'docker restart oscarr'
```

Si tu veux quand même passer par le compose en Option B, édite `docker-compose.yml` pour remplacer `oscarr-plugins:/plugins-out` par le chemin hôte absolu et supprime la section `volumes:` externe. Les commentaires inline du fichier montrent la syntaxe exacte.

### 3. Relancer Oscarr

Au démarrage, le plugin engine découvre `leonarr`, charge `manifest.json`, appelle `register()` et log `[PluginEngine] Loaded "leonarr" v0.1.0`. Le client Discord reste inactif tant que les identifiants ne sont pas configurés dans l'admin.

### 4. Configurer dans l'admin

Ouvre Oscarr → **Admin → Plugins → Leonarr → Settings**. Remplis :

| Paramètre | Requis | Notes |
|---|---|---|
| `botToken` | oui | Bot token Discord du developer portal |
| `clientId` | oui | Application ID (même portail) |
| `guildId` | non | Enregistre les commandes sur un seul serveur avec propagation instantanée. Vide = global, jusqu'à 1h de propagation. |
| `language` | non | `fr` (défaut) ou `en`. Overridable par user via `/settings`. |
| `requireLogin` | non | Défaut `true`. `/search` et les demandes exigent `/login` au préalable. |
| `logDir` | non | Dossier des logs rotatés. Absolu ou relatif au dossier plugin. Vide = `<plugin>/logs`. |
| `logLevel` | non | `error`, `warn`, `info` (défaut) ou `debug`. |

Ensuite, appelle **POST /api/plugins/leonarr/restart** (ou toggle le plugin dans l'admin UI) pour prendre en compte les nouveaux settings. Le client Discord se connecte et enregistre ses slash commands.

### 5. Inviter le bot sur ton serveur

Developer portal Discord → OAuth2 → URL Generator. Scopes : `bot` + `applications.commands`. Permissions minimum : `Send Messages` et `Embed Links`.

## Intents Discord

Leonarr utilise uniquement `Guilds` et `Direct Messages`. L'intent `Message Content` n'est pas nécessaire, tout passe par slash commands et boutons.

## Comment fonctionne `/login`

1. L'utilisateur lance `/login` (channel ou DM).
2. Leonarr crée un PIN Plex via le `services/plex.js` d'Oscarr.
3. La réponse éphémère de la commande contient un embed avec un bouton "Sign in with Plex".
4. Leonarr poll le PIN pendant 5 minutes max.
5. Quand l'utilisateur valide côté Plex, Leonarr récupère le compte Plex et upsert la ligne `userProvider` d'Oscarr (même sémantique que le login web).
6. Le mapping Discord ID ↔ Oscarr user ID est stocké dans les settings plugin sous `userLinks`.

Si l'utilisateur existe déjà dans Oscarr (par exemple auto-importé depuis un partage Plex), le lien est ajouté au compte existant. Pas de doublon.

## Comment les demandes sont traitées

`/search` → pick un résultat → clic **Demander**. Sous le capot, Leonarr appelle exactement le même pipeline que l'API HTTP d'Oscarr :

- `validateRequestBody`
- `runPluginGuard` (les autres plugins peuvent bloquer, ex : un plugin abonnement)
- `isBlacklisted`
- `findOrCreateMedia` (fetch TMDB + upsert DB)
- check doublon sur les demandes actives du même user
- `auto-approve` honoré depuis `AppSettings`
- `sendToService` (Radarr ou Sonarr avec folder rules + quality mapping)

Le bot ne contourne jamais la validation ni les permissions. Pour les séries, un season picker s'affiche entre le clic "Demander" et l'envoi effectif à Sonarr : multi-select avec les saisons disponibles plus un raccourci "Toutes les saisons".

## Notifications

Quand un média demandé par un utilisateur Discord devient disponible dans Plex (Oscarr passe la demande en `available`), Leonarr lui envoie un DM avec le poster et le titre. Un job cron toutes les 2 minutes poll la table `UserNotification` d'Oscarr et dédupe par ID pour ne pas spammer.

Si le user a désactivé les DMs du bot, fallback sur un message avec `@mention` dans le dernier channel où il a lancé une slash command.

## Logs

Leonarr écrit ses propres logs rotatés via **winston** + **winston-daily-rotate-file**, en plus de forwarder chaque message au logger interne d'Oscarr (toujours visible dans l'UI admin).

Deux transports :

| Fichier | Contenu | Rétention | Taille max par fichier |
|---|---|---|---|
| `leonarr-YYYY-MM-DD.log` | Tout (niveau ≥ `logLevel`) | 14 jours | 20 Mo, rotation anticipée si dépassé |
| `leonarr-error-YYYY-MM-DD.log` | Erreurs uniquement | 30 jours | 20 Mo |

Archives gzippées (`.log.gz`). Format JSON structuré avec `timestamp`, `level`, `message`, `service: "leonarr"` et `stack` complet pour les erreurs. Direct ingest dans Loki, Grafana ou `jq`.

Si winston n'arrive pas à initialiser ses transports (permissions, disque plein, package manquant), le plugin continue de tourner. Les logs partent alors uniquement vers le logger Oscarr et un warning est émis une fois au démarrage.

## Architecture

```
leonarr/
├── manifest.json          # Métadonnées plugin (settings schema, hooks, jobs cron)
├── index.js               # register(ctx) — entry appelée par le plugin engine
├── package.json           # discord.js, winston, winston-daily-rotate-file
└── src/
    ├── backend.js         # Résout packages/backend/{src,dist} au runtime
    ├── bot.js             # Lifecycle client Discord + routing events
    ├── commands.js        # Slash commands + enregistrement REST + localization
    ├── store.js           # Settings plugin (liens users, locales, channels) avec lock
    ├── logger.js          # winston + tee vers ctx.log d'Oscarr
    ├── notifications.js   # Job cron : DM quand un média devient disponible
    ├── i18n.js            # Catalogue fr/en + helper t()
    ├── handlers/
    │   ├── login.js       # /login et /logout
    │   ├── search.js      # /search + pagination + season picker
    │   ├── status.js      # /status avec filtres + refresh
    │   ├── settings.js    # /settings language
    │   └── help.js        # /help
    └── lib/
        ├── plex.js        # Wrapper flow PIN
        ├── oscarr.js      # Wrappers prisma / tmdb / requestService / queue
        └── embeds.js      # Media card, status list, season picker, badges
```

`src/backend.js` résout le backend Oscarr au démarrage en cherchant `packages/backend/src` (dev, tsx) ou `packages/backend/dist` (prod compilé). Le même code tourne contre une image Docker et une instance locale en dev.

## Limitations connues

- **Hook `onDisable` absent** : le plugin engine d'Oscarr ne déclenche pas encore de callback `onDisable`. Désactiver le plugin depuis l'admin ne stoppe donc pas le client Discord jusqu'au prochain reboot. Utilise `POST /api/plugins/leonarr/restart` après un changement de config.
- **Propagation des commandes globales** : peut prendre jusqu'à une heure. Utilise `guildId` en dev pour des updates instantanés.
- **Sonarr + nouvelles saisons sur série existante** : demander saison 4-5 alors que Sonarr a déjà la série ne déclenche qu'un `search missing`, pas un ajout de saison. C'est un comportement d'Oscarr (`services/requestService.js`) plus qu'un bug Leonarr.

## Dépannage

**`[Leonarr] Bot token or client ID missing — skipping Discord startup`**
Remplis les settings du plugin puis appelle `POST /api/plugins/leonarr/restart`.

**`Failed to register commands: DiscordAPIError[50001]: Missing Access`**
Le bot n'est pas dans le serveur référencé par `guildId`, ou il n'a pas le scope `applications.commands`. Ré-invite-le avec ce scope.

**`Cannot locate Oscarr backend`**
`src/backend.js` n'a pas trouvé `packages/backend/src` ni `packages/backend/dist`. Vérifie que le dossier plugin est bien placé ou symlinké dans `packages/plugins/` du monorepo Oscarr, et que le backend est compilé ou lancé via `tsx`.

**Le DM `/login` n'arrive jamais**
L'utilisateur a désactivé les DMs pour le serveur. Depuis la v0.1, le flow `/login` répond directement dans la réponse éphémère de la commande au lieu de DM. Si tu vois encore l'ancien comportement, tu as une version antérieure du plugin déployée.

## Licence

MIT.
