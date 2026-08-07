/* ══════════════════════════════════════════════════════════════════════
   SportVision Connect — Module « Projet : Contenus à valider »

   Le pipeline `contenus` côté SportVision OS (Community Managers) a un
   statut "a_valider_client" (et "corrections" en retour) qui n'avait
   jusqu'ici aucune interface côté client — le CM devait gérer les
   validations manuellement, hors app. Ce module comble ce trou : liste
   les contenus visibles (RLS `contenus_client_select`, migration-connect-
   validation-contenus.sql), avec deux actions possibles sur un contenu
   "à valider" : Valider / Demander des corrections (commentaire
   obligatoire), via la RPC `client_valider_contenu`.

   Dépendances globales fournies par le shell Connect (app/index.html) :
   sbFetch, sbRpc, esc, toast, et les variables/classes CSS partagées
   (--card, --border, --radius, --shadow, --accent, --muted, --text, --ok,
   --danger, .btn, .btn-primary, .btn-ghost, .badge). Réutilise directement
   les classes .pjc-* déjà en place dans les autres modules Projet
   (cf. projet-demandes-livrables-messagerie-compte.js) — même style
   injecté sous le même id, gardé pour éviter un double-inject.

   Rappel d'architecture Connect v2 : pour un espace « projet », orgId =
   client_id directement (organizations.id réutilise clients.id).

   Chaque module est autonome : tout son état vit dans une closure créée
   à chaque appel de render(), et les gestionnaires d'événements sont
   assignés via container.onclick = (jamais addEventListener), pour ne
   jamais accumuler de doublons quand render() est rejoué sur le même
   noeud.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.ProjetModules = window.ProjetModules || {};

  /* ── Styles partagés, injectés une seule fois (même id que les autres
     modules Projet — le premier module rendu les pose, les suivants
     trouvent l'id déjà présent et ne réinjectent rien) ── */
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
      .pjc-btn-noshrink{width:auto;margin-top:0}
    `;
    document.head.appendChild(style);
  }

  function fmtDate(s) { return s ? new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'; }

  const STATUT_BADGE = {
    a_valider_client: ['En attente', 'pjc-badge-orange'],
    corrections: ['Corrections demandées', 'pjc-badge-orange'],
    valide: ['Validé', 'pjc-badge-green'],
    programme: ['Programmé', 'pjc-badge-blue'],
    publie: ['Publié', 'pjc-badge-green'],
    archive: ['Archivé', 'pjc-badge-grey'],
  };

  window.ProjetModules.validationContenus = {
    label: 'Contenus à valider',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      const state = { list: [], openCorrectionsId: null, err: {} };

      async function load() {
        const r = await sbFetch('contenus?client_id=eq.' + orgId + '&select=id,titre,plateforme,type_contenu,hook,legende,cta,hashtags,date_prevue,statut&order=date_prevue.desc.nullslast');
        state.list = r.ok ? (r.data || []) : [];
      }

      function metaLine(c) {
        return [c.plateforme, c.type_contenu].filter(Boolean).join(' · ') + (c.date_prevue ? (' · ' + fmtDate(c.date_prevue)) : '');
      }

      function contentPreview(c) {
        const parts = [];
        if (c.hook) parts.push('<div><span class="pjc-eyebrow">Accroche</span><div>' + esc(c.hook) + '</div></div>');
        if (c.legende) parts.push('<div><span class="pjc-eyebrow">Légende</span><div style="white-space:pre-wrap">' + esc(c.legende) + '</div></div>');
        if (c.cta) parts.push('<div><span class="pjc-eyebrow">Appel à l\'action</span><div>' + esc(c.cta) + '</div></div>');
        if (c.hashtags) parts.push('<div><span class="pjc-eyebrow">Hashtags</span><div>' + esc(c.hashtags) + '</div></div>');
        return parts.length ? '<div style="display:flex;flex-direction:column;gap:8px;margin:12px 0">' + parts.join('') + '</div>' : '';
      }

      function pendingCardHtml(c) {
        const open = state.openCorrectionsId === c.id;
        const err = state.err[c.id];
        return '<div class="pjc-card" style="margin-bottom:14px;border-color:rgba(245,165,36,.35)">'
          + '<div class="pjc-toolbar" style="margin-bottom:6px"><div class="pjc-card-title">' + esc(c.titre || 'Contenu') + '</div>'
          + '<span class="pjc-badge pjc-badge-orange">En attente de votre validation</span></div>'
          + '<div class="pjc-faint">' + esc(metaLine(c)) + '</div>'
          + contentPreview(c)
          + (open
              ? ('<div class="pjc-field" style="margin-top:10px"><label>Que faut-il corriger ?</label><textarea id="pvc-comment-' + esc(c.id) + '" rows="3" placeholder="Précisez ce qui doit être modifié…"></textarea></div>'
                  + (err ? ('<div class="pjc-err">' + esc(err) + '</div>') : '')
                  + '<div class="pjc-actions-row">'
                  + '<button type="button" class="btn btn-primary pjc-btn-noshrink" data-action="envoyer-corrections" data-id="' + esc(c.id) + '">Envoyer la demande</button>'
                  + '<button type="button" class="btn btn-ghost pjc-btn-noshrink" data-action="annuler-corrections" data-id="' + esc(c.id) + '">Annuler</button>'
                  + '</div>')
              : ('<div class="pjc-actions-row" style="margin-top:10px">'
                  + '<button type="button" class="btn btn-primary pjc-btn-noshrink" data-action="valider" data-id="' + esc(c.id) + '">✓ Valider</button>'
                  + '<button type="button" class="btn btn-ghost pjc-btn-noshrink" data-action="toggle-corrections" data-id="' + esc(c.id) + '">Demander des corrections</button>'
                  + '</div>'))
          + '</div>';
      }

      function historyRowHtml(c) {
        const meta = STATUT_BADGE[c.statut] || [c.statut || '—', 'pjc-badge-grey'];
        return '<div class="pjc-row"><div><div class="pjc-row-title">' + esc(c.titre || 'Contenu') + '</div>'
          + '<div class="pjc-faint" style="margin-top:2px">' + esc(metaLine(c)) + '</div></div>'
          + '<span class="pjc-badge ' + meta[1] + '">' + esc(meta[0]) + '</span></div>';
      }

      function paint() {
        const pending = state.list.filter(function (c) { return c.statut === 'a_valider_client'; });
        const history = state.list.filter(function (c) { return c.statut !== 'a_valider_client'; });
        container.innerHTML = '<div class="pjc-wrap"><div class="pjc-toolbar"><h2>Contenus à valider</h2></div>'
          + (pending.length ? pending.map(pendingCardHtml).join('') : '<div class="pjc-empty">Aucun contenu en attente de votre validation pour le moment.</div>')
          + '<div class="pjc-card-title" style="margin:22px 0 10px">Historique</div>'
          + (history.length ? ('<div class="pjc-list">' + history.map(historyRowHtml).join('') + '</div>') : '<div class="pjc-empty">Aucun contenu dans l\'historique pour le moment.</div>')
          + '</div>';
      }

      async function decider(id, decision, commentaire) {
        const r = await sbRpc('client_valider_contenu', { p_contenu_id: id, p_decision: decision, p_commentaire: commentaire || null });
        if (!r.ok) {
          const msg = (r.data && r.data.message) || 'Action impossible.';
          if (decision === 'corrections') { state.err[id] = msg; paint(); }
          else toast(msg);
          return;
        }
        state.openCorrectionsId = null;
        delete state.err[id];
        toast(decision === 'valide' ? 'Contenu validé.' : 'Demande de corrections envoyée.');
        await load();
        paint();
      }

      container.onclick = function (e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        if (action === 'valider') {
          decider(id, 'valide');
        } else if (action === 'toggle-corrections') {
          state.openCorrectionsId = id;
          delete state.err[id];
          paint();
        } else if (action === 'annuler-corrections') {
          state.openCorrectionsId = null;
          delete state.err[id];
          paint();
        } else if (action === 'envoyer-corrections') {
          const ta = container.querySelector('#pvc-comment-' + id);
          const commentaire = ta ? ta.value.trim() : '';
          if (!commentaire) { state.err[id] = 'Merci de préciser ce qui doit être corrigé.'; paint(); return; }
          decider(id, 'corrections', commentaire);
        }
      };

      container.innerHTML = '<div class="pjc-wrap"><div class="pjc-empty">Chargement…</div></div>';
      await load();
      paint();
    },
  };
})();
