-- v203 — Une seule saison active (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. Deux lignes de `saisons` portaient `active = true` : 2026-2027, la vraie,
-- et 2027-2028, qui ne commence que dans dix mois. Or plusieurs fonctions de production
-- choisissent « la » saison active avec un `limit 1` sans ordre déterminé —
-- `creer_galeries_mission`, `club_calendrier_interne`, `donner_consentement_biometrie`,
-- `media_link_type_product`, `sync_match_sport_status_to_status`.
--
-- Selon l'humeur du planificateur, une galerie de septembre 2026 pouvait donc naître sur la saison
-- 2027-2028 et devenir invisible de tous les écrans qui filtrent sur la saison du club : publiée,
-- correcte, introuvable. Rien ne l'aurait signalé.
--
-- CE QUE FAIT CETTE MIGRATION. La saison active devient celle qui contient la date du jour, et la
-- base refuse désormais d'en avoir deux. Une bascule de saison reste possible : il faut désactiver
-- la précédente dans la même transaction, ce qui est exactement le geste attendu.
-- Idempotente.

update saisons set active = false
 where active and not (current_date between date_debut and date_fin);

update saisons set active = true
 where current_date between date_debut and date_fin
   and not exists (select 1 from saisons s2 where s2.active);

create unique index if not exists saisons_une_seule_active
  on saisons ((true)) where active;

-- La cause, trouvée en repassant la batterie : `saisons.active` avait pour valeur par défaut
-- `true`. Toute saison créée naissait donc active — c'est exactement ainsi que 2027-2028 est
-- devenue active à côté de 2026-2027, et `get_or_create_saison`, qui crée une saison à la volée
-- depuis l'OS, échouait désormais sur l'index. Une saison naît inactive ; on l'active quand on y
-- bascule, ce qui est une décision, pas un effet de bord.
alter table saisons alter column active set default false;
