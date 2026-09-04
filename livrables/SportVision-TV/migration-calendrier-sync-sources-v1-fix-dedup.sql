-- Migration : correctif de la v1 — doublon de source ignoré au lieu d'échouer
-- À exécuter dans Supabase → SQL Editor, APRÈS migration-calendrier-sync-sources-v1.sql.
-- NON ENCORE EXÉCUTÉE.
--
-- ── Le problème trouvé en test, pas en théorie ──
-- La v1 ajoute `club_matches_fallback_uniq (club_id, team_id, lower(opponent),
-- match_date, kickoff_time)`. L'index historique `club_matches_no_reimport_dup`
-- porte lui sur `(club_id, team, opponent, match_date)`, en texte brut et sensible
-- à la casse. Les deux ne voient donc pas les mêmes doublons.
--
-- importClubMatches() fait son upsert sur l'ancienne contrainte :
--   onConflict: "club_id,team,opponent,match_date", ignoreDuplicates: true
-- Conséquence vérifiée en base : un fichier contenant "FC Melun" puis "fc melun"
-- pour le même match passe l'ancienne contrainte (casse différente) mais viole le
-- nouvel index de repli. PostgREST ne sait rattraper qu'UNE seule contrainte de
-- conflit, celle nommée dans onConflict. La violation de l'autre index remonte
-- donc en erreur brute.
--
-- Impact réel mesuré : l'import est séquentiel ligne par ligne
-- (`if (error) failed++`), donc l'import ne plante pas — mais la ligne est comptée
-- en `failed` au lieu de `skipped`, et le club voit "1 ligne en échec" sur un
-- import parfaitement légitime, sans explication.
--
-- ── Pourquoi corriger ici et pas dans le TypeScript ──
-- On pourrait changer le onConflict côté client. Mais l'idempotence deviendrait
-- alors la responsabilité de chaque appelant : l'import CSV/ICS actuel, le futur
-- import Footclubs Excel, un provider FFF, une RPC serveur, un script de reprise.
-- Chacun devrait connaître la bonne contrainte et ne jamais se tromper.
-- En posant la règle dans la base, un doublon de source est ignoré quel que soit
-- le chemin d'écriture, et le §17 ("réimporter le même calendrier : 0 doublon")
-- devient une propriété du schéma plutôt qu'une convention de code.
--
-- Le trigger reste volontairement étroit : il n'agit QUE sur les lignes sans
-- external_event_id (les sources avec identifiant sont déjà couvertes par
-- club_matches_provider_external_uniq et doivent, elles, être mises à jour et non
-- ignorées), et uniquement quand la ligne est un doublon exact au sens de la clé
-- de repli. Il n'avale jamais une écriture qui apporte une information nouvelle.

begin;

create or replace function club_matches_ignore_source_duplicate()
returns trigger
language plpgsql
as $$
begin
  -- Les sources identifiées ne passent pas par ici : un même external_event_id
  -- qui revient est une MISE À JOUR (report, changement d'horaire, score), pas un
  -- doublon à jeter. C'est tout l'intérêt d'avoir un identifiant stable.
  if new.external_event_id is not null then
    return new;
  end if;

  -- `is not distinct from` et non `=` : team_id, match_date et kickoff_time sont
  -- nullables, et c'est le cas fréquent d'un CSV incomplet. Avec `=`, deux lignes
  -- identiques dont l'heure est NULL ne seraient jamais reconnues comme doublons.
  -- Même sémantique que le NULLS NOT DISTINCT de l'index de repli.
  if exists (
    select 1 from club_matches m
    where m.club_id = new.club_id
      and m.external_event_id is null
      and m.team_id is not distinct from new.team_id
      and lower(m.opponent) = lower(new.opponent)
      and m.match_date is not distinct from new.match_date
      and m.kickoff_time is not distinct from new.kickoff_time
  ) then
    -- RETURN NULL annule l'insertion sans erreur : l'appelant reçoit 0 ligne et
    -- compte un `skipped`, exactement le comportement attendu de
    -- ignoreDuplicates:true. La requête EXISTS s'appuie sur
    -- club_matches_fallback_uniq, qui couvre exactement ces colonnes.
    return null;
  end if;

  return new;
end;
$$;

-- Nom préfixé `zz` À DESSEIN : PostgreSQL exécute les triggers BEFORE dans l'ordre
-- alphabétique de leur nom. Celui-ci doit passer APRÈS
-- `trg_club_matches_resolve_team_id`, sinon il comparerait un team_id pas encore
-- résolu depuis le texte `team` et ne détecterait aucun doublon sur les imports
-- qui ne fournissent que le nom d'équipe.
drop trigger if exists trg_club_matches_zz_dedup on club_matches;
create trigger trg_club_matches_zz_dedup
  before insert on club_matches
  for each row execute function club_matches_ignore_source_duplicate();

commit;
