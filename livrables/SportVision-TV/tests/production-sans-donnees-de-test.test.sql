-- La production ne doit pas se remplir de décors de test (v254/v255, 23/09/2026).
--
-- Au 23/09, 118 organisations de test vivaient en production : « ZZ Club Reco 1790004104970 »,
-- « DEMO Villemomble »... Elles s'accumulaient depuis le 10 septembre, 15 à 30 par campagne,
-- 29 pour la seule journée du 21. Sur 130 organisations, 9 se déclaraient clubs alors qu'il y
-- en avait 3. Tout compteur de clients dans l'OS mentait.
--
-- Le balayage nocturne (v254) les retire chaque nuit à 4 h. Ce test vérifie qu'il fait son
-- travail : si le décor revient et reste, c'est que le balayage est arrêté, ou qu'un nouveau
-- scénario invente une convention de nommage que personne ne connaît.
--
-- On tolère la journée en cours : un scénario lancé il y a dix minutes a le droit d'avoir son
-- décor sous les pieds.
with restes as (
  select nom, created_at from organizations
  where (nom like 'ZZ %' or nom like 'DEMO %' or nom like '%(démonstration)')
    and created_at < now() - interval '36 hours'
),
comptes as (
  select
    (select count(*) from restes) as vieux_decors,
    (select count(*) from organizations where organization_type = 'club') as clubs_declares,
    (select count(*) from clubs) as clubs_reels
)
select case
  when vieux_decors > 0
    then '❌ ' || vieux_decors || ' organisation(s) de test de plus de 36 h : le balayage nocturne '
         || 'ne tourne plus, ou un scénario utilise un nom que v254 ne connaît pas'
  when clubs_declares <> clubs_reels
    then '❌ ' || clubs_declares || ' clubs déclarés dans organizations pour ' || clubs_reels
         || ' clubs réels : les deux tables ont divergé'
  else '✅ aucun décor de test qui traîne, et ' || clubs_reels || ' clubs des deux côtés'
end as verdict
from comptes;
