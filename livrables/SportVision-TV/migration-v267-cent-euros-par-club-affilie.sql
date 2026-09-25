-- v267 — Le Responsable Production touche 100 € par club affilié et par mois (25/09/2026)
--
-- DÉCISION DE FOUKA : « Le responsable de production prend 100 euros par club affilié par mois.
-- Là on a deux clubs affiliés, donc dans son salaire tu dois mettre automatiquement 200 euros par
-- mois, plus la rémunération des prestations qu'il fait. »
--
-- CE QUI EXISTAIT NE DISAIT PAS LA MÊME CHOSE. Le barème posé le 31/08 fonctionne par PALIERS :
-- 0-1 contrat → 0 €, 2-3 → 300 €, 4-5 → 500 €, 6-7 → 700 €… Avec deux clubs il aurait versé
-- 300 €, et le troisième club n'aurait rien ajouté. La règle de Fouka est linéaire : chaque club
-- vaut 100 €, le premier comme le dixième.
--
-- ON RÉÉCRIT DONC LE BARÈME, une ligne par nombre de clubs jusqu'à trente. Le mécanisme de calcul
-- ne change pas d'un caractère : il cherche déjà le palier qui contient le nombre de contrats
-- `full_communication` actifs du pôle. On lui donne simplement des paliers d'un seul cran.
--
-- POURQUOI TRENTE ET PAS L'INFINI. `pole_palier_du_mois` marque `hors_grille` quand aucun palier
-- ne contient le compte : au trente-et-unième club, le montant ne se met pas à zéro en silence,
-- l'écran signale que la grille est dépassée. Une borne visible vaut mieux qu'une extrapolation
-- muette.
--
-- CE QU'ON NE TOUCHE PAS. `variable_pct` — la part du bénéfice qui revient au responsable de PÔLE,
-- une autre fonction que le responsable de production — garde son comportement d'origine : rien
-- en dessous de deux contrats, 15 % au-delà. Fouka n'a parlé que de la partie fixe.
--
-- AUCUNE PAIE PASSÉE N'EST AFFECTÉE : `pole_remuneration_calculs` est vide, aucun mois n'a jamais
-- été calculé ni figé. Vérifié avant d'écrire.
--
-- Idempotente.

-- ── 1. Le barème : 100 € par club, un palier par cran ────────────────────────────────────────
delete from public.pole_remuneration_paliers where pole_id is null;

insert into public.pole_remuneration_paliers
  (pole_id, borne_min, borne_max, fixe_mensuel, variable_pct, libelle_statut, actif, notes)
select null, n, n, n * 100.00,
       case when n >= 2 then 15.00 else 0.00 end,
       case when n = 0 then 'Aucun club affilié'
            when n = 1 then '1 club affilié'
            else n || ' clubs affiliés' end,
       true,
       '100 € par club affilié et par mois (décision Fouka du 25/09/2026).'
from generate_series(0, 30) as n;

-- ── 2. Le pôle Football a un Responsable Production désigné ──────────────────────────────────
--
-- Sans cette ligne, `responsable_production_du_pole` cherchait l'unique compte « prod » affecté au
-- pôle — et il y en a deux. Elle rendait donc NULL, et le calcul mensuel n'avait aucun
-- bénéficiaire : la rémunération existait sur le papier et n'était versée à personne.
insert into public.production_remuneration_config
  (pole_id, responsable_production_id, coordination_montant, ventes_familles, ventes_taux_pct, tva_pct)
select p.id, pr.id, 0, '{}', 0, 20
from poles p
cross join lateral (select id from profiles where role = 'prod' and actif
                     and prenom ilike '%ikael%' limit 1) pr
where p.nom = 'Football'
on conflict (pole_id) do update
  set responsable_production_id = excluded.responsable_production_id,
      updated_at = now();

-- Ce que ça donne ce mois-ci.
select p.nom as pole,
       (select nb_contrats from pole_palier_du_mois(p.id, current_date)) as clubs_affilies,
       (select fixe from pole_palier_du_mois(p.id, current_date)) as fixe_mensuel,
       (select libelle from pole_palier_du_mois(p.id, current_date)) as palier,
       (select prenom || ' ' || nom from profiles where id = responsable_production_du_pole(p.id)) as responsable
from poles p order by p.nom;
