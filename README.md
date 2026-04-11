<h1 align="center">
  <img src="assets/logo.png" width="140" alt="Leonarr" /><br/>
  Leonarr
</h1>

<p align="center">🇬🇧 English version: <a href="README.en.md">README.en.md</a></p>

Plugin Discord pour [Oscarr](https://github.com/arediss/Oscarr). Permet à tes utilisateurs de se connecter avec Plex, chercher sur TMDB, demander des films et séries, et suivre l'état de leurs demandes — le tout depuis Discord.

Leonarr **n'est pas un bot autonome** : il est packagé comme un plugin Oscarr et réutilise directement les services internes d'Oscarr (TMDB, auth Plex, pipeline de requêtes — folder rules, quality mappings, blacklist, plugin guards). Tout ce que l'UI web fait respecter est appliqué de la même manière côté Discord.

## Fonctionnalités

- `/login` — Lie un utilisateur Discord à son compte Oscarr via Plex OAuth (flow PIN).
- `/logout` — Délie le compte.
- `/search <titre>` — Cherche sur TMDB, navigue entre les résultats (prev/next), demande en un clic.
- `/status` — Affiche les 10 dernières demandes de l'utilisateur et leur statut.
- `/help` — Liste les commandes.

Messages disponibles en français et en anglais (choix via le paramètre plugin `language`).

## Prérequis

- Une instance Oscarr (source ou Docker) en **v0.4.2** ou plus récente — le plugin engine est requis.
- Une application Discord avec un bot token ([discord.com/developers/applications](https://discord.com/developers/applications)).
- Node.js 20+ (même que le backend Oscarr).

## Installation

Leonarr vit dans son propre dépôt, mais au runtime il doit se trouver dans le dossier `packages/plugins/` d'Oscarr pour que le plugin engine le découvre.

### 1. Cloner Leonarr

```bash
git clone https://github.com/<toi>/Leonarr.git /opt/leonarr
cd /opt/leonarr
npm install
```

### 2. L'exposer à Oscarr

Le plus simple : un symlink.

```bash
ln -s /opt/leonarr /chemin/vers/Oscarr/packages/plugins/leonarr
```

Pour un setup Docker, Leonarr est conçu pour se brancher sur une instance Oscarr **déjà en place** et gérée séparément. Le `docker-compose.yml` à la racine du dépôt ne décrit **que** Leonarr — à toi de ne pas y toucher pour la partie Oscarr, elle reste dans ta propre stack.

Deux façons de brancher Leonarr sur Oscarr, selon comment ton Oscarr monte son dossier `packages/plugins` :

**Option A — volume Docker partagé.** Si ton Oscarr monte un volume nommé (ex : `oscarr-plugins:/app/packages/plugins`), Leonarr peut écrire dedans via un init container. Dans ce cas le compose fourni marche tel quel — il référence `oscarr-plugins` comme volume `external: true` et Docker réutilise celui de ta stack Oscarr.

```bash
cd Leonarr
docker compose up --build      # build ARM natif + sync dans oscarr-plugins
docker restart oscarr          # Oscarr re-discover le plugin
```

**Option B — bind mount hôte.** Si ton Oscarr monte un chemin hôte direct (ex : `/Users/toi/Docker/oscarr/packages/plugins:/app/packages/plugins`), l'approche la plus simple n'est même pas Docker : un `rsync` direct vers le chemin hôte suffit.

```bash
rsync -avz --delete-after \
  --exclude='.git' --exclude='.github' --exclude='.idea' --exclude='.claude' \
  --exclude='CLAUDE.md' --exclude='node_modules' --exclude='logs' \
  --exclude='*.log' --exclude='.DS_Store' \
  ./ user@host:/Users/toi/Docker/oscarr/packages/plugins/leonarr/

# Installer les deps côté cible via un container Node éphémère
ssh user@host '
  cd /Users/toi/Docker/oscarr/packages/plugins/leonarr && \
  docker run --rm -v "$PWD:/app" -w /app node:20-alpine \
    npm ci --omit=dev --no-audit --no-fund
'

ssh user@host 'docker restart oscarr'
```

Si tu préfères quand même utiliser le compose en Option B, édite `docker-compose.yml` pour remplacer `oscarr-plugins:/plugins-out` par le chemin hôte absolu (et supprime la section `volumes:` externe) — c'est documenté dans les commentaires du fichier.

### 3. Relancer Oscarr

Au démarrage, le plugin engine découvre `leonarr`, charge `manifest.json`, appelle `register()`, et log `[PluginEngine] Loaded "leonarr" v0.1.0`. Le client Discord reste inactif tant que les identifiants ne sont pas configurés.

### 4. Configurer dans l'admin

Ouvre Oscarr → **Admin → Plugins → Leonarr → Settings**. Remplis :

| Paramètre | Requis | Notes |
|---|---|---|
| `botToken` | oui | Bot token Discord récupéré dans le developer portal |
| `clientId` | oui | Application ID (même portail) |
| `guildId` | non | Si défini, les commandes sont enregistrées sur un seul serveur (propagation instantanée). Vide = enregistrement global (jusqu'à 1 h de propagation). |
| `language` | non | `fr` (défaut) ou `en` |
| `requireLogin` | non | Défaut `true` — `/search` et les demandes exigent `/login` au préalable. Mets à `false` pour ouvrir `/search` à tout le monde. |
| `logDir` | non | Dossier des logs rotatés. Chemin absolu ou relatif au dossier du plugin. Vide = `<plugin>/logs`. |
| `logLevel` | non | `error`, `warn`, `info` (défaut) ou `debug`. |

Ensuite, appelle **POST /api/plugins/leonarr/restart** (ou toggle le plugin off/on dans l'admin UI) pour que les nouveaux settings soient pris en compte. Le client Discord se connecte et enregistre ses slash commands.

### 5. Inviter le bot sur ton serveur

Depuis le developer portal Discord, OAuth2 → URL Generator. Scopes : `bot` + `applications.commands`. Permissions minimum : `Send Messages` et `Embed Links`.

## Intents Discord

Leonarr n'utilise que les intents `Guilds` et `Direct Messages`. L'intent `Message Content` **n'est pas** nécessaire — tout passe par slash commands et boutons.

## Comment fonctionne `/login`

1. L'utilisateur lance `/login` (n'importe où, DM inclus).
2. Leonarr crée un PIN Plex via le `services/plex.js` d'Oscarr.
3. Un DM est envoyé avec un bouton "Sign in with Plex" (fallback en réponse éphémère si les DMs sont bloqués).
4. Leonarr poll le PIN pendant 5 minutes maximum.
5. Quand l'utilisateur valide sur Plex, Leonarr récupère le compte Plex et upsert la ligne `userProvider` d'Oscarr (même sémantique que le login web).
6. Le mapping Discord ID ↔ Oscarr user ID est stocké dans les settings du plugin (clé `userLinks`).

Si l'utilisateur existe déjà dans Oscarr (par exemple auto-importé depuis un partage Plex), le lien est ajouté au compte existant — pas de doublon.

## Comment les demandes sont traitées

`/search` → pick un résultat → clic **Demander**. Sous le capot, Leonarr appelle exactement le même pipeline que l'API HTTP d'Oscarr :

- `validateRequestBody`
- `runPluginGuard` (les autres plugins peuvent toujours bloquer, ex : un plugin abonnement)
- `isBlacklisted`
- `findOrCreateMedia` (fetch TMDB + upsert DB)
- check doublon sur les demandes actives
- `auto-approve` respecté depuis `AppSettings`
- `sendToService` (Radarr / Sonarr avec folder rules + quality mapping)

Le bot ne contourne jamais la validation ni les permissions.

## Logs

Leonarr écrit ses propres logs rotatés via **winston** + **winston-daily-rotate-file**, en plus d'envoyer chaque message au logger interne d'Oscarr (donc toujours visible dans l'UI admin d'Oscarr).

Deux transports :

| Fichier | Contenu | Rétention | Taille max par fichier |
|---|---|---|---|
| `leonarr-YYYY-MM-DD.log` | Tout (niveau ≥ `logLevel`) | 14 jours | 20 Mo (rotation anticipée si dépassé) |
| `leonarr-error-YYYY-MM-DD.log` | Erreurs uniquement | 30 jours | 20 Mo |

Les archives sont gzippées (`.log.gz`). Format : **JSON structuré** avec `timestamp`, `level`, `message`, `service: "leonarr"`, et `stack` complet pour les erreurs — idéal pour Loki, Grafana ou `jq`.

Si winston ne peut pas initialiser ses transports (permissions, disque plein, package manquant), le plugin continue à fonctionner : les logs partent uniquement vers le logger interne d'Oscarr, et un warning est émis une seule fois au démarrage.

## Architecture

```
leonarr/
├── manifest.json          # Métadonnées plugin (schema settings, hooks)
├── index.js               # register(ctx) — entry appelée par le plugin engine
├── package.json           # Dépendance discord.js
└── src/
    ├── backend.js         # Résout packages/backend/{src,dist} au runtime
    ├── bot.js             # Lifecycle client Discord + routing events
    ├── commands.js        # Défs slash commands + enregistrement REST
    ├── store.js           # Map Discord ↔ Oscarr (blob settings plugin)
    ├── i18n.js            # Strings fr / en
    ├── handlers/
    │   ├── login.js       # /login et /logout
    │   ├── search.js      # /search + boutons pagination/demande
    │   ├── status.js      # /status
    │   └── help.js        # /help
    └── lib/
        ├── plex.js        # Wrapper flow PIN
        ├── oscarr.js      # Wrappers prisma / tmdb / requestService
        └── embeds.js      # Embeds media card + status
```

`src/backend.js` résout le backend au démarrage en cherchant `packages/backend/src` (dev, tsx) ou `packages/backend/dist` (prod compilé) — le même code tourne contre une image Docker compilée et une instance locale en dev.

## Limitations connues (v0.1)

- **Sélection de saisons** : pour l'instant `/request` sur une série demande **toutes les saisons**. Le picker est sur la roadmap.
- **Pas de hook `onDisable` par plugin** : le plugin engine d'Oscarr ne déclenche pas encore de callback `onDisable`, donc désactiver le plugin depuis l'admin ne stoppe pas le client Discord jusqu'au prochain reboot. Utilise `POST /api/plugins/leonarr/restart` pour reset après un changement de config.
- **Une seule langue par instance** : le paramètre `language` est global. La locale par utilisateur n'est pas encore branchée.
- **Propagation des commandes** : l'enregistrement global peut prendre jusqu'à une heure. Utilise `guildId` en dev pour des updates instantanés.

## Dépannage

**`[Leonarr] Bot token or client ID missing — skipping Discord startup`**
Remplis les settings du plugin puis appelle `POST /api/plugins/leonarr/restart`.

**`Failed to register commands: DiscordAPIError[50001]: Missing Access`**
Le bot n'est pas dans le serveur référencé par `guildId`, ou il n'a pas le scope `applications.commands`. Ré-invite-le avec ce scope.

**`Cannot locate Oscarr backend`**
`src/backend.js` n'a pas trouvé `packages/backend/src` ou `packages/backend/dist`. Vérifie que le dossier du plugin est bien placé/symlinké dans `packages/plugins/` du monorepo Oscarr, et que le backend est compilé ou lancé via `tsx`.

**Le DM `/login` n'arrive jamais**
L'utilisateur a désactivé les DMs pour le serveur. Leonarr fait un fallback sur une réponse éphémère avec le même bouton — dis-lui de regarder la réponse de la commande.

## Licence

MIT.
