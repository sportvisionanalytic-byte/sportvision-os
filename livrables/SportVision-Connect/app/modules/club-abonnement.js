/* ============================================================
 * SportVision Connect — Module Club
 * Abonnement & crédits
 *
 * Port fidèle (mais autonome) de tplAbonnement() et des fonctions
 * associées dans SportVision Club+ (app.html, lecture seule, jamais
 * modifié) : isSafeHttpUrl, openBillingPortal, startSubscriptionCheckout,
 * handleAbonnementReturn, openCreditPack, buyCreditPack.
 *
 * Fichier autonome, comme les autres modules Club (voir
 * club-demandes-medias-sponsors-admin.js) : aucune dépendance vers une
 * variable/fonction déclarée dans un AUTRE fichier de module (leurs
 * helpers sont scopés à leur propre IIFE, donc invisibles ici). S'appuie
 * uniquement sur les globales fournies par le shell Connect (index.html) :
 * sbFetch, sbFunction, esc, toast — jamais aliasées en haut de fichier
 * (ce fichier est chargé AVANT le script du shell qui les déclare ; un
 * alias du type `const x = sbFunction` en tête de fichier lèverait une
 * ReferenceError au chargement, comme rencontré en production le
 * 2026-08-07 sur club-demandes-medias-sponsors-admin.js — on résout donc
 * ces fonctions uniquement à l'intérieur des fonctions ci-dessous).
 *
 * Backend (déjà construit, non modifié par ce fichier) :
 *   - table `clubs` : plan / engagement / pilot_mode / credits_balance /
 *     credits_monthly / credits_reserved / subscription_status /
 *     stripe_customer_id / stripe_subscription_id (migration-clubplus-v25)
 *   - table `club_credit_transactions` : historique des crédits, lecture
 *     seule pour un membre du club (policy cct_member_select) — l'écriture
 *     est réservée au staff SportVision (migration-clubplus-v1)
 *   - edge function `clubplus-billing-portal` ({club_id} -> {url})
 *   - edge function `create-clubplus-subscription-checkout`
 *     ({club_id, plan, engagement} -> {url})
 *
 * ⚠ Vérifié en direct sur le projet Supabase le 2026-08-07 (requête OPTIONS
 * sur SB_URL/functions/v1/<nom>, comparée à d'autres fonctions clubplus-*
 * du même projet) : clubplus-billing-portal et
 * create-clubplus-subscription-checkout répondent 404 "Requested function
 * was not found" — leur code source existe dans le repo
 * (supabase/functions/.../index.ts) mais elles ne sont PAS déployées sur ce
 * projet à ce jour, contrairement à clubplus-invite et clubplus-onboarding
 * (même préfixe, 200 sur le même test). Ce module les appelle par leur nom
 * exact tel que spécifié dans leur code source : tant qu'elles ne sont pas
 * déployées, « Gérer mon abonnement » et « Activer mon abonnement »
 * échoueront proprement avec un toast d'erreur (pas de crash) — c'est un
 * sujet de déploiement Supabase, pas un bug de ce fichier.
 * ============================================================ */
(function () {
  'use strict';

  /* ── Styles, injectés une seule fois, scopés à ce module ── */
  function ensureStyles() {
    if (document.getElementById('cm-abonnement-style')) return;
    const style = document.createElement('style');
    style.id = 'cm-abonnement-style';
    style.textContent = `
      .cm-ab .btn{width:auto;margin-top:0}
      .cm-ab-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .cm-ab-toolbar h2{margin:0;font-size:19px}
      .cm-ab-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}
      .cm-ab-muted{color:var(--muted);font-size:12px}
      .cm-ab-hero{background:linear-gradient(135deg,var(--card),var(--card-2));border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:20px}
      .cm-ab-panel{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px}
      .cm-ab-panel.warn{border-color:#F0A94E55;background:rgba(226,160,63,.08);margin-bottom:20px}
      .cm-ab-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
      .cm-ab-progress{height:8px;border-radius:99px;background:rgba(157,174,195,.18);overflow:hidden}
      .cm-ab-progress i{display:block;height:100%;background:var(--accent);border-radius:99px}
      .cm-ab-tx-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)}
      .cm-ab-tx-row:last-child{border-bottom:none}
      .cm-ab-overlay{position:fixed;inset:0;background:rgba(10,14,30,.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;overflow:auto}
      .cm-ab-modal{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px;max-width:460px;width:100%;max-height:88vh;overflow:auto}
      .cm-ab-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
      .cm-ab-close{background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--muted);line-height:1;padding:2px}
      .cm-ab-pack-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px}
      .cm-ab-pack{background:var(--card-2);border:1px solid var(--border);border-radius:12px;padding:14px 10px;text-align:center;cursor:pointer;font:inherit;color:inherit}
      .cm-ab-pack:hover{border-color:var(--accent)}
    `;
    document.head.appendChild(style);
  }

  window.ClubModules = window.ClubModules || {};

  window.ClubModules.abonnement = {
    label: 'Abonnement & crédits',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      /* Catalogue de formules, identique à CLUBPLUS_TARIFS côté edge
         function create-clubplus-subscription-checkout (source de vérité
         du prix facturé — ce module ne fait qu'afficher le même montant,
         il ne l'envoie jamais lui-même à Stripe). */
      const CLUBPLUS_PLANS = {
        club: { label: 'Club+', prix: { '12mois': 49, 'sans': 59 } },
        performance: { label: 'Club+ Performance', prix: { '12mois': 129, 'sans': 149 } }
      };
      const SUB_STATUS_META = {
        actif: { label: 'Actif', color: 'var(--ok)' },
        impaye: { label: 'Impayé', color: 'var(--danger)' },
        annule: { label: 'Résilié', color: 'var(--danger)' }
      };
      const CREDIT_PACKS = [
        { amount: 10, price: '19 €' },
        { amount: 25, price: '39 €' },
        { amount: 50, price: '69 €' }
      ];

      /* Seul un administrateur ACTIF du club peut déclencher les actions
         Stripe : c'est la seule règle réellement vérifiée côté serveur
         (clubplus-billing-portal et create-clubplus-subscription-checkout
         interrogent club_members en service_role et n'acceptent QUE
         role==='admin' — jamais 'president' ni 'tresorier', malgré ce que
         suggérait la matrice de permissions personnalisable par défaut de
         Club+ pour la clé gerer_abonnement). Même choix d'alignement
         strict sur le backend que window.ClubModules.administration dans
         club-demandes-medias-sponsors-admin.js, pour la même raison :
         afficher un bouton à un rôle dont l'appel échouerait ensuite en
         403 sans explication serait pire que de l'orienter directement
         vers un administrateur. */
      const canManage = !!(ctx && ctx.role === 'admin');

      let sub = null;
      let loaded = false;
      let creditTx = [];
      let creditTxLoaded = false;
      let memberCount = null;
      let teamCount = null;
      let packOpen = false;

      async function load() {
        const res = await sbFetch('clubs?id=eq.' + orgId + '&select=plan,engagement,pilot_mode,subscription_status,stripe_customer_id,stripe_subscription_id,credits_balance,credits_monthly,credits_reserved');
        if (!res.ok) toast('Erreur de chargement.');
        sub = (res.ok && res.data && res.data[0]) ? res.data[0] : {};
        loaded = true;
      }

      async function loadCreditTx() {
        const res = await sbFetch('club_credit_transactions?club_id=eq.' + orgId + '&select=id,label,amount,created_at&order=created_at.desc&limit=25');
        creditTx = res.ok ? (res.data || []) : [];
        creditTxLoaded = true;
        paint();
      }

      async function loadQuotas() {
        const [mRes, tRes] = await Promise.all([
          sbFetch('club_members?club_id=eq.' + orgId + '&status=eq.actif&select=id'),
          sbFetch('club_teams?club_id=eq.' + orgId + '&select=id')
        ]);
        memberCount = mRes.ok ? (mRes.data || []).length : 0;
        teamCount = tRes.ok ? (tRes.data || []).length : 0;
        paint();
      }

      function fmtDate(v) {
        if (!v) return '—';
        const d = new Date(v);
        if (isNaN(d.getTime())) return String(v);
        return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
      }

      /* Toute URL renvoyée par une edge function est validée avant
         redirection (même règle que Club+, isSafeHttpUrl) : ces URLs
         viennent de Stripe via nos propres fonctions, mais on ne redirige
         jamais vers une chaîne non vérifiée. */
      function isSafeHttpUrl(u) {
        return typeof u === 'string' && /^https?:\/\//i.test(u.trim());
      }

      async function openBillingPortal() {
        const res = await sbFunction('clubplus-billing-portal', { club_id: orgId });
        const url = res.data && res.data.url;
        if (!res.ok || !isSafeHttpUrl(url)) {
          toast((res.data && res.data.error) || 'Portail de facturation indisponible pour le moment.');
          return;
        }
        window.location.href = url;
      }

      /* Souscription initiale : la formule envoyée est celle déjà
         enregistrée sur la fiche du club — le PRIX n'est jamais transmis,
         il est recalculé côté serveur par l'edge function. */
      async function startSubscriptionCheckout() {
        const plan = (sub && CLUBPLUS_PLANS[sub.plan]) ? sub.plan : 'club';
        const engagement = (sub && sub.engagement === 'sans') ? 'sans' : '12mois';
        const res = await sbFunction('create-clubplus-subscription-checkout', { club_id: orgId, plan: plan, engagement: engagement });
        const url = res.data && res.data.url;
        if (!res.ok || !isSafeHttpUrl(url)) {
          toast((res.data && res.data.error) || 'Paiement indisponible pour le moment.');
          return;
        }
        window.location.href = url;
      }

      /* Retour depuis Stripe Checkout (?abonnement=succes|annule).
         L'abonnement n'est activé en base que par le webhook Stripe : au
         retour, `clubs` peut ne pas encore être à jour (quelques
         secondes) — on ne nettoie donc que ce paramètre d'URL (jamais
         location.pathname brut, pour ne pas effacer d'autres paramètres
         de la page — même précaution que handlePaymentReturn dans
         index.html) et load() ci-dessous relit de toute façon l'état réel
         au lieu d'un état optimiste. */
      function handleAbonnementReturn() {
        const params = new URLSearchParams(location.search);
        const r = params.get('abonnement');
        if (!r) return;
        const url = new URL(location.href);
        url.searchParams.delete('abonnement');
        history.replaceState(null, '', url.pathname + url.search);
        if (r === 'annule') { toast("Souscription annulée — aucun prélèvement n'a été effectué."); return; }
        if (r === 'succes') { toast("Paiement enregistré. L'activation de votre abonnement peut prendre quelques secondes."); }
      }

      /* Achat de packs de crédits : dans Club+ (app.html, fonction
         buyCreditPack), ce bouton ne fait qu'incrémenter une variable JS
         locale (wallet.balance) et pousser une ligne dans un tableau en
         mémoire — AUCUN appel backend, même en session réelle. Ce
         comportement n'a rien à voir avec un vrai paiement : le reproduire
         tel quel ici ferait croire à un club qu'il a acheté des crédits
         alors qu'aucun paiement n'a eu lieu et que rien n'est persisté
         (le solde reviendrait à sa valeur réelle au prochain chargement).
         Vérifié : aucune edge function de paiement ponctuel pour les packs
         n'existe dans ce projet (seules clubplus-billing-portal et
         create-clubplus-subscription-checkout existent côté abonnement),
         et de toute façon clubs.credits_balance est protégé en écriture
         pour les non-staff par le trigger protect_sensitive_club_fields
         (migration-clubplus-v25) — un PATCH direct depuis ce module
         échouerait toujours. Plutôt que d'inventer un flux de paiement
         (choix de tarification, produits Stripe, webhook dédié) qui n'est
         pas dans le périmètre de ce fichier, ce module transmet la
         demande à SportVision — voir le rapport de portage pour le detail
         de ce qui resterait à construire pour rendre l'achat réellement
         libre-service. */
      function requestCreditPack(amount, label) {
        packOpen = false;
        paint();
        toast('Demande transmise à SportVision pour l’ajout de ' + label + ' à votre solde. L’achat de packs en libre-service arrive prochainement.');
      }

      function planInfo() {
        const code = (sub && CLUBPLUS_PLANS[sub.plan]) ? sub.plan : 'club';
        const eng = (sub && sub.engagement === 'sans') ? 'sans' : '12mois';
        const p = CLUBPLUS_PLANS[code];
        return {
          label: p.label,
          price: p.prix[eng] + ' € TTC/mois',
          engagementLabel: eng === 'sans' ? 'sans engagement' : '12 mois'
        };
      }

      function heroHtml() {
        const info = planInfo();
        const sm = SUB_STATUS_META[sub.subscription_status];
        const abonne = !!sub.stripe_subscription_id;
        const badge = sm
          ? `<span class="badge" style="background:${sm.color}22;color:${sm.color};margin-left:8px">${esc(sm.label)}</span>`
          : `<span class="badge" style="background:rgba(157,174,195,.18);color:var(--muted);margin-left:8px">Sans abonnement</span>`;
        let action = '';
        if (canManage) {
          action = abonne
            ? `<button class="btn btn-primary" data-action="billing-portal">Gérer mon abonnement</button>`
            : `<button class="btn btn-primary" data-action="start-checkout">Activer mon abonnement</button>`;
        }
        const note = abonne
          ? `<div class="cm-ab-muted" style="margin-top:6px">Factures, moyen de paiement, changement de formule et résiliation sont gérés dans le Portail de facturation Stripe.</div>`
          : `<div class="cm-ab-muted" style="margin-top:6px">${sub.pilot_mode ? 'Club en phase pilote : ' : ''}aucun prélèvement récurrent n’est en place pour ce club.${canManage ? ' L’activation ouvre un paiement sécurisé Stripe pour la formule ci-dessus.' : ''}</div>`;
        const manageNote = !canManage
          ? `<div class="cm-ab-muted" style="margin-top:6px">Seul un administrateur du club peut gérer l’abonnement ou activer un paiement.</div>`
          : '';
        return `<div class="cm-ab-hero">
          <div>
            <div class="cm-ab-muted" style="margin-bottom:4px">Formule actuelle</div>
            <div style="font-size:18px;font-weight:800">${esc(info.label)}${badge}</div>
            <div class="cm-ab-muted" style="margin-top:4px">${esc(info.price)} · ${esc(info.engagementLabel)}</div>
            ${note}${manageNote}
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">${action}</div>
        </div>`;
      }

      function impayeHtml() {
        if (sub.subscription_status !== 'impaye') return '';
        return `<div class="cm-ab-panel warn">
          <b style="font-size:14px;color:var(--danger)">Dernier prélèvement refusé</b>
          <div class="cm-ab-muted" style="margin-top:6px">Mettez à jour votre moyen de paiement depuis « Gérer mon abonnement » pour éviter la suspension de votre espace Club.</div>
        </div>`;
      }

      function creditsHtml() {
        const balance = sub.credits_balance || 0;
        const reserved = sub.credits_reserved || 0;
        const monthly = sub.credits_monthly || 0;
        const available = Math.max(0, balance - reserved);
        const pct = monthly ? Math.round(available / monthly * 100) : 0;
        const barColor = pct <= 10 ? 'var(--danger)' : (pct <= 25 ? 'var(--warn)' : 'var(--accent-2)');
        const history = !creditTxLoaded
          ? '<div class="cm-ab-muted">Chargement…</div>'
          : (creditTx.length
            ? creditTx.map(function (tx) {
                const positive = Number(tx.amount) > 0;
                return `<div class="cm-ab-tx-row">
                  <div><div style="font-weight:600;font-size:12.5px">${esc(tx.label)}</div><div class="cm-ab-muted" style="font-size:11px">${fmtDate(tx.created_at)}</div></div>
                  <span style="font-weight:700;font-size:13px;color:${positive ? 'var(--ok)' : 'var(--text)'}">${positive ? '+' : ''}${esc(tx.amount)}</span>
                </div>`;
              }).join('')
            : '<div class="cm-ab-muted">Aucun mouvement de crédits pour le moment.</div>');
        return `<div class="cm-ab-panel">
          <div class="cm-ab-toolbar" style="margin-bottom:14px">
            <b style="font-size:15px">Crédits</b>
            ${canManage ? '<button class="btn btn-primary" data-action="open-pack">Acheter un pack</button>' : ''}
          </div>
          <div style="font-size:28px;font-weight:800;margin-bottom:6px">${available} <span style="font-size:14px;color:var(--muted);font-weight:600">/ ${monthly} crédits disponibles</span></div>
          <div class="cm-ab-progress" style="margin-bottom:10px"><i style="width:${pct}%;background:${barColor}"></i></div>
          ${reserved ? `<div style="font-size:12px;color:var(--warn);margin-bottom:16px">${reserved} crédit(s) réservé(s) pour des demandes en attente d’acceptation par SportVision.</div>` : ''}
          <div class="cm-ab-muted" style="font-weight:700;margin-bottom:8px;font-size:11.5px">HISTORIQUE</div>
          ${history}
        </div>`;
      }

      function quotasHtml() {
        /* Les 3 quotas et leurs totaux (10 / 8 / 5) sont repris tels quels
           de Club+ : seuls Utilisateurs et Équipes sont adossés à une
           vraie table (club_members / club_teams, comptés ci-dessous) ;
           « Modèles premium » est une valeur d’affichage sans table de
           suivi dédiée — déjà le cas dans Club+ (2/5 codé en dur, non lié
           à une donnée réelle), pas une régression introduite ici. */
        const rows = [
          ['Utilisateurs', memberCount, 10],
          ['Équipes', teamCount, 8],
          ['Modèles premium', 2, 5]
        ];
        return `<div class="cm-ab-panel">
          <b style="font-size:15px;display:block;margin-bottom:14px">Quotas de la formule</b>
          ${rows.map(function (r) {
            const used = r[1] == null ? '…' : r[1];
            const total = r[2];
            const pct = r[1] == null ? 0 : Math.min(100, r[1] / total * 100);
            return `<div style="margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span>${esc(r[0])}</span><span class="cm-ab-muted">${used} / ${total}</span></div>
              <div class="cm-ab-progress"><i style="width:${pct}%"></i></div>
            </div>`;
          }).join('')}
          <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:6px" data-action="contact-sportvision">Contacter SportVision</button>
        </div>`;
      }

      function packModalHtml() {
        if (!packOpen) return '';
        return `<div class="cm-ab-overlay" data-action="overlay-pack">
          <div class="cm-ab-modal">
            <div class="cm-ab-drawer-head"><b>Acheter un pack de crédits</b><button class="cm-ab-close" data-action="close-pack">✕</button></div>
            <div class="cm-ab-pack-grid">
              ${CREDIT_PACKS.map(function (p) {
                return `<button class="cm-ab-pack" data-action="buy-pack" data-amount="${p.amount}" data-label="${esc(p.amount + ' crédits')}">
                  <div style="font-size:15px;font-weight:800">${p.amount} crédits</div>
                  <div style="font-size:13px;color:var(--accent-2);font-weight:700;margin-top:6px">${esc(p.price)}</div>
                </button>`;
              }).join('')}
            </div>
            <div class="cm-ab-muted" style="margin-top:14px">L’achat de packs en libre-service est en cours de finalisation côté paiement. Choisir un pack transmet votre demande à SportVision pour un ajout manuel rapide.</div>
          </div>
        </div>`;
      }

      function paint() {
        if (!loaded) {
          container.innerHTML = `<div class="cm-ab"><div class="cm-ab-toolbar"><h2>Abonnement &amp; crédits</h2></div><div class="cm-ab-empty">Chargement…</div></div>`;
          return;
        }
        container.innerHTML = `<div class="cm-ab">
          <div class="cm-ab-toolbar"><h2>Abonnement &amp; crédits</h2></div>
          ${heroHtml()}
          ${impayeHtml()}
          <div class="cm-ab-grid2">
            ${creditsHtml()}
            ${quotasHtml()}
          </div>
          ${packModalHtml()}
        </div>`;
        bind();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay-pack"]');
          if (overlay && e.target === overlay) { packOpen = false; paint(); return; }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'billing-portal') { if (!canManage) return; await openBillingPortal(); }
          else if (action === 'start-checkout') { if (!canManage) return; await startSubscriptionCheckout(); }
          else if (action === 'open-pack') { if (!canManage) return; packOpen = true; paint(); }
          else if (action === 'close-pack') { packOpen = false; paint(); }
          else if (action === 'buy-pack') { if (!canManage) return; requestCreditPack(Number(btn.getAttribute('data-amount')), btn.getAttribute('data-label')); }
          else if (action === 'contact-sportvision') { toast('Un conseiller SportVision vous recontactera prochainement.'); }
        };
      }

      handleAbonnementReturn();
      await load();
      paint();
      loadCreditTx();
      loadQuotas();
    }
  };
})();
