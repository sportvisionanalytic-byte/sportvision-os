-- v255 — Les quatre clubs de démonstration qui ne servaient plus (23/09/2026)
--
-- Suite du balayage v254, qui a retiré 114 organisations de test. Il en restait quatre, que
-- v254 ne touche volontairement jamais : elles ne portent pas le préfixe « ZZ » des scénarios
-- automatiques mais un nom de démonstration, et une tâche nocturne n'a pas à décider seule du
-- sort de quelque chose qui s'appelle « SF Villemomble (démonstration) ».
--
--   DEMO Fontainebleau                  (type projet)
--   DEMO Villemomble                    (type projet)
--   RCP Fontainebleau (démonstration)   (type club)
--   SF Villemomble (démonstration)      (type club)
--
-- Deux d'entre elles se déclaraient de type « club », ce qui faisait dire à l'OS qu'il y avait
-- neuf clubs là où il y en a trois.
--
-- VÉRIFIÉ AVANT SUPPRESSION, le 23/09 : aucune des quatre ne porte de membre, de joueur, de
-- galerie, de commande, d'adhésion, d'événement de calendrier ni de demande. Elles sont vides.
--
-- VÉRIFIÉ AUSSI, et c'est le point qui comptait : les comptes de démonstration remis à Apple et
-- à Google pour la relecture des magasins (demo.u18.villemomble@example.invalid et les sept
-- autres) sont rattachés aux VRAIS clubs, SF Villemomble et RCP Fontainebleau. La relecture
-- Apple est en cours au moment où ceci s'exécute : elle n'est pas affectée.
--
-- Suppression à l'unité, par identifiant, et pas par un motif de nom : un « like '%demo%' »
-- écrit un soir de fatigue emporterait un jour un vrai club qui aurait ce mot dans son nom.

delete from organizations where id = 'bcd0eb67-62b2-45be-9355-ae1df5b75ab1';  -- DEMO Fontainebleau
delete from organizations where id = '62873284-0607-40cd-922d-ca5018b8b0a1';  -- DEMO Villemomble
delete from organizations where id = 'eeecd248-d94f-4376-9d93-89244e03692c';  -- RCP Fontainebleau (démonstration)
delete from organizations where id = '6eedbd63-3824-4e5f-8076-f584e67e76f5';  -- SF Villemomble (démonstration)

-- Le compte après ménage, pour que la migration laisse une trace de ce qu'elle a produit.
select
  (select count(*) from organizations) as organisations,
  (select count(*) from organizations where organization_type = 'club') as clubs_declares,
  (select count(*) from clubs) as clubs_reels,
  (select count(*) from organizations
    where nom like 'ZZ %' or nom like 'DEMO %' or nom like '%(démonstration)') as reste_de_test;
