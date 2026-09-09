-- ═══════════════════════════════════════════════════════════════════════════════
-- Recalibrage de l'XP des formations
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Constat chiffre du 09/09/2026, a la demande de Fouka (« ca donne trop d'XP ») :
--
--   XP disponible en suivant TOUTES les formations : 10 220
--   Seuil du grade le plus haut, « Maitre »        :  9 000
--
-- Autrement dit, on pouvait atteindre le sommet de la grille sans avoir jamais tenu une
-- prestation. Or les grades decrivent une maturite operationnelle — « peut gerer une prestation en
-- solo », « realise des prestations complexes ». Une formation ne prouve pas cela, elle y prepare.
--
-- Et la formation est aujourd'hui la SEULE source d'XP (rpc_complete_formation, rpc_submit_quiz) :
-- on ne peut donc pas la reduire a rien sans rendre la grille inatteignable.
--
-- Bareme retenu : division par 4, plancher a 10 XP.
--   total disponible : 10 220 → environ 2 550
--   suivre TOUT le catalogue mene donc au grade « Senior » (2 000), pas au-dela ;
--   suivre le cursus complet de son metier (900 → 225) fait une bonne part de « Confirme » (600).
--
-- La formation ouvre la porte, le terrain fait le reste. C'est le sens voulu.
--
-- Les XP DEJA acquis ne sont pas recalcules : ce serait retrograder des gens sur un changement de
-- regle dont ils ne sont pas responsables. C'est une decision qui appartient a Fouka, pas a une
-- migration.

begin;

update formation_rewards set xp = greatest(10, round(xp / 4.0)::int), updated_at = now();

update formations_custom set xp = greatest(10, round(xp / 4.0)::int)
where xp is not null;

commit;

select count(*) as formations,
       sum(xp) as xp_total_disponible,
       min(xp) as mini, round(avg(xp)) as moyen, max(xp) as maxi
from formation_rewards;
