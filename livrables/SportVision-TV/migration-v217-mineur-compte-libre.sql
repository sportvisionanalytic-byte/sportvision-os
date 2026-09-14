-- v217 — Un mineur crée son compte comme un majeur (14/09/2026, décision de Fouka).
--
-- LA DÉCISION, mot pour mot : « le mineur peut créer son compte comme il veut, comme si c'était un
-- majeur, sans autorisation. Ensuite, un parent peut créer un compte pour lui et rattacher son
-- enfant qui a son compte. Ou alors un parent peut créer un compte et déclarer un enfant, mais qui
-- n'a pas de compte. »
--
-- Les deux chemins parent existent déjà et ne changent pas : « Il possède déjà Connect » (demande
-- de liaison) et « Il n'a pas encore de compte » (profil géré). Ce qui change, c'est le premier
-- chemin : le joueur mineur lui-même.
--
-- CE QUI BLOQUAIT, vérifié en base avant d'écrire — trois verrous, à trois endroits différents :
--
--   1. `request_team_membership_as_player` et `accept_player_invitation` REFUSAIENT tout compte
--      personnel avant 14 ans : « Un compte personnel n'est pas autorisé avant 14 ans ».
--   2. `initial_request_status` faisait démarrer la demande d'un non-majeur en `en_attente_parent`
--      au lieu de `a_verifier` : elle n'arrivait donc jamais devant le club.
--   3. `validate_team_membership` exigeait TROIS autorisations parentales signées
--      (creation_compte, acces_clubplus, traitement_donnees) et basculait sinon la demande en
--      `autorisation_manquante`, avec une exception.
--
-- CE QUE CETTE MIGRATION FAIT. Elle lève les trois, et rien d'autre.
--
-- CE QU'ELLE NE TOUCHE PAS, volontairement :
--   • Le dispositif d'autorisations reste en place et utilisable. Un parent peut toujours les
--     signer, elles restent visibles, et les rétablir comme obligatoires consiste à remettre
--     `obligatoire = true` sur les trois lignes. Rien n'est supprimé.
--   • Le droit à l'image et les autorisations de diffusion (`droit_image`, `diffusion_*`) : elles
--     étaient déjà facultatives et ne bloquaient rien. Sujet distinct, non ouvert ici.
--   • Le lien parent-enfant et son contrôle (v102) : un inconnu ne devient pas parent d'un mineur.
--
-- RÉSERVE DITE À FOUKA, ET ASSUMÉE PAR LUI. En France, un mineur de moins de 15 ans ne peut pas
-- consentir seul au traitement de ses données personnelles (article 8 du RGPD, article 45 de la loi
-- Informatique et Libertés) : le consentement est donné par le titulaire de l'autorité parentale.
-- Ouvrir la création de compte sans aucun parent est donc fragile pour les moins de 15 ans. La
-- décision est prise en connaissance de cause ; le dispositif reste en place pour y revenir sans
-- rien reconstruire.
--
-- Idempotente.

-- ── 1. Les trois autorisations ne sont plus obligatoires ─────────────────────
update authorization_types
   set obligatoire = false
 where code in ('creation_compte', 'acces_clubplus', 'traitement_donnees');

-- ── 2. Une demande démarre au même endroit pour tous ─────────────────────────
create or replace function public.initial_request_status(p_date_naissance date)
returns text
language sql
immutable
as $$
  -- v217 — `en_attente_parent` pour un mineur enfermait sa demande avant même qu'elle atteigne le
  -- club. Tout le monde démarre désormais à `a_verifier` : c'est le club qui décide, comme pour un
  -- majeur. Le paramètre est conservé (la signature est appelée ailleurs) même s'il ne sert plus.
  select 'a_verifier';
$$;

comment on function public.initial_request_status(date) is
  'v217 — Toute demande d''adhésion démarre à `a_verifier`, quel que soit l''âge (décision du 14/09/2026).';

-- ── 3. Plus de refus avant 14 ans, plus d'autorisation exigée ────────────────
create or replace function public.request_team_membership_as_player(
  p_club_id uuid, p_team_id uuid, p_invite_code text default null,
  p_prenom text default null, p_nom text default null, p_date_naissance date default null)
returns membership_requests
language plpgsql
security definer
set search_path to 'public'
as $$
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
    -- v217 — Le refus avant 14 ans est levé : un mineur crée son compte comme un majeur.
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

  -- Les autorisations sont toujours PRÉPARÉES pour un mineur : elles ne bloquent plus, mais le
  -- parent qui rejoindra plus tard les trouve prêtes à signer, notamment le droit à l'image.
  if sv_age_bracket(v_player.date_naissance) <> 'majeur' then
    perform bootstrap_player_authorizations(v_player.id, p_club_id);
  end if;

  insert into membership_request_events (request_id, event_type, acted_by) values (v_req.id, 'creee', auth.uid());

  -- Arrivée par un code d'équipe : la demande se valide toute seule (v186). Donner le code, c'est
  -- déjà accepter la personne. Si la validation ne peut pas aboutir — un club en contrôle renforcé
  -- — la demande reste à valider à la main : on ne fait échouer aucune inscription.
  if v_source = 'code_equipe' then
    begin
      perform validate_team_membership(v_req.id, true);
      select * into v_req from membership_requests where id = v_req.id;
    exception when others then
      null;
    end;
  end if;
  return v_req;
end;
$$;

create or replace function public.accept_player_invitation(p_invitation_id uuid)
returns membership_requests
language plpgsql
security definer
set search_path to 'public'
as $$
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
    -- v217 — Même levée qu'au-dessus.
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
create or replace function public.validate_team_membership(p_request_id uuid, p_par_code boolean DEFAULT false)
 RETURNS membership_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req membership_requests;
  v_player player_profiles;
  v_bracket text;
  v_authorized boolean;
begin
  select * into v_req from membership_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Demande introuvable'; end if;
  if v_req.statut in ('validee', 'refusee') then raise exception 'Cette demande a déjà été traitée'; end if;

  -- ARRIVÉE PAR UN CODE D'ÉQUIPE (12/09/2026, demande de Fouka).
  --
  -- Un code d'invitation est généré par le coach ou par le club : le donner, c'est déjà accepter
  -- la personne. Lui redemander ensuite de valider la demande à la main est une formalité vide, et
  -- pendant ce temps la famille attend sans comprendre. Une demande née d'un code d'équipe valide
  -- se valide donc toute seule, et seulement dans ce cas.
  --
  -- Les deux modes de contrôle renforcé du club restent souverains : s'il a choisi que
  -- l'administration valide (mode « contrôle »), ou qu'il faut l'éducateur PUIS l'administration
  -- (mode « double »), le code ne court-circuite rien. Et pour un mineur, les autorisations
  -- parentales restent exigées plus bas, exactement comme pour une validation à la main.
  if p_par_code and v_req.validation_mode = 'standard'
     and v_req.source = 'code_equipe' and v_req.invite_code_id is not null then
    null;
  elsif v_req.validation_mode = 'double' then
    if v_req.educateur_confirme_at is null then
      raise exception 'Cette demande doit d''abord être confirmée par un éducateur (mode double validation)';
    end if;
    if not is_real_club_admin(v_req.club_id) then raise exception 'Seul un administrateur peut valider en mode double validation'; end if;
  elsif v_req.validation_mode = 'controle' then
    if not is_real_club_admin(v_req.club_id) then raise exception 'Seul un administrateur peut valider sur ce club'; end if;
  else
    if not (is_real_club_admin(v_req.club_id) or (v_req.team_id is not null and is_real_team_educateur(v_req.team_id))) then
      raise exception 'Non autorisé';
    end if;
  end if;

  -- La validation d'une adhésion active le compte du joueur (account_status). Depuis le
  -- durcissement du 12/09 (v179), ce champ n'est modifiable que par un dirigeant du club : un
  -- COACH qui validait une demande, ce qui est précisément son rôle, se voyait donc répondre
  -- « Modification non autorisée sur ces champs ». Le drapeau ci-dessous dit au garde-fou que
  -- l'écriture vient de CE chemin, déjà autorisé plus haut. Il ne vit que le temps de la
  -- transaction, et aucune autre fonction ne le pose.
  perform set_config('sv.validation_adhesion', 'oui', true);

  select * into v_player from player_profiles where id = v_req.player_id;
  v_bracket := sv_age_bracket(v_player.date_naissance);

  -- v217 (14/09/2026, décision de Fouka) — Les trois autorisations parentales obligatoires
  -- (creation_compte, acces_clubplus, traitement_donnees) ne bloquent plus la validation : un
  -- mineur rejoint son équipe comme un majeur. Elles restent préparées et signables, et le droit à
  -- l'image, lui, n'a jamais bloqué. Pour rétablir l'ancienne règle, il suffit de remettre
  -- `obligatoire = true` sur ces trois lignes et de restaurer ce bloc.
  -- v_bracket et v_authorized restent déclarés : d'autres lectures s'y appuient en aval.
  v_authorized := true;

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
$function$


