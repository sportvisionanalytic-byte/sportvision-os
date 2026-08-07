/* ============================================================
 * SportVision Connect — Module "Espace Famille"
 * ------------------------------------------------------------
 * Portage autonome de l'Espace Famille de SportVision Club+
 * (app.html, lecture seule, référence uniquement — jamais modifié)
 * vers le nouveau socle Connect. C'est la partie la plus sensible
 * de l'écosystème (données de mineurs, autorisations parentales) :
 * ce module ne fait AUCUNE décision de permission côté client, il
 * se contente d'interroger ce que la RLS/les RPC serveur autorisent
 * déjà et d'afficher le résultat.
 *
 * Sources lues avant d'écrire ce fichier (aucune n'a été modifiée) :
 *   - CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md
 *   - CLUBPLUS_PLAYER_FAMILY_SECURITY_REVIEW.md
 *   - migration-clubplus-v13.sql (player_profiles, parent_profiles,
 *     parent_player_relationships, team_memberships, is_own_player,
 *     is_confirmed_parent_of, is_family_of_team, is_team_educateur)
 *   - migration-clubplus-v15.sql (authorization_types,
 *     authorization_versions, parental_authorizations,
 *     authorization_events, submit_parental_authorization,
 *     verify_parental_authorization, withdraw_parental_authorization,
 *     validate_team_membership)
 *   - migration-clubplus-v16.sql (lecture famille de club_teams,
 *     scopée équipe via is_family_of_team — jamais club entier)
 *   - migration-clubplus-v18.sql / v19.sql (media_access_rules,
 *     is_media_visible_to_family, favoris, signalement/masquage)
 *   - migration-clubplus-v20.sql (club_bookings ouvert aux
 *     joueurs/parents comme demandeurs — pipeline piloté par
 *     SportVision, PAS de paiement en ligne pour ces commandes)
 *   - migration-clubplus-v21.sql (team_projects,
 *     team_project_contributions) + supabase/functions/
 *     create-team-contribution-checkout/index.ts (Edge Function déjà
 *     déployée qui résout elle-même l'identité de l'appelant côté
 *     serveur — jamais un player_id/contributor_type transmis par ce
 *     module)
 *   - migration-clubplus-v23.sql (correctifs de sécurité récents)
 *
 * Point d'architecture crucial : contextId reçu par render() est
 * directement parent_profiles.id — PAS un organizations.id, un parent
 * n'est pas une organisation. Toute donnée relative à un enfant passe
 * TOUJOURS par parent_player_relationships filtré sur
 * parent_id=eq.<contextId> ET statut=eq.confirme avant d'aller chercher
 * quoi que ce soit d'autre — jamais de requête sur player_profiles (ou
 * une table qui en dépend) sans être passé par ce filtre en premier.
 *
 * `clubs` reste hors de portée volontairement : la table n'est lisible
 * que par is_club_member/is_club_admin (univers dirigeants). La vue
 * `club_family_identity` envisagée dans l'architecture (§4.1) n'a
 * jamais été créée par aucune migration relue — ce module ne l'utilise
 * donc pas et n'affiche pas de nom/logo de club, seulement le nom de
 * l'équipe (club_teams.name, lisible via la policy famille de v16).
 *
 * Dépendances globales fournies par le shell (index.html), non
 * redéfinies ici : sbFetch, sbRpc, sbFunction, esc, toast. Variables
 * CSS réutilisées : --card, --border, --radius, --shadow, --accent,
 * --accent-2, --muted, --text, --ok, --danger. Classes réutilisées :
 * .btn, .btn-primary, .btn-ghost, .badge.
 *
 * Le module est un IIFE : tout l'état vit dans une closure locale,
 * jamais sur window, à l'exception des 4 points d'entrée contractuels
 * window.FamilleModules.{enfants,autorisations,livrables,paiements}.
 * Les 4 onglets partagent un même cache interne (moduleState, clé
 * parent_profiles.id) pour que la sélection d'enfant reste cohérente
 * d'un onglet à l'autre, même si le shell démonte/remonte un nouveau
 * conteneur DOM à chaque bascule d'onglet.
 * ============================================================ */
(function () {
  'use strict';

  /* ── État interne, keyé par parent_profiles.id ── */
  var moduleState = {};
  function getState(parentId) {
    var s = moduleState[parentId];
    if (!s) {
      s = moduleState[parentId] = {
        children: null,          // null = pas chargé, [] = chargé et vide
        errorChildren: null,
        selectedPlayerId: null,
        authByPlayer: {},        // playerId -> {data,error}
        teamsByPlayer: {},       // playerId -> {data,error} — team_memberships actives
        mediaByPlayer: {},       // playerId -> {data,error}
        bookingsByPlayer: {},    // playerId -> {data,error}
        projectsByPlayer: {},    // playerId -> {data,error}
        contribByPlayer: {},     // playerId -> {data,error}
      };
    }
    return s;
  }

  /* ── Styles scopés (préfixe fam-), injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('fam-styles')) return;
    var style = document.createElement('style');
    style.id = 'fam-styles';
    style.textContent = [
      '.fam-wrap{display:flex;flex-direction:column;gap:14px}',
      '.fam-pillbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px}',
      '.fam-pill{background:var(--card);border:1px solid var(--border);border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer}',
      '.fam-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}',
      '.fam-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}',
      '.fam-card{text-align:left;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 16px;cursor:pointer;font:inherit;color:inherit}',
      '.fam-card.on{border-color:var(--accent);border-width:2px}',
      '.fam-card-title{font-size:14.5px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.fam-muted{color:var(--muted);font-size:12.5px;margin-top:3px}',
      '.fam-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:26px;text-align:center;color:var(--muted)}',
      '.fam-error{color:var(--danger)}',
      '.fam-list{display:flex;flex-direction:column;gap:10px}',
      '.fam-item{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px}',
      '.fam-item-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}',
      '.fam-item-title{font-weight:700;font-size:14px}',
      '.fam-badge-info{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}',
      '.fam-badge-warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}',
      '.fam-badge-ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}',
      '.fam-badge-danger{background:color-mix(in srgb,var(--danger) 16%,transparent);color:var(--danger)}',
      '.fam-badge-muted{background:rgba(157,174,195,.15);color:var(--muted)}',
      '.fam-detail-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;font-size:12.5px;border-top:1px solid var(--border)}',
      '.fam-detail-row span{color:var(--muted)}',
      '.fam-section-title{font-size:15px;font-weight:700;margin:18px 0 2px}',
      '.fam-section-title:first-child{margin-top:0}',
      '.fam-note{font-size:12px;color:var(--muted);margin-top:8px;font-style:italic}',
      '.fam-details{margin-top:10px;border-top:1px dashed var(--border);padding-top:8px}',
      '.fam-details summary{cursor:pointer;color:var(--accent);font-size:13px;font-weight:600}',
      '.fam-legal-text{font-size:12.5px;color:var(--text);background:var(--bg,var(--bg));border-radius:8px;padding:10px 12px;margin:8px 0;white-space:pre-wrap;max-height:220px;overflow-y:auto}',
      '.fam-label{display:block;font-size:12.5px;font-weight:600;margin:10px 0 5px;color:var(--text)}',
      '.fam-input{width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:9px;font-size:13.5px;font-family:inherit;box-sizing:border-box}',
      '.fam-input:focus{outline:2px solid var(--accent);outline-offset:1px}',
      '.fam-check{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;margin:10px 0;color:var(--text)}',
      '.fam-check input{margin-top:2px}',
      '.fam-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
      '.fam-actions .btn{width:auto;margin-top:0}',
      '.fam-actions form{display:contents}',
      '.fam-media-link{font-size:12.5px;color:var(--accent);text-decoration:none;font-weight:600}',
      '.fam-media-link:hover{text-decoration:underline}',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ── Utilitaires ── */
  function fmtDate(v) {
    if (!v) return '—';
    var s = String(v);
    var d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
    if (isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  // club_media.link est un champ libre saisi par un membre du club (formulaire
  // d'import média) : ne jamais le rendre en href sans vérifier le schéma, sinon
  // un lien "javascript:..." s'exécuterait au clic — même faille déjà trouvée et
  // corrigée dans le module Club.
  function isSafeHttpUrl(url) { return typeof url === 'string' && /^https?:\/\//i.test(url); }
  function fmtEuros(n) {
    if (n === null || n === undefined || n === '') return '—';
    var v = Number(n);
    if (isNaN(v)) return esc(String(n));
    return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  // Affichage uniquement — jamais utilisé pour activer/désactiver une
  // action : la seule tranche d'âge qui compte pour les permissions est
  // recalculée côté serveur (sv_age_bracket, migration v13) au moment de
  // chaque RPC, pas ici.
  function ageBracketLabel(dateNaissance) {
    if (!dateNaissance) return '';
    var dob = new Date(dateNaissance + 'T00:00:00');
    if (isNaN(dob.getTime())) return '';
    var now = new Date();
    var age = now.getFullYear() - dob.getFullYear();
    var m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    if (age < 14) return 'Moins de 14 ans';
    if (age < 18) return '14–17 ans';
    return 'Majeur(e)';
  }
  function accountStatusMeta(v) {
    switch (v) {
      case 'sans_compte': return { label: 'Fiche sans compte', cls: 'fam-badge-muted' };
      case 'invite': return { label: 'Invité(e)', cls: 'fam-badge-info' };
      case 'en_attente_activation': return { label: "En attente d'activation", cls: 'fam-badge-warn' };
      case 'actif': return { label: 'Compte actif', cls: 'fam-badge-ok' };
      case 'suspendu': return { label: 'Suspendu', cls: 'fam-badge-danger' };
      case 'retire': return { label: 'Retiré', cls: 'fam-badge-danger' };
      default: return { label: v || '—', cls: 'fam-badge-muted' };
    }
  }
  function relationTypeLabel(v) {
    return { parent: 'Parent', tuteur_legal: 'Tuteur légal', autre_representant: 'Autre représentant' }[v] || v || '—';
  }
  function authStatutMeta(v) {
    switch (v) {
      case 'non_transmise': return { label: 'Non transmise', cls: 'fam-badge-muted' };
      case 'en_attente': return { label: 'En attente', cls: 'fam-badge-warn' };
      case 'transmise': return { label: 'Transmise', cls: 'fam-badge-info' };
      case 'a_verifier': return { label: 'À vérifier par le club', cls: 'fam-badge-warn' };
      case 'valide': return { label: 'Validée', cls: 'fam-badge-ok' };
      case 'incomplete': return { label: 'Incomplète', cls: 'fam-badge-warn' };
      case 'refusee': return { label: 'Refusée', cls: 'fam-badge-danger' };
      case 'expiree': return { label: 'Expirée', cls: 'fam-badge-danger' };
      case 'retiree': return { label: 'Retirée', cls: 'fam-badge-danger' };
      case 'remplacee': return { label: 'Remplacée', cls: 'fam-badge-muted' };
      default: return { label: v || '—', cls: 'fam-badge-muted' };
    }
  }
  function bookingStatusMeta(v) {
    switch (v) {
      case 'recue': return { label: 'Reçue', cls: 'fam-badge-info' };
      case 'qualifiee': return { label: 'Qualifiée', cls: 'fam-badge-info' };
      case 'confirmee': return { label: 'Confirmée', cls: 'fam-badge-ok' };
      case 'operateur_affecte': return { label: 'Opérateur affecté', cls: 'fam-badge-ok' };
      case 'mission_realisee': return { label: 'Mission réalisée', cls: 'fam-badge-ok' };
      case 'livree': return { label: 'Livrée', cls: 'fam-badge-ok' };
      default: return { label: v || '—', cls: 'fam-badge-muted' };
    }
  }
  function projectStatutMeta(v) {
    switch (v) {
      case 'brouillon': return { label: 'Brouillon', cls: 'fam-badge-muted' };
      case 'attente_validation_club': return { label: 'En attente de validation du club', cls: 'fam-badge-warn' };
      case 'ouvert': return { label: 'Ouvert aux contributions', cls: 'fam-badge-ok' };
      case 'objectif_atteint': return { label: 'Objectif atteint', cls: 'fam-badge-ok' };
      case 'paiement_complementaire_necessaire': return { label: 'Paiement complémentaire nécessaire', cls: 'fam-badge-warn' };
      case 'confirme': return { label: 'Confirmé', cls: 'fam-badge-ok' };
      case 'annule': return { label: 'Annulé', cls: 'fam-badge-danger' };
      case 'rembourse': return { label: 'Remboursé', cls: 'fam-badge-danger' };
      case 'prestation_realisee': return { label: 'Prestation réalisée', cls: 'fam-badge-ok' };
      case 'livre': return { label: 'Livré', cls: 'fam-badge-ok' };
      default: return { label: v || '—', cls: 'fam-badge-muted' };
    }
  }
  function contribStatutMeta(v) {
    switch (v) {
      case 'en_attente': return { label: 'En attente', cls: 'fam-badge-warn' };
      case 'paye': return { label: 'Payée', cls: 'fam-badge-ok' };
      case 'rembourse': return { label: 'Remboursée', cls: 'fam-badge-muted' };
      case 'echoue': return { label: 'Échouée', cls: 'fam-badge-danger' };
      default: return { label: v || '—', cls: 'fam-badge-muted' };
    }
  }
  function loadingHtml(label) { return '<div class="fam-empty">Chargement de ' + esc(label) + '…</div>'; }
  function errorHtml(msg, retryAction) {
    return '<div class="fam-empty fam-error">' + esc(msg) +
      '<div style="margin-top:10px"><button class="btn btn-ghost" data-fam-action="' + retryAction + '">Réessayer</button></div></div>';
  }
  function noChildrenHtml() {
    return '<div class="fam-empty">Aucun enfant confirmé n\'est encore rattaché à votre compte.<br>' +
      'Si vous venez de faire une demande, elle doit d\'abord être confirmée avant d\'apparaître ici.</div>';
  }

  /* ── Chargement : enfants (parent_player_relationships, confirmés uniquement) ──
   * Point de passage obligatoire pour toute donnée famille : jamais de
   * requête player_profiles (ou dépendante) sans être passé par ce filtre
   * parent_id=eq.<contextId>&statut=eq.confirme en premier.
   */
  async function loadChildren(parentId, force) {
    var s = getState(parentId);
    if (s.children !== null && !force) return s.children;
    s.errorChildren = null;
    try {
      var res = await sbFetch(
        'parent_player_relationships?select=id,relation_type,statut,confirmed_at,' +
        'player_profiles(id,prenom,nom,date_naissance,photo_url,numero_licence,numero_maillot,account_status)' +
        '&parent_id=eq.' + parentId + '&statut=eq.confirme&order=confirmed_at.asc'
      );
      if (!res.ok) throw new Error('http ' + res.status);
      var rows = (res.data || []).filter(function (r) { return r.player_profiles; });
      s.children = rows.map(function (r) {
        var p = r.player_profiles;
        return {
          relationId: r.id, relationType: r.relation_type, confirmedAt: r.confirmed_at,
          id: p.id, prenom: p.prenom, nom: p.nom, dateNaissance: p.date_naissance,
          photoUrl: p.photo_url, numeroLicence: p.numero_licence, numeroMaillot: p.numero_maillot,
          accountStatus: p.account_status,
        };
      });
      if (!s.selectedPlayerId || !s.children.some(function (c) { return c.id === s.selectedPlayerId; })) {
        s.selectedPlayerId = s.children.length ? s.children[0].id : null;
      }
    } catch (e) {
      s.children = null;
      s.errorChildren = 'Impossible de charger la liste de vos enfants. Vérifiez votre connexion.';
    }
    return s.children;
  }

  function childSelectorHtml(s) {
    if (!s.children || s.children.length < 2) return '';
    return '<div class="fam-pillbar">' + s.children.map(function (c) {
      return '<button class="fam-pill' + (c.id === s.selectedPlayerId ? ' on' : '') + '" data-fam-action="select-child" data-id="' + esc(c.id) + '">' +
        esc(c.prenom + ' ' + c.nom) + '</button>';
    }).join('') + '</div>';
  }

  /* ── Onglet 1 : Mes enfants ── */
  function enfantsBodyHtml(s) {
    if (s.errorChildren) return errorHtml(s.errorChildren, 'retry-children');
    var children = s.children || [];
    if (!children.length) return noChildrenHtml();
    var cards = children.map(function (c) {
      var sel = c.id === s.selectedPlayerId;
      var acc = accountStatusMeta(c.accountStatus);
      return '<button class="fam-card' + (sel ? ' on' : '') + '" data-fam-action="select-child" data-id="' + esc(c.id) + '">' +
        '<div class="fam-card-title">' + esc(c.prenom + ' ' + c.nom) +
        (sel ? ' <span class="badge fam-badge-info">Enfant sélectionné</span>' : '') + '</div>' +
        '<div class="fam-muted">' + esc(ageBracketLabel(c.dateNaissance)) +
        (c.numeroLicence ? ' · Licence ' + esc(c.numeroLicence) : '') + '</div>' +
        '<div class="fam-muted"><span class="badge ' + acc.cls + '">' + esc(acc.label) + '</span></div>' +
        '<div class="fam-muted">Lien confirmé le ' + fmtDate(c.confirmedAt) + ' · ' + esc(relationTypeLabel(c.relationType)) + '</div>' +
        '</button>';
    }).join('');
    return '<div class="fam-grid">' + cards + '</div>';
  }
  async function renderEnfants(container, parentId) {
    container.innerHTML = loadingHtml('vos enfants');
    await loadChildren(parentId);
    if (!container.isConnected) return;
    var s = getState(parentId);
    container.innerHTML = enfantsBodyHtml(s);
  }

  /* ── Onglet 2 : Autorisations ── */
  async function loadAuthorizations(parentId, playerId, force) {
    var s = getState(parentId);
    var bucket = s.authByPlayer[playerId] || (s.authByPlayer[playerId] = { data: null, error: null });
    if (bucket.data !== null && !force) return bucket.data;
    bucket.error = null;
    try {
      var res = await sbFetch(
        'parental_authorizations?select=*,authorization_types(code,label,description,obligatoire),authorization_versions(version_label,texte)' +
        '&player_id=eq.' + playerId + '&order=created_at.asc'
      );
      if (!res.ok) throw new Error('http ' + res.status);
      bucket.data = res.data || [];
    } catch (e) {
      bucket.data = null;
      bucket.error = 'Impossible de charger les autorisations de cet enfant.';
    }
    return bucket.data;
  }
  function authorizationItemHtml(a) {
    var meta = authStatutMeta(a.statut);
    var type = a.authorization_types || {};
    var version = a.authorization_versions || {};
    var canSign = a.statut !== 'valide' && a.statut !== 'retiree';
    var canWithdraw = a.statut !== 'retiree' && a.statut !== 'non_transmise';
    var textDetails = version.texte
      ? '<details class="fam-details"><summary>Voir le texte de cette autorisation (' + esc(version.version_label || '') + ')</summary>' +
        '<div class="fam-legal-text">' + esc(version.texte) + '</div></details>'
      : '';
    var signForm = canSign
      ? '<details class="fam-details"><summary>Signer par voie électronique</summary>' +
        '<form data-fam-form="sign-auth" data-id="' + esc(a.id) + '">' +
        (version.texte ? '<div class="fam-legal-text">' + esc(version.texte) + '</div>' : '') +
        '<label class="fam-check"><input type="checkbox" required> J\'ai lu et j\'accepte les termes de cette autorisation.</label>' +
        '<button class="btn btn-primary" type="submit">Confirmer la signature</button>' +
        '</form></details>'
      : '';
    var withdrawBtn = canWithdraw
      ? '<button class="btn btn-ghost" data-fam-action="withdraw-auth" data-id="' + esc(a.id) + '" style="color:var(--danger)">Retirer cette autorisation</button>'
      : '';
    return '<div class="fam-item">' +
      '<div class="fam-item-top">' +
      '<div><div class="fam-item-title">' + esc(type.label || type.code || 'Autorisation') +
      (type.obligatoire ? ' <span class="badge fam-badge-warn" style="margin-left:6px">Obligatoire</span>' : '') + '</div>' +
      (type.description ? '<div class="fam-muted">' + esc(type.description) + '</div>' : '') + '</div>' +
      '<span class="badge ' + meta.cls + '">' + esc(meta.label) + '</span>' +
      '</div>' +
      '<div class="fam-detail-row"><span>Méthode</span><b>' + esc(a.methode || '—') + '</b></div>' +
      '<div class="fam-detail-row"><span>Date de signature</span><b>' + fmtDate(a.date_signature) + '</b></div>' +
      '<div class="fam-detail-row"><span>Vérifiée le</span><b>' + fmtDate(a.verified_at) + '</b></div>' +
      (a.statut === 'retiree' ? '<div class="fam-detail-row"><span>Retirée le</span><b>' + fmtDate(a.retrait_at) + (a.retrait_motif ? ' — ' + esc(a.retrait_motif) : '') + '</b></div>' : '') +
      (a.statut === 'refusee' && a.retrait_motif ? '<div class="fam-detail-row"><span>Motif du refus</span><b>' + esc(a.retrait_motif) + '</b></div>' : '') +
      textDetails + signForm +
      (withdrawBtn ? '<div class="fam-actions">' + withdrawBtn + '</div>' : '') +
      (a.statut === 'valide' ? '<div class="fam-note">Le retrait d\'une autorisation est enregistré immédiatement, mais ne suspend pas automatiquement l\'accès déjà actif de votre enfant (équipe, contenus) — le club doit ensuite agir manuellement.</div>' : '') +
      '</div>';
  }
  function autorisationsBodyHtml(s, playerId) {
    var bucket = s.authByPlayer[playerId];
    if (!bucket) return loadingHtml('autorisations');
    if (bucket.error) return errorHtml(bucket.error, 'retry-auth');
    var list = bucket.data || [];
    if (!list.length) return '<div class="fam-empty">Aucune autorisation n\'a encore été initialisée pour cet enfant.</div>';
    return '<div class="fam-list">' + list.map(authorizationItemHtml).join('') + '</div>';
  }
  async function refreshAutorisations(container, parentId) {
    var s = getState(parentId);
    if (s.errorChildren) { container.innerHTML = errorHtml(s.errorChildren, 'retry-children'); return; }
    if (!s.children || !s.children.length) { container.innerHTML = noChildrenHtml(); return; }
    var pid = s.selectedPlayerId;
    var bucket = s.authByPlayer[pid];
    if (!bucket || (bucket.data === null && !bucket.error)) {
      container.innerHTML = childSelectorHtml(s) + loadingHtml('autorisations');
      await loadAuthorizations(parentId, pid);
      if (!container.isConnected) return;
    }
    s = getState(parentId);
    container.innerHTML = childSelectorHtml(s) + autorisationsBodyHtml(s, pid);
  }
  async function renderAutorisations(container, parentId) {
    container.innerHTML = loadingHtml('vos enfants');
    await loadChildren(parentId);
    if (!container.isConnected) return;
    await refreshAutorisations(container, parentId);
  }

  /* ── Onglet 3 : Livrables (médias/créations publiés à l'équipe de l'enfant) ──
   * L'accès réel est déjà tranché côté serveur par is_media_visible_to_family
   * (media_access_rules + team_memberships + parent_player_relationships,
   * fail-closed : rien n'est visible tant que le club n'a pas explicitement
   * publié une media_access_rules pour ce média). Ce module ne peut pas lire
   * media_access_rules lui-même (réservé aux dirigeants du club), donc le
   * filtre par équipe ci-dessous n'est qu'un affinage d'affichage — la
   * sécurité réelle vient uniquement de la policy SELECT de club_media/
   * club_creations, jamais de ce filtre côté client.
   */
  async function loadChildTeams(parentId, playerId, force) {
    var s = getState(parentId);
    var bucket = s.teamsByPlayer[playerId] || (s.teamsByPlayer[playerId] = { data: null, error: null });
    if (bucket.data !== null && !force) return bucket.data;
    bucket.error = null;
    try {
      var res = await sbFetch('team_memberships?select=team_id,saison,club_teams(name)&player_id=eq.' + playerId + '&statut=eq.active');
      if (!res.ok) throw new Error('http ' + res.status);
      bucket.data = (res.data || [])
        .filter(function (r) { return r.club_teams && r.club_teams.name; })
        .map(function (r) { return { teamId: r.team_id, name: r.club_teams.name, saison: r.saison }; });
    } catch (e) {
      bucket.data = null;
      bucket.error = "Impossible de charger l'équipe de cet enfant.";
    }
    return bucket.data;
  }
  async function loadMedia(parentId, playerId, force) {
    var s = getState(parentId);
    var bucket = s.mediaByPlayer[playerId] || (s.mediaByPlayer[playerId] = { data: null, error: null });
    if (bucket.data !== null && !force) return bucket.data;
    bucket.error = null;
    try {
      var teams = await loadChildTeams(parentId, playerId, force);
      if (teams === null) { bucket.data = null; bucket.error = "Impossible de charger l'équipe de cet enfant."; return bucket.data; }
      if (!teams.length) { bucket.data = []; return bucket.data; }
      var names = [];
      teams.forEach(function (t) { if (names.indexOf(t.name) === -1) names.push(t.name); });
      var reqs = [];
      names.forEach(function (n) {
        reqs.push(sbFetch('club_media?select=*&team=eq.' + encodeURIComponent(n) + '&expired=eq.false&order=created_at.desc'));
        reqs.push(sbFetch('club_creations?select=*&team=eq.' + encodeURIComponent(n) + '&status=eq.publie&order=created_at.desc'));
      });
      var results = await Promise.all(reqs);
      var items = [];
      results.forEach(function (r, i) {
        if (!r.ok) return;
        var refType = (i % 2 === 0) ? 'club_media' : 'club_creations';
        (r.data || []).forEach(function (m) { m.refType = refType; items.push(m); });
      });
      // Dédoublonnage (un même média peut ressortir plusieurs fois si plusieurs
      // saisons/équipes actives partagent le même nom d'équipe recopié).
      var seen = {};
      items = items.filter(function (m) {
        var key = m.refType + ':' + m.id;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
      items.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      bucket.data = items;
    } catch (e) {
      bucket.data = null;
      bucket.error = 'Impossible de charger les livrables de cet enfant.';
    }
    return bucket.data;
  }
  function mediaItemHtml(m) {
    var typeLabel = esc(m.type || (m.refType === 'club_creations' ? 'Création' : 'Média'));
    var link = isSafeHttpUrl(m.link) ? '<a class="fam-media-link" href="' + esc(m.link) + '" target="_blank" rel="noopener noreferrer">Voir →</a>' : '';
    return '<div class="fam-item">' +
      '<div class="fam-item-top">' +
      '<div><div class="fam-item-title">' + esc(m.title || 'Sans titre') + '</div>' +
      '<div class="fam-muted">' + typeLabel + (m.team ? ' · ' + esc(m.team) : '') + ' · ' + fmtDate(m.created_at) + '</div></div>' +
      link +
      '</div>' +
      (m.tags ? '<div class="fam-muted" style="margin-top:6px">' + esc(m.tags) + '</div>' : '') +
      (m.sponsor ? '<div class="fam-muted" style="margin-top:6px">Sponsor : ' + esc(m.sponsor) + '</div>' : '') +
      '</div>';
  }
  function livrablesBodyHtml(s, playerId) {
    var bucket = s.mediaByPlayer[playerId];
    if (!bucket) return loadingHtml('livrables');
    if (bucket.error) return errorHtml(bucket.error, 'retry-media');
    var list = bucket.data || [];
    if (!list.length) return '<div class="fam-empty">Aucun livrable publié pour l\'équipe de cet enfant pour le moment.<br>' +
      'Les photos, vidéos et créations apparaîtront ici dès que le club les aura rendues visibles côté famille.</div>';
    return '<div class="fam-list">' + list.map(mediaItemHtml).join('') + '</div>';
  }
  async function refreshLivrables(container, parentId) {
    var s = getState(parentId);
    if (s.errorChildren) { container.innerHTML = errorHtml(s.errorChildren, 'retry-children'); return; }
    if (!s.children || !s.children.length) { container.innerHTML = noChildrenHtml(); return; }
    var pid = s.selectedPlayerId;
    var bucket = s.mediaByPlayer[pid];
    if (!bucket || (bucket.data === null && !bucket.error)) {
      container.innerHTML = childSelectorHtml(s) + loadingHtml('livrables');
      await loadMedia(parentId, pid);
      if (!container.isConnected) return;
    }
    s = getState(parentId);
    container.innerHTML = childSelectorHtml(s) + livrablesBodyHtml(s, pid);
  }
  async function renderLivrables(container, parentId) {
    container.innerHTML = loadingHtml('vos enfants');
    await loadChildren(parentId);
    if (!container.isConnected) return;
    await refreshLivrables(container, parentId);
  }

  /* ── Onglet 4 : Paiements ──
   * Deux sources bien distinctes, aucune inventée :
   *  1) club_bookings (prestations personnelles, migration v20) : pipeline
   *     entièrement piloté par SportVision (recue -> ... -> livree), AUCUN
   *     paiement en ligne n'existe pour ces commandes — affichage seul.
   *  2) team_projects / team_project_contributions (migration v21) : un
   *     vrai paiement en ligne existe déjà via l'Edge Function
   *     create-team-contribution-checkout (déployée, cf. en-tête de ce
   *     fichier) — ce module se contente d'appeler cette fonction avec
   *     {project_id, montant}, jamais de logique de calcul/validation de
   *     paiement construite ici : la fonction résout elle-même l'identité
   *     de l'appelant et valide le montant côté serveur.
   */
  async function loadBookings(parentId, playerId, force) {
    var s = getState(parentId);
    var bucket = s.bookingsByPlayer[playerId] || (s.bookingsByPlayer[playerId] = { data: null, error: null });
    if (bucket.data !== null && !force) return bucket.data;
    bucket.error = null;
    try {
      var res = await sbFetch('club_bookings?select=*&player_id=eq.' + playerId + '&order=created_at.desc');
      if (!res.ok) throw new Error('http ' + res.status);
      bucket.data = res.data || [];
    } catch (e) {
      bucket.data = null;
      bucket.error = 'Impossible de charger les commandes de cet enfant.';
    }
    return bucket.data;
  }
  async function loadProjects(parentId, playerId, force) {
    var s = getState(parentId);
    var bucket = s.projectsByPlayer[playerId] || (s.projectsByPlayer[playerId] = { data: null, error: null });
    if (bucket.data !== null && !force) return bucket.data;
    bucket.error = null;
    try {
      var teams = await loadChildTeams(parentId, playerId, force);
      if (teams === null) { bucket.data = null; bucket.error = "Impossible de charger l'équipe de cet enfant."; return bucket.data; }
      if (!teams.length) { bucket.data = []; return bucket.data; }
      var ids = [];
      teams.forEach(function (t) { if (ids.indexOf(t.teamId) === -1) ids.push(t.teamId); });
      var res = await sbFetch('team_projects?select=*&team_id=in.(' + ids.join(',') + ')&statut=eq.ouvert&order=date_limite.asc.nullslast');
      if (!res.ok) throw new Error('http ' + res.status);
      bucket.data = res.data || [];
    } catch (e) {
      bucket.data = null;
      bucket.error = 'Impossible de charger les projets collectifs de cet enfant.';
    }
    return bucket.data;
  }
  async function loadContributions(parentId, playerId, force) {
    var s = getState(parentId);
    var bucket = s.contribByPlayer[playerId] || (s.contribByPlayer[playerId] = { data: null, error: null });
    if (bucket.data !== null && !force) return bucket.data;
    bucket.error = null;
    try {
      var res = await sbFetch('team_project_contributions?select=*,team_projects(titre)&player_id=eq.' + playerId + '&order=created_at.desc');
      if (!res.ok) throw new Error('http ' + res.status);
      bucket.data = res.data || [];
    } catch (e) {
      bucket.data = null;
      bucket.error = 'Impossible de charger vos contributions pour cet enfant.';
    }
    return bucket.data;
  }
  function bookingItemHtml(b) {
    var meta = bookingStatusMeta(b.status);
    return '<div class="fam-item">' +
      '<div class="fam-item-top">' +
      '<div><div class="fam-item-title">' + esc(b.service_label || 'Prestation') + '</div>' +
      '<div class="fam-muted">' + (b.event_date ? fmtDate(b.event_date) : 'Date à confirmer') + (b.team ? ' · ' + esc(b.team) : '') + '</div></div>' +
      '<span class="badge ' + meta.cls + '">' + esc(meta.label) + '</span>' +
      '</div>' +
      (b.price_label ? '<div class="fam-detail-row"><span>Tarif</span><b>' + esc(b.price_label) + '</b></div>' : '') +
      '<div class="fam-note">Le paiement de cette prestation est géré directement par SportVision (facturation manuelle) — aucun paiement en ligne n\'est disponible ici pour le moment.</div>' +
      '</div>';
  }
  function projectItemHtml(p) {
    var meta = projectStatutMeta(p.statut);
    var restant = (p.montant_cible != null) ? Math.max(0, Number(p.montant_cible) - Number(p.montant_collecte || 0)) : null;
    return '<div class="fam-item">' +
      '<div class="fam-item-top">' +
      '<div><div class="fam-item-title">' + esc(p.titre) + '</div>' +
      (p.objectif ? '<div class="fam-muted">' + esc(p.objectif) + '</div>' : '') + '</div>' +
      '<span class="badge ' + meta.cls + '">' + esc(meta.label) + '</span>' +
      '</div>' +
      '<div class="fam-detail-row"><span>Collecté</span><b>' + fmtEuros(p.montant_collecte) + ' / ' + fmtEuros(p.montant_cible) + '</b></div>' +
      (restant != null ? '<div class="fam-detail-row"><span>Reste à collecter</span><b>' + fmtEuros(restant) + '</b></div>' : '') +
      (p.date_limite ? '<div class="fam-detail-row"><span>Date limite</span><b>' + fmtDate(p.date_limite) + '</b></div>' : '') +
      (p.contribution_min ? '<div class="fam-detail-row"><span>Contribution minimum</span><b>' + fmtEuros(p.contribution_min) + '</b></div>' : '') +
      '<details class="fam-details"><summary>Contribuer à ce projet</summary>' +
      '<form data-fam-form="contribute" data-project="' + esc(p.id) + '">' +
      '<label class="fam-label">Montant (€)' +
      '<input class="fam-input" type="number" name="montant" min="' + (p.contribution_min || 1) + '" step="0.01" required' +
      (p.part_conseillee ? ' placeholder="Conseillé : ' + esc(String(p.part_conseillee)) + ' €"' : '') + '></label>' +
      '<button class="btn btn-primary" type="submit" style="margin-top:8px">Payer en ligne</button>' +
      '<div class="fam-note">Cette contribution sera associée par SportVision à l\'enfant rattaché à cette équipe.</div>' +
      '</form></details>' +
      '</div>';
  }
  function contributionItemHtml(c) {
    var meta = contribStatutMeta(c.statut);
    var titre = c.team_projects ? c.team_projects.titre : 'Projet';
    return '<div class="fam-item">' +
      '<div class="fam-item-top">' +
      '<div><div class="fam-item-title">' + esc(titre) + '</div>' +
      '<div class="fam-muted">' + fmtDate(c.created_at) + '</div></div>' +
      '<span class="badge ' + meta.cls + '">' + esc(meta.label) + '</span>' +
      '</div>' +
      '<div class="fam-detail-row"><span>Montant</span><b>' + fmtEuros(c.montant) + '</b></div>' +
      '</div>';
  }
  function paiementsBodyHtml(s, playerId) {
    var bBucket = s.bookingsByPlayer[playerId];
    var pBucket = s.projectsByPlayer[playerId];
    var cBucket = s.contribByPlayer[playerId];
    if (!bBucket || !pBucket || !cBucket) return loadingHtml('paiements');
    var out = '';
    out += '<div class="fam-section-title">Commandes de prestations personnelles</div>';
    if (bBucket.error) out += errorHtml(bBucket.error, 'retry-bookings');
    else if (!bBucket.data.length) out += '<div class="fam-empty">Aucune commande de prestation personnelle pour cet enfant.</div>';
    else out += '<div class="fam-list">' + bBucket.data.map(bookingItemHtml).join('') + '</div>';

    out += '<div class="fam-section-title">Projets collectifs ouverts</div>';
    if (pBucket.error) out += errorHtml(pBucket.error, 'retry-projects');
    else if (!pBucket.data.length) out += '<div class="fam-empty">Aucun projet collectif ouvert pour l\'équipe de cet enfant.</div>';
    else out += '<div class="fam-list">' + pBucket.data.map(projectItemHtml).join('') + '</div>';

    out += '<div class="fam-section-title">Vos contributions</div>';
    if (cBucket.error) out += errorHtml(cBucket.error, 'retry-contrib');
    else if (!cBucket.data.length) out += '<div class="fam-empty">Aucune contribution enregistrée pour cet enfant.</div>';
    else out += '<div class="fam-list">' + cBucket.data.map(contributionItemHtml).join('') + '</div>';

    return out;
  }
  async function refreshPaiements(container, parentId) {
    var s = getState(parentId);
    if (s.errorChildren) { container.innerHTML = errorHtml(s.errorChildren, 'retry-children'); return; }
    if (!s.children || !s.children.length) { container.innerHTML = noChildrenHtml(); return; }
    var pid = s.selectedPlayerId;
    var bB = s.bookingsByPlayer[pid], pB = s.projectsByPlayer[pid], cB = s.contribByPlayer[pid];
    var needsLoad = !bB || (bB.data === null && !bB.error) || !pB || (pB.data === null && !pB.error) || !cB || (cB.data === null && !cB.error);
    if (needsLoad) {
      container.innerHTML = childSelectorHtml(s) + loadingHtml('paiements');
      await Promise.all([loadBookings(parentId, pid), loadProjects(parentId, pid), loadContributions(parentId, pid)]);
      if (!container.isConnected) return;
    }
    s = getState(parentId);
    container.innerHTML = childSelectorHtml(s) + paiementsBodyHtml(s, pid);
  }
  async function renderPaiements(container, parentId) {
    container.innerHTML = loadingHtml('vos enfants');
    await loadChildren(parentId);
    if (!container.isConnected) return;
    await refreshPaiements(container, parentId);
  }

  /* ── Actions serveur ── */
  async function signAuthorization(container, parentId, authId, refresh) {
    var res = await sbRpc('submit_parental_authorization', {
      p_authorization_id: authId,
      p_methode: 'signature_numerique',
      p_preuve: { lu_le: new Date().toISOString(), interface: 'sportvision-connect' },
      p_date_debut: new Date().toISOString().slice(0, 10),
    });
    if (!res.ok) { toast(res.status === 403 ? 'Action non autorisée.' : (res.data && res.data.message) || 'Erreur lors de la signature.'); return; }
    var s = getState(parentId);
    var pid = s.selectedPlayerId;
    if (s.authByPlayer[pid]) s.authByPlayer[pid].data = null;
    toast('Autorisation transmise. Le club doit maintenant la vérifier.');
    refresh();
  }
  async function withdrawAuthorization(container, parentId, authId, refresh) {
    if (!window.confirm(
      "Retirer cette autorisation ? Le retrait sera enregistré immédiatement mais NE suspend PAS " +
      "automatiquement l'accès déjà actif de votre enfant (équipe, contenus) — le club devra agir " +
      "manuellement en complément."
    )) return;
    var res = await sbRpc('withdraw_parental_authorization', { p_authorization_id: authId, p_motif: 'Retrait demandé par le parent depuis SportVision Connect' });
    if (!res.ok) { toast(res.status === 403 ? 'Action non autorisée.' : 'Erreur lors du retrait.'); return; }
    var s = getState(parentId);
    var pid = s.selectedPlayerId;
    if (s.authByPlayer[pid]) s.authByPlayer[pid].data = null;
    toast('Autorisation retirée.');
    refresh();
  }
  async function contributeToProject(parentId, projectId, montant, submitBtn) {
    if (submitBtn) submitBtn.disabled = true;
    try {
      var res = await sbFunction('create-team-contribution-checkout', { project_id: projectId, montant: montant });
      if (!res.ok || !res.data || !res.data.url) {
        toast((res.data && res.data.error) || 'Impossible de démarrer le paiement.');
        return;
      }
      window.location.href = res.data.url;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  /* ── Délégation d'événements — un seul conteneur par bascule d'onglet,
   * assignation directe (pas addEventListener) comme demandé, rejouable
   * sans fuite mémoire puisque le shell fournit un nouveau noeud DOM à
   * chaque activation. ── */
  function bindContainer(container, parentId, refresh) {
    container.onclick = function (e) {
      var el = e.target.closest('[data-fam-action]');
      if (!el || !container.contains(el)) return;
      var action = el.getAttribute('data-fam-action');
      var id = el.getAttribute('data-id');
      var s = getState(parentId);
      switch (action) {
        case 'select-child':
          s.selectedPlayerId = id;
          refresh();
          break;
        case 'retry-children':
          loadChildren(parentId, true).then(refresh);
          break;
        // Rechargement forcé (pas juste data=null) : sans force=true, une
        // erreur précédente resterait posée sur le bucket et le prochain
        // refresh() sauterait le rechargement en la voyant toujours là.
        case 'retry-auth':
          loadAuthorizations(parentId, s.selectedPlayerId, true).then(refresh);
          break;
        case 'retry-media':
          loadMedia(parentId, s.selectedPlayerId, true).then(refresh);
          break;
        case 'retry-bookings':
          loadBookings(parentId, s.selectedPlayerId, true).then(refresh);
          break;
        case 'retry-projects':
          loadProjects(parentId, s.selectedPlayerId, true).then(refresh);
          break;
        case 'retry-contrib':
          loadContributions(parentId, s.selectedPlayerId, true).then(refresh);
          break;
        case 'withdraw-auth':
          withdrawAuthorization(container, parentId, id, refresh);
          break;
      }
    };
    container.onsubmit = function (e) {
      var form = e.target.closest('[data-fam-form]');
      if (!form || !container.contains(form)) return;
      e.preventDefault();
      var kind = form.getAttribute('data-fam-form');
      if (kind === 'sign-auth') {
        signAuthorization(container, parentId, form.getAttribute('data-id'), refresh);
      } else if (kind === 'contribute') {
        var fd = new FormData(form);
        var montant = Number(fd.get('montant'));
        if (!montant || montant <= 0) { toast('Montant invalide.'); return; }
        contributeToProject(parentId, form.getAttribute('data-project'), montant, form.querySelector('button[type=submit]'));
      }
    };
  }

  /* ── Points d'entrée contractuels ── */
  async function render(container, parentId, ctx, tabKind) {
    ensureStyles();
    var wrap = document.createElement('div');
    wrap.className = 'fam-wrap';
    container.innerHTML = '';
    container.appendChild(wrap);

    function refresh() {
      if (tabKind === 'enfants') return renderEnfants(wrap, parentId);
      if (tabKind === 'autorisations') return refreshAutorisations(wrap, parentId);
      if (tabKind === 'livrables') return refreshLivrables(wrap, parentId);
      if (tabKind === 'paiements') return refreshPaiements(wrap, parentId);
    }
    bindContainer(container, parentId, refresh);

    if (tabKind === 'enfants') await renderEnfants(wrap, parentId);
    else if (tabKind === 'autorisations') await renderAutorisations(wrap, parentId);
    else if (tabKind === 'livrables') await renderLivrables(wrap, parentId);
    else if (tabKind === 'paiements') await renderPaiements(wrap, parentId);
  }

  window.FamilleModules = window.FamilleModules || {};
  window.FamilleModules.enfants = {
    label: 'Mes enfants', espace: 'famille',
    render: function (container, contextId, ctx) { return render(container, contextId, ctx, 'enfants'); },
  };
  window.FamilleModules.autorisations = {
    label: 'Autorisations', espace: 'famille',
    render: function (container, contextId, ctx) { return render(container, contextId, ctx, 'autorisations'); },
  };
  window.FamilleModules.livrables = {
    label: 'Livrables', espace: 'famille',
    render: function (container, contextId, ctx) { return render(container, contextId, ctx, 'livrables'); },
  };
  window.FamilleModules.paiements = {
    label: 'Paiements', espace: 'famille',
    render: function (container, contextId, ctx) { return render(container, contextId, ctx, 'paiements'); },
  };
})();
