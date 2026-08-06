/* ══════════════════════════════════════════════════════════════════════
   SportVision Connect — Module « Projet : Livrables, Messagerie,
   Mes RDV, Compte »

   Portage fidèle (mais autonome) d'une partie de l'espace connecté du
   Portail SportVision (référence lecture seule, jamais modifiée :
   livrables/SportVision-Portail/SportVision-Portail.html) vers Connect.
   Dans la nouvelle architecture, le Portail devient « l'Espace Projet »
   de Connect — ce module en porte le sous-ensemble Livrables /
   Messagerie / Mes RDV / Compte (+ Notifications en bonus, cf. plus bas).

   Dépendances globales fournies par le shell Connect (app/index.html) :
   sbFetch, sbRpc, sbFunction, esc, toast, et les variables/classes CSS
   (--card, --border, --radius, --shadow, --accent, --accent-2, --muted,
   --text, --ok, --danger, .btn, .btn-primary, .btn-ghost, .badge).

   Rappel d'architecture Connect v2 (cf. migration-connect-v2-organizations
   -entitlements.sql §3.2) : pour un espace « projet », organizations.id
   est EXACTEMENT ÉGAL à clients.id. Le paramètre orgId de chaque
   render(container, orgId, ctx) EST donc directement client_id ; la RLS
   des tables/vues client_* s'applique automatiquement via auth.uid().
   ctx.role vaut toujours 'client' dans cet espace.

   Chaque module est autonome : tout son état vit dans une closure créée
   à chaque appel de render(), et les gestionnaires d'événements sont
   assignés via container.onclick = (jamais addEventListener), pour ne
   jamais accumuler de doublons quand render() est rejoué sur le même
   noeud.

   Règle de sécurité stricte du projet : un lien externe stocké en base
   (ici client_media_livrables.lien_url) ne doit JAMAIS être ouvert
   (window.open / navigation) sans vérifier qu'il commence par http:// ou
   https:// — un lien "javascript:..." serait sinon exécuté dans le
   contexte de l'app (vol de session via svc_tok). Cf. la faille déjà
   trouvée et corrigée dans modules/club-demandes-medias-sponsors-admin.js.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.ProjetModules = window.ProjetModules || {};

  /* ── Styles partagés, injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('pjc-shared-style')) return;
    const style = document.createElement('style');
    style.id = 'pjc-shared-style';
    style.textContent = `
      .pjc-wrap{color:var(--text)}
      .pjc-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
      .pjc-toolbar h2{margin:0;font-size:19px}
      .pjc-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px}
      .pjc-card-title{font-weight:700;font-size:15px}
      .pjc-field{margin-bottom:14px}
      .pjc-field label{display:block;font-size:12.5px;font-weight:600;margin-bottom:5px;color:var(--muted)}
      .pjc-field input,.pjc-field select,.pjc-field textarea{width:100%;padding:10px 11px;border:1px solid var(--border);border-radius:9px;font-size:14px;font-family:inherit;box-sizing:border-box}
      .pjc-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .pjc-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}
      .pjc-err{color:var(--danger);font-size:13px;margin:-4px 0 14px}
      .pjc-faint{color:var(--muted);font-size:13px}
      .pjc-list{display:flex;flex-direction:column;gap:8px}
      .pjc-row{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
      .pjc-row-title{font-weight:700;font-size:14px}
      .pjc-badge{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:3px 10px;white-space:nowrap}
      .pjc-badge-blue{background:#eaf0ff;color:#2f6bff}
      .pjc-badge-green{background:#e6f7f0;color:#1fa971}
      .pjc-badge-orange{background:#fff1e0;color:#b56a00}
      .pjc-badge-red{background:#fdecec;color:#e14b4b}
      .pjc-badge-grey{background:#eef1f7;color:var(--muted)}
      .pjc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
      .pjc-eyebrow{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.3px}
      .pjc-actions-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .pjc-pillbar{display:flex;gap:8px;flex-wrap:wrap}
      .pjc-pill{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;padding:8px 16px;font-size:13px;cursor:pointer;font-weight:600}
      .pjc-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}
      .pjc-btn-noshrink{width:auto;margin-top:0}
      .pjc-msg-shell{display:flex;gap:16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;min-height:420px}
      .pjc-msg-convs{width:260px;flex:none;border-right:1px solid var(--border);overflow-y:auto;max-height:560px}
      .pjc-conv-item{padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer}
      .pjc-conv-item:hover{background:rgba(0,0,0,.02)}
      .pjc-conv-item.on{background:#eaf0ff}
      .pjc-msg-panel{flex:1;display:flex;flex-direction:column;min-width:0;padding:14px}
      .pjc-mobile-back{display:none;margin-bottom:10px}
      .pjc-msg-title{font-weight:700;font-size:15px;margin-bottom:10px}
      .pjc-msg-thread{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 2px;max-height:420px}
      .pjc-bubble{max-width:78%;padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word}
      .pjc-bubble-mine{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:4px}
      .pjc-bubble-theirs{align-self:flex-start;background:#eef1f7;color:var(--text);border-bottom-left-radius:4px}
      .pjc-msg-composer{display:flex;gap:8px;margin-top:12px;align-items:flex-end}
      .pjc-msg-composer textarea{flex:1;resize:vertical;padding:10px 11px;border:1px solid var(--border);border-radius:9px;font-size:14px;font-family:inherit;box-sizing:border-box}
      .pjc-members{border-top:1px solid var(--border)}
      .pjc-member-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);font-size:14px}
      @media (max-width:680px){
        .pjc-msg-shell{min-height:0}
        .pjc-msg-convs.pjc-hide-mobile{display:none}
        .pjc-msg-panel.pjc-hide-mobile{display:none}
        .pjc-mobile-back{display:inline-flex}
      }
    `;
    document.head.appendChild(style);
  }

  /* ── Formattage partagé (identique en substance à celui du Portail) ── */
  function fmtDate(s) { return s ? new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'; }
  function fmtEUR(n) { return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }

  // Un lien externe stocké en base ne doit jamais être ouvert sans vérifier
  // son schéma — cf. avertissement de sécurité en tête de fichier.
  function isSafeHttpUrl(url) { return typeof url === 'string' && /^https?:\/\//i.test(url); }

  const RDV_BADGE = {
    a_confirmer: ['À confirmer', 'pjc-badge-orange'],
    confirme: ['Confirmé', 'pjc-badge-green'],
    annule: ['Annulé', 'pjc-badge-red'],
    realise: ['Réalisé', 'pjc-badge-grey'],
  };

  /* ============================================================
   * 1. LIVRABLES (client_media_livrables)
   * ============================================================ */
  window.ProjetModules.livrables = {
    label: 'Livrables',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      container.innerHTML = '<div class="pjc-wrap"><div class="pjc-toolbar"><h2>Livrables</h2></div>'
        + '<div id="pjc-liv-body"><div class="pjc-empty">Chargement…</div></div></div>';

      // Gestionnaire unique, posé une seule fois sur le conteneur : les
      // repeints successifs (paint()) ne recréent que le innerHTML, jamais
      // de nouveaux écouteurs.
      container.onclick = function (e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const href = btn.getAttribute('data-href') || '';
        if (action === 'liv-open') {
          if (isSafeHttpUrl(href)) window.open(href, '_blank', 'noopener,noreferrer');
          else toast("Lien invalide ou non sécurisé — impossible de l'ouvrir.");
        } else if (action === 'liv-copy') {
          if (!isSafeHttpUrl(href)) { toast('Lien non sécurisé — copie impossible.'); return; }
          const done = function () { toast('Lien copié dans le presse-papiers.'); };
          const fail = function () { toast('Impossible de copier le lien.'); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(href).then(done).catch(fail);
          else fail();
        }
      };

      // La vue client_media_livrables filtre déjà par client via auth.uid()
      // côté RLS (cf. migration-portail-v5.sql) : pas besoin de filtre
      // client_id explicite ici, comme dans le Portail d'origine.
      const r = await sbFetch('client_media_livrables?order=created_at.desc');
      const body = container.querySelector('#pjc-liv-body');
      if (!r.ok) { body.innerHTML = '<div class="pjc-empty">Impossible de charger vos livrables pour le moment.</div>'; return; }
      const list = r.data || [];
      if (!list.length) { body.innerHTML = '<div class="pjc-empty">Vous n\'avez encore aucun livrable disponible.</div>'; return; }

      body.innerHTML = '<div class="pjc-grid">' + list.map(function (l) {
        const hrefAttr = esc(l.lien_url || '');
        let actions;
        if (l.lien_url && isSafeHttpUrl(l.lien_url)) {
          actions = '<button class="btn btn-primary pjc-btn-noshrink" data-action="liv-open" data-href="' + hrefAttr + '">Ouvrir</button>'
            + '<button class="btn btn-ghost pjc-btn-noshrink" data-action="liv-copy" data-href="' + hrefAttr + '">Copier le lien</button>';
        } else if (l.lien_url) {
          actions = '<span class="pjc-faint">Lien non sécurisé — indisponible</span>';
        } else {
          actions = '<span class="pjc-faint">Lien en préparation</span>';
        }
        return '<div class="pjc-card">'
          + '<span class="pjc-eyebrow">' + esc((l.type_livrable || '').toUpperCase()) + '</span>'
          + '<div class="pjc-card-title" style="margin:8px 0 4px">' + esc(l.nom || 'Livrable') + '</div>'
          + '<div class="pjc-faint" style="margin-bottom:14px">' + (l.date_expiration ? ('Expire le ' + fmtDate(l.date_expiration)) : '') + '</div>'
          + '<div class="pjc-actions-row">' + actions + '</div>'
          + '</div>';
      }).join('') + '</div>';
    },
  };

  /* ============================================================
   * 2. MESSAGERIE (messages_client)
   * ============================================================ */
  window.ProjetModules.messagerie = {
    label: 'Messagerie',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      const state = { conversations: [], activeKey: 'general', mobileShowThread: false };

      function convKey(id) { return id === null || id === undefined ? 'general' : String(id); }
      function activeConv() { return state.conversations.find(function (c) { return c.key === state.activeKey; }) || state.conversations[0]; }

      async function load() {
        const [prestRes, msgRes] = await Promise.all([
          sbFetch('client_prestations?client_id=eq.' + orgId + '&select=id,reference,type_prestation&order=created_at.desc'),
          sbFetch('messages_client?client_id=eq.' + orgId + '&select=id,prestation_id,contenu,created_at,auteur_type,lu&order=created_at.asc'),
        ]);
        const prestations = prestRes.ok ? (prestRes.data || []) : [];
        const msgs = msgRes.ok ? (msgRes.data || []) : [];
        const byKey = {};
        msgs.forEach(function (m) {
          const k = convKey(m.prestation_id);
          (byKey[k] = byKey[k] || []).push(m);
        });
        state.conversations = [{ key: 'general', id: null, label: 'Discussion générale' }]
          .concat(prestations.map(function (p) { return { key: convKey(p.id), id: p.id, label: p.type_prestation || p.reference || 'Prestation' }; }));
        state.conversations.forEach(function (c) {
          c.messages = byKey[c.key] || [];
          c.last = c.messages.length ? c.messages[c.messages.length - 1] : null;
          c.unread = c.messages.filter(function (m) { return m.auteur_type === 'staff' && !m.lu; }).length;
        });
      }

      function convListHtml() {
        return state.conversations.map(function (c) {
          return '<div class="pjc-conv-item' + (c.key === state.activeKey ? ' on' : '') + '" data-action="msg-select" data-key="' + esc(c.key) + '">'
            + '<div style="font-weight:700;font-size:13.5px">' + esc(c.label) + (c.unread ? (' <span class="pjc-badge pjc-badge-blue">' + c.unread + '</span>') : '') + '</div>'
            + '<div class="pjc-faint" style="margin-top:4px;font-size:12px">' + (c.last ? esc((c.last.contenu || '').slice(0, 40)) : 'Aucun message') + '</div>'
            + '</div>';
        }).join('');
      }

      function threadHtml() {
        const c = activeConv();
        const list = c ? c.messages : [];
        if (!list.length) return '<div class="pjc-empty">Aucun message pour le moment. Écrivez à SportVision ci-dessous.</div>';
        return list.map(function (m) {
          return '<div class="pjc-bubble ' + (m.auteur_type === 'client' ? 'pjc-bubble-mine' : 'pjc-bubble-theirs') + '">' + esc(m.contenu) + '</div>';
        }).join('');
      }

      function paint() {
        const c = activeConv();
        container.innerHTML = '<div class="pjc-wrap"><div class="pjc-toolbar"><h2>Messagerie</h2></div>'
          + '<div class="pjc-msg-shell">'
          + '<div class="pjc-msg-convs' + (state.mobileShowThread ? ' pjc-hide-mobile' : '') + '">' + convListHtml() + '</div>'
          + '<div class="pjc-msg-panel' + (!state.mobileShowThread ? ' pjc-hide-mobile' : '') + '">'
          + '<button type="button" class="btn btn-ghost pjc-mobile-back" data-action="msg-back">‹ Conversations</button>'
          + '<div class="pjc-msg-title">' + esc(c ? c.label : '') + '</div>'
          + '<div class="pjc-msg-thread" id="pjc-msg-thread">' + threadHtml() + '</div>'
          + '<div class="pjc-msg-composer"><textarea id="pjc-msg-input" rows="2" placeholder="Écrire un message à SportVision…"></textarea>'
          + '<button type="button" class="btn btn-primary pjc-btn-noshrink" data-action="msg-send">Envoyer</button></div>'
          + '</div></div></div>';
        const threadEl = container.querySelector('#pjc-msg-thread');
        if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
      }

      async function markReadIfNeeded() {
        const c = activeConv();
        if (!c) return;
        const unread = c.messages.filter(function (m) { return m.auteur_type === 'staff' && !m.lu; });
        if (!unread.length) return;
        const results = await Promise.all(unread.map(function (m) {
          return sbRpc('client_mark_message_read', { p_message_id: m.id }).then(function (r) { return { m: m, ok: r.ok }; });
        }));
        results.forEach(function (r) { if (r.ok) r.m.lu = true; });
        c.unread = c.messages.filter(function (m) { return m.auteur_type === 'staff' && !m.lu; }).length;
        paint();
      }

      async function sendMessage() {
        const input = container.querySelector('#pjc-msg-input');
        const contenu = input ? input.value.trim() : '';
        if (!contenu) return;
        const uid = localStorage.getItem('svc_uid');
        const prestationId = state.activeKey === 'general' ? null : state.activeKey;
        const r = await sbFetch('messages_client', { method: 'POST', body: { client_id: orgId, prestation_id: prestationId, auteur_type: 'client', auteur_client_id: uid, contenu: contenu } });
        if (!r.ok) { toast('Message non envoyé.'); return; }
        await load();
        paint();
      }

      container.onclick = function (e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        if (action === 'msg-select') {
          state.activeKey = btn.getAttribute('data-key');
          state.mobileShowThread = true;
          paint();
          markReadIfNeeded();
        } else if (action === 'msg-back') {
          state.mobileShowThread = false;
          paint();
        } else if (action === 'msg-send') {
          sendMessage();
        }
      };

      container.innerHTML = '<div class="pjc-wrap"><div class="pjc-empty">Chargement…</div></div>';
      await load();
      paint();
      await markReadIfNeeded();
    },
  };

  /* ============================================================
   * 3. MES RDV (rendez_vous)
   * ============================================================ */
  window.ProjetModules.rdv = {
    label: 'Mes RDV',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      const state = { list: [], prestations: [], formOpen: false, type: null, err: '' };

      function fieldVal(id) { const el = container.querySelector('#' + id); return el ? el.value.trim() : ''; }

      async function load() {
        const [rdvRes, prestRes] = await Promise.all([
          sbFetch('rendez_vous?client_id=eq.' + orgId + '&order=created_at.desc'),
          sbFetch('client_prestations?client_id=eq.' + orgId + '&select=id,reference,type_prestation&order=created_at.desc'),
        ]);
        state.list = rdvRes.ok ? (rdvRes.data || []) : [];
        state.prestations = prestRes.ok ? (prestRes.data || []) : [];
      }

      function listHtml() {
        if (!state.list.length) return '<div class="pjc-empty">Aucun rendez-vous pour le moment.</div>';
        return '<div class="pjc-list">' + state.list.map(function (r) {
          const meta = RDV_BADGE[r.statut] || [r.statut || '—', 'pjc-badge-grey'];
          return '<div class="pjc-row"><div><div class="pjc-row-title">' + esc(r.objet || 'Rendez-vous') + '</div>'
            + '<div class="pjc-faint" style="margin-top:2px">' + (r.type_rdv === 'appel' ? 'Appel téléphonique' : 'Rendez-vous physique') + ' · ' + fmtDate(r.date_demandee) + (r.heure_demandee ? (' à ' + String(r.heure_demandee).slice(0, 5)) : '') + '</div></div>'
            + '<span class="pjc-badge ' + meta[1] + '">' + esc(meta[0]) + '</span></div>';
        }).join('') + '</div>';
      }

      function formHtml() {
        const demandeOptions = state.prestations.map(function (p) {
          return '<option value="' + esc(p.id) + '">' + esc(p.type_prestation || p.reference || 'Prestation') + '</option>';
        }).join('');
        return '<div class="pjc-card" style="margin-bottom:18px">'
          + '<div class="pjc-field"><label>Type de rendez-vous</label><div class="pjc-pillbar">'
          + '<button type="button" class="pjc-pill' + (state.type === 'appel' ? ' on' : '') + '" data-action="rdv-type" data-type="appel">Appel téléphonique</button>'
          + '<button type="button" class="pjc-pill' + (state.type === 'physique' ? ' on' : '') + '" data-action="rdv-type" data-type="physique">Rendez-vous physique</button>'
          + '</div></div>'
          + '<div class="pjc-row2">'
          + '<div class="pjc-field"><label>Date</label><input type="date" id="rdv-date" min="' + new Date().toISOString().slice(0, 10) + '"></div>'
          + '<div class="pjc-field"><label>Horaire (entre 7h et 22h)</label><input type="time" id="rdv-heure" min="07:00" max="22:00"></div>'
          + '</div>'
          + '<div class="pjc-field"><label>Objet (facultatif)</label><input type="text" id="rdv-objet" placeholder="Ex : point sur la prestation"></div>'
          + (state.prestations.length ? ('<div class="pjc-field"><label>Concerne une demande en cours ?</label><select id="rdv-demande"><option value="">Aucune — nouveau projet</option>' + demandeOptions + '</select></div>') : '')
          + (state.err ? ('<div class="pjc-err">' + esc(state.err) + '</div>') : '')
          + '<div class="pjc-actions-row">'
          + '<button type="button" class="btn btn-primary pjc-btn-noshrink" data-action="rdv-submit">Confirmer la demande</button>'
          + '<button type="button" class="btn btn-ghost pjc-btn-noshrink" data-action="rdv-cancel">Annuler</button>'
          + '</div></div>';
      }

      function paint() {
        container.innerHTML = '<div class="pjc-wrap"><div class="pjc-toolbar"><h2>Mes rendez-vous</h2>'
          + (state.formOpen ? '' : '<button type="button" class="btn btn-primary pjc-btn-noshrink" data-action="rdv-new">+ Nouveau rendez-vous</button>')
          + '</div>'
          + (state.formOpen ? formHtml() : '')
          + listHtml()
          + '</div>';
      }

      async function submitRdv() {
        const date = fieldVal('rdv-date');
        const heure = fieldVal('rdv-heure');
        const objet = fieldVal('rdv-objet');
        const demandeId = state.prestations.length ? fieldVal('rdv-demande') : '';
        if (!state.type) { state.err = 'Merci de choisir un type de rendez-vous.'; paint(); return; }
        if (!date || !heure) { state.err = 'Merci de choisir une date et un horaire.'; paint(); return; }
        if (heure < '07:00' || heure > '22:00') { state.err = 'Merci de choisir un horaire entre 7h et 22h.'; paint(); return; }
        const r = await sbFetch('rendez_vous', { method: 'POST', body: { client_id: orgId, prestation_id: demandeId || null, type_rdv: state.type, objet: objet || null, date_demandee: date, heure_demandee: heure } });
        if (!r.ok) { state.err = "Impossible d'envoyer la demande de rendez-vous. Réessayez."; paint(); return; }
        state.formOpen = false; state.type = null; state.err = '';
        toast('Demande de rendez-vous envoyée.');
        await load();
        paint();
      }

      container.onclick = function (e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        if (action === 'rdv-new') { state.formOpen = true; state.type = null; state.err = ''; paint(); }
        else if (action === 'rdv-cancel') { state.formOpen = false; paint(); }
        else if (action === 'rdv-type') { state.type = btn.getAttribute('data-type'); paint(); }
        else if (action === 'rdv-submit') { submitRdv(); }
      };

      container.innerHTML = '<div class="pjc-wrap"><div class="pjc-empty">Chargement…</div></div>';
      await load();
      paint();
    },
  };

  /* ============================================================
   * 4. COMPTE (client_users, client_organisation, client_organisation_members)
   * ============================================================ */
  window.ProjetModules.compte = {
    label: 'Compte',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      container.innerHTML = '<div class="pjc-wrap"><div class="pjc-empty">Chargement…</div></div>';

      const uid = localStorage.getItem('svc_uid');
      const [cuRes, orgRes, membersRes] = await Promise.all([
        sbFetch('client_users?id=eq.' + uid),
        sbFetch('client_organisation'),
        sbFetch('client_organisation_members'),
      ]);
      const cu = cuRes.ok && cuRes.data && cuRes.data[0];
      const org = orgRes.ok && orgRes.data && orgRes.data[0];
      const members = membersRes.ok ? (membersRes.data || []) : [];

      function fieldVal(id) { const el = container.querySelector('#' + id); return el ? el.value.trim() : ''; }

      function orgHtml() {
        return '<div class="pjc-card">'
          + '<div class="pjc-card-title" style="margin-bottom:14px">Mon organisation</div>'
          + '<div class="pjc-row2">'
          + '<div class="pjc-field"><label>Nom</label><input type="text" id="org-nom" value="' + esc(org.nom || '') + '"></div>'
          + '<div class="pjc-field"><label>Sport</label><input type="text" id="org-sport" value="' + esc(org.sport || '') + '"></div>'
          + '</div>'
          + '<div class="pjc-row2">'
          + '<div class="pjc-field"><label>Ville</label><input type="text" id="org-ville" value="' + esc(org.ville || '') + '"></div>'
          + '<div class="pjc-field"><label>Code postal</label><input type="text" id="org-cp" value="' + esc(org.code_postal || '') + '"></div>'
          + '</div>'
          + '<div class="pjc-field"><label>Adresse</label><input type="text" id="org-adresse" value="' + esc(org.adresse || '') + '"></div>'
          + ([org.type_client, org.ligue, org.division].filter(Boolean).length
              ? ('<div class="pjc-faint" style="margin:-6px 0 14px">' + [org.type_client, org.ligue, org.division].filter(Boolean).map(function (v) { return esc(v); }).join(' · ') + '</div>')
              : '')
          + '<button type="button" class="btn btn-primary pjc-btn-noshrink" data-action="org-save">Enregistrer</button>'
          + '<div class="pjc-card-title" style="margin:22px 0 4px">Membres</div>'
          + (members.length
              ? ('<div class="pjc-members">' + members.map(function (m) {
                  return '<div class="pjc-member-row"><span>' + esc([m.prenom, m.nom].filter(Boolean).join(' ') || 'Membre') + '</span>'
                    + (m.id === uid ? '<span class="pjc-faint">Vous</span>' : '') + '</div>';
                }).join('') + '</div>')
              : '<div class="pjc-empty" style="padding:16px">Aucun membre trouvé.</div>')
          + '</div>';
      }

      function paint() {
        container.innerHTML = '<div class="pjc-wrap"><div class="pjc-toolbar"><h2>Mon compte</h2></div>'
          + '<div class="pjc-card" style="margin-bottom:20px">'
          + '<div class="pjc-card-title" style="margin-bottom:14px">Profil</div>'
          + '<div class="pjc-row2">'
          + '<div class="pjc-field"><label>Prénom</label><input type="text" id="cpt-prenom" value="' + esc(cu ? (cu.prenom || '') : '') + '"></div>'
          + '<div class="pjc-field"><label>Nom</label><input type="text" id="cpt-nom" value="' + esc(cu ? (cu.nom || '') : '') + '"></div>'
          + '</div>'
          + '<div class="pjc-field"><label>Téléphone</label><input type="tel" id="cpt-tel" value="' + esc(cu ? (cu.telephone || '') : '') + '"></div>'
          + '<button type="button" class="btn btn-primary pjc-btn-noshrink" data-action="cpt-save">Enregistrer</button>'
          + '</div>'
          + (org ? orgHtml() : '')
          + '<div class="pjc-card" style="margin-top:20px;border-color:rgba(225,75,75,.3)">'
          + '<div class="pjc-card-title" style="margin-bottom:8px;color:var(--danger)">Supprimer mon compte</div>'
          + '<p class="pjc-faint" style="margin-bottom:16px">Ferme définitivement votre accès à SportVision Connect (connexion, e-mail, mot de passe). Si vous n\'avez encore aucune prestation ou devis en cours, votre fiche client est aussi supprimée entièrement. Sinon, elle est conservée conformément à nos obligations comptables — contactez-nous si vous souhaitez sa suppression complète.</p>'
          + '<button type="button" class="btn btn-ghost pjc-btn-noshrink" style="border:1px solid var(--danger);color:var(--danger)" data-action="cpt-delete">Supprimer mon compte</button>'
          + '<div class="pjc-err" id="cpt-del-msg"></div>'
          + '</div>'
          + '</div>';
      }

      async function saveProfile() {
        const prenom = fieldVal('cpt-prenom');
        const nom = fieldVal('cpt-nom');
        const telephone = fieldVal('cpt-tel');
        const r = await sbFetch('client_users?id=eq.' + uid, { method: 'PATCH', body: { prenom: prenom, nom: nom, telephone: telephone } });
        if (!r.ok) { toast('Enregistrement impossible.'); return; }
        if (cu) { cu.prenom = prenom; cu.nom = nom; cu.telephone = telephone; }
        toast('Modifications enregistrées.');
      }

      async function saveOrg() {
        const p_nom = fieldVal('org-nom');
        const p_sport = fieldVal('org-sport');
        const p_ville = fieldVal('org-ville');
        const p_code_postal = fieldVal('org-cp');
        const p_adresse = fieldVal('org-adresse');
        const r = await sbRpc('client_update_organisation', { p_nom: p_nom, p_ville: p_ville, p_code_postal: p_code_postal, p_adresse: p_adresse, p_sport: p_sport });
        if (!r.ok) { toast('Enregistrement impossible.'); return; }
        if (org) { org.nom = p_nom; org.sport = p_sport; org.ville = p_ville; org.code_postal = p_code_postal; org.adresse = p_adresse; }
        toast('Organisation mise à jour.');
      }

      async function deleteAccount() {
        const msgEl = container.querySelector('#cpt-del-msg');
        if (msgEl) msgEl.textContent = '';
        if (!confirm('Supprimer définitivement votre compte SportVision Connect ? Cette action est irréversible.')) return;
        const res = await sbFunction('delete-account', {});
        if (!res.ok) { if (msgEl) msgEl.textContent = (res.data && res.data.error) || 'Impossible de supprimer le compte.'; return; }
        toast(res.data && res.data.client_deleted ? 'Compte et fiche client supprimés.' : 'Compte supprimé.');
        handleLogout();
      }

      container.onclick = function (e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        if (action === 'cpt-save') saveProfile();
        else if (action === 'org-save') saveOrg();
        else if (action === 'cpt-delete') deleteAccount();
      };

      paint();
    },
  };

  /* ============================================================
   * 5. NOTIFICATIONS (bonus, hors contrat obligatoire) — agrégat en
   * lecture seule de devis en attente / factures à régler / messages
   * non lus / livrables récents, fidèle à renderNotifications() du
   * Portail. Read-only : aucun data-action, donc pas de handler requis.
   * Volontairement PAS de "nouvelle demande" ici : le configurateur
   * multi-étapes (catalogue_offres, options, disponibilité) du Portail
   * est un chantier séparé, hors périmètre — voir le résumé de livraison.
   * ============================================================ */
  window.ProjetModules.notifications = {
    label: 'Notifications',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      container.innerHTML = '<div class="pjc-wrap"><div class="pjc-empty">Chargement…</div></div>';

      const [devisRes, facturesRes, msgRes, livRes] = await Promise.all([
        sbFetch('client_devis?client_id=eq.' + orgId + '&statut=eq.envoy%C3%A9&select=numero,created_at&order=created_at.desc'),
        sbFetch('client_factures?client_id=eq.' + orgId + '&statut=eq.emise&select=numero,montant_ttc,created_at&order=created_at.desc'),
        sbFetch('messages_client?client_id=eq.' + orgId + '&auteur_type=eq.staff&lu=eq.false&select=contenu,created_at&order=created_at.desc'),
        sbFetch('client_media_livrables?select=nom,created_at&order=created_at.desc&limit=5'),
      ]);

      const items = []
        .concat((devisRes.ok ? devisRes.data || [] : []).map(function (d) {
          return { title: 'Devis disponible', detail: (d.numero || '') + ' est en attente de votre réponse', date: d.created_at, cls: 'pjc-badge-blue' };
        }))
        .concat((facturesRes.ok ? facturesRes.data || [] : []).map(function (f) {
          return { title: 'Facture à régler', detail: (f.numero || '') + ' — ' + fmtEUR(f.montant_ttc), date: f.created_at, cls: 'pjc-badge-orange' };
        }))
        .concat((msgRes.ok ? msgRes.data || [] : []).map(function (m) {
          return { title: 'Nouveau message', detail: (m.contenu || '').slice(0, 60), date: m.created_at, cls: 'pjc-badge-blue' };
        }))
        .concat((livRes.ok ? livRes.data || [] : []).map(function (l) {
          return { title: 'Livrable disponible', detail: l.nom || '', date: l.created_at, cls: 'pjc-badge-green' };
        }));
      items.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });

      container.innerHTML = '<div class="pjc-wrap"><div class="pjc-toolbar"><h2>Notifications</h2></div>'
        + (items.length
            ? ('<div class="pjc-list">' + items.map(function (n) {
                return '<div class="pjc-row"><div><div class="pjc-row-title">' + esc(n.title) + '</div>'
                  + '<div class="pjc-faint" style="margin-top:2px">' + esc(n.detail) + '</div></div>'
                  + '<span class="pjc-badge ' + n.cls + '">' + fmtDate(n.date) + '</span></div>';
              }).join('') + '</div>')
            : '<div class="pjc-empty">Rien de nouveau pour le moment.</div>')
        + '</div>';
    },
  };
})();
