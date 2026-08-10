/* ============================================================
 * SportVision Connect — Module Coach
 * Accueil · Joueurs suivis · Planning · Demandes
 *
 * Espace neuf (aucun équivalent existant côté SportVision à porter,
 * cf. migration-connect-v3-coach-academie-requests.sql). S'appuie sur
 * 3 tables : coach_players (propre au coach) et les 2 tables
 * génériques `calendar_events` (lecture seule — alimentée par
 * SportVision) et `requests` (création uniquement via submit_request(),
 * jamais d'INSERT direct — refusé par la policy).
 *
 * S'appuie sur les globales déjà fournies par le shell Connect
 * (index.html, chargé avant ce fichier) : sbFetch, sbRpc, sbFunction,
 * esc, toast, ainsi que les variables CSS --card/--border/--radius/
 * --shadow/--accent/--accent-2/--muted/--text/--ok/--danger et les
 * classes .btn/.btn-primary/.btn-ghost/.badge.
 *
 * Architecture (même pattern que les modules Club déjà livrés) :
 * chaque entrée de window.CoachModules est autonome — son
 * render(container, orgId, ctx) recrée un état dans une closure dédiée
 * à chaque appel, et rejoue container.innerHTML + les gestionnaires
 * d'événements (assignés via container.onclick =, jamais
 * addEventListener, pour ne jamais accumuler de doublons quand
 * render() est rappelé sur le même noeud).
 *
 * Rappel d'architecture Connect : pour un espace de type coach,
 * orgId === organizations.id de l'organisation coach elle-même
 * (un coach EST une organisation, comme un club). Il remplace
 * organization_id directement dans toutes les requêtes ci-dessous.
 * ctx.role peut valoir 'proprietaire' | 'assistant' |
 * 'resp_communication' | 'collaborateur_limite' — catalogue prévu
 * mais pas encore appliqué techniquement : on affiche les actions
 * normalement et on laisse le serveur (policies/RLS) trancher en cas
 * de refus, plutôt que de deviner des règles côté client.
 * ============================================================ */
(function () {
  'use strict';

  /* ── Styles partagés, injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('coach-shared-style')) return;
    const style = document.createElement('style');
    style.id = 'coach-shared-style';
    style.textContent = `
      .co-wrap .btn{width:auto;margin-top:0}
      .co-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .co-toolbar h2{margin:0;font-size:19px}
      .co-pillbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .co-pill{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;padding:6px 14px;font-size:12.5px;cursor:pointer;font-weight:600}
      .co-pill:not(.on):hover{border-color:var(--accent);color:var(--text)}
      .co-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}
      .co-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}
      .co-list{display:flex;flex-direction:column;gap:8px}
      .co-row{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit}
      .co-row:hover{border-color:var(--accent)}
      .co-row .t{font-weight:700;font-size:14px}
      .co-row .m{color:var(--muted);font-size:12px;margin-top:2px}
      .co-field{margin-bottom:12px}
      .co-field label{display:block;font-size:12.5px;font-weight:600;margin-bottom:5px}
      .co-field input,.co-field select,.co-field textarea{width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box}
      .co-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .co-overlay{position:fixed;inset:0;background:rgba(10,14,30,.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;overflow:auto}
      .co-modal{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px;max-width:460px;width:100%;max-height:88vh;overflow:auto}
      .co-modal.wide{max-width:600px}
      .co-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
      .co-close{background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--muted);line-height:1;padding:2px}
      .co-comment{background:rgba(0,0,0,.03);border-radius:10px;padding:8px 10px;margin-bottom:6px;font-size:12.5px}
      .co-info{border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12.5px;margin-bottom:12px}
      .co-warn{border-color:#F0A94E55;background:rgba(226,160,63,.08)}
      .co-actions{display:flex;flex-direction:column;gap:8px;margin-top:14px}
      .co-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px}
      .co-stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
      .co-stat .n{font-size:26px;font-weight:800;color:var(--accent)}
      .co-stat .l{font-size:12.5px;color:var(--muted);margin-top:2px}
      .co-section{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:14px}
      .co-section h3{margin:0 0 10px;font-size:14.5px}
    `;
    document.head.appendChild(style);
  }

  /* ── Formattage / libellés partagés ── */
  function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }

  const REQUEST_STATUSES = ['recues', 'info_manquante', 'en_traitement', 'prete_a_creer', 'terminee', 'refusee'];
  function statusMeta(status) {
    return {
      recues: { label: 'Reçue', color: 'var(--accent)' },
      info_manquante: { label: 'Informations manquantes', color: '#e2a03f' },
      en_traitement: { label: 'En traitement', color: 'var(--purple)' },
      prete_a_creer: { label: 'Prête à créer', color: 'var(--accent-2)' },
      terminee: { label: 'Terminée', color: 'var(--ok)' },
      refusee: { label: 'Refusée', color: 'var(--danger)' }
    }[status] || { label: status || '—', color: 'var(--muted)' };
  }

  // Hypothèse (aucun catalogue de types de demande n'existe encore pour l'espace
  // Coach côté base — contrairement à club_requests, `requests` ne contraint pas
  // `type` par un check constraint). Catalogue posé ici à titre indicatif ; le
  // serveur accepte n'importe quelle chaîne, donc rien ne casse si ce catalogue
  // évolue plus tard sans migration.
  const REQUEST_TYPES = ['tournage_seance', 'montage_highlights', 'portrait_joueur', 'communication_reseaux', 'autre'];
  function requestTypeLabel(type) {
    return {
      tournage_seance: 'Tournage d’une séance',
      montage_highlights: 'Montage highlights',
      portrait_joueur: 'Portrait joueur',
      communication_reseaux: 'Communication réseaux sociaux',
      autre: 'Autre demande'
    }[type] || (type || '—');
  }

  // Idem pour les types d'événement du planning : `calendar_events.type` n'est pas
  // contraint (default 'contenu'), c'est SportVision qui les choisit en alimentant
  // la table. Ce catalogue ne sert qu'à l'affichage (libellé + couleur), avec repli
  // générique pour tout type non prévu ici.
  function eventTypeLabel(type) {
    return {
      seance: 'Séance', tournage: 'Tournage', contenu: 'Contenu', stage: 'Stage',
      match: 'Match', evenement: 'Événement', livraison: 'Livraison'
    }[type] || (type || 'Événement');
  }
  function eventTypeColor(type) {
    return {
      seance: 'var(--accent)', tournage: 'var(--purple)', contenu: 'var(--accent-2)', stage: '#e2a03f',
      match: 'var(--ok)', evenement: 'var(--muted)', livraison: 'var(--danger)'
    }[type] || 'var(--muted)';
  }

  window.CoachModules = window.CoachModules || {};

  /* ============================================================
   * 1. ACCUEIL — résumé (joueurs suivis, prochaine séance, demandes en cours)
   * ============================================================ */
  window.CoachModules.accueil = {
    label: 'Accueil',
    espace: 'coach',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let loaded = false;
      let playersCount = 0;
      let nextEvent = null;
      let openRequestsCount = 0;
      let recentRequests = [];

      async function load() {
        const [playersRes, eventsRes, requestsRes] = await Promise.all([
          sbFetch('coach_players?organization_id=eq.' + orgId + '&select=id'),
          sbFetch('calendar_events?organization_id=eq.' + orgId + '&event_date=gte.' + todayISO() + '&select=*&order=event_date.asc&limit=1'),
          sbFetch('requests?organization_id=eq.' + orgId + '&select=*&order=created_at.desc&limit=5')
        ]);
        playersCount = playersRes.ok ? (playersRes.data || []).length : 0;
        nextEvent = eventsRes.ok && eventsRes.data && eventsRes.data[0] ? eventsRes.data[0] : null;
        if (!requestsRes.ok) toast('Erreur de chargement.');
        recentRequests = requestsRes.ok ? (requestsRes.data || []) : [];
        openRequestsCount = recentRequests.filter(function (r) { return r.status !== 'terminee' && r.status !== 'refusee'; }).length;
        loaded = true;
      }

      function paint() {
        if (!loaded) {
          container.innerHTML = '<div class="co-wrap"><div class="co-empty">Chargement…</div></div>';
          return;
        }
        container.innerHTML = `<div class="co-wrap">
          <div class="co-toolbar"><h2>Accueil</h2><button class="btn btn-ghost" data-action="refresh">Actualiser</button></div>
          <div class="co-stats">
            <div class="co-stat"><div class="n">${playersCount}</div><div class="l">Joueur${playersCount > 1 ? 's' : ''} suivi${playersCount > 1 ? 's' : ''}</div></div>
            <div class="co-stat"><div class="n">${nextEvent ? fmtDate(nextEvent.event_date) : '—'}</div><div class="l">Prochaine séance au planning</div></div>
            <div class="co-stat"><div class="n">${openRequestsCount}</div><div class="l">Demande${openRequestsCount > 1 ? 's' : ''} en cours</div></div>
          </div>
          <div class="co-section">
            <h3>Prochaine séance</h3>
            ${nextEvent
              ? `<div class="t" style="font-weight:700">${esc(nextEvent.title)}</div>
                 <div class="m" style="color:var(--muted);font-size:12.5px;margin-top:4px">${esc(eventTypeLabel(nextEvent.type))} · ${fmtDate(nextEvent.event_date)}${nextEvent.context ? ' · ' + esc(nextEvent.context) : ''}</div>`
              : '<div class="m" style="color:var(--muted)">Aucune séance à venir au planning pour le moment.</div>'}
          </div>
          <div class="co-section">
            <h3>Demandes récentes</h3>
            ${recentRequests.length ? '<div class="co-list">' + recentRequests.map(function (r) {
              const sm = statusMeta(r.status);
              return `<div class="co-row" style="cursor:default">
                <div><div class="t">${esc(requestTypeLabel(r.type))}</div><div class="m">${fmtDate(r.created_at)}</div></div>
                <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
              </div>`;
            }).join('') + '</div>' : '<div class="m" style="color:var(--muted)">Aucune demande envoyée pour le moment.</div>'}
          </div>
        </div>`;
        bind();
      }

      function bind() {
        container.onclick = async function (e) {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          if (btn.getAttribute('data-action') === 'refresh') {
            loaded = false; paint();
            await load(); paint();
          }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 2. JOUEURS SUIVIS (coach_players) — CRUD simple
   * ============================================================ */
  window.CoachModules.joueurs = {
    label: 'Joueurs suivis',
    espace: 'coach',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let players = [];
      let loaded = false;
      let form = null; // {id?, prenom, nom, categorie, notes}

      async function load() {
        const res = await sbFetch('coach_players?organization_id=eq.' + orgId + '&select=*&order=nom.asc');
        if (!res.ok) toast('Erreur de chargement.');
        players = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      function row(p) {
        const name = ((p.prenom || '') + ' ' + (p.nom || '')).trim() || '(sans nom)';
        return `<div class="co-row" style="cursor:default">
          <div>
            <div class="t">${esc(name)}</div>
            <div class="m">${p.categorie ? esc(p.categorie) : 'Catégorie non renseignée'}${p.notes ? ' · ' + esc(p.notes) : ''}</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button class="btn btn-ghost" data-action="edit" data-id="${p.id}">Modifier</button>
            <button class="btn btn-ghost" style="color:var(--danger)" data-action="delete" data-id="${p.id}">Supprimer</button>
          </div>
        </div>`;
      }

      function formHtml() {
        if (!form) return '';
        return `<div class="co-overlay" data-action="overlay-form">
          <div class="co-modal">
            <div class="co-drawer-head"><b>${form.id ? 'Modifier le joueur' : 'Ajouter un joueur'}</b><button class="co-close" data-action="close-form">✕</button></div>
            <div class="co-row2">
              <div class="co-field"><label>Prénom</label><input type="text" data-field="pf-prenom" value="${esc(form.prenom)}"></div>
              <div class="co-field"><label>Nom</label><input type="text" data-field="pf-nom" value="${esc(form.nom)}"></div>
            </div>
            <div class="co-field"><label>Catégorie</label><input type="text" data-field="pf-categorie" value="${esc(form.categorie)}" placeholder="ex : U15, Seniors…"></div>
            <div class="co-field"><label>Notes</label><textarea rows="3" data-field="pf-notes">${esc(form.notes)}</textarea></div>
            <button class="btn btn-primary" data-action="submit-form">${form.id ? 'Enregistrer' : 'Ajouter'}</button>
          </div>
        </div>`;
      }

      function paint() {
        const content = !loaded ? '<div class="co-empty">Chargement…</div>'
          : (players.length ? ('<div class="co-list">' + players.map(row).join('') + '</div>') : '<div class="co-empty">Aucun joueur suivi pour le moment.</div>');
        container.innerHTML = `<div class="co-wrap">
          <div class="co-toolbar"><h2>Joueurs suivis</h2><button class="btn btn-primary" data-action="new">+ Ajouter un joueur</button></div>
          ${content}
          ${formHtml()}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value.trim() : '';
      }
      function syncForm() {
        if (!form) return;
        if (container.querySelector('[data-field="pf-prenom"]')) form.prenom = fieldVal('pf-prenom');
        if (container.querySelector('[data-field="pf-nom"]')) form.nom = fieldVal('pf-nom');
        if (container.querySelector('[data-field="pf-categorie"]')) form.categorie = fieldVal('pf-categorie');
        if (container.querySelector('[data-field="pf-notes"]')) form.notes = fieldVal('pf-notes');
      }

      async function submitForm() {
        syncForm();
        if (!form.prenom) { toast('Le prénom du joueur est obligatoire.'); return; }
        const body = {
          prenom: form.prenom,
          nom: form.nom || null,
          categorie: form.categorie || null,
          notes: form.notes || null
        };
        let res;
        if (form.id) {
          body.updated_at = new Date().toISOString();
          res = await sbFetch('coach_players?id=eq.' + form.id, { method: 'PATCH', body: body });
        } else {
          body.organization_id = orgId;
          res = await sbFetch('coach_players', { method: 'POST', body: body });
        }
        if (!res.ok) { toast('Erreur lors de l’enregistrement du joueur.'); return; }
        toast(form.id ? 'Joueur mis à jour.' : 'Joueur ajouté.');
        form = null;
        await load(); paint();
      }

      async function deletePlayer(id) {
        if (!confirm('Supprimer ce joueur suivi ? Cette action est définitive.')) return;
        const res = await sbFetch('coach_players?id=eq.' + id, { method: 'DELETE' });
        if (!res.ok) { toast('Erreur lors de la suppression.'); return; }
        toast('Joueur supprimé.');
        await load(); paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay-form"]');
          if (overlay && e.target === overlay) { form = null; paint(); return; }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'new') { form = { prenom: '', nom: '', categorie: '', notes: '' }; paint(); }
          else if (action === 'close-form') { form = null; paint(); }
          else if (action === 'edit') {
            const p = players.find(function (x) { return x.id === btn.getAttribute('data-id'); });
            if (!p) return;
            form = { id: p.id, prenom: p.prenom || '', nom: p.nom || '', categorie: p.categorie || '', notes: p.notes || '' };
            paint();
          }
          else if (action === 'delete') { await deletePlayer(btn.getAttribute('data-id')); }
          else if (action === 'submit-form') { await submitForm(); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 3. PLANNING (calendar_events) — lecture seule, alimenté par SportVision
   * ============================================================ */
  window.CoachModules.planning = {
    label: 'Planning',
    espace: 'coach',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let events = [];
      let loaded = false;
      let filter = 'avenir'; // 'avenir' | 'toutes'

      async function load() {
        const res = await sbFetch('calendar_events?organization_id=eq.' + orgId + '&select=*&order=event_date.asc');
        if (!res.ok) toast('Erreur de chargement.');
        events = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      function row(ev) {
        const color = eventTypeColor(ev.type);
        return `<div class="co-row" style="cursor:default">
          <div style="display:flex;gap:10px;align-items:center">
            <span style="width:7px;height:7px;border-radius:4px;flex-shrink:0;background:${color}"></span>
            <div>
              <div class="t">${esc(ev.title)}</div>
              <div class="m">${fmtDate(ev.event_date)}${ev.context ? ' · ' + esc(ev.context) : ''}</div>
            </div>
          </div>
          <span class="badge" style="background:${color}22;color:${color}">${esc(eventTypeLabel(ev.type))}</span>
        </div>`;
      }

      function paint() {
        let listHtml;
        if (!loaded) {
          listHtml = '<div class="co-empty">Chargement…</div>';
        } else {
          const today = todayISO();
          const filtered = events.filter(function (ev) { return filter === 'toutes' || ev.event_date >= today; });
          listHtml = filtered.length ? ('<div class="co-list">' + filtered.map(row).join('') + '</div>') : '<div class="co-empty">Aucune séance ' + (filter === 'avenir' ? 'à venir' : '') + ' au planning pour le moment. C’est SportVision qui alimente ce planning.</div>';
        }
        container.innerHTML = `<div class="co-wrap">
          <div class="co-toolbar"><h2>Planning</h2></div>
          <div class="co-pillbar">
            <button class="co-pill${filter === 'avenir' ? ' on' : ''}" data-action="filter" data-filter="avenir">À venir</button>
            <button class="co-pill${filter === 'toutes' ? ' on' : ''}" data-action="filter" data-filter="toutes">Toutes</button>
          </div>
          ${listHtml}
        </div>`;
        bind();
      }

      function bind() {
        container.onclick = function (e) {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          if (btn.getAttribute('data-action') === 'filter') { filter = btn.getAttribute('data-filter'); paint(); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 4. DEMANDES (requests + submit_request/update_request_status)
   * ============================================================ */
  window.CoachModules.demandes = {
    label: 'Demandes',
    espace: 'coach',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let items = [];
      let loaded = false;
      let filter = 'toutes';
      let openId = null;
      let form = null; // {type, urgency, detail}
      let myName = null;

      // Hypothèse : `profiles` (prenom/nom) existe pour tout utilisateur authentifié
      // sur l'écosystème SportVision (aucune table `coach_members` équivalente à
      // club_members n'existe pour cet espace). Repli silencieux sur 'Vous' si la
      // lecture échoue — n'affecte que la signature du commentaire, jamais l'envoi.
      async function myDisplayName() {
        if (myName) return myName;
        const uid = localStorage.getItem('svc_uid');
        if (!uid) return 'Vous';
        const res = await sbFetch('profiles?id=eq.' + uid + '&select=prenom,nom&limit=1');
        if (res.ok && res.data && res.data[0]) {
          const n = (((res.data[0].prenom || '') + ' ' + (res.data[0].nom || '')).trim());
          myName = n || 'Vous';
        } else myName = 'Vous';
        return myName;
      }

      async function load() {
        const res = await sbFetch('requests?organization_id=eq.' + orgId + '&select=*&order=created_at.desc');
        if (!res.ok) toast('Erreur de chargement.');
        items = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      function row(r) {
        const sm = statusMeta(r.status);
        return `<button class="co-row" data-action="open" data-id="${r.id}">
          <div style="display:flex;gap:10px;align-items:center">
            <span style="width:7px;height:7px;border-radius:4px;flex-shrink:0;background:${r.urgency === 'haute' ? 'var(--danger)' : 'var(--border)'}"></span>
            <div>
              <div class="t">${esc(requestTypeLabel(r.type))}</div>
              <div class="m">${fmtDate(r.created_at)}</div>
            </div>
          </div>
          <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
        </button>`;
      }

      function drawerHtml() {
        if (!openId) return '';
        const r = items.find(function (x) { return x.id === openId; });
        if (!r) return '';
        const sm = statusMeta(r.status);
        const missing = Array.isArray(r.missing) ? r.missing : [];
        const comments = Array.isArray(r.comments) ? r.comments : [];
        return `<div class="co-overlay" data-action="overlay">
          <div class="co-modal wide">
            <div class="co-drawer-head">
              <div>
                <b style="font-size:16px">${esc(requestTypeLabel(r.type))}</b>
                <div class="m" style="margin-top:2px">${fmtDate(r.created_at)}</div>
              </div>
              <button class="co-close" data-action="close">✕</button>
            </div>
            <span class="badge" style="background:${sm.color}22;color:${sm.color};margin-bottom:14px;display:inline-block">${esc(sm.label)}</span>
            ${r.credits_reserved ? `<div class="co-info co-warn">${r.credits_reserved} crédit(s) réservé(s) — débités seulement si SportVision accepte la demande, sinon restitués.</div>` : ''}
            ${missing.length ? `<div class="co-info co-warn"><b style="display:block;margin-bottom:4px;font-size:11.5px;color:var(--warn)">INFORMATIONS MANQUANTES</b>${missing.map(function (m) { return '<div>• ' + esc(m) + '</div>'; }).join('')}</div>` : ''}
            <div class="co-info"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">DÉTAIL</div>${esc(r.detail || '—')}</div>
            <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:8px">COMMENTAIRES</div>
            ${comments.length ? comments.map(function (c) {
              return '<div class="co-comment"><b>' + esc(c.author || '—') + '</b> <span style="color:var(--muted)">· ' + esc(c.date || '') + '</span><div style="margin-top:3px">' + esc(c.text || '') + '</div></div>';
            }).join('') : '<div class="m" style="margin-bottom:10px">Aucun commentaire.</div>'}
            <div style="display:flex;gap:8px;margin-top:10px">
              <input type="text" data-field="req-comment" placeholder="Ajouter un commentaire…" style="flex:1;padding:9px 10px;border:1px solid var(--border);border-radius:8px">
              <button class="btn btn-primary" data-action="comment" data-id="${r.id}">Envoyer</button>
            </div>
            ${r.status === 'recues' ? `<button class="btn btn-ghost" style="margin-top:14px;color:var(--danger)" data-action="cancel" data-id="${r.id}">Annuler la demande</button>` : ''}
          </div>
        </div>`;
      }

      function formHtml() {
        if (!form) return '';
        return `<div class="co-overlay" data-action="overlay-form">
          <div class="co-modal">
            <div class="co-drawer-head"><b>Nouvelle demande</b><button class="co-close" data-action="close-form">✕</button></div>
            <div class="co-field"><label>Type de demande</label><select data-field="rf-type">
              ${REQUEST_TYPES.map(function (t) { return '<option value="' + t + '" ' + (t === form.type ? 'selected' : '') + '>' + esc(requestTypeLabel(t)) + '</option>'; }).join('')}
            </select></div>
            <div class="co-field"><label>Urgence</label><select data-field="rf-urgency">
              <option value="normale" ${form.urgency === 'normale' ? 'selected' : ''}>Normale</option>
              <option value="haute" ${form.urgency === 'haute' ? 'selected' : ''}>Haute</option>
            </select></div>
            <div class="co-field"><label>Détail</label><textarea rows="4" data-field="rf-detail" placeholder="Décrivez votre demande…">${esc(form.detail)}</textarea></div>
            <div class="m" style="margin-bottom:10px">La demande sera envoyée à SportVision pour vérification. Les crédits éventuellement nécessaires sont évalués par SportVision au traitement.</div>
            <button class="btn btn-primary" data-action="submit-form">Envoyer la demande</button>
          </div>
        </div>`;
      }

      function paint() {
        let listHtml;
        if (!loaded) {
          listHtml = '<div class="co-empty">Chargement…</div>';
        } else {
          const filtered = items.filter(function (r) { return filter === 'toutes' || r.status === filter; });
          listHtml = filtered.length ? ('<div class="co-list">' + filtered.map(row).join('') + '</div>') : '<div class="co-empty">Aucune demande dans ce statut pour le moment.</div>';
        }
        container.innerHTML = `<div class="co-wrap">
          <div class="co-toolbar"><h2>Demandes</h2><button class="btn btn-primary" data-action="new">+ Nouvelle demande</button></div>
          <div class="co-pillbar">${['toutes'].concat(REQUEST_STATUSES).map(function (st) {
            return '<button class="co-pill' + (filter === st ? ' on' : '') + '" data-action="filter" data-status="' + st + '">' + (st === 'toutes' ? 'Toutes' : esc(statusMeta(st).label)) + '</button>';
          }).join('')}</div>
          ${listHtml}
          ${drawerHtml()}
          ${formHtml()}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value : '';
      }
      function syncForm() {
        if (!form) return;
        if (container.querySelector('[data-field="rf-type"]')) form.type = fieldVal('rf-type');
        if (container.querySelector('[data-field="rf-urgency"]')) form.urgency = fieldVal('rf-urgency');
        if (container.querySelector('[data-field="rf-detail"]')) form.detail = fieldVal('rf-detail');
      }

      async function submitForm() {
        syncForm();
        const res = await sbRpc('submit_request', {
          p_organization_id: orgId,
          p_type: form.type,
          p_urgency: form.urgency,
          p_detail: form.detail || '—',
          p_credits: 0
        });
        if (!res.ok) { toast("Erreur lors de l'envoi de la demande."); return; }
        form = null;
        toast('Demande envoyée à SportVision.');
        await load(); paint();
      }

      async function cancelRequest(id) {
        const res = await sbRpc('update_request_status', { p_request_id: id, p_status: 'refusee' });
        if (!res.ok) { toast("Action impossible : cette demande n'est plus annulable."); return; }
        openId = null;
        toast('Demande annulée.');
        await load(); paint();
      }

      async function addComment(id) {
        const input = container.querySelector('[data-field="req-comment"]');
        const text = input ? input.value.trim() : '';
        if (!text) return;
        const rowItem = items.find(function (x) { return x.id === id; });
        if (!rowItem) return;
        const author = await myDisplayName();
        const comments = (Array.isArray(rowItem.comments) ? rowItem.comments : []).concat([{ author: author, text: text, date: new Date().toLocaleDateString('fr-FR') }]);
        const res = await sbFetch('requests?id=eq.' + id, { method: 'PATCH', body: { comments: comments } });
        if (!res.ok) { toast('Action impossible.'); return; }
        rowItem.comments = comments;
        paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay"],[data-action="overlay-form"]');
          if (overlay && e.target === overlay) {
            if (overlay.getAttribute('data-action') === 'overlay') openId = null; else form = null;
            paint(); return;
          }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'filter') { filter = btn.getAttribute('data-status'); paint(); }
          else if (action === 'open') { openId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close') { openId = null; paint(); }
          else if (action === 'new') { form = { type: REQUEST_TYPES[0], urgency: 'normale', detail: '' }; paint(); }
          else if (action === 'close-form') { form = null; paint(); }
          else if (action === 'submit-form') { await submitForm(); }
          else if (action === 'cancel') { await cancelRequest(btn.getAttribute('data-id')); }
          else if (action === 'comment') { await addComment(btn.getAttribute('data-id')); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 5. ADMINISTRATION (memberships + org-invite) — liste des membres
   * et invitation, réservée au rôle 'proprietaire'
   * ============================================================ */

  // Catalogue de rôles pour une organisation Coach (aligné sur ROLE_CATALOG.coach
  // dans supabase/functions/org-invite/index.ts — à faire évoluer ensemble si ce
  // catalogue change côté serveur, sinon le formulaire proposerait un rôle refusé).
  const MEMBER_ROLES = ['proprietaire', 'assistant', 'resp_communication', 'collaborateur_limite'];
  function memberRoleMeta(role) {
    return {
      proprietaire: { label: 'Propriétaire' },
      assistant: { label: 'Assistant' },
      resp_communication: { label: 'Responsable communication' },
      collaborateur_limite: { label: 'Collaborateur limité' }
    }[role] || { label: role || '—' };
  }

  // `memberships.status` : 'actif' (invitation acceptée), 'invitation' (en attente),
  // 'suspendu' (accès coupé — uniquement modifiable par le staff SportVision).
  function memberStatusMeta(status) {
    return {
      actif: { label: 'Actif', color: 'var(--ok)' },
      invitation: { label: 'Invitation en attente', color: '#e2a03f' },
      suspendu: { label: 'Suspendu', color: 'var(--danger)' }
    }[status] || { label: status || '—', color: 'var(--muted)' };
  }

  window.CoachModules.administration = {
    label: 'Administration',
    espace: 'coach',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let members = [];
      let loaded = false;
      let form = null; // {email, prenom, nom, role}
      let sending = false;
      const canInvite = !!(ctx && ctx.role === 'proprietaire');
      const myUid = localStorage.getItem('svc_uid');

      // Catalogue de rôles Coach lu dynamiquement en base (organization_role_catalog,
      // migration-connect-v6-org-admin.sql) plutôt que codé en dur, pour la gestion
      // du rôle d'un AUTRE membre — évite toute divergence si ce catalogue évolue
      // côté serveur. MEMBER_ROLES (ci-dessus, formulaire d'invitation) n'est pas
      // touché ici : hors périmètre de cette évolution.
      let roleCatalog = [];

      async function load() {
        const res = await sbFetch('memberships?organization_id=eq.' + orgId + '&select=*&order=created_at.asc');
        if (!res.ok) toast('Erreur de chargement.');
        members = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      async function loadRoleCatalog() {
        if (!canInvite) return; // seul un admin voit/utilise ce catalogue ici
        const res = await sbFetch('organization_role_catalog?organization_type=eq.coach&select=role_key,label,is_default');
        if (!res.ok) toast('Erreur de chargement.');
        roleCatalog = res.ok ? (res.data || []) : [];
      }

      // Pas de jointure possible vers profiles/auth.users depuis ce client pour
      // afficher un nom (accès en lecture non garanti sur un autre utilisateur) —
      // on affiche donc chaque membre par rôle/statut/date, sans nom, plutôt que
      // d'inventer une information qu'on ne peut pas récupérer honnêtement.
      function row(m) {
        const rm = memberRoleMeta(m.role);
        const sm = memberStatusMeta(m.status);
        const isSelf = !!(myUid && m.user_id === myUid);
        // Un admin ne peut jamais se gérer lui-même par ce mécanisme (protection
        // contre un verrouillage accidentel de l'organisation — cf. trigger SQL) :
        // aucun contrôle de gestion sur sa propre ligne, uniquement sur les autres.
        const manageable = canInvite && !isSelf;
        const roleOptions = roleCatalog.length ? roleCatalog.map(function (r) { return { role_key: r.role_key, label: r.label }; }) : MEMBER_ROLES.map(function (r) { return { role_key: r, label: memberRoleMeta(r).label }; });
        return `<div class="co-row" style="cursor:default;${manageable ? 'flex-wrap:wrap' : ''}">
          <div>
            <div class="t">${esc(rm.label)}${isSelf ? ' <span style="color:var(--muted);font-weight:400">(vous)</span>' : ''}</div>
            <div class="m">Membre depuis le ${fmtDate(m.created_at)}${m.source ? ' · ' + esc(m.source) : ''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
            ${manageable ? `
              <select data-field="mrole-${m.id}" style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:12.5px">
                ${roleOptions.map(function (r) { return '<option value="' + esc(r.role_key) + '" ' + (r.role_key === m.role ? 'selected' : '') + '>' + esc(r.label) + '</option>'; }).join('')}
              </select>
              <button class="btn btn-ghost" data-action="change-role" data-id="${m.id}">Changer le rôle</button>
              <button class="btn btn-ghost" style="${m.status === 'suspendu' ? '' : 'color:var(--danger)'}" data-action="toggle-status" data-id="${m.id}" data-status="${esc(m.status)}">${m.status === 'suspendu' ? 'Réactiver' : 'Suspendre'}</button>
            ` : ''}
          </div>
        </div>`;
      }

      function formHtml() {
        if (!form) return '';
        return `<div class="co-overlay" data-action="overlay-form">
          <div class="co-modal">
            <div class="co-drawer-head"><b>Inviter un membre</b><button class="co-close" data-action="close-form">✕</button></div>
            <div class="co-row2">
              <div class="co-field"><label>Prénom</label><input type="text" data-field="mf-prenom" value="${esc(form.prenom)}"></div>
              <div class="co-field"><label>Nom</label><input type="text" data-field="mf-nom" value="${esc(form.nom)}"></div>
            </div>
            <div class="co-field"><label>E-mail</label><input type="email" data-field="mf-email" value="${esc(form.email)}" placeholder="prenom.nom@exemple.fr"></div>
            <div class="co-field"><label>Rôle</label><select data-field="mf-role">
              ${MEMBER_ROLES.map(function (r) { return '<option value="' + r + '" ' + (r === form.role ? 'selected' : '') + '>' + esc(memberRoleMeta(r).label) + '</option>'; }).join('')}
            </select></div>
            <div class="m" style="margin-bottom:10px">Un e-mail d’invitation sera envoyé pour créer le compte (ou rattacher un compte existant) à cette organisation.</div>
            <button class="btn btn-primary" data-action="submit-form"${sending ? ' disabled' : ''}>${sending ? 'Envoi…' : 'Envoyer l’invitation'}</button>
          </div>
        </div>`;
      }

      function paint() {
        const content = !loaded ? '<div class="co-empty">Chargement…</div>'
          : (members.length ? ('<div class="co-list">' + members.map(row).join('') + '</div>') : '<div class="co-empty">Aucun membre pour le moment.</div>');
        container.innerHTML = `<div class="co-wrap">
          <div class="co-toolbar"><h2>Administration</h2>${canInvite ? '<button class="btn btn-primary" data-action="new">+ Inviter un membre</button>' : ''}</div>
          <div class="co-section">
            <h3>Membres de l’organisation</h3>
            ${content}
          </div>
          ${canInvite ? formHtml() : ''}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value.trim() : '';
      }
      function syncForm() {
        if (!form) return;
        if (container.querySelector('[data-field="mf-prenom"]')) form.prenom = fieldVal('mf-prenom');
        if (container.querySelector('[data-field="mf-nom"]')) form.nom = fieldVal('mf-nom');
        if (container.querySelector('[data-field="mf-email"]')) form.email = fieldVal('mf-email');
        if (container.querySelector('[data-field="mf-role"]')) form.role = fieldVal('mf-role');
      }

      async function submitForm() {
        syncForm();
        if (!form.email) { toast('L’e-mail est obligatoire.'); return; }
        sending = true; paint();
        const res = await sbFunction('org-invite', {
          email: form.email,
          prenom: form.prenom || '',
          nom: form.nom || '',
          organization_id: orgId,
          role: form.role
        });
        sending = false;
        if (!res.ok) {
          const msg = (res.data && res.data.error) ? res.data.error : "Erreur lors de l’envoi de l’invitation.";
          toast(msg);
          paint();
          return;
        }
        if (res.data && res.data.already_invited) {
          toast('Cette personne est déjà membre de l’organisation.');
        } else {
          toast('Invitation envoyée.');
        }
        form = null;
        await load(); paint();
      }

      async function changeRole(id) {
        const sel = container.querySelector('[data-field="mrole-' + id + '"]');
        const role = sel ? sel.value : '';
        if (!role) return;
        const res = await sbFetch('memberships?id=eq.' + id, { method: 'PATCH', body: { role: role } });
        if (!res.ok) {
          toast((res.data && res.data.message) || 'Erreur lors du changement de rôle.');
          return;
        }
        toast('Rôle mis à jour.');
        await load(); paint();
      }

      async function toggleStatus(id, currentStatus) {
        const nextStatus = currentStatus === 'suspendu' ? 'actif' : 'suspendu';
        const res = await sbFetch('memberships?id=eq.' + id, { method: 'PATCH', body: { status: nextStatus } });
        if (!res.ok) {
          toast((res.data && res.data.message) || 'Erreur lors du changement de statut.');
          return;
        }
        toast(nextStatus === 'suspendu' ? 'Membre suspendu.' : 'Membre réactivé.');
        await load(); paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay-form"]');
          if (overlay && e.target === overlay) { form = null; paint(); return; }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'new') { form = { prenom: '', nom: '', email: '', role: MEMBER_ROLES[0] }; paint(); }
          else if (action === 'close-form') { form = null; paint(); }
          else if (action === 'submit-form') { await submitForm(); }
          else if (action === 'change-role') { await changeRole(btn.getAttribute('data-id')); }
          else if (action === 'toggle-status') { await toggleStatus(btn.getAttribute('data-id'), btn.getAttribute('data-status')); }
        };
      }

      await load();
      await loadRoleCatalog();
      paint();
    }
  };
})();
