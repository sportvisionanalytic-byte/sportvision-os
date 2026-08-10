/* ══════════════════════════════════════════════════════════════════════
   SportVision Connect — Module « Newsroom & Communication »
   Portage du couple Newsroom / Calendrier éditorial de SportVision Club+
   (référence lecture seule : SportVision-Club-Plus/app.html).

   Dépendances globales fournies par le shell Connect (app/index.html) :
   sbFetch, esc, toast, et les variables/classes CSS (--card, --border,
   --radius, --shadow, --accent, --accent-2, --muted, --text, --ok,
   --danger, .btn, .btn-primary, .btn-ghost, .badge).

   Le module est autonome : tout son état vit dans une closure créée à
   chaque appel de render(), rien n'est posé sur window en dehors de
   window.ClubModules.newsroomCommunication lui-même.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  window.ClubModules = window.ClubModules || {};

  // Valeurs exactes de la colonne club_newsroom_items.status, telles que
  // définies par la contrainte CHECK dans migration-clubplus-v3.sql.
  var NS_STATUSES = [
    'recu', 'a_verifier', 'infos_manquantes', 'pret_a_transformer',
    'en_creation', 'programme', 'publie', 'archive'
  ];
  var NS_STATUS_META = {
    recu:               { label: 'Reçu',                    color: 'var(--accent)' },
    a_verifier:         { label: 'À vérifier par SportVision', color: 'var(--accent-2)' },
    infos_manquantes:   { label: 'Informations manquantes',  color: 'var(--warn)' },
    pret_a_transformer: { label: 'Prêt à transformer',       color: 'var(--purple)' },
    en_creation:        { label: 'En création',              color: 'var(--warn)' },
    programme:          { label: 'Programmé',                color: 'var(--accent)' },
    publie:             { label: 'Publié',                   color: 'var(--ok)' },
    archive:            { label: 'Archivé',                  color: 'var(--muted)' }
  };
  // Types autorisés par la contrainte CHECK de club_newsroom_items.type.
  var NS_TYPES = ['Actualité', 'Résultat'];

  function statusMeta(status) {
    return NS_STATUS_META[status] || { label: status || '—', color: 'var(--muted)' };
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var parts = String(iso).slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return iso;
    var dt = new Date(parts[0], parts[1] - 1, parts[2]);
    return dt.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function isoDate(dt) {
    var y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, '0'), d = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function monthLabel(dt) {
    var s = dt.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Grille de 6 semaines (toujours complète, y compris les mois à 6 rangées)
  function monthGrid(refDate, events) {
    var year = refDate.getFullYear(), month = refDate.getMonth();
    var first = new Date(year, month, 1);
    var startWd = (first.getDay() + 6) % 7; // lundi = 0
    var todayIso = isoDate(new Date());
    var weeks = [];
    var dayNum = 1 - startWd;
    for (var w = 0; w < 6; w++) {
      var week = [];
      for (var d = 0; d < 7; d++) {
        var dt = new Date(year, month, dayNum);
        var iso = isoDate(dt);
        week.push({
          label: String(dt.getDate()),
          iso: iso,
          inMonth: dt.getMonth() === month,
          today: iso === todayIso,
          events: events.filter(function (e) { return e.event_date === iso; })
        });
        dayNum++;
      }
      weeks.push(week);
    }
    return weeks;
  }

  window.ClubModules.newsroomCommunication = {
    label: 'Newsroom & Communication',
    espace: 'club',

    render: async function (container, orgId, ctx) {
      // Si le conteneur a déjà été utilisé par une précédente exécution de
      // ce module (rejeu), on détache proprement les écouteurs existants
      // avant de reconstruire — évite tout doublon d'event listener.
      if (container.__svncCleanup) { container.__svncCleanup(); }

      var role = (ctx && ctx.role) || '';
      var readOnly = role === 'lecture_seule';

      // ── état local, propre à cette exécution du module ──
      var state = {
        tab: 'newsroom',
        teams: null, // [{id,name}] | null tant que non chargé
        ns: { items: null, loading: false, error: null, view: 'liste', team: 'toutes', status: 'toutes' },
        pl: { items: null, loading: false, error: null, view: 'mois', team: 'toutes', refDate: new Date() }
      };

      container.innerHTML =
        '<div class="svnc-wrap">' +
          '<style>' +
            '.svnc-wrap{color:var(--text)}' +
            '.svnc-tabs{display:flex;gap:4px;margin-bottom:18px;border-bottom:1px solid var(--border)}' +
            '.svnc-tab{background:none;border:none;padding:10px 4px;margin-right:20px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent}' +
            '.svnc-tab.on{color:var(--accent);border-color:var(--accent)}' +
            '.svnc-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px}' +
            '.svnc-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}' +
            '.svnc-pillbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}' +
            '.svnc-pill{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;padding:6px 12px;font-size:12.5px;font-weight:600;cursor:pointer}' +
            '.svnc-pill:not(.on):hover{border-color:var(--accent);color:var(--text)}' +
            '.svnc-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}' +
            '.svnc-list{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}' +
            '.svnc-list-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;background:none;border-left:none;border-right:none;border-top:none;width:100%;text-align:left;font:inherit;color:inherit}' +
            '.svnc-list-row:last-child{border-bottom:none}' +
            '.svnc-list-row:hover{background:rgba(47,107,255,.05)}' +
            '.svnc-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;display:inline-block}' +
            '.svnc-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}' +
            '.svnc-error{background:rgba(248,113,113,.15);border:1px solid rgba(248,113,113,.3);color:var(--danger);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:13.5px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}' +
            '.svnc-kanban{display:grid;grid-auto-flow:column;grid-auto-columns:220px;gap:12px;overflow-x:auto;padding-bottom:8px}' +
            '.svnc-kan-col{background:rgba(91,100,120,.06);border-radius:12px;padding:10px}' +
            '.svnc-kan-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;font-size:12.5px}' +
            '.svnc-field{margin-bottom:14px}' +
            '.svnc-field label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}' +
            '.svnc-field input,.svnc-field select,.svnc-field textarea{width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box}' +
            '.svnc-modal-backdrop{position:fixed;inset:0;background:rgba(10,14,30,.5);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;z-index:1000;overflow-y:auto}' +
            '.svnc-modal{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px;max-width:480px;width:100%}' +
            '.svnc-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:16px}' +
            '.svnc-close-x{background:none;border:none;font-size:20px;line-height:1;cursor:pointer;color:var(--muted);padding:0}' +
            '.svnc-cal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}' +
            '.svnc-cal-nav{display:flex;gap:6px;align-items:center}' +
            '.svnc-cal-nav button{background:var(--card);border:1px solid var(--border);border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:14px}' +
            '.svnc-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px}' +
            '.svnc-cal-day{border:1px solid var(--border);border-radius:8px;padding:6px;min-height:66px;background:var(--card);text-align:left;cursor:pointer;font:inherit;color:inherit;overflow:hidden}' +
            '.svnc-cal-day.today{border-color:var(--accent);border-width:2px}' +
            '.svnc-cal-ev{font-size:10px;border-radius:4px;padding:2px 4px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
            '.svnc-muted{color:var(--muted)}' +
            '@media(max-width:640px){.svnc-kanban{grid-auto-columns:78vw}}' +
          '</style>' +
          '<div class="svnc-tabs">' +
            '<button type="button" class="svnc-tab" data-act="tab" data-value="newsroom">Newsroom</button>' +
            '<button type="button" class="svnc-tab" data-act="tab" data-value="planning">Planning éditorial</button>' +
          '</div>' +
          '<div class="svnc-body"></div>' +
        '</div>';

      var root = container;
      function q(sel) { return root.querySelector(sel); }

      // ─────────────────────── modal minimal, self-contained ───────────────────────
      function openModal(html) {
        closeModal();
        var backdrop = document.createElement('div');
        backdrop.className = 'svnc-modal-backdrop';
        backdrop.setAttribute('data-act', 'modal-backdrop');
        backdrop.innerHTML = '<div class="svnc-modal">' + html + '</div>';
        root.appendChild(backdrop);
      }
      function closeModal() {
        var existing = root.querySelector('.svnc-modal-backdrop');
        if (existing) existing.remove();
      }

      // ─────────────────────────────── chargement ───────────────────────────────
      async function loadTeams() {
        try {
          var res = await sbFetch('club_teams?club_id=eq.' + orgId + '&select=id,name&order=name.asc');
          state.teams = res.ok ? (res.data || []) : [];
        } catch (e) {
          state.teams = [];
        }
      }

      async function loadNewsroom() {
        state.ns.loading = true; state.ns.error = null; paintBody();
        try {
          var res = await sbFetch('club_newsroom_items?club_id=eq.' + orgId + '&select=*&order=created_at.desc');
          state.ns.loading = false;
          if (!res.ok) { state.ns.error = 'Impossible de charger la newsroom pour le moment.'; state.ns.items = state.ns.items || []; }
          else { state.ns.items = res.data || []; }
        } catch (e) {
          state.ns.loading = false;
          state.ns.error = 'Erreur réseau : impossible de joindre le serveur.';
          state.ns.items = state.ns.items || [];
        }
        paintBody();
      }

      async function loadPlanning() {
        state.pl.loading = true; state.pl.error = null; paintBody();
        try {
          var res = await sbFetch('club_calendar_events?club_id=eq.' + orgId + '&type=eq.contenu&select=id,event_date,title,team&order=event_date.asc');
          state.pl.loading = false;
          if (!res.ok) { state.pl.error = 'Impossible de charger le planning éditorial pour le moment.'; state.pl.items = state.pl.items || []; }
          else { state.pl.items = res.data || []; }
        } catch (e) {
          state.pl.loading = false;
          state.pl.error = 'Erreur réseau : impossible de joindre le serveur.';
          state.pl.items = state.pl.items || [];
        }
        paintBody();
      }

      // ──────────────────────────────── peinture ────────────────────────────────
      function paintTabsActive() {
        root.querySelectorAll('.svnc-tab').forEach(function (btn) {
          btn.classList.toggle('on', btn.getAttribute('data-value') === state.tab);
        });
      }

      function paintBody() {
        var body = q('.svnc-body');
        body.innerHTML = state.tab === 'newsroom' ? renderNewsroomHtml() : renderPlanningHtml();
        paintTabsActive();
      }

      function switchTab(tab) {
        state.tab = tab;
        paintTabsActive();
        if (tab === 'newsroom') {
          if (state.ns.items === null) loadNewsroom(); else paintBody();
        } else {
          if (state.pl.items === null) loadPlanning(); else paintBody();
        }
      }

      function teamPills(current, actKey) {
        var names = (state.teams || []).map(function (t) { return t.name; }).filter(Boolean);
        var opts = ['toutes'].concat(names);
        return '<div class="svnc-pillbar">' + opts.map(function (t) {
          return '<button type="button" class="svnc-pill' + (current === t ? ' on' : '') + '" data-act="' + actKey + '" data-value="' + esc(t) + '">' + (t === 'toutes' ? 'Toutes les équipes' : esc(t)) + '</button>';
        }).join('') + '</div>';
      }

      // ── Newsroom ──
      function renderNewsroomHtml() {
        var out = '<div class="svnc-row"><b style="font-size:16px">Newsroom du club</b>' +
          (readOnly ? '' : '<button type="button" class="btn btn-primary" data-act="ns-new">+ Envoyer une information</button>') +
          '</div>';

        if (state.ns.error) {
          out += '<div class="svnc-error"><span>' + esc(state.ns.error) + '</span><button type="button" class="btn btn-ghost" data-act="ns-retry">Réessayer</button></div>';
        }
        if (state.ns.loading && state.ns.items === null) {
          return out + '<div class="svnc-empty">Chargement…</div>';
        }
        var items = state.ns.items || [];
        var filtered = items.filter(function (n) {
          return (state.ns.team === 'toutes' || (n.team || '') === state.ns.team) &&
                 (state.ns.status === 'toutes' || n.status === state.ns.status);
        });

        out += '<div class="svnc-pillbar">' + [['liste', 'Liste'], ['kanban', 'Kanban']].map(function (p) {
          return '<button type="button" class="svnc-pill' + (state.ns.view === p[0] ? ' on' : '') + '" data-act="ns-view" data-value="' + p[0] + '">' + p[1] + '</button>';
        }).join('') + '</div>';
        out += teamPills(state.ns.team, 'ns-filter-team');
        out += '<div class="svnc-pillbar">' + ['toutes'].concat(NS_STATUSES).map(function (st) {
          var lbl = st === 'toutes' ? 'Tous les statuts' : statusMeta(st).label;
          return '<button type="button" class="svnc-pill' + (state.ns.status === st ? ' on' : '') + '" data-act="ns-filter-status" data-value="' + st + '">' + esc(lbl) + '</button>';
        }).join('') + '</div>';

        if (!filtered.length) {
          out += '<div class="svnc-empty">Aucune information dans ce filtre pour le moment.</div>';
          return out;
        }

        if (state.ns.view === 'kanban') {
          out += '<div class="svnc-kanban">' + NS_STATUSES.map(function (st) {
            var sm = statusMeta(st);
            var col = filtered.filter(function (n) { return n.status === st; });
            return '<div class="svnc-kan-col">' +
              '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px"><span class="svnc-dot" style="background:' + sm.color + '"></span><span class="svnc-muted" style="font-size:11.5px;font-weight:700">' + esc(sm.label) + '</span></div>' +
              col.map(function (n) {
                return '<div class="svnc-kan-card" data-act="ns-item" data-id="' + esc(n.id) + '">' +
                  '<div style="font-weight:700;margin-bottom:4px">' + esc(n.title) + '</div>' +
                  '<div class="svnc-muted" style="font-size:11px">' + esc(n.team || 'Club') + ' · ' + fmtDate(n.created_at) + '</div></div>';
              }).join('') +
              '</div>';
          }).join('') + '</div>';
        } else {
          out += '<div class="svnc-list">' + filtered.map(function (n) {
            var sm = statusMeta(n.status);
            var prioColor = n.priority === 'haute' ? 'var(--danger)' : n.priority === 'basse' ? 'var(--muted)' : 'var(--warn)';
            return '<button type="button" class="svnc-list-row" data-act="ns-item" data-id="' + esc(n.id) + '">' +
              '<div style="display:flex;gap:10px;align-items:center;min-width:0">' +
                '<span class="svnc-dot" style="background:' + prioColor + '"></span>' +
                '<div style="min-width:0"><div style="font-weight:700;font-size:13.5px">' + esc(n.title) + '</div>' +
                '<div class="svnc-muted" style="font-size:11.5px;margin-top:2px">' + esc(n.type || '—') + ' · ' + esc(n.team || 'Club') + ' · ' + esc(n.author_name || '—') + ' · ' + fmtDate(n.created_at) + '</div></div>' +
              '</div>' +
              '<span class="badge" style="background:' + sm.color + '22;color:' + sm.color + ';white-space:nowrap">' + esc(sm.label) + '</span>' +
              '</button>';
          }).join('') + '</div>';
        }
        return out;
      }

      function openNewsroomDetail(id) {
        var n = (state.ns.items || []).find(function (x) { return x.id === id; });
        if (!n) { toast('Information introuvable.'); return; }
        var sm = statusMeta(n.status);
        var canWithdraw = !readOnly && n.status === 'recu';
        openModal(
          '<div class="svnc-modal-head"><b style="font-size:16px">' + esc(n.title) + '</b><button type="button" class="svnc-close-x" data-act="modal-close">&times;</button></div>' +
          '<div class="svnc-muted" style="font-size:12.5px;margin-bottom:10px">' + esc(n.type || '—') + ' · ' + esc(n.team || 'Club') + ' · ' + esc(n.author_name || '—') + ' · ' + fmtDate(n.created_at) + '</div>' +
          '<span class="badge" style="background:' + sm.color + '22;color:' + sm.color + ';display:inline-block;margin-bottom:16px">' + esc(sm.label) + '</span>' +
          '<div class="svnc-card" style="margin-bottom:16px">' +
            '<div style="white-space:pre-wrap;margin-bottom:8px">' + esc(n.description || 'Aucune description fournie.') + '</div>' +
            '<div class="svnc-muted" style="font-size:11.5px">' + (n.media_count || 0) + ' média(s) joint(s)' + (n.sponsor ? ' · Sponsor : ' + esc(n.sponsor) : '') + '</div>' +
          '</div>' +
          (canWithdraw ? '<button type="button" class="btn btn-ghost" data-act="ns-withdraw" data-id="' + esc(n.id) + '">Retirer cette information</button>' : '<div class="svnc-muted" style="font-size:12px">Le suivi de cette information est assuré par l\'équipe SportVision.</div>')
        );
      }

      function openNewsroomForm() {
        if (readOnly) { toast('Votre rôle ne permet pas d\'envoyer d\'information.'); return; }
        var teamOptions = (state.teams || []).map(function (t) { return '<option value="' + esc(t.name) + '">' + esc(t.name) + '</option>'; }).join('');
        openModal(
          '<div class="svnc-modal-head"><b style="font-size:16px">Envoyer une information</b><button type="button" class="svnc-close-x" data-act="modal-close">&times;</button></div>' +
          '<form data-act="submit-newsroom">' +
            '<div class="svnc-field"><label>Type</label><select name="type">' + NS_TYPES.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('') + '</select></div>' +
            '<div class="svnc-field"><label>Équipe</label><select name="team"><option value="">Club (toutes équipes)</option>' + teamOptions + '</select></div>' +
            '<div class="svnc-field"><label>Titre</label><input name="title" type="text" required maxlength="200"></div>' +
            '<div class="svnc-field"><label>Description</label><textarea name="description" rows="3" maxlength="2000"></textarea></div>' +
            '<button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">Envoyer à SportVision</button>' +
          '</form>'
        );
      }

      async function submitNewsroomForm(form) {
        var fd = new FormData(form);
        var title = String(fd.get('title') || '').trim();
        if (!title) { toast('Le titre est obligatoire.'); return; }
        // Le statut initial est TOUJOURS "recu" : c'est SportVision qui fait
        // progresser puis publie l'information, jamais le club directement,
        // même si la policy serveur actuelle ne l'impose pas encore.
        var payload = {
          club_id: orgId,
          type: fd.get('type') || 'Actualité',
          team: fd.get('team') || null,
          title: title,
          description: String(fd.get('description') || '').trim() || null,
          status: 'recu'
        };
        try {
          var authorId = window.localStorage ? window.localStorage.getItem('svc_uid') : null;
          if (authorId) payload.author_id = authorId;
        } catch (e) { /* localStorage indisponible : on continue sans author_id */ }

        var res;
        try { res = await sbFetch('club_newsroom_items', { method: 'POST', body: payload }); }
        catch (e) { toast('Erreur réseau lors de l\'envoi.'); return; }
        if (!res.ok) { toast('Erreur lors de l\'envoi. Réessayez.'); return; }
        closeModal();
        toast('Information envoyée à la Newsroom SportVision.');
        state.ns.items = null;
        await loadNewsroom();
      }

      async function withdrawNewsroom(id) {
        var res;
        try { res = await sbFetch('club_newsroom_items?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: { status: 'archive' } }); }
        catch (e) { toast('Erreur réseau : action impossible.'); return; }
        if (!res.ok) { toast('Action impossible.'); return; }
        closeModal();
        toast('Information retirée.');
        state.ns.items = null;
        await loadNewsroom();
      }

      // ── Planning éditorial (lecture seule) ──
      function renderPlanningHtml() {
        var out = '<div class="svnc-row"><b style="font-size:16px">Planning éditorial</b>' +
          '<span class="svnc-muted" style="font-size:12px">Alimenté par l\'équipe SportVision · lecture seule</span></div>';

        if (state.pl.error) {
          out += '<div class="svnc-error"><span>' + esc(state.pl.error) + '</span><button type="button" class="btn btn-ghost" data-act="pl-retry">Réessayer</button></div>';
        }
        if (state.pl.loading && state.pl.items === null) {
          return out + '<div class="svnc-empty">Chargement…</div>';
        }

        var items = state.pl.items || [];
        var filtered = items.filter(function (e) {
          return state.pl.team === 'toutes' || (e.team || '') === state.pl.team;
        });

        out += '<div class="svnc-pillbar">' + [['mois', 'Mois'], ['agenda', 'Agenda']].map(function (p) {
          return '<button type="button" class="svnc-pill' + (state.pl.view === p[0] ? ' on' : '') + '" data-act="pl-view" data-value="' + p[0] + '">' + p[1] + '</button>';
        }).join('') + '</div>';
        out += teamPills(state.pl.team, 'pl-filter-team');

        if (!filtered.length) {
          out += '<div class="svnc-empty">Aucun contenu programmé au planning pour le moment.</div>';
          return out;
        }

        if (state.pl.view === 'mois') {
          var weeks = monthGrid(state.pl.refDate, filtered);
          out += '<div class="svnc-card">' +
            '<div class="svnc-cal-head"><b style="font-size:14px">' + esc(monthLabel(state.pl.refDate)) + '</b>' +
              '<div class="svnc-cal-nav"><button type="button" data-act="pl-prev-month">&#8592;</button><button type="button" data-act="pl-next-month">&#8594;</button></div>' +
            '</div>' +
            '<div class="svnc-cal-grid">' + ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(function (d) {
              return '<div class="svnc-muted" style="text-align:center;font-size:11px;font-weight:700">' + d + '</div>';
            }).join('') + '</div>' +
            weeks.map(function (week) {
              return '<div class="svnc-cal-grid" style="margin-bottom:6px">' + week.map(function (day) {
                return '<button type="button" class="svnc-cal-day' + (day.today ? ' today' : '') + '" style="opacity:' + (day.inMonth ? 1 : .4) + '" data-act="pl-day" data-value="' + day.iso + '">' +
                  '<div style="font-size:11px;font-weight:700;margin-bottom:4px">' + day.label + '</div>' +
                  day.events.slice(0, 2).map(function (ev) {
                    return '<div class="svnc-cal-ev" style="background:#32D8E622;color:var(--accent-2)">' + esc(ev.title) + '</div>';
                  }).join('') +
                  (day.events.length > 2 ? '<div class="svnc-muted" style="font-size:10px">+' + (day.events.length - 2) + '</div>' : '') +
                  '</button>';
              }).join('') + '</div>';
            }).join('') +
          '</div>';
        } else {
          var sorted = filtered.slice().sort(function (a, b) { return String(a.event_date).localeCompare(String(b.event_date)); });
          out += '<div class="svnc-list">' + sorted.map(function (e) {
            return '<div class="svnc-list-row" style="cursor:default">' +
              '<div style="display:flex;gap:10px;align-items:center"><span class="svnc-dot" style="background:var(--accent-2)"></span>' +
              '<div><div style="font-weight:600;font-size:13px">' + esc(e.title) + '</div><div class="svnc-muted" style="font-size:11.5px">' + fmtDate(e.event_date) + ' · ' + esc(e.team || 'Club') + '</div></div></div>' +
            '</div>';
          }).join('') + '</div>';
        }
        return out;
      }

      function openDayModal(iso) {
        var evs = (state.pl.items || []).filter(function (e) { return e.event_date === iso; });
        openModal(
          '<div class="svnc-modal-head"><b style="font-size:16px">' + esc(fmtDate(iso)) + '</b><button type="button" class="svnc-close-x" data-act="modal-close">&times;</button></div>' +
          (evs.length ? evs.map(function (e) {
            return '<div class="svnc-card" style="margin-bottom:10px"><b style="font-size:13.5px">' + esc(e.title) + '</b><div class="svnc-muted" style="font-size:12px;margin-top:4px">' + esc(e.team || 'Club') + '</div></div>';
          }).join('') : '<div class="svnc-muted">Aucun contenu programmé ce jour-là.</div>')
        );
      }

      function changeMonth(delta) {
        var d = state.pl.refDate;
        state.pl.refDate = new Date(d.getFullYear(), d.getMonth() + delta, 1);
        paintBody();
      }

      // ─────────────────────────── délégation d'événements ───────────────────────────
      function onClick(e) {
        var el = e.target.closest('[data-act]');
        if (!el) return;
        var act = el.getAttribute('data-act');
        var val = el.getAttribute('data-value');
        switch (act) {
          case 'tab': switchTab(val); break;
          case 'ns-view': state.ns.view = val; paintBody(); break;
          case 'ns-filter-team': state.ns.team = val; paintBody(); break;
          case 'ns-filter-status': state.ns.status = val; paintBody(); break;
          case 'ns-new': openNewsroomForm(); break;
          case 'ns-item': openNewsroomDetail(el.getAttribute('data-id')); break;
          case 'ns-withdraw': withdrawNewsroom(el.getAttribute('data-id')); break;
          case 'ns-retry': state.ns.items = null; loadNewsroom(); break;
          case 'pl-view': state.pl.view = val; paintBody(); break;
          case 'pl-filter-team': state.pl.team = val; paintBody(); break;
          case 'pl-prev-month': changeMonth(-1); break;
          case 'pl-next-month': changeMonth(1); break;
          case 'pl-day': openDayModal(val); break;
          case 'pl-retry': state.pl.items = null; loadPlanning(); break;
          case 'modal-close': closeModal(); break;
          case 'modal-backdrop': if (e.target === el) closeModal(); break;
          default: break;
        }
      }

      function onSubmit(e) {
        var form = e.target.closest('[data-act]');
        if (!form) return;
        if (form.getAttribute('data-act') === 'submit-newsroom') {
          e.preventDefault();
          submitNewsroomForm(form);
        }
      }

      container.addEventListener('click', onClick);
      container.addEventListener('submit', onSubmit);
      container.__svncCleanup = function () {
        container.removeEventListener('click', onClick);
        container.removeEventListener('submit', onSubmit);
        closeModal();
        container.__svncCleanup = null;
      };

      // ─────────────────────────────── démarrage ───────────────────────────────
      paintTabsActive();
      q('.svnc-body').innerHTML = '<div class="svnc-empty">Chargement…</div>';
      await loadTeams();
      switchTab('newsroom');
    }
  };
})();
