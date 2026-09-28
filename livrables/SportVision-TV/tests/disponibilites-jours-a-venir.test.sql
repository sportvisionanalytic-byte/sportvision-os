-- Un collaborateur déclare ses disponibilités à l'avance, pas seulement pour aujourd'hui (28/09/2026).
--
-- CE QUI N'ALLAIT PAS, ET QUI N'ÉTAIT PAS EN BASE. La fiche collaborateur affiche « Disponibilités
-- des 14 prochains jours » depuis des semaines. Le seul chemin d'écriture de l'OS forçait
-- `date = aujourd'hui` : l'onglet était donc vide par construction, et la table contenait UNE
-- ligne, datée du 28 juillet. Personne ne pouvait dire « je suis pris samedi ».
--
-- La base, elle, acceptait déjà les dates à venir — aucune contrainte ne les interdit. C'est
-- l'écran qui bornait. Ce test existe pour que ça le reste : il fixe ce que la base doit accepter,
-- pour qu'une future policy ne referme pas la porte sans que rien ne le dise.
--
-- ET IL TIENT LE PÉRIMÈTRE. Chacun déclare la sienne, personne ne déclare à la place d'un autre,
-- et la Production lit tout le monde — c'est elle qui affecte les missions.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ad110000-0000-0000-0000-000000000001','zz-dispo-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('ad110000-0000-0000-0000-000000000002','zz-dispo-autre@example.invalid','',now(),'authenticated','authenticated'),
  ('ad110000-0000-0000-0000-000000000003','zz-dispo-prod@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into profiles (id, role, actif, prenom, nom) values
  ('ad110000-0000-0000-0000-000000000001','photo',true,'ZZ','Dispo'),
  ('ad110000-0000-0000-0000-000000000002','photo',true,'ZZ','Autre'),
  ('ad110000-0000-0000-0000-000000000003','prod', true,'ZZ','Prod')
on conflict (id) do update set role = excluded.role, actif = true;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.sous(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.stop() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;

-- L'upsert exact que fait l'OS : insert on conflict, donc les deux policies sont sollicitées.
create or replace function pg_temp.declarer(p_uid uuid, p_pour uuid, p_jours int, p_statut text) returns text
language plpgsql as $$
begin
  perform pg_temp.sous(p_uid);
  insert into disponibilites (collaborateur_id, date, statut)
  values (p_pour, (current_date + p_jours), p_statut)
  on conflict (collaborateur_id, date) do update set statut = excluded.statut;
  perform pg_temp.stop();
  return 'accepte';
exception when others then
  perform pg_temp.stop();
  return 'refuse';
end $$;

create or replace function pg_temp.lit(p_uid uuid, p_de uuid, p_jours int) returns text
language plpgsql as $$
declare v text;
begin
  perform pg_temp.sous(p_uid);
  select statut into v from disponibilites
   where collaborateur_id = p_de and date = (current_date + p_jours);
  perform pg_temp.stop();
  return coalesce(v, '∅');
exception when others then
  perform pg_temp.stop();
  return 'refuse';
end $$;

select pg_temp.note('il declare sa disponibilite pour dans 7 jours', 'accepte',
  pg_temp.declarer('ad110000-0000-0000-0000-000000000001','ad110000-0000-0000-0000-000000000001',7,'indisponible'));

select pg_temp.note('et pour aujourd''hui, comme avant', 'accepte',
  pg_temp.declarer('ad110000-0000-0000-0000-000000000001','ad110000-0000-0000-0000-000000000001',0,'disponible'));

-- Se raviser est le cas normal : un samedi se libère.
select pg_temp.note('il se ravise sur le meme jour', 'accepte',
  pg_temp.declarer('ad110000-0000-0000-0000-000000000001','ad110000-0000-0000-0000-000000000001',7,'sous_conditions'));

select pg_temp.note('c''est bien la derniere reponse qui reste', 'sous_conditions',
  pg_temp.lit('ad110000-0000-0000-0000-000000000001','ad110000-0000-0000-0000-000000000001',7));

select pg_temp.note('un collegue ne declare pas a sa place', 'refuse',
  pg_temp.declarer('ad110000-0000-0000-0000-000000000002','ad110000-0000-0000-0000-000000000001',9,'disponible'));

select pg_temp.note('la Production lit sa disponibilite a venir : c''est elle qui affecte', 'sous_conditions',
  pg_temp.lit('ad110000-0000-0000-0000-000000000003','ad110000-0000-0000-0000-000000000001',7));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
