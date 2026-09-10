-- La transition de saison se valide par l'Admin/Owner ou le Président du club. Personne d'autre.
--
-- Décision de Fouka, 10/09/2026 : « La transition de saison fait partie de l'administration
-- normale du club. Le président doit pouvoir la lancer/valider pour son club. » Et : « Si
-- aujourd'hui il n'existe qu'un bouton simple sans workflow de préparation, je n'ouvrirais pour V1
-- le bouton final qu'à admin + president. » C'est le cas : aucun workflow préparation/validation
-- n'existe. Le CM et le coach sont donc refusés.
--
-- ── Ce qui a été mesuré avant d'écrire (tests/transition-saison.test.sql, rouge) ──
-- Le CM affecté basculait la saison du club par un simple UPDATE de `clubs.saison`, sans passer
-- par l'écran : `clubs_cm_affecte_update` lui ouvre la ligne entière, et rien ne gardait la colonne.
-- `renew_season_membership` le refusait déjà, mais s'appuyait sur `is_club_admin`, qui couvre
-- aussi le CM d'agence et le super-accès CM — deux mécanismes vides aujourd'hui, ouverts demain.
--
-- ── L'invariant, déjà tenu et désormais testé ──
-- Une transition ne supprime rien : l'ancien rattachement est archivé, le nouveau est créé, la
-- décision est journalisée dans `season_membership_renewals`. Aucun DELETE nulle part.
--
-- ── Qui valide ──
--   • l'Admin/Owner Club+ et le Président du club (`club_members`, statut actif) ;
--   • l'Admin SportVision (`profiles.role = 'admin'`), pour le support de la plateforme.
-- Pas `com`, pas `sec` : ce sont des profils d'exploitation — un CM SportVision peut porter `com`.

begin;

-- ── 1. La règle, écrite une fois ──
create or replace function public.peut_basculer_saison(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.club_members
     where club_id = p_club_id and user_id = auth.uid()
       and role in ('admin', 'president') and status = 'actif'
  )
  or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

comment on function public.peut_basculer_saison(uuid) is
  'Qui valide la transition de saison d''un club : Admin/Owner Club+, Président, ou Admin SportVision. Ni le CM (pas de workflow de préparation en V1), ni le coach. Décision de Fouka, 10/09/2026.';

revoke execute on function public.peut_basculer_saison(uuid) from public, anon;
grant execute on function public.peut_basculer_saison(uuid) to authenticated;

-- ── 2. Le basculement lui-même : la colonne `clubs.saison` ──
-- Une policy ne restreint pas une colonne : le CM garde l'accès au reste de la ligne (logo,
-- couleurs, adresse), seule la saison lui échappe.
create or replace function public.proteger_bascule_saison()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.saison is not distinct from old.saison then
    return new;
  end if;
  if auth.role() = 'service_role' then
    return new;
  end if;
  if not public.peut_basculer_saison(new.id) then
    raise exception 'La transition de saison se valide par l''administrateur ou le président du club.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_bascule_saison on public.clubs;
create trigger trg_proteger_bascule_saison
  before update of saison on public.clubs
  for each row execute function public.proteger_bascule_saison();

-- ── 3. Le renouvellement joueur par joueur ──
-- Corps inchangé à une ligne près : l'autorité passe de `is_club_admin` à `peut_basculer_saison`.
create or replace function public.renew_season_membership(p_membership_id uuid, p_action text, p_new_team_id uuid default null::uuid, p_to_saison text default null::text)
returns team_memberships
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old team_memberships;
  v_new team_memberships;
  v_target_team uuid;
begin
  select * into v_old from team_memberships where id = p_membership_id;
  if v_old.id is null then raise exception 'Rattachement introuvable'; end if;
  if not peut_basculer_saison(v_old.club_id) then raise exception 'Non autorisé'; end if;
  if p_action not in ('renouvele', 'deplace', 'archive', 'mis_en_attente', 'quitte_club') then
    raise exception 'Action invalide';
  end if;

  if p_action in ('renouvele', 'deplace') then
    if p_to_saison is null or p_to_saison = '' then raise exception 'Saison de destination requise'; end if;
    v_target_team := case when p_action = 'deplace' then p_new_team_id else v_old.team_id end;
    if v_target_team is null then raise exception 'Équipe de destination requise'; end if;

    update team_memberships set statut = 'archivee' where id = p_membership_id;

    insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_old.player_id, v_target_team, v_old.club_id, p_to_saison, 'active')
    on conflict (player_id, team_id, saison) do update set statut = 'active'
    returning * into v_new;
  else
    update team_memberships
    set statut = case p_action
      when 'archive' then 'archivee'
      when 'mis_en_attente' then 'en_attente_renouvellement'
      when 'quitte_club' then 'quittee_club'
    end
    where id = p_membership_id
    returning * into v_new;
  end if;

  insert into season_membership_renewals (club_id, from_saison, to_saison, player_id, from_team_membership_id, action, new_team_id, processed_by)
  values (v_old.club_id, v_old.saison, coalesce(p_to_saison, v_old.saison), v_old.player_id, v_old.id, p_action, v_target_team, auth.uid());

  return v_new;
end;
$function$;

-- `anon` avait EXECUTE (inoffensif, `auth.uid()` nul ne passe aucun contrôle — mais inutile).
revoke execute on function public.renew_season_membership(uuid, text, uuid, text) from public, anon;
grant execute on function public.renew_season_membership(uuid, text, uuid, text) to authenticated;

commit;
