/* ============================================================
 * SportVision Connect — Module Club
 * Paramètres · Mes accès
 *
 * Port fidèle (mais autonome) des équivalents dans Club+ (app.html,
 * tplParametres() et tplMesAcces(), en lecture seule, jamais modifié).
 * Vanilla JS, aucune dépendance. Même patron que
 * club-demandes-medias-sponsors-admin.js (lu en entier avant d'écrire
 * ce fichier) : ensureStyles(), sbFetch/esc/toast/SB_URL/SB_KEY déjà
 * fournis par le shell (index.html, chargé avant ce fichier), routage
 * des clics via data-action, état par variables fermées dans chaque
 * render(), container.onclick/onchange réassignés à chaque paint()
 * pour ne jamais accumuler de doublons.
 *
 * Rappel d'architecture Connect v2 : orgId === clubs.id pour une
 * organisation de type club (confirmé dans migration-connect-v2-
 * organizations-entitlements.sql §"choix clé" : organizations.id
 * RÉUTILISE clubs.id, pas un nouvel identifiant). clubs/club_members
 * restent la source de vérité pour l'identité du club et le rôle par
 * membre — organizations/memberships est une couche d'unification qui
 * ne porte pas nom/ville/discipline/saison/logo_url/ecusson_url/
 * role_permissions (vérifié par lecture directe du schéma via l'API
 * REST le 2026-08-07 : ces colonnes n'existent que sur `clubs`).
 *
 * ── Styles : pourquoi ce fichier duplique le bloc "cm-shared-style" ──
 * ensureStyles() de club-demandes-medias-sponsors-admin.js n'est pas
 * exportée (fermée dans son IIFE) : impossible de l'appeler depuis ce
 * fichier. Les deux fichiers sont chargés comme <script> classiques
 * dans la même page, mais AUCUN des deux ne garantit d'être exécuté
 * (au sens : son render() appelé) avant l'autre — cela dépend du
 * premier module que l'utilisateur ouvre. Si ce fichier réutilisait
 * l'id "cm-shared-style" en y ajoutant SES propres classes (tableau,
 * cartes de configuration…) après le bloc commun, ces classes
 * n'apparaîtraient JAMAIS dans le cas où l'autre module s'exécute en
 * premier (son ensureStyles() poserait "cm-shared-style" sans elles,
 * puis le early-return `if (document.getElementById(...)) return`
 * empêcherait ce fichier de les injecter à son tour). Solution : ce
 * fichier réinjecte le MÊME contenu sous le MÊME id "cm-shared-style"
 * (idempotent, sans risque si les deux copies tournent — elles sont
 * identiques), puis ajoute ses classes propres sous un id SÉPARÉ
 * ("cm-params-style") qui, lui, est toujours injecté quel que soit
 * l'ordre. Résultat : correct dans les deux ordres de chargement.
 *
 * Vérifications réelles faites via curl (Supabase REST, clé
 * service-role) avant d'écrire ce fichier — voir le rapport de tâche
 * pour le détail complet des colonnes et tables confirmées.
 * ============================================================ */
(function () {
  'use strict';

  /* ── Styles partagés avec les autres modules Club (cf. note ci-dessus) ── */
  function ensureSharedStyles() {
    if (document.getElementById('cm-shared-style')) return;
    const style = document.createElement('style');
    style.id = 'cm-shared-style';
    style.textContent = `
      .cm-wrap .btn{width:auto;margin-top:0}
      .cm-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .cm-toolbar h2{margin:0;font-size:19px}
      .cm-pillbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .cm-pill{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;padding:6px 14px;font-size:12.5px;cursor:pointer;font-weight:600}
      .cm-pill:not(.on):hover{border-color:var(--accent);color:var(--text)}
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
      .cm-card .thumb{height:84px;border-radius:8px;background:linear-gradient(135deg,rgba(157,174,195,.15),var(--border));display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;text-align:center;padding:8px;overflow:hidden}
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
      .cm-warn{border-color:#F0A94E55;background:rgba(226,160,63,.08)}
      .cm-actions{display:flex;flex-direction:column;gap:8px;margin-top:14px}
      .cm-inline-row{display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(0,0,0,.03);border-radius:10px;padding:9px 12px;margin-bottom:6px;font-size:12.5px}
      .cm-player-list{max-height:190px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 8px;background:var(--card)}
      .cm-player-row{display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:13px;cursor:pointer}
      .cm-player-row input[type=checkbox]{width:auto;flex:none}
      .cm-player-empty{color:var(--muted);font-size:12.5px;padding:4px 2px}
    `;
    document.head.appendChild(style);
  }

  /* ── Styles propres à ce fichier (toujours injectés, cf. note en tête) ── */
  function ensureOwnStyles() {
    if (document.getElementById('cm-params-style')) return;
    const style = document.createElement('style');
    style.id = 'cm-params-style';
    style.textContent = `
      .cm-panel{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
      .cm-imgbox{height:90px;border-radius:8px;background:linear-gradient(135deg,rgba(157,174,195,.15),var(--border));display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;text-align:center;padding:8px;overflow:hidden;background-size:cover;background-position:center}
      .cm-progress{height:8px;background:var(--border);border-radius:999px;overflow:hidden}
      .cm-progress i{display:block;height:100%;background:var(--accent);border-radius:999px}
      .cm-table{width:100%;border-collapse:collapse;font-size:12.5px}
      .cm-table th,.cm-table td{padding:8px 10px;text-align:center;border-bottom:1px solid var(--border)}
      .cm-table th:first-child,.cm-table td:first-child{text-align:left}
      .cm-table thead th{color:var(--muted);font-weight:600;font-size:11.5px}
      .cm-note{color:var(--muted);font-size:12px;line-height:1.5}
    `;
    document.head.appendChild(style);
  }
  function ensureStyles() { ensureSharedStyles(); ensureOwnStyles(); }

  /* ── Formattage partagé ── */
  function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ── Vocabulaire des rôles club — dupliqué depuis club-demandes-medias-
     sponsors-admin.js (module 'administration'), qui ne l'exporte pas non
     plus. À garder synchronisé si l'un des deux fichiers change un libellé. ── */
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

  /* ── Matrice de permissions par rôle (clubs.role_permissions, jsonb) ──
     Portée telle quelle depuis Club+ (paView==='permissions' de
     tplParametres(), variables PERM_ROLE_COLS/PERM_KEYS/DEFAULT_PERM_VALUES
     juste avant, ~ligne 2434 de SportVision-Club-Plus/app.html). Colonne
     vérifiée réellement présente sur `clubs` via l'API REST le 2026-08-07.
     IMPORTANT — état réel documenté ailleurs dans le projet (CLUBPLUS_
     PLAYER_FAMILY_ARCHITECTURE.md, CLUBPLUS_PLAYER_FAMILY_SECURITY_REVIEW.md,
     migration-clubplus-v12.sql) : cette matrice est persistée mais N'EST PAS
     appliquée par les policies RLS — aucune fonction serveur ne la lit pour
     bloquer une action. C'est un écran de configuration/référence, pas un
     contrôle d'accès réel. Le texte affiché ci-dessous le dit explicitement,
     à chaque endroit où la matrice apparaît (Paramètres et Mes accès), pour
     ne jamais laisser croire le contraire. */
  const PERM_ROLE_COLS = ['admin', 'president', 'secretaire', 'comm', 'coach', 'sponsor_mgr', 'tresorier'];
  const PERM_KEYS = [
    ['gerer_equipes', 'Gérer les équipes'], ['gerer_utilisateurs', 'Gérer les utilisateurs'],
    ['envoyer_resultat', 'Envoyer un résultat'], ['valider_publication', 'Valider une publication'],
    ['gerer_sponsors', 'Gérer les sponsors'], ['creer_demande', "Créer une demande / consommer crédits"],
    ['gerer_abonnement', "Gérer l'abonnement / factures"], ['modifier_parametres', 'Modifier les paramètres']
  ];
  const DEFAULT_PERM_VALUES = {
    gerer_equipes: [1, 0, 1, 0, 0, 0, 0], gerer_utilisateurs: [1, 0, 1, 0, 0, 0, 0], envoyer_resultat: [1, 0, 1, 1, 1, 0, 0],
    valider_publication: [1, 1, 0, 1, 0, 0, 0], gerer_sponsors: [1, 0, 0, 1, 0, 1, 0], creer_demande: [1, 0, 0, 1, 1, 1, 0],
    gerer_abonnement: [1, 0, 0, 0, 0, 0, 1], modifier_parametres: [1, 0, 0, 0, 0, 0, 0]
  };
  function defaultPermMatrix() {
    const m = {};
    PERM_KEYS.forEach(function (pair) {
      const key = pair[0];
      m[key] = {};
      PERM_ROLE_COLS.forEach(function (r, i) { m[key][r] = !!DEFAULT_PERM_VALUES[key][i]; });
    });
    return m;
  }
  function effectivePermMatrix(club) {
    if (club && club.role_permissions && Object.keys(club.role_permissions).length) return club.role_permissions;
    return defaultPermMatrix();
  }

  /* ── Upload logo/écusson vers Supabase Storage ──
     Pas de sbUpload global côté shell Connect (aucun autre module du
     dossier n'en a encore besoin) : fonction locale, calquée sur le
     sbUpload de Club+ (app.html ligne ~651), MAIS avec la bonne clé
     localStorage — Club+ utilisait 'svcp_tok' (préfixe "p" de Club+),
     alors que le shell Connect (index.html) stocke la session sous
     'svc_tok'/'svc_uid' (sans "p" — vérifié dans index.html et déjà
     utilisé tel quel par club-demandes-medias-sponsors-admin.js). Copier
     'svcp_tok' tel quel aurait silencieusement envoyé un Authorization
     Bearer vide (jamais de session trouvée), donc rien n'aurait jamais
     fonctionné. Bucket 'clubplus-media' : existe réellement (vérifié via
     l'API Storage), déjà utilisé par Club+ pour ces mêmes images — pas une
     nouvelle exposition. Note de prudence déjà consignée dans
     ARCHITECTURE-CONNECT.md §9 : ce bucket est public en lecture, à
     corriger avant d'exposer Connect plus largement ; corriger cette
     policy de bucket est hors du périmètre de ce fichier. */
  async function uploadClubImage(bucket, path, file) {
    const tok = localStorage.getItem('svc_tok') || '';
    const res = await fetch(SB_URL + '/storage/v1/object/' + bucket + '/' + path, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
      body: file
    });
    if (!res.ok) return null;
    return SB_URL + '/storage/v1/object/public/' + bucket + '/' + path;
  }

  window.ClubModules = window.ClubModules || {};

  /* ============================================================
   * 1. PARAMÈTRES (clubs + notification_preferences + notification_quiet_hours)
   *
   * Divergences assumées par rapport à tplParametres() de Club+, après
   * vérification réelle du schéma et du comportement (détaillées dans le
   * rapport de tâche) :
   *
   * - Onglet "Préférences" retiré. Dans Club+ c'était 3 boutons ("Résumé
   *   quotidien par e-mail", "Résumé hebdomadaire par e-mail", "Mode
   *   sombre") qui affichaient toujours "Activé" et ne faisaient qu'un
   *   toast au clic — aucune colonne, aucune table, aucun état réel
   *   derrière, y compris dans Club+ lui-même (jamais branché). Le
   *   reproduire aurait affiché un réglage actionnable qui ne fait rien,
   *   ce que les autres écrans de ce projet évitent explicitement
   *   (cf. les commentaires "indicatif" ailleurs dans le code). Les
   *   préférences RÉELLEMENT persistées (catégories d'e-mails, heures
   *   calmes) sont dans l'onglet Notifications, conservé tel quel.
   * - Onglet "Intégrations" : l'entrée "SportVision Portail" de Club+ est
   *   retirée (le Portail a été supprimé le 2026-08-07). L'entrée
   *   "SportVision Connect" est également retirée plutôt qu'adaptée : le
   *   club est déjà dans Connect puisque c'est l'application dans
   *   laquelle cet écran s'affiche — une ligne "intégration Connect" y
   *   serait incohérente (on ne liste pas l'appli comme une intégration
   *   d'elle-même). Stripe passe de "À venir" à "Connecté" : l'abonnement
   *   du club est réellement facturé via Stripe (migration-clubplus-v25-
   *   stripe-subscription.sql, colonnes stripe_customer_id/
   *   stripe_subscription_id vérifiées présentes sur `clubs`) —
   *   contrairement à l'état documenté dans Club+, qui datait d'avant
   *   cette intégration.
   * - Édition (identité + matrice de permissions) réservée à ctx.role ===
   *   'admin', pas au champ configurable 'modifier_parametres' de la
   *   matrice elle-même. Aligné sur la policy RLS réelle
   *   "clubs_admin_update" (is_club_admin(), migration-clubplus-v9.sql) et
   *   sur le choix déjà fait dans club-demandes-medias-sponsors-admin.js
   *   (module 'administration', même contrainte, même commentaire
   *   d'origine). Un rôle non-admin ne peut de toute façon pas écrire sur
   *   `clubs` côté serveur ; ne pas lui montrer un formulaire qui
   *   échouerait silencieusement est plus honnête que suivre la matrice
   *   configurable (qui, elle, n'est pas appliquée).
   * ============================================================ */
  window.ClubModules.parametres = {
    label: 'Paramètres',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      const canManage = !!(ctx && ctx.role === 'admin');
      const uid = localStorage.getItem('svc_uid');

      const TABS = [
        ['identite', 'Identité du club'],
        ['notifications', 'Notifications'],
        ['integrations', 'Intégrations'],
        ['permissions', 'Rôles et permissions']
      ];
      const NOTIF_PREF_CATEGORIES = [
        ['BILLING', 'Facturation', 'Factures, paiements et abonnement'],
        ['OPERATIONS', 'Opérations', 'Rappels de prestations, échéances et suivi terrain'],
        ['SUPPORT', 'Support', 'Réponses à vos demandes envoyées au support SportVision'],
        ['PRODUCT', 'Produit', 'Nouveautés et évolutions de SportVision Connect'],
        ['MARKETING', 'Actualités', 'Offres et actualités SportVision']
      ];

      let paView = 'identite';
      let club = null;
      let notifPrefs = {};
      let quietHours = { not_before: '08:00', not_after: '21:00', sunday_urgent_only: true };
      let permMatrixCache = null;
      let loaded = false;

      async function load() {
        const [clubRes, prefRes, qhRes] = await Promise.all([
          sbFetch('clubs?id=eq.' + orgId + '&select=nom,ville,discipline,saison,logo_url,ecusson_url,role_permissions'),
          uid ? sbFetch('notification_preferences?user_id=eq.' + uid + '&select=category,email_enabled') : Promise.resolve({ ok: true, data: [] }),
          uid ? sbFetch('notification_quiet_hours?user_id=eq.' + uid + '&select=not_before,not_after,sunday_urgent_only') : Promise.resolve({ ok: true, data: [] })
        ]);
        if (!clubRes.ok) toast('Erreur de chargement.');
        club = (clubRes.ok && clubRes.data && clubRes.data[0]) || null;
        const prefMap = {};
        (prefRes.ok ? (prefRes.data || []) : []).forEach(function (p) { prefMap[p.category] = p.email_enabled; });
        notifPrefs = prefMap;
        const qhRow = (qhRes.ok && qhRes.data && qhRes.data[0]) || null;
        quietHours = {
          not_before: ((qhRow && qhRow.not_before) || '08:00:00').slice(0, 5),
          not_after: ((qhRow && qhRow.not_after) || '21:00:00').slice(0, 5),
          sunday_urgent_only: qhRow ? qhRow.sunday_urgent_only !== false : true
        };
        loaded = true;
      }

      function currentPermMatrix() {
        if (!permMatrixCache) permMatrixCache = JSON.parse(JSON.stringify(effectivePermMatrix(club)));
        return permMatrixCache;
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value.trim() : '';
      }

      /* ── Identité du club ── */
      function mediaBoxHtml(kind, label, url) {
        const bg = url ? ("background-image:url('" + esc(url) + "');") : '';
        return `<div><div class="cm-imgbox" style="${bg}cursor:${canManage ? 'pointer' : 'default'}" ${canManage ? 'data-action="pick-' + kind + '"' : ''}>${url ? '' : esc(label)}</div>
          ${canManage ? '<input type="file" data-role="file-' + kind + '" accept="image/*" style="display:none">' : ''}
        </div>`;
      }
      function identiteHtml() {
        if (!club) return '<div class="cm-empty">Club introuvable.</div>';
        const cfgItems = [
          ['Logo importé', !!club.logo_url],
          ['Écusson importé', !!club.ecusson_url],
          ['Ville renseignée', !!club.ville],
          ['Discipline renseignée', !!club.discipline],
          ['Saison renseignée', !!club.saison]
        ];
        const done = cfgItems.filter(function (i) { return i[1]; }).length;
        const pct = Math.round((done / cfgItems.length) * 100);
        return `<div class="cm-panel" style="margin-bottom:16px">
          <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:12px">INFORMATIONS DU CLUB</div>
          <div class="cm-row2">
            <div class="cm-field"><label>Nom du club</label><input type="text" data-field="pi-nom" value="${esc(club.nom || '')}" ${canManage ? '' : 'disabled'}></div>
            <div class="cm-field"><label>Saison</label><input type="text" data-field="pi-saison" value="${esc(club.saison || '')}" ${canManage ? '' : 'disabled'}></div>
          </div>
          <div class="cm-row2">
            <div class="cm-field"><label>Ville</label><input type="text" data-field="pi-ville" value="${esc(club.ville || '')}" ${canManage ? '' : 'disabled'}></div>
            <div class="cm-field"><label>Discipline</label><input type="text" data-field="pi-discipline" value="${esc(club.discipline || '')}" ${canManage ? '' : 'disabled'}></div>
          </div>
          ${canManage ? '<button class="btn btn-primary" data-action="save-identity">Enregistrer</button>' : '<div class="cm-note">Seul un administrateur du club peut modifier ces informations.</div>'}
        </div>
        <div class="cm-row2" style="margin-bottom:16px">
          <div class="cm-panel">
            <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:12px">LOGO ET ÉCUSSON</div>
            <div class="cm-row2" style="margin-bottom:12px">${mediaBoxHtml('logo', 'Logo principal', club.logo_url)}${mediaBoxHtml('ecusson', 'Écusson', club.ecusson_url)}</div>
            <div class="cm-note">${canManage ? 'Cliquez sur une image pour la remplacer.' : 'Seul un administrateur du club peut modifier le logo et l’écusson.'}</div>
          </div>
          <div class="cm-panel">
            <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:12px">CHARTE SPORTVISION CONNECT</div>
            ${[['Principale', 'var(--accent)'], ['Secondaire', 'var(--accent-2)'], ['Accent', 'var(--purple)'], ['Alerte', 'var(--warn)']].map(function (c) {
              return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)"><span style="width:20px;height:20px;border-radius:6px;background:' + c[1] + ';border:1px solid var(--border);flex-shrink:0"></span><span style="font-size:12.5px;flex:1">' + c[0] + '</span></div>';
            }).join('')}
            <div class="cm-note" style="margin-top:12px">Titres : Space Grotesk · Texte : Manrope</div>
          </div>
        </div>
        <div class="cm-panel">
          <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:12px">ÉTAT DE CONFIGURATION</div>
          <div class="cm-progress" style="margin-bottom:14px"><i style="width:${pct}%"></i></div>
          ${cfgItems.map(function (i) {
            const color = i[1] ? 'var(--ok)' : 'var(--warn)';
            return '<div style="display:flex;justify-content:space-between;padding:6px 0"><span style="font-size:12.5px">' + esc(i[0]) + '</span><span class="badge" style="background:color-mix(in srgb, ' + color + ' 18%, transparent);color:' + color + '">' + (i[1] ? 'Complet' : 'À compléter') + '</span></div>';
          }).join('')}
        </div>`;
      }
      async function saveClubIdentity() {
        const nom = fieldVal('pi-nom');
        if (!nom) { toast('Le nom du club est obligatoire.'); return; }
        const ville = fieldVal('pi-ville'), discipline = fieldVal('pi-discipline'), saison = fieldVal('pi-saison');
        const res = await sbFetch('clubs?id=eq.' + orgId, { method: 'PATCH', body: { nom: nom, ville: ville, discipline: discipline, saison: saison } });
        if (!res.ok) { toast("Erreur lors de l'enregistrement (droits administrateur requis)."); return; }
        club.nom = nom; club.ville = ville; club.discipline = discipline; club.saison = saison;
        paint();
        toast('Identité du club mise à jour.');
      }
      async function handleImageChange(kind, file) {
        if (!file || !canManage) return;
        toast('Import en cours…');
        const ext = (file.name.split('.').pop() || 'png').toLowerCase();
        const path = orgId + '/' + kind + '.' + ext;
        const url = await uploadClubImage('clubplus-media', path, file);
        if (!url) { toast("Échec de l'import."); return; }
        const bustedUrl = url + '?t=' + Date.now();
        const col = kind === 'logo' ? 'logo_url' : 'ecusson_url';
        const body = {}; body[col] = bustedUrl;
        const res = await sbFetch('clubs?id=eq.' + orgId, { method: 'PATCH', body: body });
        if (!res.ok) { toast("Échec de l'enregistrement."); return; }
        club[col] = bustedUrl;
        paint();
        toast('Image mise à jour.');
      }

      /* ── Notifications (réel : notification_preferences + notification_quiet_hours) ── */
      function notificationsHtml() {
        return `<div class="cm-panel" style="margin-bottom:16px">
          <div class="cm-note" style="margin-bottom:14px">Choisissez les e-mails que vous souhaitez recevoir de SportVision Connect. Les notifications de sécurité, obligations légales et facturation restent toujours envoyées, quelle que soit votre choix ci-dessous.</div>
          ${NOTIF_PREF_CATEGORIES.map(function (c) {
            const cat = c[0], label = c[1], desc = c[2];
            const checked = notifPrefs[cat] !== false;
            return `<div class="cm-inline-row" style="align-items:center">
              <div><div style="font-weight:600;font-size:13.5px">${esc(label)}</div><div class="cm-note" style="margin-top:2px">${esc(desc)}</div></div>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex-shrink:0">
                <input type="checkbox" style="width:auto" data-action="toggle-notif" data-category="${cat}" ${checked ? 'checked' : ''}>
                <span class="cm-note">${checked ? 'Activé' : 'Désactivé'}</span>
              </label>
            </div>`;
          }).join('')}
        </div>
        <div class="cm-panel">
          <div style="font-weight:600;font-size:13.5px;margin-bottom:4px">Heures calmes</div>
          <div class="cm-note" style="margin-bottom:14px">En dehors de cette plage, les e-mails non critiques attendent l'heure d'ouverture plutôt que d'être envoyés. Les notifications de sécurité, obligations légales et facturation ne sont jamais concernées.</div>
          <div class="cm-row2" style="margin-bottom:12px">
            <div class="cm-field"><label>Pas de notification avant</label><input type="time" data-field="qh-before" value="${esc(quietHours.not_before)}"></div>
            <div class="cm-field"><label>Pas de notification après</label><input type="time" data-field="qh-after" value="${esc(quietHours.not_after)}"></div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px">
            <input type="checkbox" data-field="qh-sunday" style="width:auto" ${quietHours.sunday_urgent_only ? 'checked' : ''}>
            <span style="font-size:13px">Le dimanche, urgences uniquement</span>
          </label>
          <button class="btn btn-primary" data-action="save-quiet-hours">Enregistrer les heures calmes</button>
        </div>`;
      }
      async function toggleNotifPref(category, enabled) {
        const previous = notifPrefs[category];
        notifPrefs[category] = enabled;
        paint();
        const res = await sbFetch('notification_preferences?on_conflict=user_id,category', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: { user_id: uid, category: category, email_enabled: enabled }
        });
        if (!res.ok) {
          notifPrefs[category] = previous;
          paint();
          toast("Erreur lors de l'enregistrement de la préférence.");
          return;
        }
        toast('Préférence enregistrée.');
      }
      async function saveQuietHours() {
        const notBefore = fieldVal('qh-before') || '08:00';
        const notAfter = fieldVal('qh-after') || '21:00';
        const sundayEl = container.querySelector('[data-field="qh-sunday"]');
        const sundayUrgentOnly = !!(sundayEl && sundayEl.checked);
        const res = await sbFetch('notification_quiet_hours?on_conflict=user_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: { user_id: uid, not_before: notBefore, not_after: notAfter, sunday_urgent_only: sundayUrgentOnly }
        });
        if (!res.ok) { toast("Erreur lors de l'enregistrement des heures calmes."); return; }
        quietHours = { not_before: notBefore, not_after: notAfter, sunday_urgent_only: sundayUrgentOnly };
        toast('Heures calmes enregistrées.');
      }

      /* ── Intégrations (voir note de divergence en tête de module) ── */
      function integrationsHtml() {
        const list = [
          ['SportVision OS', 'Synchronisation interne des missions, prestations et de la production.', 'À venir', 'var(--warn)'],
          ['Supabase', 'Base de données et authentification — connectée à ce club.', 'Connecté', 'var(--ok)'],
          ['Stripe', 'Paiements de l’abonnement du club et des projets d’équipe.', 'Connecté', 'var(--ok)']
        ];
        return list.map(function (i) {
          return `<div class="cm-inline-row" style="align-items:center">
            <div><div style="font-weight:700;font-size:14px">${esc(i[0])}</div><div class="cm-note" style="margin-top:2px">${esc(i[1])}</div></div>
            <span class="badge" style="background:color-mix(in srgb, ${i[3]} 18%, transparent);color:${i[3]}">${esc(i[2])}</span>
          </div>`;
        }).join('');
      }

      /* ── Rôles et permissions (clubs.role_permissions — configuration, non appliquée) ── */
      function permissionsHtml() {
        const roleLabels = PERM_ROLE_COLS.map(roleLabel);
        const m = currentPermMatrix();
        const rows = PERM_KEYS.map(function (pair) {
          const key = pair[0], label = pair[1];
          return '<tr><td>' + esc(label) + '</td>' + PERM_ROLE_COLS.map(function (rk) {
            const checked = m[key][rk] ? 'checked' : '';
            const attrs = canManage ? ('data-action="toggle-perm" data-perm="' + key + '" data-role="' + rk + '"') : 'disabled';
            return '<td><input type="checkbox" style="width:auto" ' + checked + ' ' + attrs + '></td>';
          }).join('') + '</tr>';
        }).join('');
        return `<div class="cm-panel" style="overflow-x:auto">
          <table class="cm-table"><thead><tr><th>Permission</th>${roleLabels.map(function (r) { return '<th>' + esc(r) + '</th>'; }).join('')}</tr></thead>
          <tbody>${rows}</tbody></table>
        </div>
        ${canManage ? `<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-primary" data-action="save-permissions">Enregistrer les permissions</button>
          <button class="btn btn-ghost" data-action="reset-permissions">Réinitialiser</button>
        </div>` : ''}
        <div class="cm-note" style="margin-top:10px">Cette matrice est enregistrée pour le club, mais n'est pas encore appliquée techniquement pour restreindre les actions dans l'application — c'est un écran de configuration et de référence, pas un contrôle d'accès réel à ce jour.</div>`;
      }
      function togglePerm(permKey, roleKey) {
        const m = currentPermMatrix();
        m[permKey][roleKey] = !m[permKey][roleKey];
        paint();
      }
      async function saveMatrixPermissions() {
        const res = await sbFetch('clubs?id=eq.' + orgId, { method: 'PATCH', body: { role_permissions: currentPermMatrix() } });
        if (!res.ok) { toast("Erreur lors de l'enregistrement (droits administrateur requis)."); return; }
        club.role_permissions = currentPermMatrix();
        toast('Permissions enregistrées.');
      }
      function resetMatrixPermissions() {
        permMatrixCache = defaultPermMatrix();
        paint();
        toast('Permissions réinitialisées (non enregistré — cliquez sur Enregistrer pour confirmer).');
      }

      function paint() {
        if (!loaded) {
          container.innerHTML = '<div class="cm-wrap"><div class="cm-toolbar"><h2>Paramètres</h2></div><div class="cm-empty">Chargement…</div></div>';
          return;
        }
        let content;
        if (paView === 'identite') content = identiteHtml();
        else if (paView === 'notifications') content = notificationsHtml();
        else if (paView === 'integrations') content = integrationsHtml();
        else content = permissionsHtml();
        container.innerHTML = `<div class="cm-wrap">
          <div class="cm-toolbar"><h2>Paramètres</h2></div>
          <div class="cm-pillbar">${TABS.map(function (t) {
            return '<button class="cm-pill' + (paView === t[0] ? ' on' : '') + '" data-action="tab" data-tab="' + t[0] + '">' + esc(t[1]) + '</button>';
          }).join('')}</div>
          ${content}
        </div>`;
        bind();
      }

      function bind() {
        container.onclick = async function (e) {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'tab') { paView = btn.getAttribute('data-tab'); paint(); }
          else if (action === 'save-identity') { await saveClubIdentity(); }
          else if (action === 'pick-logo') { const inp = container.querySelector('[data-role="file-logo"]'); if (inp) inp.click(); }
          else if (action === 'pick-ecusson') { const inp = container.querySelector('[data-role="file-ecusson"]'); if (inp) inp.click(); }
          else if (action === 'save-quiet-hours') { await saveQuietHours(); }
          else if (action === 'save-permissions') { await saveMatrixPermissions(); }
          else if (action === 'reset-permissions') { resetMatrixPermissions(); }
          else if (action === 'toggle-perm') { togglePerm(btn.getAttribute('data-perm'), btn.getAttribute('data-role')); }
        };
        container.onchange = async function (e) {
          const t = e.target;
          if (!t || !t.getAttribute) return;
          const role = t.getAttribute('data-role');
          if (role === 'file-logo' && t.files && t.files[0]) { await handleImageChange('logo', t.files[0]); return; }
          if (role === 'file-ecusson' && t.files && t.files[0]) { await handleImageChange('ecusson', t.files[0]); return; }
          if (t.getAttribute('data-action') === 'toggle-notif') {
            const cat = t.getAttribute('data-category');
            if (cat) await toggleNotifPref(cat, t.checked);
          }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 2. MES ACCÈS (clubs + club_members)
   *
   * Divergence assumée par rapport à tplMesAcces() de Club+, après lecture
   * complète et vérification : la fonction source (app.html lignes
   * 2799-2809) ne fait que 11 lignes, pas ~460 comme une estimation de
   * départ le supposait — le gros bloc de code entre elle et
   * tplFamillesDemandes() (lignes 2810-3262) est une fonctionnalité
   * différente ("Espace Joueur & Famille", famAdminTab/realFamRequests
   * etc.), pas "Mes accès". La vraie tplMesAcces() de Club+ affiche une
   * carte figée avec des valeurs codées en dur ("FC Clairval", "01/07/2026",
   * "Isabelle Faure") — jamais branchée à REAL malgré le reste de l'app qui
   * distingue systématiquement REAL du mode démo. Reproduire ces valeurs
   * littéralement afficherait un faux club à chaque utilisateur réel de
   * Connect, ce qu'aucun autre module de ce dossier ne fait. Cette version
   * branche donc la même forme d'écran sur les données réelles
   * (clubs + club_members, orgId/ctx.role — mêmes tables que 'administration'
   * dans club-demandes-medias-sponsors-admin.js) et ajoute la section "Ce que
   * ce rôle permet", dérivée de la matrice de Paramètres et filtrée sur
   * ctx.role : c'est le contenu concret que "Mes accès" doit montrer selon
   * la consigne de la tâche, la carte d'origine seule (club/équipes/dates)
   * ne répondait pas vraiment à "ce que MOI j'ai le droit de faire".
   * ============================================================ */
  window.ClubModules.mesacces = {
    label: 'Mes accès',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      const role = (ctx && ctx.role) || null;
      const uid = localStorage.getItem('svc_uid');

      let club = null;
      let myMembership = null;
      let adminName = null;
      let loaded = false;

      async function load() {
        const [clubRes, meRes, adminRes] = await Promise.all([
          sbFetch('clubs?id=eq.' + orgId + '&select=nom,role_permissions'),
          uid ? sbFetch('club_members?club_id=eq.' + orgId + '&user_id=eq.' + uid + '&select=teams,telephone,status,created_at&limit=1') : Promise.resolve({ ok: true, data: [] }),
          sbFetch('club_members?club_id=eq.' + orgId + '&role=eq.admin&status=eq.actif&select=prenom,nom&order=created_at.asc&limit=1')
        ]);
        if (!clubRes.ok) toast('Erreur de chargement.');
        club = (clubRes.ok && clubRes.data && clubRes.data[0]) || null;
        myMembership = (meRes.ok && meRes.data && meRes.data[0]) || null;
        const adminRow = (adminRes.ok && adminRes.data && adminRes.data[0]) || null;
        adminName = adminRow ? (((adminRow.prenom || '') + ' ' + (adminRow.nom || '')).trim() || null) : null;
        loaded = true;
      }

      function permSectionHtml() {
        if (!role) return '';
        if (PERM_ROLE_COLS.indexOf(role) === -1) {
          return `<div class="cm-panel" style="margin-top:16px">
            <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:10px">CE QUE CE RÔLE PERMET</div>
            <div class="cm-note">La matrice de permissions configurable par le club ne couvre pour l'instant que les rôles suivants : ${PERM_ROLE_COLS.map(roleLabel).map(esc).join(', ')}. Votre rôle (${esc(roleLabel(role))}) n'y figure pas encore.</div>
          </div>`;
        }
        const m = effectivePermMatrix(club);
        const rows = PERM_KEYS.map(function (pair) {
          const key = pair[0], label = pair[1];
          const allowed = !!(m[key] && m[key][role]);
          const color = allowed ? 'var(--ok)' : 'var(--danger)';
          return `<div class="cm-inline-row"><span>${esc(label)}</span><span class="badge" style="background:color-mix(in srgb, ${color} 18%, transparent);color:${color}">${allowed ? 'Oui' : 'Non'}</span></div>`;
        }).join('');
        return `<div class="cm-panel" style="margin-top:16px">
          <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:10px">CE QUE CE RÔLE PERMET</div>
          ${rows}
          <div class="cm-note" style="margin-top:10px">Configuration du club (Paramètres → Rôles et permissions) — indicative : elle n'est pas encore appliquée techniquement pour bloquer une action dans l'application, même si elle indique "Non" ci-dessus.</div>
        </div>`;
      }

      function paint() {
        if (!loaded) {
          container.innerHTML = '<div class="cm-wrap"><div class="cm-toolbar"><h2>Mes accès</h2></div><div class="cm-empty">Chargement…</div></div>';
          return;
        }
        const teams = myMembership && Array.isArray(myMembership.teams) && myMembership.teams.length ? myMembership.teams.join(', ') : 'Toutes';
        const since = myMembership && myMembership.created_at ? fmtDate(myMembership.created_at) : '—';
        container.innerHTML = `<div class="cm-wrap">
          <div class="cm-toolbar">
            <h2>Mes accès</h2>
            ${role ? '<span class="badge" style="background:color-mix(in srgb, var(--accent) 18%, transparent);color:var(--accent)">' + esc(roleLabel(role)) + '</span>' : ''}
          </div>
          ${role && ROLE_DESC[role] ? '<div class="cm-note" style="margin-bottom:16px">' + esc(ROLE_DESC[role]) + '</div>' : ''}
          <div class="cm-panel" style="max-width:520px">
            <div class="cm-inline-row"><span class="cm-note">Club</span><span style="font-weight:600">${esc((club && club.nom) || '—')}</span></div>
            <div class="cm-inline-row"><span class="cm-note">Équipes visibles</span><span style="font-weight:600">${esc(teams)}</span></div>
            <div class="cm-inline-row"><span class="cm-note">Membre depuis</span><span style="font-weight:600">${esc(since)}</span></div>
            <div class="cm-inline-row"><span class="cm-note">Administrateur responsable</span><span style="font-weight:600">${esc(adminName || '—')}</span></div>
          </div>
          ${permSectionHtml()}
        </div>`;
      }

      await load();
      paint();
    }
  };
})();
