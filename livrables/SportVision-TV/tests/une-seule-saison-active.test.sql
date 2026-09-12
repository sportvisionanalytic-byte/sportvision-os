-- Une seule saison peut être active (v203, 12/09/2026).
--
-- Deux lignes de `saisons` portaient `active = true` en production : 2026-2027 et 2027-2028.
-- Plusieurs fonctions de production choisissent « la » saison active avec un simple `limit 1`
-- sans ordre déterminé — `creer_galeries_mission`, `club_calendrier_interne`,
-- `donner_consentement_biometrie`, `media_link_type_product`, `sync_match_sport_status_to_status`.
-- Selon l'humeur du planificateur, une galerie de septembre 2026 pouvait naître sur la saison
-- 2027-2028, et devenir invisible de tous les écrans qui filtrent sur la saison du club.
--
-- Ce test tient pour vrai qu'il n'y a jamais qu'une saison active, et que la base le refuse.

begin;
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.essai(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'passe'; exception when others then return 'refus'; end $$;

select pg_temp.note('une seule saison active', '1',
  (select count(*)::text from saisons where active));

select pg_temp.note('et c''est celle d''aujourd''hui', 'oui',
  (select case when bool_and(current_date between date_debut and date_fin) then 'oui' else 'NON' end
     from saisons where active));

select pg_temp.note('la base refuse d''en activer une seconde', 'refus',
  pg_temp.essai('update saisons set active = true where not active'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
