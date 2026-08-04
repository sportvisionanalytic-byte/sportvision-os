-- ============================================================
-- SPORTVISION CLUB+ — Migration v15
-- Suite de migration-clubplus-v1 à v14.sql. Idempotente.
--
-- Portée : Phase 4 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md) — autorisations
-- parentales, et le blocage serveur réel qui empêche d'activer un
-- compte mineur sans autorisation valide. Complète aussi le circuit
-- de validation des demandes d'adhésion laissé volontairement ouvert
-- en v14 (validate_team_membership, confirm_request_educateur), qui ne
-- pouvait pas être écrit avant que parental_authorizations existe.
--
-- Le gate obligatoire retenu pour activer un mineur : creation_compte +
-- acces_clubplus + traitement_donnees doivent être 'valide'. Les 9
-- autres types d'autorisation (droit_image, diffusion_*, telechargement,
-- communications, projet_collectif, commandes_paiements) restent
-- consultables/transmissibles mais ne bloquent pas l'admission — ce sont
-- des autorisations d'usage, pas des conditions d'accès. Cette
-- distinction n'est pas dans le prompt d'origine tel quel, c'est une
-- interprétation nécessaire pour rendre le blocage opérant : si les 12
-- types bloquaient, aucun club n'aurait jamais de mineur admis avant
-- d'avoir collecté 12 signatures différentes.
--
-- Textes juridiques des authorization_versions ci-dessous : PROVISOIRES,
-- à valider juridiquement avant toute mise en production (déjà noté
-- dans l'architecture, §10).
-- ============================================================

-- ── 1. TABLES ──

create table if not exists authorization_types (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  label text not null,
  description text,
  obligatoire boolean default true,
  actif boolean default true
);

create table if not exists authorization_versions (
  id uuid default gen_random_uuid() primary key,
  authorization_type_id uuid references authorization_types(id) not null,
  club_id uuid references clubs(id) on delete cascade,
  version_label text not null,
  texte text not null,
  actif boolean default true,
  created_at timestamptz default now()
);

create index if not exists idx_atv_type on authorization_versions(authorization_type_id, club_id, actif);

create table if not exists parental_authorizations (
  id uuid default gen_random_uuid() primary key,
  player_id uuid references player_profiles(id) on delete cascade not null,
  parent_id uuid references parent_profiles(id) on delete set null,
  authorization_type_id uuid references authorization_types(id) not null,
  version_id uuid references authorization_versions(id) not null,
  statut text check (statut in (
    'non_transmise','en_attente','transmise','a_verifier','valide',
    'incomplete','refusee','expiree','retiree','remplacee'
  )) not null default 'non_transmise',
  methode text check (methode in ('deja_detenue','import_document','signature_numerique')),
  support_autorise text[],
  finalite text,
  document_url text,
  date_signature timestamptz,
  date_debut date,
  date_expiration date,
  preuve jsonb,
  verified_by uuid references auth.users on delete set null,
  verified_at timestamptz,
  retrait_motif text,
  retrait_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (player_id, authorization_type_id, version_id)
);

drop trigger if exists trg_pa_upd on parental_authorizations;
create trigger trg_pa_upd before update on parental_authorizations
  for each row execute procedure update_updated_at_generic();

create index if not exists idx_pa_player on parental_authorizations(player_id, statut);

create table if not exists authorization_events (
  id uuid default gen_random_uuid() primary key,
  authorization_id uuid references parental_authorizations(id) on delete cascade not null,
  event_type text not null,
  acted_by uuid references auth.users on delete set null,
  note text,
  created_at timestamptz default now()
);

create index if not exists idx_ae_authorization on authorization_events(authorization_id);

-- ── 2. RLS ──

alter table authorization_types enable row level security;
alter table authorization_versions enable row level security;
alter table parental_authorizations enable row level security;
alter table authorization_events enable row level security;

drop policy if exists "att_read" on authorization_types;
create policy "att_read" on authorization_types for select using (actif = true);

drop policy if exists "atv_read" on authorization_versions;
create policy "atv_read" on authorization_versions for select using (actif = true);

-- parental_authorizations : le parent concerné et le joueur lui-même (s'il a
-- un compte, 14-17) voient le détail complet, y compris document_url/preuve.
-- L'admin du club voit tout également. PAS d'accès éducateur ici,
-- volontairement (cf. architecture §27 : « ne doit pas accéder aux
-- documents parentaux complets sans permission spécifique ») — un statut
-- agrégé sûr pour l'éducateur (sans document_url/preuve) reste à construire
-- en vue dédiée quand l'interface de validation (phase 5) en aura besoin.
drop policy if exists "pa_parent_select" on parental_authorizations;
create policy "pa_parent_select" on parental_authorizations for select using (is_confirmed_parent_of(player_id));

drop policy if exists "pa_player_select" on parental_authorizations;
create policy "pa_player_select" on parental_authorizations for select using (is_own_player(player_id));

drop policy if exists "pa_admin_select" on parental_authorizations;
create policy "pa_admin_select" on parental_authorizations for select using (
  is_club_admin((select club_id from player_profiles where id = parental_authorizations.player_id))
);

drop policy if exists "ae_select" on authorization_events;
create policy "ae_select" on authorization_events for select using (
  exists (
    select 1 from parental_authorizations pa
    where pa.id = authorization_events.authorization_id
      and (
        is_confirmed_parent_of(pa.player_id)
        or is_own_player(pa.player_id)
        or is_club_admin((select club_id from player_profiles where id = pa.player_id))
      )
  )
);

-- ── 3. DONNÉES DE RÉFÉRENCE (textes provisoires, cf. en-tête) ──

insert into authorization_types (code, label, description, obligatoire) values
  ('creation_compte', 'Création du compte joueur', 'Autorise la création d''un compte personnel Club+ pour le mineur.', true),
  ('acces_clubplus', 'Accès à Club+', 'Autorise l''accès du mineur à l''application Club+ et à ses contenus d''équipe.', true),
  ('traitement_donnees', 'Traitement des données', 'Autorise le traitement des données personnelles du mineur nécessaires au fonctionnement de Club+.', true),
  ('consultation_medias', 'Consultation des médias de l''équipe', 'Autorise le mineur/parent à consulter les photos et vidéos de l''équipe.', false),
  ('droit_image', 'Droit à l''image', 'Autorise l''utilisation de l''image du mineur sur les médias captés par le club/SportVision.', false),
  ('diffusion_interne', 'Diffusion interne Club+', 'Autorise la diffusion des médias du mineur au sein de l''application Club+.', false),
  ('diffusion_reseaux', 'Diffusion réseaux sociaux du club', 'Autorise la diffusion des médias du mineur sur les réseaux sociaux du club.', false),
  ('diffusion_sportvision', 'Diffusion supports SportVision', 'Autorise la diffusion des médias du mineur sur les supports de communication SportVision.', false),
  ('telechargement', 'Téléchargement des contenus', 'Autorise le téléchargement des médias où figure le mineur.', false),
  ('communications', 'Communications', 'Autorise l''envoi de communications relatives au mineur (notifications, e-mails).', false),
  ('projet_collectif', 'Participation à un projet collectif', 'Autorise la participation du mineur à un projet de financement collectif d''équipe.', false),
  ('commandes_paiements', 'Commandes et paiements', 'Autorise le parent à commander et payer des prestations SportVision pour le compte du mineur.', false)
on conflict (code) do nothing;

insert into authorization_versions (authorization_type_id, club_id, version_label, texte)
select id, null, 'v0-provisoire', 'Texte provisoire — ' || label || '. ' || coalesce(description, '') ||
  ' Ce texte doit être remplacé par un texte validé juridiquement avant toute mise en production.'
from authorization_types
where not exists (
  select 1 from authorization_versions av where av.authorization_type_id = authorization_types.id and av.club_id is null
);

-- ── 4. AMORÇAGE DU DOSSIER D'AUTORISATION D'UN MINEUR ──
-- Crée une ligne 'non_transmise' pour chaque type actif, dès la première
-- demande d'un mineur — pas d'action manuelle "demander une autorisation"
-- séparée nécessaire pour le cas courant (request_parental_authorization du
-- prompt d'origine est donc fusionnée ici plutôt que dupliquée en RPC à
-- part). Reprend la version club-spécifique si elle existe, sinon la
-- version SportVision par défaut (club_id null) semée ci-dessus.

create or replace function bootstrap_player_authorizations(p_player_id uuid, p_club_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_type record;
  v_version_id uuid;
begin
  for v_type in select id from authorization_types where actif = true loop
    select id into v_version_id from authorization_versions
      where authorization_type_id = v_type.id and club_id = p_club_id and actif = true
      order by created_at desc limit 1;
    if v_version_id is null then
      select id into v_version_id from authorization_versions
        where authorization_type_id = v_type.id and club_id is null and actif = true
        order by created_at desc limit 1;
    end if;
    if v_version_id is not null then
      insert into parental_authorizations (player_id, authorization_type_id, version_id, statut)
      values (p_player_id, v_type.id, v_version_id, 'non_transmise')
      on conflict (player_id, authorization_type_id, version_id) do nothing;
    end if;
  end loop;
end;
$$;
-- Fonction interne uniquement (appelée par d'autres fonctions SECURITY
-- DEFINER, jamais directement par un client) : sans ce revoke, PostgREST
-- l'exposerait quand même en RPC publique par défaut (Postgres accorde
-- EXECUTE à PUBLIC sur toute nouvelle fonction, sauf révocation explicite).
revoke all on function bootstrap_player_authorizations(uuid, uuid) from public;

-- ── 5. RECALCUL DE L'ÉTAT D'UNE DEMANDE SUITE À UNE VÉRIFICATION D'AUTORISATION ──

create or replace function recompute_request_readiness(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_authorized boolean;
begin
  select bool_and(pa.statut = 'valide') into v_authorized
  from authorization_types at
  join parental_authorizations pa on pa.authorization_type_id = at.id and pa.player_id = p_player_id
  where at.code in ('creation_compte', 'acces_clubplus', 'traitement_donnees');

  if v_authorized is true then
    update membership_requests
    set statut = 'pret_a_valider'
    where player_id = p_player_id and statut in ('autorisation_manquante', 'en_attente_parent');
  else
    update membership_requests
    set statut = 'autorisation_manquante'
    where player_id = p_player_id and statut = 'en_attente_parent';
  end if;
end;
$$;
revoke all on function recompute_request_readiness(uuid) from public;

-- ── 6. REDÉFINITION DES FONCTIONS DE DEMANDE (v14) POUR AMORCER LE DOSSIER
--    D'UN MINEUR AUTOMATIQUEMENT — mêmes signatures, corps étendu. ──

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

  if sv_age_bracket(p_date_naissance) <> 'majeur' then
    perform bootstrap_player_authorizations(v_player.id, p_club_id);
  end if;

  insert into membership_request_events (request_id, event_type, acted_by) values (v_req.id, 'creee', auth.uid());
  return v_req;
end;
$$;

-- ── 7. AUTORISATIONS PARENTALES — RPC ──

create or replace function submit_parental_authorization(
  p_authorization_id uuid,
  p_methode text,
  p_support_autorise text[] default null,
  p_document_url text default null,
  p_preuve jsonb default null,
  p_date_debut date default current_date,
  p_date_expiration date default null
)
returns parental_authorizations
language plpgsql security definer set search_path = public as $$
declare
  v_auth parental_authorizations;
  v_club_id uuid;
  v_is_parent boolean;
  v_is_staff boolean;
begin
  select * into v_auth from parental_authorizations where id = p_authorization_id;
  if v_auth.id is null then raise exception 'Autorisation introuvable'; end if;
  if p_methode not in ('deja_detenue', 'import_document', 'signature_numerique') then
    raise exception 'Méthode invalide';
  end if;
  if v_auth.statut in ('valide', 'retiree') then raise exception 'Cette autorisation n''est plus modifiable dans cet état'; end if;

  select club_id into v_club_id from player_profiles where id = v_auth.player_id;
  v_is_parent := is_confirmed_parent_of(v_auth.player_id);
  v_is_staff := is_club_admin(v_club_id)
    or exists (select 1 from team_memberships tm where tm.player_id = v_auth.player_id and is_team_educateur(tm.team_id));

  if p_methode = 'deja_detenue' then
    if not v_is_staff then raise exception 'Seul un dirigeant du club peut déclarer une autorisation déjà détenue'; end if;
    update parental_authorizations set
      methode = p_methode, support_autorise = p_support_autorise, date_debut = p_date_debut,
      date_expiration = p_date_expiration, statut = 'valide',
      verified_by = auth.uid(), verified_at = now(), date_signature = now()
    where id = p_authorization_id
    returning * into v_auth;
    insert into authorization_events (authorization_id, event_type, acted_by) values (p_authorization_id, 'verifiee', auth.uid());
  else
    if not v_is_parent then raise exception 'Seul le parent lié au joueur peut transmettre cette autorisation'; end if;
    update parental_authorizations set
      parent_id = (select id from parent_profiles where user_id = auth.uid()),
      methode = p_methode, support_autorise = p_support_autorise, document_url = p_document_url,
      preuve = p_preuve, date_signature = now(), date_debut = p_date_debut, date_expiration = p_date_expiration,
      statut = 'a_verifier'
    where id = p_authorization_id
    returning * into v_auth;
    insert into authorization_events (authorization_id, event_type, acted_by)
      values (p_authorization_id, case when p_methode = 'import_document' then 'document_importe' else 'signature_numerique' end, auth.uid());
  end if;

  perform recompute_request_readiness(v_auth.player_id);
  return v_auth;
end;
$$;
revoke all on function submit_parental_authorization(uuid, text, text[], text, jsonb, date, date) from public;
grant execute on function submit_parental_authorization(uuid, text, text[], text, jsonb, date, date) to authenticated;

-- Vérification réservée à l'admin du club (pas à l'éducateur, cf. RLS §2 ci-dessus).
create or replace function verify_parental_authorization(p_authorization_id uuid, p_decision text, p_motif text default null)
returns parental_authorizations
language plpgsql security definer set search_path = public as $$
declare
  v_auth parental_authorizations;
  v_club_id uuid;
begin
  select * into v_auth from parental_authorizations where id = p_authorization_id;
  if v_auth.id is null then raise exception 'Autorisation introuvable'; end if;
  if p_decision not in ('valide', 'refusee', 'incomplete') then raise exception 'Décision invalide'; end if;

  select club_id into v_club_id from player_profiles where id = v_auth.player_id;
  if not is_club_admin(v_club_id) then raise exception 'Seul un administrateur du club peut vérifier une autorisation'; end if;

  update parental_authorizations set
    statut = p_decision, verified_by = auth.uid(), verified_at = now(),
    retrait_motif = case when p_decision = 'refusee' then p_motif else retrait_motif end
  where id = p_authorization_id
  returning * into v_auth;

  insert into authorization_events (authorization_id, event_type, acted_by, note)
    values (p_authorization_id, case p_decision when 'valide' then 'verifiee' when 'refusee' then 'refusee' else 'verifiee' end, auth.uid(), p_motif);

  perform recompute_request_readiness(v_auth.player_id);
  return v_auth;
end;
$$;
revoke all on function verify_parental_authorization(uuid, text, text) from public;
grant execute on function verify_parental_authorization(uuid, text, text) to authenticated;

-- Retrait : par le parent lui-même ou l'admin. Les effets en cascade (masquer
-- des médias, notifier) sont différés aux phases où media_access_rules /
-- family_notifications existent — seule la trace du retrait est posée ici.
create or replace function withdraw_parental_authorization(p_authorization_id uuid, p_motif text default null)
returns parental_authorizations
language plpgsql security definer set search_path = public as $$
declare
  v_auth parental_authorizations;
  v_club_id uuid;
begin
  select * into v_auth from parental_authorizations where id = p_authorization_id;
  if v_auth.id is null then raise exception 'Autorisation introuvable'; end if;

  select club_id into v_club_id from player_profiles where id = v_auth.player_id;
  if not (is_confirmed_parent_of(v_auth.player_id) or is_club_admin(v_club_id)) then
    raise exception 'Non autorisé';
  end if;

  update parental_authorizations set statut = 'retiree', retrait_motif = p_motif, retrait_at = now()
  where id = p_authorization_id
  returning * into v_auth;

  insert into authorization_events (authorization_id, event_type, acted_by, note) values (p_authorization_id, 'retiree', auth.uid(), p_motif);
  return v_auth;
end;
$$;
revoke all on function withdraw_parental_authorization(uuid, text) from public;
grant execute on function withdraw_parental_authorization(uuid, text) to authenticated;

-- ── 8. CIRCUIT DE VALIDATION DES DEMANDES (complète v14) ──

-- Étape 1 du mode « double validation » : l'éducateur confirme l'identité/
-- l'équipe, sans activer l'accès. L'admin valide ensuite (étape 2, ci-dessous).
create or replace function confirm_request_educateur(p_request_id uuid)
returns membership_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req membership_requests;
begin
  select * into v_req from membership_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Demande introuvable'; end if;
  if v_req.statut in ('validee', 'refusee') then raise exception 'Cette demande a déjà été traitée'; end if;
  if v_req.team_id is null or not is_team_educateur(v_req.team_id) then raise exception 'Non autorisé'; end if;

  update membership_requests
  set educateur_confirme_par = auth.uid(), educateur_confirme_at = now()
  where id = p_request_id
  returning * into v_req;

  insert into membership_request_events (request_id, event_type, acted_by) values (p_request_id, 'confirmee_educateur', auth.uid());
  return v_req;
end;
$$;
revoke all on function confirm_request_educateur(uuid) from public;
grant execute on function confirm_request_educateur(uuid) to authenticated;

-- Validation finale : gate serveur réel pour un mineur (jamais uniquement un
-- bouton désactivé côté UI) — creation_compte + acces_clubplus +
-- traitement_donnees doivent être 'valide', sans quoi la demande repasse
-- 'autorisation_manquante' et la fonction échoue explicitement.
create or replace function validate_team_membership(p_request_id uuid)
returns membership_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req membership_requests;
  v_player player_profiles;
  v_bracket text;
  v_authorized boolean;
begin
  select * into v_req from membership_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Demande introuvable'; end if;
  if v_req.statut in ('validee', 'refusee') then raise exception 'Cette demande a déjà été traitée'; end if;

  if v_req.validation_mode = 'double' then
    if v_req.educateur_confirme_at is null then
      raise exception 'Cette demande doit d''abord être confirmée par un éducateur (mode double validation)';
    end if;
    if not is_club_admin(v_req.club_id) then raise exception 'Seul un administrateur peut valider en mode double validation'; end if;
  elsif v_req.validation_mode = 'controle' then
    if not is_club_admin(v_req.club_id) then raise exception 'Seul un administrateur peut valider sur ce club'; end if;
  else
    if not (is_club_admin(v_req.club_id) or (v_req.team_id is not null and is_team_educateur(v_req.team_id))) then
      raise exception 'Non autorisé';
    end if;
  end if;

  select * into v_player from player_profiles where id = v_req.player_id;
  v_bracket := sv_age_bracket(v_player.date_naissance);

  if v_bracket <> 'majeur' then
    select bool_and(pa.statut = 'valide') into v_authorized
    from authorization_types at
    join parental_authorizations pa on pa.authorization_type_id = at.id and pa.player_id = v_player.id
    where at.code in ('creation_compte', 'acces_clubplus', 'traitement_donnees');

    if v_authorized is not true then
      update membership_requests set statut = 'autorisation_manquante' where id = p_request_id;
      raise exception 'Autorisation parentale manquante ou invalide — impossible de valider';
    end if;
  end if;

  update membership_requests
  set statut = 'validee', admin_valide_par = auth.uid(), admin_valide_at = now()
  where id = p_request_id
  returning * into v_req;

  if v_req.team_id is not null then
    insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_req.player_id, v_req.team_id, v_req.club_id, coalesce((select saison from clubs where id = v_req.club_id), '2026-2027'), 'active')
    on conflict (player_id, team_id, saison) do update set statut = 'active';
  end if;

  update player_profiles
  set account_status = 'actif'
  where id = v_req.player_id and account_status in ('en_attente_activation') and user_id is not null;

  insert into membership_request_events (request_id, event_type, acted_by) values (p_request_id, 'validee', auth.uid());
  return v_req;
end;
$$;
revoke all on function validate_team_membership(uuid) from public;
grant execute on function validate_team_membership(uuid) to authenticated;
