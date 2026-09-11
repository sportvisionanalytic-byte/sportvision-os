-- ============================================================================================
-- migration-club-donnees-restreintes-1-lectures.sql
-- Décisions de Fouka du 11/09/2026 : trois restrictions de lecture dans les clubs (Club+).
-- ============================================================================================
--
-- LES DÉCISIONS (appliquées telles quelles, rien de plus) :
--   1. Identifiants Stripe du club (clubs.stripe_customer_id, clubs.stripe_subscription_id) :
--      l'Owner Club+ (club_members.role = 'admin'), le Président, et le staff SportVision qui en a
--      l'usage (Admin SportVision, Compta). SIRET (clubs.siret, seul identifiant légal porté par
--      `clubs`) : les mêmes, plus la Secrétaire et le Trésorier. Le CM SportVision ne voit PAS le
--      SIRET. Connu depuis le 21/08 (INC-046) : tout membre actif les lisait.
--   2. Coordonnées de l'annuaire du club (club_members.telephone, seule coordonnée de la table ;
--      l'e-mail d'une invitation d'encadrant renvoyé par equipe_apercu) : Owner Club+, Président,
--      CM SportVision du club, Secrétaire, Trésorier, staff SportVision de l'OS. Chacun lit
--      toujours sa propre fiche. Les noms et rôles restent lisibles.
--   3. Sponsors (club_sponsors, montants compris) : Owner Club+, Président, CM SportVision du
--      club, Secrétaire, Trésorier, Responsable sponsors (sponsor_mgr), staff SportVision de l'OS.
--
-- POURQUOI DEUX MIGRATIONS. La RLS de PostgreSQL filtre des LIGNES, pas des colonnes : fermer une
-- colonne à un rôle sans la fermer à un autre demande de retirer le droit de colonne à
-- `authenticated` (migration 2) et de faire passer les lecteurs autorisés par une fonction qui
-- décide personne par personne (celle-ci). Or, dès que le droit de colonne est retiré, toute
-- requête qui demande `*` ou cette colonne échoue ENTIÈREMENT (42501) : la version de Club+
-- actuellement en ligne lit `clubs.siret` en construisant la session de CHAQUE membre, et
-- tomberait pour tout le monde. D'où l'ordre, sans fenêtre de panne :
--
--     1) CETTE migration — purement additive pour les écrans en ligne : nouvelles fonctions de
--        lecture, masques dans les fonctions qui renvoyaient ces données, sponsors restreints ;
--     2) déploiement de Club+ (app-next) et de l'OS, qui lisent désormais par ces fonctions ;
--     3) migration-club-donnees-restreintes-2-colonnes.sql, qui retire les droits de colonne.
--
-- CE QUE FAIT CETTE MIGRATION.
--   A. Quatre fonctions d'autorisation, une par décision (les sponsors et l'annuaire ont la même
--      liste de rôles club à une personne près, mais ce sont deux décisions distinctes : les
--      fusionner ferait bouger l'une avec l'autre). « CM SportVision du club » = peut_operer_club,
--      l'autorité établie le 10/09 pour « opérer un club » (affectation, délégation d'agence, CM
--      responsable) ; elle inclut aussi l'Owner Club+ et le Président.
--   B. club_donnees_restreintes(club) : SIRET et identifiants Stripe, chacun masqué selon A.
--   C. club_membres_coordonnees(club) : le téléphone des membres, masqué selon A, sauf sa propre
--      fiche.
--   D. clubs_safe (vue de la v102, sans lecteur dans le code) : ses colonnes SIRET/Stripe passent
--      par B. Sinon elle exposait le SIRET à tout membre, puis échouerait après la migration 2.
--   E. find_duplicate_club_candidates : exécutable par tout compte (v122), elle rendait le SIRET
--      d'un club dont on connaît le nom. Le SIRET est désormais masqué selon A ; la détection de
--      doublons (OS, clubplus-activate en clé de service) n'en lit pas la valeur.
--   F. equipe_apercu : le coach d'une équipe y lisait l'e-mail des encadrants INVITÉS sur son
--      équipe. L'e-mail est masqué selon A ; le nom et le statut de l'invitation restent.
--   G. club_sponsors : la lecture « tout membre du club » (csp_member_select) devient la liste de
--      la décision 3. sponsor_operations suit explicitement la même règle, et reçoit la policy
--      restrictive de périmètre CM que club_sponsors avait déjà.
--
-- CE QUI N'EST PAS TOUCHÉ, ET POURQUOI.
--   - Écritures : aucune règle d'écriture ne change (sponsors, fiche du club, SIRET).
--   - csp_sponsor_org_select : l'organisation SPONSOR lit sa propre ligne de partenariat (espace
--     sponsor de Club+). Ce n'est pas un rôle du club mais la contrepartie du contrat.
--   - csp_staff_select, club_sponsors_cm_affecte_all, csp_operateur_manage : staff de l'OS et CM.
--   - Noms de sponsors saisis en texte libre sur un contenu (club_creations.sponsor,
--     contenus.sponsor, club_newsroom_items.sponsor) : c'est l'usage légitime (un visuel porte le
--     sponsor), sans montant. Aucun écran ne lit club_sponsors pour le Studio : le champ est libre.
--   - clients.siret (fiche CRM de l'OS) : hors de la table `clubs` visée par la décision. Signalé
--     dans le rapport (le CM le lit par clients_cm_select_acces).
--   - subscription_status et plan : ce ne sont pas des identifiants, et ils pilotent l'interface.
--
-- GARDE-FOU. equipe_apercu, find_duplicate_club_candidates, clubs_safe et les deux policies
-- remplacées sont recréées à partir de leur définition de production du 11/09/2026. Si l'une a
-- changé depuis (d'autres sessions migrent en parallèle), la migration s'arrête AVANT toute
-- modification. Rejouable : un second passage reconnaît ses propres définitions.
--
-- Testée en transaction annulée : tests/club-donnees-restreintes.test.sql (rouge sans elle).
-- Vérification par le chemin réel après exécution : tests/club-donnees-restreintes.test.mjs.
-- ============================================================================================

begin;

set lock_timeout = '5s';

-- ── 0. Garde-fou : rien n'a changé depuis l'inventaire du 11/09/2026 ─────────────────────────
do $garde$
declare
  -- Empreinte md5(pg_get_functiondef) de production, puis celle que pose cette migration.
  f_apercu  text := md5(pg_get_functiondef('public.equipe_apercu(uuid)'::regprocedure));
  f_doublon text := md5(pg_get_functiondef('public.find_duplicate_club_candidates(text,text,uuid)'::regprocedure));
  v_safe    text := md5(pg_get_viewdef('public.clubs_safe'::regclass));
  p_csp     text := (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'club_sponsors' and policyname = 'csp_member_select');
  p_sop     text := (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'sponsor_operations' and policyname = 'sop_club_member_select');
  deja_faite boolean := exists (select 1 from pg_proc where proname = 'club_donnees_restreintes' and pronamespace = 'public'::regnamespace);
begin
  if f_apercu not in ('df40c6ef2778d1cb0ed6eb4f165f8768', 'b56b8ea632d26ddfeed639b4bf006c84') then
    raise exception 'club-donnees-restreintes-1 : equipe_apercu a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié. Reporter le masque de l''e-mail sur sa NOUVELLE définition et son empreinte ici.', f_apercu;
  end if;
  if f_doublon not in ('9bf7502df471fbabc437fa5663778ba9', '8e7f7ff8310a7399eb84e555a9aad2e0') then
    raise exception 'club-donnees-restreintes-1 : find_duplicate_club_candidates a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié.', f_doublon;
  end if;
  if v_safe not in ('76266215171b8ac21b4af5d84e8b83fd', '1769e104646aaec70ab19dff8b96df1a') then
    raise exception 'club-donnees-restreintes-1 : la vue clubs_safe a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié.', v_safe;
  end if;
  -- Premier passage : la policy « tout membre » doit être exactement celle de l'inventaire.
  -- Second passage : elle n'existe plus, et la nouvelle est là.
  if not deja_faite and p_csp is distinct from '7946bc6205fdcfa601a78231941d4cd3' then
    raise exception 'club-donnees-restreintes-1 : la policy csp_member_select a changé depuis le 11/09/2026. Rien n''a été modifié.';
  end if;
  if not deja_faite and p_sop is distinct from '9f143e6f7261fa54e63722a4cf861d56' then
    raise exception 'club-donnees-restreintes-1 : la policy sop_club_member_select a changé depuis le 11/09/2026. Rien n''a été modifié.';
  end if;
end $garde$;


-- ── A. Qui lit quoi : une fonction par décision ──────────────────────────────────────────────
-- SECURITY DEFINER : elles lisent club_members et profiles sans repasser par leurs policies.
-- Toujours un booléen, jamais NULL : « if not null » ne refuse rien (défaut déjà trouvé sur
-- peut_preparer_club(null) le 08/09). Côté staff, « actif » : un compte OS désactivé perd
-- l'accès immédiatement (décision du 10/09, migration-decisions-os-v1).

-- Décision 1a — identifiants Stripe.
create or replace function public.peut_lire_paiement_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_club_id is not null and coalesce(
    -- Owner Club+ et Président du club : c'est leur abonnement (« Mon offre »).
    exists (select 1 from club_members m
             where m.club_id = p_club_id and m.user_id = auth.uid() and m.status = 'actif'
               and m.role in ('admin', 'president'))
    -- Admin SportVision et Compta. Mesuré le 11/09/2026 : aucun écran de l'OS n'affiche ces
    -- identifiants ; la liste suit la décision, pas un usage constaté.
    or exists (select 1 from profiles p
                where p.id = auth.uid() and p.actif and p.role in ('admin', 'compta')),
    false);
$$;

-- Décision 1b — SIRET : les mêmes, plus la Secrétaire et le Trésorier. Pas le CM SportVision :
-- le SIRET identifie juridiquement la structure et finit sur une facture (règle du 08/09).
create or replace function public.peut_lire_siret_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_club_id is not null and coalesce(
    exists (select 1 from club_members m
             where m.club_id = p_club_id and m.user_id = auth.uid() and m.status = 'actif'
               and m.role in ('admin', 'president', 'secretaire', 'tresorier'))
    or exists (select 1 from profiles p
                where p.id = auth.uid() and p.actif and p.role in ('admin', 'compta')),
    false);
$$;

-- Décision 2 — coordonnées des AUTRES membres. peut_operer_club couvre l'Owner Club+, le
-- Président, le CM SportVision du club (affectation, délégation d'agence, CM responsable) et le
-- staff de l'OS qui lit déjà toute la table (admin, com, sec : cm_staff_all). Sa propre fiche se
-- lit sans cette fonction (voir club_membres_coordonnees).
create or replace function public.peut_lire_annuaire_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_club_id is not null and coalesce(
    peut_operer_club(p_club_id)
    or exists (select 1 from club_members m
                where m.club_id = p_club_id and m.user_id = auth.uid() and m.status = 'actif'
                  and m.role in ('admin', 'president', 'secretaire', 'tresorier')),
    false);
$$;

-- Décision 3 — sponsors et montants : la liste de l'annuaire, plus le Responsable sponsors,
-- dont c'est le rôle (Fouka en est informé). Le staff de l'OS garde sa policy propre
-- (csp_staff_select), inchangée.
create or replace function public.peut_lire_sponsors_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_club_id is not null and coalesce(
    peut_operer_club(p_club_id)
    or exists (select 1 from club_members m
                where m.club_id = p_club_id and m.user_id = auth.uid() and m.status = 'actif'
                  and m.role in ('admin', 'president', 'secretaire', 'tresorier', 'sponsor_mgr')),
    false);
$$;

-- Appelées par des policies et des vues évaluées sous l'identité de l'appelant : il lui faut le
-- droit d'exécution. Révoqué de PUBLIC d'abord : PostgreSQL l'accorde à PUBLIC par défaut.
revoke execute on function public.peut_lire_paiement_club(uuid) from public;
revoke execute on function public.peut_lire_siret_club(uuid) from public;
revoke execute on function public.peut_lire_annuaire_club(uuid) from public;
revoke execute on function public.peut_lire_sponsors_club(uuid) from public;
grant execute on function public.peut_lire_paiement_club(uuid) to authenticated, service_role;
grant execute on function public.peut_lire_siret_club(uuid) to authenticated, service_role;
grant execute on function public.peut_lire_annuaire_club(uuid) to authenticated, service_role;
grant execute on function public.peut_lire_sponsors_club(uuid) to authenticated, service_role;


-- ── B. SIRET et identifiants Stripe d'un club, masqués personne par personne ─────────────────
-- Une ligne seulement si l'appelant a droit à l'un des deux ; sinon aucune — ni l'existence du
-- club ni la présence d'un SIRET ne se devinent. Les drapeaux disent à l'écran ce qu'il peut
-- afficher : un SIRET vide et un SIRET qu'on n'a pas le droit de lire ne s'affichent pas pareil
-- (« Non renseigné » serait faux pour le second).
create or replace function public.club_donnees_restreintes(p_club_id uuid)
returns table (
  club_id uuid,
  siret text,
  siret_lisible boolean,
  stripe_customer_id text,
  stripe_subscription_id text,
  paiement_lisible boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id,
         case when d.siret_ok then c.siret end,
         d.siret_ok,
         case when d.paiement_ok then c.stripe_customer_id end,
         case when d.paiement_ok then c.stripe_subscription_id end,
         d.paiement_ok
    from clubs c
    cross join lateral (select peut_lire_siret_club(c.id) as siret_ok,
                               peut_lire_paiement_club(c.id) as paiement_ok) d
   where c.id = p_club_id
     and (d.siret_ok or d.paiement_ok);
$$;

revoke execute on function public.club_donnees_restreintes(uuid) from public;
grant execute on function public.club_donnees_restreintes(uuid) to authenticated, service_role;

comment on function public.club_donnees_restreintes(uuid) is
  'SIRET et identifiants Stripe d''un club, masqués selon peut_lire_siret_club / peut_lire_paiement_club. Décisions Fouka du 11/09/2026. Seul chemin de lecture pour authenticated après migration-club-donnees-restreintes-2.';


-- ── C. Téléphone des membres d'un club, masqué personne par personne ─────────────────────────
-- Ne renvoie que le téléphone : l'écran lit toujours nom, rôle et statut dans club_members, par
-- ses policies habituelles, et y rattache le téléphone par l'identifiant de la ligne. Aucune
-- règle de visibilité des LIGNES n'est donc dupliquée ici.
create or replace function public.club_membres_coordonnees(p_club_id uuid)
returns table (membre_id uuid, user_id uuid, telephone text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id, m.user_id, m.telephone
    from club_members m
   where m.club_id = p_club_id
     and (m.user_id = auth.uid() or peut_lire_annuaire_club(p_club_id));
$$;

revoke execute on function public.club_membres_coordonnees(uuid) from public;
grant execute on function public.club_membres_coordonnees(uuid) to authenticated, service_role;

comment on function public.club_membres_coordonnees(uuid) is
  'Téléphone des membres d''un club : tous pour peut_lire_annuaire_club, sa propre fiche pour chacun. Décisions Fouka du 11/09/2026. Seul chemin de lecture pour authenticated après migration-club-donnees-restreintes-2.';


-- ── D. clubs_safe (v102) : les colonnes SIRET et Stripe passent par B ────────────────────────
-- Vue en security_invoker : elle lit `clubs` avec les droits de l'appelant. Elle exposait le
-- SIRET en clair à tout membre, et après la migration 2 elle échouerait pour tout le monde
-- (colonne fermée). Même liste et même ordre de colonnes qu'en production ; seules leurs sources
-- changent. Aucun lecteur dans le code au 11/09/2026 (Club+, Connect, OS, fonctions).
create or replace view public.clubs_safe
with (security_invoker = true) as
select
  c.id,
  c.nom,
  c.ville,
  c.discipline,
  c.saison,
  c.plan,
  c.engagement,
  c.pilot_mode,
  case when club_member_has_financial_view_access(c.portail_client_id) then c.credits_balance else null end as credits_balance,
  case when club_member_has_financial_view_access(c.portail_client_id) then c.credits_monthly else null end as credits_monthly,
  case when club_member_has_financial_view_access(c.portail_client_id) then c.credits_reserved else null end as credits_reserved,
  c.created_at,
  c.updated_at,
  c.logo_url,
  c.ecusson_url,
  c.portail_client_id,
  c.role_permissions,
  c.membership_validation_mode,
  r.stripe_customer_id,
  r.stripe_subscription_id,
  case when club_member_has_financial_view_access(c.portail_client_id) then c.subscription_status else null end as subscription_status,
  c.requires_result_verification,
  c.adresse,
  c.instagram_handle,
  r.siret,
  c.couleur_primaire,
  c.couleur_secondaire
from public.clubs c
left join lateral public.club_donnees_restreintes(c.id) r on true;

-- Un anonyme n'y a jamais lu une ligne (la RLS de `clubs` ne lui en rend aucune) ; il n'a pas le
-- droit d'exécuter B, et n'en a aucun usage.
revoke select on public.clubs_safe from anon;
grant select on public.clubs_safe to authenticated;
revoke insert, update, delete, truncate on public.clubs_safe from authenticated, anon;


-- ── E. find_duplicate_club_candidates : le SIRET masqué selon A ──────────────────────────────
-- Définition de production du 11/09/2026 ; seule change la colonne club_siret. La clé de
-- service (clubplus-activate) la garde : c'est le serveur, pas une personne. Personne ne lit
-- cette colonne aujourd'hui (OS : nom et force de la correspondance ; clubplus-activate et
-- provisionner_club_plus_full_com : identifiant et force).
CREATE OR REPLACE FUNCTION public.find_duplicate_club_candidates(p_siret text, p_nom text, p_exclude_client_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(club_id uuid, club_nom text, club_siret text, club_portail_client_id uuid, match_strength text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.nom,
         -- 11/09/2026 (décision 1) : le SIRET d'un club n'est lisible que par qui y a droit.
         case when auth.role() = 'service_role' or peut_lire_siret_club(c.id) then c.siret end,
         c.portail_client_id, 'forte'::text
  from clubs c
  where p_siret is not null and trim(p_siret) <> ''
    and c.siret is not null and trim(c.siret) <> ''
    and normalize_siret(c.siret) = normalize_siret(p_siret)
    and (p_exclude_client_id is null or c.portail_client_id is distinct from p_exclude_client_id)
  union all
  select c.id, c.nom,
         case when auth.role() = 'service_role' or peut_lire_siret_club(c.id) then c.siret end,
         c.portail_client_id, 'possible'::text
  from clubs c
  where p_nom is not null and trim(p_nom) <> ''
    and normalize_org_text(c.nom) = normalize_org_text(p_nom)
    and (p_exclude_client_id is null or c.portail_client_id is distinct from p_exclude_client_id)
    and not (
      p_siret is not null and trim(p_siret) <> ''
      and c.siret is not null and trim(c.siret) <> ''
      and normalize_siret(c.siret) = normalize_siret(p_siret)
    )
  order by 5 asc
  limit 5;
$function$;


-- ── F. equipe_apercu : l'e-mail d'un encadrant invité masqué selon A ─────────────────────────
-- Définition de production du 11/09/2026. Seule l'invitation change : son e-mail n'est rendu qu'à
-- qui lit l'annuaire du club (le CM, l'Owner, le Président…), plus au coach de l'équipe. Quand
-- l'invitation n'a pas de nom, l'e-mail servait de nom : il est remplacé par « Encadrant invité ».
CREATE OR REPLACE FUNCTION public.equipe_apercu(p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_team club_teams;
  v_saison text;
  v_client uuid;
  v_joueurs jsonb;
  v_encadrement jsonb;
  v_prochain jsonb;
  v_entrainement jsonb;
  v_presence jsonb;
  v_inscriptions jsonb;
  v_contenus int;
  v_souhaits int;
  v_creneaux int;
  v_matchs int;
  v_alertes jsonb := '[]'::jsonb;
  n_total int; n_valides int; n_attente int; n_refus int;
  n_demandes int; n_inscrits int; n_invit_joueurs int;
  -- 11/09/2026 (décision 2) : les coordonnées des autres membres ne sont lisibles que par
  -- l'annuaire du club. Le coach de l'équipe lit ici le nom et le statut d'une invitation, pas
  -- l'adresse de la personne invitée.
  v_annuaire boolean;
begin
  select * into v_team from club_teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Équipe introuvable.';
  end if;
  if not (peut_operer_club(v_team.club_id) or is_team_educateur(p_team_id)) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  v_annuaire := peut_lire_annuaire_club(v_team.club_id);
  select saison, portail_client_id into v_saison, v_client from clubs where id = v_team.club_id;

  -- L'effectif, avec le droit à l'image de chacun (la dernière autorisation fait foi).
  with effectif as (
    select pp.id, pp.prenom, pp.nom
      from team_memberships tm
      join player_profiles pp on pp.id = tm.player_id
     where tm.team_id = p_team_id and tm.statut = 'active'
       and (v_saison is null or tm.saison = v_saison)
  ),
  image as (
    select distinct on (pa.player_id) pa.player_id, pa.statut
      from parental_authorizations pa
      join authorization_types aty on aty.id = pa.authorization_type_id and aty.code = 'droit_image'
     where pa.player_id in (select id from effectif)
     order by pa.player_id, pa.updated_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'prenom', e.prenom, 'nom', e.nom,
           'image', case when i.statut = 'valide' then 'valide'
                         when i.statut in ('refusee', 'retiree') then 'refus'
                         when i.statut is null then 'aucune'
                         else 'en_attente' end)
           order by e.nom, e.prenom), '[]'::jsonb)
    into v_joueurs
    from effectif e left join image i on i.player_id = e.id;

  select count(*),
         count(*) filter (where j->>'image' = 'valide'),
         count(*) filter (where j->>'image' in ('en_attente', 'aucune')),
         count(*) filter (where j->>'image' = 'refus')
    into n_total, n_valides, n_attente, n_refus
    from jsonb_array_elements(v_joueurs) j;

  -- L'encadrement : les comptes, puis les invitations en cours, chacune avec son vrai statut.
  select coalesce(jsonb_agg(x order by x->>'ordre', x->>'nom'), '[]'::jsonb) into v_encadrement
    from (
      select jsonb_build_object(
               'ordre', '1', 'source', 'membre', 'id', m.id,
               'nom', coalesce(nullif(btrim(concat_ws(' ', m.prenom, m.nom)), ''), 'Encadrant'),
               'role', m.role, 'fonction', m.fonction,
               'statut', case when m.status = 'actif' then 'actif' else 'suspendu' end) as x
        from club_members m
       where m.club_id = v_team.club_id and m.teams ? v_team.name
         and m.role in ('coach', 'resp_equipe', 'directeur_sportif')
      union all
      select jsonb_build_object(
               'ordre', '2', 'source', 'invitation', 'id', ci.id,
               'nom', coalesce(nullif(btrim(concat_ws(' ', ci.prenom, ci.nom)), ''),
                               case when v_annuaire then ci.email else 'Encadrant invité' end),
               'email', case when v_annuaire then ci.email end,
               'role', ci.role, 'fonction', ci.fonction,
               'statut', case when ci.expire_at <= now() then 'expiree'
                              when ci.statut = 'envoyee' and ci.ouverte_at is not null then 'ouverte'
                              else ci.statut end,
               'envoyee_at', ci.sent_at, 'ouverte_at', ci.ouverte_at)
        from club_invitations ci
       where ci.club_id = v_team.club_id and ci.teams ? v_team.name
         and ci.role in ('coach', 'resp_equipe', 'directeur_sportif')
         and ci.statut in ('preparee', 'envoyee')
    ) s(x);

  -- Le prochain événement qui n'est pas un entraînement, et le prochain entraînement.
  select to_jsonb(c) into v_prochain
    from club_calendrier(v_team.club_id, current_date, current_date + 60) c
   where (c.team_id = p_team_id or (c.team_id is null and c.equipe = v_team.name))
     and c.genre <> 'entrainement' and coalesce(c.statut, '') not in ('cancelled', 'annulee')
     and (c.date_evenement > current_date or c.heure_debut is null or c.heure_debut >= localtime)
   order by c.date_evenement, c.heure_debut nulls last
   limit 1;

  select jsonb_build_object('date', c.date_evenement, 'debut', to_char(c.heure_debut, 'HH24:MI'),
                            'fin', to_char(c.heure_fin, 'HH24:MI'), 'lieu', c.lieu) into v_entrainement
    from club_calendrier(v_team.club_id, current_date, current_date + 14) c
   where (c.team_id = p_team_id or (c.team_id is null and c.equipe = v_team.name))
     and c.genre = 'entrainement' and coalesce(c.statut, '') <> 'annulee'
   order by c.date_evenement, c.heure_debut
   limit 1;

  -- SportVision : la prochaine présence planifiée, et les souhaits de couverture en attente.
  select jsonb_build_object('date', pr.date_presence, 'heure', to_char(pr.heure_debut, 'HH24:MI'),
                            'type', pr.type_couverture, 'adversaire', pr.adversaire, 'lieu', pr.lieu)
    into v_presence
    from planned_presences pr
   where coalesce(pr.statut, 'prevu') <> 'annule' and pr.date_presence >= current_date
     and (exists (select 1 from club_matches m where m.id = pr.match_id
                   and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name)))
          or exists (select 1 from club_calendar_events e where e.id = pr.calendar_event_id
                      and (e.team_id = p_team_id or (e.team_id is null and e.team = v_team.name))))
   order by pr.date_presence, pr.heure_debut nulls last
   limit 1;

  select count(*) into v_souhaits
    from coverage_wishes w
   where w.club_id = v_team.club_id and w.status in ('wished', 'reviewing')
     and (exists (select 1 from club_matches m where m.id = w.match_id
                   and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name)))
          or exists (select 1 from club_calendar_events e where e.id = w.calendar_event_id
                      and (e.team_id = p_team_id or (e.team_id is null and e.team = v_team.name))));

  -- Communication : les contenus prévus rattachés à un match ou un événement de l'équipe.
  select count(*) into v_contenus
    from contenus ct
   where v_client is not null and ct.client_id = v_client
     and coalesce(ct.statut, '') not in ('publie', 'archive', 'refuse')
     and (exists (select 1 from club_matches m where m.id = ct.match_id
                   and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name)))
          or exists (select 1 from club_calendar_events e where e.id = ct.calendar_event_id
                      and (e.team_id = p_team_id or (e.team_id is null and e.team = v_team.name))));

  -- Les inscriptions par le lien et les invitations nominatives de joueurs.
  select count(*) filter (where mr.statut in ('a_verifier', 'autorisation_manquante', 'en_attente_parent', 'pret_a_valider')),
         count(*) filter (where mr.statut = 'validee'),
         coalesce(jsonb_agg(jsonb_build_object(
           'nom', nullif(btrim(concat_ws(' ', pp.prenom, pp.nom)), ''),
           'statut', mr.statut, 'source', mr.source, 'le', mr.created_at)
           order by mr.created_at desc) filter (where mr.created_at > now() - interval '60 days'), '[]'::jsonb)
    into n_demandes, n_inscrits, v_inscriptions
    from membership_requests mr
    left join player_profiles pp on pp.id = mr.player_id
   where mr.team_id = p_team_id;

  select count(*) into n_invit_joueurs from player_invitations pi
   where pi.team_id = p_team_id and pi.statut = 'envoyee';

  select count(*) into v_creneaux from club_team_training_slots s
   where s.team_id = p_team_id and (s.active_to is null or s.active_to >= current_date);
  select count(*) into v_matchs from club_matches m
   where m.club_id = v_team.club_id and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name));

  -- Les alertes, chacune avec l'endroit où elle se résout.
  if not exists (select 1 from jsonb_array_elements(v_encadrement) x where x->>'statut' in ('actif', 'preparee', 'envoyee', 'ouverte')) then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'sans_coach',
      'texte', 'Aucun encadrant rattaché ni invité', 'action', 'inviter_encadrant');
  end if;
  if n_total = 0 and v_matchs > 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'information', 'code', 'effectif',
      'texte', 'Effectif non renseigné, alors que l''équipe a ' || v_matchs || ' match' || case when v_matchs > 1 then 's' else '' end || ' au calendrier',
      'action', 'inviter_joueurs');
  end if;
  if n_total > 0 and n_valides < n_total then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'droit_image',
      'texte', (n_total - n_valides) || ' joueur' || case when n_total - n_valides > 1 then 's' else '' end || ' sans droit à l''image validé',
      'action', 'droit_image');
  end if;
  if v_creneaux = 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'creneau',
      'texte', 'Aucun créneau d''entraînement', 'action', 'creneaux');
  end if;
  if n_demandes > 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'demandes',
      'texte', n_demandes || ' demande' || case when n_demandes > 1 then 's' else '' end || ' d''inscription à valider',
      'action', 'demandes');
  end if;

  return jsonb_build_object(
    'equipe', jsonb_build_object('id', v_team.id, 'nom', v_team.name, 'categorie', v_team.categorie,
                                 'section', v_team.section, 'saison', v_saison, 'joueurs', n_total,
                                 'encadrants', (select count(*) from jsonb_array_elements(v_encadrement) x where x->>'statut' = 'actif'),
                                 'creneaux', v_creneaux),
    'prochain_evenement', v_prochain,
    'prochain_entrainement', v_entrainement,
    'droit_image', jsonb_build_object('total', n_total, 'valides', n_valides, 'en_attente', n_attente, 'refus', n_refus,
                                      'joueurs', v_joueurs),
    'communication', jsonb_build_object('contenus_prevus', v_contenus),
    'sportvision', jsonb_build_object('prochaine_presence', v_presence, 'souhaits', v_souhaits),
    'encadrement', v_encadrement,
    'inscriptions', jsonb_build_object('inscrits', n_inscrits, 'en_attente', n_demandes,
                                       'invitations_joueurs', n_invit_joueurs, 'recentes', v_inscriptions),
    'alertes', v_alertes
  );
end;
$function$;


-- ── G. Sponsors : la lecture « tout membre du club » devient la liste de la décision 3 ───────
-- Restent, inchangées : csp_operateur_manage (peut_operer_club : Owner, Président, CM, staff),
-- club_sponsors_cm_affecte_all (CM cloisonné), csp_staff_select (staff de l'OS et CM),
-- csp_sponsor_org_select (l'organisation sponsor lit SA ligne), et toutes les écritures.
-- `to authenticated` : un anonyme n'a jamais lu un sponsor, et n'a pas à exécuter la fonction.
drop policy if exists csp_member_select on public.club_sponsors;
drop policy if exists csp_lecteurs_select on public.club_sponsors;
create policy csp_lecteurs_select on public.club_sponsors
  for select to authenticated
  using (peut_lire_sponsors_club(club_id));

-- Les opérations d'un sponsor suivaient déjà la ligne du sponsor (la sous-requête sur
-- club_sponsors passe par sa RLS) ; on l'écrit explicitement plutôt que de dépendre de cet effet.
drop policy if exists sop_club_member_select on public.sponsor_operations;
create policy sop_club_member_select on public.sponsor_operations
  for select to authenticated
  using (exists (select 1 from club_sponsors cs
                  where cs.id = sponsor_operations.sponsor_id
                    and peut_lire_sponsors_club(cs.club_id)));

-- sop_staff_all (is_staff) reste : le staff de l'OS est dans la décision. Mais is_staff inclut
-- tout CM, et sponsor_operations n'avait pas la policy restrictive de périmètre que porte déjà
-- club_sponsors (cm_perim_club_sponsors) : un CM lisait les opérations de sponsors de clubs qu'il
-- n'accompagne pas (mesuré le 11/09/2026). La décision dit « CM SportVision du club » : même
-- technique RESTRICTIVE, qui ne touche aucun autre rôle. Lecture seulement — les écritures sont
-- hors de ces décisions.
drop policy if exists cm_perim_sponsor_operations on public.sponsor_operations;
create policy cm_perim_sponsor_operations on public.sponsor_operations
  as restrictive for select to authenticated
  using (not est_cm_cloisonne()
         or exists (select 1 from club_sponsors cs
                     where cs.id = sponsor_operations.sponsor_id
                       and cs.club_id in (select cm_clubs_autorises())));

commit;
