-- Un lien collectif ne doit pas permettre de s'attribuer l'enfant d'un autre.
--
-- ── Ce qui a été prouvé en production le 10/09/2026, en transaction annulée ──
-- Un enfant est inscrit au club. Un inconnu détient le code d'équipe — celui qu'on colle dans le
-- groupe WhatsApp et qu'on affiche en QR au vestiaire, donc largement diffusé par construction —
-- et connaît le prénom, le nom et la date de naissance de cet enfant. Ce sont des informations
-- que tous les parents de l'équipe possèdent.
--
--   connect_join_club_via_smart_link(code, 'new', …, 'Lina', 'Bertrand', '2014-03-12')
--     → statut du lien      : « confirme »
--     → is_confirmed_parent_of(enfant) : TRUE
--
-- Ce que cela ouvrait, en lecture ET en écriture (policies vérifiées une par une) :
--   la fiche de l'enfant (identité, date de naissance, numéro de licence) ;
--   ses médias dans le stockage — `clubplus_media_scoped_read`, et même
--   `clubplus_media_parent_insert` / `_update` ;
--   ses autorisations parentales : `submit_parental_authorization` et
--   `withdraw_parental_authorization` acceptent quiconque `is_confirmed_parent_of`.
--
-- Autrement dit : les photos d'un mineur, et la signature de son droit à l'image.
--
-- ── Le deuxième trou, dans la même zone ──
-- La policy `ppr_parent_confirm` autorise un parent à modifier SA ligne sans aucune contrainte
-- sur le statut. Même en créant le lien « en attente », la personne pouvait donc le passer
-- elle-même à « confirme » d'un seul UPDATE. Corriger la fonction sans corriger la policy
-- n'aurait rien corrigé du tout.
--
-- ── Ce qui existait déjà, et que personne n'utilisait ──
-- La contrainte de `parent_player_relationships.statut` accepte « en_attente_confirmation »
-- depuis toujours. Aucune ligne de code ne l'écrit ni ne la lit : la soupape avait été prévue,
-- puis jamais raccordée. On la raccorde.
--
-- ── La règle retenue ──
-- Déclarer un enfant que le club NE CONNAÎT PAS reste immédiat : la fiche est créée par la
-- personne elle-même, il n'y a personne à usurper, et l'adhésion passe de toute façon par la
-- validation du club (`membership_requests`, statut « pret_a_valider »).
--
-- Se rattacher à un enfant DÉJÀ INSCRIT devient une demande. Le club confirme. C'est le
-- « privilégier invitation individuelle / validation » du master prompt, et ça ne coûte au parent
-- légitime qu'une validation que le club fait déjà pour l'adhésion.
--
-- L'invitation nominative (`accept_parent_invitation`) n'est pas touchée : là, c'est le CLUB qui
-- désigne l'enfant, et l'adresse du compte doit correspondre à celle invitée. Rien à durcir.

begin;

-- ── 1. Le rattachement à un enfant déjà connu devient une demande ──
create or replace function public.connect_join_club_via_smart_link(
  p_code text,
  p_kind text,
  p_ref_id uuid default null,
  p_prenom text default null,
  p_nom text default null,
  p_date_naissance date default null,
  p_relation_type text default 'parent'
)
returns table(
  membership_request_id uuid,
  resolved_player_id uuid,
  statut text,
  match_ambigu boolean,
  club_nom text,
  team_nom text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_redeem record;
  v_source player_profiles;
  v_prenom text;
  v_nom text;
  v_dob date;
  v_player_id uuid;
  v_strong_count int;
  v_total_count int;
  v_parent_profile_id uuid;
  v_existing_req membership_requests;
  v_req membership_requests;
  v_ambigu boolean := false;
  -- Vrai quand la fiche de l'enfant existait AVANT cet appel. C'est toute la question : on ne
  -- devient pas parent confirmé d'un enfant que le club connaît déjà en tapant son nom.
  v_enfant_preexistant boolean := false;
  v_statut_lien text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if p_kind not in ('self', 'club', 'managed', 'new') then
    raise exception 'Type de bénéficiaire invalide.';
  end if;

  select * into v_redeem from redeem_invite_code(p_code);

  if p_kind = 'club' then
    select * into v_source from player_profiles where id = p_ref_id;
    if v_source.id is null then
      raise exception 'Profil introuvable.';
    end if;
    if not (
      v_source.user_id = auth.uid()
      or exists (
        select 1 from parent_player_relationships ppr
        join parent_profiles pf on pf.id = ppr.parent_id
        where ppr.player_id = v_source.id and pf.user_id = auth.uid() and ppr.statut = 'confirme'
      )
    ) then
      raise exception 'Non autorisé sur ce profil.';
    end if;
    v_prenom := v_source.prenom;
    v_nom := v_source.nom;
    v_dob := v_source.date_naissance;
  elsif p_kind = 'managed' then
    if not exists (select 1 from managed_athlete_profiles where id = p_ref_id and owner_user_id = auth.uid()) then
      raise exception 'Profil introuvable.';
    end if;
    if p_prenom is null or p_nom is null or p_date_naissance is null then
      raise exception 'Prénom, nom et date de naissance sont nécessaires pour rejoindre un club.';
    end if;
    v_prenom := p_prenom; v_nom := p_nom; v_dob := p_date_naissance;
  else
    -- 'self' ou 'new' : identité fournie directement par l'appelant.
    if p_prenom is null or p_nom is null or p_date_naissance is null then
      raise exception 'Prénom, nom et date de naissance sont obligatoires.';
    end if;
    v_prenom := p_prenom; v_nom := p_nom; v_dob := p_date_naissance;
  end if;

  -- Idempotence : déjà une fiche pour cette personne dans CE club précis (multi-club existant, ou
  -- rappel/double-clic sur le même Smart Link) → jamais une 2e ligne player_profiles pour le même
  -- club (même personne+club).
  if p_kind = 'self' then
    select id into v_player_id from player_profiles where user_id = auth.uid() and club_id = v_redeem.club_id;
    if v_player_id is not null then
      v_enfant_preexistant := true;
    end if;
  end if;

  if v_player_id is null then
    select count(*) filter (where match_strength = 'forte'), count(*)
      into v_strong_count, v_total_count
      from find_player_match_candidates(v_redeem.club_id, v_prenom, v_nom, v_dob);

    if v_strong_count = 1 then
      select fpc.player_id into v_player_id
      from find_player_match_candidates(v_redeem.club_id, v_prenom, v_nom, v_dob) fpc
      where fpc.match_strength = 'forte';
      v_enfant_preexistant := true;
    elsif v_strong_count > 1 or (v_strong_count = 0 and v_total_count > 0) then
      -- Homonyme réel (2+ matches forts) ou nom qui matche sans date de naissance fiable pour
      -- trancher : jamais d'auto-merge, on remonte l'ambiguïté au lieu de créer quoi que ce soit.
      v_ambigu := true;
    end if;
  end if;

  if v_ambigu then
    return query select null::uuid, null::uuid, 'a_verifier'::text, true, c.nom, t.name
      from clubs c left join club_teams t on t.id = v_redeem.team_id where c.id = v_redeem.club_id;
    return;
  end if;

  if v_player_id is null then
    insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_redeem.club_id, case when p_kind = 'self' then auth.uid() else null end, v_prenom, v_nom, v_dob, 'en_attente_activation')
    returning id into v_player_id;
  end if;

  if p_kind <> 'self' then
    select id into v_parent_profile_id from parent_profiles where user_id = auth.uid();
    if v_parent_profile_id is null then
      insert into parent_profiles (user_id) values (auth.uid()) returning id into v_parent_profile_id;
    end if;

    -- LE point de cette migration. Un enfant que le club connaît déjà ne se réclame pas : le lien
    -- attend la confirmation du club. Un enfant que la personne vient d'inscrire lui appartient
    -- de fait — il n'existait pas avant qu'elle le déclare.
    v_statut_lien := case when v_enfant_preexistant then 'en_attente_confirmation' else 'confirme' end;

    insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
    values (v_parent_profile_id, v_player_id, coalesce(p_relation_type, 'parent'), v_statut_lien,
            case when v_statut_lien = 'confirme' then now() else null end)
    on conflict (parent_id, player_id) do update
      -- Ne JAMAIS rétrograder un lien déjà confirmé, ni promouvoir un lien en attente : recliquer
      -- sur le lien d'équipe ne doit pas devenir un moyen de se confirmer soi-même.
      set statut = case when parent_player_relationships.statut = 'confirme' then 'confirme'
                        else excluded.statut end,
          confirmed_at = case when parent_player_relationships.statut = 'confirme'
                              then parent_player_relationships.confirmed_at
                              else excluded.confirmed_at end;
  end if;

  select * into v_existing_req from membership_requests mr
    where mr.player_id = v_player_id and mr.team_id is not distinct from v_redeem.team_id and mr.club_id = v_redeem.club_id
      and mr.statut not in ('refusee')
    order by mr.created_at desc limit 1;

  if v_existing_req.id is not null then
    v_req := v_existing_req;
  else
    insert into membership_requests (club_id, team_id, player_id, source, statut, validation_mode, invite_code_id)
    values (v_redeem.club_id, v_redeem.team_id, v_player_id, 'code_equipe', 'pret_a_valider', 'standard', v_redeem.invite_code_id)
    returning * into v_req;
  end if;

  return query select v_req.id, v_player_id, v_req.statut, false, c.nom, t.name
    from clubs c left join club_teams t on t.id = v_redeem.team_id where c.id = v_redeem.club_id;
end;
$function$;

-- ── 2. Un parent ne se confirme pas lui-même ──
-- L'ancienne policy autorisait un parent à écrire n'importe quel statut sur SA ligne. Elle rendait
-- inutile toute mise en attente. Il garde le droit de se retirer ou de refuser un rattachement —
-- ce sont des renoncements, ils ne demandent l'accord de personne.
drop policy if exists ppr_parent_confirm on public.parent_player_relationships;
create policy ppr_parent_retrait on public.parent_player_relationships
  for update
  using (
    exists (select 1 from parent_profiles pp
             where pp.id = parent_player_relationships.parent_id and pp.user_id = auth.uid())
  )
  with check (
    exists (select 1 from parent_profiles pp
             where pp.id = parent_player_relationships.parent_id and pp.user_id = auth.uid())
    and statut in ('refuse', 'retire')
  );

-- ── 3. La voie de confirmation, côté club ──
-- Sans elle, un parent légitime dont l'enfant est déjà inscrit resterait bloqué pour toujours :
-- mettre en attente sans prévoir qui décide, c'est fermer la porte, pas la garder.
create or replace function public.decider_lien_parent(p_relation_id uuid, p_decision text)
returns parent_player_relationships
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rel parent_player_relationships;
  v_club uuid;
begin
  if p_decision not in ('confirme', 'refuse') then
    raise exception 'Décision invalide.';
  end if;

  select * into v_rel from parent_player_relationships where id = p_relation_id;
  if v_rel.id is null then raise exception 'Ce rattachement n''existe plus.'; end if;
  if v_rel.statut = 'confirme' then return v_rel; end if;

  select club_id into v_club from player_profiles where id = v_rel.player_id;
  if v_club is null then raise exception 'Cet enfant n''est rattaché à aucun club.'; end if;

  -- Qui décide : le club. `peut_operer_club` couvre ses administrateurs et le CM SportVision qui
  -- l'exploite ; l'éducateur de l'équipe de l'enfant est légitime aussi, c'est lui qui connaît
  -- les familles.
  if not (
    peut_operer_club(v_club)
    or exists (
      select 1 from team_memberships tm
       where tm.player_id = v_rel.player_id and is_team_educateur(tm.team_id)
    )
  ) then
    raise exception 'Vous n''êtes pas autorisé à décider de ce rattachement.';
  end if;

  update parent_player_relationships
     set statut = p_decision,
         confirmed_at = case when p_decision = 'confirme' then now() else null end
   where id = p_relation_id
   returning * into v_rel;
  return v_rel;
end;
$$;

comment on function public.decider_lien_parent(uuid, text) is
  'Confirme ou refuse le rattachement d''un parent à un enfant déjà inscrit. Réservé au club (administrateurs, CM SportVision qui l''exploite, éducateur de l''équipe de l''enfant). Un parent ne peut jamais se confirmer lui-même.';

commit;

-- ── 4. Et le club doit pouvoir VOIR ce qu'il doit décider ──
-- Ajouté après le test de la migration : `decider_lien_parent` acceptait bien le CM, mais
-- `ppr_club_select` ne reconnaissait que `is_club_admin` — donc le CM ne voyait aucun
-- rattachement en attente, et ne pouvait pas décider de ce qu'il ne voyait pas. C'est la
-- quatrième fois aujourd'hui que l'écriture et la lecture ne s'accordent pas sur qui opère un
-- club ; on aligne, comme pour les trois précédentes.
drop policy if exists ppr_club_select on public.parent_player_relationships;
create policy ppr_club_select on public.parent_player_relationships
  for select using (
    exists (
      select 1 from player_profiles p
       where p.id = parent_player_relationships.player_id
         and (
           is_club_admin(p.club_id)
           or peut_operer_club(p.club_id)
           or exists (
             select 1 from team_memberships tm
              where tm.player_id = p.id and is_team_educateur(tm.team_id)
           )
         )
    )
  );

-- ── 5. Le CM ne voyait AUCUN joueur de ses clubs ──
-- Découvert en testant le point 4 : la policy de lecture des rattachements interroge
-- `player_profiles`, et cette table-là n'ouvrait sa lecture qu'à `is_club_admin`, aux éducateurs
-- de l'équipe, au joueur et à ses parents confirmés. Le CM SportVision, qui administre le club au
-- quotidien, n'y figurait pas : l'effectif lui était invisible, et donc les rattachements à
-- décider aussi.
--
-- Cinquième occurrence de la même fracture aujourd'hui — l'écriture et la lecture ne s'accordent
-- pas sur qui opère un club. Policy ADDITIVE, dédiée : les quatre existantes sont inchangées, et
-- celle-ci se retire d'un `drop policy` si l'arbitrage change.
--
-- Lecture seulement. Modifier ou supprimer la fiche d'un mineur reste hors de portée du CM par ce
-- chemin : ce n'est pas le sujet du jour, et ça ne s'accorde pas au détour d'un correctif.
drop policy if exists pp_operateur_select on public.player_profiles;
create policy pp_operateur_select on public.player_profiles
  for select using (peut_operer_club(club_id));
