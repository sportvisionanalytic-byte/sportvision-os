/* ============================================================
 * SportVision Connect — Module "Calendrier"
 * ------------------------------------------------------------
 * Portage autonome de la fonctionnalité "Calendrier" de SportVision
 * Club+ (app.html, lecture seule, référence uniquement — jamais
 * modifié : tplCalendrier() + monthGrid() + openDayDrawer() +
 * openAddEvent() + submitAddEvent(), section CALENDRIER lignes
 * 1205-1274) vers le nouveau socle Connect (organizations /
 * entitlements).
 *
 * Tables lues/écrites (déjà existantes, aucune migration créée) :
 *   - club_calendar_events (migration-clubplus-v4.sql) — select/insert.
 *     Colonnes réellement vérifiées via l'API REST Supabase (OpenAPI +
 *     GET) : id (uuid, pk), club_id (uuid, fk clubs.id), event_date
 *     (date), type (text, défaut 'contenu'), title (text), team (text,
 *     nullable), created_by (uuid, nullable), created_at. Aucune colonne
 *     supplémentaire (pas de description/lieu/heure/end_date). RLS :
 *     select + insert réservés aux membres actifs du club
 *     (is_club_member), delete réservé aux admins (is_club_admin) —
 *     AUCUNE policy update n'existe : la modification d'un événement
 *     n'est donc pas possible côté backend, ce qui explique pourquoi
 *     Club+ n'offre pas non plus d'écran d'édition. On ne l'invente pas
 *     ici. Club+ n'expose pas non plus de suppression dans son UI bien
 *     que la policy admin existe déjà côté RLS — non porté, pour rester
 *     fidèle au périmètre réel de Club+ (voir rapport de l'agent).
 *   - club_teams (migration-clubplus-v5.sql) — select uniquement (id,
 *     name), pour les pastilles de filtre par équipe et le sélecteur
 *     d'équipe du formulaire d'ajout, comme teamNames() dans Club+.
 *
 * Périmètre vérifié dans Club+ : tplCalendrier() n'agrège PAS
 * club_matches — elle affiche exclusivement club_calendar_events
 * (source = REAL ? realEvents : DATA.calEvents, réalimenté par
 * loadRealEvents() qui ne requête que club_calendar_events). Même
 * périmètre repris ici, à l'identique.
 *
 * orgId reçu par render() = organizations.id = clubs.id (même UUID,
 * cf. migration-connect-v2-organizations-entitlements.sql) donc utilisé
 * directement comme club_id dans les requêtes, sans traduction.
 *
 * ctx.role = memberships.role, qui reprend tel quel club_members.role
 * (cf. migration-connect-v10-club-members-membership-sync.sql, trigger
 * de synchronisation qui recopie club_members.role sans transformation).
 * Autorisation d'ajout d'événement : Club+ n'utilise PAS de restriction
 * par rôle "admin uniquement" ici — guard(()=>openAddEvent(iso)) est
 * appelé SANS permKey, ce qui ne bloque que le rôle 'lecture_seule'
 * (cf. guard() dans Club+, ligne ~481-489 : seul ce rôle est rejeté
 * côté client quand aucun permKey n'est fourni). Le port ci-dessous
 * reproduit exactement cette règle (canAdd()), plutôt que la règle plus
 * restrictive "admin/dirigeant/président/owner" du module Équipes &
 * Matchs — celle-ci ne s'applique pas à cette fonctionnalité dans
 * Club+. La RLS (is_club_member) reste de toute façon l'arbitre final.
 *
 * Dépendances globales fournies par le shell (index.html), non
 * redéfinies ici : sbFetch, esc, toast. Variables CSS réutilisées :
 * --card, --border, --radius, --shadow, --accent, --accent-2, --purple,
 * --muted, --text, --ok, --warn, --danger. Classes réutilisées : .btn,
 * .btn-primary, .btn-ghost.
 *
 * Le module est un IIFE : tout l'état vit dans une closure locale,
 * jamais sur window, à l'exception du point d'entrée contractuel
 * window.ClubModules.calendrier.
 *
 * ── Divergences volontaires par rapport à Club+ (détaillées dans le
 *    rapport de l'agent) ──
 *   1. Navigation mois précédent/suivant + bouton "Aujourd'hui" ajoutés
 *      en vue Mois. Club+ affichait un mois strictement figé (toujours
 *      "Août 2026", codé en dur avec monthGrid(2026,7,...) et une date
 *      du jour figée '2026-07-28') puisque c'était une maquette de
 *      démo gelée à une date fixe. En production sur Connect il n'y a
 *      pas de date figée : le mois affiché est calculé dynamiquement à
 *      partir de la date réelle, et la navigation ne coûte aucun aller-
 *      retour réseau supplémentaire (tous les événements du club sont
 *      déjà chargés en mémoire, comme dans Club+).
 *   2. Calcul de date locale (Y-M-D à partir de getFullYear/getMonth/
 *      getDate) au lieu de dt.toISOString().slice(0,10) utilisé par
 *      Club+ — ce dernier convertit en UTC et peut décaler la date
 *      affichée d'un jour pour un fuseau horaire positif comme la
 *      France. Correction de fidélité fonctionnelle, pas un changement
 *      de périmètre.
 *   3. Nombre de semaines de la grille calculé dynamiquement (5 ou 6
 *      selon le mois) au lieu des 5 lignes fixes de Club+, qui pouvait
 *      tronquer les derniers jours de certains mois.
 * ============================================================ */
(function () {
  'use strict';

  /* ── État interne (une seule organisation "montée" à la fois) ── */
  var state = {
    orgId: null,
    role: '',
    container: null,
    view: 'mois',          // 'mois' | 'agenda'
    filterTeam: 'toutes',
    filterType: 'tous',
    gridYear: null,
    gridMonth: null,       // 1-indexé (1 = janvier)
    events: null,          // null = pas encore chargé, [] = chargé et vide
    teams: null,
    errorEvents: null,
    errorTeams: null,
  };

  /* ── Permissions d'affichage uniquement (RLS = source de vérité) ──
   * Reproduit guard(fn) sans permKey dans Club+ : seul le rôle
   * 'lecture_seule' est bloqué, tous les autres rôles peuvent ajouter
   * un événement (is_club_member l'autorise de toute façon côté RLS).
   */
  function canAdd(role) {
    return (role || '').toLowerCase() !== 'lecture_seule';
  }

  /* ── Types d'événements (mêmes 6 valeurs que la contrainte CHECK de
   * club_calendar_events et que Club+) ── */
  var FILTER_TYPES = [
    ['tous', 'Tous les types'],
    ['match', 'Matchs'],
    ['contenu', 'Contenus'],
    ['sponsor', 'Sponsors'],
    ['prestation', 'Prestations'],
    ['entrainement', 'Entraînements'],
    ['tournoi', 'Tournois'],
  ];
  var FORM_TYPES = [
    ['match', 'Match'],
    ['entrainement', 'Entraînement important'],
    ['tournoi', 'Tournoi'],
    ['contenu', 'Contenu à préparer'],
    ['sponsor', 'Échéance sponsor'],
    ['prestation', 'Prestation SportVision'],
  ];
  var TYPE_CSS = {
    match: 'var(--accent)',
    entrainement: 'var(--muted)',
    tournoi: 'var(--purple)',
    contenu: 'var(--accent-2)',
    sponsor: 'var(--warn)',
    prestation: 'var(--ok)',
  };
  function typeColor(type) { return TYPE_CSS[type] || 'var(--muted)'; }
  function typeLabel(type) {
    for (var i = 0; i < FORM_TYPES.length; i++) { if (FORM_TYPES[i][0] === type) return FORM_TYPES[i][1]; }
    return type || '—';
  }

  /* ── Styles scopés (préfixe ccal-), injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('ccal-styles')) return;
    var style = document.createElement('style');
    style.id = 'ccal-styles';
    style.textContent = [
      '.ccal-wrap{display:flex;flex-direction:column;gap:16px}',
      '.ccal-head{display:flex;justify-content:space-between;align-items:center;gap:10px}',
      '.ccal-tabbar{display:flex;gap:18px;border-bottom:1px solid var(--border);padding-bottom:0}',
      '.ccal-tabbtn{background:transparent;border:none;padding:10px 2px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent}',
      '.ccal-tabbtn.on{color:var(--accent);border-bottom-color:var(--accent)}',
      '.ccal-pillbar{display:flex;gap:8px;flex-wrap:wrap}',
      '.ccal-pill{background:var(--card);border:1px solid var(--border);border-radius:999px;padding:6px 14px;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer}',
      '.ccal-pill:not(.on):hover{border-color:var(--accent);color:var(--text)}',
      '.ccal-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}',
      '.ccal-month-head{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:10px}',
      '.ccal-month-label{font-size:14.5px;font-weight:700;min-width:150px;text-align:center;text-transform:capitalize}',
      '.ccal-navbtn{background:var(--card);border:1px solid var(--border);border-radius:8px;width:32px;height:32px;font-size:15px;color:var(--text);cursor:pointer}',
      '.ccal-navbtn:hover{border-color:var(--accent)}',
      '.ccal-todaybtn{background:transparent;border:1px solid var(--border);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer}',
      '.ccal-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px}',
      '.ccal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px}',
      '.ccal-weekday{text-align:center;font-size:11px;font-weight:700;color:var(--muted)}',
      '.ccal-week{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px}',
      '.ccal-day{background:transparent;border:1px solid var(--border);border-radius:10px;padding:6px;min-height:64px;text-align:left;cursor:pointer;font:inherit;color:inherit;display:flex;flex-direction:column;gap:3px}',
      '.ccal-day:hover{border-color:var(--accent)}',
      '.ccal-day.out{opacity:.4}',
      '.ccal-day.today{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}',
      '.ccal-day-num{font-size:11px;font-weight:700}',
      '.ccal-day-ev{font-size:10px;padding:2px 5px;border-radius:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ccal-day-more{font-size:10px;color:var(--muted)}',
      '.ccal-list{display:flex;flex-direction:column;gap:8px}',
      '.ccal-row{display:flex;gap:10px;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px}',
      '.ccal-tile{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0}',
      '.ccal-row-title{font-weight:600;font-size:13px}',
      '.ccal-row-sub{font-size:11.5px;color:var(--muted)}',
      '.ccal-muted{color:var(--muted);font-size:13px}',
      '.ccal-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}',
      '.ccal-error{color:var(--danger)}',
      '.ccal-overlay{position:fixed;inset:0;z-index:1000;display:flex;justify-content:flex-end}',
      '.ccal-overlay-bg{position:absolute;inset:0;background:rgba(10,14,30,.45);border:none;padding:0;margin:0}',
      '.ccal-panel{position:relative;width:100%;max-width:420px;background:var(--card);height:100%;overflow-y:auto;padding:24px 22px;box-shadow:var(--shadow)}',
      '.ccal-panel-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;font-size:16px}',
      '.ccal-close{background:transparent;border:none;font-size:16px;cursor:pointer;color:var(--muted)}',
      '.ccal-event-card{background:var(--bg,var(--card));border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px;display:flex;gap:8px;align-items:center}',
      '.ccal-label{display:block;font-size:12.5px;font-weight:600;margin:12px 0 5px;color:var(--text)}',
      '.ccal-input{width:100%;padding:10px 11px;border:1px solid var(--border);border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box;background:var(--card);color:var(--text)}',
      '.ccal-input:focus{outline:2px solid var(--accent);outline-offset:1px}',
      '@media (max-width:480px){.ccal-panel{max-width:100%}}',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ── Utilitaires ── */
  function fmtDate(iso) {
    if (!iso) return 'Date à confirmer';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  // Date locale Y-M-D, volontairement PAS toISOString() (qui convertit en
  // UTC et peut décaler le jour affiché pour un fuseau positif comme la
  // France) — cf. divergence n°2 documentée en tête de fichier.
  function isoDate(d) {
    var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function monthLabel(year, month1) {
    var d = new Date(year, month1 - 1, 1);
    var label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  function loadingHtml(label) { return '<div class="ccal-empty">Chargement ' + label + '…</div>'; }
  function errorHtml(msg, retryAction) {
    return '<div class="ccal-empty ccal-error">' + esc(msg) +
      '<div style="margin-top:10px"><button class="btn btn-ghost" data-ccal-action="' + retryAction + '">Réessayer</button></div></div>';
  }

  /* ── Chargement des données (mis en cache dans state, invalidé après écriture) ── */
  async function loadEvents(force) {
    if (state.events !== null && !force) return state.events;
    state.errorEvents = null;
    var requestedOrg = state.orgId; // pour ignorer une réponse tardive si l'org a changé entre-temps
    try {
      var res = await sbFetch('club_calendar_events?select=id,event_date,type,title,team&club_id=eq.' + requestedOrg + '&order=event_date.asc');
      if (state.orgId !== requestedOrg) return state.events; // org changée pendant le fetch : réponse obsolète, ignorée
      if (!res.ok) throw new Error('http ' + res.status);
      state.events = (res.data || []).map(function (r) {
        return { id: r.id, date: r.event_date, type: r.type, title: r.title, team: r.team || '' };
      });
    } catch (e) {
      if (state.orgId !== requestedOrg) return state.events;
      state.events = null;
      state.errorEvents = 'Impossible de charger le calendrier. Vérifiez votre connexion.';
    }
    return state.events;
  }
  async function loadTeams(force) {
    if (state.teams !== null && !force) return state.teams;
    state.errorTeams = null;
    var requestedOrg = state.orgId;
    try {
      var res = await sbFetch('club_teams?select=id,name&club_id=eq.' + requestedOrg + '&order=created_at.asc');
      if (state.orgId !== requestedOrg) return state.teams;
      if (!res.ok) throw new Error('http ' + res.status);
      state.teams = (res.data || []).map(function (t) { return t.name; }).filter(Boolean);
    } catch (e) {
      if (state.orgId !== requestedOrg) return state.teams;
      state.teams = [];
      state.errorTeams = 'Impossible de charger les équipes.';
    }
    return state.teams;
  }

  /* ── Filtrage (mêmes règles que filtered= dans Club+) ── */
  function filteredEvents() {
    var evs = state.events || [];
    var team = state.filterTeam, type = state.filterType;
    return evs.filter(function (e) {
      return (team === 'toutes' || e.team === team || !e.team) && (type === 'tous' || e.type === type);
    });
  }

  /* ── Grille du mois (semaines calculées dynamiquement, cf. divergence n°3) ── */
  function buildMonthGrid(year, month1, events, todayIso) {
    var first = new Date(year, month1 - 1, 1);
    var startWd = (first.getDay() + 6) % 7; // lundi = 0
    var daysInMonth = new Date(year, month1, 0).getDate();
    var weeksCount = Math.ceil((startWd + daysInMonth) / 7);
    var weeks = [];
    var day = 1 - startWd;
    for (var w = 0; w < weeksCount; w++) {
      var week = [];
      for (var d = 0; d < 7; d++) {
        var dt = new Date(year, month1 - 1, day);
        var iso = isoDate(dt);
        week.push({
          label: String(dt.getDate()), iso: iso, inMonth: dt.getMonth() === month1 - 1,
          today: iso === todayIso,
          events: events.filter(function (e) { return e.date === iso; }),
        });
        day++;
      }
      weeks.push(week);
    }
    return weeks;
  }

  /* ── Rendu : vue Mois ── */
  function monthViewHtml() {
    var todayIso = isoDate(new Date());
    var weeks = buildMonthGrid(state.gridYear, state.gridMonth, filteredEvents(), todayIso);
    var weekdayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    var head = '<div class="ccal-month-head">' +
      '<button class="ccal-navbtn" data-ccal-action="prev-month" aria-label="Mois précédent">‹</button>' +
      '<span class="ccal-month-label">' + esc(monthLabel(state.gridYear, state.gridMonth)) + '</span>' +
      '<button class="ccal-navbtn" data-ccal-action="next-month" aria-label="Mois suivant">›</button>' +
      '<button class="ccal-todaybtn" data-ccal-action="today-month">Aujourd\'hui</button>' +
      '</div>';
    var weekdaysRow = '<div class="ccal-weekdays">' + weekdayNames.map(function (w) { return '<div class="ccal-weekday">' + w + '</div>'; }).join('') + '</div>';
    var weeksHtml = weeks.map(function (week) {
      return '<div class="ccal-week">' + week.map(function (day) {
        var evChips = day.events.slice(0, 2).map(function (ev) {
          return '<div class="ccal-day-ev" style="background:color-mix(in srgb,' + typeColor(ev.type) + ' 18%,transparent);color:' + typeColor(ev.type) + '">' + esc(ev.title) + '</div>';
        }).join('');
        var more = day.events.length > 2 ? '<div class="ccal-day-more">+' + (day.events.length - 2) + '</div>' : '';
        return '<button class="ccal-day' + (day.inMonth ? '' : ' out') + (day.today ? ' today' : '') + '" data-ccal-action="open-day" data-iso="' + day.iso + '">' +
          '<div class="ccal-day-num">' + day.label + '</div>' + evChips + more + '</button>';
      }).join('') + '</div>';
    }).join('');
    return head + '<div class="ccal-card">' + weekdaysRow + weeksHtml + '</div>';
  }

  /* ── Rendu : vue Agenda (liste chronologique, pas de filtre par mois — comme Club+) ── */
  function agendaViewHtml() {
    var evs = filteredEvents().slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    if (!evs.length) return '<div class="ccal-empty">Aucun événement pour ces filtres.</div>';
    return '<div class="ccal-list">' + evs.map(function (e) {
      return '<div class="ccal-row"><span class="ccal-tile" style="background:color-mix(in srgb,' + typeColor(e.type) + ' 18%,transparent);color:' + typeColor(e.type) + '">' + esc((e.type || '?').charAt(0).toUpperCase()) + '</span>' +
        '<div><div class="ccal-row-title">' + esc(e.title) + '</div><div class="ccal-row-sub">' + fmtDate(e.date) + ' · ' + esc(e.team || 'Club') + '</div></div></div>';
    }).join('') + '</div>';
  }

  /* ── Overlay (panneau latéral réutilisé pour le détail d'un jour + le formulaire d'ajout) ── */
  function openOverlay(html) {
    closeOverlay();
    if (!state.container) return;
    var ov = document.createElement('div');
    ov.setAttribute('data-ccal-overlay', '1');
    ov.className = 'ccal-overlay';
    ov.innerHTML = '<button class="ccal-overlay-bg" data-ccal-action="close-overlay" aria-label="Fermer"></button>' +
      '<div class="ccal-panel">' + html + '</div>';
    state.container.appendChild(ov);
  }
  function closeOverlay() {
    if (!state.container) return;
    var olds = state.container.querySelectorAll('[data-ccal-overlay]');
    olds.forEach(function (el) { el.remove(); });
  }

  /* ── Détail d'un jour (liste des événements + ajout) ── */
  function dayOverlayHtml(iso) {
    var evs = (state.events || []).filter(function (e) { return e.date === iso; });
    var list = evs.map(function (e) {
      return '<div class="ccal-event-card"><span class="ccal-tile" style="background:color-mix(in srgb,' + typeColor(e.type) + ' 18%,transparent);color:' + typeColor(e.type) + '">' + esc((e.type || '?').charAt(0).toUpperCase()) + '</span>' +
        '<div><b style="font-size:13.5px">' + esc(e.title) + '</b><div class="ccal-muted" style="margin-top:2px">' + esc(typeLabel(e.type)) + ' · ' + esc(e.team || 'Club') + '</div></div></div>';
    }).join('') || '<div class="ccal-muted" style="margin-bottom:16px">Aucun événement ce jour-là pour l\'instant.</div>';
    var addBtn = canAdd(state.role) ? '<button class="btn btn-primary" style="width:100%;justify-content:center" data-ccal-action="add-event" data-iso="' + iso + '">+ Ajouter un événement</button>' : '';
    return '<div class="ccal-panel-head"><b>' + esc(fmtDate(iso)) + '</b><button class="ccal-close" data-ccal-action="close-overlay">✕</button></div>' +
      list + addBtn;
  }

  /* ── Formulaire d'ajout d'événement ── */
  function addEventFormHtml(iso) {
    var teams = state.teams || [];
    var typeOptions = FORM_TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('');
    var teamOptions = '<option value="">Aucune équipe (événement du club)</option>' +
      teams.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('');
    return '<div class="ccal-panel-head"><b>Ajouter un événement — ' + esc(fmtDate(iso)) + '</b><button class="ccal-close" type="button" data-ccal-action="close-overlay">✕</button></div>' +
      '<form data-ccal-form="add-event" data-iso="' + iso + '">' +
      '<label class="ccal-label">Type<select class="ccal-input" name="type">' + typeOptions + '</select></label>' +
      '<label class="ccal-label">Titre<input class="ccal-input" name="title" type="text" placeholder="ex: Match vs AS Berville"></label>' +
      '<label class="ccal-label">Équipe<select class="ccal-input" name="team">' + teamOptions + '</select></label>' +
      '<button class="btn btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:14px">Ajouter</button>' +
      '</form>';
  }

  /* ── Rendu global ── */
  function shellHtml() {
    return '<div class="ccal-wrap">' +
      '<div class="ccal-head"><b>Calendrier</b></div>' +
      '<div class="ccal-tabbar">' +
      '<button class="ccal-tabbtn' + (state.view === 'mois' ? ' on' : '') + '" data-ccal-tab="mois">Mois</button>' +
      '<button class="ccal-tabbtn' + (state.view === 'agenda' ? ' on' : '') + '" data-ccal-tab="agenda">Agenda</button>' +
      '</div>' +
      '<div class="ccal-pillbar" data-ccal-filter="team"></div>' +
      '<div class="ccal-pillbar" data-ccal-filter="type"></div>' +
      '<div class="ccal-body"></div>' +
      '</div>';
  }
  function teamFilterHtml() {
    var teams = ['toutes'].concat(state.teams || []);
    return teams.map(function (t) {
      return '<button class="ccal-pill' + (state.filterTeam === t ? ' on' : '') + '" data-ccal-action="filter-team" data-team="' + esc(t) + '">' + (t === 'toutes' ? 'Toutes les équipes' : esc(t)) + '</button>';
    }).join('');
  }
  function typeFilterHtml() {
    return FILTER_TYPES.map(function (t) {
      return '<button class="ccal-pill' + (state.filterType === t[0] ? ' on' : '') + '" data-ccal-action="filter-type" data-type="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
  }
  function renderShell() {
    if (!state.container) return;
    state.container.innerHTML = shellHtml();
  }
  async function refreshBody() {
    if (!state.container) return;
    var bodyEl = state.container.querySelector('.ccal-body');
    var teamFilterEl = state.container.querySelector('[data-ccal-filter="team"]');
    var typeFilterEl = state.container.querySelector('[data-ccal-filter="type"]');
    if (!bodyEl) return;
    var needLoad = state.events === null && !state.errorEvents;
    var needTeams = state.teams === null && !state.errorTeams;
    if (needLoad || needTeams) {
      bodyEl.innerHTML = loadingHtml('du calendrier');
      await Promise.all([needLoad ? loadEvents() : Promise.resolve(), needTeams ? loadTeams() : Promise.resolve()]);
      if (!state.container || !state.container.isConnected) return; // module démonté entre-temps
    }
    if (typeFilterEl) typeFilterEl.innerHTML = typeFilterHtml();
    if (teamFilterEl) teamFilterEl.innerHTML = teamFilterHtml();
    if (state.errorEvents) { bodyEl.innerHTML = errorHtml(state.errorEvents, 'retry-events'); return; }
    bodyEl.innerHTML = state.view === 'mois' ? monthViewHtml() : agendaViewHtml();
  }

  /* ── Action serveur : ajout d'un événement ── */
  async function submitAddEvent(iso, type, title, team) {
    var body = { club_id: state.orgId, event_date: iso, type: type, title: title, team: team || null };
    // Note : ctx ne fournit que le rôle, pas l'identité de l'utilisateur
    // courant (pas d'userId disponible ici, contrairement à REAL.userId
    // dans Club+) — created_by reste donc null, même choix documenté
    // que sendMatchToNewsroom() dans le module Équipes & Matchs pour
    // author_id/author_name.
    var res = await sbFetch('club_calendar_events', { method: 'POST', body: body });
    if (!res.ok) { toast(res.status === 403 ? 'Action non autorisée par votre rôle.' : "Erreur lors de l'ajout."); return false; }
    await loadEvents(true);
    return true;
  }

  /* ── Délégation d'événements (bind une seule fois par container) ── */
  function onClick(e) {
    var tabBtn = e.target.closest('[data-ccal-tab]');
    if (tabBtn && state.container.contains(tabBtn)) {
      state.view = tabBtn.getAttribute('data-ccal-tab');
      renderShell();
      refreshBody();
      return;
    }
    var el = e.target.closest('[data-ccal-action]');
    if (!el || !state.container.contains(el)) return;
    var action = el.getAttribute('data-ccal-action');
    switch (action) {
      case 'filter-team':
        state.filterTeam = el.getAttribute('data-team');
        refreshBody();
        break;
      case 'filter-type':
        state.filterType = el.getAttribute('data-type');
        refreshBody();
        break;
      case 'prev-month':
        state.gridMonth -= 1;
        if (state.gridMonth < 1) { state.gridMonth = 12; state.gridYear -= 1; }
        refreshBody();
        break;
      case 'next-month':
        state.gridMonth += 1;
        if (state.gridMonth > 12) { state.gridMonth = 1; state.gridYear += 1; }
        refreshBody();
        break;
      case 'today-month': {
        var now = new Date();
        state.gridYear = now.getFullYear();
        state.gridMonth = now.getMonth() + 1;
        refreshBody();
        break;
      }
      case 'open-day':
        openOverlay(dayOverlayHtml(el.getAttribute('data-iso')));
        break;
      case 'add-event':
        if (!canAdd(state.role)) { toast('Votre rôle ne vous permet pas d’effectuer cette action. Contactez l’administrateur du club pour demander un accès supplémentaire.'); break; }
        openOverlay(addEventFormHtml(el.getAttribute('data-iso')));
        break;
      case 'close-overlay':
        closeOverlay();
        break;
      case 'retry-events':
        loadEvents(true).then(refreshBody);
        break;
    }
  }

  async function onSubmit(e) {
    var form = e.target.closest('[data-ccal-form]');
    if (!form || !state.container.contains(form)) return;
    e.preventDefault();
    var kind = form.getAttribute('data-ccal-form');
    if (kind !== 'add-event') return;
    var iso = form.getAttribute('data-iso');
    var fd = new FormData(form);
    function val(name) { return (fd.get(name) || '').toString().trim(); }
    var type = val('type') || 'contenu';
    var title = val('title') || 'Nouvel événement';
    var team = val('team');
    var submitBtn = form.querySelector('button[type=submit]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      var ok = await submitAddEvent(iso, type, title, team);
      if (!ok) return;
      closeOverlay();
      refreshBody();
      toast('Événement ajouté au calendrier.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function bindContainer(container) {
    if (container.__ccalBound) return;
    container.__ccalBound = true;
    container.addEventListener('click', onClick);
    container.addEventListener('submit', onSubmit);
  }

  /* ── Point d'entrée contractuel ── */
  async function render(container, orgId, ctx) {
    ensureStyles();

    // Un nouveau container (ou un changement d'organisation) invalide les
    // caches et referme tout panneau resté ouvert sur l'ancien montage.
    if (state.container && state.container !== container) closeOverlay();
    if (state.orgId !== orgId) {
      state.events = null;
      state.teams = null;
      state.errorEvents = null;
      state.errorTeams = null;
      state.view = 'mois';
      state.filterTeam = 'toutes';
      state.filterType = 'tous';
      var now = new Date();
      state.gridYear = now.getFullYear();
      state.gridMonth = now.getMonth() + 1;
    }
    state.orgId = orgId;
    state.role = (ctx && ctx.role) || '';
    state.container = container;

    bindContainer(container);
    renderShell();
    await refreshBody();
  }

  window.ClubModules = window.ClubModules || {};
  window.ClubModules.calendrier = {
    label: 'Calendrier',
    espace: 'club',
    render: render,
  };
})();
