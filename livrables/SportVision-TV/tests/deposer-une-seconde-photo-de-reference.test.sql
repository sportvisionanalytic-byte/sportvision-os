-- Déposer une seconde photo de référence ne doit pas effacer la première (v332, 28/09/2026).
--
-- LE LEVIER, ET CE QUI LE BLOQUAIT. Mesuré sur une vraie galerie : une seule photo de référence ne
-- reconnaît que les prises de vue qui lui ressemblent. Deux ou trois angles font davantage que
-- tous les seuils réunis, et la comparaison retient déjà spontanément la meilleure empreinte.
--
-- Sauf que `enregistrer_photo_reference` faisait un `delete` de toutes les photos de l'accord avant
-- d'insérer la nouvelle. Déposer une deuxième photo effaçait donc la première, et l'envoyait même
-- à la purge. La v331 avait levé le verrou du moteur pour rien : il n'y avait jamais plus d'une
-- photo à calculer.
--
-- CE QUE LE TEST TIENT AUSSI. Une donnée biométrique de mineur ne s'accumule pas sans fin : on
-- s'arrête à cinq photos. Et le dépôt reste borné à la famille du sportif, l'accord faisant foi.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('b2110000-0000-0000-0000-000000000001','zz-2ref-ado@example.invalid','',now(),'authenticated','authenticated'),
  ('b2110000-0000-0000-0000-000000000002','zz-2ref-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('b2110000-0000-0000-0000-000000000003','zz-2ref-inconnu@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into clubs (id, nom, ville, plan) values ('b2110000-0000-0000-0000-0000000000c1','ZZ 2Ref Club','ZZ','performance');
-- Un mineur de 13 ans : c'est le PARENT qui donne l'accord, mais l'enfant depose lui-meme
-- (decision de Fouka du 28/09 : « le parent n'est pas oblige de le faire a sa place »).
insert into player_profiles (id, club_id, prenom, nom, date_naissance, account_status, user_id) values
  ('b2110000-0000-0000-0000-0000000000d1','b2110000-0000-0000-0000-0000000000c1','ZZ','Ado',
   (current_date - interval '13 years')::date,'actif','b2110000-0000-0000-0000-000000000001');

insert into parent_profiles (id, user_id, prenom, nom)
values ('b2110000-0000-0000-0000-000000000002','b2110000-0000-0000-0000-000000000002','ZZ','Parent')
on conflict (id) do nothing;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
values ('b2110000-0000-0000-0000-000000000002','b2110000-0000-0000-0000-0000000000d1','parent','confirme',now());

insert into consentements_biometrie (id, player_id, donne_par, qualite, texte_version, statut) values
  ('b2110000-0000-0000-0000-0000000000cc','b2110000-0000-0000-0000-0000000000d1',
   'b2110000-0000-0000-0000-000000000002','parent','zz-test','accorde');

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

create or replace function pg_temp.deposer(p_uid uuid, p_nom text) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  perform enregistrer_photo_reference('b2110000-0000-0000-0000-0000000000d1',
    'visages/b2110000-0000-0000-0000-0000000000d1/' || p_nom);
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'accepte';
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'refuse';
end $$;

-- ── Le défaut que la v331 avait rendu visible ─────────────────────────────────────────────────

select pg_temp.note('l''ado de 13 ans depose LUI-MEME sa premiere photo', 'accepte',
  pg_temp.deposer('b2110000-0000-0000-0000-000000000001','face.jpg'));

select pg_temp.note('il en depose une SECONDE, sous un autre angle', 'accepte',
  pg_temp.deposer('b2110000-0000-0000-0000-000000000001','profil.jpg'));

-- LE CONTROLE QUI COMPTE : la premiere etait effacee, et meme envoyee a la purge.
select pg_temp.note('les DEUX photos sont conservees', '2',
  (select count(*)::text from player_face_refs where player_id = 'b2110000-0000-0000-0000-0000000000d1'));

select pg_temp.note('et aucune n''a ete envoyee a la purge', '0',
  (select count(*)::text from biometrie_a_purger where player_id = 'b2110000-0000-0000-0000-0000000000d1'));

-- Le meme chemin deux fois ne cree pas de doublon : on reappuie sur le bouton, ca n'ajoute rien.
select pg_temp.deposer('b2110000-0000-0000-0000-000000000001','profil.jpg');
select pg_temp.note('deposer deux fois le meme fichier n''ajoute rien', '2',
  (select count(*)::text from player_face_refs where player_id = 'b2110000-0000-0000-0000-0000000000d1'));

-- ── La borne : une donnée biométrique de mineur ne s'accumule pas sans fin ────────────────────

select pg_temp.deposer('b2110000-0000-0000-0000-000000000001','a3.jpg');
select pg_temp.deposer('b2110000-0000-0000-0000-000000000001','a4.jpg');
select pg_temp.deposer('b2110000-0000-0000-0000-000000000001','a5.jpg');

select pg_temp.note('au-dela de cinq photos, c''est refuse', 'refuse',
  pg_temp.deposer('b2110000-0000-0000-0000-000000000001','a6.jpg'));

select pg_temp.note('il en reste bien cinq', '5',
  (select count(*)::text from player_face_refs where player_id = 'b2110000-0000-0000-0000-0000000000d1'));

-- ── Et le périmètre ne bouge pas ──────────────────────────────────────────────────────────────

select pg_temp.note('un inconnu ne depose rien pour ce sportif', 'refuse',
  pg_temp.deposer('b2110000-0000-0000-0000-000000000003','intrus.jpg'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
