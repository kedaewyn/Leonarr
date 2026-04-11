const messages = {
  fr: {
    // ─── /login, /logout ────────────────────────────────────────────
    'login.not_linked': 'Tu n\'es pas encore connecté. Utilise `/login` pour lier ton compte Plex.',
    'login.intro': 'Clique sur le bouton ci-dessous, autorise Oscarr sur Plex, puis reviens ici. Je te confirmerai la connexion dans ce même message.',
    'login.button': 'Se connecter avec Plex',
    'login.waiting': 'En attente de la validation Plex… (5 min max)',
    'login.timeout': 'Délai dépassé. Relance `/login` pour réessayer.',
    'login.success': 'Connexion réussie ! Ton compte Discord est lié à **{name}** sur Oscarr.',
    'login.already_linked': 'Tu es déjà lié à **{name}**. Utilise `/logout` pour te déconnecter.',
    'logout.done': 'Compte Discord délié.',
    'logout.not_linked': 'Aucun compte à délier.',

    // ─── /search ────────────────────────────────────────────────────
    'search.usage': 'Utilisation : `/search <titre>`',
    'search.searching': 'Recherche en cours…',
    'search.none': 'Aucun résultat pour **{query}**.',
    'search.result_count': 'Résultat {current}/{total}',
    'search.button_prev': '◀ Précédent',
    'search.button_next': 'Suivant ▶',
    'search.button_request': '🎬 Demander',
    'search.button_request_tv': '📺 Demander',
    'search.button_already_available': '✅ Déjà dans ta biblio',
    'search.button_already_requested': '🕒 Déjà demandée',

    // ─── Status badges on search cards ─────────────────────────────
    'search.status_field': '📦 État',
    'search.status.available': '✅ Déjà disponible dans Plex',
    'search.status.processing': '⏬ En cours de téléchargement',
    'search.status.pending_user': '🕒 Tu as déjà une demande en cours ({status})',
    'search.expired': 'Cette recherche a expiré. Relance `/search` pour en démarrer une nouvelle.',
    'search.not_yours': 'Cette recherche ne t\'appartient pas.',
    'search.type_header': 'Catégorie : **{label}**',
    'search.no_match_in_type': 'Aucun résultat **{label}** pour **{query}**.',

    // ─── Season picker (TV requests) ────────────────────────────────
    'search.season_picker_title': '🗓️ Choisis les saisons à demander',
    'search.season_picker_hint': 'Sélection multiple autorisée. Ferme le menu pour valider la demande.',
    'search.season_placeholder': 'Sélectionne une ou plusieurs saisons',
    'search.season_all': 'Toutes les saisons',
    'search.season_all_desc': 'Demande la série complète',
    'search.season_option': 'Saison {n}',
    'search.season_option_desc': '{count} épisode(s)',
    'search.season_option_desc_year': '{count} épisode(s) · {year}',
    'search.season_back': '◀ Retour',
    'search.season_details_failed': 'Impossible de récupérer les saisons depuis TMDB. Réessaie dans un instant.',
    'search.season_none_selectable': 'Cette série n\'a pas de saison exploitable pour le moment.',
    'search.season_footer_count': '{count} saison(s)',

    // ─── Category labels for /search type autocomplete ──────────────
    'search.cat.movie': 'Films',
    'search.cat.tv': 'Séries',
    'search.cat.anime': 'Animes',
    'search.cat.rule_tag': 'règle',

    // ─── Media card labels ──────────────────────────────────────────
    'media.type_movie': '🎬 Film',
    'media.type_tv': '📺 Série',
    'media.no_synopsis': '*Pas de synopsis disponible.*',


    // ─── /request (boutons) ─────────────────────────────────────────
    'request.success': 'Demande enregistrée pour **{title}**.',
    'request.success_seasons': 'Demande enregistrée pour **{title}** — {seasons}.',
    'request.auto_approved': 'Demande approuvée automatiquement pour **{title}**.',
    'request.auto_approved_seasons': 'Demande approuvée automatiquement pour **{title}** — {seasons}.',
    'request.all_seasons': 'toutes les saisons',
    'request.duplicate': 'Tu as déjà une demande en cours pour **{title}**.',
    'request.blacklisted': 'Ce média a été bloqué par un administrateur.',
    'request.failed': 'Impossible d\'enregistrer la demande : {error}',

    // ─── /status ────────────────────────────────────────────────────
    'status.title': 'Tes demandes',
    'status.title_all': 'Tes demandes',
    'status.title_downloading': '⏬ Téléchargements en cours',
    'status.title_waiting': '⏳ En attente',
    'status.title_available': '✅ Disponibles',
    'status.empty': 'Tu n\'as aucune demande en cours.',
    'status.empty_bucket': 'Aucune demande dans cette catégorie.',
    'status.count': '{count} demande(s)',
    'status.button_all': 'Tout',
    'status.button_downloading': '⏬ En cours',
    'status.button_waiting': '⏳ En attente',
    'status.button_available': '✅ Terminé',
    'status.button_refresh': '🔄 Rafraîchir',
    'status.refreshed_footer': '{count} demande(s) · actualisé à {time}',

    // ─── Background notifications (DM on media available) ──────────
    'notify.title': '🎉 Ta demande est disponible !',
    'notify.description': '**{title}** vient d\'arriver dans Plex. Bon visionnage !',
    'notify.footer': 'Demandé via Leonarr',
    'status.progress': '{bar} {percent}% · ⏱ {timeleft}',
    'status.progress_no_eta': '{bar} {percent}%',
    'status.progress_eps': '{bar} {percent}% · {episodes} ép. · ⏱ {timeleft}',
    'status.starting': '⏳ démarrage…',
    'status.queued': '⌛ en file d\'attente',
    'status.paused': '⏸ en pause',
    'status.progress_icon': '⏬',
    'status.label.pending': '🕒 en attente d\'approbation',
    'status.label.approved': '🔎 en recherche de release',
    'status.label.processing': '⏳ en cours de traitement',
    'status.label.available': '🟢 disponible dans Plex',
    'status.label.declined': '❌ refusée',
    'status.label.failed': '⚠️ échec',
    'status.label.upcoming': '📅 à venir',
    'status.label.searching': '🔎 en recherche',

    // ─── /help ──────────────────────────────────────────────────────
    'help.title': 'Commandes Leonarr',
    'help.login': '`/login` — Lier ton compte Discord à Oscarr via Plex',
    'help.logout': '`/logout` — Délier ton compte',
    'help.search': '`/search <type> <titre>` — Chercher un film ou une série',
    'help.status': '`/status` — Voir tes demandes en cours',
    'help.settings': '`/settings language` — Changer la langue des messages',
    'help.help': '`/help` — Afficher ce message',

    // ─── /settings ──────────────────────────────────────────────────
    'settings.language_set': 'Langue mise à **français**. Les prochains messages de Leonarr s\'afficheront dans cette langue.',
    'settings.language_reset': 'Préférence de langue réinitialisée. Leonarr utilisera la langue par défaut du serveur (ou celle de ton client Discord si elle est prise en charge).',

    // ─── Slash command descriptions (shown in Discord picker) ───────
    'cmd.help.desc': 'Afficher les commandes Leonarr',
    'cmd.login.desc': 'Lier ton compte Discord à Oscarr via Plex',
    'cmd.logout.desc': 'Délier ton compte Discord d\'Oscarr',
    'cmd.search.desc': 'Chercher un film ou une série',
    'cmd.search.type_desc': 'Catégorie (Films, Séries, Animes, ou une règle Oscarr)',
    'cmd.search.query_desc': 'Titre à chercher',
    'cmd.status.desc': 'Voir tes demandes récentes',
    'cmd.settings.desc': 'Gérer tes préférences Leonarr',
    'cmd.settings.language_desc': 'Changer la langue des messages du bot',
    'cmd.settings.language_value_desc': 'Code langue',
    'cmd.settings.default_choice': 'Par défaut (serveur)',

    // ─── Generic ────────────────────────────────────────────────────
    'error.generic': 'Une erreur est survenue : {error}',
  },

  en: {
    // ─── /login, /logout ────────────────────────────────────────────
    'login.not_linked': 'You\'re not logged in yet. Use `/login` to link your Plex account.',
    'login.intro': 'Click the button below, authorize Oscarr on Plex, then come back here. I\'ll confirm the login in this same message.',
    'login.button': 'Sign in with Plex',
    'login.waiting': 'Waiting for Plex validation… (5 min max)',
    'login.timeout': 'Timed out. Run `/login` again to retry.',
    'login.success': 'Login successful! Your Discord is linked to **{name}** on Oscarr.',
    'login.already_linked': 'You are already linked to **{name}**. Use `/logout` to unlink.',
    'logout.done': 'Discord account unlinked.',
    'logout.not_linked': 'No account to unlink.',

    // ─── /search ────────────────────────────────────────────────────
    'search.usage': 'Usage: `/search <title>`',
    'search.searching': 'Searching…',
    'search.none': 'No results for **{query}**.',
    'search.result_count': 'Result {current}/{total}',
    'search.button_prev': '◀ Previous',
    'search.button_next': 'Next ▶',
    'search.button_request': '🎬 Request',
    'search.button_request_tv': '📺 Request',
    'search.button_already_available': '✅ Already in library',
    'search.button_already_requested': '🕒 Already requested',

    // ─── Status badges on search cards ─────────────────────────────
    'search.status_field': '📦 Status',
    'search.status.available': '✅ Already available in Plex',
    'search.status.processing': '⏬ Currently downloading',
    'search.status.pending_user': '🕒 You already have a pending request ({status})',
    'search.expired': 'This search has expired. Run `/search` again to start a new one.',
    'search.not_yours': 'This search isn\'t yours.',
    'search.type_header': 'Category: **{label}**',
    'search.no_match_in_type': 'No **{label}** results for **{query}**.',

    // ─── Season picker (TV requests) ────────────────────────────────
    'search.season_picker_title': '🗓️ Pick the seasons to request',
    'search.season_picker_hint': 'Multi-select allowed. Close the menu to confirm your request.',
    'search.season_placeholder': 'Pick one or more seasons',
    'search.season_all': 'All seasons',
    'search.season_all_desc': 'Request the full series',
    'search.season_option': 'Season {n}',
    'search.season_option_desc': '{count} episode(s)',
    'search.season_option_desc_year': '{count} episode(s) · {year}',
    'search.season_back': '◀ Back',
    'search.season_details_failed': 'Couldn\'t fetch seasons from TMDB. Try again in a moment.',
    'search.season_none_selectable': 'This show has no selectable seasons right now.',
    'search.season_footer_count': '{count} season(s)',

    // ─── Category labels for /search type autocomplete ──────────────
    'search.cat.movie': 'Movies',
    'search.cat.tv': 'TV Shows',
    'search.cat.anime': 'Anime',
    'search.cat.rule_tag': 'rule',

    // ─── Media card labels ──────────────────────────────────────────
    'media.type_movie': '🎬 Movie',
    'media.type_tv': '📺 TV Show',
    'media.no_synopsis': '*No synopsis available.*',


    // ─── /request (buttons) ─────────────────────────────────────────
    'request.success': 'Request saved for **{title}**.',
    'request.success_seasons': 'Request saved for **{title}** — {seasons}.',
    'request.auto_approved': 'Request auto-approved for **{title}**.',
    'request.auto_approved_seasons': 'Request auto-approved for **{title}** — {seasons}.',
    'request.all_seasons': 'all seasons',
    'request.duplicate': 'You already have a pending request for **{title}**.',
    'request.blacklisted': 'This media has been blocked by an administrator.',
    'request.failed': 'Could not save the request: {error}',

    // ─── /status ────────────────────────────────────────────────────
    'status.title': 'Your requests',
    'status.title_all': 'Your requests',
    'status.title_downloading': '⏬ Downloading',
    'status.title_waiting': '⏳ Waiting',
    'status.title_available': '✅ Available',
    'status.empty': 'You have no pending requests.',
    'status.empty_bucket': 'No requests in this category.',
    'status.count': '{count} request(s)',
    'status.button_all': 'All',
    'status.button_downloading': '⏬ Downloading',
    'status.button_waiting': '⏳ Waiting',
    'status.button_available': '✅ Done',
    'status.button_refresh': '🔄 Refresh',
    'status.refreshed_footer': '{count} request(s) · refreshed at {time}',

    // ─── Background notifications (DM on media available) ──────────
    'notify.title': '🎉 Your request is available!',
    'notify.description': '**{title}** just landed in Plex. Enjoy!',
    'notify.footer': 'Requested via Leonarr',
    'status.progress': '{bar} {percent}% · ⏱ {timeleft}',
    'status.progress_no_eta': '{bar} {percent}%',
    'status.progress_eps': '{bar} {percent}% · {episodes} eps · ⏱ {timeleft}',
    'status.starting': '⏳ starting…',
    'status.queued': '⌛ queued',
    'status.paused': '⏸ paused',
    'status.progress_icon': '⏬',
    'status.label.pending': '🕒 waiting for approval',
    'status.label.approved': '🔎 looking for release',
    'status.label.processing': '⏳ processing',
    'status.label.available': '🟢 available in Plex',
    'status.label.declined': '❌ declined',
    'status.label.failed': '⚠️ failed',
    'status.label.upcoming': '📅 upcoming',
    'status.label.searching': '🔎 searching',

    // ─── /help ──────────────────────────────────────────────────────
    'help.title': 'Leonarr commands',
    'help.login': '`/login` — Link your Discord account to Oscarr via Plex',
    'help.logout': '`/logout` — Unlink your account',
    'help.search': '`/search <type> <title>` — Search for a movie or TV show',
    'help.status': '`/status` — View your pending requests',
    'help.settings': '`/settings language` — Change the bot message language',
    'help.help': '`/help` — Show this help',

    // ─── /settings ──────────────────────────────────────────────────
    'settings.language_set': 'Language set to **English**. Leonarr\'s next messages will appear in this language.',
    'settings.language_reset': 'Language preference reset. Leonarr will fall back to the server default (or your Discord client locale if supported).',

    // ─── Slash command descriptions (shown in Discord picker) ───────
    'cmd.help.desc': 'Show Leonarr commands',
    'cmd.login.desc': 'Link your Discord account to Oscarr via Plex',
    'cmd.logout.desc': 'Unlink your Discord account from Oscarr',
    'cmd.search.desc': 'Search for a movie or TV show',
    'cmd.search.type_desc': 'Category (Movies, TV, Anime, or an Oscarr routing rule)',
    'cmd.search.query_desc': 'Title to search for',
    'cmd.status.desc': 'View your recent requests',
    'cmd.settings.desc': 'Manage your Leonarr preferences',
    'cmd.settings.language_desc': 'Change the bot message language',
    'cmd.settings.language_value_desc': 'Language code',
    'cmd.settings.default_choice': 'Server default',

    // ─── Generic ────────────────────────────────────────────────────
    'error.generic': 'An error occurred: {error}',
  },
};


export function t(lang, key, vars = {}) {
  const catalog = messages[lang] || messages.en;
  let str = catalog[key] || messages.en[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}


export function diffKeys() {
  const fr = new Set(Object.keys(messages.fr));
  const en = new Set(Object.keys(messages.en));
  return {
    missingInEn: [...fr].filter((k) => !en.has(k)),
    missingInFr: [...en].filter((k) => !fr.has(k)),
  };
}
