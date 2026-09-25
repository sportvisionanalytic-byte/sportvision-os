-- v260 — Retirer la photo de référence déposée pour tester la chaîne (25/09/2026)
--
-- POURQUOI ELLE A EXISTÉ. Fouka a demandé si la reconnaissance faciale fonctionne. La réponse
-- honnête demandait de l'éprouver, pas de la supposer : le dépôt d'une photo de référence a donc
-- été fait pour de bon, avec le compte parent de démonstration.
--
-- L'IMAGE DÉPOSÉE ÉTAIT UN CARRÉ DE COULEUR, généré pour l'occasion. Jamais le visage d'un vrai
-- enfant : attacher l'empreinte biométrique d'un mineur réel à une fiche fictive, pour tester,
-- serait exactement ce que le consentement est censé empêcher.
--
-- CE QUE LE TEST A MONTRÉ : le dépôt répond 200, `enregistrer_photo_reference` enregistre la
-- ligne, et le garde-fou de la fonction fait son travail (elle refuse un appelant sans identité).
-- La suite — le calcul de l'empreinte et le rapprochement — se fait dans le navigateur de
-- l'opérateur et ne peut pas être éprouvée depuis ici.
--
-- Le fichier a déjà été retiré du stockage. Cette migration retire la ligne qui le désignait,
-- pour ne pas laisser une référence pointant vers un fichier absent : au prochain lancement de
-- la reconnaissance, elle aurait fait échouer la lecture sans que personne comprenne pourquoi.

delete from player_face_refs
where storage_path like 'visages/%/reference-essai-%';

select count(*) as references_restantes from player_face_refs;
