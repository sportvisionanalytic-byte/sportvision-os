-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 3e — Le CM peut remplir l'onboarding EN ENTIER
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- La v10 avait ouvert les tables que j'avais reperees a la lecture de l'ecran. C'etait incomplet :
-- en rejouant reellement chaque action de la page avec l'identite d'un CM, cinq surfaces
-- refusaient encore l'ecriture. Les creneaux d'entrainement, entre autres, que Fouka a signales.
--
-- Ce qui manquait, et pourquoi ce n'etait pas visible a la lecture :
--   club_onboarding_progress   « commencer » et « soumettre » — l'ecran ne pouvait meme pas demarrer
--   club_venues                les lieux
--   club_team_training_slots   les creneaux — cette table n'a PAS de club_id, seulement team_id,
--                              donc le perimetre doit passer par club_teams
--   club_social_accounts       les reseaux sociaux
--   bucket club-logos          le logo du club et ceux des sponsors
--   import_club_players        l'import d'effectif CSV, garde par is_club_admin
--
-- Un seul moteur porte la regle : peut_preparer_club(). Aucune de ces surfaces ne redefinit sa
-- propre condition, sinon elles divergeraient au premier changement.
--
-- Volontairement PAS ouvert : create_invite_code (liens collectifs et QR). Ce sont des invitations,
-- c'est la phase 4, et elle n'est pas commencee.

begin;

-- ── Le moteur unique ─────────────────────────────────────────────────────────
create or replace function public.peut_preparer_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select is_club_admin(p_club_id)
      or (est_cm_cloisonne() and p_club_id in (select cm_clubs_autorises()));
$function$;

comment on function public.peut_preparer_club(uuid) is
  'Qui a le droit de remplir la mise en place d''un club : son administrateur, ou le CM SportVision qui lui est affecte. Source unique — ne pas redefinir cette condition ailleurs.';

-- ── Les tables qui portent club_id ───────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['club_onboarding_progress','club_venues','club_social_accounts'] loop
    execute format('drop policy if exists %I on %I', t||'_cm_prepare', t);
    execute format($f$
      create policy %I on %I for all to authenticated
        using (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()))
        with check (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()))
    $f$, t||'_cm_prepare', t);

    execute format('drop policy if exists %I on %I', 'cm_perim_'||t, t);
    execute format($f$
      create policy %I on %I as restrictive for all to authenticated
        using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
        with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
    $f$, 'cm_perim_'||t, t);
  end loop;
end $$;

-- ── Les creneaux : pas de club_id, le perimetre passe par l'equipe ───────────
drop policy if exists ctts_cm_prepare on club_team_training_slots;
create policy ctts_cm_prepare on club_team_training_slots for all to authenticated
  using (est_cm_cloisonne() and exists (
    select 1 from club_teams ct where ct.id = team_id and ct.club_id in (select cm_clubs_autorises())))
  with check (est_cm_cloisonne() and exists (
    select 1 from club_teams ct where ct.id = team_id and ct.club_id in (select cm_clubs_autorises())));

drop policy if exists cm_perim_club_team_training_slots on club_team_training_slots;
create policy cm_perim_club_team_training_slots on club_team_training_slots as restrictive for all to authenticated
  using (not est_cm_cloisonne() or exists (
    select 1 from club_teams ct where ct.id = team_id and ct.club_id in (select cm_clubs_autorises())))
  with check (not est_cm_cloisonne() or exists (
    select 1 from club_teams ct where ct.id = team_id and ct.club_id in (select cm_clubs_autorises())));

-- ── Le logo du club et ceux des sponsors ─────────────────────────────────────
-- Les deux chemins commencent par l'identifiant du club (`<club_id>/logo.png`,
-- `<club_id>/sponsor-<id>.png`), une seule regle couvre donc les deux.
drop policy if exists club_logos_cm_insert on storage.objects;
create policy club_logos_cm_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'club-logos'
              and est_cm_cloisonne()
              -- Le bucket contient aussi un dossier `clients/` : sans ce filtre, le cast en uuid
              -- ferait echouer l'evaluation de la policy sur ces lignes-la.
              and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
              and ((storage.foldername(name))[1])::uuid in (select cm_clubs_autorises()));

drop policy if exists club_logos_cm_update on storage.objects;
create policy club_logos_cm_update on storage.objects for update to authenticated
  using (bucket_id = 'club-logos'
         and est_cm_cloisonne()
         and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
         and ((storage.foldername(name))[1])::uuid in (select cm_clubs_autorises()));

commit;

select 'OK — migration v11 appliquee' as verdict;
