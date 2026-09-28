-- Le matériel d'un collaborateur : qui le saisit, qui le lit, et le résumé qui suit (v328).
--
-- Demande de Fouka : savoir quel appareil, quel modèle, quel objectif possède un photographe, pour
-- affecter les missions en connaissance de cause. Avant la v328, la fiche n'affichait que le mot
-- « oui », recopié de la candidature.
--
-- CE TEST TIENT TROIS CHOSES ENSEMBLE :
--
-- 1. LE PÉRIMÈTRE. Le collaborateur saisit le sien, la Production et l'Admin lisent, un collègue
--    photographe ne lit rien. Du matériel personnel de valeur, c'est savoir qui a un boîtier à
--    3 000 € chez lui : ça se borne comme la ville et le véhicule l'ont été le 10/09.
--
-- 2. LE RÉSUMÉ N'EST JAMAIS SAISI DEUX FOIS. `profiles.materiel_personnel` alimente déjà quatre
--    écrans (alerte « kit requis », filtre de l'annuaire, carte d'équipe). Il est désormais
--    recalculé par déclencheur. Le contrôle va jusqu'au bout : quand le dernier équipement est
--    supprimé, la colonne redevient NULL et l'alerte « kit requis » se rallume.
--
-- 3. LA LOGISTIQUE N'A PAS BOUGÉ. La v328 réécrit sa policy pour qu'elle appelle la règle commune
--    au lieu d'en garder une copie. Une réécriture de policy qui élargit l'accès sans que rien le
--    signale est exactement le genre de faille qu'on ferme le reste du temps : les deux derniers
--    contrôles vérifient que son périmètre est le même qu'avant.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ac110000-0000-0000-0000-000000000001','zz-photo-lui@example.invalid','',now(),'authenticated','authenticated'),
  ('ac110000-0000-0000-0000-000000000002','zz-photo-collegue@example.invalid','',now(),'authenticated','authenticated'),
  ('ac110000-0000-0000-0000-000000000003','zz-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('ac110000-0000-0000-0000-000000000004','zz-compta@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into profiles (id, role, actif, prenom, nom) values
  ('ac110000-0000-0000-0000-000000000001','photo',true,'ZZ','Lui'),
  ('ac110000-0000-0000-0000-000000000002','photo',true,'ZZ','Collegue'),
  ('ac110000-0000-0000-0000-000000000003','prod', true,'ZZ','Production'),
  ('ac110000-0000-0000-0000-000000000004','compta',true,'ZZ','Comptable')
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

-- Un refus LÈVE une exception : sans enveloppe, elle annulerait tout le test au lieu d'être mesurée.
create or replace function pg_temp.essai_saisie(p_uid uuid, p_pour uuid, p_modele text) returns text
language plpgsql as $$
begin
  perform pg_temp.sous(p_uid);
  insert into collaborateur_materiel (collaborateur_id, type, marque, modele)
  values (p_pour, 'boitier_photo', 'ZZ', p_modele);
  perform pg_temp.stop();
  return 'accepte';
exception when others then
  perform pg_temp.stop();
  return 'refuse';
end $$;

create or replace function pg_temp.combien_lit(p_uid uuid, p_de uuid) returns text
language plpgsql as $$
declare n int;
begin
  perform pg_temp.sous(p_uid);
  select count(*) into n from collaborateur_materiel where collaborateur_id = p_de;
  perform pg_temp.stop();
  return n::text;
exception when others then
  perform pg_temp.stop();
  return 'refuse';
end $$;

-- ── 1. Le périmètre ───────────────────────────────────────────────────────────────────────────

select pg_temp.note('le photographe saisit LUI-MEME son materiel', 'accepte',
  pg_temp.essai_saisie('ac110000-0000-0000-0000-000000000001','ac110000-0000-0000-0000-000000000001','A7 III'));

select pg_temp.note('un collegue photographe ne saisit rien pour lui', 'refuse',
  pg_temp.essai_saisie('ac110000-0000-0000-0000-000000000002','ac110000-0000-0000-0000-000000000001','Vol'));

select pg_temp.note('la Production lit son materiel : c''est elle qui affecte', '1',
  pg_temp.combien_lit('ac110000-0000-0000-0000-000000000003','ac110000-0000-0000-0000-000000000001'));

select pg_temp.note('un collegue photographe ne lit pas son materiel', '0',
  pg_temp.combien_lit('ac110000-0000-0000-0000-000000000002','ac110000-0000-0000-0000-000000000001'));

select pg_temp.note('la comptabilite non plus', '0',
  pg_temp.combien_lit('ac110000-0000-0000-0000-000000000004','ac110000-0000-0000-0000-000000000001'));

-- ── 2. Le résumé suit tout seul ───────────────────────────────────────────────────────────────

select pg_temp.note('le resume est ecrit sur la fiche sans etre saisi', 'ZZ A7 III',
  (select coalesce(materiel_personnel,'∅') from profiles where id = 'ac110000-0000-0000-0000-000000000001'));

insert into collaborateur_materiel (collaborateur_id, type, marque, modele, precision_libre)
values ('ac110000-0000-0000-0000-000000000001','objectif','ZZ','70-200','f/2.8');

select pg_temp.note('un second equipement s''ajoute au resume', 'ZZ A7 III · ZZ 70-200 (f/2.8)',
  (select coalesce(materiel_personnel,'∅') from profiles where id = 'ac110000-0000-0000-0000-000000000001'));

delete from collaborateur_materiel where collaborateur_id = 'ac110000-0000-0000-0000-000000000001';

-- Sans ce contrôle, un résumé resté en place ferait croire qu'un opérateur est équipé alors qu'il
-- ne l'est plus, et l'alerte « kit requis » ne se rallumerait jamais.
select pg_temp.note('plus rien de declare : la fiche redevient vide et « kit requis » se rallume', '∅',
  (select coalesce(materiel_personnel,'∅') from profiles where id = 'ac110000-0000-0000-0000-000000000001'));

-- ── 3. La logistique n'a pas changé de périmètre ──────────────────────────────────────────────

insert into collaborateur_logistique (collaborateur_id, ville, vehicule, permis)
values ('ac110000-0000-0000-0000-000000000001','ZZ Ville', true, true)
on conflict (collaborateur_id) do update set ville = 'ZZ Ville';

create or replace function pg_temp.lit_logistique(p_uid uuid, p_de uuid) returns text
language plpgsql as $$
declare v text;
begin
  perform pg_temp.sous(p_uid);
  select ville into v from collaborateur_logistique where collaborateur_id = p_de;
  perform pg_temp.stop();
  return coalesce(v, '∅');
exception when others then
  perform pg_temp.stop();
  return 'refuse';
end $$;

select pg_temp.note('la Production lit toujours la ville', 'ZZ Ville',
  pg_temp.lit_logistique('ac110000-0000-0000-0000-000000000003','ac110000-0000-0000-0000-000000000001'));

select pg_temp.note('un collegue photographe ne lit toujours pas la ville', '∅',
  pg_temp.lit_logistique('ac110000-0000-0000-0000-000000000002','ac110000-0000-0000-0000-000000000001'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
