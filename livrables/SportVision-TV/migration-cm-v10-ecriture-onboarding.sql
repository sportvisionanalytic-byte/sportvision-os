-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 3d — Le CM peut reellement remplir l'onboarding de son club
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- L'ecran d'onboarding de Club+ calcule canEdit = (role === 'admin'). Un CM affilie le voyait
-- donc entierement en lecture seule : pas un bouton, pas un champ. Il pouvait regarder la mise en
-- place de son club sans jamais y toucher.
--
-- On ouvre l'ecriture sur les tables que cet ecran utilise, et uniquement pour les clubs du
-- perimetre. Le SIRET, lui, reste hors d'atteinte : plutot que de masquer un champ dans
-- l'interface — ce qui n'est pas une securite — un declencheur le refuse cote base.

begin;

-- ── Les informations du club ─────────────────────────────────────────────────
drop policy if exists clubs_cm_affecte_update on clubs;
create policy clubs_cm_affecte_update on clubs for update
  using (est_cm_cloisonne() and id in (select cm_clubs_autorises()))
  with check (est_cm_cloisonne() and id in (select cm_clubs_autorises()));

-- Le SIRET identifie juridiquement la structure et peut remonter dans des documents officiels.
-- Un CM prepare la communication d'un club, il ne modifie pas son identite legale. La regle est
-- ici, ou personne ne peut la contourner, et pas dans un champ desactive a l'ecran.
create or replace function public.proteger_identite_legale_club()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.siret is distinct from old.siret and est_cm_cloisonne() then
    raise exception 'Le SIRET du club ne peut pas etre modifie depuis cet espace. Contactez l''administration SportVision.'
      using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists trg_proteger_identite_legale on clubs;
create trigger trg_proteger_identite_legale
  before update on clubs
  for each row execute function public.proteger_identite_legale_club();

-- ── Le calendrier, les matchs, les membres, les sponsors ─────────────────────
-- Toutes ces tables portent club_id : le perimetre s'y applique de la meme facon.
do $$
declare t text;
begin
  foreach t in array array['club_calendar_events','club_members','club_sponsors','club_matches','club_creations'] loop
    execute format('drop policy if exists %I on %I', t||'_cm_affecte_all', t);
    execute format($f$
      create policy %I on %I for all
        using (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()))
        with check (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()))
    $f$, t||'_cm_affecte_all', t);

    -- Et la ceinture : meme si une autre policy s'elargissait un jour, le perimetre tient.
    execute format('drop policy if exists %I on %I', 'cm_perim_'||t, t);
    execute format($f$
      create policy %I on %I as restrictive for all to authenticated
        using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
        with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
    $f$, 'cm_perim_'||t, t);
  end loop;
end $$;

commit;

select 'OK — ecriture ouverte sur les tables de l''onboarding, SIRET protege' as verdict;
