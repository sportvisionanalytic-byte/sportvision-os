-- ============================================================================
-- migration-clubplus-v57-smart-links-qr.sql (03/09/2026)
-- ============================================================================
-- Chantier Fouka "effectifs/Smart Links/QR/affiliations" — suite choisie après l'anti-doublon/
-- import CSV (migration-clubplus-v56). Audit préalable (voir mémoire
-- sportvision_clubplus_effectifs_smartlinks_qr_master_prompt) : `team_invite_codes`
-- (migration-clubplus-v14.sql) existe déjà et fonctionne (code texte, expire_at, actif) mais :
--   - `team_id` est NOT NULL → aucun lien "club entier" possible, seulement par équipe ;
--   - pas de compteur d'usages max (`max_uses`) ;
--   - la validation d'un code (aujourd'hui faite par une lecture directe dans l'edge function
--     connect-player-onboarding) n'est pas atomique : deux rédemptions concurrentes proches de la
--     limite pourraient toutes deux passer avant que le compteur ne soit incrémenté.
--
-- Cette migration GÉNÉRALISE la table existante (jamais de nouvelle table "smart_invites"
-- parallèle, conforme à "réutilise l'existant") :
--   1. team_id devient nullable (NULL = lien club entier, toutes équipes).
--   2. max_uses (NULL = illimité) + uses_count, avec redeem_invite_code() atomique.
--   3. Nouvelle fonction generate_invite_code() acceptant team_id NULL (préfixe CLUB).
--   4. create_team_invite_code(uuid) existant conservé tel quel (compat UI actuelle) + nouvelle
--      create_invite_code(club_id, team_id default null) plus générale pour les futurs appels
--      club-level.
--   5. rotate_team_invite_code corrigée pour ne plus planter sur un code club-level (team_id null).
--   6. preview_invite_code(code) : lecture seule, callable AVANT authentification (la page
--      publique /join/[code] de Connect doit pouvoir afficher "Vous rejoignez [Club] [Équipe]"
--      sans forcer un login au préalable) — ne révèle jamais de données personnelles, seulement
--      club/équipe/saison/validité.
-- ============================================================================

alter table team_invite_codes alter column team_id drop not null;
alter table team_invite_codes add column if not exists max_uses integer;
alter table team_invite_codes add column if not exists uses_count integer not null default 0;

comment on column team_invite_codes.team_id is 'NULL = lien club entier (toutes équipes), sinon lien équipe précise. Rendu nullable par migration-clubplus-v57.';
comment on column team_invite_codes.max_uses is 'NULL = usages illimités. Vérifié atomiquement par redeem_invite_code() (migration-clubplus-v57).';

-- Remplace generate_team_invite_code : même algorithme, gère désormais team_id NULL (préfixe
-- "CLUB" au lieu de la catégorie d'équipe). Signature conservée (p_team_id uuid) — appelable avec
-- NULL sans erreur, aucun appelant existant cassé.
create or replace function generate_team_invite_code(p_team_id uuid)
returns text language plpgsql as $$
declare
  v_cat text;
  v_code text;
  v_tries int := 0;
begin
  if p_team_id is null then
    v_cat := 'CLUB';
  else
    select upper(regexp_replace(coalesce(categorie, name), '[^a-zA-Z0-9]', '', 'g')) into v_cat
    from club_teams where id = p_team_id;
    v_cat := coalesce(nullif(left(v_cat, 8), ''), 'EQUIPE');
  end if;
  loop
    v_code := 'SV-' || v_cat || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from team_invite_codes where code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 20 then raise exception 'Impossible de générer un code unique, réessayez'; end if;
  end loop;
  return v_code;
end;
$$;

-- Nouvelle fonction générale (club_id explicite, team_id optionnel) — create_team_invite_code(uuid)
-- existant reste tel quel pour ne rien casser côté UI actuelle (TeamCard.tsx), mais délègue
-- désormais à celle-ci pour ne pas dupliquer la logique d'autorisation/insertion.
create or replace function create_invite_code(p_club_id uuid, p_team_id uuid default null, p_max_uses integer default null)
returns team_invite_codes
language plpgsql security definer set search_path = public as $$
declare
  v_row team_invite_codes;
  v_team_club_id uuid;
begin
  if p_team_id is not null then
    select club_id into v_team_club_id from club_teams where id = p_team_id;
    if v_team_club_id is null or v_team_club_id <> p_club_id then
      raise exception 'Équipe introuvable pour ce club';
    end if;
    if not (is_team_educateur(p_team_id) or is_club_admin(p_club_id)) then
      raise exception 'Non autorisé';
    end if;
  else
    if not is_club_admin(p_club_id) then
      raise exception 'Seul un administrateur peut créer un lien pour tout le club';
    end if;
  end if;

  insert into team_invite_codes (club_id, team_id, code, max_uses, created_by)
  values (p_club_id, p_team_id, generate_team_invite_code(p_team_id), p_max_uses, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function create_invite_code(uuid, uuid, integer) from public;
grant execute on function create_invite_code(uuid, uuid, integer) to authenticated;

create or replace function create_team_invite_code(p_team_id uuid)
returns team_invite_codes
language plpgsql security definer set search_path = public as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from club_teams where id = p_team_id;
  if v_club_id is null then raise exception 'Équipe introuvable'; end if;
  return create_invite_code(v_club_id, p_team_id, null);
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
  if not ((v_row.team_id is not null and is_team_educateur(v_row.team_id)) or is_club_admin(v_row.club_id)) then
    raise exception 'Non autorisé';
  end if;

  update team_invite_codes
  set code = generate_team_invite_code(v_row.team_id), actif = true, uses_count = 0
  where id = p_code_id
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function rotate_team_invite_code(uuid) from public;
grant execute on function rotate_team_invite_code(uuid) to authenticated;

-- Désactivation d'un lien compromis (§46 du master prompt : "un club doit pouvoir régénérer un
-- lien compromis") — jusqu'ici aucune fonction ne permettait de couper un code sans le faire
-- tourner (rotate change aussi le code, ce qui n'est pas toujours ce que veut l'admin).
create or replace function deactivate_invite_code(p_code_id uuid)
returns team_invite_codes
language plpgsql security definer set search_path = public as $$
declare
  v_row team_invite_codes;
begin
  select * into v_row from team_invite_codes where id = p_code_id;
  if v_row.id is null then raise exception 'Code introuvable'; end if;
  if not ((v_row.team_id is not null and is_team_educateur(v_row.team_id)) or is_club_admin(v_row.club_id)) then
    raise exception 'Non autorisé';
  end if;

  update team_invite_codes set actif = false where id = p_code_id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function deactivate_invite_code(uuid) from public;
grant execute on function deactivate_invite_code(uuid) to authenticated;

-- Aperçu public (AVANT authentification) — alimente /join/[code] côté Connect : "Vous rejoignez
-- [Club] [Équipe] [Saison]". Ne révèle jamais rien de personnel, uniquement club/équipe/saison et
-- la validité. Callable par un visiteur anonyme (`anon`) — c'est la seule fonction de ce fichier
-- ouverte au rôle anonyme, volontairement, et volontairement minimale en surface exposée.
create or replace function preview_invite_code(p_code text)
returns table(valide boolean, raison text, club_nom text, team_nom text, saison text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row team_invite_codes;
begin
  select * into v_row from team_invite_codes where code = upper(trim(p_code));
  if v_row.id is null then
    return query select false, 'introuvable', null::text, null::text, null::text;
    return;
  end if;
  if not v_row.actif then
    return query select false, 'inactif', null::text, null::text, null::text;
    return;
  end if;
  if v_row.expire_at is not null and v_row.expire_at < now() then
    return query select false, 'expire', null::text, null::text, null::text;
    return;
  end if;
  if v_row.max_uses is not null and v_row.uses_count >= v_row.max_uses then
    return query select false, 'epuise', null::text, null::text, null::text;
    return;
  end if;

  return query
  select true, null::text, c.nom, t.name, c.saison
  from clubs c
  left join club_teams t on t.id = v_row.team_id
  where c.id = v_row.club_id;
end;
$$;
revoke all on function preview_invite_code(text) from public;
grant execute on function preview_invite_code(text) to anon, authenticated;

-- Rédemption atomique — remplace la lecture directe faite jusqu'ici dans l'edge function
-- connect-player-onboarding (action join_code) : incrémente uses_count et vérifie max_uses dans
-- la même transaction (verrou de ligne via l'UPDATE), élimine la fenêtre de course entre deux
-- rédemptions concurrentes proches de la limite. Appelée par l'edge function avec la clé service
-- role (jamais exposée à `authenticated`/`anon` directement : la logique de création du profil
-- joueur et de la membership_request reste dans l'edge function, inchangée).
create or replace function redeem_invite_code(p_code text)
returns table(club_id uuid, team_id uuid, invite_code_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row team_invite_codes;
begin
  select * into v_row from team_invite_codes where code = upper(trim(p_code)) for update;
  if v_row.id is null then raise exception 'Code introuvable'; end if;
  if not v_row.actif then raise exception 'Ce code n''est plus actif'; end if;
  if v_row.expire_at is not null and v_row.expire_at < now() then raise exception 'Ce code a expiré'; end if;
  if v_row.max_uses is not null and v_row.uses_count >= v_row.max_uses then
    raise exception 'Ce code a atteint son nombre maximal d''utilisations';
  end if;

  update team_invite_codes set uses_count = uses_count + 1 where id = v_row.id;

  return query select v_row.club_id, v_row.team_id, v_row.id;
end;
$$;
revoke all on function redeem_invite_code(text) from public;
-- Volontairement PAS de grant à `authenticated`/`anon` : appelée uniquement par l'edge function
-- via le service role (bypass RLS/grants), pour garder tout le contexte de validation d'identité
-- (âge, autorisation parentale) côté edge function, jamais accessible en appel direct côté client.

-- ============================================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- 1. create_invite_code(club_id, null, 5) en tant qu'admin → lien club-level avec max_uses=5.
-- 2. preview_invite_code(code) en tant qu'anonyme (sans session) → valide=true, club_nom rempli,
--    team_nom NULL (lien club entier).
-- 3. redeem_invite_code(code) x5 → succès, uses_count passe à 5.
-- 4. redeem_invite_code(code) une 6e fois → exception "atteint son nombre maximal".
-- 5. preview_invite_code(code) après épuisement → valide=false, raison='epuise'.
-- 6. rotate_team_invite_code sur un code équipe (team_id non null) → fonctionne comme avant,
--    uses_count repart à 0.
-- ============================================================================
