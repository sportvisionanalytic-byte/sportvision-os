/* ============================================================
 * SportVision Connect — Module Académie
 * Groupes · Participants · Stages & Planning · Demandes · Accueil
 *
 * Construction neuve (aucun équivalent existant à porter, cf. audit
 * Lot 0 — les tables `formation_*` sont la formation RH interne des
 * collaborateurs SportVision et ne sont JAMAIS utilisées ici). S'appuie
 * sur le socle créé par migration-connect-v3-coach-academie-requests.sql :
 * `academie_groups`, `academie_participants` (dédiées), et les tables
 * génériques `calendar_events` (lecture seule) et `requests` (RPC
 * submit_request / update_request_status uniquement, jamais d'INSERT
 * direct).
 *
 * S'appuie sur les globales déjà fournies par le shell Connect
 * (index.html, chargé avant ce fichier) : sbFetch, sbRpc, esc, toast,
 * ainsi que les variables CSS --card/--border/etc. et les classes
 * .btn/.btn-primary/.btn-ghost/.badge.
 *
 * Architecture : chaque entrée de window.AcademieModules est autonome —
 * son render(container, orgId, ctx) recrée un état dans une closure
 * dédiée à chaque appel, et rejoue container.innerHTML + les
 * gestionnaires d'événements (assignés via container.onclick =, jamais
 * addEventListener, pour ne jamais accumuler de doublons quand render()
 * est rappelé sur le même noeud).
 *
 * Rappel d'architecture Connect v2/v3 : orgId === organizations.id pour
 * une organisation de type académie. Toutes les requêtes ci-dessous
 * l'utilisent directement comme organization_id.
 * ============================================================ */
(function () {
  'use strict';

  /* ── Styles partagés, injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('ae-shared-style')) return;
    const style = document.createElement('style');
    style.id = 'ae-shared-style';
    style.textContent = `
      .ae-wrap .btn{width:auto;margin-top:0}
      .ae-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .ae-toolbar h2{margin:0;font-size:19px}
      .ae-pillbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .ae-pill{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;padding:6px 14px;font-size:12.5px;cursor:pointer;font-weight:600}
      .ae-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}
      .ae-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}
      .ae-list{display:flex;flex-direction:column;gap:8px}
      .ae-row{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit}
      .ae-row:hover{border-color:var(--accent)}
      .ae-row .t{font-weight:700;font-size:14px}
      .ae-row .m{color:var(--muted);font-size:12px;margin-top:2px}
      .ae-field{margin-bottom:12px}
      .ae-field label{display:block;font-size:12.5px;font-weight:600;margin-bottom:5px}
      .ae-field input,.ae-field select,.ae-field textarea{width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box}
      .ae-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .ae-overlay{position:fixed;inset:0;background:rgba(10,14,30,.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;overflow:auto}
      .ae-modal{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px;max-width:460px;width:100%;max-height:88vh;overflow:auto}
      .ae-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
      .ae-close{background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--muted);line-height:1;padding:2px}
      .ae-comment{background:rgba(0,0,0,.03);border-radius:10px;padding:8px 10px;margin-bottom:6px;font-size:12.5px}
      .ae-info{border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12.5px;margin-bottom:12px}
      .ae-warn{border-color:#F0A94E55;background:rgba(226,160,63,.08)}
      .ae-actions{display:flex;flex-direction:column;gap:8px;margin-top:14px}
      .ae-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:18px}
      .ae-stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
      .ae-stat .n{font-size:22px;font-weight:700}
      .ae-stat .l{font-size:12px;color:var(--muted);margin-top:2px}
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
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }
  function ageFromDob(dob) {
    if (!dob) return null;
    const d = new Date(dob);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  }
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
  const REQUEST_TYPES = ['stage', 'inscriptions', 'communication', 'media', 'autre'];
  function requestTypeLabel(type) {
    return {
      stage: 'Organisation d’un stage',
      inscriptions: 'Ouverture d’inscriptions',
      communication: 'Support de communication',
      media: 'Captation médias',
      autre: 'Autre demande'
    }[type] || (type || '—');
  }
  function eventTypeLabel(type) {
    return {
      stage: 'Stage', tournage: 'Tournage', reunion: 'Réunion', contenu: 'Contenu', evenement: 'Événement'
    }[type] || (type ? (type.charAt(0).toUpperCase() + type.slice(1)) : '—');
  }
  window.AcademieModules = window.AcademieModules || {};

  /* ============================================================
   * 1. ACCUEIL
   * ============================================================ */
  window.AcademieModules.accueil = {
    label: 'Accueil',
    espace: 'academie',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      container.innerHTML = '<div class="ae-wrap"><div class="ae-empty">Chargement…</div></div>';

      const [groupsRes, participantsRes, eventRes, requestsRes] = await Promise.all([
        sbFetch('academie_groups?organization_id=eq.' + orgId + '&select=id'),
        sbFetch('academie_participants?organization_id=eq.' + orgId + '&select=id'),
        sbFetch('calendar_events?organization_id=eq.' + orgId + '&event_date=gte.' + todayISO() + '&select=*&order=event_date.asc&limit=1'),
        sbFetch('requests?organization_id=eq.' + orgId + '&select=id,status')
      ]);

      const groupsCount = groupsRes.ok ? (groupsRes.data || []).length : 0;
      const participantsCount = participantsRes.ok ? (participantsRes.data || []).length : 0;
      const nextEvent = eventRes.ok && eventRes.data && eventRes.data[0] ? eventRes.data[0] : null;
      const requestsOpen = requestsRes.ok ? (requestsRes.data || []).filter(function (r) { return r.status !== 'terminee' && r.status !== 'refusee'; }).length : 0;

      container.innerHTML = `<div class="ae-wrap">
        <div class="ae-toolbar"><h2>Accueil</h2></div>
        <div class="ae-stats">
          <div class="ae-stat"><div class="n">${groupsCount}</div><div class="l">Groupe${groupsCount > 1 ? 's' : ''}</div></div>
          <div class="ae-stat"><div class="n">${participantsCount}</div><div class="l">Participant${participantsCount > 1 ? 's' : ''}</div></div>
          <div class="ae-stat"><div class="n">${requestsOpen}</div><div class="l">Demande${requestsOpen > 1 ? 's' : ''} en cours</div></div>
        </div>
        <div class="ae-info">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">PROCHAIN ÉVÉNEMENT AU PLANNING</div>
          ${nextEvent
            ? `<b>${esc(nextEvent.title)}</b> — ${fmtDate(nextEvent.event_date)}${nextEvent.context ? ' · ' + esc(nextEvent.context) : ''}`
            : 'Aucun événement à venir pour le moment.'}
        </div>
      </div>`;
      container.onclick = function () {};
    }
  };

  /* ============================================================
   * 2. GROUPES (academie_groups)
   * ============================================================ */
  window.AcademieModules.groupes = {
    label: 'Groupes',
    espace: 'academie',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let groups = [];
      let participantCounts = {};
      let loaded = false;
      let formOpen = false;
      let editing = null; // group row being edited, or null for creation

      async function load() {
        const [gRes, pRes] = await Promise.all([
          sbFetch('academie_groups?organization_id=eq.' + orgId + '&select=*&order=nom.asc'),
          sbFetch('academie_participants?organization_id=eq.' + orgId + '&select=id,group_id')
        ]);
        if (!gRes.ok) toast('Erreur de chargement.');
        groups = gRes.ok ? (gRes.data || []) : [];
        participantCounts = {};
        if (!pRes.ok) toast('Erreur de chargement.');
        (pRes.ok ? (pRes.data || []) : []).forEach(function (p) {
          if (!p.group_id) return;
          participantCounts[p.group_id] = (participantCounts[p.group_id] || 0) + 1;
        });
        loaded = true;
      }

      function row(g) {
        const count = participantCounts[g.id] || 0;
        return `<div class="ae-row">
          <div>
            <div class="t">${esc(g.nom)}</div>
            <div class="m">${esc(g.niveau || 'Niveau non précisé')} · ${esc(g.coach_name || 'Coach non renseigné')} · ${count} participant${count > 1 ? 's' : ''}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost" data-action="edit" data-id="${g.id}">Modifier</button>
            <button class="btn btn-ghost" style="color:var(--danger)" data-action="delete" data-id="${g.id}">Supprimer</button>
          </div>
        </div>`;
      }

      function formHtml() {
        if (!formOpen) return '';
        const g = editing || { nom: '', niveau: '', coach_name: '' };
        return `<div class="ae-overlay" data-action="overlay-form">
          <div class="ae-modal">
            <div class="ae-drawer-head"><b>${editing ? 'Modifier le groupe' : 'Ajouter un groupe'}</b><button class="ae-close" data-action="close-form">✕</button></div>
            <div class="ae-field"><label>Nom du groupe</label><input type="text" data-field="gf-nom" value="${esc(g.nom)}" placeholder="ex : U13 Compétition"></div>
            <div class="ae-row2">
              <div class="ae-field"><label>Niveau</label><input type="text" data-field="gf-niveau" value="${esc(g.niveau || '')}" placeholder="ex : Débutant"></div>
              <div class="ae-field"><label>Coach</label><input type="text" data-field="gf-coach" value="${esc(g.coach_name || '')}" placeholder="ex : Karim B."></div>
            </div>
            <button class="btn btn-primary" data-action="submit-form">${editing ? 'Enregistrer' : 'Ajouter'}</button>
          </div>
        </div>`;
      }

      function paint() {
        const content = !loaded ? '<div class="ae-empty">Chargement…</div>'
          : (groups.length ? ('<div class="ae-list">' + groups.map(row).join('') + '</div>') : '<div class="ae-empty">Aucun groupe pour le moment.</div>');
        container.innerHTML = `<div class="ae-wrap">
          <div class="ae-toolbar"><h2>Groupes</h2><button class="btn btn-primary" data-action="new">+ Ajouter un groupe</button></div>
          ${content}
          ${formHtml()}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value.trim() : '';
      }

      async function submitForm() {
        const nom = fieldVal('gf-nom');
        if (!nom) { toast('Le nom du groupe est obligatoire.'); return; }
        const niveau = fieldVal('gf-niveau') || null;
        const coach_name = fieldVal('gf-coach') || null;
        let res;
        if (editing) {
          res = await sbFetch('academie_groups?id=eq.' + editing.id, { method: 'PATCH', body: { nom: nom, niveau: niveau, coach_name: coach_name } });
        } else {
          res = await sbFetch('academie_groups', { method: 'POST', body: { organization_id: orgId, nom: nom, niveau: niveau, coach_name: coach_name } });
        }
        if (!res.ok) { toast("Erreur lors de l'enregistrement du groupe."); return; }
        const wasEditing = !!editing;
        formOpen = false; editing = null;
        toast(wasEditing ? 'Groupe mis à jour.' : 'Groupe ajouté.');
        await load(); paint();
      }

      async function deleteGroup(id) {
        if (!window.confirm('Supprimer ce groupe ? Les participants rattachés resteront dans la liste, sans groupe.')) return;
        const res = await sbFetch('academie_groups?id=eq.' + id, { method: 'DELETE' });
        if (!res.ok) { toast('Suppression impossible.'); return; }
        toast('Groupe supprimé.');
        await load(); paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay-form"]');
          if (overlay && e.target === overlay) { formOpen = false; editing = null; paint(); return; }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'new') { editing = null; formOpen = true; paint(); }
          else if (action === 'edit') {
            const g = groups.find(function (x) { return x.id === btn.getAttribute('data-id'); });
            if (g) { editing = g; formOpen = true; paint(); }
          }
          else if (action === 'close-form') { formOpen = false; editing = null; paint(); }
          else if (action === 'submit-form') { await submitForm(); }
          else if (action === 'delete') { await deleteGroup(btn.getAttribute('data-id')); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 3. PARTICIPANTS (academie_participants)
   * ============================================================ */
  window.AcademieModules.participants = {
    label: 'Participants',
    espace: 'academie',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let groups = [];
      let participants = [];
      let loaded = false;
      let groupFilter = 'tous'; // 'tous' | 'sans_groupe' | <group id>
      let formOpen = false;
      let editing = null;

      async function load() {
        const [gRes, pRes] = await Promise.all([
          sbFetch('academie_groups?organization_id=eq.' + orgId + '&select=id,nom&order=nom.asc'),
          sbFetch('academie_participants?organization_id=eq.' + orgId + '&select=*&order=nom.asc')
        ]);
        if (!gRes.ok) toast('Erreur de chargement.');
        groups = gRes.ok ? (gRes.data || []) : [];
        if (!pRes.ok) toast('Erreur de chargement.');
        participants = pRes.ok ? (pRes.data || []) : [];
        loaded = true;
      }

      function groupName(id) {
        if (!id) return 'Sans groupe';
        const g = groups.find(function (x) { return x.id === id; });
        return g ? g.nom : 'Sans groupe';
      }

      function row(p) {
        const age = ageFromDob(p.date_naissance);
        const nom = ((p.prenom || '') + ' ' + (p.nom || '')).trim() || '(sans nom)';
        return `<div class="ae-row">
          <div>
            <div class="t">${esc(nom)}</div>
            <div class="m">${esc(groupName(p.group_id))} · ${p.date_naissance ? fmtDate(p.date_naissance) + (age !== null ? ' (' + age + ' ans)' : '') : 'Date de naissance non renseignée'} · Resp. ${esc(p.responsable_nom || '—')}${p.responsable_contact ? ' (' + esc(p.responsable_contact) + ')' : ''}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost" data-action="edit" data-id="${p.id}">Modifier</button>
            <button class="btn btn-ghost" style="color:var(--danger)" data-action="delete" data-id="${p.id}">Supprimer</button>
          </div>
        </div>`;
      }

      function groupOptions(selectedId) {
        return '<option value="">Aucun groupe</option>' + groups.map(function (g) {
          return '<option value="' + g.id + '" ' + (selectedId === g.id ? 'selected' : '') + '>' + esc(g.nom) + '</option>';
        }).join('');
      }

      function formHtml() {
        if (!formOpen) return '';
        const p = editing || { prenom: '', nom: '', date_naissance: '', group_id: null, responsable_nom: '', responsable_contact: '' };
        return `<div class="ae-overlay" data-action="overlay-form">
          <div class="ae-modal">
            <div class="ae-drawer-head"><b>${editing ? 'Modifier le participant' : 'Ajouter un participant'}</b><button class="ae-close" data-action="close-form">✕</button></div>
            <div class="ae-row2">
              <div class="ae-field"><label>Prénom</label><input type="text" data-field="pf-prenom" value="${esc(p.prenom)}"></div>
              <div class="ae-field"><label>Nom</label><input type="text" data-field="pf-nom" value="${esc(p.nom || '')}"></div>
            </div>
            <div class="ae-row2">
              <div class="ae-field"><label>Date de naissance</label><input type="date" data-field="pf-dob" value="${esc(p.date_naissance || '')}"></div>
              <div class="ae-field"><label>Groupe</label><select data-field="pf-group">${groupOptions(p.group_id)}</select></div>
            </div>
            <div class="ae-row2">
              <div class="ae-field"><label>Responsable</label><input type="text" data-field="pf-resp-nom" value="${esc(p.responsable_nom || '')}" placeholder="Nom du parent/responsable"></div>
              <div class="ae-field"><label>Contact responsable</label><input type="text" data-field="pf-resp-contact" value="${esc(p.responsable_contact || '')}" placeholder="Téléphone ou e-mail"></div>
            </div>
            <button class="btn btn-primary" data-action="submit-form">${editing ? 'Enregistrer' : 'Ajouter'}</button>
          </div>
        </div>`;
      }

      function paint() {
        let content;
        if (!loaded) {
          content = '<div class="ae-empty">Chargement…</div>';
        } else {
          const filtered = participants.filter(function (p) {
            if (groupFilter === 'tous') return true;
            if (groupFilter === 'sans_groupe') return !p.group_id;
            return p.group_id === groupFilter;
          });
          content = filtered.length ? ('<div class="ae-list">' + filtered.map(row).join('') + '</div>') : '<div class="ae-empty">Aucun participant pour ce filtre.</div>';
        }
        container.innerHTML = `<div class="ae-wrap">
          <div class="ae-toolbar"><h2>Participants</h2><button class="btn btn-primary" data-action="new">+ Ajouter un participant</button></div>
          <div class="ae-field" style="max-width:320px">
            <label>Filtrer par groupe</label>
            <select data-field="group-filter">
              <option value="tous" ${groupFilter === 'tous' ? 'selected' : ''}>Tous les groupes</option>
              <option value="sans_groupe" ${groupFilter === 'sans_groupe' ? 'selected' : ''}>Sans groupe</option>
              ${groups.map(function (g) { return '<option value="' + g.id + '" ' + (groupFilter === g.id ? 'selected' : '') + '>' + esc(g.nom) + '</option>'; }).join('')}
            </select>
          </div>
          ${content}
          ${formHtml()}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value.trim() : '';
      }

      async function submitForm() {
        const prenom = fieldVal('pf-prenom');
        if (!prenom) { toast('Le prénom est obligatoire.'); return; }
        const nom = fieldVal('pf-nom') || null;
        const date_naissance = fieldVal('pf-dob') || null;
        const group_id = fieldVal('pf-group') || null;
        const responsable_nom = fieldVal('pf-resp-nom') || null;
        const responsable_contact = fieldVal('pf-resp-contact') || null;
        const body = { prenom: prenom, nom: nom, date_naissance: date_naissance, group_id: group_id, responsable_nom: responsable_nom, responsable_contact: responsable_contact };
        let res;
        if (editing) {
          res = await sbFetch('academie_participants?id=eq.' + editing.id, { method: 'PATCH', body: body });
        } else {
          res = await sbFetch('academie_participants', { method: 'POST', body: Object.assign({ organization_id: orgId }, body) });
        }
        if (!res.ok) { toast("Erreur lors de l'enregistrement du participant."); return; }
        const wasEditing = !!editing;
        formOpen = false; editing = null;
        toast(wasEditing ? 'Participant mis à jour.' : 'Participant ajouté.');
        await load(); paint();
      }

      async function deleteParticipant(id) {
        if (!window.confirm('Supprimer ce participant ?')) return;
        const res = await sbFetch('academie_participants?id=eq.' + id, { method: 'DELETE' });
        if (!res.ok) { toast('Suppression impossible.'); return; }
        toast('Participant supprimé.');
        await load(); paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay-form"]');
          if (overlay && e.target === overlay) { formOpen = false; editing = null; paint(); return; }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'new') { editing = null; formOpen = true; paint(); }
          else if (action === 'edit') {
            const p = participants.find(function (x) { return x.id === btn.getAttribute('data-id'); });
            if (p) { editing = p; formOpen = true; paint(); }
          }
          else if (action === 'close-form') { formOpen = false; editing = null; paint(); }
          else if (action === 'submit-form') { await submitForm(); }
          else if (action === 'delete') { await deleteParticipant(btn.getAttribute('data-id')); }
        };
        container.onchange = function (e) {
          const sel = e.target.closest('[data-field="group-filter"]');
          if (sel) { groupFilter = sel.value; paint(); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 4. STAGES & PLANNING (calendar_events, lecture seule)
   * ============================================================ */
  window.AcademieModules.planning = {
    label: 'Stages & Planning',
    espace: 'academie',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let events = [];
      let loaded = false;
      let filter = 'a_venir'; // 'a_venir' | 'tous' | 'passes'

      async function load() {
        const res = await sbFetch('calendar_events?organization_id=eq.' + orgId + '&select=*&order=event_date.asc');
        if (!res.ok) toast('Erreur de chargement.');
        events = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      function row(ev) {
        return `<div class="ae-row" style="cursor:default">
          <div style="display:flex;gap:10px;align-items:center">
            <div style="min-width:78px;font-weight:700;font-size:13px">${fmtDate(ev.event_date)}</div>
            <div>
              <div class="t">${esc(ev.title)}</div>
              <div class="m">${ev.context ? esc(ev.context) : ''}</div>
            </div>
          </div>
          <span class="badge" style="background:#168BFF22;color:var(--accent)">${esc(eventTypeLabel(ev.type))}</span>
        </div>`;
      }

      function paint() {
        let content;
        if (!loaded) {
          content = '<div class="ae-empty">Chargement…</div>';
        } else {
          const today = todayISO();
          const filtered = events.filter(function (ev) {
            if (filter === 'tous') return true;
            if (filter === 'a_venir') return ev.event_date >= today;
            return ev.event_date < today;
          });
          content = filtered.length ? ('<div class="ae-list">' + filtered.map(row).join('') + '</div>') : '<div class="ae-empty">Aucun événement pour ce filtre.</div>';
        }
        container.innerHTML = `<div class="ae-wrap">
          <div class="ae-toolbar"><h2>Stages & Planning</h2></div>
          <div class="ae-info">Ce planning est alimenté par SportVision. Consultation uniquement depuis cet espace.</div>
          <div class="ae-pillbar">
            <button class="ae-pill${filter === 'a_venir' ? ' on' : ''}" data-action="filter" data-f="a_venir">À venir</button>
            <button class="ae-pill${filter === 'tous' ? ' on' : ''}" data-action="filter" data-f="tous">Tous</button>
            <button class="ae-pill${filter === 'passes' ? ' on' : ''}" data-action="filter" data-f="passes">Passés</button>
          </div>
          ${content}
        </div>`;
        bind();
      }

      function bind() {
        container.onclick = function (e) {
          const btn = e.target.closest('[data-action="filter"]');
          if (!btn) return;
          filter = btn.getAttribute('data-f');
          paint();
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 5. DEMANDES (requests, via RPC submit_request / update_request_status)
   * ============================================================ */
  window.AcademieModules.demandes = {
    label: 'Demandes',
    espace: 'academie',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      const STATUSES = ['recues', 'info_manquante', 'en_traitement', 'prete_a_creer', 'terminee', 'refusee'];

      let items = [];
      let loaded = false;
      let filter = 'toutes';
      let openId = null;
      let formOpen = false;
      let myName = null;

      async function myDisplayName() {
        if (myName) return myName;
        const uid = localStorage.getItem('svc_uid');
        if (!uid) return 'Vous';
        // Pas de table de membres nommés pour l'espace académie (memberships ne porte
        // que rôle/statut) : on retombe sur le profil personnel de l'utilisateur connecté
        // (lecture de sa propre ligne, autorisée par RLS "Lecture profil personnel").
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
        return `<button class="ae-row" data-action="open" data-id="${r.id}">
          <div style="display:flex;gap:10px;align-items:center">
            <span style="width:7px;height:7px;border-radius:4px;flex-shrink:0;background:${r.urgency === 'haute' ? 'var(--danger)' : 'var(--border)'}"></span>
            <div>
              <div class="t">${esc(requestTypeLabel(r.type))}</div>
              <div class="m">${fmtDate(r.created_at)}${r.requester_name ? ' · ' + esc(r.requester_name) : ''}</div>
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
        return `<div class="ae-overlay" data-action="overlay">
          <div class="ae-modal">
            <div class="ae-drawer-head">
              <div>
                <b style="font-size:16px">${esc(requestTypeLabel(r.type))}</b>
                <div class="m" style="margin-top:2px">${fmtDate(r.created_at)}</div>
              </div>
              <button class="ae-close" data-action="close">✕</button>
            </div>
            <span class="badge" style="background:${sm.color}22;color:${sm.color};margin-bottom:14px;display:inline-block">${esc(sm.label)}</span>
            ${r.credits_reserved ? `<div class="ae-info ae-warn">${r.credits_reserved} crédit(s) réservé(s) — débités seulement si SportVision accepte la demande, sinon restitués.</div>` : ''}
            ${missing.length ? `<div class="ae-info ae-warn"><b style="display:block;margin-bottom:4px;font-size:11.5px;color:var(--warn)">INFORMATIONS MANQUANTES</b>${missing.map(function (m) { return '<div>• ' + esc(m) + '</div>'; }).join('')}</div>` : ''}
            <div class="ae-info"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">DÉTAIL</div>${esc(r.detail || '—')}</div>
            <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:8px">COMMENTAIRES</div>
            ${comments.length ? comments.map(function (c) {
              return '<div class="ae-comment"><b>' + esc(c.author || '—') + '</b> <span style="color:var(--muted)">· ' + esc(c.date || '') + '</span><div style="margin-top:3px">' + esc(c.text || '') + '</div></div>';
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
        if (!formOpen) return '';
        return `<div class="ae-overlay" data-action="overlay-form">
          <div class="ae-modal">
            <div class="ae-drawer-head"><b>Nouvelle demande</b><button class="ae-close" data-action="close-form">✕</button></div>
            <div class="ae-field"><label>Type de demande</label><select data-field="nf-type">
              ${REQUEST_TYPES.map(function (t) { return '<option value="' + t + '">' + esc(requestTypeLabel(t)) + '</option>'; }).join('')}
            </select></div>
            <div class="ae-field"><label>Détail</label><textarea rows="3" data-field="nf-detail" placeholder="Décrivez votre demande…"></textarea></div>
            <div class="ae-field"><label>Urgence</label><select data-field="nf-urgency">
              <option value="normale">Normale</option>
              <option value="haute">Haute</option>
            </select></div>
            <div class="m" style="margin-bottom:12px">Le coût éventuel en crédits sera confirmé par SportVision après réception de la demande.</div>
            <button class="btn btn-primary" data-action="submit-form">Envoyer la demande</button>
          </div>
        </div>`;
      }

      function paint() {
        let listHtml;
        if (!loaded) {
          listHtml = '<div class="ae-empty">Chargement…</div>';
        } else {
          const filtered = items.filter(function (r) { return filter === 'toutes' || r.status === filter; });
          listHtml = filtered.length ? ('<div class="ae-list">' + filtered.map(row).join('') + '</div>') : '<div class="ae-empty">Aucune demande dans ce statut pour le moment.</div>';
        }
        container.innerHTML = `<div class="ae-wrap">
          <div class="ae-toolbar"><h2>Demandes</h2><button class="btn btn-primary" data-action="new">+ Nouvelle demande</button></div>
          <div class="ae-pillbar">${['toutes'].concat(STATUSES).map(function (st) {
            return '<button class="ae-pill' + (filter === st ? ' on' : '') + '" data-action="filter" data-status="' + st + '">' + (st === 'toutes' ? 'Toutes' : esc(statusMeta(st).label)) + '</button>';
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

      async function submitForm() {
        const type = fieldVal('nf-type') || REQUEST_TYPES[0];
        const detail = fieldVal('nf-detail').trim();
        const urgency = fieldVal('nf-urgency') || 'normale';
        if (!detail) { toast('Merci de préciser le détail de la demande.'); return; }
        const res = await sbRpc('submit_request', { p_organization_id: orgId, p_type: type, p_urgency: urgency, p_detail: detail, p_credits: 0 });
        if (!res.ok) { toast("Erreur lors de l'envoi de la demande."); return; }
        formOpen = false;
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
            if (overlay.getAttribute('data-action') === 'overlay') openId = null; else formOpen = false;
            paint(); return;
          }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'filter') { filter = btn.getAttribute('data-status'); paint(); }
          else if (action === 'open') { openId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close') { openId = null; paint(); }
          else if (action === 'new') { formOpen = true; paint(); }
          else if (action === 'close-form') { formOpen = false; paint(); }
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
   * 6. ADMINISTRATION (memberships + edge function org-invite) —
   * liste des membres de l'organisation et formulaire d'invitation,
   * visible seulement si ctx.role === 'admin' (confort d'affichage
   * côté client uniquement : org-invite revérifie lui-même ce rôle
   * en base avant toute écriture, cf. supabase/functions/org-invite/index.ts).
   * ============================================================ */

  // Catalogue de rôles pour une organisation Académie (aligné sur
  // ROLE_CATALOG.academie dans supabase/functions/org-invite/index.ts —
  // à faire évoluer ensemble si ce catalogue change côté serveur, sinon
  // le formulaire proposerait un rôle que le serveur retomberait
  // silencieusement à 'lecture_seule').
  const ADMIN_ROLES = ['admin', 'secretaire', 'coach', 'resp_programme', 'resp_communication', 'lecture_seule'];
  function adminRoleLabel(role) {
    return {
      admin: 'Administrateur',
      secretaire: 'Secrétaire',
      coach: 'Coach',
      resp_programme: 'Responsable programme',
      resp_communication: 'Responsable communication',
      lecture_seule: 'Lecture seule'
    }[role] || (role || '—');
  }
  // `memberships.status` : 'actif' (invitation acceptée), 'invitation' (en
  // attente), 'suspendu' (accès coupé — uniquement modifiable par le staff
  // SportVision ou, pour sa propre ligne, par le membre qui accepte son
  // invitation). Aucun de ces états n'est modifiable depuis cet écran.
  function membershipStatusMeta(status) {
    return {
      actif: { label: 'Actif', color: 'var(--ok)' },
      invitation: { label: 'Invitation en attente', color: '#e2a03f' },
      suspendu: { label: 'Suspendu', color: 'var(--danger)' }
    }[status] || { label: status || '—', color: 'var(--muted)' };
  }
  // Message d'erreur renvoyé par PostgREST pour une exception levée côté
  // trigger/policy (ex : "Une invitation en attente ne peut pas être
  // suspendue…") — toujours affiché tel quel via toast(), jamais remplacé
  // par un message générique, pour laisser le serveur trancher les règles
  // métier (cf. protect_sensitive_membership_fields dans
  // migration-connect-v6-org-admin.sql).
  function membershipErrorMessage(res, fallback) {
    if (res && res.data) {
      if (res.data.message) return res.data.message;
      if (res.data.error) return res.data.error;
      if (res.data.hint) return res.data.hint;
    }
    return fallback;
  }

  window.AcademieModules.administration = {
    label: 'Administration',
    espace: 'academie',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let members = [];
      let roleCatalog = []; // {role_key, label, is_admin, is_default} — académie uniquement
      let loaded = false;
      let form = null; // {email, prenom, nom, role}
      let sending = false;
      let memberActionPending = null; // id de la ligne memberships en cours de PATCH (rôle/statut)
      const canInvite = !!(ctx && ctx.role === 'admin');
      const ownUid = localStorage.getItem('svc_uid');

      async function load() {
        const [mRes, rcRes] = await Promise.all([
          sbFetch('memberships?organization_id=eq.' + orgId + '&select=*&order=created_at.asc'),
          // Catalogue lu dynamiquement (plutôt que codé en dur) pour rester aligné
          // avec organization_role_catalog même si la migration évolue plus tard.
          // Inutile pour un non-admin qui ne verra pas les contrôles de gestion.
          canInvite
            ? sbFetch('organization_role_catalog?organization_type=eq.academie&select=role_key,label,is_admin,is_default')
            : Promise.resolve({ ok: true, data: [] })
        ]);
        if (!mRes.ok) toast('Erreur de chargement.');
        members = mRes.ok ? (mRes.data || []) : [];
        if (!rcRes.ok) toast('Erreur de chargement.');
        roleCatalog = rcRes.ok ? (rcRes.data || []) : [];
        loaded = true;
      }

      // Pas de jointure possible vers profiles/auth.users depuis ce client pour
      // afficher un nom (aucun accès en lecture garanti sur un autre utilisateur) —
      // chaque membre est donc affiché par rôle/statut/date, sans nom, plutôt que
      // d'inventer une information qu'on ne peut pas récupérer honnêtement.
      function row(m) {
        const sm = membershipStatusMeta(m.status);
        const isSelf = !!(ownUid && m.user_id === ownUid);
        // Un admin peut gérer les AUTRES membres, jamais sa propre ligne par ce
        // mécanisme (le trigger serveur refuse de toute façon, mais on n'affiche
        // même pas les contrôles pour éviter un clic qui échouera à coup sûr).
        const canManage = canInvite && !isSelf;
        const busy = memberActionPending === m.id;
        return `<div class="ae-row" style="cursor:default${canManage ? ';flex-direction:column;align-items:stretch;gap:10px' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%">
            <div>
              <div class="t">${esc(adminRoleLabel(m.role))}</div>
              <div class="m">Membre depuis ${fmtDate(m.created_at)}${m.source ? ' · ' + esc(m.source) : ''}</div>
            </div>
            <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
          </div>
          ${canManage ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:10px">
            <select data-field="role-select" data-id="${m.id}" style="flex:1;min-width:170px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit"${busy ? ' disabled' : ''}>
              ${roleCatalog.map(function (r) { return '<option value="' + esc(r.role_key) + '" ' + (r.role_key === m.role ? 'selected' : '') + '>' + esc(r.label) + '</option>'; }).join('')}
            </select>
            <button class="btn btn-ghost" data-action="change-role" data-id="${m.id}"${busy ? ' disabled' : ''}>Changer le rôle</button>
            <button class="btn btn-ghost" style="${m.status === 'suspendu' ? '' : 'color:var(--danger)'}" data-action="toggle-status" data-id="${m.id}" data-status="${m.status === 'suspendu' ? 'actif' : 'suspendu'}"${busy ? ' disabled' : ''}>${m.status === 'suspendu' ? 'Réactiver' : 'Suspendre'}</button>
          </div>` : ''}
        </div>`;
      }

      async function changeMemberRole(id) {
        const sel = container.querySelector('select[data-field="role-select"][data-id="' + id + '"]');
        const role = sel ? sel.value : '';
        if (!role) return;
        memberActionPending = id; paint();
        const res = await sbFetch('memberships?id=eq.' + id, { method: 'PATCH', body: { role: role } });
        memberActionPending = null;
        if (!res.ok) { toast(membershipErrorMessage(res, 'Erreur lors du changement de rôle.')); paint(); return; }
        toast('Rôle mis à jour.');
        await load(); paint();
      }

      async function changeMemberStatus(id, status) {
        memberActionPending = id; paint();
        const res = await sbFetch('memberships?id=eq.' + id, { method: 'PATCH', body: { status: status } });
        memberActionPending = null;
        if (!res.ok) { toast(membershipErrorMessage(res, 'Erreur lors de la mise à jour du statut.')); paint(); return; }
        toast(status === 'actif' ? 'Membre réactivé.' : 'Membre suspendu.');
        await load(); paint();
      }

      function formHtml() {
        if (!form) return '';
        return `<div class="ae-overlay" data-action="overlay-form">
          <div class="ae-modal">
            <div class="ae-drawer-head"><b>Inviter un membre</b><button class="ae-close" data-action="close-form">✕</button></div>
            <div class="ae-row2">
              <div class="ae-field"><label>Prénom</label><input type="text" data-field="mf-prenom" value="${esc(form.prenom)}"></div>
              <div class="ae-field"><label>Nom</label><input type="text" data-field="mf-nom" value="${esc(form.nom)}"></div>
            </div>
            <div class="ae-field"><label>E-mail</label><input type="email" data-field="mf-email" value="${esc(form.email)}" placeholder="prenom.nom@exemple.fr"></div>
            <div class="ae-field"><label>Rôle</label><select data-field="mf-role">
              ${ADMIN_ROLES.map(function (r) { return '<option value="' + r + '" ' + (r === form.role ? 'selected' : '') + '>' + esc(adminRoleLabel(r)) + '</option>'; }).join('')}
            </select></div>
            <div class="m" style="margin-bottom:10px">Un e-mail d’invitation sera envoyé pour créer le compte (ou rattacher un compte existant) à cette organisation.</div>
            <button class="btn btn-primary" data-action="submit-form"${sending ? ' disabled' : ''}>${sending ? 'Envoi…' : 'Envoyer l’invitation'}</button>
          </div>
        </div>`;
      }

      function paint() {
        const content = !loaded ? '<div class="ae-empty">Chargement…</div>'
          : (members.length ? ('<div class="ae-list">' + members.map(row).join('') + '</div>') : '<div class="ae-empty">Aucun membre pour le moment.</div>');
        container.innerHTML = `<div class="ae-wrap">
          <div class="ae-toolbar"><h2>Administration</h2>${canInvite ? '<button class="btn btn-primary" data-action="new">+ Inviter un membre</button>' : ''}</div>
          ${content}
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
          const msg = (res.data && res.data.error) ? res.data.error : 'Erreur lors de l’envoi de l’invitation.';
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

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay-form"]');
          if (overlay && e.target === overlay) { form = null; paint(); return; }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'new') { form = { prenom: '', nom: '', email: '', role: ADMIN_ROLES[0] }; paint(); }
          else if (action === 'close-form') { form = null; paint(); }
          else if (action === 'submit-form') { await submitForm(); }
          else if (action === 'change-role') { await changeMemberRole(btn.getAttribute('data-id')); }
          else if (action === 'toggle-status') { await changeMemberStatus(btn.getAttribute('data-id'), btn.getAttribute('data-status')); }
        };
      }

      await load();
      paint();
    }
  };
})();
