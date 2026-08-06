/* ============================================================
 * SportVision Connect — Module Club
 * Demandes Club+ · Médias & Livrables · Sponsors · Administration
 *
 * Port fidèle (mais autonome) des équivalents dans Club+ (app.html,
 * en lecture seule, jamais modifié). Vanilla JS, aucune dépendance.
 *
 * S'appuie sur les globales déjà fournies par le shell Connect
 * (index.html, chargé avant ce fichier) : sbFetch, esc, toast,
 * SB_URL, SB_KEY, ainsi que les variables CSS --card/--border/etc.
 * et les classes .btn/.btn-primary/.btn-ghost/.badge.
 *
 * Architecture : chaque entrée de window.ClubModules est autonome —
 * son render(container, orgId, ctx) recrée un état dans une closure
 * dédiée à chaque appel, et rejoue container.innerHTML + les
 * gestionnaires d'événements (assignés via container.onclick =,
 * jamais addEventListener, pour ne jamais accumuler de doublons
 * quand render() est rappelé sur le même noeud).
 *
 * Rappel d'architecture Connect v2 : orgId === clubs.id pour une
 * organisation de type club. Il remplace club_id directement dans
 * toutes les requêtes ci-dessous.
 * ============================================================ */
(function () {
  'use strict';

  /* ── Styles partagés, injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('cm-shared-style')) return;
    const style = document.createElement('style');
    style.id = 'cm-shared-style';
    style.textContent = `
      .cm-wrap .btn{width:auto;margin-top:0}
      .cm-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .cm-toolbar h2{margin:0;font-size:19px}
      .cm-pillbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .cm-pill{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;padding:6px 14px;font-size:12.5px;cursor:pointer;font-weight:600}
      .cm-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}
      .cm-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}
      .cm-list{display:flex;flex-direction:column;gap:8px}
      .cm-row{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit}
      .cm-row:hover{border-color:var(--accent)}
      .cm-row .t{font-weight:700;font-size:14px}
      .cm-row .m{color:var(--muted);font-size:12px;margin-top:2px}
      .cm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
      .cm-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;text-align:left;cursor:pointer;font:inherit;color:inherit}
      .cm-card:hover{border-color:var(--accent)}
      .cm-card .thumb{height:84px;border-radius:8px;background:linear-gradient(135deg,#eef1f7,#e4e7ef);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;text-align:center;padding:8px;overflow:hidden}
      .cm-field{margin-bottom:12px}
      .cm-field label{display:block;font-size:12.5px;font-weight:600;margin-bottom:5px}
      .cm-field input,.cm-field select,.cm-field textarea{width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box}
      .cm-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .cm-overlay{position:fixed;inset:0;background:rgba(10,14,30,.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;overflow:auto}
      .cm-modal{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px;max-width:460px;width:100%;max-height:88vh;overflow:auto}
      .cm-modal.wide{max-width:640px}
      .cm-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
      .cm-close{background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--muted);line-height:1;padding:2px}
      .cm-comment{background:rgba(0,0,0,.03);border-radius:10px;padding:8px 10px;margin-bottom:6px;font-size:12.5px}
      .cm-info{border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12.5px;margin-bottom:12px}
      .cm-warn{border-color:#e2a03f55;background:rgba(226,160,63,.08)}
      .cm-actions{display:flex;flex-direction:column;gap:8px;margin-top:14px}
      .cm-inline-row{display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(0,0,0,.03);border-radius:10px;padding:9px 12px;margin-bottom:6px;font-size:12.5px}
      .cm-player-list{max-height:190px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 8px;background:var(--card)}
      .cm-player-row{display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:13px;cursor:pointer}
      .cm-player-row input[type=checkbox]{width:auto;flex:none}
      .cm-player-empty{color:var(--muted);font-size:12.5px;padding:4px 2px}
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
  function statusMeta(status) {
    return {
      recues: { label: 'Reçue', color: '#2f6bff' },
      info_manquante: { label: 'Informations manquantes', color: '#e2a03f' },
      en_traitement: { label: 'En traitement', color: '#7455ff' },
      prete_a_creer: { label: 'Prête à créer', color: '#06c2c2' },
      terminee: { label: 'Terminée', color: '#1fa971' },
      refusee: { label: 'Refusée', color: '#e14b4b' },
      brouillon: { label: 'Brouillon', color: '#5b6478' },
      a_valider: { label: 'À valider', color: '#e2a03f' },
      valide: { label: 'Validé', color: '#1fa971' },
      publie: { label: 'Publié', color: '#2f6bff' },
      actif: { label: 'Actif', color: '#1fa971' },
      invitation: { label: 'Invitation en attente', color: '#e2a03f' },
      suspendu: { label: 'Suspendu', color: '#e14b4b' },
      a_faire: { label: 'À faire', color: '#e2a03f' },
      realise: { label: 'Réalisé', color: '#1fa971' }
    }[status] || { label: status || '—', color: '#5b6478' };
  }
  function typeLabel(type) {
    return {
      avant_match: 'Affiche avant-match', composition: "Composition d'équipe", resultat: 'Affiche résultat',
      homme_du_match: 'Homme du match', recrutement_joueur: 'Recrutement joueur', recrutement_educateur: 'Recrutement éducateur',
      anniversaire: 'Anniversaire', publication_sponsor: 'Publication sponsor', annonce_tournoi: 'Annonce tournoi',
      annonce_importante: 'Annonce importante'
    }[type] || (type || '—');
  }
  function creditCost(type) {
    return {
      avant_match: 5, composition: 5, resultat: 2, homme_du_match: 2, recrutement_joueur: 5,
      recrutement_educateur: 5, anniversaire: 5, publication_sponsor: 5, annonce_tournoi: 5, annonce_importante: 2
    }[type] ?? null;
  }
  const NIVEAU_COLOR = { Or: '#e2a03f', Argent: '#a7b6c9', Bronze: '#7455ff' };
  const ROLE_LABELS = {
    admin: 'Administrateur du club', president: 'Président', secretaire: 'Secrétaire', comm: 'Community Manager',
    cm_externe: 'Community Manager externe', coach: 'Éducateur', resp_equipe: "Responsable d'équipe",
    sponsor_mgr: 'Responsable sponsors', tresorier: 'Trésorier', membre_bureau: 'Membre du bureau', lecture_seule: 'Lecture seule'
  };
  const ROLE_DESC = {
    admin: 'Accès complet au club : équipes, utilisateurs, sponsors, créations, abonnement et paramètres.',
    president: 'Vue stratégique : validations, sponsors, rapports, abonnement.',
    secretaire: 'Gestion administrative : équipes, utilisateurs, calendrier, documents.',
    comm: 'Newsroom, calendrier éditorial, Studio de création, médiathèque, sponsors, demandes.',
    cm_externe: 'Accès communication délégué à un prestataire externe.',
    coach: 'Accès à son équipe : actualités, médias, demandes simples.',
    resp_equipe: 'Gestion de son équipe : calendrier, résultats, médias, demandes et validations.',
    sponsor_mgr: 'Espace partenaires complet : fiches sponsors, contreparties, échéances.',
    tresorier: 'Vue financière restreinte : abonnement, factures, crédits, prestations commandées.',
    membre_bureau: 'Accès consultatif configurable par l’administrateur.',
    lecture_seule: 'Consultation uniquement, sans possibilité de modification.'
  };
  function roleLabel(code) { return ROLE_LABELS[code] || code; }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function localUid(prefix) { return prefix + Math.random().toString(36).slice(2, 10); }

  // sbFunctionCall a été retiré : c'était une redéfinition locale identique
  // à sbFunction du shell (index.html), avec un commentaire erroné affirmant
  // que le shell ne la fournissait pas. Risque de divergence si l'une des
  // deux copies était corrigée sans l'autre (ex: le fix du refresh token du
  // 2026-08-06, qui n'aurait profité qu'au shell). Tous les appels ci-dessous
  // utilisent désormais sbFunction directement.
  const sbFunctionCall = sbFunction;

  window.ClubModules = window.ClubModules || {};

  /* ============================================================
   * 1. DEMANDES CLUB+
   * ============================================================ */
  window.ClubModules.demandes = {
    label: 'Demandes',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      const STATUSES = ['recues', 'info_manquante', 'en_traitement', 'prete_a_creer', 'terminee', 'refusee'];
      const TYPES = ['avant_match', 'composition', 'resultat', 'homme_du_match', 'recrutement_joueur',
        'recrutement_educateur', 'anniversaire', 'publication_sponsor', 'annonce_tournoi', 'annonce_importante'];

      let items = [];
      let loaded = false;
      let filter = 'toutes';
      let openId = null;
      let wizard = null; // {step, type, team, urgency, detail}
      let myName = null;

      async function myDisplayName() {
        if (myName) return myName;
        const uid = localStorage.getItem('svc_uid');
        if (!uid) return 'Vous';
        const res = await sbFetch('club_members?user_id=eq.' + uid + '&club_id=eq.' + orgId + '&select=prenom,nom&limit=1');
        if (res.ok && res.data && res.data[0]) {
          const n = (((res.data[0].prenom || '') + ' ' + (res.data[0].nom || '')).trim());
          myName = n || 'Vous';
        } else myName = 'Vous';
        return myName;
      }

      async function load() {
        const res = await sbFetch('club_requests?club_id=eq.' + orgId + '&select=*&order=created_at.desc');
        if (!res.ok) toast('Erreur de chargement.');
        items = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      function row(r) {
        const sm = statusMeta(r.status);
        return `<button class="cm-row" data-action="open" data-id="${r.id}">
          <div style="display:flex;gap:10px;align-items:center">
            <span style="width:7px;height:7px;border-radius:4px;flex-shrink:0;background:${r.urgency === 'haute' ? 'var(--danger)' : 'var(--border)'}"></span>
            <div>
              <div class="t">${esc(typeLabel(r.type))}</div>
              <div class="m">${esc(r.team || '—')} · ${esc(r.requester_name || '—')} · ${fmtDate(r.created_at)}</div>
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
        return `<div class="cm-overlay" data-action="overlay">
          <div class="cm-modal wide">
            <div class="cm-drawer-head">
              <div>
                <b style="font-size:16px">${esc(typeLabel(r.type))}</b>
                <div class="m" style="margin-top:2px">${esc(r.team || '—')} · ${esc(r.requester_name || '—')} · ${fmtDate(r.created_at)}</div>
              </div>
              <button class="cm-close" data-action="close">✕</button>
            </div>
            <span class="badge" style="background:${sm.color}22;color:${sm.color};margin-bottom:14px;display:inline-block">${esc(sm.label)}</span>
            ${r.credits_reserved ? `<div class="cm-info cm-warn">${r.credits_reserved} crédit(s) réservé(s) — débités seulement si SportVision accepte la demande, sinon restitués.</div>` : ''}
            ${missing.length ? `<div class="cm-info cm-warn"><b style="display:block;margin-bottom:4px;font-size:11.5px;color:#b56a00">INFORMATIONS MANQUANTES</b>${missing.map(function (m) { return '<div>• ' + esc(m) + '</div>'; }).join('')}</div>` : ''}
            <div class="cm-info"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">DÉTAIL</div>${esc(r.detail || '—')}</div>
            <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:8px">COMMENTAIRES</div>
            ${comments.length ? comments.map(function (c) {
              return '<div class="cm-comment"><b>' + esc(c.author || '—') + '</b> <span style="color:var(--muted)">· ' + esc(c.date || '') + '</span><div style="margin-top:3px">' + esc(c.text || '') + '</div></div>';
            }).join('') : '<div class="m" style="margin-bottom:10px">Aucun commentaire.</div>'}
            <div style="display:flex;gap:8px;margin-top:10px">
              <input type="text" data-field="req-comment" placeholder="Ajouter un commentaire…" style="flex:1;padding:9px 10px;border:1px solid var(--border);border-radius:8px">
              <button class="btn btn-primary" data-action="comment" data-id="${r.id}">Envoyer</button>
            </div>
            ${r.status === 'recues' ? `<button class="btn btn-ghost" style="margin-top:14px;color:var(--danger)" data-action="cancel" data-id="${r.id}">Annuler la demande</button>` : ''}
          </div>
        </div>`;
      }

      function wizardHtml() {
        if (!wizard) return '';
        let body = '';
        if (wizard.step === 1) {
          body = `<div class="cm-grid">${TYPES.map(function (t) {
            const c = creditCost(t);
            return '<button class="cm-card" data-action="wtype" data-type="' + t + '">' +
              '<div style="font-weight:700;font-size:13px">' + esc(typeLabel(t)) + '</div>' +
              '<div style="color:var(--accent-2);font-size:11px;font-weight:600;margin-top:6px">' + (c == null ? 'Sur devis' : c + ' crédit' + (c > 1 ? 's' : '')) + '</div></button>';
          }).join('')}</div>`;
        } else if (wizard.step === 2) {
          body = `<div class="cm-field"><label>Équipe</label><input type="text" data-field="w-team" value="${esc(wizard.team)}" placeholder="ex : Seniors R1"></div>
            <div class="cm-field"><label>Détail</label><textarea rows="3" data-field="w-detail">${esc(wizard.detail)}</textarea></div>
            <div class="cm-field"><label>Urgence</label><select data-field="w-urgency">
              <option value="normale" ${wizard.urgency === 'normale' ? 'selected' : ''}>Normale</option>
              <option value="haute" ${wizard.urgency === 'haute' ? 'selected' : ''}>Haute</option>
            </select></div>`;
        } else {
          const c = creditCost(wizard.type);
          body = `<div class="cm-info"><b style="display:block;margin-bottom:6px">${esc(typeLabel(wizard.type))}</b>
            Équipe : ${esc(wizard.team || '—')}<br>Détail : ${esc(wizard.detail || '—')}<br>Urgence : ${esc(wizard.urgency)}
            <div style="color:var(--accent-2);font-weight:700;margin-top:8px">Coût estimé : ${c == null ? 'Sur devis' : c + ' crédit' + (c > 1 ? 's' : '')}</div>
          </div>
          <div class="m">La demande sera envoyée à SportVision pour vérification puis création.</div>`;
        }
        return `<div class="cm-overlay" data-action="overlay-wizard">
          <div class="cm-modal">
            <div class="cm-drawer-head"><b>Nouvelle demande — étape ${wizard.step}/3</b><button class="cm-close" data-action="close-wizard">✕</button></div>
            ${body}
            <div style="display:flex;justify-content:space-between;margin-top:18px">
              <button class="btn btn-ghost" style="visibility:${wizard.step === 1 ? 'hidden' : 'visible'}" data-action="wback">← Retour</button>
              ${wizard.step === 2 ? '<button class="btn btn-primary" data-action="wnext">Continuer →</button>' : ''}
              ${wizard.step === 3 ? '<button class="btn btn-primary" data-action="wsubmit">Envoyer la demande</button>' : ''}
            </div>
          </div>
        </div>`;
      }

      function paint() {
        let listHtml;
        if (!loaded) {
          listHtml = '<div class="cm-empty">Chargement…</div>';
        } else {
          const filtered = items.filter(function (r) { return filter === 'toutes' || r.status === filter; });
          listHtml = filtered.length ? ('<div class="cm-list">' + filtered.map(row).join('') + '</div>') : '<div class="cm-empty">Aucune demande dans ce statut pour le moment.</div>';
        }
        container.innerHTML = `<div class="cm-wrap">
          <div class="cm-toolbar"><h2>Demandes</h2><button class="btn btn-primary" data-action="new">+ Nouvelle demande</button></div>
          <div class="cm-pillbar">${['toutes'].concat(STATUSES).map(function (st) {
            return '<button class="cm-pill' + (filter === st ? ' on' : '') + '" data-action="filter" data-status="' + st + '">' + (st === 'toutes' ? 'Toutes' : esc(statusMeta(st).label)) + '</button>';
          }).join('')}</div>
          ${listHtml}
          ${drawerHtml()}
          ${wizardHtml()}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value : '';
      }
      function syncWizard() {
        if (!wizard) return;
        const team = fieldVal('w-team'); if (container.querySelector('[data-field="w-team"]')) wizard.team = team;
        const detail = fieldVal('w-detail'); if (container.querySelector('[data-field="w-detail"]')) wizard.detail = detail;
        const urgency = fieldVal('w-urgency'); if (container.querySelector('[data-field="w-urgency"]')) wizard.urgency = urgency;
      }

      async function submitWizard() {
        syncWizard();
        const cost = creditCost(wizard.type);
        const res = await sbFetch('rpc/submit_club_request', {
          method: 'POST', body: { p_club_id: orgId, p_team: wizard.team || null, p_type: wizard.type, p_urgency: wizard.urgency, p_detail: wizard.detail || '—', p_credits: cost }
        });
        if (!res.ok) { toast("Erreur lors de l'envoi de la demande."); return; }
        wizard = null;
        toast(cost == null ? 'Demande envoyée. Cette prestation sera transmise sur devis.' : ('Demande envoyée. ' + cost + ' crédit' + (cost > 1 ? 's' : '') + " réservé" + (cost > 1 ? 's' : '') + " en attente d'acceptation par SportVision."));
        await load(); paint();
      }
      async function cancelRequest(id) {
        const res = await sbFetch('rpc/update_club_request_status', { method: 'POST', body: { p_request_id: id, p_status: 'refusee' } });
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
        const res = await sbFetch('club_requests?id=eq.' + id, { method: 'PATCH', body: { comments: comments } });
        if (!res.ok) { toast('Action impossible.'); return; }
        rowItem.comments = comments;
        paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay"],[data-action="overlay-wizard"]');
          if (overlay && e.target === overlay) {
            if (overlay.getAttribute('data-action') === 'overlay') openId = null; else wizard = null;
            paint(); return;
          }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'filter') { filter = btn.getAttribute('data-status'); paint(); }
          else if (action === 'open') { openId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close') { openId = null; paint(); }
          else if (action === 'new') { wizard = { step: 1, type: null, team: '', urgency: 'normale', detail: '' }; paint(); }
          else if (action === 'close-wizard') { wizard = null; paint(); }
          else if (action === 'wtype') { wizard.type = btn.getAttribute('data-type'); wizard.step = 2; paint(); }
          else if (action === 'wback') { syncWizard(); wizard.step = Math.max(1, wizard.step - 1); paint(); }
          else if (action === 'wnext') { syncWizard(); wizard.step = 3; paint(); }
          else if (action === 'wsubmit') { await submitWizard(); }
          else if (action === 'cancel') { await cancelRequest(btn.getAttribute('data-id')); }
          else if (action === 'comment') { await addComment(btn.getAttribute('data-id')); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 2. MÉDIAS & LIVRABLES (club_media + club_creations)
   * ============================================================ */
  window.ClubModules.mediasLivrables = {
    label: 'Médias & Livrables',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      const MEDIA_TYPE_LABEL = { photo: 'Photo', video: 'Vidéo', logo: 'Logo', document: 'Document', creation: 'Création' };
      const MEDIA_SOURCE_LABEL = { externe: 'Lien externe', interne: 'Stockage', sportvision: 'Livré par SportVision' };
      const CREATION_STATUSES = ['brouillon', 'a_valider', 'valide', 'publie'];

      let tab = 'media'; // 'media' | 'creations'
      let media = [], creations = [];
      let loaded = false;
      let mediaTypeFilter = 'tous';
      let creationStatusFilter = 'toutes';
      let openMediaId = null, openCreationId = null;
      let mediaFormOpen = false, creationFormOpen = false;
      const accessRules = {}; // cache: 'club_media:<id>' -> array of rules
      let myName = null;

      // ── Tagging joueurs (migration-clubplus-v30) ──
      // clubPlayers : joueurs actifs du club (player_profiles), chargé avec le
      // reste au démarrage du module — voir load(). Sert à la fois au formulaire
      // de création (cases à cocher) et à la gestion des tags d'un média existant.
      let clubPlayers = [];
      // tagsByMedia : 'club_media:<id>'|'club_creations:<id>' -> array de lignes
      // media_player_tags (avec player_profiles(prenom,nom) embarqué), chargé en
      // bloc par loadTagsBulk() juste après load().
      const tagsByMedia = {};
      // blockedByMedia : même clé -> booléen, résultat de la fonction SQL dédiée
      // media_has_unauthorized_tagged_player (rpc), calculé seulement pour les
      // médias qui ont au moins un tag (un média non tagué n'est jamais bloqué).
      const blockedByMedia = {};
      // Cache local : nom d'équipe (minuscule) -> liste de player_id actifs dans
      // cette équipe, pour le bouton "Cocher l'équipe saisie" des formulaires.
      const teamPlayerCache = {};

      async function myDisplayName() {
        if (myName) return myName;
        const uid = localStorage.getItem('svc_uid');
        if (!uid) return null;
        const res = await sbFetch('club_members?user_id=eq.' + uid + '&club_id=eq.' + orgId + '&select=prenom,nom&limit=1');
        if (res.ok && res.data && res.data[0]) {
          const n = (((res.data[0].prenom || '') + ' ' + (res.data[0].nom || '')).trim());
          myName = n || null;
        }
        return myName;
      }

      async function load() {
        const [mRes, cRes, pRes] = await Promise.all([
          sbFetch('club_media?club_id=eq.' + orgId + '&select=*&order=created_at.desc'),
          sbFetch('club_creations?club_id=eq.' + orgId + '&select=*&order=created_at.desc'),
          sbFetch('player_profiles?club_id=eq.' + orgId + '&account_status=neq.retire&select=id,prenom,nom&order=nom.asc,prenom.asc')
        ]);
        if (!mRes.ok) toast('Erreur de chargement.');
        media = mRes.ok ? (mRes.data || []) : [];
        if (!cRes.ok) toast('Erreur de chargement.');
        creations = cRes.ok ? (cRes.data || []) : [];
        // Pas de toast d'erreur dédié ici : si la RLS ne donne accès à aucun
        // joueur pour ce rôle (ni admin ni éducateur — voir pp_admin_select /
        // pp_educateur_select de v13), la section de tagging affiche simplement
        // "aucun joueur", ce qui reste cohérent (le même rôle ne pourrait de
        // toute façon pas créer de tag côté serveur, voir mpt_manager_insert).
        clubPlayers = pRes.ok ? (pRes.data || []) : [];
        loaded = true;
      }

      // Repaint « silencieux » utilisé par les tâches de fond (chargement des
      // tags en bloc) : n'écrase jamais un formulaire de création actuellement
      // ouvert, pour ne pas effacer un titre/lien en cours de saisie par le
      // club (paint() régénère tout le innerHTML du formulaire sans conserver
      // les valeurs tapées — voir mediaFormHtml/creationFormHtml qui ne sont
      // jamais recalculés pendant la saisie, seulement à l'ouverture/fermeture).
      function backgroundPaint() {
        if (mediaFormOpen || creationFormOpen) return;
        paint();
      }

      // Charge en bloc les tags de tous les médias/créations affichés (une
      // requête par type), pour alimenter à la fois le bloc « Joueurs tagués »
      // des drawers et le badge d'alerte des cartes. Puis calcule, uniquement
      // pour les médias effectivement tagués, le statut de blocage via la
      // fonction SQL dédiée (media_has_unauthorized_tagged_player) plutôt que
      // de relire parental_authorizations côté client (table non lisible par
      // tous les rôles club — seuls les admins ont pp_admin_select — alors que
      // la fonction SQL, security definer, donne la même réponse à tout le
      // monde, exactement comme le fait déjà is_media_visible_to_family côté
      // serveur).
      async function loadTagsBulk() {
        const mediaIds = media.map(function (m) { return m.id; });
        const creationIds = creations.map(function (c) { return c.id; });
        const reqs = [
          mediaIds.length
            ? sbFetch('media_player_tags?media_ref_type=eq.club_media&media_ref_id=in.(' + mediaIds.join(',') + ')&select=id,media_ref_id,player_id,player_profiles(prenom,nom)')
            : Promise.resolve({ ok: true, data: [] }),
          creationIds.length
            ? sbFetch('media_player_tags?media_ref_type=eq.club_creations&media_ref_id=in.(' + creationIds.join(',') + ')&select=id,media_ref_id,player_id,player_profiles(prenom,nom)')
            : Promise.resolve({ ok: true, data: [] })
        ];
        const [mTagsRes, cTagsRes] = await Promise.all(reqs);
        Object.keys(tagsByMedia).forEach(function (k) { delete tagsByMedia[k]; });
        Object.keys(blockedByMedia).forEach(function (k) { delete blockedByMedia[k]; });
        // Initialise TOUS les médias/créations à [] (pas seulement ceux qui ont
        // des tags) : sans ça, renderTagManageBlock ne peut pas distinguer « pas
        // encore chargé » (undefined, affiche "Chargement…") de « chargé, aucun
        // tag » (tableau vide, affiche "Aucun joueur tagué").
        mediaIds.forEach(function (id) { tagsByMedia['club_media:' + id] = []; });
        creationIds.forEach(function (id) { tagsByMedia['club_creations:' + id] = []; });
        function ingest(res, type) {
          if (!res.ok) return;
          (res.data || []).forEach(function (t) {
            const key = type + ':' + t.media_ref_id;
            if (!tagsByMedia[key]) tagsByMedia[key] = [];
            tagsByMedia[key].push(t);
          });
        }
        ingest(mTagsRes, 'club_media');
        ingest(cTagsRes, 'club_creations');
        backgroundPaint();

        const keys = Object.keys(tagsByMedia).filter(function (k) { return tagsByMedia[k].length > 0; });
        await Promise.all(keys.map(async function (key) {
          const sep = key.indexOf(':');
          const type = key.slice(0, sep), id = key.slice(sep + 1);
          const res = await sbFetch('rpc/media_has_unauthorized_tagged_player', { method: 'POST', body: { p_media_ref_type: type, p_media_ref_id: id } });
          blockedByMedia[key] = res.ok ? !!res.data : false;
        }));
        backgroundPaint();
      }

      // Recalcule tags + statut de blocage pour un seul média après ajout/retrait
      // d'un tag (évite de recharger tout le club pour une seule ligne).
      async function recomputeBlocked(type, mediaId) {
        const key = type + ':' + mediaId;
        const tags = tagsByMedia[key] || [];
        if (!tags.length) { delete blockedByMedia[key]; paint(); return; }
        const res = await sbFetch('rpc/media_has_unauthorized_tagged_player', { method: 'POST', body: { p_media_ref_type: type, p_media_ref_id: mediaId } });
        blockedByMedia[key] = res.ok ? !!res.data : false;
        paint();
      }

      // Résout un nom d'équipe texte (tel que saisi dans le champ « Équipe »
      // du formulaire) vers les player_id actifs de cette équipe, pour le
      // bouton « Cocher l'équipe saisie ». Résolution simple par nom exact
      // (club_teams.name) — si aucune équipe ne correspond, retourne [].
      async function resolveTeamPlayerIds(teamName) {
        const key = teamName.trim().toLowerCase();
        if (!key) return [];
        if (teamPlayerCache[key]) return teamPlayerCache[key];
        const teamRes = await sbFetch('club_teams?club_id=eq.' + orgId + '&name=eq.' + encodeURIComponent(teamName.trim()) + '&select=id&limit=1');
        if (!teamRes.ok || !teamRes.data || !teamRes.data[0]) { teamPlayerCache[key] = []; return []; }
        const tmRes = await sbFetch('team_memberships?team_id=eq.' + teamRes.data[0].id + '&statut=eq.active&select=player_id');
        const ids = tmRes.ok ? (tmRes.data || []).map(function (r) { return r.player_id; }) : [];
        teamPlayerCache[key] = ids;
        return ids;
      }

      async function loadAccessRule(mediaRefType, id) {
        const key = mediaRefType + ':' + id;
        if (accessRules[key] !== undefined) return;
        const res = await sbFetch('media_access_rules?media_ref_type=eq.' + mediaRefType + '&media_ref_id=eq.' + id + '&select=*');
        if (!res.ok) toast('Erreur de chargement.');
        accessRules[key] = res.ok ? (res.data || []) : [];
        paint();
      }

      /* ── Tagging joueurs : rendu ── */
      // Section optionnelle affichée dans les formulaires de création (mf-/cf-) :
      // recherche + cases à cocher parmi clubPlayers. Volontaire de bout en bout :
      // aucune case cochée = aucun tag créé = comportement inchangé.
      function playerTagSectionHtml(prefix) {
        if (!clubPlayers.length) {
          return `<div class="cm-field"><label>Joueurs apparaissant sur ce média (optionnel)</label><div class="cm-player-empty">Aucun joueur actif trouvé pour ce club.</div></div>`;
        }
        return `<div class="cm-field">
          <label>Joueurs apparaissant sur ce média (optionnel)</label>
          <div style="display:flex;gap:8px;margin-bottom:6px">
            <input type="text" data-field="${prefix}-player-search" placeholder="Rechercher un joueur…" style="flex:1">
            <button type="button" class="btn btn-ghost" data-action="${prefix}-precheck-team">Cocher l'équipe saisie</button>
          </div>
          <div class="cm-player-list" data-role="${prefix}-player-list">
            ${clubPlayers.map(function (p) {
              const name = ((p.prenom || '') + ' ' + (p.nom || '')).trim();
              return '<label class="cm-player-row" data-name="' + esc(name.toLowerCase()) + '"><input type="checkbox" data-field="' + prefix + '-player" value="' + p.id + '"> ' + esc(name) + '</label>';
            }).join('')}
          </div>
        </div>`;
      }

      // Bloc « Joueurs tagués » affiché dans le drawer d'un média/création
      // existant : liste des tags avec bouton retirer, + ajout d'un joueur non
      // encore tagué. tagsByMedia[key] === undefined tant que loadTagsBulk() n'a
      // pas fini de charger (affiche un état « Chargement… » transitoire).
      function renderTagManageBlock(type, id) {
        const key = type + ':' + id;
        const tags = tagsByMedia[key];
        const heading = '<div style="font-size:11.5px;font-weight:700;color:var(--muted);margin:14px 0 8px">JOUEURS TAGUÉS</div>';
        if (tags === undefined) {
          return heading + '<div class="cm-info"><div class="cm-player-empty">Chargement…</div></div>';
        }
        const blocked = !!blockedByMedia[key];
        const rows = tags.length ? tags.map(function (t) {
          const p = t.player_profiles || {};
          const name = ((p.prenom || '') + ' ' + (p.nom || '')).trim() || 'Joueur';
          return '<div class="cm-inline-row"><span>' + esc(name) + '</span><button class="btn btn-ghost" data-action="untag" data-type="' + type + '" data-media="' + id + '" data-tag="' + t.id + '">Retirer</button></div>';
        }).join('') : '<div class="cm-player-empty" style="margin-bottom:8px">Aucun joueur tagué sur ce média.</div>';
        const taggedIds = tags.map(function (t) { return t.player_id; });
        const available = clubPlayers.filter(function (p) { return taggedIds.indexOf(p.id) === -1; });
        const addBlock = available.length ? (
          '<div style="display:flex;gap:8px;margin-top:8px">' +
            '<select data-field="tag-add-' + type + '-' + id + '" style="flex:1">' +
              available.map(function (p) { return '<option value="' + p.id + '">' + esc(((p.prenom || '') + ' ' + (p.nom || '')).trim()) + '</option>'; }).join('') +
            '</select>' +
            '<button class="btn btn-ghost" data-action="tag-add" data-type="' + type + '" data-media="' + id + '">Ajouter</button>' +
          '</div>'
        ) : '';
        const warn = blocked ? '<div class="cm-info cm-warn" style="margin-bottom:8px">⚠ Autorisation manquante pour au moins un joueur tagué — ce média n\'est pas diffusé aux familles concernées.</div>' : '';
        return heading + warn + '<div class="cm-info">' + rows + addBlock + '</div>';
      }

      async function tagPlayers(type, mediaId, playerIds, uid) {
        const rows = playerIds.map(function (pid) { return { media_ref_type: type, media_ref_id: mediaId, player_id: pid, tagged_by: uid }; });
        const res = await sbFetch('media_player_tags', { method: 'POST', body: rows });
        if (!res.ok) toast('Le média a été enregistré, mais le tag de certains joueurs a échoué.');
        return res;
      }

      async function untagPlayer(type, mediaId, tagId) {
        const res = await sbFetch('media_player_tags?id=eq.' + tagId, { method: 'DELETE' });
        if (!res.ok) { toast('Action impossible (droits insuffisants).'); return; }
        const key = type + ':' + mediaId;
        tagsByMedia[key] = (tagsByMedia[key] || []).filter(function (t) { return t.id !== tagId; });
        toast('Joueur retiré du tag.');
        await recomputeBlocked(type, mediaId);
      }

      async function addSingleTag(type, mediaId) {
        const sel = container.querySelector('[data-field="tag-add-' + type + '-' + mediaId + '"]');
        const playerId = sel ? sel.value : null;
        if (!playerId) { toast('Sélectionnez un joueur à taguer.'); return; }
        const uid = localStorage.getItem('svc_uid') || null;
        const res = await sbFetch('media_player_tags', { method: 'POST', body: { media_ref_type: type, media_ref_id: mediaId, player_id: playerId, tagged_by: uid } });
        if (!res.ok) { toast('Action impossible (droits insuffisants).'); return; }
        const created = res.data && res.data[0];
        const key = type + ':' + mediaId;
        const p = clubPlayers.find(function (x) { return x.id === playerId; });
        tagsByMedia[key] = (tagsByMedia[key] || []).concat([{ id: created ? created.id : playerId, media_ref_id: mediaId, player_id: playerId, player_profiles: p || null }]);
        toast('Joueur tagué.');
        await recomputeBlocked(type, mediaId);
      }

      async function precheckTeamPlayers(prefix) {
        const teamField = container.querySelector('[data-field="' + prefix + '-team"]');
        const teamName = teamField ? teamField.value.trim() : '';
        if (!teamName) { toast('Indiquez une équipe pour pouvoir précocher ses joueurs.'); return; }
        const ids = await resolveTeamPlayerIds(teamName);
        if (!ids.length) { toast('Aucun joueur actif trouvé pour l\'équipe « ' + teamName + ' ».'); return; }
        const list = container.querySelector('[data-role="' + prefix + '-player-list"]');
        if (!list) return;
        let count = 0;
        ids.forEach(function (id) {
          const cb = list.querySelector('input[value="' + id + '"]');
          if (cb && !cb.checked) { cb.checked = true; count++; }
        });
        toast(count ? (count + ' joueur(s) de « ' + teamName + ' » coché(s).') : 'Ces joueurs étaient déjà cochés.');
      }

      function mediaCard(m) {
        const badgeColor = m.expired ? 'var(--danger)' : 'var(--ok)';
        const badgeBg = m.expired ? '#e14b4b22' : '#1fa97122';
        const blocked = !!blockedByMedia['club_media:' + m.id];
        return `<button class="cm-card" data-action="open-media" data-id="${m.id}">
          <div class="thumb">${esc(m.title)}</div>
          <div style="font-weight:600;font-size:12.5px;margin-top:8px">${esc(m.title)}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px">
            <span class="badge" style="background:#2f6bff22;color:var(--accent)">${esc(MEDIA_TYPE_LABEL[m.type] || m.type)}</span>
            <span class="badge" style="background:${badgeBg};color:${badgeColor}">${m.expired ? 'Lien expiré' : esc(MEDIA_SOURCE_LABEL[m.source] || m.source)}</span>
            ${blocked ? '<span class="badge" style="background:#e2a03f22;color:#b56a00">⚠ Autorisation manquante</span>' : ''}
          </div>
        </button>`;
      }
      function creationCard(c) {
        const sm = statusMeta(c.status);
        const blocked = !!blockedByMedia['club_creations:' + c.id];
        return `<button class="cm-card" data-action="open-creation" data-id="${c.id}">
          <div class="thumb">${esc(c.title)}</div>
          <div style="font-weight:600;font-size:12.5px;margin-top:8px">${esc(c.title)}</div>
          <div class="m" style="margin-top:2px">${esc(c.team || '—')}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px">
            <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
            ${blocked ? '<span class="badge" style="background:#e2a03f22;color:#b56a00">⚠ Autorisation manquante</span>' : ''}
          </div>
        </button>`;
      }

      function mediaDrawerHtml() {
        if (!openMediaId) return '';
        const m = media.find(function (x) { return x.id === openMediaId; });
        if (!m) return '';
        const key = 'club_media:' + m.id;
        if (accessRules[key] === undefined) loadAccessRule('club_media', m.id);
        const rules = accessRules[key] || [];
        const rule = rules[0];
        const canOpen = m.link && !m.expired;
        return `<div class="cm-overlay" data-action="overlay-media">
          <div class="cm-modal">
            <div class="cm-drawer-head"><b>${esc(m.title)}</b><button class="cm-close" data-action="close-media">✕</button></div>
            <div class="thumb" style="height:150px;margin-bottom:14px">${esc(m.title)}</div>
            <div class="cm-info">
              Type : ${esc(MEDIA_TYPE_LABEL[m.type] || m.type)}<br>
              Équipe : ${esc(m.team || '—')}<br>
              Source : ${esc(MEDIA_SOURCE_LABEL[m.source] || m.source)}<br>
              Auteur : ${esc(m.author_name || '—')}<br>
              Ajouté le : ${fmtDate(m.created_at)}
            </div>
            ${m.expired ? '<div class="cm-info cm-warn">Ce lien est expiré ou indisponible. Demandez un nouveau lien à son auteur.</div>' : ''}
            <div class="cm-info">${rule ? ('Publié vers l’Espace Joueur — téléchargement ' + (rule.telechargement_autorise ? 'autorisé' : 'non autorisé') + ', partage ' + (rule.partage_autorise ? 'autorisé' : 'non autorisé') + (rule.expire_at ? (', expire le ' + fmtDate(rule.expire_at)) : '') + '.') : 'Non publié vers l’Espace Joueur.'}</div>
            <div class="cm-actions">
              ${canOpen ? `<button class="btn btn-primary" data-action="open-link" data-href="${esc(m.link)}">Ouvrir le lien</button>` : '<button class="btn btn-ghost" disabled>Aucun lien disponible</button>'}
            </div>
            ${renderTagManageBlock('club_media', m.id)}
          </div>
        </div>`;
      }

      function creationDrawerHtml() {
        if (!openCreationId) return '';
        const c = creations.find(function (x) { return x.id === openCreationId; });
        if (!c) return '';
        const sm = statusMeta(c.status);
        return `<div class="cm-overlay" data-action="overlay-creation">
          <div class="cm-modal">
            <div class="cm-drawer-head"><b>${esc(c.title)}</b><button class="cm-close" data-action="close-creation">✕</button></div>
            <span class="badge" style="background:${sm.color}22;color:${sm.color};margin-bottom:14px;display:inline-block">${esc(sm.label)}</span>
            <div class="cm-info">
              Type : ${esc(c.type || '—')}<br>
              Équipe : ${esc(c.team || '—')}<br>
              Sponsor associé : ${esc(c.sponsor || 'Aucun')}<br>
              Créé le : ${fmtDate(c.created_at)}
            </div>
            <div class="cm-info">Aucun fichier téléchargeable associé à ce livrable dans ce module (le rendu final est produit via le Studio de création).</div>
            <div class="cm-field"><label>Statut</label><select data-field="creation-status">
              ${CREATION_STATUSES.map(function (st) { return '<option value="' + st + '" ' + (st === c.status ? 'selected' : '') + '>' + esc(statusMeta(st).label) + '</option>'; }).join('')}
            </select></div>
            <button class="btn btn-primary" data-action="save-creation-status" data-id="${c.id}">Mettre à jour le statut</button>
            ${renderTagManageBlock('club_creations', c.id)}
          </div>
        </div>`;
      }

      function mediaFormHtml() {
        if (!mediaFormOpen) return '';
        return `<div class="cm-overlay" data-action="overlay-media-form">
          <div class="cm-modal wide">
            <div class="cm-drawer-head"><b>Importer un média</b><button class="cm-close" data-action="close-media-form">✕</button></div>
            <div class="cm-field"><label>Titre</label><input type="text" data-field="mf-title"></div>
            <div class="cm-row2">
              <div class="cm-field"><label>Type</label><select data-field="mf-type">
                <option value="photo">Photo</option><option value="video">Vidéo</option><option value="logo">Logo</option>
                <option value="document">Document</option><option value="creation">Création</option>
              </select></div>
              <div class="cm-field"><label>Équipe</label><input type="text" data-field="mf-team" placeholder="ex : Seniors R1"></div>
            </div>
            <div class="cm-field"><label>Source</label><select data-field="mf-source">
              <option value="externe">Lien externe</option><option value="interne">Stockage</option>
            </select></div>
            <div class="cm-field"><label>Lien (si externe)</label><input type="text" data-field="mf-link" placeholder="https://…"></div>
            ${playerTagSectionHtml('mf')}
            <button class="btn btn-primary" data-action="submit-media-form">Importer</button>
          </div>
        </div>`;
      }
      function creationFormHtml() {
        if (!creationFormOpen) return '';
        return `<div class="cm-overlay" data-action="overlay-creation-form">
          <div class="cm-modal wide">
            <div class="cm-drawer-head"><b>Nouvelle création</b><button class="cm-close" data-action="close-creation-form">✕</button></div>
            <div class="cm-field"><label>Titre</label><input type="text" data-field="cf-title"></div>
            <div class="cm-row2">
              <div class="cm-field"><label>Type</label><input type="text" data-field="cf-type" placeholder="ex : Affiche avant-match"></div>
              <div class="cm-field"><label>Équipe</label><input type="text" data-field="cf-team" placeholder="ex : Seniors R1"></div>
            </div>
            <div class="cm-field"><label>Sponsor associé (optionnel)</label><input type="text" data-field="cf-sponsor"></div>
            ${playerTagSectionHtml('cf')}
            <button class="btn btn-primary" data-action="submit-creation-form">Créer en brouillon</button>
          </div>
        </div>`;
      }

      function paint() {
        let content;
        if (!loaded) {
          content = '<div class="cm-empty">Chargement…</div>';
        } else if (tab === 'media') {
          const list = media.filter(function (m) { return mediaTypeFilter === 'tous' || m.type === mediaTypeFilter; });
          content = `<div class="cm-pillbar">${['tous', 'photo', 'video', 'logo', 'document', 'creation'].map(function (k) {
            return '<button class="cm-pill' + (mediaTypeFilter === k ? ' on' : '') + '" data-action="media-filter" data-type="' + k + '">' + (k === 'tous' ? 'Tous les types' : esc(MEDIA_TYPE_LABEL[k])) + '</button>';
          }).join('')}</div>
          ${list.length ? ('<div class="cm-grid">' + list.map(mediaCard).join('') + '</div>') : '<div class="cm-empty">Aucun média pour ce filtre.</div>'}`;
        } else {
          const list = creations.filter(function (c) { return creationStatusFilter === 'toutes' || c.status === creationStatusFilter; });
          content = `<div class="cm-pillbar">${['toutes'].concat(CREATION_STATUSES).map(function (k) {
            return '<button class="cm-pill' + (creationStatusFilter === k ? ' on' : '') + '" data-action="creation-filter" data-status="' + k + '">' + (k === 'toutes' ? 'Toutes' : esc(statusMeta(k).label)) + '</button>';
          }).join('')}</div>
          ${list.length ? ('<div class="cm-grid">' + list.map(creationCard).join('') + '</div>') : '<div class="cm-empty">Aucune création pour ce filtre.</div>'}`;
        }
        container.innerHTML = `<div class="cm-wrap">
          <div class="cm-toolbar">
            <h2>Médias & Livrables</h2>
            <button class="btn btn-primary" data-action="${tab === 'media' ? 'new-media' : 'new-creation'}">${tab === 'media' ? '+ Importer un média' : '+ Nouvelle création'}</button>
          </div>
          <div class="cm-pillbar">
            <button class="cm-pill${tab === 'media' ? ' on' : ''}" data-action="tab" data-tab="media">Banque média</button>
            <button class="cm-pill${tab === 'creations' ? ' on' : ''}" data-action="tab" data-tab="creations">Créations</button>
          </div>
          ${content}
          ${mediaDrawerHtml()}
          ${creationDrawerHtml()}
          ${mediaFormHtml()}
          ${creationFormHtml()}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value.trim() : '';
      }

      function checkedPlayerIds(field) {
        return Array.prototype.map.call(container.querySelectorAll('[data-field="' + field + '"]:checked'), function (el) { return el.value; });
      }

      async function submitMediaForm() {
        const title = fieldVal('mf-title');
        if (!title) { toast('Le titre est obligatoire.'); return; }
        const type = fieldVal('mf-type') || 'photo';
        const team = fieldVal('mf-team');
        const source = fieldVal('mf-source') || 'externe';
        const link = fieldVal('mf-link');
        const uid = localStorage.getItem('svc_uid') || null;
        const authorName = await myDisplayName();
        const playerIds = checkedPlayerIds('mf-player');
        const res = await sbFetch('club_media', { method: 'POST', body: { club_id: orgId, title: title, type: type, team: team || null, source: source, link: link || null, author_id: uid, author_name: authorName } });
        if (!res.ok) { toast("Erreur lors de l'import."); return; }
        const created = res.data && res.data[0];
        if (created && playerIds.length) await tagPlayers('club_media', created.id, playerIds, uid);
        mediaFormOpen = false;
        toast('Média ajouté à la médiathèque.' + (created && playerIds.length ? (' ' + playerIds.length + ' joueur(s) tagué(s).') : ''));
        await load(); paint(); loadTagsBulk();
      }
      async function submitCreationForm() {
        const title = fieldVal('cf-title');
        if (!title) { toast('Le titre est obligatoire.'); return; }
        const type = fieldVal('cf-type') || 'autre';
        const team = fieldVal('cf-team');
        const sponsor = fieldVal('cf-sponsor');
        const uid = localStorage.getItem('svc_uid') || null;
        const playerIds = checkedPlayerIds('cf-player');
        const res = await sbFetch('club_creations', { method: 'POST', body: { club_id: orgId, title: title, type: type, team: team || null, status: 'brouillon', sponsor: sponsor || null, created_by: uid } });
        if (!res.ok) { toast("Erreur lors de l'enregistrement."); return; }
        const created = res.data && res.data[0];
        if (created && playerIds.length) await tagPlayers('club_creations', created.id, playerIds, uid);
        creationFormOpen = false;
        toast('Création enregistrée en brouillon.' + (created && playerIds.length ? (' ' + playerIds.length + ' joueur(s) tagué(s).') : ''));
        await load(); paint(); loadTagsBulk();
      }
      async function saveCreationStatus(id) {
        const sel = container.querySelector('[data-field="creation-status"]');
        const status = sel ? sel.value : null;
        if (!status) return;
        const res = await sbFetch('club_creations?id=eq.' + id, { method: 'PATCH', body: { status: status } });
        if (!res.ok) { toast('Action impossible.'); return; }
        openCreationId = null;
        toast('Statut mis à jour.');
        await load(); paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action^="overlay"]');
          if (overlay && e.target === overlay) {
            const a = overlay.getAttribute('data-action');
            if (a === 'overlay-media') openMediaId = null;
            else if (a === 'overlay-creation') openCreationId = null;
            else if (a === 'overlay-media-form') mediaFormOpen = false;
            else if (a === 'overlay-creation-form') creationFormOpen = false;
            paint(); return;
          }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'tab') { tab = btn.getAttribute('data-tab'); paint(); }
          else if (action === 'media-filter') { mediaTypeFilter = btn.getAttribute('data-type'); paint(); }
          else if (action === 'creation-filter') { creationStatusFilter = btn.getAttribute('data-status'); paint(); }
          else if (action === 'open-media') { openMediaId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close-media') { openMediaId = null; paint(); }
          else if (action === 'open-creation') { openCreationId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close-creation') { openCreationId = null; paint(); }
          else if (action === 'open-link') {
            // Le lien vient d'un champ libre saisi par un membre du club (club_media.link) :
            // ne jamais l'ouvrir sans vérifier le schéma, sinon un lien "javascript:..."
            // exécuterait du code dans le contexte de l'app (vol de session via svc_tok).
            const href = btn.getAttribute('data-href') || '';
            if (/^https?:\/\//i.test(href)) { window.open(href, '_blank', 'noopener,noreferrer'); }
            else { toast('Lien invalide ou non sécurisé — impossible de l\'ouvrir.'); }
          }
          else if (action === 'new-media') { mediaFormOpen = true; paint(); }
          else if (action === 'close-media-form') { mediaFormOpen = false; paint(); }
          else if (action === 'submit-media-form') { await submitMediaForm(); }
          else if (action === 'new-creation') { creationFormOpen = true; paint(); }
          else if (action === 'close-creation-form') { creationFormOpen = false; paint(); }
          else if (action === 'submit-creation-form') { await submitCreationForm(); }
          else if (action === 'save-creation-status') { await saveCreationStatus(btn.getAttribute('data-id')); }
          else if (action === 'mf-precheck-team') { await precheckTeamPlayers('mf'); }
          else if (action === 'cf-precheck-team') { await precheckTeamPlayers('cf'); }
          else if (action === 'untag') { await untagPlayer(btn.getAttribute('data-type'), btn.getAttribute('data-media'), btn.getAttribute('data-tag')); }
          else if (action === 'tag-add') { await addSingleTag(btn.getAttribute('data-type'), btn.getAttribute('data-media')); }
        };
        // Recherche dans la liste de cases à cocher des formulaires de création :
        // filtre uniquement l'affichage (display none/'') des lignes, sans jamais
        // rappeler paint() — un repaint pendant la frappe régénérerait tout le
        // formulaire et effacerait titre/équipe/lien déjà saisis (voir
        // backgroundPaint plus haut pour la même précaution côté chargement de fond).
        container.oninput = function (e) {
          const field = e.target && e.target.getAttribute && e.target.getAttribute('data-field');
          if (field !== 'mf-player-search' && field !== 'cf-player-search') return;
          const prefix = field.split('-')[0];
          const q = e.target.value.trim().toLowerCase();
          const list = container.querySelector('[data-role="' + prefix + '-player-list"]');
          if (!list) return;
          Array.prototype.forEach.call(list.querySelectorAll('.cm-player-row'), function (row) {
            const name = row.getAttribute('data-name') || '';
            row.style.display = (!q || name.indexOf(q) !== -1) ? '' : 'none';
          });
        };
      }

      await load();
      paint();
      loadTagsBulk();
    }
  };

  /* ============================================================
   * 3. SPONSORS (club_sponsors)
   * ============================================================ */
  window.ClubModules.sponsors = {
    label: 'Sponsors',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let sponsors = [];
      let loaded = false;
      let openId = null;
      let formOpen = false;

      async function load() {
        const res = await sbFetch('club_sponsors?club_id=eq.' + orgId + '&select=*&order=created_at.desc');
        if (!res.ok) toast('Erreur de chargement.');
        sponsors = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      function card(sp) {
        const color = NIVEAU_COLOR[sp.niveau] || '#7455ff';
        const commitments = Array.isArray(sp.commitments) ? sp.commitments : [];
        const done = commitments.filter(function (c) { return c.status === 'realise'; }).length;
        return `<button class="cm-card" data-action="open" data-id="${sp.id}">
          <div style="font-weight:700;font-size:14px">${esc(sp.name)}</div>
          <div class="m" style="margin-top:2px">${esc(sp.secteur || '—')}</div>
          <span class="badge" style="background:${color}22;color:${color};margin-top:8px;display:inline-block">${esc(sp.niveau || 'Bronze')}</span>
          <div class="m" style="margin-top:6px">${done}/${commitments.length} contrepartie${commitments.length > 1 ? 's' : ''} réalisée${commitments.length > 1 ? 's' : ''}</div>
        </button>`;
      }

      function drawerHtml() {
        if (!openId) return '';
        const sp = sponsors.find(function (x) { return x.id === openId; });
        if (!sp) return '';
        const color = NIVEAU_COLOR[sp.niveau] || '#7455ff';
        const commitments = Array.isArray(sp.commitments) ? sp.commitments : [];
        return `<div class="cm-overlay" data-action="overlay">
          <div class="cm-modal">
            <div class="cm-drawer-head"><b>${esc(sp.name)}</b><button class="cm-close" data-action="close">✕</button></div>
            <span class="badge" style="background:${color}22;color:${color};margin-bottom:14px;display:inline-block">Partenaire ${esc(sp.niveau || 'Bronze')}</span>
            <div class="cm-info">
              Secteur : ${esc(sp.secteur || '—')}<br>
              Contact : ${esc(sp.contact || '—')}<br>
              Contrat : ${fmtDate(sp.date_debut)} — ${fmtDate(sp.date_fin)}<br>
              Montant annuel : ${money(sp.montant)}
            </div>
            <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:8px">CONTREPARTIES</div>
            ${commitments.length ? commitments.map(function (c) {
              const sm = statusMeta(c.status);
              return '<div class="cm-inline-row"><div><div style="font-weight:600">' + esc(c.type || '—') + '</div><div class="m">' + (c.due === 'Permanent' ? 'Permanent' : fmtDate(c.due)) + '</div></div>' +
                (c.status === 'a_faire' ? '<button class="btn btn-ghost" data-action="commit-done" data-sponsor="' + sp.id + '" data-commit="' + c.id + '">Marquer réalisé</button>' : '<span class="badge" style="background:' + sm.color + '22;color:' + sm.color + '">' + esc(sm.label) + '</span>') +
                '</div>';
            }).join('') : '<div class="m" style="margin-bottom:10px">Aucune contrepartie enregistrée.</div>'}
            <div class="cm-row2" style="margin-top:10px">
              <input type="text" data-field="commit-type" placeholder="Type de contrepartie">
              <input type="text" data-field="commit-due" placeholder="Échéance (AAAA-MM-JJ)">
            </div>
            <button class="btn btn-ghost" data-action="add-commit" data-id="${sp.id}">+ Ajouter une contrepartie</button>
          </div>
        </div>`;
      }

      function formHtml() {
        if (!formOpen) return '';
        return `<div class="cm-overlay" data-action="overlay-form">
          <div class="cm-modal">
            <div class="cm-drawer-head"><b>Ajouter un sponsor</b><button class="cm-close" data-action="close-form">✕</button></div>
            <div class="cm-field"><label>Nom</label><input type="text" data-field="sf-name"></div>
            <div class="cm-row2">
              <div class="cm-field"><label>Secteur</label><input type="text" data-field="sf-sector"></div>
              <div class="cm-field"><label>Niveau</label><select data-field="sf-level"><option>Or</option><option>Argent</option><option selected>Bronze</option></select></div>
            </div>
            <div class="cm-field"><label>Contact</label><input type="text" data-field="sf-contact"></div>
            <div class="cm-row2">
              <div class="cm-field"><label>Montant annuel (€)</label><input type="text" data-field="sf-amount" placeholder="0"></div>
              <div class="cm-field"><label>Fin de contrat</label><input type="date" data-field="sf-end"></div>
            </div>
            <button class="btn btn-primary" data-action="submit-form">Ajouter</button>
          </div>
        </div>`;
      }

      function paint() {
        const content = !loaded ? '<div class="cm-empty">Chargement…</div>'
          : (sponsors.length ? ('<div class="cm-grid">' + sponsors.map(card).join('') + '</div>') : '<div class="cm-empty">Aucun sponsor pour le moment.</div>');
        container.innerHTML = `<div class="cm-wrap">
          <div class="cm-toolbar"><h2>Sponsors</h2><button class="btn btn-primary" data-action="new">+ Ajouter un sponsor</button></div>
          ${content}
          ${drawerHtml()}
          ${formHtml()}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value.trim() : '';
      }

      async function submitForm() {
        const name = fieldVal('sf-name');
        if (!name) { toast('Le nom du sponsor est obligatoire.'); return; }
        const secteur = fieldVal('sf-sector') || null;
        const niveau = fieldVal('sf-level') || 'Bronze';
        const contact = fieldVal('sf-contact') || null;
        const montant = Number(fieldVal('sf-amount')) || 0;
        const dateFin = fieldVal('sf-end') || null;
        const res = await sbFetch('club_sponsors', { method: 'POST', body: { club_id: orgId, name: name, secteur: secteur, niveau: niveau, contact: contact, montant: montant, date_fin: dateFin, teams: [], commitments: [] } });
        if (!res.ok) { toast("Erreur lors de l'ajout."); return; }
        formOpen = false;
        toast('Sponsor ajouté avec succès.');
        await load(); paint();
      }
      async function markCommitDone(spId, cId) {
        const sp = sponsors.find(function (x) { return x.id === spId; });
        if (!sp) return;
        const commitments = (Array.isArray(sp.commitments) ? sp.commitments : []).map(function (c) { return c.id === cId ? Object.assign({}, c, { status: 'realise' }) : c; });
        const res = await sbFetch('club_sponsors?id=eq.' + spId, { method: 'PATCH', body: { commitments: commitments } });
        if (!res.ok) { toast('Action impossible.'); return; }
        sp.commitments = commitments;
        paint();
      }
      async function addCommit(spId) {
        const type = fieldVal('commit-type');
        if (!type) { toast('Précisez le type de contrepartie.'); return; }
        const due = fieldVal('commit-due') || 'Permanent';
        const sp = sponsors.find(function (x) { return x.id === spId; });
        if (!sp) return;
        const commitments = (Array.isArray(sp.commitments) ? sp.commitments : []).concat([{ id: localUid('c'), type: type, due: due, status: 'a_faire' }]);
        const res = await sbFetch('club_sponsors?id=eq.' + spId, { method: 'PATCH', body: { commitments: commitments } });
        if (!res.ok) { toast('Action impossible.'); return; }
        sp.commitments = commitments;
        paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action^="overlay"]');
          if (overlay && e.target === overlay) {
            const a = overlay.getAttribute('data-action');
            if (a === 'overlay') openId = null; else if (a === 'overlay-form') formOpen = false;
            paint(); return;
          }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'open') { openId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close') { openId = null; paint(); }
          else if (action === 'new') { formOpen = true; paint(); }
          else if (action === 'close-form') { formOpen = false; paint(); }
          else if (action === 'submit-form') { await submitForm(); }
          else if (action === 'commit-done') { await markCommitDone(btn.getAttribute('data-sponsor'), btn.getAttribute('data-commit')); }
          else if (action === 'add-commit') { await addCommit(btn.getAttribute('data-id')); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 4. ADMINISTRATION (club_members + edge function clubplus-invite)
   * ============================================================ */
  window.ClubModules.administration = {
    label: 'Administration',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      const ROLE_CODES = ['admin', 'president', 'secretaire', 'comm', 'cm_externe', 'coach', 'resp_equipe', 'sponsor_mgr', 'tresorier', 'membre_bureau', 'lecture_seule'];
      // Aligné strictement sur le backend (trouvé en recette du 2026-08-06) :
      // is_club_admin() (migration-clubplus-v2.sql) et l'edge function
      // clubplus-invite n'acceptent que role==='admin', jamais 'president'.
      // Inclure 'president' ici affichait les actions d'administration à un
      // rôle dont chaque appel échouait ensuite (invite/changement de rôle/
      // suspension) sans que l'UI ne prévienne pourquoi.
      const canManage = !!(ctx && ctx.role === 'admin');

      let members = [];
      let loaded = false;
      let openId = null;
      let invite = null; // {step, prenom, nom, email, role}

      async function load() {
        const res = await sbFetch('club_members?club_id=eq.' + orgId + '&select=id,role,prenom,nom,telephone,teams,status&order=created_at.asc');
        if (!res.ok) toast('Erreur de chargement.');
        members = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      function row(u) {
        const sm = statusMeta(u.status);
        const name = ((u.prenom || '') + ' ' + (u.nom || '')).trim() || '(sans nom)';
        return `<button class="cm-row" data-action="open" data-id="${u.id}">
          <div>
            <div class="t">${esc(name)}</div>
            <div class="m">${esc(roleLabel(u.role))}${u.teams && u.teams.length ? ' · ' + esc(u.teams.join(', ')) : ''}</div>
          </div>
          <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
        </button>`;
      }

      function drawerHtml() {
        if (!openId) return '';
        const u = members.find(function (x) { return x.id === openId; });
        if (!u) return '';
        const sm = statusMeta(u.status);
        const name = ((u.prenom || '') + ' ' + (u.nom || '')).trim() || '(sans nom)';
        return `<div class="cm-overlay" data-action="overlay">
          <div class="cm-modal">
            <div class="cm-drawer-head"><b>${esc(name)}</b><button class="cm-close" data-action="close">✕</button></div>
            <span class="badge" style="background:${sm.color}22;color:${sm.color};margin-bottom:14px;display:inline-block">${esc(sm.label)}</span>
            <div class="cm-info">
              Téléphone : ${esc(u.telephone || '—')}<br>
              Équipes autorisées : ${u.teams && u.teams.length ? esc(u.teams.join(', ')) : 'Toutes'}
            </div>
            ${canManage ? `
              <div class="cm-field"><label>Rôle</label><select data-field="role-select">
                ${ROLE_CODES.map(function (r) { return '<option value="' + r + '" ' + (r === u.role ? 'selected' : '') + '>' + esc(roleLabel(r)) + '</option>'; }).join('')}
              </select></div>
              <button class="btn btn-primary" data-action="save-role" data-id="${u.id}">Enregistrer le rôle</button>
              <div class="cm-actions">
                <button class="btn btn-ghost" data-action="toggle-suspend" data-id="${u.id}" data-status="${esc(u.status)}">${u.status === 'suspendu' ? "Réactiver l'accès" : "Suspendre l'accès"}</button>
              </div>
            ` : '<div class="m">Seul un administrateur ou le président du club peut modifier le rôle ou le statut d’un membre.</div>'}
          </div>
        </div>`;
      }

      function inviteHtml() {
        if (!invite) return '';
        let body = '';
        if (invite.step === 1) {
          body = `<div class="cm-row2">
              <div class="cm-field"><label>Prénom</label><input type="text" data-field="iw-prenom" value="${esc(invite.prenom)}"></div>
              <div class="cm-field"><label>Nom</label><input type="text" data-field="iw-nom" value="${esc(invite.nom)}"></div>
            </div>
            <div class="cm-field"><label>E-mail</label><input type="email" data-field="iw-email" value="${esc(invite.email)}"></div>`;
        } else {
          body = `<div class="cm-field"><label>Rôle</label><select data-field="iw-role">
              ${ROLE_CODES.map(function (r) { return '<option value="' + r + '" ' + (r === invite.role ? 'selected' : '') + '>' + esc(roleLabel(r)) + '</option>'; }).join('')}
            </select></div>
            <div class="cm-info">${esc(ROLE_DESC[invite.role] || '')}</div>`;
        }
        return `<div class="cm-overlay" data-action="overlay-invite">
          <div class="cm-modal">
            <div class="cm-drawer-head"><b>Inviter un utilisateur — étape ${invite.step}/2</b><button class="cm-close" data-action="close-invite">✕</button></div>
            ${body}
            <div style="display:flex;justify-content:space-between;margin-top:18px">
              <button class="btn btn-ghost" style="visibility:${invite.step === 1 ? 'hidden' : 'visible'}" data-action="invite-back">← Retour</button>
              <button class="btn btn-primary" data-action="invite-next">${invite.step === 2 ? "Envoyer l'invitation" : 'Continuer'}</button>
            </div>
          </div>
        </div>`;
      }

      function paint() {
        const content = !loaded ? '<div class="cm-empty">Chargement…</div>'
          : (members.length ? ('<div class="cm-list">' + members.map(row).join('') + '</div>') : '<div class="cm-empty">Aucun utilisateur pour le moment.</div>');
        container.innerHTML = `<div class="cm-wrap">
          <div class="cm-toolbar"><h2>Administration</h2><button class="btn btn-primary" data-action="new">+ Inviter un utilisateur</button></div>
          ${content}
          ${drawerHtml()}
          ${inviteHtml()}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value.trim() : '';
      }
      function syncInvite() {
        if (!invite) return;
        if (container.querySelector('[data-field="iw-prenom"]')) invite.prenom = fieldVal('iw-prenom');
        if (container.querySelector('[data-field="iw-nom"]')) invite.nom = fieldVal('iw-nom');
        if (container.querySelector('[data-field="iw-email"]')) invite.email = fieldVal('iw-email');
        if (container.querySelector('[data-field="iw-role"]')) invite.role = fieldVal('iw-role') || invite.role;
      }

      async function saveRole(id) {
        const sel = container.querySelector('[data-field="role-select"]');
        const role = sel ? sel.value : null;
        if (!role) return;
        const res = await sbFetch('club_members?id=eq.' + id, { method: 'PATCH', body: { role: role } });
        if (!res.ok) { toast('Action impossible (droits administrateur requis).'); return; }
        openId = null;
        toast('Rôle mis à jour.');
        await load(); paint();
      }
      async function toggleSuspend(id, currentStatus) {
        const next = currentStatus === 'suspendu' ? 'actif' : 'suspendu';
        const res = await sbFetch('club_members?id=eq.' + id, { method: 'PATCH', body: { status: next } });
        if (!res.ok) { toast('Action impossible (droits administrateur requis).'); return; }
        openId = null;
        toast(next === 'suspendu' ? 'Accès suspendu.' : 'Accès réactivé.');
        await load(); paint();
      }
      async function submitInvite() {
        syncInvite();
        if (!invite.prenom || !invite.email) { toast("Le prénom et l'e-mail sont obligatoires."); return; }
        const email = invite.email;
        const res = await sbFunctionCall('clubplus-invite', { email: invite.email, prenom: invite.prenom, nom: invite.nom, club_id: orgId, role: invite.role, teams: [] });
        if (!res.ok) { toast((res.data && res.data.error) || "Erreur lors de l'envoi de l'invitation."); return; }
        invite = null;
        toast(res.data && res.data.already_invited ? (email + ' est déjà membre de ce club.') : ('Invitation envoyée à ' + email + '.'));
        await load(); paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action^="overlay"]');
          if (overlay && e.target === overlay) {
            const a = overlay.getAttribute('data-action');
            if (a === 'overlay') openId = null; else if (a === 'overlay-invite') invite = null;
            paint(); return;
          }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'open') { openId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close') { openId = null; paint(); }
          else if (action === 'new') { invite = { step: 1, prenom: '', nom: '', email: '', role: 'coach' }; paint(); }
          else if (action === 'close-invite') { invite = null; paint(); }
          else if (action === 'invite-back') { syncInvite(); invite.step = 1; paint(); }
          else if (action === 'invite-next') {
            syncInvite();
            if (invite.step === 1) {
              if (!invite.prenom || !invite.email) { toast("Le prénom et l'e-mail sont obligatoires."); return; }
              invite.step = 2; paint();
            } else {
              await submitInvite();
            }
          }
          else if (action === 'save-role') { await saveRole(btn.getAttribute('data-id')); }
          else if (action === 'toggle-suspend') { await toggleSuspend(btn.getAttribute('data-id'), btn.getAttribute('data-status')); }
        };
      }

      await load();
      paint();
    }
  };
})();
