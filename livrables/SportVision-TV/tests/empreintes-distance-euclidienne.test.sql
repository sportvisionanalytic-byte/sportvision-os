-- Deux visages se comparent en distance EUCLIDIENNE, pas en cosinus (28/09/2026).
--
-- CE QUE CE TEST EMPÊCHE : la photo d'un enfant envoyée à la famille d'un autre.
--
-- `visage_rapprocher_direct` comparait les empreintes avec l'opérateur `<=>` de pgvector, qui est
-- la distance COSINUS. Or 0,42 et 0,55 — les deux seuils du produit, écrits juste à côté avec le
-- commentaire « distance euclidienne » — sont les seuils EUCLIDIENS usuels de face-api. On
-- mesurait donc dans une unité et on tranchait dans une autre.
--
-- L'écart n'est pas un détail de calibrage. Pour deux empreintes de norme 1, le cosinus vaut le
-- carré de l'euclidien divisé par deux : le seuil « propose » de 0,55 acceptait tout jusqu'à 1,05
-- en euclidien, c'est-à-dire N'IMPORTE QUELS deux visages, et le seuil « certain » de 0,42 — celui
-- qui écrit le marquage en `valide` SANS qu'aucun humain le relise — allait jusqu'à 0,92.
--
-- Mesuré sur la galerie réelle « RCPF VS PSG U16 » : un seul joueur avait déposé sa photo de
-- référence, et le moteur lui a attribué 79 des 110 photos, toutes en `valide`, avec des distances
-- de 0,012 à 0,185. Aucune n'était une vraie ressemblance : deux personnes différentes du même
-- banc de touche sortent à 0,574 en euclidien, soit 0,097 en cosinus.
--
-- Le test ne dépend d'aucune photo ni d'aucun modèle : il pose deux empreintes dont on CONNAÎT la
-- géométrie. Le vecteur « different » est à 0,80 en euclidien de la référence (des personnes
-- distinctes) mais à 0,32 en cosinus — donc sous l'ancien seuil. C'est exactement le faux positif.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee110000-0000-0000-0000-000000000001','zz-euclide-staff@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, role, actif) values ('ee110000-0000-0000-0000-000000000001','admin',true)
on conflict (id) do update set role = 'admin', actif = true;

insert into clubs (id, nom, ville, plan) values ('ee110000-0000-0000-0000-0000000000c1','ZZ Euclide Club','ZZ Test','performance');
insert into club_teams (id, club_id, name) values
  ('ee110000-0000-0000-0000-0000000000a1','ee110000-0000-0000-0000-0000000000c1','ZZ U16 Euclide');

insert into player_profiles (id, prenom, nom, date_naissance) values
  ('ee110000-0000-0000-0000-0000000000d1','ZZ','Reference','2010-01-01');
insert into team_memberships (player_id, team_id, club_id, saison, statut) values
  ('ee110000-0000-0000-0000-0000000000d1','ee110000-0000-0000-0000-0000000000a1','ee110000-0000-0000-0000-0000000000c1','2026-2027','active');
insert into consentements_biometrie (player_id, donne_par, qualite, texte_version, statut) values
  ('ee110000-0000-0000-0000-0000000000d1','ee110000-0000-0000-0000-000000000001','parent','zz-test','accorde');

insert into media_albums (id, club_id, team_id, title, status) values
  ('ee110000-0000-0000-0000-0000000000b1','ee110000-0000-0000-0000-0000000000c1',
   'ee110000-0000-0000-0000-0000000000a1','ZZ Galerie Euclide','published');
insert into media_assets (id, album_id, original_path, status) values
  ('ee110000-0000-0000-0000-0000000000f1','ee110000-0000-0000-0000-0000000000b1','zz/euclide.jpg','ready');

-- Une empreinte de 128 valeurs dont seules les deux premières sont non nulles : c'est suffisant
-- pour fixer une distance, et ça se lit.
create or replace function pg_temp.vecteur(p_a numeric, p_b numeric) returns text language sql immutable as $$
  select '[' || p_a || ',' || p_b || repeat(',0', 126) || ']'; $$;

insert into visages_reference (player_id, empreinte, modele, origine, ajoute_par) values
  ('ee110000-0000-0000-0000-0000000000d1', pg_temp.vecteur(1, 0)::vector, 'zz-modele', 'famille',
   'ee110000-0000-0000-0000-000000000001');

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

select set_config('request.jwt.claims',
  json_build_object('sub','ee110000-0000-0000-0000-000000000001','role','authenticated')::text, true);
set local role authenticated;

-- 1. LE FAUX POSITIF. (0,68 ; 0,7332) est à 0,80 de (1 ; 0) en euclidien : deux personnes
--    différentes. En cosinus il n'est qu'à 0,32, donc l'ancienne version le rapprochait, et même
--    le marquait « certain ». Il ne doit plus rien rendre.
select pg_temp.note('deux visages differents (0,80 en euclidien) ne sont pas rapproches', 'aucun',
  (select case when exists (
     select 1 from visage_rapprocher_direct('ee110000-0000-0000-0000-0000000000f1',
       pg_temp.vecteur(0.68, 0.7332)::vector, 'zz-modele', 0.55)) then 'RAPPROCHE' else 'aucun' end));

-- 2. ET LA RECONNAISSANCE MARCHE TOUJOURS. (0,955 ; 0,2965) est à 0,30 : la même personne sur deux
--    photos. Sans ce contrôle, poser un seuil trop sévère passerait pour une correction.
select pg_temp.note('le meme visage (0,30 en euclidien) est bien rapproche', 'rapproche',
  (select case when exists (
     select 1 from visage_rapprocher_direct('ee110000-0000-0000-0000-0000000000f1',
       pg_temp.vecteur(0.955, 0.2965)::vector, 'zz-modele', 0.55)) then 'rapproche' else 'AUCUN' end));

-- 3. LA GRANDEUR ELLE-MÊME. C'est le contrôle qui nomme le défaut : la fonction doit rendre 0,300,
--    la distance euclidienne. L'ancienne version rendait 0,045, le cosinus des mêmes vecteurs.
select pg_temp.note('la distance rendue est bien l''euclidienne, pas le cosinus', '0.300',
  (select to_char(round(distance, 3), 'FM0.000') from visage_rapprocher_direct(
     'ee110000-0000-0000-0000-0000000000f1', pg_temp.vecteur(0.955, 0.2965)::vector, 'zz-modele', 0.55)
   limit 1));

-- 4. LE SEUIL DE CERTITUDE, celui qui écrit un marquage en « valide » sans relecture humaine.
--    À 0,80 il ne doit même pas être atteint : on demande ici le seuil « certain » de 0,42.
select pg_temp.note('a 0,42 — le seuil qui marque sans relecture — le visage different est ecarte', 'aucun',
  (select case when exists (
     select 1 from visage_rapprocher_direct('ee110000-0000-0000-0000-0000000000f1',
       pg_temp.vecteur(0.68, 0.7332)::vector, 'zz-modele', 0.42)) then 'RAPPROCHE' else 'aucun' end));

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
