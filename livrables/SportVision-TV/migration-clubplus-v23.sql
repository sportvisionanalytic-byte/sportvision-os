-- ============================================================
-- SPORTVISION CLUB+ — Migration v23
-- Suite de migration-clubplus-v1 à v22.sql. Idempotente.
--
-- Portée : Phase 13 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md) — revue de conformité et
-- correctifs trouvés en la menant. Contrairement aux migrations
-- précédentes, celle-ci NE construit aucune fonctionnalité neuve : elle
-- corrige 5 failles concrètes identifiées en relisant les policies RLS
-- de tout le module à la recherche du même défaut structurel — une
-- policy INSERT qui vérifie QUI écrit mais pas QUOI (en particulier la
-- colonne de statut), permettant à l'appelant d'imposer directement un
-- état qui devrait être impossible sans validation.
--
-- Le détail de chaque faille, sa gravité réelle et le scénario concret
-- qui l'exploite sont documentés dans CLUBPLUS_PLAYER_FAMILY_SECURITY_
-- REVIEW.md, à lire avant d'exécuter cette migration.
-- ============================================================

-- ── 1. Un compte personnel pouvait être créé pour un joueur de moins de
--    14 ans (§3/§31-3 du prompt d'origine, jamais réellement vérifié).
--    accept_player_invitation et request_team_membership_as_player
--    créaient player_profiles avec user_id = auth.uid() sans jamais
--    vérifier l'âge — un mineur de moins de 14 ans qui accepte une
--    invitation, ou qui s'inscrit spontanément avec sa vraie date de
--    naissance (ou une date falsifiée, mais même sans mentir le défaut
--    existait), obtenait un compte personnel. Seul le chemin parent
--    (request_team_membership_for_child) respectait la règle.

create or replace function accept_player_invitation(p_invitation_id uuid)
returns membership_requests
language plpgsql security definer set search_path = public as $$
declare
  v_inv player_invitations;
  v_player player_profiles;
  v_req membership_requests;
begin
  select * into v_inv from player_invitations where id = p_invitation_id;
  if v_inv.id is null then raise exception 'Invitation introuvable'; end if;
  if v_inv.statut <> 'envoyee' then raise exception 'Invitation déjà traitée'; end if;
  if v_inv.email is distinct from auth.email() then raise exception 'Cette invitation ne correspond pas à votre compte'; end if;
  if v_inv.date_naissance is null then raise exception 'Date de naissance manquante sur l''invitation'; end if;

  select * into v_player from player_profiles where user_id = auth.uid();
  if v_player.id is not null and v_player.club_id <> v_inv.club_id then
    raise exception 'Ce compte est déjà rattaché à un autre club';
  end if;
  if v_player.id is null then
    if sv_age_bracket(v_inv.date_naissance) = 'moins_14' then
      raise exception 'Un compte personnel n''est pas autorisé avant 14 ans — un parent doit inscrire l''enfant depuis son propre compte.';
    end if;
    insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_inv.club_id, auth.uid(), coalesce(v_inv.prenom, ''), coalesce(v_inv.nom, ''), v_inv.date_naissance, 'en_attente_activation')
    returning * into v_player;
  end if;

  insert into membership_requests (club_id, team_id, requested_by_user_id, player_id, source, statut, validation_mode)
  values (
    v_inv.club_id, v_inv.team_id, auth.uid(), v_player.id, 'invitation',
    initial_request_status(v_player.date_naissance),
    (select membership_validation_mode from clubs where id = v_inv.club_id)
  )
  returning * into v_req;

  if sv_age_bracket(v_player.date_naissance) <> 'majeur' then
    perform bootstrap_player_authorizations(v_player.id, v_inv.club_id);
  end if;

  update player_invitations set statut = 'acceptee', resulting_request_id = v_req.id where id = p_invitation_id;
  insert into membership_request_events (request_id, event_type, acted_by, note) values (v_req.id, 'creee', auth.uid(), 'via invitation joueur');
  return v_req;
end;
$$;

create or replace function request_team_membership_as_player(
  p_club_id uuid,
  p_team_id uuid,
  p_invite_code text default null,
  p_prenom text default null,
  p_nom text default null,
  p_date_naissance date default null
)
returns membership_requests
language plpgsql security definer set search_path = public as $$
declare
  v_player player_profiles;
  v_code team_invite_codes;
  v_req membership_requests;
  v_source text;
begin
  select * into v_player from player_profiles where user_id = auth.uid();
  if v_player.id is not null and v_player.club_id <> p_club_id then
    raise exception 'Ce compte est déjà rattaché à un autre club';
  end if;
  if v_player.id is null then
    if p_prenom is null or p_nom is null or p_date_naissance is null then
      raise exception 'Prénom, nom et date de naissance requis pour une première demande';
    end if;
    if sv_age_bracket(p_date_naissance) = 'moins_14' then
      raise exception 'Un compte personnel n''est pas autorisé avant 14 ans — un parent doit inscrire l''enfant depuis son propre compte.';
    end if;
    insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (p_club_id, auth.uid(), p_prenom, p_nom, p_date_naissance, 'en_attente_activation')
    returning * into v_player;
  end if;

  if p_invite_code is not null then
    select * into v_code from team_invite_codes
      where code = p_invite_code and team_id = p_team_id and actif = true
        and (expire_at is null or expire_at > now());
    if v_code.id is null then raise exception 'Code invalide ou expiré'; end if;
    v_source := 'code_equipe';
  else
    v_source := 'spontanee';
  end if;

  insert into membership_requests (club_id, team_id, requested_by_user_id, player_id, source, invite_code_id, statut, validation_mode)
  values (
    p_club_id, p_team_id, auth.uid(), v_player.id, v_source, v_code.id,
    initial_request_status(v_player.date_naissance),
    (select membership_validation_mode from clubs where id = p_club_id)
  )
  returning * into v_req;

  if sv_age_bracket(v_player.date_naissance) <> 'majeur' then
    perform bootstrap_player_authorizations(v_player.id, p_club_id);
  end if;

  insert into membership_request_events (request_id, event_type, acted_by) values (v_req.id, 'creee', auth.uid());
  return v_req;
end;
$$;

-- ── 2. team_projects : une policy INSERT qui ne restreint pas le statut
--    initial permettait à un éducateur de créer directement un projet
--    'ouvert' (ou tout autre statut), en contournant totalement la
--    validation du club (§19 du prompt : "Le projet doit être autorisé
--    par le club avant publication") — l'app elle-même envoie toujours
--    'attente_validation_club', mais rien ne l'imposait côté serveur.

drop policy if exists "tpr_educateur_insert" on team_projects;
create policy "tpr_educateur_insert" on team_projects for insert with check (
  is_team_educateur(team_id) and statut in ('brouillon', 'attente_validation_club')
);

-- ── 3. club_bookings : même défaut — la policy famille (v20) et la
--    policy dirigeant (v6, antérieure à ce module mais touchée par le
--    même correctif par cohérence) permettaient d'insérer directement
--    n'importe quel statut, y compris 'livree', court-circuitant tout
--    le pipeline SportVision (recue → ... → livrée).

drop policy if exists "cbk_family_insert" on club_bookings;
create policy "cbk_family_insert" on club_bookings for insert with check (
  status = 'recue'
  and player_id is not null and (
    (
      is_own_player(player_id)
      and exists (select 1 from player_profiles p where p.id = player_id and sv_age_bracket(p.date_naissance) = 'majeur')
    )
    or is_confirmed_parent_of(player_id)
  )
);

drop policy if exists "cbk_member_insert" on club_bookings;
create policy "cbk_member_insert" on club_bookings for insert with check (
  status = 'recue' and is_club_member(club_id)
);

-- ── 4. media_reports : la faille la plus sérieuse des cinq. La policy
--    d'insertion ne restreignait pas non plus le statut — un joueur ou
--    un parent pouvait insérer directement un signalement avec
--    statut='media_masque' (ou 'retrait_accepte'), ce qui, combiné à
--    is_media_visible_to_family (v18/v19), masquait IMMÉDIATEMENT le
--    média pour toute la famille de l'équipe, sans aucune vérification
--    du club. Une personne pouvait ainsi faire disparaître à volonté
--    n'importe quel contenu publié à son équipe.

drop policy if exists "mrp_insert" on media_reports;
create policy "mrp_insert" on media_reports for insert with check (
  statut = 'recu'
  and (is_club_member(club_id) or is_media_visible_to_family(media_ref_type, media_ref_id))
);
