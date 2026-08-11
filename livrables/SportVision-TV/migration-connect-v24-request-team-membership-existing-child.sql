-- ============================================================
-- SPORTVISION CONNECT — Migration v24
-- Comble un manque réel du module « Espace Joueur & Famille » (migration-
-- clubplus-v13/v14/v15.sql) : demande d'adhésion à une équipe pour un
-- enfant DÉJÀ affilié (player_profiles existant), demandée par son parent.
--
-- ── Pourquoi cette migration, alors que le mécanisme existe déjà ────────
-- Le circuit de demande d'adhésion et de double validation éducateur→
-- dirigeant est entièrement construit et EN PRODUCTION depuis les
-- migrations clubplus-v13/v14/v15 (tables membership_requests,
-- team_memberships, RPC confirm_request_educateur/validate_team_membership/
-- reject_team_membership, fonctions RLS is_team_educateur/is_club_admin).
-- Vérifié en direct sur la base réelle avant d'écrire cette migration
-- (tables + RPC toutes exposées via PostgREST) — voir le rapport de la
-- fonctionnalité « demandes d'adhésion » (club-plus.html) pour le détail.
-- Cette base est déjà consommée par l'app Club+ vanilla
-- (app/modules/club-gestion-joueurs-familles.js), mais aucun écran de
-- l'app Next.js (app-next) ne l'utilise encore — c'est ce que ce chantier
-- vient combler côté Connect.
--
-- En rebranchant ce circuit sur Connect, un vrai trou est apparu dans la
-- surface RPC existante : les trois fonctions de demande de v14/v15
-- (request_team_membership_as_player, request_team_membership_for_child,
-- accept_player_invitation) créent TOUJOURS une nouvelle ligne
-- player_profiles si l'appelant n'en a pas déjà une — aucune ne permet à
-- un parent de demander une équipe SUPPLÉMENTAIRE ou DIFFÉRENTE pour un
-- enfant qu'il a déjà (cas très courant : un parent Connect, sur la page
-- Profils associés, veut faire rejoindre à son enfant déjà inscrit une
-- deuxième équipe, ou une nouvelle équipe après un changement de
-- catégorie). Le commentaire de request_team_membership_for_child
-- (v14:421-423) l'annonce explicitement : « pas pour rattacher un enfant
-- déjà connu à une équipe supplémentaire (ça, c'est move_player_to_team,
-- phase 12, côté admin) » — mais phase 12 (season_membership_renewals,
-- cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md §11) est un renouvellement de
-- saison piloté par un dirigeant, pas une demande spontanée du parent. Le
-- geste "mon enfant déjà inscrit veut rejoindre telle équipe" n'a nulle
-- part où exister sans dupliquer sa fiche joueur.
--
-- request_team_membership_for_existing_child(p_player_id, p_team_id,
-- p_invite_code) comble exactement ce trou, en réutilisant tout le reste
-- tel quel (mêmes colonnes membership_requests, même dénormalisation de
-- validation_mode, même bootstrap d'autorisations pour un mineur, même
-- journal d'événements) — aucune nouvelle table, aucune redéfinition de
-- fonction existante.
--
-- ── Second manque, RLS cette fois : choisir l'équipe à demander ─────────
-- Pour proposer un choix d'équipe (formulaire « Rejoindre une équipe »
-- côté joueur/parent), l'app doit pouvoir lister club_teams du club
-- d'affiliation AVANT que la famille ait un rattachement à l'équipe visée
-- — or les seules policies SELECT existantes sur club_teams sont
-- ctm_member_select (is_club_member, réservé aux dirigeants/éducateurs)
-- et ctm_family_select (is_family_of_team, qui suppose un rattachement
-- déjà actif à CETTE équipe précise — v16). Aucune des deux ne couvre
-- « un joueur/parent déjà affilié au CLUB veut voir la liste de TOUTES
-- ses équipes pour en choisir une nouvelle ». Nouvelle policy
-- ctm_family_club_select ci-dessous : même patron que ctm_family_select,
-- scopée au club plutôt qu'à une équipe déjà rattachée. Row-level
-- uniquement (comme le reste du RLS existant) — les colonnes de
-- club_teams (nom, catégorie, coach, prochain match) n'ont rien de
-- sensible pour une famille déjà dans le club.
-- ============================================================

create or replace function request_team_membership_for_existing_child(
  p_player_id uuid,
  p_team_id uuid,
  p_invite_code text default null
)
returns membership_requests
language plpgsql security definer set search_path = public as $$
declare
  v_player player_profiles;
  v_parent parent_profiles;
  v_code team_invite_codes;
  v_req membership_requests;
  v_source text;
begin
  select * into v_player from player_profiles where id = p_player_id;
  if v_player.id is null then raise exception 'Joueur introuvable'; end if;
  if not is_confirmed_parent_of(p_player_id) then raise exception 'Non autorisé'; end if;

  select * into v_parent from parent_profiles where user_id = auth.uid();
  if v_parent.id is null then raise exception 'Profil parent introuvable'; end if;

  -- club_id dérivé du joueur existant, jamais transmis par le client — au contraire de
  -- request_team_membership_for_child (aucune fiche joueur n'existe encore à cet instant-là).
  if p_invite_code is not null then
    select * into v_code from team_invite_codes
      where code = p_invite_code and team_id = p_team_id and actif = true
        and (expire_at is null or expire_at > now());
    if v_code.id is null then raise exception 'Code invalide ou expiré'; end if;
    v_source := 'code_equipe';
  else
    v_source := 'spontanee';
  end if;

  insert into membership_requests (club_id, team_id, requested_by_user_id, player_id, parent_id, source, invite_code_id, statut, validation_mode)
  values (
    v_player.club_id, p_team_id, auth.uid(), v_player.id, v_parent.id, v_source, v_code.id,
    initial_request_status(v_player.date_naissance),
    (select membership_validation_mode from clubs where id = v_player.club_id)
  )
  returning * into v_req;

  if sv_age_bracket(v_player.date_naissance) <> 'majeur' then
    perform bootstrap_player_authorizations(v_player.id, v_player.club_id);
  end if;

  insert into membership_request_events (request_id, event_type, acted_by, note) values (v_req.id, 'creee', auth.uid(), 'via parent, enfant déjà affilié');
  return v_req;
end;
$$;
revoke all on function request_team_membership_for_existing_child(uuid, uuid, text) from public;
grant execute on function request_team_membership_for_existing_child(uuid, uuid, text) to authenticated;

-- ── RLS additive : lister les équipes du club pour choisir laquelle demander ──

drop policy if exists "ctm_family_club_select" on club_teams;
create policy "ctm_family_club_select" on club_teams for select using (
  exists (
    select 1 from player_profiles p
    where p.club_id = club_teams.club_id
      and (p.user_id = auth.uid() or is_confirmed_parent_of(p.id))
  )
);
