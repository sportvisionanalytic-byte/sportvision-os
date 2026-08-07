/* ============================================================
 * SportVision Connect — Module "Équipes & Matchs"
 * ------------------------------------------------------------
 * Portage autonome des fonctions "Équipes & éducateurs" et
 * "Match Center" de SportVision Club+ (app.html, lecture seule,
 * référence uniquement — jamais modifié) vers le nouveau socle
 * Connect (organizations / entitlements).
 *
 * Tables lues/écrites (déjà existantes, aucune migration créée) :
 *   - club_teams   (migration-clubplus-v5.sql)
 *   - club_matches (migration-clubplus-v3.sql)
 *   - club_newsroom_items (migration-clubplus-v3.sql) — uniquement en
 *     écriture, pour le bouton "Envoyer à la Newsroom" du détail match,
 *     fidèle à mcSendNewsroom() dans Club+.
 *
 * orgId reçu par render() = organizations.id = clubs.id (même UUID,
 * cf. migration-connect-v2-organizations-entitlements.sql) donc utilisé
 * directement comme club_id dans les requêtes, sans traduction.
 *
 * Dépendances globales fournies par le shell (index.html), non redéfinies
 * ici : sbFetch, esc, toast. Variables CSS réutilisées : --card, --border,
 * --radius, --shadow, --accent, --accent-2, --muted, --text, --ok,
 * --danger. Classes réutilisées : .btn, .btn-primary, .btn-ghost, .badge.
 *
 * Le module est un IIFE : tout l'état vit dans une closure locale,
 * jamais sur window, à l'exception du point d'entrée contractuel
 * window.ClubModules.equipesMatches.
 * ============================================================ */
(function () {
  'use strict';

  /* ── État interne (une seule organisation "montée" à la fois) ── */
  var state = {
    orgId: null,
    role: '',
    container: null,
    view: 'equipes',       // 'equipes' | 'matches'
    matchTab: 'a_venir',   // 'a_venir' | 'a_transmettre' | 'recu' | 'contenus'
    teams: null,           // null = pas encore chargé, [] = chargé et vide
    matches: null,
    errorTeams: null,
    errorMatches: null,
  };

  /* ── Permissions d'affichage uniquement ──
   * La RLS (is_club_member pour insert/update, is_club_admin pour delete)
   * est l'unique source de vérité. Ici on se contente de masquer les
   * boutons d'action pour les rôles sans droit sur les résultats, en
   * cohérence avec ROLE_DESC (club-parametres-acces.js) : resp_equipe a
   * explicitement "résultats" dans sa description, contrairement à coach
   * (Éducateur, limité à actualités/médias/demandes). Si le rôle réel
   * autorise plus ou moins que cette heuristique, l'API tranchera
   * (403 -> message clair).
   */
  function canManage(role) {
    var r = (role || '').toLowerCase();
    return /admin|dirigean|president|owner|resp_equipe/.test(r);
  }

  /* ── Styles scopés (préfixe cem-), injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('cem-styles')) return;
    var style = document.createElement('style');
    style.id = 'cem-styles';
    style.textContent = [
      '.cem-wrap{display:flex;flex-direction:column;gap:16px}',
      '.cem-tabbar{display:flex;gap:18px;border-bottom:1px solid var(--border);padding-bottom:0}',
      '.cem-tabbtn{background:transparent;border:none;padding:10px 2px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent}',
      '.cem-tabbtn.on{color:var(--accent);border-bottom-color:var(--accent)}',
      '.cem-toolbar{display:flex;justify-content:flex-end;gap:8px}',
      '.cem-toolbar .btn{width:auto;margin-top:0}',
      '.cem-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}',
      '.cem-card{text-align:left;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px;cursor:pointer;font:inherit;color:inherit}',
      '.cem-card:hover{border-color:var(--accent)}',
      '.cem-card-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px}',
      '.cem-card-title{font-size:15px;font-weight:700}',
      '.cem-card-sub{font-size:12px;color:var(--muted);margin-top:2px}',
      '.cem-swatch{width:16px;height:16px;border-radius:50%;border:1px solid var(--border);flex-shrink:0}',
      '.cem-card-row{display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0;border-top:1px solid var(--border)}',
      '.cem-card-row span:first-child{color:var(--muted)}',
      '.cem-muted{color:var(--muted);font-size:13px}',
      '.cem-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}',
      '.cem-error{color:var(--danger)}',
      '.cem-pillbar{display:flex;gap:8px;flex-wrap:wrap}',
      '.cem-pill{background:var(--card);border:1px solid var(--border);border-radius:999px;padding:6px 14px;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer}',
      '.cem-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}',
      '.cem-list{display:flex;flex-direction:column;gap:8px}',
      '.cem-row-item{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;width:100%;text-align:left;font:inherit;color:inherit}',
      '.cem-row-click{cursor:pointer}',
      '.cem-row-click:hover{border-color:var(--accent)}',
      '.cem-row-title{font-weight:700;font-size:13.5px}',
      '.cem-score{font-size:16px;font-weight:800;color:var(--accent-2)}',
      '.cem-score-big{font-size:26px;font-weight:800;color:var(--accent-2);margin-bottom:14px}',
      '.cem-badge-info{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}',
      '.cem-badge-warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}',
      '.cem-badge-ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}',
      '.cem-chip{display:inline-block;background:color-mix(in srgb,var(--accent-2) 14%,transparent);color:var(--accent-2);border-radius:8px;padding:4px 10px;font-size:12px;margin:0 6px 6px 0}',
      '.cem-overlay{position:fixed;inset:0;z-index:1000;display:flex;justify-content:flex-end}',
      '.cem-overlay-bg{position:absolute;inset:0;background:rgba(10,14,30,.45);border:none;padding:0;margin:0}',
      '.cem-panel{position:relative;width:100%;max-width:420px;background:var(--card);height:100%;overflow-y:auto;padding:24px 22px;box-shadow:var(--shadow)}',
      '.cem-panel-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;font-size:16px}',
      '.cem-close{background:transparent;border:none;font-size:16px;cursor:pointer;color:var(--muted)}',
      '.cem-detail-list{margin:14px 0}',
      '.cem-detail-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px}',
      '.cem-detail-row span{color:var(--muted)}',
      '.cem-actions{display:flex;flex-direction:column;gap:8px;margin-top:18px}',
      '.cem-actions .btn{width:100%;justify-content:center;margin-top:0}',
      '.cem-label{display:block;font-size:12.5px;font-weight:600;margin:12px 0 5px;color:var(--text)}',
      '.cem-input{width:100%;padding:10px 11px;border:1px solid var(--border);border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box}',
      '.cem-input:focus{outline:2px solid var(--accent);outline-offset:1px}',
      '.cem-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '@media (max-width:480px){.cem-row2{grid-template-columns:1fr}.cem-panel{max-width:100%}}',
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
  function safeColor(c) {
    if (!c) return null;
    var v = String(c).trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
    if (/^[a-zA-Z]{3,20}$/.test(v)) return v;
    return null;
  }
  function statusMeta(status) {
    switch (status) {
      case 'a_venir': return { label: 'À venir', cls: 'cem-badge-info' };
      case 'a_transmettre': return { label: 'À transmettre', cls: 'cem-badge-warn' };
      case 'recu': return { label: 'Reçu', cls: 'cem-badge-ok' };
      default: return { label: status || '—', cls: 'cem-badge-info' };
    }
  }
  function loadingHtml(label) { return '<div class="cem-empty">Chargement des ' + label + '…</div>'; }
  function errorHtml(msg, retryAction) {
    return '<div class="cem-empty cem-error">' + esc(msg) +
      '<div style="margin-top:10px"><button class="btn btn-ghost" data-cem-action="' + retryAction + '">Réessayer</button></div></div>';
  }

  /* ── Chargement des données (mis en cache dans state, invalidé après écriture) ── */
  async function loadTeams(force) {
    if (state.teams !== null && !force) return state.teams;
    state.errorTeams = null;
    var requestedOrg = state.orgId; // pour ignorer une réponse tardive si l'org a changé entre-temps
    try {
      var res = await sbFetch('club_teams?select=*&club_id=eq.' + requestedOrg + '&order=created_at.asc');
      if (state.orgId !== requestedOrg) return state.teams; // org changée pendant le fetch : réponse obsolète, ignorée
      if (!res.ok) throw new Error('http ' + res.status);
      state.teams = res.data || [];
    } catch (e) {
      if (state.orgId !== requestedOrg) return state.teams;
      state.teams = null;
      state.errorTeams = 'Impossible de charger les équipes. Vérifiez votre connexion.';
    }
    return state.teams;
  }
  async function loadMatches(force) {
    if (state.matches !== null && !force) return state.matches;
    state.errorMatches = null;
    var requestedOrg = state.orgId;
    try {
      var res = await sbFetch('club_matches?select=*&club_id=eq.' + requestedOrg + '&order=match_date.asc.nullslast,created_at.desc');
      if (state.orgId !== requestedOrg) return state.matches;
      if (!res.ok) throw new Error('http ' + res.status);
      state.matches = res.data || [];
    } catch (e) {
      if (state.orgId !== requestedOrg) return state.matches;
      state.matches = null;
      state.errorMatches = 'Impossible de charger le Match Center. Vérifiez votre connexion.';
    }
    return state.matches;
  }

  /* ── Rendu : Équipes ── */
  function teamsListHtml() {
    var teams = state.teams || [];
    var manage = canManage(state.role);
    var addBtn = manage ? '<button class="btn btn-primary" data-cem-action="add-team">+ Ajouter une équipe</button>' : '';
    var cards = teams.map(function (t) {
      var sw = safeColor(t.couleur);
      return '<button class="cem-card" data-cem-action="open-team" data-id="' + esc(t.id) + '">' +
        '<div class="cem-card-top"><div>' +
        '<div class="cem-card-title">' + esc(t.name) + '</div>' +
        '<div class="cem-card-sub">' + esc(t.categorie || 'Non précisé') + (t.section ? ' · ' + esc(t.section) : '') + '</div>' +
        '</div>' + (sw ? '<span class="cem-swatch" style="background:' + esc(sw) + '"></span>' : '') + '</div>' +
        '<div class="cem-card-row"><span>Éducateur</span><span>' + esc(t.coach || 'À définir') + '</span></div>' +
        '<div class="cem-card-row"><span>Resp. communication</span><span>' + esc(t.resp_comm || '—') + '</span></div>' +
        '<div class="cem-card-row"><span>Effectif</span><span>' + (t.members != null ? esc(String(t.members)) : '—') + '</span></div>' +
        '<div class="cem-card-row"><span>Prochain match</span><span>' + esc(t.next_match || 'À planifier') + '</span></div>' +
        '</button>';
    }).join('') || '<div class="cem-empty">Aucune équipe pour le moment.</div>';
    return '<div class="cem-toolbar">' + addBtn + '</div><div class="cem-grid">' + cards + '</div>';
  }
  function teamDetailHtml(t) {
    var manage = canManage(state.role);
    return '<div class="cem-panel-head"><b>' + esc(t.name) + '</b><button class="cem-close" data-cem-action="close-overlay">✕</button></div>' +
      '<div class="cem-muted" style="margin-bottom:6px">' + esc(t.categorie || 'Non précisé') + (t.section ? ' · ' + esc(t.section) : '') + '</div>' +
      '<div class="cem-detail-list">' +
      '<div class="cem-detail-row"><span>Éducateur</span><b>' + esc(t.coach || 'À définir') + '</b></div>' +
      '<div class="cem-detail-row"><span>Responsable communication</span><b>' + esc(t.resp_comm || '—') + '</b></div>' +
      '<div class="cem-detail-row"><span>Effectif</span><b>' + (t.members != null ? esc(String(t.members)) : '—') + '</b></div>' +
      '<div class="cem-detail-row"><span>Prochain match</span><b>' + esc(t.next_match || 'À planifier') + '</b></div>' +
      '</div>' +
      (manage ? '<div class="cem-actions">' +
        '<button class="btn btn-primary" data-cem-action="edit-team" data-id="' + esc(t.id) + '">Modifier</button>' +
        '<button class="btn" data-cem-action="delete-team" data-id="' + esc(t.id) + '" style="background:var(--danger);color:#fff">Supprimer</button>' +
        '</div>' : '');
  }
  function teamFormHtml(t) {
    var editing = !!t;
    return '<div class="cem-panel-head"><b>' + (editing ? "Modifier l'équipe" : 'Ajouter une équipe') + '</b><button class="cem-close" type="button" data-cem-action="close-overlay">✕</button></div>' +
      '<form data-cem-form="' + (editing ? 'team-edit' : 'team-add') + '"' + (editing ? ' data-id="' + esc(t.id) + '"' : '') + '>' +
      '<label class="cem-label">Nom<input class="cem-input" name="name" required value="' + (editing ? esc(t.name || '') : '') + '"></label>' +
      '<div class="cem-row2">' +
      '<label class="cem-label">Catégorie<input class="cem-input" name="categorie" value="' + (editing ? esc(t.categorie || '') : '') + '"></label>' +
      '<label class="cem-label">Section<select class="cem-input" name="section">' +
      ['Masculin', 'Féminin', 'Mixte'].map(function (s) { return '<option' + (editing && t.section === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
      '</select></label>' +
      '</div>' +
      '<div class="cem-row2">' +
      '<label class="cem-label">Éducateur<input class="cem-input" name="coach" value="' + (editing ? esc(t.coach || '') : '') + '"></label>' +
      '<label class="cem-label">Resp. communication<input class="cem-input" name="resp_comm" value="' + (editing ? esc(t.resp_comm || '') : '') + '"></label>' +
      '</div>' +
      '<div class="cem-row2">' +
      '<label class="cem-label">Effectif<input class="cem-input" type="number" min="0" name="members" value="' + (editing && t.members != null ? esc(String(t.members)) : '') + '"></label>' +
      '<label class="cem-label">Couleur<input class="cem-input" type="text" name="couleur" placeholder="var(--accent)" value="' + (editing ? esc(t.couleur || '') : '') + '"></label>' +
      '</div>' +
      '<label class="cem-label">Prochain match (texte libre)<input class="cem-input" name="next_match" value="' + (editing ? esc(t.next_match || '') : '') + '"></label>' +
      '<button class="btn btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:14px">' + (editing ? 'Enregistrer' : 'Ajouter') + '</button>' +
      '</form>';
  }

  /* ── Rendu : Match Center ── */
  function matchesTabsHtml() {
    var tabs = [['a_venir', 'À venir'], ['a_transmettre', 'À transmettre'], ['recu', 'Reçus'], ['contenus', 'Contenus créés']];
    return '<div class="cem-pillbar">' + tabs.map(function (t) {
      return '<button class="cem-pill' + (state.matchTab === t[0] ? ' on' : '') + '" data-cem-action="match-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }
  function matchRowHtml(m) {
    var sm = statusMeta(m.status);
    return '<button class="cem-row-item cem-row-click" data-cem-action="open-match" data-id="' + esc(m.id) + '">' +
      '<div><div class="cem-row-title">' + esc(m.team) + ' vs ' + esc(m.opponent) + '</div>' +
      '<div class="cem-muted">' + fmtDate(m.match_date) + (m.lieu ? ' · ' + esc(m.lieu) : '') + '</div></div>' +
      (m.score ? '<span class="cem-score">' + esc(m.score) + '</span>' : '<span class="badge ' + sm.cls + '">' + esc(sm.label) + '</span>') +
      '</button>';
  }
  function matchesBodyHtml() {
    var manage = canManage(state.role);
    var matches = state.matches || [];
    var addBtn = manage ? '<button class="btn btn-primary" data-cem-action="add-match">+ Ajouter un match</button>' : '';
    var list;
    if (state.matchTab === 'contenus') {
      var withContent = matches.filter(function (m) { return m.status === 'recu' && Array.isArray(m.contents) && m.contents.length; });
      var rows = [];
      withContent.forEach(function (m) {
        (m.contents || []).forEach(function (c) {
          rows.push('<div class="cem-row-item"><div><div class="cem-row-title">' + esc(c) + '</div>' +
            '<div class="cem-muted">' + esc(m.team) + ' vs ' + esc(m.opponent) + ' · ' + fmtDate(m.match_date) + '</div></div></div>');
        });
      });
      list = rows.join('') || '<div class="cem-empty">Aucun contenu créé pour le moment.</div>';
    } else {
      var filtered = matches.filter(function (m) { return m.status === state.matchTab; });
      var emptyLabels = { a_venir: 'Aucun match à venir.', a_transmettre: 'Rien à transmettre pour le moment.', recu: 'Aucun résultat reçu pour le moment.' };
      list = filtered.map(matchRowHtml).join('') || '<div class="cem-empty">' + (emptyLabels[state.matchTab] || 'Aucun match.') + '</div>';
    }
    return '<div class="cem-toolbar">' + addBtn + '</div>' + matchesTabsHtml() + '<div class="cem-list">' + list + '</div>';
  }
  function matchDetailHtml(m) {
    var manage = canManage(state.role);
    var sm = statusMeta(m.status);
    var contentsHtml = '';
    if (Array.isArray(m.contents) && m.contents.length) {
      contentsHtml = '<div class="cem-muted" style="margin:14px 0 6px">Contenus créés</div>' +
        m.contents.map(function (c) { return '<span class="cem-chip">' + esc(c) + '</span>'; }).join('');
    }
    return '<div class="cem-panel-head"><b>' + esc(m.team) + ' vs ' + esc(m.opponent) + '</b><button class="cem-close" data-cem-action="close-overlay">✕</button></div>' +
      '<div class="cem-muted" style="margin-bottom:10px">' + fmtDate(m.match_date) + (m.lieu ? ' · ' + esc(m.lieu) : '') + '</div>' +
      '<span class="badge ' + sm.cls + '" style="margin-bottom:14px;display:inline-block">' + esc(sm.label) + '</span>' +
      (m.score ? '<div class="cem-score-big">' + esc(m.score) + '</div>' : '') +
      '<div class="cem-detail-list">' +
      '<div class="cem-detail-row"><span>Buteurs</span><b>' + esc(m.scorers || '—') + '</b></div>' +
      '<div class="cem-detail-row"><span>Homme du match</span><b>' + esc(m.man_of_match || '—') + '</b></div>' +
      '</div>' + contentsHtml +
      '<div class="cem-actions">' +
      (manage ? '<button class="btn btn-primary" data-cem-action="edit-match" data-id="' + esc(m.id) + '">Modifier</button>' : '') +
      '<button class="btn btn-ghost" data-cem-action="send-newsroom" data-id="' + esc(m.id) + '">Envoyer à la Newsroom</button>' +
      (manage ? '<button class="btn" data-cem-action="delete-match" data-id="' + esc(m.id) + '" style="background:var(--danger);color:#fff">Supprimer</button>' : '') +
      '</div>';
  }
  function matchFormHtml(m) {
    var editing = !!m;
    var datalist = '<datalist id="cem-team-list">' + (state.teams || []).map(function (t) { return '<option value="' + esc(t.name) + '"></option>'; }).join('') + '</datalist>';
    var statuses = ['a_venir', 'a_transmettre', 'recu'];
    return '<div class="cem-panel-head"><b>' + (editing ? 'Modifier le match' : 'Ajouter un match') + '</b><button class="cem-close" type="button" data-cem-action="close-overlay">✕</button></div>' +
      '<form data-cem-form="' + (editing ? 'match-edit' : 'match-add') + '"' + (editing ? ' data-id="' + esc(m.id) + '"' : '') + '>' +
      '<div class="cem-row2">' +
      '<label class="cem-label">Équipe<input class="cem-input" name="team" list="cem-team-list" required placeholder="ex: Seniors R1" value="' + (editing ? esc(m.team || '') : '') + '"></label>' +
      '<label class="cem-label">Statut<select class="cem-input" name="status">' +
      statuses.map(function (s) {
        var sel = editing ? (m.status === s) : (s === 'a_venir');
        return '<option value="' + s + '"' + (sel ? ' selected' : '') + '>' + statusMeta(s).label + '</option>';
      }).join('') + '</select></label>' +
      '</div>' +
      '<label class="cem-label">Adversaire<input class="cem-input" name="opponent" required value="' + (editing ? esc(m.opponent || '') : '') + '"></label>' +
      '<div class="cem-row2">' +
      '<label class="cem-label">Date<input class="cem-input" type="date" name="match_date" value="' + (editing && m.match_date ? esc(m.match_date) : '') + '"></label>' +
      '<label class="cem-label">Lieu<input class="cem-input" name="lieu" value="' + (editing ? esc(m.lieu || '') : '') + '"></label>' +
      '</div>' +
      '<label class="cem-label">Score<input class="cem-input" name="score" placeholder="2-1" value="' + (editing ? esc(m.score || '') : '') + '"></label>' +
      '<label class="cem-label">Buteurs<input class="cem-input" name="scorers" value="' + (editing ? esc(m.scorers || '') : '') + '"></label>' +
      '<label class="cem-label">Homme du match<input class="cem-input" name="man_of_match" value="' + (editing ? esc(m.man_of_match || '') : '') + '"></label>' +
      '<button class="btn btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:14px">' + (editing ? 'Enregistrer' : 'Ajouter') + '</button>' +
      '</form>' + datalist;
  }

  /* ── Overlay (panneau latéral réutilisé pour détail + formulaires) ── */
  function openOverlay(html) {
    closeOverlays();
    if (!state.container) return;
    var ov = document.createElement('div');
    ov.setAttribute('data-cem-overlay', '1');
    ov.className = 'cem-overlay';
    ov.innerHTML = '<button class="cem-overlay-bg" data-cem-action="close-overlay" aria-label="Fermer"></button>' +
      '<div class="cem-panel">' + html + '</div>';
    state.container.appendChild(ov);
  }
  function closeOverlays() {
    if (!state.container) return;
    var olds = state.container.querySelectorAll('[data-cem-overlay]');
    olds.forEach(function (el) { el.remove(); });
  }

  /* ── Rendu global ── */
  function shellHtml() {
    return '<div class="cem-wrap">' +
      '<div class="cem-tabbar">' +
      '<button class="cem-tabbtn' + (state.view === 'equipes' ? ' on' : '') + '" data-cem-tab="equipes">Équipes</button>' +
      '<button class="cem-tabbtn' + (state.view === 'matches' ? ' on' : '') + '" data-cem-tab="matches">Match Center</button>' +
      '</div>' +
      '<div class="cem-body"></div>' +
      '</div>';
  }
  async function refreshBody() {
    if (!state.container) return;
    var bodyEl = state.container.querySelector('.cem-body');
    if (!bodyEl) return;
    if (state.view === 'equipes') {
      if (state.teams === null && !state.errorTeams) {
        bodyEl.innerHTML = loadingHtml('équipes');
        await loadTeams();
        if (!state.container || !state.container.isConnected) return; // module démonté entre-temps
      }
      bodyEl.innerHTML = state.errorTeams ? errorHtml(state.errorTeams, 'retry-teams') : teamsListHtml();
    } else {
      if (state.matches === null && !state.errorMatches) {
        bodyEl.innerHTML = loadingHtml('matchs');
        await loadMatches();
        if (!state.container || !state.container.isConnected) return;
      }
      bodyEl.innerHTML = state.errorMatches ? errorHtml(state.errorMatches, 'retry-matches') : matchesBodyHtml();
    }
  }
  function renderShell() {
    if (!state.container) return;
    state.container.innerHTML = shellHtml();
  }

  /* ── Actions serveur ── */
  async function deleteTeam(id) {
    if (!window.confirm('Supprimer cette équipe ? Cette action est définitive.')) return;
    var res = await sbFetch('club_teams?id=eq.' + id, { method: 'DELETE' });
    if (!res.ok) { toast(res.status === 403 ? 'Suppression réservée aux administrateurs du club.' : 'Suppression impossible.'); return; }
    closeOverlays();
    await loadTeams(true);
    refreshBody();
    toast('Équipe supprimée.');
  }
  async function deleteMatch(id) {
    if (!window.confirm('Supprimer ce match ? Cette action est définitive.')) return;
    var res = await sbFetch('club_matches?id=eq.' + id, { method: 'DELETE' });
    if (!res.ok) { toast(res.status === 403 ? 'Suppression réservée aux administrateurs du club.' : 'Suppression impossible.'); return; }
    closeOverlays();
    await loadMatches(true);
    refreshBody();
    toast('Match supprimé.');
  }
  async function sendMatchToNewsroom(id) {
    var m = (state.matches || []).find(function (x) { return x.id === id; });
    if (!m) return;
    // Remarque : ctx ne fournit que le rôle, pas l'identité de l'utilisateur
    // courant (pas d'userId/nom disponibles ici) — author_id/author_name
    // restent donc null, contrairement à mcSendNewsroom() dans Club+ qui
    // les renseigne via REAL.userId/REAL.person.
    var res = await sbFetch('club_newsroom_items', {
      method: 'POST',
      body: {
        club_id: state.orgId, type: 'Résultat', team: m.team,
        title: 'Résultat ' + m.team + ' vs ' + m.opponent,
        description: 'Score : ' + (m.score || '—'),
        status: 'recu',
      },
    });
    toast(res.ok ? 'Envoyé à la Newsroom.' : 'Action impossible.');
  }

  /* ── Délégation d'événements (bind une seule fois par container) ── */
  function onClick(e) {
    var tabBtn = e.target.closest('[data-cem-tab]');
    if (tabBtn && state.container.contains(tabBtn)) {
      state.view = tabBtn.getAttribute('data-cem-tab');
      renderShell();
      refreshBody();
      return;
    }
    var el = e.target.closest('[data-cem-action]');
    if (!el || !state.container.contains(el)) return;
    var action = el.getAttribute('data-cem-action');
    var id = el.getAttribute('data-id');
    var t;
    switch (action) {
      case 'add-team': openOverlay(teamFormHtml(null)); break;
      case 'open-team':
        t = (state.teams || []).find(function (x) { return x.id === id; });
        if (t) openOverlay(teamDetailHtml(t)); else toast('Équipe introuvable.');
        break;
      case 'edit-team':
        t = (state.teams || []).find(function (x) { return x.id === id; });
        if (t) openOverlay(teamFormHtml(t));
        break;
      case 'delete-team': deleteTeam(id); break;
      case 'match-tab':
        state.matchTab = el.getAttribute('data-tab');
        refreshBody();
        break;
      case 'add-match': openOverlay(matchFormHtml(null)); break;
      case 'open-match':
        t = (state.matches || []).find(function (x) { return x.id === id; });
        if (t) openOverlay(matchDetailHtml(t)); else toast('Match introuvable.');
        break;
      case 'edit-match':
        t = (state.matches || []).find(function (x) { return x.id === id; });
        if (t) openOverlay(matchFormHtml(t));
        break;
      case 'delete-match': deleteMatch(id); break;
      case 'send-newsroom': sendMatchToNewsroom(id); break;
      case 'close-overlay': closeOverlays(); break;
      case 'retry-teams': loadTeams(true).then(refreshBody); break;
      case 'retry-matches': loadMatches(true).then(refreshBody); break;
    }
  }

  async function onSubmit(e) {
    var form = e.target.closest('[data-cem-form]');
    if (!form || !state.container.contains(form)) return;
    e.preventDefault();
    var kind = form.getAttribute('data-cem-form');
    var fd = new FormData(form);
    var submitBtn = form.querySelector('button[type=submit]');

    function val(name) { return (fd.get(name) || '').toString().trim(); }

    if (kind === 'team-add' || kind === 'team-edit') {
      var namee = val('name');
      if (!namee) { toast("Le nom de l'équipe est obligatoire."); return; }
      var membersRaw = val('members');
      var payloadTeam = {
        name: namee,
        categorie: val('categorie') || null,
        section: val('section') || null,
        coach: val('coach') || null,
        resp_comm: val('resp_comm') || null,
        members: membersRaw ? Number(membersRaw) : null,
        couleur: val('couleur') || null,
        next_match: val('next_match') || null,
      };
      if (submitBtn) submitBtn.disabled = true;
      try {
        var resT;
        if (kind === 'team-add') {
          payloadTeam.club_id = state.orgId;
          resT = await sbFetch('club_teams', { method: 'POST', body: payloadTeam });
        } else {
          resT = await sbFetch('club_teams?id=eq.' + form.getAttribute('data-id'), { method: 'PATCH', body: payloadTeam });
        }
        if (!resT.ok) { toast(resT.status === 403 ? 'Action non autorisée par votre rôle.' : "Erreur lors de l'enregistrement."); return; }
        closeOverlays();
        await loadTeams(true);
        refreshBody();
        toast(kind === 'team-add' ? 'Équipe ajoutée avec succès.' : 'Équipe mise à jour.');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
      return;
    }

    if (kind === 'match-add' || kind === 'match-edit') {
      var teamVal = val('team');
      var opponentVal = val('opponent');
      if (!teamVal) { toast('Le nom de l\'équipe est obligatoire (créez une équipe au préalable si besoin).'); return; }
      if (!opponentVal) { toast("L'adversaire est obligatoire."); return; }
      var payloadMatch = {
        team: teamVal,
        opponent: opponentVal,
        status: val('status') || 'a_venir',
        match_date: val('match_date') || null,
        lieu: val('lieu') || null,
        score: val('score') || null,
        scorers: val('scorers') || null,
        man_of_match: val('man_of_match') || null,
      };
      if (submitBtn) submitBtn.disabled = true;
      try {
        var resM;
        if (kind === 'match-add') {
          payloadMatch.club_id = state.orgId;
          resM = await sbFetch('club_matches', { method: 'POST', body: payloadMatch });
        } else {
          resM = await sbFetch('club_matches?id=eq.' + form.getAttribute('data-id'), { method: 'PATCH', body: payloadMatch });
        }
        if (!resM.ok) { toast(resM.status === 403 ? 'Action non autorisée par votre rôle.' : "Erreur lors de l'enregistrement."); return; }
        closeOverlays();
        await loadMatches(true);
        refreshBody();
        toast(kind === 'match-add' ? 'Match ajouté.' : 'Match mis à jour.');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
      return;
    }
  }

  function bindContainer(container) {
    if (container.__cemBound) return;
    container.__cemBound = true;
    container.addEventListener('click', onClick);
    container.addEventListener('submit', onSubmit);
  }

  /* ── Point d'entrée contractuel ── */
  async function render(container, orgId, ctx) {
    ensureStyles();

    // Un nouveau container (ou un changement d'organisation) invalide les
    // caches et referme tout panneau resté ouvert sur l'ancien montage.
    if (state.container && state.container !== container) closeOverlays();
    if (state.orgId !== orgId) {
      state.teams = null;
      state.matches = null;
      state.errorTeams = null;
      state.errorMatches = null;
      state.view = 'equipes';
      state.matchTab = 'a_venir';
    }
    state.orgId = orgId;
    state.role = (ctx && ctx.role) || '';
    state.container = container;

    bindContainer(container);
    renderShell();
    await refreshBody();
  }

  window.ClubModules = window.ClubModules || {};
  window.ClubModules.equipesMatches = {
    label: 'Équipes & Matchs',
    espace: 'club',
    render: render,
  };
})();
