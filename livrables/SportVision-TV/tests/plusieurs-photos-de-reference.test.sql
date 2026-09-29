-- Une deuxième photo de référence doit produire une deuxième empreinte (v331, 28/09/2026).
--
-- POURQUOI C'EST LE LEVIER. Mesuré sur « RCPF VS PSG U16 » : 183 visages relevés, 12 attribués.
-- Le plafond n'est pas dans les seuils, il est dans la matière — une seule photo de référence ne
-- reconnaît que les prises de vue qui lui ressemblent. Deux ou trois angles font davantage que
-- tous les réglages réunis.
--
-- CE QUI BLOQUAIT, ET C'ÉTAIT INVISIBLE. `reconnaissance_joueurs_prets` ne rendait que la DERNIÈRE
-- photo déposée, avec un drapeau vrai dès qu'une empreinte existait quelque part. Le moteur
-- passait son chemin : une famille pouvait déposer dix photos sans que la deuxième soit jamais
-- calculée, et rien ne le disait.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('b1110000-0000-0000-0000-000000000001','zz-ref-staff@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, role, actif) values ('b1110000-0000-0000-0000-000000000001','admin',true)
on conflict (id) do update set role='admin', actif=true;

insert into clubs (id, nom, ville, plan) values ('b1110000-0000-0000-0000-0000000000c1','ZZ Ref Club','ZZ','performance');
insert into club_teams (id, club_id, name) values ('b1110000-0000-0000-0000-0000000000a1','b1110000-0000-0000-0000-0000000000c1','ZZ U16 Ref');
insert into player_profiles (id, prenom, nom, date_naissance) values
  ('b1110000-0000-0000-0000-0000000000d1','ZZ','Reference','2010-01-01');
insert into team_memberships (player_id, team_id, club_id, saison, statut) values
  ('b1110000-0000-0000-0000-0000000000d1','b1110000-0000-0000-0000-0000000000a1','b1110000-0000-0000-0000-0000000000c1','2026-2027','active');
insert into consentements_biometrie (id, player_id, donne_par, qualite, texte_version, statut) values
  ('b1110000-0000-0000-0000-0000000000cc','b1110000-0000-0000-0000-0000000000d1',
   'b1110000-0000-0000-0000-000000000001','parent','zz-test','accorde');

insert into media_albums (id, club_id, team_id, title, status) values
  ('b1110000-0000-0000-0000-0000000000b1','b1110000-0000-0000-0000-0000000000c1',
   'b1110000-0000-0000-0000-0000000000a1','ZZ Galerie Ref','published');

-- DEUX photos de reference, deposees a des moments differents : c'est tout le sujet.
-- `consentement_id` n'est pas decoratif : un declencheur exige que la photo pointe vers un accord
-- REELLEMENT accorde pour CE sportif. C'est ce qui empeche une empreinte d'exister sans son accord.
insert into player_face_refs (id, player_id, storage_path, consentement_id, moteur) values
  ('b1110000-0000-0000-0000-0000000000e1','b1110000-0000-0000-0000-0000000000d1','zz/ref-face.jpg','b1110000-0000-0000-0000-0000000000cc','zz-modele'),
  ('b1110000-0000-0000-0000-0000000000e2','b1110000-0000-0000-0000-0000000000d1','zz/ref-profil.jpg','b1110000-0000-0000-0000-0000000000cc','zz-modele');

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

-- Une empreinte de 128 valeurs dont les deux premieres suffisent a la distinguer.
create or replace function pg_temp.vecteur(p_a numeric, p_b numeric) returns text language sql immutable as $$
  select '[' || p_a || ',' || p_b || repeat(',0', 126) || ']'; $$;

select set_config('request.jwt.claims',
  json_build_object('sub','b1110000-0000-0000-0000-000000000001','role','authenticated')::text, true);
set local role authenticated;

-- Ce que le moteur recoit : une ligne PAR photo, et aucune n'est encore calculee.
select pg_temp.note('les DEUX photos de reference sont proposees au calcul', '2',
  (select count(*)::text from reconnaissance_joueurs_prets('b1110000-0000-0000-0000-0000000000b1', 'zz-modele')
    where player_id = 'b1110000-0000-0000-0000-0000000000d1'));

select pg_temp.note('aucune n''a encore d''empreinte', '0',
  (select count(*)::text from reconnaissance_joueurs_prets('b1110000-0000-0000-0000-0000000000b1', 'zz-modele')
    where player_id = 'b1110000-0000-0000-0000-0000000000d1' and a_une_empreinte));

-- Le moteur calcule la premiere.
select visage_reference_ajouter('b1110000-0000-0000-0000-0000000000d1',
  pg_temp.vecteur(1, 0)::vector, 'zz-modele', 'b1110000-0000-0000-0000-0000000000e1');

-- LE CONTROLE QUI COMPTE. Avant la v331, la seconde photo etait declaree « deja calculee » parce
-- qu'une empreinte existait pour ce sportif, et le moteur ne la lisait jamais.
select pg_temp.note('la SECONDE photo reste a calculer', '1',
  (select count(*)::text from reconnaissance_joueurs_prets('b1110000-0000-0000-0000-0000000000b1', 'zz-modele')
    where player_id = 'b1110000-0000-0000-0000-0000000000d1' and not a_une_empreinte));

select visage_reference_ajouter('b1110000-0000-0000-0000-0000000000d1',
  pg_temp.vecteur(0.955, 0.2965)::vector, 'zz-modele', 'b1110000-0000-0000-0000-0000000000e2');

select pg_temp.note('les deux sont calculees, et le moteur ne repasse pas dessus', '0',
  (select count(*)::text from reconnaissance_joueurs_prets('b1110000-0000-0000-0000-0000000000b1', 'zz-modele')
    where player_id = 'b1110000-0000-0000-0000-0000000000d1' and not a_une_empreinte));

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Les empreintes ne sont PAS lisibles par un compte famille, et c'est voulu : on compte donc ici,
-- hors de sa peau. Le refus rencontre en ecrivant ce test est lui-meme une bonne nouvelle.
select pg_temp.note('le sportif a bien DEUX empreintes', '2',
  (select count(*)::text from visages_reference where player_id = 'b1110000-0000-0000-0000-0000000000d1'));

-- ── Ce que ça change pour la reconnaissance : la MEILLEURE des deux l'emporte ─────────────────
insert into media_assets (id, album_id, original_path, status) values
  ('b1110000-0000-0000-0000-0000000000f1','b1110000-0000-0000-0000-0000000000b1','zz/photo.jpg','ready');

select set_config('request.jwt.claims',
  json_build_object('sub','b1110000-0000-0000-0000-000000000001','role','authenticated')::text, true);
set local role authenticated;

-- Un visage a 0,30 de la SECONDE reference et a 0,80 de la premiere : avec la seule premiere
-- photo, il etait perdu. C'est exactement le profil qu'on ne retrouvait pas.
select pg_temp.note('un visage proche de la SECONDE photo est retrouve', 'rapproche',
  (select case when exists (
     select 1 from visage_rapprocher_direct('b1110000-0000-0000-0000-0000000000f1',
       pg_temp.vecteur(0.891, 0.5531)::vector, 'zz-modele', 0.55)) then 'rapproche' else 'AUCUN' end));

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
