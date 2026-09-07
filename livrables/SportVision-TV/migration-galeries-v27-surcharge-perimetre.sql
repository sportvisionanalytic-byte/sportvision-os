-- Migration : supprimer la version obsolète du périmètre de statistiques
-- À exécuter APRÈS migration-galeries-v26-editeur-drapeau-essai.sql.
--
-- ── Le défaut, trouvé pendant l'audit de pré-production ──
-- La v24 a ajouté un paramètre `p_inclure_exclus` à `_media_stats_albums`. Un `create or replace`
-- ne REMPLACE que si la signature est identique : ajouter un paramètre, même avec une valeur par
-- défaut, crée une SURCHARGE. Les deux versions coexistaient donc.
--
-- Conséquences réelles :
--   1. Tout appel sans argument devient ambigu et échoue — « function is not unique ». Découvert
--      en écrivant la matrice d'accès, pas en production, mais c'était une panne en attente.
--   2. Plus grave : l'ancienne version ne connaît PAS le drapeau d'essai. N'importe quel appelant
--      qui l'aurait atteinte aurait compté les galeries de test dans le chiffre d'affaires.
--
-- Les fonctions de statistiques passent toutes le paramètre explicitement, donc elles visaient
-- déjà la bonne. On supprime l'ancienne pour qu'il n'y ait plus qu'une seule réponse possible à
-- « quels albums ai-je le droit de compter ».

begin;

drop function if exists _media_stats_albums();

commit;
