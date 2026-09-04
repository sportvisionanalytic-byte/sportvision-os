-- Audit transversal end-to-end (04/09/2026, master prompt Fouka) — batch 1, corrections sûres et
-- non destructives issues de la cartographie initiale (section 5-7 du prompt).

-- ══════════════════════════════════════════════════════════════════════════
-- FIX 1 — Anti-doublon import calendrier (scénario 12 du prompt : "réimporter exactement le
-- même fichier -> 0 doublon"). importClubMatches() (calendar-import.ts, chantier du 04/09) faisait
-- un insert en boucle sans aucune vérification — un réimport créait un doublon à chaque fois.
-- Vérifié en direct : 0 ligne dans club_matches en prod, contrainte ajoutable sans risque de
-- migration (aucun doublon existant à nettoyer avant).
-- ══════════════════════════════════════════════════════════════════════════

alter table club_matches add constraint club_matches_no_reimport_dup
  unique (club_id, team, opponent, match_date);

comment on constraint club_matches_no_reimport_dup on club_matches is 'Anti-doublon réimport calendrier (audit transversal 04/09/2026) — un même club+équipe+adversaire+date ne peut exister qu''une fois. importClubMatches() (app-next) doit upsert sur ce conflit plutôt qu''échouer.';

-- ══════════════════════════════════════════════════════════════════════════
-- FIX 2 — team_id jamais resynchronisé sur club_matches/club_calendar_events. Rempli une seule
-- fois au backfill de migration (v37/v54) puis jamais recalculé : toute nouvelle ligne dont le
-- texte "équipe" ne correspond pas exactement à club_teams.name reste team_id=NULL en silence,
-- ce qui casse la RLS équipe-scoped (cma_member_select/is_team_educateur) sans que rien ne le
-- signale. Trigger additif : ne fait rien si team_id est déjà fourni explicitement (l'admin qui
-- assigne une équipe manuellement garde la main), ne résout que le cas où il manque ET qu'une
-- correspondance EXACTE et UNIQUE existe — jamais de résolution ambiguë silencieuse.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function resolve_team_id_from_name()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_match_id uuid;
  v_match_count int;
begin
  if new.team_id is not null or new.team is null or btrim(new.team) = '' then
    return new;
  end if;

  select ct.id, count(*) over () into v_match_id, v_match_count
  from club_teams ct
  where ct.club_id = new.club_id and ct.name = new.team
  limit 2;

  if v_match_count = 1 then
    new.team_id := v_match_id;
  end if;

  return new;
end;
$$;
comment on function resolve_team_id_from_name() is 'Audit transversal 04/09/2026 — résout team_id depuis le texte "team" à l''insert/update si une correspondance exacte et unique existe dans club_teams, jamais si team_id est déjà fourni ou si le nom est ambigu/absent.';

drop trigger if exists trg_club_matches_resolve_team_id on club_matches;
create trigger trg_club_matches_resolve_team_id before insert or update of team, team_id on club_matches
  for each row execute function resolve_team_id_from_name();

drop trigger if exists trg_club_calendar_events_resolve_team_id on club_calendar_events;
create trigger trg_club_calendar_events_resolve_team_id before insert or update of team, team_id on club_calendar_events
  for each row execute function resolve_team_id_from_name();

-- ══════════════════════════════════════════════════════════════════════════
-- FIX 3 — Aucun mécanisme de "claim" pour un mineur qui crée son propre compte Connect après que
-- son club a déjà créé sa fiche roster (persona D / scénario 10 du prompt). upsertJoiningPlayer
-- Profile() (connect-player-onboarding/index.ts) ne cherchait une fiche existante que par
-- user_id — toujours vide pour un compte tout juste créé — donc tombait systématiquement dans
-- l'INSERT et créait une DEUXIÈME fiche player_profiles pour la même personne. Nouvelle RPC
-- dédiée (distincte de match_player_candidates, réservée à un admin de club via is_club_admin,
-- inutilisable ici puisque l'appelant est le joueur lui-même) : ne renvoie un id QUE si une seule
-- correspondance forte (nom normalisé + date de naissance) existe parmi les fiches PAS ENCORE
-- réclamées (user_id is null) de CE club précis — jamais de fusion ambiguë automatique, même
-- doctrine que l'anti-doublon CSV (migration-clubplus-v56).
-- ══════════════════════════════════════════════════════════════════════════

create or replace function find_unclaimed_player_profile(
  p_club_id uuid,
  p_prenom text,
  p_nom text,
  p_date_naissance date
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count int;
begin
  select pp.id, count(*) over () into v_id, v_count
  from player_profiles pp
  where pp.club_id = p_club_id
    and pp.user_id is null
    and pp.date_naissance = p_date_naissance
    and normalize_person_name(pp.prenom) = normalize_person_name(p_prenom)
    and normalize_person_name(pp.nom) = normalize_person_name(p_nom)
  limit 2;

  if v_count = 1 then
    return v_id;
  end if;
  return null;
end;
$$;
comment on function find_unclaimed_player_profile(uuid, text, text, date) is 'Audit transversal 04/09/2026 (persona D, scénario 10) — trouve une fiche roster non réclamée (user_id null) correspondant fortement (nom normalisé + date de naissance exacte) dans un club précis. Renvoie null si 0 ou plusieurs correspondances (jamais de fusion ambiguë). Réservé au service_role (appelé depuis connect-player-onboarding, jamais exposé au client).';

revoke all on function find_unclaimed_player_profile(uuid, text, text, date) from public, anon, authenticated;
grant execute on function find_unclaimed_player_profile(uuid, text, text, date) to service_role;
