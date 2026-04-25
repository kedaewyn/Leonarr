<h1 align="center">
  <img src="assets/logo.png" width="140" alt="Leonarr" /><br/>
  Leonarr
</h1>

Plugin Discord pour [Oscarr](https://github.com/arediss/Oscarr). Vos utilisateurs lient leur compte Discord une fois, cherchent sur TMDB, soumettent des demandes de films et séries, et suivent l'état de leurs demandes depuis Discord. Les notifications d'Oscarr (demande approuvée, média disponible) leur arrivent en DM.

Leonarr n'est pas un bot autonome. C'est un plugin Oscarr packagé qui passe uniquement par le `PluginContext` v1.1 (`ctx.tmdb`, `ctx.requests`, `ctx.media`, event bus, plugin permissions, frontend isolé). Tout ce que votre UI web fait déjà — folder rules, quality mappings, blacklist, plugin guards, auto-approve — s'applique côté Discord sans rejeu de logique. Voir [`docs/plugins.md`](https://github.com/arediss/Oscarr/blob/main/docs/plugins.md) côté Oscarr pour le contrat complet.

## Fonctionnalités

- `/link` : envoie un deep link éphémère vers le flow Discord OAuth d'Oscarr. L'utilisateur valide une fois, Oscarr stocke le mapping Discord ↔ Oscarr dans `UserProvider`.
- `/search <query>` : autocomplétion TMDB via `ctx.tmdb.search`. La réponse a trois branches selon l'état de la bibliothèque Oscarr : déjà disponible, déjà demandée, ou proposition de soumission. Embed avec poster et boutons de pagination.
- `/status` : les 10 dernières demandes de l'utilisateur via `ctx.requests.listForUser`, avec progression live des téléchargements en cours via `ctx.getArrClients`.
- `/help` : liste les commandes.
- DM automatique sur notification : Leonarr souscrit à l'event `user.notification.created` (émis par `safeUserNotify` côté Oscarr) et envoie un embed avec poster, titre traduit (`titleText` / `messageText` viennent du payload) et un emoji selon le type. Pas de polling.
- Annonce de canal optionnelle : si `announceChannelId` est défini, Leonarr poste dans ce canal à chaque event `media.available`.

Pas d'imports en backdoor, pas d'auto-HTTP, pas de cron, pas de table de mapping séparée. Oscarr garde la main sur les `UserProvider`.

## Prérequis

- Une instance Oscarr `>=0.7.0-0 <1.0.0` (testé contre `0.7.0`, ce qui donne le badge *Verified* sur la page d'install via `engines.testedAgainst`). Les capacités v1.1 du `PluginContext` sont requises.
- Une application Discord avec un bot token. Récupérez-les depuis [discord.com/developers/applications](https://discord.com/developers/applications).
- Le provider Discord OAuth activé côté Oscarr (Admin → Authentification → Discord). Réutilisez le même `clientId` / `clientSecret` que ceux du bot.
- `AppSettings.siteUrl` renseigné côté Oscarr : `/link` s'en sert comme base canonique pour générer le deep link OAuth. Sans cette valeur, la commande log un warning et n'envoie rien.
- Node.js 22+ pour le build local (`target=node22` côté esbuild).

## Installation

Au runtime, Leonarr doit se trouver dans le répertoire scanné par Oscarr — `packages/plugins/leonarr/` dans le monorepo, ou tout autre chemin pointé par la variable d'environnement `OSCARR_PLUGINS_DIR`. Le scan suit les symlinks et ignore les dossiers cachés.

### 1. Cloner et builder

```bash
git clone https://github.com/kedaewyn/Leonarr.git /opt/leonarr
cd /opt/leonarr
npm install
npm run build
```

`npm run build` produit trois artefacts dans `dist/` :

- `dist/index.js` : bundle backend (`platform=node`, ESM, target Node 22). `discord.js` et `@oscarr/shared` restent externes et sont résolus au runtime.
- `dist/frontend/index.js` : composant React de l'onglet admin (`platform=browser`). React, `react-dom`, `react/jsx-runtime` et `@oscarr/sdk` sont externes ; l'importmap d'Oscarr les fournit.
- `dist/frontend/index.css` : bundle Tailwind scoped au plugin. Oscarr purge sa propre Tailwind contre son tree à lui, donc les utilities `ndp-*` utilisées seulement ici doivent être recompilées localement. Le patch d'isolation CSS de la 0.7.0 injecte automatiquement ce stylesheet.

### 2. Brancher Leonarr sur Oscarr

En dev, un symlink vers `packages/plugins/leonarr` du monorepo est le plus simple :

```bash
ln -s /opt/leonarr /chemin/vers/Oscarr/packages/plugins/leonarr
```

En prod, deux options :

- Installation hot depuis l'admin Oscarr → onglet **Plugins → Discover / Install** : collez l'URL d'une release GitHub, l'admin télécharge la tarball, charge le plugin et monte ses routes sans redémarrer le conteneur. Le `dist/` doit déjà être présent dans la release.
- Installation manuelle : déposez le repo cloné (avec `dist/` buildé) dans le dossier scanné par Oscarr, puis redémarrez le service une fois pour que le plugin engine le découvre.

### 3. Relancer Oscarr

Au démarrage, le plugin engine découvre `leonarr`, charge `manifest.json`, appelle `register()` et log `[PluginEngine] Loaded "leonarr" v0.2.0`. Le client Discord reste inactif tant que les settings ne sont pas remplis.

### 4. Configurer dans l'admin

Ouvrez Oscarr → Admin → Plugins → Leonarr. L'onglet ressemble aux autres tabs admin :

- En tête : titre, description, et pill *running / stopped* (poll toutes les 10 s tant que l'onglet est visible).
- Barre d'actions : Start, Stop, Restart. Le bouton Start est désactivé tant qu'un setting requis manque.
- Carte Settings : un champ par setting du manifest, bouton Save en bas.

| Paramètre | Requis | Notes |
|---|---|---|
| `botToken` | oui | Bot token Discord (developer portal → Bot → Token). |
| `clientId` | oui | Application ID Discord. |
| `guildId` | non | Enregistre les commandes sur un seul serveur avec propagation instantanée. Vide = global, jusqu'à 1 h de propagation. |
| `announceChannelId` | non | ID du canal pour les annonces `media.available`. Vide = DMs uniquement. |

Les boutons et leurs routes sous-jacentes (`POST /api/plugins/leonarr/start|stop|restart`) sont gardés par la permission `leonarr.restart`, enregistrée au load et accordée aux admins par défaut. Vous pouvez la déléguer à un autre rôle pour avoir un opérateur de bot non-admin.

Restart est l'action à utiliser après un changement de settings : il bounce la gateway Discord et ré-enregistre les slash commands contre la nouvelle config.

### 5. Inviter le bot sur votre serveur

Developer portal Discord → OAuth2 → URL Generator. Scopes : `bot` + `applications.commands`. Permissions minimum : `Send Messages` et `Embed Links`.

## Intents Discord

Leonarr utilise uniquement `Guilds` et `Direct Messages`. L'intent `Message Content` n'est pas nécessaire ; tout passe par slash commands et boutons.

## Comment fonctionne `/link`

1. L'utilisateur lance `/link` (channel ou DM).
2. Leonarr lit `AppSettings.siteUrl`, construit l'URL `${siteUrl}/api/auth/discord/authorize?action=link` et la renvoie comme bouton dans une réponse éphémère.
3. L'utilisateur ouvre le lien et valide le consentement Discord OAuth. Le `state` UUID est généré et vérifié côté Oscarr — Leonarr ne signe rien lui-même.
4. Oscarr échange le code, récupère l'identité Discord et upsert la ligne `UserProvider` (même sémantique que l'ajout de provider depuis le profil web).
5. Au prochain `/search` ou `/status`, Leonarr résout l'utilisateur via `ctx.findUserByProvider('discord', discordId)`.

Pas de PIN, pas de polling, pas de table de mapping plugin-side. Si l'utilisateur existe déjà dans Oscarr (par exemple lié via Plex), le provider Discord est ajouté à son compte existant.

## Comment les demandes sont traitées

`/search`, sélection d'un résultat, clic sur Demander. Sous le capot, Leonarr appelle `ctx.requests.create(...)`, qui est exactement le même pipeline que `POST /api/requests` :

- `validateRequestBody`
- `runPluginGuard` (les autres plugins peuvent bloquer, par exemple un plugin abonnement)
- `isBlacklisted`
- `findOrCreateMedia` (fetch TMDB + upsert DB)
- check doublon sur les demandes actives du même utilisateur
- `auto-approve` honoré depuis `AppSettings`
- `sendToService` (Radarr ou Sonarr avec folder rules + quality mapping)

Le bot ne contourne jamais la validation ni les permissions : il est un client de plus du pipeline central.

## Notifications

Côté Oscarr, chaque appel à `safeUserNotify` émet un event `user.notification.created` sur le bus interne. Leonarr y souscrit via `ctx.events.on(...)`, résout l'utilisateur Discord cible et envoie un DM avec embed : poster, titre traduit, emoji selon le type de notif (`request.approved`, `media.available`, etc.).

Si `announceChannelId` est aussi configuré, Leonarr s'abonne à `media.available` et poste un message dans ce canal pour chaque nouvelle dispo. Pratique pour un canal `#nouveautes` partagé.

Si l'utilisateur a désactivé les DMs du bot, le DM est silencieusement perdu : Discord n'expose pas de fallback fiable. L'event reste loggé côté Oscarr.

## Architecture

```
leonarr/
├── manifest.json              # Métadonnées plugin (settings, capabilities, hooks UI)
├── build.js                   # esbuild — bundle backend + frontend + CSS Tailwind
├── package.json               # discord.js, esbuild, react (dev)
├── tailwind.config.js         # Tailwind scoped au plugin
├── frontend/
│   ├── index.tsx              # Onglet admin (Start/Stop/Restart + form Settings)
│   ├── index.css              # Sources Tailwind du plugin
│   └── oscarr-sdk.d.ts        # Types du SDK frontend host
└── src/
    ├── index.ts               # register(ctx) — onEnable/onDisable + routes /status, /start, /stop, /restart
    ├── bot.ts                 # Lifecycle client Discord (start/stop/isRunning), routing events
    ├── backend.js             # (legacy) — peut disparaître sur les futures versions ctx-v1
    ├── types.ts               # Types miroir du PluginContext v1.1 d'Oscarr
    ├── commands/
    │   ├── link.ts            # /link
    │   ├── search.ts          # /search + pagination + soumission
    │   ├── status.ts          # /status
    │   └── help.ts            # /help
    ├── events/
    │   └── notifications.ts   # Souscriptions user.notification.created + media.available
    ├── i18n/
    │   ├── en.json
    │   ├── fr.json
    │   └── index.ts           # Helper t(lang, key, vars)
    └── lib/
        └── sessionStore.js    # In-memory TTL store partagé par /search et /status
```

`src/types.ts` mirroite `@oscarr/shared/pluginContext` pour que le repo reste autonome (pas besoin du monorepo Oscarr pour `tsc`). Quand le `PluginContext` évolue côté Oscarr, gardez ce fichier en sync : `npm run typecheck` vous le dira fort.

Les catalogues i18n sont des JSON dans `src/i18n/{en,fr}.json`, bundlés par esbuild. Ajoutez les nouvelles clés dans les deux fichiers.

## Capacités déclarées

Dans `manifest.json` :

`settings:plugin` · `settings:app` · `users:read` · `tmdb:read` · `requests:read` · `requests:write` · `events` · `permissions`

Chaque capacité a une justification d'une ligne dans `manifest.capabilityReasons`, affichée à l'admin lors de l'install ou de l'activation.

## Développement

```bash
npm install
npm run dev         # esbuild --watch sur les trois artefacts
npm run build       # build minifié one-shot
npm run typecheck   # tsc --noEmit
```

`build.js` détecte `--watch` et bascule esbuild en mode incrémental. Les changements TS / TSX recompilent en quelques ms.

## Limitations connues

- Propagation des commandes globales : peut prendre jusqu'à une heure. Utilisez `guildId` en dev pour des updates instantanés.
- DMs désactivés : si l'utilisateur a coupé les DMs du bot, les notifications partent dans le vide. Discord n'expose rien de fiable pour le détecter en amont.
- Sonarr et nouvelles saisons sur une série existante : demander S4-5 alors que Sonarr a déjà la série ne déclenche qu'un `search missing`, pas un ajout de saison. C'est un comportement d'Oscarr (`requests` core) plus qu'une limite Leonarr.

## Dépannage

`Leonarr onEnable — bot token or client id missing`
Remplissez les settings du plugin dans l'onglet admin, puis cliquez sur Restart.

`Failed to register commands: DiscordAPIError[50001]: Missing Access`
Le bot n'est pas dans le serveur référencé par `guildId`, ou il n'a pas le scope `applications.commands`. Ré-invitez-le avec ce scope.

Le DM `/link` n'arrive jamais.
La réponse de `/link` est éphémère dans le channel où la commande est lancée, pas un DM. Si l'éphémère n'apparaît pas, le bot n'a probablement pas la permission `Use Application Commands` dans ce salon.

L'onglet admin reste vide ou les styles sont cassés.
Le bundle `dist/frontend/index.css` n'a pas été buildé ou n'est pas servi. Vérifiez que `npm run build` a tourné et que le plugin engine est en `>=0.7.0` (le patch d'isolation CSS y a été ajouté).

## Licence

MIT.
