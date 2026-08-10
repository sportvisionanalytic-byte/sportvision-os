/* ============================================================
 * SportVision Connect — Module Club
 * Joueurs & Familles · Demandes Joueurs & Familles (vue dirigeant/éducateur)
 *
 * Port fidèle (mais autonome) des équivalents dans Club+ (app.html,
 * lecture seule, jamais modifié) :
 *   - tplJoueursFamilles()   (app.html, ligne ~3272) → window.ClubModules.joueursFamilles
 *   - tplFamillesDemandes()  (app.html, ligne ~3263) → window.ClubModules.demandesJoueursFamilles
 * ainsi que toutes les fonctions loadFamX/famXRowHtml/famXxx qui les
 * alimentent (app.html, lignes ~2838-3262).
 *
 * Module SENSIBLE : données de mineurs (droit à l'image, autorisations
 * parentales). Sources lues intégralement avant d'écrire une seule ligne
 * de ce fichier :
 *   - CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md (v1, 04/08 — référence des
 *     règles métier : rôles joueur/parent, tables, RLS §5, RPC §6)
 *   - app.html : tplJoueursFamilles / tplFamillesDemandes + tout leur
 *     data layer (loadFamRequests…loadFamActiveMemberships) et leurs
 *     handlers (famAcceptRequest, famRejectRequest, famVerifyAuth, etc.)
 *   - club-demandes-medias-sponsors-admin.js — patron de style Connect
 *     suivi EXACTEMENT ici (ensureStyles, sbFetch/sbRpc/sbFunction/esc/
 *     toast globaux, routage data-action, closure par appel de render())
 *   - migration-clubplus-v13/v14/v15/v18/v19/v21/v22.sql — pour vérifier
 *     l'existence réelle de chaque RPC avant de l'appeler (voir notes de
 *     sécurité ci-dessous)
 *   - famille-espace.js / joueur-espace.js — vocabulaire déjà en place
 *     côté Connect pour l'espace joueur/parent lui-même (PAS ce que ce
 *     fichier porte : ici, c'est la vue DIRIGEANT/éducateur/admin)
 *
 * Vérifications réelles faites contre Supabase (curl, service role, cf.
 * .env) avant d'écrire ce fichier — TOUTES les tables suivantes existent
 * et leurs colonnes correspondent exactement à l'architecture décrite :
 * player_profiles, parent_profiles, parent_player_relationships,
 * membership_requests, parental_authorizations, media_reports,
 * team_memberships, team_invite_codes, player_invitations,
 * parent_invitations, authorization_types, team_projects,
 * team_project_contributions, season_membership_renewals, club_teams,
 * club_members, memberships, organizations, catalogue_offres.
 * Les 8 RPC utilisées ci-dessous sont confirmées présentes dans le spec
 * OpenAPI PostgREST en direct (/rpc/<nom>) ET dans les migrations SQL
 * (numéro de migration entre parenthèses) :
 *   validate_team_membership (v15), reject_team_membership (v14),
 *   confirm_request_educateur (v15), verify_parental_authorization (v15),
 *   withdraw_parental_authorization (v15, non utilisée dans cette vue
 *   dirigeant — seul le parent/l'admin retire une autorisation, pas
 *   l'éducateur — présente pour mémoire),
 *   create_team_invite_code (v14), rotate_team_invite_code (v14),
 *   renew_season_membership (v22).
 * L'Edge Function clubplus-family-invite (supabase/functions/) existe
 * bien aussi — c'est elle, pas une RPC create_player_invitation/
 * create_parent_invitation (qui n'existent PAS, malgré ce que suggère
 * §6 de l'architecture — vérifié : absentes des migrations ET du spec
 * OpenAPI), qui crée réellement les invitations, exactement comme le
 * fait déjà app.html (submitFamilyInvite).
 *
 * ── Trois décisions de sécurité prises moi-même, à ne pas manquer ──
 *
 * 1. `suspend_player_access` (RPC citée par les règles de sécurité de ce
 *    chantier ET par l'architecture §6) N'EXISTE PAS : absente des
 *    migrations v1-v31 ET du spec OpenAPI live. `player_access_events`
 *    (table d'audit associée, §2.9 de l'architecture) N'EXISTE PAS non
 *    plus. Club+ (app.html) lui-même n'expose AUCUN bouton « Suspendre »
 *    dans famPlayerRowHtml — donc rien à porter côté UI ici, fidèlement.
 *    Je n'ai PAS ajouté de bouton de suspension (ça aurait nécessité soit
 *    un RPC qui n'existe pas, soit un UPDATE direct sur player_profiles.
 *    account_status, explicitement interdit par les règles de ce
 *    chantier pour un changement d'état sensible). J'ai écrit une
 *    migration SQL neuve pour cette RPC manquante :
 *    migration-clubplus-v32-suspend-player-access.sql (à côté de ce
 *    fichier, dans SportVision-TV/) — NON exécutée, à valider par
 *    Fouka. Elle n'est appelée nulle part dans ce fichier.
 *
 * 2. `parental_authorizations.document_url` / `.preuve` : la vue
 *    filtrante `authorization_status_for_coach` prévue par
 *    l'architecture (§5) N'EXISTE PAS (vérifié : 404 sur l'API REST).
 *    Mais en creusant migration-clubplus-v15.sql, la réalité est même
 *    plus stricte que prévu : AUCUNE policy RLS n'accorde le moindre
 *    accès éducateur à `parental_authorizations` (seules pa_parent_
 *    select / pa_player_select / pa_admin_select existent), avec un
 *    commentaire explicite dans la migration : « PAS d'accès éducateur
 *    ici, volontairement ». Un éducateur qui interrogerait cette table
 *    reçoit donc 0 ligne, imposé par le serveur, pas par ce fichier.
 *    Défense en profondeur appliquée quand même : loadAuthorizations()
 *    ne sélectionne JAMAIS document_url/preuve (liste de colonnes
 *    explicite, pas select=*), quel que soit le rôle — ces colonnes ne
 *    sont d'ailleurs jamais affichées dans authRowHtml, fidèle à
 *    famAuthRowHtml de Club+ qui ne les affiche pas non plus. Un
 *    bandeau informatif (pas un blocage côté client — la vraie garde
 *    est déjà côté serveur) prévient l'utilisateur non-admin de cette
 *    limite plutôt que de laisser une liste vide sans explication.
 *
 * 3. `club_family_identity` (vue prévue par l'architecture §4.1) N'EXISTE
 *    PAS non plus, mais elle ne concerne que la lecture de l'identité du
 *    club par un joueur/parent (espace famille), hors périmètre de ce
 *    fichier (vue dirigeant) — mentionné ici seulement pour mémoire,
 *    déjà documenté par famille-espace.js.
 *
 * Toute action qui change un état sensible passe exclusivement par les
 * RPC SECURITY DEFINER listées ci-dessus, jamais par un UPDATE/PATCH
 * direct via sbFetch — à l'exception (fidèle à Club+ ET aux policies RLS
 * réellement en place, vérifiées ci-dessus) de : team_invite_codes.actif
 * (policy UPDATE dédiée tic_manager_update, non un état « sensible » au
 * sens des mineurs), media_reports.statut (policy mrp_admin_update,
 * back-office de modération, pas une donnée de mineur en tant que
 * telle) et team_projects.statut/team_projects (policies tpr_*_update,
 * financier associatif, pas une donnée de mineur). Ces trois cas sont
 * déjà gouvernés par des policies RLS dédiées et restrictives (pas des
 * policies UPDATE ouvertes) et c'est very exactement ce que fait déjà
 * Club+ en production.
 *
 * Dépendances globales fournies par le shell (index.html), non
 * redéfinies ici : sbFetch, sbRpc, sbFunction, esc, toast. Variables CSS
 * et classes réutilisées : voir ensureStyles() ci-dessous (identique au
 * bloc partagé de club-demandes-medias-sponsors-admin.js, même id
 * 'cm-shared-style' pour ne jamais l'injecter deux fois).
 * ============================================================ */
(function () {
  'use strict';

  /* ── Styles partagés (identiques au patron), injectés une seule fois ── */
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
  // Complément propre à ce module (tuiles de stats, barre de progression de
  // financement de projet, titre de section) — id distinct pour ne jamais
  // interférer avec cm-shared-style, additif uniquement.
  function ensureExtraStyles() {
    if (document.getElementById('cmf-extra-style')) return;
    const style = document.createElement('style');
    style.id = 'cmf-extra-style';
    style.textContent = `
      .cmf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
      .cmf-stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px}
      .cmf-stat b{display:block;font-size:22px;line-height:1.2}
      .cmf-stat span{display:block;color:var(--muted);font-size:12px;margin-top:4px}
      .cmf-progress{height:8px;border-radius:6px;background:var(--border);overflow:hidden;margin-bottom:6px}
      .cmf-progress i{display:block;height:100%;background:var(--accent-2)}
      .cmf-section-title{font-size:11.5px;font-weight:700;color:var(--muted);margin:4px 0 8px;text-transform:uppercase;letter-spacing:.02em}
    `;
    document.head.appendChild(style);
  }

  /* ── Formattage partagé ── */
  function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fullName(o) {
    return (((o && o.prenom) || '') + ' ' + ((o && o.nom) || '')).trim() || '—';
  }

  /* ── Libellés / couleurs de statut (repris à l'identique de app.html :
     famReqStatusMeta, FAM_ACCOUNT_STATUS_META, FAM_AUTH_STATUS_META,
     MEDIA_REPORT_*, TEAM_PROJECT_STATUS_META) ── */
  const REQ_STATUSES = ['a_verifier', 'autorisation_manquante', 'en_attente_parent', 'pret_a_valider', 'validee', 'refusee'];
  function reqStatusMeta(status) {
    return {
      a_verifier: { label: 'À vérifier', color: 'var(--accent)' },
      autorisation_manquante: { label: 'Autorisation manquante', color: 'var(--danger)' },
      en_attente_parent: { label: 'En attente du parent', color: '#e2a03f' },
      pret_a_valider: { label: 'Prête à valider', color: 'var(--accent-2)' },
      validee: { label: 'Validée', color: 'var(--ok)' },
      refusee: { label: 'Refusée', color: 'var(--danger)' },
      doublon_signale: { label: 'Doublon signalé', color: 'var(--danger)' },
      transferee_admin: { label: 'Transférée à l’administrateur', color: 'var(--purple)' }
    }[status] || { label: status || '—', color: 'var(--muted)' };
  }
  function accountStatusMeta(status) {
    return {
      sans_compte: { label: 'Sans compte', color: 'var(--muted)' },
      invite: { label: 'Invité', color: '#e2a03f' },
      en_attente_activation: { label: 'En attente d’activation', color: '#e2a03f' },
      actif: { label: 'Actif', color: 'var(--ok)' },
      suspendu: { label: 'Suspendu', color: 'var(--danger)' },
      retire: { label: 'Retiré', color: 'var(--muted)' }
    }[status] || { label: status || '—', color: 'var(--muted)' };
  }
  function authStatusMeta(status) {
    return {
      non_transmise: { label: 'Non transmise', color: 'var(--muted)' },
      en_attente: { label: 'En attente', color: '#e2a03f' },
      transmise: { label: 'Transmise', color: '#e2a03f' },
      a_verifier: { label: 'À vérifier', color: '#e2a03f' },
      valide: { label: 'Valide', color: 'var(--ok)' },
      incomplete: { label: 'Incomplète', color: 'var(--danger)' },
      refusee: { label: 'Refusée', color: 'var(--danger)' },
      expiree: { label: 'Expirée', color: 'var(--danger)' },
      retiree: { label: 'Retirée', color: 'var(--muted)' },
      remplacee: { label: 'Remplacée', color: 'var(--muted)' }
    }[status] || { label: status || '—', color: 'var(--muted)' };
  }
  const REPORT_MOTIF_LABEL = {
    joueur_present_retrait: 'Joueur présent, retrait souhaité',
    enfant_present: 'Enfant présent',
    mauvaise_equipe: 'Mauvaise équipe',
    contenu_inapproprie: 'Contenu inapproprié',
    droit_image: "Problème de droit à l'image",
    erreur: 'Erreur',
    autre: 'Autre'
  };
  const REPORT_STATUSES = ['recu', 'a_verifier', 'media_masque', 'infos_demandees', 'retrait_accepte', 'retrait_refuse', 'termine'];
  function reportStatusMeta(status) {
    return {
      recu: { label: 'Reçu', color: 'var(--accent)' },
      a_verifier: { label: 'À vérifier', color: '#e2a03f' },
      media_masque: { label: 'Média masqué', color: 'var(--purple)' },
      infos_demandees: { label: 'Infos demandées', color: '#e2a03f' },
      retrait_accepte: { label: 'Retrait accepté', color: 'var(--ok)' },
      retrait_refuse: { label: 'Retrait refusé', color: 'var(--danger)' },
      termine: { label: 'Terminé', color: 'var(--muted)' }
    }[status] || { label: status || '—', color: 'var(--muted)' };
  }
  const PROJECT_STATUSES = ['brouillon', 'attente_validation_club', 'ouvert', 'objectif_atteint', 'paiement_complementaire_necessaire', 'confirme', 'annule', 'rembourse', 'prestation_realisee', 'livre'];
  function projectStatusMeta(status) {
    return {
      brouillon: { label: 'Brouillon', color: 'var(--muted)' },
      attente_validation_club: { label: 'En attente de validation', color: '#e2a03f' },
      ouvert: { label: 'Ouvert', color: 'var(--accent)' },
      objectif_atteint: { label: 'Objectif atteint', color: 'var(--ok)' },
      paiement_complementaire_necessaire: { label: 'Paiement complémentaire nécessaire', color: '#e2a03f' },
      confirme: { label: 'Confirmé', color: 'var(--ok)' },
      annule: { label: 'Annulé', color: 'var(--danger)' },
      rembourse: { label: 'Remboursé', color: 'var(--muted)' },
      prestation_realisee: { label: 'Prestation réalisée', color: 'var(--ok)' },
      livre: { label: 'Livré', color: 'var(--ok)' }
    }[status] || { label: status || '—', color: 'var(--muted)' };
  }

  /* ── Chargement des données (une requête par table, RLS déjà scopée
     admin-club-large / éducateur-équipe-restreinte selon les policies
     réellement vérifiées — voir en-tête. Un éducateur et un admin
     appellent EXACTEMENT la même requête ci-dessous : c'est la RLS
     serveur qui restreint les lignes retournées, jamais une condition
     côté client, même philosophie que famille-espace.js) ── */
  async function loadTeams(orgId) {
    const res = await sbFetch('club_teams?club_id=eq.' + orgId + '&select=id,name,categorie,coach&order=name.asc');
    if (!res.ok) toast('Erreur de chargement des équipes.');
    return res.ok ? (res.data || []) : [];
  }
  async function loadRequests(orgId) {
    const res = await sbFetch('membership_requests?club_id=eq.' + orgId + '&select=*,player_profiles(prenom,nom,date_naissance),club_teams(name)&order=created_at.desc');
    if (!res.ok) toast('Erreur de chargement des demandes.');
    return res.ok ? (res.data || []) : [];
  }
  async function loadPlayers(orgId) {
    const res = await sbFetch('player_profiles?club_id=eq.' + orgId + '&select=id,prenom,nom,date_naissance,account_status,numero_licence,numero_maillot&order=created_at.desc');
    if (!res.ok) toast('Erreur de chargement des joueurs.');
    return res.ok ? (res.data || []) : [];
  }
  async function loadParents() {
    // parent_profiles est un profil global (pas de colonne club_id, vérifié
    // sur le spec OpenAPI en direct) — le scope au club se fait uniquement
    // via la policy RLS parp_club_admin_select (jointure parent_player_
    // relationships → player_profiles.club_id), jamais un filtre côté
    // client ici.
    const res = await sbFetch('parent_profiles?select=*,parent_player_relationships(statut,player_id,player_profiles(prenom,nom))&order=created_at.desc');
    if (!res.ok) toast('Erreur de chargement des parents.');
    return res.ok ? (res.data || []) : [];
  }
  async function loadInvitations(orgId) {
    const [p, pa] = await Promise.all([
      sbFetch('player_invitations?club_id=eq.' + orgId + '&statut=eq.envoyee&select=*&order=created_at.desc'),
      sbFetch('parent_invitations?club_id=eq.' + orgId + '&statut=eq.envoyee&select=*&order=created_at.desc')
    ]);
    return { joueurs: p.ok ? (p.data || []) : [], parents: pa.ok ? (pa.data || []) : [] };
  }
  async function loadAuthorizations() {
    // Liste de colonnes explicite : document_url/preuve ne sont JAMAIS
    // sélectionnées ici, quel que soit le rôle appelant — voir note de
    // sécurité n°2 en en-tête de fichier.
    const res = await sbFetch('parental_authorizations?select=id,statut,methode,date_signature,date_debut,date_expiration,created_at,player_id,authorization_type_id,player_profiles(prenom,nom),authorization_types(code,label)&order=created_at.desc');
    if (!res.ok) toast('Erreur de chargement des autorisations.');
    return res.ok ? (res.data || []) : [];
  }
  async function loadReports(orgId) {
    const res = await sbFetch('media_reports?club_id=eq.' + orgId + '&select=*,player_profiles(prenom,nom)&order=created_at.desc');
    if (!res.ok) toast('Erreur de chargement des signalements.');
    return res.ok ? (res.data || []) : [];
  }
  async function loadProjects(orgId) {
    const res = await sbFetch('team_projects?club_id=eq.' + orgId + '&select=*,club_teams(name),catalogue_offres(nom)&order=created_at.desc');
    if (!res.ok) toast('Erreur de chargement des projets.');
    return res.ok ? (res.data || []) : [];
  }
  async function loadActiveMemberships(orgId) {
    const res = await sbFetch('team_memberships?club_id=eq.' + orgId + '&statut=eq.active&select=id,saison,player_id,team_id,player_profiles(prenom,nom),club_teams(name)&order=created_at.asc');
    if (!res.ok) toast('Erreur de chargement des rattachements actifs.');
    return res.ok ? (res.data || []) : [];
  }
  async function loadCodes(orgId) {
    const res = await sbFetch('team_invite_codes?club_id=eq.' + orgId + '&select=*&order=created_at.desc');
    if (!res.ok) toast('Erreur de chargement des codes équipe.');
    return res.ok ? (res.data || []) : [];
  }
  async function loadCatalog() {
    const res = await sbFetch('catalogue_offres?actif=eq.true&select=id,nom,description,tarif_type,prix_ht&order=ordre.asc');
    return res.ok ? (res.data || []) : [];
  }

  /* ── Gabarits de ligne / carte, partagés entre les deux modules ── */
  function reqRowHtml(r) {
    const teamName = (r.club_teams && r.club_teams.name) || '—';
    const sm = reqStatusMeta(r.statut);
    const name = fullName(r.player_profiles);
    const canAccept = REQ_STATUSES.indexOf(r.statut) !== -1 && ['a_verifier', 'pret_a_valider'].indexOf(r.statut) !== -1
      && !(r.validation_mode === 'double' && !r.educateur_confirme_at);
    const canConfirmEducateur = r.validation_mode === 'double' && !r.educateur_confirme_at && ['a_verifier', 'pret_a_valider'].indexOf(r.statut) !== -1;
    const canReject = ['validee', 'refusee'].indexOf(r.statut) === -1;
    return `<div class="cm-row" style="cursor:default;flex-wrap:wrap;gap:8px">
      <div>
        <div class="t">${esc(name)}</div>
        <div class="m">${esc(teamName)} · ${esc(r.source || '—')} · ${fmtDate(r.created_at)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
        ${canConfirmEducateur ? `<button class="btn btn-ghost" data-action="confirm-educateur" data-id="${r.id}">Confirmer</button>` : ''}
        ${canAccept ? `<button class="btn btn-primary" data-action="accept-request" data-id="${r.id}">Accepter</button>` : ''}
        ${canReject ? `<button class="btn btn-ghost" style="color:var(--danger)" data-action="open-reject" data-id="${r.id}">Refuser</button>` : ''}
      </div>
    </div>`;
  }
  function playerRowHtml(p) {
    const asMeta = accountStatusMeta(p.account_status);
    return `<div class="cm-row" style="cursor:default">
      <div><div class="t">${esc(fullName(p))}</div><div class="m">${fmtDate(p.date_naissance)}</div></div>
      <span class="badge" style="background:${asMeta.color}22;color:${asMeta.color}">${esc(asMeta.label)}</span>
    </div>`;
  }
  function parentRowHtml(pp) {
    const rels = (pp.parent_player_relationships || []).filter(function (r) { return r.player_profiles; });
    const children = rels.map(function (r) { return fullName(r.player_profiles); }).join(', ') || '—';
    return `<div class="cm-row" style="cursor:default">
      <div><div class="t">${esc(fullName(pp))}</div><div class="m">Enfant(s) : ${esc(children)}</div></div>
    </div>`;
  }
  function authRowHtml(a, isAdmin) {
    const type = (a.authorization_types && a.authorization_types.label) || '—';
    const asMeta = authStatusMeta(a.statut);
    const canVerify = isAdmin && a.statut === 'a_verifier';
    return `<div class="cm-row" style="cursor:default;flex-wrap:wrap;gap:8px">
      <div><div class="t">${esc(fullName(a.player_profiles))} — ${esc(type)}</div><div class="m">${esc(a.methode || '—')}</div></div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge" style="background:${asMeta.color}22;color:${asMeta.color}">${esc(asMeta.label)}</span>
        ${canVerify ? `<button class="btn btn-primary" data-action="verify-auth" data-id="${a.id}" data-decision="valide">Valider</button><button class="btn btn-ghost" style="color:var(--danger)" data-action="verify-auth" data-id="${a.id}" data-decision="refusee">Refuser</button>` : ''}
      </div>
    </div>`;
  }
  function reportRowHtml(r) {
    const player = r.player_profiles || {};
    const sm = reportStatusMeta(r.statut);
    return `<div class="cm-row" style="cursor:default;flex-wrap:wrap;gap:8px">
      <div>
        <div class="t">${esc(REPORT_MOTIF_LABEL[r.motif] || r.motif)}</div>
        <div class="m">${player.prenom ? esc(fullName(player)) + ' · ' : ''}${fmtDate(r.created_at)}</div>
        ${r.message ? `<div class="m" style="margin-top:4px">${esc(r.message)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
        <select data-action-change="report-status" data-id="${r.id}" style="width:auto;padding:5px 8px;font-size:12px">
          ${REPORT_STATUSES.map(function (st) { return '<option value="' + st + '" ' + (st === r.statut ? 'selected' : '') + '>' + esc(reportStatusMeta(st).label) + '</option>'; }).join('')}
        </select>
      </div>
    </div>`;
  }
  function projectAdminCardHtml(p) {
    const sm = projectStatusMeta(p.statut);
    const pct = p.montant_cible > 0 ? Math.min(100, Math.round((p.montant_collecte / p.montant_cible) * 100)) : 0;
    return `<div class="cm-card" style="cursor:default;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px">
        <div><b style="font-size:14px">${esc(p.titre)}</b><div class="m">${esc((p.club_teams && p.club_teams.name) || '')}${p.catalogue_offres ? ' · ' + esc(p.catalogue_offres.nom) : ''}</div></div>
        <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
      </div>
      <div class="cmf-progress"><i style="width:${pct}%"></i></div>
      <div class="m" style="margin-bottom:10px">${p.montant_collecte} € / ${p.montant_cible} €</div>
      <select data-action-change="project-status" data-id="${p.id}" style="width:auto;padding:5px 8px;font-size:12px">
        ${PROJECT_STATUSES.map(function (st) { return '<option value="' + st + '" ' + (st === p.statut ? 'selected' : '') + '>' + esc(projectStatusMeta(st).label) + '</option>'; }).join('')}
      </select>
    </div>`;
  }
  function renewalRowHtml(m, teams) {
    const teamName = (m.club_teams && m.club_teams.name) || '';
    return `<div class="cm-row" style="cursor:default;flex-wrap:wrap;gap:8px">
      <div><div class="t">${esc(fullName(m.player_profiles))}</div><div class="m">${esc(teamName)} · Saison ${esc(m.saison)}</div></div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <select data-field="ren-action-${m.id}" data-action-change="renewal-toggle" data-id="${m.id}" style="width:auto;padding:5px 8px;font-size:12px">
          <option value="renouvele">Renouveler</option>
          <option value="deplace">Déplacer</option>
          <option value="mis_en_attente">Mettre en attente</option>
          <option value="archive">Archiver</option>
          <option value="quitte_club">A quitté le club</option>
        </select>
        <select data-field="ren-team-${m.id}" style="width:auto;padding:5px 8px;font-size:12px;display:none">
          ${(teams || []).map(function (t) { return '<option value="' + t.id + '" ' + (t.id === m.team_id ? 'selected' : '') + '>' + esc(t.name) + '</option>'; }).join('')}
        </select>
        <button class="btn btn-primary" data-action="apply-renewal" data-id="${m.id}">Appliquer</button>
      </div>
    </div>`;
  }
  function codesGridHtml(teams, codes) {
    const list = (teams || []).map(function (t) {
      const code = (codes || []).find(function (c) { return c.team_id === t.id && c.actif; });
      return `<div class="cm-card" style="cursor:default">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:13.5px">${esc(t.name)}</b>${code ? '<span class="badge" style="background:var(--ok)22;color:var(--ok)">Actif</span>' : ''}</div>
        ${code
          ? `<div style="font-family:monospace;font-size:16px;font-weight:700;margin-bottom:10px">${esc(code.code)}</div>
             <div style="display:flex;gap:8px;flex-wrap:wrap">
               <button class="btn btn-ghost" data-action="rotate-code" data-id="${code.id}">Renouveler</button>
               <button class="btn btn-ghost" data-action="toggle-code" data-id="${code.id}">Désactiver</button>
             </div>`
          : `<div class="m" style="margin-bottom:10px">Aucun code actif.</div><button class="btn btn-primary" data-action="create-code" data-team="${t.id}">Générer un code</button>`}
      </div>`;
    }).join('');
    return `<div class="cm-grid">${list || '<div class="cm-empty">Aucune équipe pour le moment.</div>'}</div>`;
  }
  function rejectModalHtml(rejectId) {
    if (!rejectId) return '';
    return `<div class="cm-overlay" data-action="overlay-reject">
      <div class="cm-modal">
        <div class="cm-drawer-head"><b>Refuser la demande</b><button class="cm-close" data-action="close-reject">✕</button></div>
        <div class="cm-field"><label>Motif (optionnel)</label><textarea rows="3" data-field="reject-motif"></textarea></div>
        <button class="btn btn-ghost" style="color:var(--danger)" data-action="submit-reject">Confirmer le refus</button>
      </div>
    </div>`;
  }
  function inviteModalHtml(invite, teams) {
    if (!invite) return '';
    const isJoueur = invite.target_type === 'joueur';
    return `<div class="cm-overlay" data-action="overlay-invite">
      <div class="cm-modal">
        <div class="cm-drawer-head"><b>Inviter un ${isJoueur ? 'joueur' : 'parent'}</b><button class="cm-close" data-action="close-invite">✕</button></div>
        <div class="cm-row2">
          <div class="cm-field"><label>Prénom</label><input type="text" data-field="iv-prenom" value="${esc(invite.prenom)}"></div>
          <div class="cm-field"><label>Nom</label><input type="text" data-field="iv-nom" value="${esc(invite.nom)}"></div>
        </div>
        <div class="cm-field"><label>E-mail</label><input type="email" data-field="iv-email" value="${esc(invite.email)}"></div>
        ${isJoueur ? `<div class="cm-row2">
          <div class="cm-field"><label>Équipe</label><select data-field="iv-team">${(teams || []).map(function (t) { return '<option value="' + t.id + '" ' + (t.id === invite.team_id ? 'selected' : '') + '>' + esc(t.name) + '</option>'; }).join('')}</select></div>
          <div class="cm-field"><label>Date de naissance</label><input type="date" data-field="iv-dob" value="${esc(invite.date_naissance)}"></div>
        </div>` : ''}
        <button class="btn btn-primary" data-action="submit-invite">Envoyer l'invitation</button>
      </div>
    </div>`;
  }
  function createProjectModalHtml(open, teams, catalog) {
    if (!open) return '';
    return `<div class="cm-overlay" data-action="overlay-create-project">
      <div class="cm-modal wide">
        <div class="cm-drawer-head"><b>Nouveau projet d'équipe</b><button class="cm-close" data-action="close-create-project">✕</button></div>
        <div class="cm-field"><label>Titre</label><input type="text" data-field="cp-titre"></div>
        <div class="cm-row2">
          <div class="cm-field"><label>Équipe</label><select data-field="cp-team">${(teams || []).map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('')}</select></div>
          <div class="cm-field"><label>Prestation</label><select data-field="cp-offre">${(catalog || []).map(function (o) { return '<option value="' + o.id + '">' + esc(o.nom) + '</option>'; }).join('')}</select></div>
        </div>
        <div class="cm-field"><label>Objectif (description)</label><textarea rows="2" data-field="cp-objectif"></textarea></div>
        <div class="cm-row2">
          <div class="cm-field"><label>Montant cible (€)</label><input type="number" min="1" step="1" data-field="cp-montant"></div>
          <div class="cm-field"><label>Contribution minimum (€, optionnel)</label><input type="number" min="1" step="1" data-field="cp-min"></div>
        </div>
        <div class="cm-row2">
          <div class="cm-field"><label>Date de l'événement</label><input type="date" data-field="cp-date-evt"></div>
          <div class="cm-field"><label>Date limite</label><input type="date" data-field="cp-date-limite"></div>
        </div>
        <div class="cm-field"><label>Conditions si objectif non atteint (optionnel)</label><textarea rows="2" data-field="cp-conditions"></textarea></div>
        <button class="btn btn-primary" data-action="submit-create-project">Créer et soumettre au club</button>
      </div>
    </div>`;
  }

  window.ClubModules = window.ClubModules || {};

  /* ============================================================
   * 1. DEMANDES JOUEURS & FAMILLES
   * Vue simplifiée (fidèle à tplFamillesDemandes) : la file d'attente de
   * validation d'adhésion filtrée par statut, pour un dirigeant/éducateur
   * qui n'a besoin que de ça au quotidien (contrairement à l'onglet
   * "Demandes" de la page admin complète, module n°2 ci-dessous, mais qui
   * réutilise exactement le même data layer/gabarit de ligne).
   * ============================================================ */
  window.ClubModules.demandesJoueursFamilles = {
    label: 'Demandes Joueurs & Familles',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      ensureExtraStyles();

      let requests = [];
      let loaded = false;
      let filter = 'toutes';
      let rejectId = null;

      async function load() {
        requests = await loadRequests(orgId);
        loaded = true;
      }

      function paint() {
        let listHtml;
        if (!loaded) {
          listHtml = '<div class="cm-empty">Chargement…</div>';
        } else {
          const list = requests.filter(function (r) { return filter === 'toutes' || r.statut === filter; });
          listHtml = list.length ? ('<div class="cm-list">' + list.map(reqRowHtml).join('') + '</div>') : '<div class="cm-empty">Aucune demande pour vos équipes.</div>';
        }
        container.innerHTML = `<div class="cm-wrap">
          <div class="cm-toolbar"><h2>Demandes Joueurs & Familles</h2></div>
          <div class="cm-pillbar">${['toutes'].concat(REQ_STATUSES).map(function (st) {
            return '<button class="cm-pill' + (filter === st ? ' on' : '') + '" data-action="filter" data-status="' + st + '">' + (st === 'toutes' ? 'Toutes' : esc(reqStatusMeta(st).label)) + '</button>';
          }).join('')}</div>
          ${listHtml}
          ${rejectModalHtml(rejectId)}
        </div>`;
        bind();
      }

      async function acceptRequest(id) {
        const res = await sbRpc('validate_team_membership', { p_request_id: id });
        if (!res.ok) { toast((res.data && res.data.message) || 'Impossible de valider — vérifiez les autorisations parentales.'); }
        else toast('Demande validée — accès ouvert.');
        requests = await loadRequests(orgId);
        paint();
      }
      async function confirmEducateur(id) {
        const res = await sbRpc('confirm_request_educateur', { p_request_id: id });
        if (!res.ok) { toast('Action impossible.'); return; }
        toast('Confirmé — en attente de validation par un administrateur.');
        requests = await loadRequests(orgId);
        paint();
      }
      async function submitReject() {
        const motifEl = container.querySelector('[data-field="reject-motif"]');
        const motif = motifEl ? motifEl.value.trim() : '';
        const res = await sbRpc('reject_team_membership', { p_request_id: rejectId, p_motif: motif || null });
        if (!res.ok) { toast('Action impossible.'); return; }
        rejectId = null;
        toast('Demande refusée.');
        requests = await loadRequests(orgId);
        paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay-reject"]');
          if (overlay && e.target === overlay) { rejectId = null; paint(); return; }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'filter') { filter = btn.getAttribute('data-status'); paint(); }
          else if (action === 'accept-request') { await acceptRequest(btn.getAttribute('data-id')); }
          else if (action === 'confirm-educateur') { await confirmEducateur(btn.getAttribute('data-id')); }
          else if (action === 'open-reject') { rejectId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close-reject') { rejectId = null; paint(); }
          else if (action === 'submit-reject') { await submitReject(); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 2. JOUEURS & FAMILLES
   * Page admin complète (fidèle à tplJoueursFamilles) : 10 sous-onglets —
   * Vue d'ensemble, Demandes, Joueurs, Parents, Invitations,
   * Autorisations, Signalements, Projets d'équipe, Nouvelle saison,
   * Codes équipe. ctx.role distingue admin (toutes actions, cf. RLS
   * is_club_admin) d'éducateur (limité à ses équipes côté serveur, cf.
   * is_team_educateur) — mais ce fichier ne fait JAMAIS lui-même le tri
   * des données par équipe : il pose exactement la même requête pour
   * tous les rôles et laisse la RLS serveur restreindre les lignes
   * retournées (même philosophie que famille-espace.js, cf. en-tête).
   * ============================================================ */
  window.ClubModules.joueursFamilles = {
    label: 'Joueurs & Familles',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      ensureExtraStyles();

      const isAdmin = !!(ctx && ctx.role === 'admin');
      const TABS = [
        ['overview', 'Vue d’ensemble'], ['demandes', 'Demandes'], ['joueurs', 'Joueurs'],
        ['parents', 'Parents'], ['invitations', 'Invitations'], ['autorisations', 'Autorisations'],
        ['signalements', 'Signalements'], ['projets', 'Projets d’équipe'], ['saison', 'Nouvelle saison'],
        ['codes', 'Codes équipe']
      ];

      let tab = 'overview';
      let teams = null;
      let requests = null, players = null, parents = null, invitations = null;
      let authorizations = null, reports = null, projects = null, activeMemberships = null, codes = null, catalog = null;
      let reqFilter = 'toutes';
      let newSaison = '';
      let rejectId = null;
      let invite = null; // {target_type, prenom, nom, email, team_id, date_naissance}
      let createProjectOpen = false;

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value.trim() : '';
      }

      const AUTH_TAB_NOTE = `<div class="cm-info">Seul un administrateur du club voit le détail des autorisations parentales. Un éducateur n'y a pas accès : aucune vue filtrée sécurisée n'existe encore côté serveur pour ce rôle (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md §5 — la vue prévue "authorization_status_for_coach" n'a jamais été créée, et aucune policy RLS n'accorde d'accès éducateur à cette table).</div>`;

      function tabContentHtml() {
        if (tab === 'overview') {
          if (requests === null || players === null) return '<div class="cm-empty">Chargement…</div>';
          const pending = requests.filter(function (r) { return ['validee', 'refusee'].indexOf(r.statut) === -1; });
          const missingAuth = requests.filter(function (r) { return r.statut === 'autorisation_manquante'; });
          const suspended = players.filter(function (p) { return p.account_status === 'suspendu'; });
          return `<div class="cmf-stats">
            <div class="cmf-stat"><b>${players.length}</b><span>Joueurs suivis</span></div>
            <div class="cmf-stat"><b>${pending.length}</b><span>Demandes en attente</span></div>
            <div class="cmf-stat"><b>${missingAuth.length}</b><span>Autorisations manquantes</span></div>
            <div class="cmf-stat"><b>${suspended.length}</b><span>Comptes suspendus</span></div>
          </div>
          <div class="cm-card" style="cursor:default">
            <div style="font-weight:700;font-size:15px;margin-bottom:12px">Demandes récentes</div>
            ${pending.length ? pending.slice(0, 5).map(reqRowHtml).join('') : '<div class="m">Aucune demande en attente.</div>'}
          </div>`;
        }
        if (tab === 'demandes') {
          if (requests === null) return '<div class="cm-empty">Chargement…</div>';
          const list = requests.filter(function (r) { return reqFilter === 'toutes' || r.statut === reqFilter; });
          return `<div class="cm-pillbar">${['toutes'].concat(REQ_STATUSES).map(function (st) {
            return '<button class="cm-pill' + (reqFilter === st ? ' on' : '') + '" data-action="req-filter" data-status="' + st + '">' + (st === 'toutes' ? 'Toutes' : esc(reqStatusMeta(st).label)) + '</button>';
          }).join('')}</div>
          <div class="cm-list">${list.length ? list.map(reqRowHtml).join('') : '<div class="cm-empty">Aucune demande dans ce statut.</div>'}</div>`;
        }
        if (tab === 'joueurs') {
          if (players === null) return '<div class="cm-empty">Chargement…</div>';
          return '<div class="cm-list">' + (players.length ? players.map(playerRowHtml).join('') : '<div class="cm-empty">Aucun joueur pour le moment.</div>') + '</div>';
        }
        if (tab === 'parents') {
          if (parents === null) return '<div class="cm-empty">Chargement…</div>';
          return '<div class="cm-list">' + (parents.length ? parents.map(parentRowHtml).join('') : '<div class="cm-empty">Aucun parent pour le moment.</div>') + '</div>';
        }
        if (tab === 'invitations') {
          if (invitations === null) return '<div class="cm-empty">Chargement…</div>';
          const j = invitations.joueurs || [], p = invitations.parents || [];
          const invRow = function (i) {
            return '<div class="cm-row" style="cursor:default"><div><div class="t">' + esc(fullName(i)) + '</div><div class="m">' + esc(i.email) + '</div></div><span class="badge" style="background:#e2a03f22;color:#e2a03f">Envoyée</span></div>';
          };
          return `<div class="cmf-section-title">Joueurs</div>
            <div class="cm-list" style="margin-bottom:20px">${j.length ? j.map(invRow).join('') : '<div class="cm-empty">Aucune invitation joueur en attente.</div>'}</div>
            <div class="cmf-section-title">Parents</div>
            <div class="cm-list">${p.length ? p.map(invRow).join('') : '<div class="cm-empty">Aucune invitation parent en attente.</div>'}</div>`;
        }
        if (tab === 'autorisations') {
          if (authorizations === null) return AUTH_TAB_NOTE + '<div class="cm-empty">Chargement…</div>';
          const relevant = authorizations.filter(function (a) { return a.statut !== 'non_transmise'; });
          return AUTH_TAB_NOTE + '<div class="cm-list">' + (relevant.length ? relevant.map(function (a) { return authRowHtml(a, isAdmin); }).join('') : '<div class="cm-empty">Aucune autorisation transmise pour le moment.</div>') + '</div>';
        }
        if (tab === 'signalements') {
          if (reports === null) return '<div class="cm-empty">Chargement…</div>';
          return '<div class="cm-list">' + (reports.length ? reports.map(reportRowHtml).join('') : '<div class="cm-empty">Aucun signalement pour le moment.</div>') + '</div>';
        }
        if (tab === 'projets') {
          if (projects === null) return '<div class="cm-empty">Chargement…</div>';
          return projects.length ? projects.map(projectAdminCardHtml).join('') : '<div class="cm-empty">Aucun projet d’équipe pour le moment.</div>';
        }
        if (tab === 'saison') {
          if (activeMemberships === null) return '<div class="cm-empty">Chargement…</div>';
          return `<div class="cm-card" style="margin-bottom:16px;cursor:default">
            <div class="cm-field"><label>Nouvelle saison</label><input type="text" data-field="new-saison" data-action-change="set-new-saison" placeholder="ex : 2027-2028" value="${esc(newSaison)}"></div>
            <div class="m">Saisissez la saison de destination puis traitez chaque joueur ci-dessous.</div>
          </div>
          <div class="cm-list">${activeMemberships.length ? activeMemberships.map(function (m) { return renewalRowHtml(m, teams || []); }).join('') : '<div class="cm-empty">Aucun joueur actif à traiter pour le moment.</div>'}</div>`;
        }
        // codes
        if (codes === null || teams === null) return '<div class="cm-empty">Chargement…</div>';
        return codesGridHtml(teams, codes);
      }

      function headerActionsHtml() {
        if (tab === 'projets') return `<button class="btn btn-primary" data-action="open-create-project">+ Nouveau projet</button>`;
        return `<button class="btn btn-ghost" data-action="open-invite" data-target="parent">+ Inviter un parent</button><button class="btn btn-primary" data-action="open-invite" data-target="joueur">+ Inviter un joueur</button>`;
      }

      function paint() {
        container.innerHTML = `<div class="cm-wrap">
          <div class="cm-toolbar"><h2>Joueurs & Familles</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${headerActionsHtml()}</div></div>
          <div class="cm-pillbar">${TABS.map(function (t) { return '<button class="cm-pill' + (tab === t[0] ? ' on' : '') + '" data-action="tab" data-key="' + t[0] + '">' + esc(t[1]) + '</button>'; }).join('')}</div>
          ${tabContentHtml()}
          ${rejectModalHtml(rejectId)}
          ${inviteModalHtml(invite, teams || [])}
          ${createProjectModalHtml(createProjectOpen, teams || [], catalog || [])}
        </div>`;
        bind();
      }

      async function openTab(key) {
        tab = key;
        paint();
        if (key === 'overview') {
          if (requests === null) requests = await loadRequests(orgId);
          if (players === null) players = await loadPlayers(orgId);
          paint();
        } else if (key === 'demandes' && requests === null) {
          requests = await loadRequests(orgId); paint();
        } else if (key === 'joueurs' && players === null) {
          players = await loadPlayers(orgId); paint();
        } else if (key === 'parents' && parents === null) {
          parents = await loadParents(); paint();
        } else if (key === 'invitations' && invitations === null) {
          invitations = await loadInvitations(orgId); paint();
        } else if (key === 'autorisations' && authorizations === null) {
          authorizations = await loadAuthorizations(); paint();
        } else if (key === 'signalements' && reports === null) {
          reports = await loadReports(orgId); paint();
        } else if (key === 'projets' && projects === null) {
          projects = await loadProjects(orgId); paint();
        } else if (key === 'saison' && activeMemberships === null) {
          activeMemberships = await loadActiveMemberships(orgId); paint();
        } else if (key === 'codes' && codes === null) {
          codes = await loadCodes(orgId); paint();
        }
      }

      async function acceptRequest(id) {
        const res = await sbRpc('validate_team_membership', { p_request_id: id });
        if (!res.ok) toast((res.data && res.data.message) || 'Impossible de valider — vérifiez les autorisations parentales.');
        else toast('Demande validée — accès ouvert.');
        requests = await loadRequests(orgId);
        paint();
      }
      async function confirmEducateur(id) {
        const res = await sbRpc('confirm_request_educateur', { p_request_id: id });
        if (!res.ok) { toast('Action impossible.'); return; }
        toast('Confirmé — en attente de validation par un administrateur.');
        requests = await loadRequests(orgId);
        paint();
      }
      async function submitReject() {
        const motifEl = container.querySelector('[data-field="reject-motif"]');
        const motif = motifEl ? motifEl.value.trim() : '';
        const res = await sbRpc('reject_team_membership', { p_request_id: rejectId, p_motif: motif || null });
        if (!res.ok) { toast('Action impossible.'); return; }
        rejectId = null;
        toast('Demande refusée.');
        requests = await loadRequests(orgId);
        paint();
      }
      async function verifyAuth(id, decision) {
        const res = await sbRpc('verify_parental_authorization', { p_authorization_id: id, p_decision: decision });
        if (!res.ok) { toast('Action impossible (droits administrateur requis).'); return; }
        toast(decision === 'valide' ? 'Autorisation validée.' : 'Autorisation refusée.');
        authorizations = await loadAuthorizations();
        requests = null; // recompute_request_readiness côté serveur peut avoir changé des statuts de demande
        if (tab === 'demandes' || tab === 'overview') requests = await loadRequests(orgId);
        paint();
      }
      async function changeReportStatus(id, statut) {
        const res = await sbFetch('media_reports?id=eq.' + id, { method: 'PATCH', body: { statut: statut } });
        if (!res.ok) { toast('Action impossible (droits administrateur requis).'); return; }
        toast('Statut mis à jour.');
        reports = await loadReports(orgId);
        paint();
      }
      async function changeProjectStatus(id, statut) {
        const res = await sbFetch('team_projects?id=eq.' + id, { method: 'PATCH', body: { statut: statut } });
        if (!res.ok) { toast('Action impossible (droits requis).'); return; }
        toast('Statut mis à jour.');
        projects = await loadProjects(orgId);
        paint();
      }
      async function applyRenewal(membershipId) {
        const actionSel = container.querySelector('[data-field="ren-action-' + membershipId + '"]');
        const action = actionSel ? actionSel.value : null;
        const needsSaison = action === 'renouvele' || action === 'deplace';
        if (needsSaison && !newSaison) { toast('Indiquez la nouvelle saison (ex : 2027-2028).'); return; }
        const teamSel = container.querySelector('[data-field="ren-team-' + membershipId + '"]');
        const newTeamId = action === 'deplace' ? (teamSel ? teamSel.value : null) : null;
        const res = await sbRpc('renew_season_membership', { p_membership_id: membershipId, p_action: action, p_new_team_id: newTeamId, p_to_saison: needsSaison ? newSaison : null });
        if (!res.ok) { toast((res.data && res.data.message) || 'Action impossible.'); return; }
        toast('Traité.');
        activeMemberships = await loadActiveMemberships(orgId);
        paint();
      }
      async function createCode(teamId) {
        const res = await sbRpc('create_team_invite_code', { p_team_id: teamId });
        if (!res.ok) { toast('Action impossible (droits requis).'); return; }
        toast('Code généré.');
        codes = await loadCodes(orgId);
        paint();
      }
      async function rotateCode(codeId) {
        const res = await sbRpc('rotate_team_invite_code', { p_code_id: codeId });
        if (!res.ok) { toast('Action impossible.'); return; }
        toast('Code renouvelé.');
        codes = await loadCodes(orgId);
        paint();
      }
      async function toggleCode(codeId) {
        // Désactivation d'un code d'invitation (booléen actif) : policy RLS
        // dédiée tic_manager_update (is_team_educateur OU is_club_admin),
        // pas une policy UPDATE ouverte, et pas une donnée de mineur — cf.
        // note de sécurité en en-tête. Fidèle à famToggleCode de Club+.
        const res = await sbFetch('team_invite_codes?id=eq.' + codeId, { method: 'PATCH', body: { actif: false } });
        if (!res.ok) { toast('Action impossible.'); return; }
        toast('Code désactivé.');
        codes = await loadCodes(orgId);
        paint();
      }
      async function submitInvite() {
        invite.prenom = fieldVal('iv-prenom');
        invite.nom = fieldVal('iv-nom');
        invite.email = fieldVal('iv-email');
        if (invite.target_type === 'joueur') {
          invite.team_id = fieldVal('iv-team');
          invite.date_naissance = fieldVal('iv-dob');
        }
        if (!invite.email || !invite.prenom) { toast("Le prénom et l'e-mail sont obligatoires."); return; }
        if (invite.target_type === 'joueur' && (!invite.team_id || !invite.date_naissance)) { toast('Équipe et date de naissance sont obligatoires pour un joueur.'); return; }
        const res = await sbFunction('clubplus-family-invite', {
          target_type: invite.target_type, email: invite.email, prenom: invite.prenom, nom: invite.nom, club_id: orgId,
          team_id: invite.target_type === 'joueur' ? invite.team_id : null,
          date_naissance: invite.target_type === 'joueur' ? invite.date_naissance : null
        });
        if (!res.ok) { toast((res.data && res.data.error) || "Erreur lors de l'envoi de l'invitation."); return; }
        const email = invite.email;
        const alreadyInvited = res.data && res.data.already_invited;
        invite = null;
        toast(alreadyInvited ? (email + ' a déjà une invitation en attente.') : ('Invitation envoyée à ' + email + '.'));
        invitations = null;
        if (tab === 'invitations') { invitations = await loadInvitations(orgId); }
        paint();
      }
      async function submitCreateProject() {
        const titre = fieldVal('cp-titre');
        const montant = Number(fieldVal('cp-montant'));
        if (!titre || !montant || montant <= 0) { toast('Titre et montant cible sont obligatoires.'); return; }
        const offreId = fieldVal('cp-offre');
        if (!offreId) { toast('Choisissez une prestation.'); return; }
        const teamId = fieldVal('cp-team');
        if (!teamId) { toast('Ajoutez au moins une équipe avant de créer un projet.'); return; }
        const uid = localStorage.getItem('svc_uid') || null;
        const body = {
          club_id: orgId, team_id: teamId, catalogue_offre_id: offreId, titre: titre,
          objectif: fieldVal('cp-objectif') || null,
          montant_cible: montant,
          contribution_min: Number(fieldVal('cp-min')) || null,
          date_evenement: fieldVal('cp-date-evt') || null,
          date_limite: fieldVal('cp-date-limite') || null,
          conditions_non_atteint: fieldVal('cp-conditions') || null,
          responsable_id: uid, created_by: uid, statut: 'attente_validation_club'
        };
        const res = await sbFetch('team_projects', { method: 'POST', body: body });
        if (!res.ok) { toast("Erreur lors de la création (droits d'éducateur ou d'administrateur requis)."); return; }
        createProjectOpen = false;
        toast('Projet créé et soumis au club pour validation.');
        projects = await loadProjects(orgId);
        paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action^="overlay-"]');
          if (overlay && e.target === overlay) {
            const a = overlay.getAttribute('data-action');
            if (a === 'overlay-reject') rejectId = null;
            else if (a === 'overlay-invite') invite = null;
            else if (a === 'overlay-create-project') createProjectOpen = false;
            paint(); return;
          }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'tab') { await openTab(btn.getAttribute('data-key')); }
          else if (action === 'req-filter') { reqFilter = btn.getAttribute('data-status'); paint(); }
          else if (action === 'accept-request') { await acceptRequest(btn.getAttribute('data-id')); }
          else if (action === 'confirm-educateur') { await confirmEducateur(btn.getAttribute('data-id')); }
          else if (action === 'open-reject') { rejectId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close-reject') { rejectId = null; paint(); }
          else if (action === 'submit-reject') { await submitReject(); }
          else if (action === 'verify-auth') { await verifyAuth(btn.getAttribute('data-id'), btn.getAttribute('data-decision')); }
          else if (action === 'apply-renewal') { await applyRenewal(btn.getAttribute('data-id')); }
          else if (action === 'create-code') { await createCode(btn.getAttribute('data-team')); }
          else if (action === 'rotate-code') { await rotateCode(btn.getAttribute('data-id')); }
          else if (action === 'toggle-code') { await toggleCode(btn.getAttribute('data-id')); }
          else if (action === 'open-invite') {
            const target = btn.getAttribute('data-target');
            const firstTeam = (teams || [])[0];
            invite = { target_type: target, prenom: '', nom: '', email: '', team_id: firstTeam ? firstTeam.id : '', date_naissance: '' };
            if (teams === null) { teams = await loadTeams(orgId); invite.team_id = (teams[0] || {}).id || ''; }
            paint();
          }
          else if (action === 'close-invite') { invite = null; paint(); }
          else if (action === 'submit-invite') { await submitInvite(); }
          else if (action === 'open-create-project') {
            if (teams === null) teams = await loadTeams(orgId);
            if (catalog === null) catalog = await loadCatalog();
            if (!teams.length) { toast('Ajoutez au moins une équipe avant de créer un projet.'); return; }
            createProjectOpen = true;
            paint();
          }
          else if (action === 'close-create-project') { createProjectOpen = false; paint(); }
          else if (action === 'submit-create-project') { await submitCreateProject(); }
        };
        container.onchange = async function (e) {
          const el = e.target;
          const action = el.getAttribute('data-action-change');
          if (!action) return;
          const id = el.getAttribute('data-id');
          if (action === 'report-status') { await changeReportStatus(id, el.value); }
          else if (action === 'project-status') { await changeProjectStatus(id, el.value); }
          else if (action === 'set-new-saison') { newSaison = el.value; }
          else if (action === 'renewal-toggle') {
            const teamSel = container.querySelector('[data-field="ren-team-' + id + '"]');
            if (teamSel) teamSel.style.display = el.value === 'deplace' ? '' : 'none';
          }
        };
      }

      teams = await loadTeams(orgId);
      await openTab('overview');
    }
  };
})();
