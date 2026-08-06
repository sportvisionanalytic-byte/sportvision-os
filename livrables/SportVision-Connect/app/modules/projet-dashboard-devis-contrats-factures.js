/* ============================================================
 * SportVision Connect — Module "Projet" : Aperçu, Devis, Contrats, Factures
 * ------------------------------------------------------------
 * Port fidèle (mais autonome) des vues équivalentes du Portail
 * (SportVision-Portail.html, PORTAL_VIEWS 'dashboard'/'devis'/'contrats'/
 * 'factures', fonctions renderDashboard/renderDevis/renderContrats/
 * renderFactures) vers le nouveau socle Connect (organizations /
 * entitlements). Le Portail reste en lecture seule, jamais modifié —
 * ce fichier en est une réécriture indépendante, vanilla JS.
 *
 * Portée volontairement limitée à ce que le Portail nomme "Devis /
 * Contrats / Factures" + le tableau de bord associé. Les demandes de
 * prestation, la messagerie, les livrables et le compte client sont
 * portés ailleurs (module-installs distinct : voir
 * modules/projet-demandes-livrables-messagerie-compte.js) — le
 * dashboard ci-dessous ne consulte donc jamais `client_prestations`.
 *
 * Rappel d'architecture Connect v2 (cf. migration-connect-v2-
 * organizations-entitlements.sql §3.2) : pour un espace "projet",
 * organizations.id === clients.id (même UUID, réutilisé). orgId reçu
 * par render() est donc directement client_id, utilisable tel quel
 * dans les filtres client_id=eq.<orgId> — aucune traduction. La RLS
 * des tables sources (devis/contrats/factures) est fail-closed ; le
 * seul chemin d'accès client est les vues client_devis / client_contrats
 * / client_factures (migration-portail-v1.sql, ajustée par
 * migration-portail-v8.sql pour les contrats), déjà filtrées via
 * client_users. ctx.role vaut toujours 'client' pour cet espace : pas
 * de logique de permission différenciée ici, la RLS tranche.
 *
 * Dépendances globales fournies par le shell (index.html), non
 * redéfinies ici : sbFetch, sbRpc, sbFunction, esc, toast, ainsi que
 * les variables CSS --card/--border/--radius/--shadow/--accent/
 * --accent-2/--muted/--text/--ok/--danger et les classes .btn/
 * .btn-primary/.btn-ghost/.badge/.empty-state (définies dans index.html).
 *
 * Sécurité : toute URL dynamique (lien de paiement Stripe renvoyé par
 * l'edge function create-checkout-session, pdf_url d'une facture) est
 * validée sur son schéma (http:// ou https://) avant toute navigation
 * ou tout rendu en lien cliquable — jamais de window.open()/redirection
 * sur une valeur non validée (règle stricte du projet, cf. le correctif
 * appliqué au même endroit dans club-demandes-medias-sponsors-admin.js).
 *
 * Chaque entrée de window.ProjetModules est autonome : son
 * render(container, orgId, ctx) recrée un état dans une closure dédiée
 * à chaque appel (le shell remonte systématiquement un noeud DOM neuf
 * à chaque activation d'onglet), et rejoue container.innerHTML + les
 * gestionnaires d'événements via container.onclick = (jamais
 * addEventListener), pour ne jamais accumuler de doublons.
 * ============================================================ */
(function () {
  'use strict';

  /* ── Styles scopés, injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('pj-styles')) return;
    var style = document.createElement('style');
    style.id = 'pj-styles';
    style.textContent = [
      '.pj-wrap{display:flex;flex-direction:column;gap:18px}',
      '.pj-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}',
      '.pj-stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 16px}',
      '.pj-stat .n{font-size:24px;font-weight:800;color:var(--accent)}',
      '.pj-stat .l{font-size:12.5px;color:var(--muted);margin-top:2px}',
      '.pj-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px}',
      '.pj-card h3{margin:0 0 4px;font-size:15px}',
      '.pj-section-title{font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin:0 0 8px}',
      '.pj-list{display:flex;flex-direction:column;gap:8px}',
      '.pj-row{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px}',
      '.pj-row-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}',
      '.pj-num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--muted)}',
      '.pj-title{font-weight:700;font-size:14.5px;margin-top:2px}',
      '.pj-meta{font-size:12.5px;color:var(--muted);margin-top:3px}',
      '.pj-amount{font-size:19px;font-weight:800;color:var(--accent)}',
      '.pj-row-bottom{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap}',
      '.pj-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.pj-actions .btn{width:auto;margin-top:0;padding:9px 14px;font-size:13px}',
      '.pj-note{font-size:12.5px;color:var(--muted);margin-top:10px;line-height:1.5}',
      '.pj-todo{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer}',
      '.pj-todo:hover{border-color:var(--accent)}',
      '.pj-todo .go{color:var(--accent);font-size:12.5px;font-weight:700;flex-shrink:0}',
      '.pj-shortcuts{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}',
      '.pj-shortcuts .btn{width:auto;margin-top:0}',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ── Formattage partagé ── */
  function fmtEUR(n) {
    return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  function fmtDate(s) {
    if (!s) return '—';
    var d = new Date(s);
    if (isNaN(d.getTime())) return esc(String(s));
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  }
  function isSafeHttpUrl(u) {
    return typeof u === 'string' && /^https?:\/\//i.test(u.trim());
  }

  /* ── Badges de statut (mêmes libellés que le Portail, statutBadge()) ── */
  var DEVIS_STATUT = {
    brouillon: { label: 'Brouillon', color: '#5b6478' },
    'envoyé': { label: 'Envoyé', color: '#2f6bff' },
    en_attente: { label: 'En attente', color: '#e2a03f' },
    'accepté': { label: 'Accepté', color: '#1fa971' },
    'refusé': { label: 'Refusé', color: '#e14b4b' },
    'expiré': { label: 'Expiré', color: '#5b6478' },
    'annulé': { label: 'Annulé', color: '#5b6478' },
  };
  var FACTURE_STATUT = {
    brouillon: { label: 'Brouillon', color: '#5b6478' },
    emise: { label: 'Émise', color: '#2f6bff' },
    payee: { label: 'Payée', color: '#1fa971' },
    en_retard: { label: 'En retard', color: '#e14b4b' },
    annulee: { label: 'Annulée', color: '#e14b4b' },
    remboursee: { label: 'Remboursée', color: '#5b6478' },
  };
  var CONTRAT_STATUT = {
    brouillon: { label: 'Brouillon', color: '#5b6478' },
    actif: { label: 'Actif', color: '#1fa971' },
    suspendu: { label: 'Suspendu', color: '#e2a03f' },
    'résilié': { label: 'Résilié', color: '#e14b4b' },
    'expiré': { label: 'Expiré', color: '#5b6478' },
  };
  var SIGNATURE_STATUT = {
    non_demandee: { label: 'Aucune signature requise', color: '#5b6478' },
    demandee: { label: 'À signer', color: '#e2a03f' },
    signee: { label: 'Signé', color: '#1fa971' },
    refusee: { label: 'Refusé', color: '#e14b4b' },
  };
  // Taxonomie de la Banque de contrats (migration-contrats-v2-types-banque.sql),
  // identique à CONTRAT_TYPES_LB dans SportVision-OS-Full.html. Anciennes clés
  // (abonnement_mensuel, abonnement_annuel, forfait_saison, partenariat) gardées
  // en repli pour un contrat déjà ouvert au moment où la migration tourne côté serveur.
  var TYPE_CONTRAT_LABEL = {
    ponctuel: 'Prestation ponctuelle',
    full_communication: 'Full Communication',
    club_plus: 'Abonnement Club+',
    coach_academie: 'Coach / Académie',
    evenement: 'Événement',
    joueur: 'Joueur',
    sponsoring: 'Sponsoring',
    pilote: 'Contrat pilote',
    autre: 'Autre',
    abonnement_mensuel: 'Abonnement mensuel',
    abonnement_annuel: 'Abonnement annuel',
    forfait_saison: 'Forfait saison',
    partenariat: 'Partenariat',
  };
  function badge(map, key) {
    var m = map[key] || { label: key || '—', color: '#5b6478' };
    return '<span class="badge" style="background:' + m.color + '22;color:' + m.color + '">' + esc(m.label) + '</span>';
  }

  /* ── Navigation entre onglets de l'espace "projet" ──
   * Le shell (index.html) rend chaque module dans un onglet
   * <button class="workspace-tab" data-key="...">, déjà câblé sur
   * selectWorkspaceTab(). Simuler un clic dessus est le seul moyen de
   * "sauter" d'un module à l'autre sans dépendre d'une fonction interne
   * du shell dont la signature pourrait changer — on ne s'appuie que
   * sur un attribut déjà présent dans le DOM qu'il produit lui-même.
   */
  function goTab(key) {
    var btn = document.querySelector('.workspace-tab[data-key="' + key + '"]');
    if (btn) { btn.click(); }
    else { toast('Utilisez les onglets en haut de la page pour naviguer.'); }
  }

  /* ── Paiement Stripe (edge function create-checkout-session, déjà en
   * place côté Portail) : la fonction renvoie une session Stripe réelle,
   * mais on valide quand même le schéma avant toute redirection, par
   * cohérence avec la règle du projet sur les URLs dynamiques. ── */
  async function goToPayment(body, btn, resetLabel) {
    if (btn) { btn.disabled = true; btn.textContent = 'Redirection…'; }
    try {
      // "caller" indique à create-checkout-session de rediriger vers Connect
      // après paiement plutôt que vers le Portail (comportement par défaut de
      // la fonction) — sans ça, un client payant depuis Connect atterrissait
      // sur le Portail après Stripe. Corrigé le 2026-08-06.
      var r = await sbFunction('create-checkout-session', Object.assign({ caller: 'connect' }, body));
      var url = r && r.data && r.data.url;
      if (!r.ok || !isSafeHttpUrl(url)) {
        toast((r && r.data && r.data.error) || 'Paiement indisponible pour le moment.');
        if (btn) { btn.disabled = false; btn.textContent = resetLabel; }
        return;
      }
      window.location.href = url;
    } catch (e) {
      toast('Paiement indisponible pour le moment.');
      if (btn) { btn.disabled = false; btn.textContent = resetLabel; }
    }
  }

  window.ProjetModules = window.ProjetModules || {};

  /* ============================================================
   * 1. APERÇU (dashboard)
   * ============================================================ */
  window.ProjetModules.dashboard = {
    label: 'Aperçu',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      container.innerHTML = '<div class="empty-state">Chargement…</div>';

      var devisR = await sbFetch('client_devis?client_id=eq.' + orgId + '&order=created_at.desc');
      var facturesR = await sbFetch('client_factures?client_id=eq.' + orgId + '&order=created_at.desc');
      var contratsR = await sbFetch('client_contrats?client_id=eq.' + orgId + '&order=created_at.desc');

      // Avant le 2026-08-06 : si les 3 requêtes échouaient (offline, 500...),
      // on tombait silencieusement sur des tableaux vides et l'écran affichait
      // "Rien en attente, tout est à jour." — indiscernable d'un dossier
      // réellement à jour. Ici, c'est le tableau de bord financier du client :
      // ne jamais laisser croire qu'il n'y a aucune facture/devis en attente
      // simplement parce que le réseau a fauté.
      if (!devisR.ok && !facturesR.ok && !contratsR.ok) {
        container.innerHTML = '<div class="empty-state">Impossible de charger vos informations pour le moment.'
          + '<div style="margin-top:10px"><button class="btn btn-ghost" data-action="retry-dashboard">Réessayer</button></div></div>';
        container.onclick = function (e) {
          if (e.target.closest('[data-action="retry-dashboard"]')) {
            window.ProjetModules.dashboard.render(container, orgId, ctx);
          }
        };
        return;
      }
      if (!devisR.ok || !facturesR.ok || !contratsR.ok) {
        toast('Certaines informations n\'ont pas pu être chargées — les chiffres ci-dessous peuvent être incomplets.');
      }

      var devis = devisR.ok ? (devisR.data || []) : [];
      var factures = facturesR.ok ? (facturesR.data || []) : [];
      var contrats = contratsR.ok ? (contratsR.data || []) : [];

      var devisEnAttente = devis.filter(function (d) { return d.statut === 'envoyé' || d.statut === 'en_attente'; });
      var facturesEnAttente = factures.filter(function (f) { return f.statut === 'emise' || f.statut === 'en_retard'; });
      var contratsASigner = contrats.filter(function (c) { return c.signature_statut === 'demandee'; });

      var dernierDevis = devis[0] || null;

      // "Prochaine échéance" = la date d'échéance la plus proche parmi les
      // factures encore dues (le dashboard du Portail se basait aussi sur
      // client_prestations pour une "prochaine prestation" ; hors périmètre
      // ici, voir l'en-tête du fichier).
      var prochaine = facturesEnAttente
        .filter(function (f) { return f.date_echeance; })
        .sort(function (a, b) { return new Date(a.date_echeance) - new Date(b.date_echeance); })[0] || null;

      var montantEnAttente = facturesEnAttente.reduce(function (s, f) { return s + Number(f.montant_ttc || 0); }, 0);

      var todos = [];
      devisEnAttente.forEach(function (d) {
        todos.push({ label: 'Répondre au devis ' + (d.numero || ''), key: 'devis' });
      });
      facturesEnAttente.forEach(function (f) {
        todos.push({ label: 'Régler la facture ' + (f.numero || '') + ' (' + fmtEUR(f.montant_ttc) + ')', key: 'factures' });
      });
      contratsASigner.forEach(function (c) {
        todos.push({ label: 'Signer le contrat ' + (TYPE_CONTRAT_LABEL[c.type_contrat] || c.type_contrat || ''), key: 'contrats' });
      });

      container.innerHTML = '<div class="pj-wrap">'
        + '<div class="pj-stats">'
        + '<div class="pj-stat"><div class="n">' + devisEnAttente.length + '</div><div class="l">Devis en attente de réponse</div></div>'
        + '<div class="pj-stat"><div class="n">' + facturesEnAttente.length + '</div><div class="l">Facture(s) en attente' + (montantEnAttente ? ' · ' + fmtEUR(montantEnAttente) : '') + '</div></div>'
        + '<div class="pj-stat"><div class="n">' + (prochaine ? fmtDate(prochaine.date_echeance) : '—') + '</div><div class="l">Prochaine échéance de paiement</div></div>'
        + '</div>'

        + (dernierDevis ? (
          '<div class="pj-card">'
          + '<div class="pj-section-title">Dernier devis</div>'
          + '<div class="pj-row-top"><div><div class="pj-num">' + esc(dernierDevis.numero || '') + '</div>'
          + '<div class="pj-title">' + fmtEUR(dernierDevis.total_ttc) + '</div>'
          + '<div class="pj-meta">Reçu le ' + fmtDate(dernierDevis.created_at) + '</div></div>'
          + badge(DEVIS_STATUT, dernierDevis.statut) + '</div>'
          + '</div>'
        ) : '')

        + '<div>'
        + '<div class="pj-section-title">À faire</div>'
        + (todos.length
          ? '<div class="pj-list">' + todos.map(function (t) {
            return '<button class="pj-todo" data-action="goto" data-key="' + esc(t.key) + '"><span>' + esc(t.label) + '</span><span class="go">Ouvrir →</span></button>';
          }).join('') + '</div>'
          : '<div class="empty-state">Rien en attente, tout est à jour.</div>')
        + '</div>'

        + '<div>'
        + '<div class="pj-section-title">Raccourcis</div>'
        + '<div class="pj-shortcuts">'
        + '<button class="btn btn-ghost" data-action="goto" data-key="devis">Voir mes devis</button>'
        + '<button class="btn btn-ghost" data-action="goto" data-key="contrats">Voir mes contrats</button>'
        + '<button class="btn btn-ghost" data-action="goto" data-key="factures">Voir mes factures</button>'
        + '</div>'
        + '</div>'
        + '</div>';

      container.onclick = function (e) {
        var btn = e.target.closest('[data-action="goto"]');
        if (!btn) return;
        goTab(btn.getAttribute('data-key'));
      };
    },
  };

  /* ============================================================
   * 2. DEVIS
   * ============================================================ */
  window.ProjetModules.devis = {
    label: 'Devis',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      var list = [];
      var loadFailed = false;

      async function load() {
        var r = await sbFetch('client_devis?client_id=eq.' + orgId + '&order=created_at.desc');
        loadFailed = !r.ok;
        list = r.ok ? (r.data || []) : [];
      }

      function row(d) {
        var canDecide = d.statut === 'envoyé' || d.statut === 'en_attente';
        var canPay = d.statut === 'accepté';
        var actions = '';
        if (canDecide) {
          actions = '<div class="pj-actions">'
            + '<button class="btn btn-ghost" data-action="refuse" data-id="' + esc(d.id) + '">Refuser</button>'
            + '<button class="btn btn-primary" data-action="accept" data-id="' + esc(d.id) + '">Accepter</button>'
            + '</div>';
        } else if (canPay) {
          actions = '<div class="pj-actions">'
            + '<button class="btn btn-primary" data-action="pay" data-id="' + esc(d.id) + '" data-prestation="' + esc(d.prestation_id || '') + '">Payer l\'acompte</button>'
            + '</div>';
        }
        return '<div class="pj-row">'
          + '<div class="pj-row-top"><div><div class="pj-num">' + esc(d.numero || '') + '</div>'
          + '<div class="pj-meta">Reçu le ' + fmtDate(d.created_at)
          + (d.date_expiration ? ' · Valable jusqu\'au ' + fmtDate(d.date_expiration) : '') + '</div></div>'
          + badge(DEVIS_STATUT, d.statut) + '</div>'
          + '<div class="pj-row-bottom"><span class="pj-amount">' + fmtEUR(d.total_ttc) + '</span>' + actions + '</div>'
          + '</div>';
      }

      function paint() {
        container.innerHTML = '<div class="pj-wrap">'
          + (loadFailed
            ? '<div class="empty-state">Impossible de charger vos devis pour le moment.<div style="margin-top:10px"><button class="btn btn-ghost" data-action="retry">Réessayer</button></div></div>'
            : (list.length ? '<div class="pj-list">' + list.map(row).join('') + '</div>' : '<div class="empty-state">Aucun devis pour le moment.</div>'))
          + '</div>';
      }

      container.onclick = async function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-action');
        var id = btn.getAttribute('data-id');
        if (action === 'retry') {
          await load();
          paint();
        } else if (action === 'accept' || action === 'refuse') {
          btn.disabled = true;
          var r = await sbRpc('client_decide_devis', { p_devis_id: id, p_decision: action === 'accept' ? 'accepté' : 'refusé' });
          if (!r.ok) { toast('Action impossible sur ce devis.'); btn.disabled = false; return; }
          toast(action === 'accept' ? 'Devis accepté.' : 'Devis refusé.');
          await load();
          paint();
        } else if (action === 'pay') {
          var prestationId = btn.getAttribute('data-prestation');
          var body = prestationId ? { prestation_id: prestationId, type_paiement: 'acompte' } : { devis_id: id, type_paiement: 'acompte' };
          await goToPayment(body, btn, "Payer l'acompte");
        }
      };

      await load();
      paint();
    },
  };

  /* ============================================================
   * 3. CONTRATS (lecture seule)
   * ============================================================ */
  window.ProjetModules.contrats = {
    label: 'Contrats',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      var r = await sbFetch('client_contrats?client_id=eq.' + orgId + '&order=created_at.desc');
      if (!r.ok) {
        container.innerHTML = '<div class="empty-state">Impossible de charger vos contrats pour le moment.'
          + '<div style="margin-top:10px"><button class="btn btn-ghost" data-action="retry-contrats">Réessayer</button></div></div>';
        container.onclick = function (e) {
          if (e.target.closest('[data-action="retry-contrats"]')) window.ProjetModules.contrats.render(container, orgId, ctx);
        };
        return;
      }
      var list = r.data || [];

      function row(c) {
        var sig = c.signature_statut && c.signature_statut !== 'non_demandee' ? c.signature_statut : null;
        var awaitingSignature = sig === 'demandee';
        var extras = [];
        if (c.montant_mensuel != null) extras.push(fmtEUR(c.montant_mensuel) + (c.frequence ? ' / ' + esc(c.frequence) : ''));
        if (c.date_debut) extras.push('Depuis le ' + fmtDate(c.date_debut));
        if (c.date_fin) extras.push("jusqu'au " + fmtDate(c.date_fin));

        return '<div class="pj-row">'
          + '<div class="pj-row-top"><div>'
          + '<div class="pj-title">' + esc(TYPE_CONTRAT_LABEL[c.type_contrat] || c.type_contrat || 'Contrat') + '</div>'
          + '<div class="pj-meta">' + badge(CONTRAT_STATUT, c.statut) + '</div>'
          + (extras.length ? '<div class="pj-meta">' + extras.join(' · ') + '</div>' : '')
          + '</div>' + badge(SIGNATURE_STATUT, sig || 'non_demandee') + '</div>'
          + (awaitingSignature
            ? '<p class="pj-note">Un e-mail de notre partenaire de signature électronique (Youtrust) vous a été envoyé avec un lien pour signer. Vérifiez votre boîte mail, y compris les spams.</p>'
            : '')
          + (sig === 'signee' ? '<div class="pj-meta" style="margin-top:8px">Signé le ' + fmtDate(c.signature_confirmee_at) + '</div>' : '')
          + '</div>';
      }

      container.innerHTML = '<div class="pj-wrap">'
        + (list.length ? '<div class="pj-list">' + list.map(row).join('') + '</div>' : '<div class="empty-state">Aucun contrat pour le moment.</div>')
        + '</div>';
    },
  };

  /* ============================================================
   * 4. FACTURES
   * ============================================================ */
  window.ProjetModules.factures = {
    label: 'Factures',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      var list = [];
      var loadFailed = false;

      async function load() {
        var r = await sbFetch('client_factures?client_id=eq.' + orgId + '&order=created_at.desc');
        loadFailed = !r.ok;
        list = r.ok ? (r.data || []) : [];
      }

      function row(f) {
        var canPay = (f.statut === 'emise' || f.statut === 'en_retard') && f.prestation_id;
        var pdfLink = isSafeHttpUrl(f.pdf_url)
          ? '<a class="btn btn-ghost" href="' + esc(f.pdf_url) + '" target="_blank" rel="noopener noreferrer">Voir le PDF</a>'
          : '';
        return '<div class="pj-row">'
          + '<div class="pj-row-top"><div><div class="pj-num">' + esc(f.numero || '') + '</div>'
          + '<div class="pj-title">' + esc(f.type_facture || '') + '</div>'
          + '<div class="pj-meta">Émise le ' + fmtDate(f.date_emission)
          + (f.date_echeance ? ' · Échéance le ' + fmtDate(f.date_echeance) : '') + '</div></div>'
          + badge(FACTURE_STATUT, f.statut) + '</div>'
          + '<div class="pj-row-bottom"><span class="pj-amount">' + fmtEUR(f.montant_ttc) + '</span>'
          + '<div class="pj-actions">' + pdfLink
          + (canPay ? '<button class="btn btn-primary" data-action="pay" data-prestation="' + esc(f.prestation_id) + '" data-type="' + esc(f.type_facture) + '">Payer</button>' : '')
          + '</div></div>'
          + '</div>';
      }

      function paint() {
        container.innerHTML = '<div class="pj-wrap">'
          + (loadFailed
            ? '<div class="empty-state">Impossible de charger vos factures pour le moment.<div style="margin-top:10px"><button class="btn btn-ghost" data-action="retry">Réessayer</button></div></div>'
            : (list.length ? '<div class="pj-list">' + list.map(row).join('') + '</div>' : '<div class="empty-state">Aucune facture pour le moment.</div>'))
          + '</div>';
      }

      container.onclick = async function (e) {
        var retryBtn = e.target.closest('[data-action="retry"]');
        if (retryBtn) { await load(); paint(); return; }
        var btn = e.target.closest('[data-action="pay"]');
        if (!btn) return;
        var body = { prestation_id: btn.getAttribute('data-prestation'), type_paiement: btn.getAttribute('data-type') };
        await goToPayment(body, btn, 'Payer');
      };

      await load();
      paint();
    },
  };
})();
