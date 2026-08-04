-- ============================================================
-- SPORTVISION CLUB+ — Migration v14
-- Suite de migration-clubplus-v1 à v13.sql. Idempotente.
--
-- Portée : Phase 3 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md) — codes équipe,
-- invitations joueur/parent, demandes d'adhésion et leur journal
-- d'événements, + les fonctions RPC qui les font vivre.
--
-- Ce qui n'est PAS dans cette migration, volontairement : la validation
-- finale d'une demande (validate_team_membership) et la double
-- confirmation éducateur→admin restent pour la phase 4
-- (migration-clubplus-v15.sql), qui introduit parental_authorizations —
-- la validation d'un mineur doit vérifier une autorisation valide, ce
-- qui n'existe pas encore à ce stade. Seul reject_team_membership (qui
-- ne dépend d'aucune autorisation) est inclus ici.
--
-- Toutes les fonctions de création d'invitation qui doivent créer un
-- compte auth.users réel (admin.auth.admin.inviteUserByEmail) vivent
-- dans l'Edge Function clubplus-family-invite, pas ici — une fonction
-- Postgres ne peut pas appeler l'API Admin de Supabase Auth. Cette
-- migration ne fait que la partie données (lignes d'invitation) que le
-- destinataire acceptera lui-même via accept_player_invitation /
-- accept_parent_invitation une fois son compte actif.
-- ============================================================

-- ── 1. MODE DE VALIDATION PAR CLUB ──
-- Dénormalisé sur chaque membership_requests à la création (voir RPC plus
-- bas) pour ne jamais changer les règles d'une demande déjà en cours si
-- l'admin modifie ce réglage après coup.

alter table clubs add column if not exists membership_validation_mode text
  check (membership_validation_mode in ('standard','controle','double')) default 'standard';

-- ── 2. TABLES ──

create table if not exists team_invite_codes (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete cascade not null,
  code text unique not null,
  actif boolean default true,
  expire_at timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_tic_team on team_invite_codes(team_id);

create table if not exists player_invitations (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete set null,
  email text not null,
  prenom text,
  nom text,
  date_naissance date,
  invited_by uuid references auth.users on delete set null,
  statut text check (statut in ('envoyee','acceptee','expiree','annulee')) not null default 'envoyee',
  resulting_request_id uuid,
  created_at timestamptz default now()
);

create index if not exists idx_pinv_club on player_invitations(club_id, email);

create table if not exists parent_invitations (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  player_id uuid references player_profiles(id) on delete cascade,
  email text not null,
  prenom text,
  nom text,
  invited_by uuid references auth.users on delete set null,
  statut text check (statut in ('envoyee','acceptee','expiree','annulee')) not null default 'envoyee',
  created_at timestamptz default now()
);

create index if not exists idx_parinv_club on parent_invitations(club_id, email);

create table if not exists membership_requests (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete set null,
  requested_by_user_id uuid references auth.users on delete set null,
  player_id uuid references player_profiles(id) on delete cascade,
  parent_id uuid references parent_profiles(id) on delete set null,
  source text check (source in ('invitation','spontanee','code_equipe')) not null,
  invite_code_id uuid references team_invite_codes(id) on delete set null,
  statut text check (statut in (
    'a_verifier','autorisation_manquante','en_attente_parent','pret_a_valider',
    'validee','refusee','doublon_signale','transferee_admin'
  )) not null default 'a_verifier',
  validation_mode text check (validation_mode in ('standard','controle','double')),
  educateur_confirme_par uuid references auth.users on delete set null,
  educateur_confirme_at timestamptz,
  admin_valide_par uuid references auth.users on delete set null,
  admin_valide_at timestamptz,
  refus_motif text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table player_invitations
  add constraint fk_pi_request foreign key (resulting_request_id) references membership_requests(id) on delete set null;

drop trigger if exists trg_mr_upd on membership_requests;
create trigger trg_mr_upd before update on membership_requests
  for each row execute procedure update_updated_at_generic();

create index if not exists idx_mr_club on membership_requests(club_id, statut);
create index if not exists idx_mr_team on membership_requests(team_id, statut);
create index if not exists idx_mr_player on membership_requests(player_id);

create table if not exists membership_request_events (
  id uuid default gen_random_uuid() primary key,
  request_id uuid references membership_requests(id) on delete cascade not null,
  event_type text not null,
  acted_by uuid references auth.users on delete set null,
  note text,
  created_at timestamptz default now()
);

create index if not exists idx_mre_request on membership_request_events(request_id);

-- ── 3. RLS ──

alter table team_invite_codes enable row level security;
alter table player_invitations enable row level security;
alter table parent_invitations enable row level security;
alter table membership_requests enable row level security;
alter table membership_request_events enable row level security;

-- team_invite_codes : lecture/désactivation par l'éducateur habilité sur
-- l'équipe ou l'admin du club. Le champ `code` lui-même n'est jamais écrit
-- par cette policy (généré uniquement par create_team_invite_code /
-- rotate_team_invite_code ci-dessous) — même caveat déjà documenté ailleurs
-- (clubs_admin_update, v9) : RLS est row-level, pas column-level, ce sont
-- des dirigeants déjà de confiance qui ont ce droit.
drop policy if exists "tic_manager_select" on team_invite_codes;
create policy "tic_manager_select" on team_invite_codes for select using (
  is_team_educateur(team_id) or is_club_admin(club_id)
);
drop policy if exists "tic_manager_update" on team_invite_codes;
create policy "tic_manager_update" on team_invite_codes for update using (
  is_team_educateur(team_id) or is_club_admin(club_id)
);

-- player_invitations / parent_invitations : consultées par les dirigeants
-- habilités (création réservée à l'Edge Function clubplus-family-invite,
-- service role) et par le destinataire lui-même une fois connecté avec le
-- même e-mail, pour afficher « vous avez une invitation en attente ».
-- auth.email() est le helper Supabase standard pour lire l'e-mail du JWT
-- sans nécessiter d'accès direct à auth.users.
drop policy if exists "pinv_manager_select" on player_invitations;
create policy "pinv_manager_select" on player_invitations for select using (
  is_club_admin(club_id) or (team_id is not null and is_team_educateur(team_id))
);
drop policy if exists "pinv_recipient_select" on player_invitations;
create policy "pinv_recipient_select" on player_invitations for select using (email = auth.email());

drop policy if exists "parinv_manager_select" on parent_invitations;
create policy "parinv_manager_select" on parent_invitations for select using (
  is_club_admin(club_id)
  or (player_id is not null and exists (
    select 1 from team_memberships tm where tm.player_id = parent_invitations.player_id and is_team_educateur(tm.team_id)
  ))
);
drop policy if exists "parinv_recipient_select" on parent_invitations;
create policy "parinv_recipient_select" on parent_invitations for select using (email = auth.email());

-- membership_requests / membership_request_events : demandeur, joueur
-- concerné, parent confirmé, éducateur habilité sur l'équipe, admin du
-- club. Écriture réservée aux RPC ci-dessous — même logique que
-- club_requests (v4) : jamais de policy UPDATE ouverte pour des
-- transitions d'état sensibles.
drop policy if exists "mr_requester_select" on membership_requests;
create policy "mr_requester_select" on membership_requests for select using (requested_by_user_id = auth.uid());

drop policy if exists "mr_player_select" on membership_requests;
create policy "mr_player_select" on membership_requests for select using (player_id is not null and is_own_player(player_id));

drop policy if exists "mr_parent_select" on membership_requests;
create policy "mr_parent_select" on membership_requests for select using (player_id is not null and is_confirmed_parent_of(player_id));

drop policy if exists "mr_educateur_select" on membership_requests;
create policy "mr_educateur_select" on membership_requests for select using (team_id is not null and is_team_educateur(team_id));

drop policy if exists "mr_admin_select" on membership_requests;
create policy "mr_admin_select" on membership_requests for select using (is_club_admin(club_id));

drop policy if exists "mre_select" on membership_request_events;
create policy "mre_select" on membership_request_events for select using (
  exists (
    select 1 from membership_requests mr
    where mr.id = membership_request_events.request_id
      and (
        mr.requested_by_user_id = auth.uid()
        or (mr.player_id is not null and (is_own_player(mr.player_id) or is_confirmed_parent_of(mr.player_id)))
        or (mr.team_id is not null and is_team_educateur(mr.team_id))
        or is_club_admin(mr.club_id)
      )
  )
);

-- ── 4. FONCTIONS RPC ──

-- Détermine le statut de départ d'une demande à partir de l'âge, calculé
-- serveur (sv_age_bracket, v13) — jamais une valeur transmise par le client.
-- Un mineur part toujours en attente parent : la bascule vers un statut
-- prêt-à-valider dépend de l'autorisation parentale, ajoutée en phase 4.
create or replace function initial_request_status(p_date_naissance date)
returns text language sql immutable as $$
  select case when sv_age_bracket(p_date_naissance) = 'majeur' then 'a_verifier' else 'en_attente_parent' end;
$$;

create or replace function generate_team_invite_code(p_team_id uuid)
returns text language plpgsql as $$
declare
  v_cat text;
  v_code text;
  v_tries int := 0;
begin
  select upper(regexp_replace(coalesce(categorie, name), '[^a-zA-Z0-9]', '', 'g')) into v_cat
  from club_teams where id = p_team_id;
  v_cat := coalesce(nullif(left(v_cat, 8), ''), 'EQUIPE');
  loop
    v_code := 'SV-' || v_cat || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from team_invite_codes where code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 20 then raise exception 'Impossible de générer un code unique, réessayez'; end if;
  end loop;
  return v_code;
end;
$$;

create or replace function create_team_invite_code(p_team_id uuid)
returns team_invite_codes
language plpgsql security definer set search_path = public as $$
declare
  v_club_id uuid;
  v_row team_invite_codes;
begin
  select club_id into v_club_id from club_teams where id = p_team_id;
  if v_club_id is null then raise exception 'Équipe introuvable'; end if;
  if not (is_team_educateur(p_team_id) or is_club_admin(v_club_id)) then
    raise exception 'Non autorisé';
  end if;

  insert into team_invite_codes (club_id, team_id, code, created_by)
  values (v_club_id, p_team_id, generate_team_invite_code(p_team_id), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function create_team_invite_code(uuid) from public;
grant execute on function create_team_invite_code(uuid) to authenticated;

create or replace function rotate_team_invite_code(p_code_id uuid)
returns team_invite_codes
language plpgsql security definer set search_path = public as $$
declare
  v_row team_invite_codes;
begin
  select * into v_row from team_invite_codes where id = p_code_id;
  if v_row.id is null then raise exception 'Code introuvable'; end if;
  if not (is_team_educateur(v_row.team_id) or is_club_admin(v_row.club_id)) then
    raise exception 'Non autorisé';
  end if;

  update team_invite_codes
  set code = generate_team_invite_code(v_row.team_id), actif = true
  where id = p_code_id
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function rotate_team_invite_code(uuid) from public;
grant execute on function rotate_team_invite_code(uuid) to authenticated;

-- Accepte une invitation joueur (majeur, ou 14-17 dont le compte a été activé
-- ultérieurement en phase 4) : crée la fiche joueur si besoin, ouvre une
-- membership_requests. Appelée par l'invité lui-même une fois son mot de
-- passe défini (le compte auth.users existe déjà, créé par l'Edge Function
-- clubplus-family-invite via inviteUserByEmail).
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

  update player_invitations set statut = 'acceptee', resulting_request_id = v_req.id where id = p_invitation_id;
  insert into membership_request_events (request_id, event_type, acted_by, note) values (v_req.id, 'creee', auth.uid(), 'via invitation joueur');
  return v_req;
end;
$$;
revoke all on function accept_player_invitation(uuid) from public;
grant execute on function accept_player_invitation(uuid) to authenticated;

-- Accepte une invitation parent : crée le profil parent si besoin, confirme
-- le lien avec le joueur si l'invitation en désignait un.
create or replace function accept_parent_invitation(p_invitation_id uuid)
returns parent_player_relationships
language plpgsql security definer set search_path = public as $$
declare
  v_inv parent_invitations;
  v_parent parent_profiles;
  v_rel parent_player_relationships;
begin
  select * into v_inv from parent_invitations where id = p_invitation_id;
  if v_inv.id is null then raise exception 'Invitation introuvable'; end if;
  if v_inv.statut <> 'envoyee' then raise exception 'Invitation déjà traitée'; end if;
  if v_inv.email is distinct from auth.email() then raise exception 'Cette invitation ne correspond pas à votre compte'; end if;

  select * into v_parent from parent_profiles where user_id = auth.uid();
  if v_parent.id is null then
    insert into parent_profiles (user_id, prenom, nom) values (auth.uid(), v_inv.prenom, v_inv.nom)
    returning * into v_parent;
  end if;

  update parent_invitations set statut = 'acceptee' where id = p_invitation_id;

  if v_inv.player_id is not null then
    insert into parent_player_relationships (parent_id, player_id, statut, confirmed_at)
    values (v_parent.id, v_inv.player_id, 'confirme', now())
    on conflict (parent_id, player_id) do update set statut = 'confirme', confirmed_at = now()
    returning * into v_rel;
  end if;

  return v_rel;
end;
$$;
revoke all on function accept_parent_invitation(uuid) from public;
grant execute on function accept_parent_invitation(uuid) to authenticated;

-- Demande spontanée ou via code, le demandeur EST le joueur (majeur, ou
-- 14-17 déjà titulaire d'un compte). Si l'appelant n'a pas encore de fiche
-- dans ce club, la crée avec les infos fournies (première demande).
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

  insert into membership_request_events (request_id, event_type, acted_by) values (v_req.id, 'creee', auth.uid());
  return v_req;
end;
$$;
revoke all on function request_team_membership_as_player(uuid, uuid, text, text, text, date) from public;
grant execute on function request_team_membership_as_player(uuid, uuid, text, text, text, date) to authenticated;

-- Demande spontanée ou via code, le demandeur est un PARENT inscrivant un
-- enfant qui n'a pas de compte (le cas < 14 ans, mais aussi utilisable pour
-- un 14-17 dont le parent fait la démarche). Crée systématiquement une
-- nouvelle fiche joueur : ce point d'entrée est pour une première demande,
-- pas pour rattacher un enfant déjà connu à une équipe supplémentaire
-- (ça, c'est move_player_to_team, phase 12, côté admin).
create or replace function request_team_membership_for_child(
  p_club_id uuid,
  p_team_id uuid,
  p_prenom text,
  p_nom text,
  p_date_naissance date,
  p_invite_code text default null
)
returns membership_requests
language plpgsql security definer set search_path = public as $$
declare
  v_parent parent_profiles;
  v_player player_profiles;
  v_code team_invite_codes;
  v_req membership_requests;
  v_source text;
begin
  select * into v_parent from parent_profiles where user_id = auth.uid();
  if v_parent.id is null then
    insert into parent_profiles (user_id) values (auth.uid()) returning * into v_parent;
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

  insert into player_profiles (club_id, prenom, nom, date_naissance, account_status, created_by)
  values (p_club_id, p_prenom, p_nom, p_date_naissance, 'sans_compte', auth.uid())
  returning * into v_player;

  insert into parent_player_relationships (parent_id, player_id, statut, confirmed_at)
  values (v_parent.id, v_player.id, 'confirme', now());

  insert into membership_requests (club_id, team_id, requested_by_user_id, player_id, parent_id, source, invite_code_id, statut, validation_mode)
  values (
    p_club_id, p_team_id, auth.uid(), v_player.id, v_parent.id, v_source, v_code.id,
    initial_request_status(p_date_naissance),
    (select membership_validation_mode from clubs where id = p_club_id)
  )
  returning * into v_req;

  insert into membership_request_events (request_id, event_type, acted_by) values (v_req.id, 'creee', auth.uid());
  return v_req;
end;
$$;
revoke all on function request_team_membership_for_child(uuid, uuid, text, text, date, text) from public;
grant execute on function request_team_membership_for_child(uuid, uuid, text, text, date, text) to authenticated;

-- Refus d'une demande — ne dépend d'aucune autorisation parentale, peut
-- vivre dès la phase 3. La validation (acceptation) attend la phase 4.
create or replace function reject_team_membership(p_request_id uuid, p_motif text default null)
returns membership_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req membership_requests;
begin
  select * into v_req from membership_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Demande introuvable'; end if;
  if v_req.statut in ('validee', 'refusee') then raise exception 'Cette demande a déjà été traitée'; end if;
  if not (
    (v_req.team_id is not null and is_team_educateur(v_req.team_id))
    or is_club_admin(v_req.club_id)
  ) then
    raise exception 'Non autorisé';
  end if;

  update membership_requests set statut = 'refusee', refus_motif = p_motif
  where id = p_request_id
  returning * into v_req;

  insert into membership_request_events (request_id, event_type, acted_by, note) values (p_request_id, 'refusee', auth.uid(), p_motif);
  return v_req;
end;
$$;
revoke all on function reject_team_membership(uuid, text) from public;
grant execute on function reject_team_membership(uuid, text) to authenticated;
