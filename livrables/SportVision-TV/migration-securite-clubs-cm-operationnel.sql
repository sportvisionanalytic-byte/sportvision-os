-- P1 audit transversal (04-05/09/2026) : un CM lié à un club lisait en clair
-- stripe_customer_id / stripe_subscription_id / subscription_status / credits_balance
-- via la policy clubs_cm_select sur la table clubs (confirmé par test JWT réel).
-- Décision Fouka (05/09) : le CM ne doit voir qu'un résumé opérationnel dérivé
-- (offre, statut actif/action requise, branding), jamais d'identifiant Stripe brut
-- ni de solde de crédits financier. Ne clone pas les données, ne retire aucune
-- colonne de clubs (d'autres modules staff en ont besoin), ne change rien pour
-- admin/sec/com (déjà couverts par clubs_staff_all, non concernés par cette policy).

-- Réutilise exactement la même logique de portée que l'ancienne policy clubs_cm_select
-- (cm_lead ou contenus_visible_par_cm sur le client rattaché, ou club "pool" pour tout cm)
-- pour ne pas élargir ni réduire silencieusement qui peut voir quel club.
create or replace function is_cm_authorized_for_club(target_club_id uuid, target_portail_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select
    (target_portail_client_id is not null and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(target_portail_client_id, auth.uid())
    ))
    or (
      club_request_is_pool(target_club_id)
      and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm')
    );
$$;

-- Résumé opérationnel du club rattaché à un client, jamais les colonnes Stripe/crédits
-- brutes. security definer : la fonction lit clubs directement puis vérifie elle-même
-- l'autorisation (admin/sec/compta, ou cm scopé comme avant, ou membre du club).
create or replace function rpc_club_operational_summary(p_client_id uuid)
returns table (
  club_id uuid,
  nom text,
  saison text,
  logo_url text,
  ecusson_url text,
  couleur_primaire text,
  couleur_secondaire text,
  offre_label text,
  statut_service text,
  club_plus_actif boolean,
  communication_active boolean,
  action_administrative_requise boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_club clubs%rowtype;
  v_is_full_staff boolean;
  v_is_cm boolean;
begin
  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','sec','compta'))
    into v_is_full_staff;
  select exists(select 1 from profiles where id = auth.uid() and role = 'cm')
    into v_is_cm;

  select * into v_club from clubs where portail_client_id = p_client_id limit 1;
  if v_club.id is null then
    return;
  end if;

  if not (
    v_is_full_staff
    or (v_is_cm and is_cm_authorized_for_club(v_club.id, v_club.portail_client_id))
    or is_club_member(v_club.id)
  ) then
    return;
  end if;

  return query select
    v_club.id,
    v_club.nom,
    v_club.saison,
    v_club.logo_url,
    v_club.ecusson_url,
    v_club.couleur_primaire,
    v_club.couleur_secondaire,
    case
      when v_club.club_plus_source = 'full_com_included' then 'Full Communication'
      when v_club.plan = 'performance' then 'Club+ Performance'
      when v_club.plan = 'club' then 'Club+ Classique'
      else 'Gratuit'
    end,
    case
      when v_club.subscription_status = 'actif' then 'actif'
      when v_club.subscription_status = 'impaye' then 'action_requise'
      when v_club.subscription_status = 'annule' then 'inactif'
      else 'actif'
    end,
    (v_club.plan is not null and v_club.plan <> 'free'),
    (
      v_club.club_plus_source = 'full_com_included'
      or exists(
        select 1 from contrats co
        where co.client_id = p_client_id and co.type_contrat = 'full_communication' and co.statut = 'actif'
      )
    ),
    coalesce(v_club.subscription_status = 'impaye', false),
    v_club.created_at;
end;
$$;

revoke all on function rpc_club_operational_summary(uuid) from public;
grant execute on function rpc_club_operational_summary(uuid) to authenticated;

comment on function rpc_club_operational_summary(uuid) is
  'Résumé opérationnel non sensible d''un club pour un CM (offre, statut actif/action requise, branding). '
  'Ne renvoie jamais stripe_customer_id/stripe_subscription_id/subscription_status brut/credits_balance. '
  'Audit 04-05/09/2026, décision Fouka : remplace la lecture directe de clubs pour role=cm.';

-- Ferme le seul chemin d'accès direct d'un CM à la table clubs (base des lignes admin/
-- com/sec via clubs_staff_all, ou club-membre via clubs_member_select, tous inchangés).
-- Un CM n'a donc plus aucun moyen de lire stripe_customer_id/subscription_status brut/
-- credits_balance en interrogeant directement /rest/v1/clubs, quelle que soit la colonne
-- demandée : seul rpc_club_operational_summary reste accessible pour lui.
drop policy if exists clubs_cm_select on clubs;

comment on table clubs is
  'Un CM (role=cm) n''a plus de policy SELECT directe depuis le 05/09/2026 (voir migration-'
  'securite-clubs-cm-operationnel.sql) : utiliser rpc_club_operational_summary(client_id) '
  'pour tout écran CM. admin/sec/com gardent clubs_staff_all, les membres du club gardent '
  'clubs_member_select, aucun des deux n''est concerné par ce changement.';
