/* ============================================================
 * SportVision Connect — Module "Espace Joueur"
 * ------------------------------------------------------------
 * Portage autonome de la partie JOUEUR (pas Parent/Famille, portée par
 * un autre module) de l'« Espace Joueur & Famille » de SportVision
 * Club+ (app.html, lecture seule, référence uniquement — jamais
 * modifié) vers le nouveau socle Connect.
 *
 * Sources lues avant d'écrire ce fichier (aucune n'est modifiée) :
 *   - CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md (SportVision-TV)
 *   - CLUBPLUS_PLAYER_FAMILY_SECURITY_REVIEW.md (SportVision-TV)
 *   - migration-clubplus-v13.sql (player_profiles, parent_player_relationships,
 *     team_memberships, is_own_player/is_confirmed_parent_of/is_family_of_team)
 *   - migration-clubplus-v16.sql (policies additives family_select sur
 *     club_teams / club_calendar_events / club_matches)
 *   - migration-clubplus-v18.sql (media_access_rules, is_media_visible_to_family,
 *     favorite_collections, player_favorites)
 *   - migration-clubplus-v19.sql (media_reports)
 *   - migration-clubplus-v15.sql (authorization_types, parental_authorizations)
 *   - SportVision-Club-Plus/app.html, fonctions famXxx()/tplEspaceJoueurXxx()
 *     (patron fonctionnel de référence, jamais copié tel quel — recodé pour
 *     ce module autonome)
 *
 * ── Point d'architecture crucial (rappel) ──────────────────────────────
 * Un joueur n'est PAS une organisation : le 2e argument de render() est
 * directement player_profiles.id (pas organizations.id, pas club_id — un
 * joueur mineur peut exister sans jamais avoir de compte). ctx.role vaut
 * toujours 'joueur' ici. player_profiles.club_id est lu depuis le profil
 * une fois chargé, jamais transmis par le shell.
 *
 * Tables lues/écrites (déjà existantes, aucune migration créée ici) :
 *   player_profiles, team_memberships, club_teams, club_matches,
 *   club_calendar_events, club_media, club_creations, player_favorites,
 *   media_reports, parental_authorizations, authorization_types.
 * media_access_rules N'EST PAS interrogée directement par ce module : sa
 * policy SELECT ("mar_member_select", v18) est réservée à is_club_member,
 * qui exclut par construction un joueur/parent — c'est le fail-closed
 * documenté dans l'architecture (§7 de la migration v18 : la RLS
 * additive sur club_media/club_creations fait déjà tout le filtrage, ce
 * module se contente d'interroger club_media/club_creations et de
 * laisser la RLS décider ce qui revient).
 *
 * Dépendances globales fournies par le shell (index.html), non redéfinies
 * ici : sbFetch, sbRpc, sbFunction, esc, toast. Variables CSS réutilisées :
 * --card, --border, --radius, --shadow, --accent, --accent-2, --muted,
 * --text, --ok, --danger. Classes réutilisées : .btn, .btn-primary,
 * .btn-ghost, .badge.
 *
 * localStorage 'svc_uid' : seule façon d'obtenir l'auth.uid() du joueur
 * connecté depuis un module (ctx ne fournit que { role }) — clé déjà
 * posée par svcSave() dans index.html à la connexion, lue ici en lecture
 * seule, jamais réécrite. Nécessaire pour renseigner owner_user_id/
 * reported_by lors des écritures (player_favorites, media_reports),
 * exactement comme REAL.userId dans Club+.
 *
 * Consigne d'intégration spécifique à ce fichier : liaison des événements
 * via `container.onclick = function(e){...}` (assignation), pas
 * addEventListener — un nouveau container étant fourni par le shell à
 * chaque bascule d'onglet, l'assignation est remplacée avec lui, sans
 * accumulation possible.
 * ============================================================ */
(function () {
  'use strict';

  /* ── État interne partagé entre les 4 points d'entrée (un seul joueur
   * "monté" à la fois : les onglets d'un même espace ne s'affichent jamais
   * simultanément) — invalidé si contextId change (changement de compte). ── */
  var state = {
    playerId: null,
    role: '',
    container: null,
    mediaTab: 'tous',       // 'tous' | 'favoris' (onglet Médias & Favoris)
    profile: null, errorProfile: null,
    teams: null, errorTeams: null,
    matches: null, errorMatches: null,
    events: null, errorEvents: null,
    media: null, errorMedia: null,
    favorites: null, errorFavorites: null,
    authorizations: null, errorAuthorizations: null,
  };

  function resetCacheIfPlayerChanged(playerId) {
    if (state.playerId === playerId) return;
    state.playerId = playerId;
    state.profile = null; state.errorProfile = null;
    state.teams = null; state.errorTeams = null;
    state.matches = null; state.errorMatches = null;
    state.events = null; state.errorEvents = null;
    state.media = null; state.errorMedia = null;
    state.favorites = null; state.errorFavorites = null;
    state.authorizations = null; state.errorAuthorizations = null;
    state.mediaTab = 'tous';
  }

  function currentUserId() {
    return localStorage.getItem('svc_uid') || null;
  }

  /* ── Styles scopés (préfixe je-), injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('je-styles')) return;
    var style = document.createElement('style');
    style.id = 'je-styles';
    style.textContent = [
      '.je-wrap{display:flex;flex-direction:column;gap:16px}',
      '.je-notice{background:color-mix(in srgb,var(--warn) 12%,transparent);color:var(--warn);border-radius:var(--radius);padding:12px 16px;font-size:13px}',
      '.je-notice.je-danger{background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger)}',
      '.je-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px}',
      '.je-profile-head{display:flex;align-items:center;gap:12px}',
      '.je-avatar{width:52px;height:52px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;flex-shrink:0;background-size:cover;background-position:center}',
      '.je-h2{margin:0 0 2px;font-size:17px}',
      '.je-muted{color:var(--muted);font-size:13px}',
      '.je-grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}',
      '.je-kicker{font-size:11px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}',
      '.je-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:26px;text-align:center;color:var(--muted)}',
      '.je-error{color:var(--danger)}',
      '.je-pillbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}',
      '.je-pill{background:var(--card);border:1px solid var(--border);border-radius:999px;padding:6px 14px;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer}',
      '.je-pill:not(.on):hover{border-color:var(--accent);color:var(--text)}',
      '.je-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}',
      '.je-list{display:flex;flex-direction:column;gap:8px}',
      '.je-row{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px}',
      '.je-row-title{font-weight:700;font-size:13.5px}',
      '.je-row-sub{font-size:12px;color:var(--muted);margin-top:2px}',
      '.je-section-title{margin:6px 0 0;font-size:14px}',
      '.je-tilegrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}',
      '.je-tile{position:relative;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}',
      '.je-tile-thumb{height:96px;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;padding:8px;text-align:center}',
      '.je-tile-body{padding:10px 12px}',
      '.je-tile-title{font-weight:700;font-size:12.5px}',
      '.je-tile-sub{font-size:11px;color:var(--muted);margin-top:2px}',
      '.je-tile-actions{position:absolute;top:6px;right:6px;display:flex;gap:4px}',
      '.je-icon-btn{background:rgba(10,14,30,.5);border:none;border-radius:6px;padding:3px 7px;color:#fff;font-size:13px;cursor:pointer;line-height:1.4}',
      '.je-tile-open{display:block;margin-top:8px;font-size:11.5px}',
      '.je-badge{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px}',
      '.je-badge-info{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}',
      '.je-badge-warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}',
      '.je-badge-ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}',
      '.je-badge-muted{background:color-mix(in srgb,var(--muted) 18%,transparent);color:var(--muted)}',
      '.je-badge-danger{background:color-mix(in srgb,var(--danger) 16%,transparent);color:var(--danger)}',
      '.je-overlay{position:fixed;inset:0;z-index:1000;display:flex;justify-content:flex-end}',
      '.je-overlay-bg{position:absolute;inset:0;background:rgba(10,14,30,.45);border:none;padding:0;margin:0}',
      '.je-panel{position:relative;width:100%;max-width:400px;background:var(--card);height:100%;overflow-y:auto;padding:22px 20px;box-shadow:var(--shadow)}',
      '.je-panel-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;font-size:15px}',
      '.je-close{background:transparent;border:none;font-size:16px;cursor:pointer;color:var(--muted)}',
      '.je-label{display:block;font-size:12.5px;font-weight:600;margin:12px 0 5px}',
      '.je-input{width:100%;padding:10px 11px;border:1px solid var(--border);border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box}',
      '.je-input:focus{outline:2px solid var(--accent);outline-offset:1px}',
      '@media (max-width:480px){.je-panel{max-width:100%}}',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ── Utilitaires d'affichage ── */
  function fmtDate(d) {
    if (!d) return null;
    var dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T00:00:00' : d);
    if (isNaN(dt.getTime())) return esc(d);
    return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function ageYears(dateNaissance) {
    if (!dateNaissance) return null;
    var years = (Date.now() - new Date(dateNaissance).getTime()) / (365.25 * 24 * 3600 * 1000);
    return Math.floor(years);
  }
  // club_media.link est un champ libre saisi par un membre du club (formulaire
  // d'import média) : ne jamais le rendre en href sans vérifier le schéma, sinon
  // un lien "javascript:..." s'exécuterait au clic (vol de session via svc_uid/
  // svc_tok) — même faille déjà trouvée et corrigée dans le module Club.
  function isSafeHttpUrl(url) { return typeof url === 'string' && /^https?:\/\//i.test(url); }
  function initials(name) {
    return (name || '?').trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
  }
  function loadingHtml(label) { return '<div class="je-empty">Chargement' + (label ? ' ' + label : '') + '…</div>'; }
  function errorHtml(msg, retryAction) {
    return '<div class="je-empty je-error">' + esc(msg) +
      '<div style="margin-top:10px"><button class="btn btn-ghost" data-je-action="' + retryAction + '">Réessayer</button></div></div>';
  }

  var MATCH_STATUS_META = {
    a_venir: { label: 'À venir', cls: 'je-badge-info' },
    a_transmettre: { label: 'À transmettre', cls: 'je-badge-warn' },
    recu: { label: 'Résultat reçu', cls: 'je-badge-ok' },
  };
  var ACCOUNT_STATUS_META = {
    sans_compte: { label: 'Sans compte', cls: 'je-badge-muted' },
    invite: { label: 'Invité', cls: 'je-badge-warn' },
    en_attente_activation: { label: 'En attente d’activation', cls: 'je-badge-warn' },
    actif: { label: 'Actif', cls: 'je-badge-ok' },
    suspendu: { label: 'Suspendu', cls: 'je-badge-danger' },
    retire: { label: 'Retiré', cls: 'je-badge-muted' },
  };
  var AUTH_STATUS_META = {
    non_transmise: { label: 'Non transmise', cls: 'je-badge-muted' },
    en_attente: { label: 'En attente', cls: 'je-badge-warn' },
    transmise: { label: 'Transmise', cls: 'je-badge-warn' },
    a_verifier: { label: 'À vérifier', cls: 'je-badge-warn' },
    valide: { label: 'Valide', cls: 'je-badge-ok' },
    incomplete: { label: 'Incomplète', cls: 'je-badge-danger' },
    refusee: { label: 'Refusée', cls: 'je-badge-danger' },
    expiree: { label: 'Expirée', cls: 'je-badge-danger' },
    retiree: { label: 'Retirée', cls: 'je-badge-muted' },
    remplacee: { label: 'Remplacée', cls: 'je-badge-muted' },
  };
  var MEDIA_REPORT_MOTIF_LABEL = {
    joueur_present_retrait: 'Je suis présent, retrait souhaité',
    mauvaise_equipe: 'Mauvaise équipe',
    contenu_inapproprie: 'Contenu inapproprié',
    droit_image: "Problème de droit à l'image",
    erreur: 'Erreur',
    autre: 'Autre',
  };

  /* ── Chargements (mis en cache dans state, invalidés après écriture) ── */
  async function loadProfile(playerId, force) {
    if (state.profile !== null && !force) return state.profile;
    state.errorProfile = null;
    var requested = playerId;
    try {
      var res = await sbFetch('player_profiles?id=eq.' + requested +
        '&select=id,prenom,nom,date_naissance,numero_licence,numero_maillot,photo_url,account_status,club_id,' +
        'clubs(id,nom,ville,discipline,saison,logo_url,ecusson_url)&limit=1');
      if (state.playerId !== requested) return state.profile;
      if (!res.ok) throw new Error('http ' + res.status);
      state.profile = (res.data && res.data[0]) || null;
      if (!state.profile) state.errorProfile = 'Profil joueur introuvable.';
    } catch (e) {
      if (state.playerId !== requested) return state.profile;
      state.profile = null;
      state.errorProfile = 'Impossible de charger votre profil. Vérifiez votre connexion.';
    }
    return state.profile;
  }
  async function loadTeams(playerId, force) {
    if (state.teams !== null && !force) return state.teams;
    state.errorTeams = null;
    var requested = playerId;
    try {
      var res = await sbFetch('team_memberships?player_id=eq.' + requested + '&statut=eq.active' +
        '&select=id,saison,club_teams(id,name,categorie,section,coach)&order=created_at.asc');
      if (state.playerId !== requested) return state.teams;
      if (!res.ok) throw new Error('http ' + res.status);
      state.teams = res.data || [];
    } catch (e) {
      if (state.playerId !== requested) return state.teams;
      state.teams = null;
      state.errorTeams = 'Impossible de charger votre équipe.';
    }
    return state.teams;
  }
  // club_matches RLS (migration v16, "cma_family_select") ne rend visibles,
  // pour cette identité, que les matchs dont le champ texte "team" correspond
  // à une équipe où le joueur a un team_memberships actif — filtrage déjà
  // fait côté serveur, la requête club_id suffit.
  async function loadMatches(clubId, force) {
    if (state.matches !== null && !force) return state.matches;
    state.errorMatches = null;
    var requested = clubId;
    try {
      var res = await sbFetch('club_matches?club_id=eq.' + requested + '&select=*&order=match_date.asc.nullslast');
      if ((state.profile && state.profile.club_id) !== requested) return state.matches;
      if (!res.ok) throw new Error('http ' + res.status);
      state.matches = res.data || [];
    } catch (e) {
      if ((state.profile && state.profile.club_id) !== requested) return state.matches;
      state.matches = null;
      state.errorMatches = 'Impossible de charger le calendrier des matchs.';
    }
    return state.matches;
  }
  async function loadEvents(clubId, force) {
    if (state.events !== null && !force) return state.events;
    state.errorEvents = null;
    var requested = clubId;
    try {
      var res = await sbFetch('club_calendar_events?club_id=eq.' + requested + '&select=*&order=event_date.asc');
      if ((state.profile && state.profile.club_id) !== requested) return state.events;
      if (!res.ok) throw new Error('http ' + res.status);
      state.events = res.data || [];
    } catch (e) {
      if ((state.profile && state.profile.club_id) !== requested) return state.events;
      state.events = null;
      state.errorEvents = 'Impossible de charger les événements du club.';
    }
    return state.events;
  }
  // club_media/club_creations : RLS additive "cmd_family_select"/"ccr_family_select"
  // (migration v18, is_media_visible_to_family) fait le filtrage d'autorisation —
  // fail-closed tant que le club n'a pas explicitement publié un média via
  // media_access_rules. expired=eq.false / status=eq.publie ci-dessous ne sont PAS
  // une permission (ça, c'est la RLS) : c'est un filtre d'état, ajouté le 2026-08-06
  // pour rester cohérent avec famille-espace.js (qui les appliquait déjà) — sans ça,
  // un contenu en brouillon ou expiré mais déjà autorisé par media_access_rules
  // restait visible côté Joueur alors qu'il disparaissait côté Famille.
  async function loadMedia(clubId, force) {
    if (state.media !== null && !force) return state.media;
    state.errorMedia = null;
    var requested = clubId;
    try {
      var res = await Promise.all([
        sbFetch('club_media?club_id=eq.' + requested + '&expired=eq.false&select=*&order=created_at.desc'),
        sbFetch('club_creations?club_id=eq.' + requested + '&status=eq.publie&select=*&order=created_at.desc'),
      ]);
      if ((state.profile && state.profile.club_id) !== requested) return state.media;
      var cm = res[0], cc = res[1];
      if (!cm.ok || !cc.ok) throw new Error('http');
      state.media = [
        ...(cm.data || []).map(function (r) { return { id: r.id, refType: 'club_media', title: r.title, team: r.team || '', link: r.link || null, date: (r.created_at || '').slice(0, 10) }; }),
        ...(cc.data || []).map(function (r) { return { id: r.id, refType: 'club_creations', title: r.title, team: r.team || '', link: null, date: (r.created_at || '').slice(0, 10) }; }),
      ].sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    } catch (e) {
      if ((state.profile && state.profile.club_id) !== requested) return state.media;
      state.media = null;
      state.errorMedia = 'Impossible de charger les médias publiés par le club.';
    }
    return state.media;
  }
  async function loadFavorites(playerId, force) {
    if (state.favorites !== null && !force) return state.favorites;
    state.errorFavorites = null;
    var requested = playerId;
    var uid = currentUserId();
    if (!uid) { state.favorites = []; return state.favorites; }
    try {
      var res = await sbFetch('player_favorites?owner_user_id=eq.' + uid + '&player_id=eq.' + requested + '&select=*');
      if (state.playerId !== requested) return state.favorites;
      if (!res.ok) throw new Error('http ' + res.status);
      state.favorites = res.data || [];
    } catch (e) {
      if (state.playerId !== requested) return state.favorites;
      state.favorites = null;
      state.errorFavorites = 'Impossible de charger vos favoris.';
    }
    return state.favorites;
  }
  function isFavorite(refType, refId) {
    return (state.favorites || []).some(function (f) { return f.media_ref_type === refType && f.media_ref_id === refId; });
  }
  async function loadAuthorizations(playerId, force) {
    if (state.authorizations !== null && !force) return state.authorizations;
    state.errorAuthorizations = null;
    var requested = playerId;
    try {
      var res = await sbFetch('parental_authorizations?player_id=eq.' + requested +
        '&select=id,statut,date_debut,date_expiration,authorization_types(code,label,description)&order=created_at.asc');
      if (state.playerId !== requested) return state.authorizations;
      if (!res.ok) throw new Error('http ' + res.status);
      state.authorizations = res.data || [];
    } catch (e) {
      if (state.playerId !== requested) return state.authorizations;
      state.authorizations = null;
      state.errorAuthorizations = 'Impossible de charger vos autorisations.';
    }
    return state.authorizations;
  }

  /* ── Rendu : Accueil ── */
  function accueilAccessNoticeHtml(profile) {
    if (!profile || profile.account_status === 'actif') return '';
    var msg = {
      sans_compte: "Votre fiche joueur n'est pas encore rattachée à un compte actif.",
      invite: 'Votre invitation a été acceptée. Votre accès complet s’ouvrira dès validation par le club.',
      en_attente_activation: "Votre demande est en cours de vérification par le club. L'accès complet s'ouvrira dès que votre autorisation parentale sera validée.",
      suspendu: 'Votre accès a été suspendu par le club. Contactez votre club pour plus d’informations.',
      retire: 'Votre accès a été retiré. Contactez votre club pour plus d’informations.',
    }[profile.account_status] || "Votre accès n'est pas encore pleinement actif.";
    return '<div class="je-notice' + (profile.account_status === 'suspendu' || profile.account_status === 'retire' ? ' je-danger' : '') + '">' + esc(msg) + '</div>';
  }
  function accueilHtml() {
    var profile = state.profile;
    if (!profile) return '';
    var club = profile.clubs || {};
    var teams = state.teams || [];
    var teamNames = teams.map(function (t) { return t.club_teams && t.club_teams.name; }).filter(Boolean);
    var today = new Date().toISOString().slice(0, 10);
    var nextMatch = (state.matches || []).filter(function (m) { return m.status === 'a_venir'; })
      .sort(function (a, b) { return (a.match_date || '').localeCompare(b.match_date || ''); })[0];
    var nextEvent = (state.events || []).filter(function (e) { return e.event_date >= today; })
      .sort(function (a, b) { return (a.event_date || '').localeCompare(b.event_date || ''); })[0];
    var age = ageYears(profile.date_naissance);
    var asMeta = ACCOUNT_STATUS_META[profile.account_status] || { label: profile.account_status || '—', cls: 'je-badge-muted' };

    return '<div class="je-wrap">' +
      accueilAccessNoticeHtml(profile) +
      '<div class="je-card">' +
      '<div class="je-profile-head">' +
      '<div class="je-avatar"' + (profile.photo_url ? ' style="background-image:url(\'' + esc(profile.photo_url) + '\')"' : '') + '>' +
      (profile.photo_url ? '' : esc(initials((profile.prenom || '') + ' ' + (profile.nom || '')))) +
      '</div>' +
      '<div>' +
      '<div class="je-h2"><b>' + esc(profile.prenom || '') + ' ' + esc(profile.nom || '') + '</b></div>' +
      '<div class="je-muted">' + esc(club.nom || 'Club non renseigné') + (age != null ? ' · ' + age + ' ans' : '') + '</div>' +
      '</div>' +
      '</div>' +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<span class="je-badge ' + asMeta.cls + '">' + esc(asMeta.label) + '</span>' +
      (profile.numero_licence ? '<span class="je-muted">Licence ' + esc(profile.numero_licence) + '</span>' : '') +
      (profile.numero_maillot ? '<span class="je-muted">Maillot n°' + esc(profile.numero_maillot) + '</span>' : '') +
      '</div>' +
      '<div class="je-muted" style="margin-top:10px">' + (teamNames.length ? esc(teamNames.join(', ')) : 'Aucune équipe rattachée pour le moment') + '</div>' +
      '</div>' +
      '<div class="je-grid2">' +
      '<div class="je-card"><div class="je-kicker">Prochain match</div>' +
      (nextMatch
        ? '<div class="je-row-title">' + esc(nextMatch.team) + ' vs ' + esc(nextMatch.opponent) + '</div><div class="je-row-sub">' + (fmtDate(nextMatch.match_date) || 'Date à confirmer') + (nextMatch.lieu ? ' · ' + esc(nextMatch.lieu) : '') + '</div>'
        : '<div class="je-muted">Aucun match à venir programmé.</div>') +
      '</div>' +
      '<div class="je-card"><div class="je-kicker">Prochain événement</div>' +
      (nextEvent
        ? '<div class="je-row-title">' + esc(nextEvent.title) + '</div><div class="je-row-sub">' + (fmtDate(nextEvent.event_date) || '') + '</div>'
        : '<div class="je-muted">Aucun événement à venir.</div>') +
      '</div>' +
      '</div>' +
      '<div class="je-card"><div class="je-kicker">Médias &amp; favoris</div>' +
      '<div class="je-muted">Consultez l’onglet « Médias &amp; Favoris » pour les photos et vidéos publiées par votre club, et l’onglet « Droits à l’image » pour le statut de vos autorisations.</div>' +
      '</div>' +
      '</div>';
  }
  async function renderAccueil(container) {
    var body = container.querySelector('.je-body') || container;
    if (state.profile === null && !state.errorProfile) {
      body.innerHTML = loadingHtml('votre profil');
      await loadProfile(state.playerId);
      if (!container.isConnected) return;
    }
    if (state.errorProfile) { body.innerHTML = errorHtml(state.errorProfile, 'retry-profile'); return; }
    var clubId = state.profile.club_id;
    if (state.teams === null && !state.errorTeams) await loadTeams(state.playerId);
    if (state.matches === null && !state.errorMatches) await loadMatches(clubId);
    if (state.events === null && !state.errorEvents) await loadEvents(clubId);
    if (!container.isConnected) return;
    body.innerHTML = accueilHtml();
  }

  /* ── Rendu : Calendrier ── */
  function matchRowHtml(m) {
    var sm = MATCH_STATUS_META[m.status] || { label: m.status || '—', cls: 'je-badge-info' };
    return '<div class="je-row">' +
      '<div><div class="je-row-title">' + esc(m.team) + ' vs ' + esc(m.opponent) + '</div>' +
      '<div class="je-row-sub">' + (fmtDate(m.match_date) || 'Date à confirmer') + (m.lieu ? ' · ' + esc(m.lieu) : '') + '</div></div>' +
      (m.score ? '<b>' + esc(m.score) + '</b>' : '<span class="je-badge ' + sm.cls + '">' + esc(sm.label) + '</span>') +
      '</div>';
  }
  function eventRowHtml(e) {
    return '<div class="je-row">' +
      '<div><div class="je-row-title">' + esc(e.title) + '</div>' +
      '<div class="je-row-sub">' + (fmtDate(e.event_date) || '') + (e.team ? ' · ' + esc(e.team) : '') + '</div></div>' +
      '<span class="je-badge je-badge-info">' + esc(e.type || '') + '</span>' +
      '</div>';
  }
  function calendrierHtml() {
    var matches = state.matches || [];
    var events = state.events || [];
    var matchesHtml = matches.length
      ? '<div class="je-list">' + matches.map(matchRowHtml).join('') + '</div>'
      : '<div class="je-empty">Aucun match programmé pour votre équipe pour le moment.</div>';
    var eventsHtml = events.length
      ? '<div class="je-list">' + events.map(eventRowHtml).join('') + '</div>'
      : '<div class="je-empty">Aucun événement de club programmé pour le moment.</div>';
    return '<div class="je-wrap">' +
      '<div><h3 class="je-section-title">Matchs de votre équipe</h3>' + matchesHtml + '</div>' +
      '<div><h3 class="je-section-title">Événements du club</h3>' + eventsHtml + '</div>' +
      '</div>';
  }
  async function renderCalendrier(container) {
    var body = container.querySelector('.je-body') || container;
    if (state.profile === null && !state.errorProfile) {
      body.innerHTML = loadingHtml();
      await loadProfile(state.playerId);
      if (!container.isConnected) return;
    }
    if (state.errorProfile) { body.innerHTML = errorHtml(state.errorProfile, 'retry-profile'); return; }
    var clubId = state.profile.club_id;
    if (state.matches === null && !state.errorMatches) {
      body.innerHTML = loadingHtml('le calendrier');
      await loadMatches(clubId);
      if (!container.isConnected) return;
    }
    if (state.errorMatches) { body.innerHTML = errorHtml(state.errorMatches, 'retry-matches'); return; }
    if (state.events === null && !state.errorEvents) await loadEvents(clubId);
    if (!container.isConnected) return;
    body.innerHTML = calendrierHtml();
  }

  /* ── Rendu : Médias & Favoris ── */
  function mediaTileHtml(m) {
    var fav = isFavorite(m.refType, m.id);
    return '<div class="je-tile">' +
      '<div class="je-tile-actions">' +
      '<button class="je-icon-btn" data-je-action="open-report" data-ref-type="' + esc(m.refType) + '" data-ref-id="' + esc(m.id) + '" title="Signaler">⚑</button>' +
      '<button class="je-icon-btn" data-je-action="toggle-fav" data-ref-type="' + esc(m.refType) + '" data-ref-id="' + esc(m.id) + '" title="Favori">' + (fav ? '★' : '☆') + '</button>' +
      '</div>' +
      '<div class="je-tile-thumb">' + esc(m.title) + '</div>' +
      '<div class="je-tile-body">' +
      '<div class="je-tile-title">' + esc(m.title) + '</div>' +
      '<div class="je-tile-sub">' + esc(m.team || 'Équipe non précisée') + (m.date ? ' · ' + esc(m.date) : '') + '</div>' +
      (isSafeHttpUrl(m.link) ? '<a class="je-tile-open" href="' + esc(m.link) + '" target="_blank" rel="noopener noreferrer">Ouvrir →</a>' : '') +
      '</div></div>';
  }
  function mediasHtml() {
    var all = state.media || [];
    var items = state.mediaTab === 'favoris' ? all.filter(function (m) { return isFavorite(m.refType, m.id); }) : all;
    var grid = items.length
      ? '<div class="je-tilegrid">' + items.map(mediaTileHtml).join('') + '</div>'
      : '<div class="je-empty">' + (state.mediaTab === 'favoris'
        ? 'Aucun favori pour le moment — ajoutez-en avec l’étoile sur un média.'
        : 'Les photos et vidéos de votre équipe apparaîtront ici dès que le club les aura publiées vers l’Espace Joueur.') + '</div>';
    return '<div class="je-wrap">' +
      '<div class="je-pillbar">' +
      '<button class="je-pill' + (state.mediaTab === 'tous' ? ' on' : '') + '" data-je-action="media-tab" data-tab="tous">Tous</button>' +
      '<button class="je-pill' + (state.mediaTab === 'favoris' ? ' on' : '') + '" data-je-action="media-tab" data-tab="favoris">Mes favoris</button>' +
      '</div>' + grid + '</div>';
  }
  async function renderMedias(container) {
    var body = container.querySelector('.je-body') || container;
    if (state.profile === null && !state.errorProfile) {
      body.innerHTML = loadingHtml();
      await loadProfile(state.playerId);
      if (!container.isConnected) return;
    }
    if (state.errorProfile) { body.innerHTML = errorHtml(state.errorProfile, 'retry-profile'); return; }
    var clubId = state.profile.club_id;
    if (state.media === null && !state.errorMedia) {
      body.innerHTML = loadingHtml('les médias');
      await loadMedia(clubId);
      if (!container.isConnected) return;
    }
    if (state.errorMedia) { body.innerHTML = errorHtml(state.errorMedia, 'retry-media'); return; }
    if (state.favorites === null && !state.errorFavorites) await loadFavorites(state.playerId);
    if (!container.isConnected) return;
    body.innerHTML = mediasHtml();
  }

  /* ── Rendu : Droits à l'image ── */
  function authRowHtml(a) {
    var meta = AUTH_STATUS_META[a.statut] || { label: a.statut || '—', cls: 'je-badge-muted' };
    var t = a.authorization_types || {};
    return '<div class="je-row" style="align-items:flex-start">' +
      '<div><div class="je-row-title">' + esc(t.label || 'Autorisation') + '</div>' +
      (t.description ? '<div class="je-row-sub">' + esc(t.description) + '</div>' : '') +
      (a.date_expiration ? '<div class="je-row-sub">Expire le ' + (fmtDate(a.date_expiration) || esc(a.date_expiration)) + '</div>' : '') +
      '</div>' +
      '<span class="je-badge ' + meta.cls + '">' + esc(meta.label) + '</span>' +
      '</div>';
  }
  function droitsHtml() {
    var auths = state.authorizations || [];
    var authsHtml = auths.length
      ? '<div class="je-list">' + auths.map(authRowHtml).join('') + '</div>'
      : '<div class="je-empty">Aucune autorisation enregistrée pour le moment.</div>';
    var media = state.media || [];
    var reportItems = media.length
      ? '<div class="je-list">' + media.map(function (m) {
        return '<div class="je-row"><div><div class="je-row-title">' + esc(m.title) + '</div>' +
          '<div class="je-row-sub">' + esc(m.team || '') + (m.date ? ' · ' + esc(m.date) : '') + '</div></div>' +
          '<button class="btn btn-ghost" data-je-action="open-report" data-ref-type="' + esc(m.refType) + '" data-ref-id="' + esc(m.id) + '">Demander un retrait</button>' +
          '</div>';
      }).join('') + '</div>'
      : '<div class="je-empty">Aucun média publié par le club pour le moment.</div>';
    return '<div class="je-wrap">' +
      '<div><h3 class="je-section-title">Statut de vos autorisations</h3>' +
      '<div class="je-muted" style="margin:4px 0 10px">Ces autorisations sont transmises par votre parent ou représentant légal. Contactez votre club pour toute question.</div>' +
      authsHtml + '</div>' +
      '<div><h3 class="je-section-title">Demander le retrait d’un média</h3>' +
      '<div class="je-muted" style="margin:4px 0 10px">Si vous apparaissez sur un média que vous ne souhaitez pas voir diffusé, signalez-le au club — il reste visible tant qu’un administrateur n’a pas traité votre demande.</div>' +
      reportItems + '</div>' +
      '</div>';
  }
  async function renderDroits(container) {
    var body = container.querySelector('.je-body') || container;
    if (state.profile === null && !state.errorProfile) {
      body.innerHTML = loadingHtml();
      await loadProfile(state.playerId);
      if (!container.isConnected) return;
    }
    if (state.errorProfile) { body.innerHTML = errorHtml(state.errorProfile, 'retry-profile'); return; }
    if (state.authorizations === null && !state.errorAuthorizations) {
      body.innerHTML = loadingHtml('vos autorisations');
      await loadAuthorizations(state.playerId);
      if (!container.isConnected) return;
    }
    if (state.errorAuthorizations) { body.innerHTML = errorHtml(state.errorAuthorizations, 'retry-auth'); return; }
    if (state.media === null && !state.errorMedia) await loadMedia(state.profile.club_id);
    if (!container.isConnected) return;
    body.innerHTML = droitsHtml();
  }

  /* ── Overlay signalement (partagé Médias & Droits) ── */
  function openOverlay(container, html) {
    closeOverlay(container);
    var ov = document.createElement('div');
    ov.setAttribute('data-je-overlay', '1');
    ov.className = 'je-overlay';
    ov.innerHTML = '<button class="je-overlay-bg" data-je-action="close-overlay" aria-label="Fermer"></button>' +
      '<div class="je-panel">' + html + '</div>';
    container.appendChild(ov);
  }
  function closeOverlay(container) {
    var olds = container.querySelectorAll('[data-je-overlay]');
    olds.forEach(function (el) { el.remove(); });
  }
  function reportFormHtml(refType, refId) {
    var options = Object.keys(MEDIA_REPORT_MOTIF_LABEL).map(function (k) {
      return '<option value="' + k + '">' + esc(MEDIA_REPORT_MOTIF_LABEL[k]) + '</option>';
    }).join('');
    return '<div class="je-panel-head"><b>Signaler ce contenu</b><button class="je-close" data-je-action="close-overlay">✕</button></div>' +
      '<label class="je-label">Motif<select class="je-input" data-je-field="motif">' + options + '</select></label>' +
      '<label class="je-label">Message (optionnel)<textarea class="je-input" rows="3" data-je-field="message"></textarea></label>' +
      '<button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:14px" data-je-action="submit-report" data-ref-type="' + esc(refType) + '" data-ref-id="' + esc(refId) + '">Envoyer le signalement</button>';
  }

  /* ── Actions serveur ── */
  async function toggleFavorite(container, refType, refId) {
    var uid = currentUserId();
    if (!uid) { toast('Session invalide, reconnectez-vous.'); return; }
    var existing = (state.favorites || []).find(function (f) { return f.media_ref_type === refType && f.media_ref_id === refId; });
    var res = existing
      ? await sbFetch('player_favorites?id=eq.' + existing.id, { method: 'DELETE' })
      : await sbFetch('player_favorites', { method: 'POST', body: { owner_user_id: uid, player_id: state.playerId, media_ref_type: refType, media_ref_id: refId } });
    if (!res.ok) { toast('Action impossible.'); return; }
    await loadFavorites(state.playerId, true);
    if (!container.isConnected) return;
    var body = container.querySelector('.je-body') || container;
    body.innerHTML = mediasHtml();
  }
  async function submitReport(container, refType, refId, motif, message) {
    if (!state.profile) { toast('Profil non chargé.'); return; }
    var res = await sbFetch('media_reports', {
      method: 'POST',
      body: {
        club_id: state.profile.club_id,
        media_ref_type: refType,
        media_ref_id: refId,
        reported_by: currentUserId(),
        player_concerned_id: state.playerId,
        motif: motif,
        message: message || null,
      },
    });
    if (!res.ok) { toast("Erreur lors de l'envoi du signalement."); return; }
    closeOverlay(container);
    toast('Signalement transmis au club.');
  }

  /* ── Délégation d'événements — un seul container.onclick par montage,
   * remplacé (pas cumulé) à chaque render(), conformément à la consigne
   * d'intégration de ce module. ── */
  function bindContainer(container, entry) {
    container.onclick = function (e) {
      var pill = e.target.closest('[data-je-action="media-tab"]');
      if (pill && container.contains(pill)) {
        state.mediaTab = pill.getAttribute('data-tab');
        var body = container.querySelector('.je-body') || container;
        body.innerHTML = mediasHtml();
        return;
      }
      var el = e.target.closest('[data-je-action]');
      if (!el || !container.contains(el)) return;
      var action = el.getAttribute('data-je-action');
      switch (action) {
        case 'retry-profile': loadProfile(state.playerId, true).then(function () { renderEntry(entry, container); }); break;
        case 'retry-matches': loadMatches(state.profile ? state.profile.club_id : null, true).then(function () { renderEntry(entry, container); }); break;
        case 'retry-media': loadMedia(state.profile ? state.profile.club_id : null, true).then(function () { renderEntry(entry, container); }); break;
        case 'retry-auth': loadAuthorizations(state.playerId, true).then(function () { renderEntry(entry, container); }); break;
        case 'toggle-fav':
          toggleFavorite(container, el.getAttribute('data-ref-type'), el.getAttribute('data-ref-id'));
          break;
        case 'open-report':
          openOverlay(container, reportFormHtml(el.getAttribute('data-ref-type'), el.getAttribute('data-ref-id')));
          break;
        case 'submit-report': {
          var panel = el.closest('.je-panel');
          var motifEl = panel && panel.querySelector('[data-je-field="motif"]');
          var msgEl = panel && panel.querySelector('[data-je-field="message"]');
          submitReport(container, el.getAttribute('data-ref-type'), el.getAttribute('data-ref-id'),
            motifEl ? motifEl.value : 'autre', msgEl ? msgEl.value.trim() : '');
          break;
        }
        case 'close-overlay': closeOverlay(container); break;
      }
    };
  }

  /* ── Rendu générique d'un onglet (shell fixe : zone .je-body) ── */
  var ENTRY_RENDERERS = {
    accueil: renderAccueil,
    calendrier: renderCalendrier,
    medias: renderMedias,
    droits: renderDroits,
  };
  function renderShell(container) {
    container.innerHTML = '<div class="je-body">' + loadingHtml() + '</div>';
  }
  async function renderEntry(entry, container) {
    await ENTRY_RENDERERS[entry](container);
  }

  /* ── Point d'entrée contractuel commun aux 4 onglets ── */
  async function mount(entry, container, contextId, ctx) {
    ensureStyles();
    resetCacheIfPlayerChanged(contextId);
    state.role = (ctx && ctx.role) || '';
    state.container = container;

    renderShell(container);
    bindContainer(container, entry);
    await renderEntry(entry, container);
  }

  window.JoueurModules = window.JoueurModules || {};
  window.JoueurModules.accueil = {
    label: 'Accueil', espace: 'joueur',
    render: function (container, contextId, ctx) { return mount('accueil', container, contextId, ctx); },
  };
  window.JoueurModules.calendrier = {
    label: 'Calendrier', espace: 'joueur',
    render: function (container, contextId, ctx) { return mount('calendrier', container, contextId, ctx); },
  };
  window.JoueurModules.medias = {
    label: 'Médias & Favoris', espace: 'joueur',
    render: function (container, contextId, ctx) { return mount('medias', container, contextId, ctx); },
  };
  window.JoueurModules.droits = {
    label: 'Droits à l\'image', espace: 'joueur',
    render: function (container, contextId, ctx) { return mount('droits', container, contextId, ctx); },
  };
})();
