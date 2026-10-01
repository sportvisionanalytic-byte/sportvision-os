-- Revendiquer une fiche pré-créée, et corriger son nom (v387, 01/10/2026).
--
-- CE QUE CE TEST DÉFEND :
--
--   1. QUE REVENDIQUER NE RATTACHE RIEN. C'est le trou v102 du 10/09 — un inconnu devenait parent
--      confirmé d'un mineur avec le code d'équipe, le nom et la date de naissance. Ici, déclarer
--      « c'est moi » laisse `player_profiles.user_id` NUL jusqu'à ce que le club tranche. Si cette
--      ligne saute, quiconque a un code d'équipe prend la fiche d'un enfant — et ses photos.
--
--   2. QUE LA LISTE NE DEVIENNE PAS UNE ÉNUMÉRATION. Un code ouvre UNE équipe, et seulement les
--      fiches sans compte. Pas le club, pas les fiches déjà prises, et jamais la photo.
--
--   3. QU'UNE CORRECTION D'IDENTITÉ LAISSE UNE TRACE, et qu'elle dise en quelle qualité.
--
-- Décor entièrement fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('e7110000-0000-0000-0000-000000000001','zz-saiden@example.invalid','',now(),'authenticated','authenticated'),
  ('e7110000-0000-0000-0000-000000000002','zz-inconnu@example.invalid','',now(),'authenticated','authenticated'),
  ('e7110000-0000-0000-0000-000000000003','zz-coach-rv@example.invalid','',now(),'authenticated','authenticated'),
  ('e7110000-0000-0000-0000-000000000004','zz-parent-rv@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with clu as (insert into clubs (nom, plan) values ('ZZ Club Revendication','performance') returning id),
       sai as (select id, label from saisons where active order by date_debut desc limit 1),
       ea as (insert into club_teams (club_id, name, categorie, saison_id)
              select clu.id, 'ZZ-RV-U13', 'U13', sai.id from clu, sai returning id),
       eb as (insert into club_teams (club_id, name, categorie, saison_id)
              select clu.id, 'ZZ-RV-U15', 'U15', sai.id from clu, sai returning id),
       -- Saiden, écrit DE MÉMOIRE par Fouka : « Sayden Kone » au lieu de « Saiden Koné ».
       p1 as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
              select id, 'Sayden', 'Kone', '2013-05-12', 'sans_compte' from clu returning id),
       p2 as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
              select id, 'Dupont', 'Martin', '2013-02-02', 'sans_compte' from clu returning id),
       -- Une fiche DÉJÀ prise : elle ne doit jamais apparaître dans la liste.
       p3 as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status, user_id)
              select id, 'Deja', 'Pris', '2013-03-03', 'actif', 'e7110000-0000-0000-0000-000000000002' from clu returning id),
       -- Une fiche de l'AUTRE équipe : le code de la première ne doit pas l'ouvrir.
       p4 as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
              select id, 'Autre', 'Equipe', '2011-04-04', 'sans_compte' from clu returning id)
  select (select id from clu) club, (select id from ea) eq_a, (select id from eb) eq_b,
         (select id from sai) saison, (select label from sai) saison_label,
         (select id from p1) saiden, (select id from p2) homonyme,
         (select id from p3) deja_pris, (select id from p4) autre_equipe;
grant select on ctx to authenticated;

insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
select saiden, eq_a, club, saison_label, saison, 'active' from ctx
union all select homonyme, eq_a, club, saison_label, saison, 'active' from ctx
union all select deja_pris, eq_a, club, saison_label, saison, 'active' from ctx
union all select autre_equipe, eq_b, club, saison_label, saison, 'active' from ctx;

insert into club_members (club_id, user_id, role, prenom, nom, teams, status)
select club, 'e7110000-0000-0000-0000-000000000003', 'coach', 'ZZ', 'Coach RV',
       '["ZZ-RV-U13","ZZ-RV-U15"]'::jsonb, 'actif' from ctx;

create temp table codes on commit drop as
  with a as (insert into team_invite_codes (club_id, team_id, code, actif)
             select club, eq_a, 'ZZ-RV-AAAAA', true from ctx returning code),
       b as (insert into team_invite_codes (club_id, team_id, code, actif)
             select club, eq_b, 'ZZ-RV-BBBBB', true from ctx returning code)
  select (select code from a) code_a, (select code from b) code_b;
grant select on codes to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant all on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(c text, a text, o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (c, a, o); $$;
create or replace function pg_temp.devenir(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub',p,'role','authenticated')::text, true); end $$;
create or replace function pg_temp.systeme() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;

-- ═══ 1. CE QU'ON PROPOSE ═══════════════════════════════════════════════════════════════════════

create or replace function pg_temp.liste(p_qui uuid, p_code text, p_nom text default null) returns text
language plpgsql as $$
declare r text;
begin
  perform pg_temp.devenir(p_qui);
  select string_agg(prenom || ' ' || nom, ' | ' order by o) into r
    from (select prenom, nom, row_number() over () o from fiches_a_revendiquer(p_code, p_nom)) x;
  perform pg_temp.systeme();
  return coalesce(r, 'liste vide');
exception when others then
  perform pg_temp.systeme();
  return 'refuse';
end $$;

select pg_temp.note('le code ouvre SON equipe, et seulement les fiches sans compte', 'Sayden Kone | Dupont Martin',
  pg_temp.liste('e7110000-0000-0000-0000-000000000001', (select code_a from codes)));

select pg_temp.note('un code inconnu ne rend aucune liste', 'liste vide',
  pg_temp.liste('e7110000-0000-0000-0000-000000000001', 'ZZ-RV-ZZZZZ'));

select pg_temp.note('le code de l''autre equipe ne montre pas Saiden', 'Autre Equipe',
  pg_temp.liste('e7110000-0000-0000-0000-000000000001', (select code_b from codes)));

-- LA FAUTE D'ORTHOGRAPHE : « Saiden Koné » tapé par l'arrivant, « Sayden Kone » en base. La
-- similarité TRIE, elle ne filtre pas : l'homonyme reste visible, le bon est en tête.
select pg_temp.note('un nom mal ecrit remonte la bonne fiche en premier, sans ecarter l''autre',
  'Sayden Kone | Dupont Martin',
  pg_temp.liste('e7110000-0000-0000-0000-000000000001', (select code_a from codes), 'Saiden Koné'));

-- Et l'inverse : demander « Durand Dupond » ne fait pas disparaître Saiden de la liste.
select pg_temp.note('et aucun nom ne fait disparaitre les autres', '2',
  (select count(*)::text from (
     select 1 from regexp_split_to_table(
       pg_temp.liste('e7110000-0000-0000-0000-000000000001', (select code_a from codes), 'Durand Dupond'),
       ' \| ')) x));

-- LA DATE DE NAISSANCE EXACTE ET LA PHOTO NE SORTENT PAS. L'année suffit à se reconnaître.
create or replace function pg_temp.colonnes_rendues() returns text language sql as $$
  select string_agg(a.attname::text, ',' order by a.attnum)
    from pg_proc p, unnest(p.proargnames) with ordinality n(nom, i)
    join pg_attribute a on false
   where false
$$;
select pg_temp.note('la fonction ne rend que l''annee de naissance, pas la date', 'annee_naissance',
  (select string_agg(x, ',') from unnest(
     (select proargnames from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
       where ns.nspname='public' and p.proname='fiches_a_revendiquer')) x
    where x like '%naissance%'));
select pg_temp.note('et aucune colonne de photo', 'aucune',
  coalesce((select string_agg(x, ',') from unnest(
     (select proargnames from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
       where ns.nspname='public' and p.proname='fiches_a_revendiquer')) x
    where x like '%chemin%' or x like '%storage%' or x like '%photo_url%'), 'aucune'));

-- ═══ 2. REVENDIQUER NE RATTACHE RIEN ═══════════════════════════════════════════════════════════

create or replace function pg_temp.revendiquer(p_qui uuid, p_fiche uuid, p_code text, p_q text) returns text
language plpgsql as $$
begin
  perform pg_temp.devenir(p_qui);
  perform revendiquer_fiche(p_fiche, p_code, p_q);
  perform pg_temp.systeme();
  return 'depose';
exception when others then
  perform pg_temp.systeme();
  return 'refuse';
end $$;

select pg_temp.note('le code d''une autre equipe ne revendique pas cette fiche', 'refuse',
  pg_temp.revendiquer('e7110000-0000-0000-0000-000000000001', (select saiden from ctx), (select code_b from codes), 'joueur'));

select pg_temp.note('une fiche deja rattachee ne se revendique pas', 'refuse',
  pg_temp.revendiquer('e7110000-0000-0000-0000-000000000001', (select deja_pris from ctx), (select code_a from codes), 'joueur'));

select pg_temp.note('Saiden revendique sa fiche', 'depose',
  pg_temp.revendiquer('e7110000-0000-0000-0000-000000000001', (select saiden from ctx), (select code_a from codes), 'joueur'));

-- LE POINT LE PLUS IMPORTANT DE CE FICHIER.
select pg_temp.note('revendiquer ne rattache RIEN : user_id reste vide', 'vide',
  coalesce((select user_id::text from player_profiles where id = (select saiden from ctx)), 'vide'));
select pg_temp.note('et la demande attend le club', 'en_attente',
  (select statut from revendications_fiche where player_id = (select saiden from ctx)));

-- Revendiquer n'est pas consentir.
select pg_temp.note('revendiquer ne cree aucun accord de reconnaissance', '0',
  (select count(*)::text from consentements_biometrie where player_id = (select saiden from ctx)));
select pg_temp.note('revendiquer ne cree aucune empreinte', '0',
  (select count(*)::text from visages_reference where player_id = (select saiden from ctx)));

-- Réappuyer ne remplit pas la file du club.
select pg_temp.note('reappuyer ne cree pas une seconde demande', '1',
  (select count(*)::text from revendications_fiche where player_id = (select saiden from ctx)));

-- Personne ne peut se rattacher la fiche en direct, même avec une demande déposée.
-- CETTE SONDE RELIT LA VALEUR, et c'est la deuxième leçon du passage rouge. Première version : elle
-- rendait « accepte » dès que l'update ne levait pas d'exception. Or la RLS refuse SANS ERREUR —
-- zéro ligne touchée, zéro message — donc la sonde annonçait un rattachement réussi là où rien
-- n'avait bougé, et faisait accuser le produit. L'absence d'erreur n'est pas une réussite.
create or replace function pg_temp.forcer_rattachement(p_qui uuid, p_fiche uuid) returns text
language plpgsql as $$
declare v_lignes integer; v_relu uuid;
begin
  perform pg_temp.devenir(p_qui);
  execute 'set local role authenticated';
  update player_profiles set user_id = p_qui where id = p_fiche;
  get diagnostics v_lignes = row_count;
  execute 'reset role';
  perform pg_temp.systeme();
  select user_id into v_relu from player_profiles where id = p_fiche;
  if v_relu = p_qui then return 'accepte'; end if;
  return 'refuse';            -- 0 ligne, ou valeur non posée : dans les deux cas, refusé
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform pg_temp.systeme();
  return 'refuse';
end $$;
-- MESURÉ ROUGE AU PREMIER PASSAGE, et c'était le trou v102 rouvert : `current_setting` d'un réglage
-- jamais posé rend NULL, `not (… and NULL)` vaut NULL, et `if NULL then raise` ne lève rien. La
-- garde laissait donc l'arrivant se rattacher la fiche d'un enfant par un simple update.
select pg_temp.note('se rattacher la fiche en direct : refuse', 'refuse',
  pg_temp.forcer_rattachement('e7110000-0000-0000-0000-000000000001', (select saiden from ctx)));

-- ═══ 3. LE CLUB DÉCIDE ═════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.decider(p_qui uuid, p_rv uuid, p_d text) returns text
language plpgsql as $$
begin
  perform pg_temp.devenir(p_qui);
  perform decider_revendication(p_rv, p_d);
  perform pg_temp.systeme();
  return 'tranche';
exception when others then
  perform pg_temp.systeme();
  -- ON DIT POURQUOI. Un « refuse » muet a fait accuser la fonction alors que le refus venait d'un
  -- autre garde-fou de la table (guard_player_profile_update). Un test qui ne dit pas ce qu'il a lu
  -- fait chercher au mauvais endroit.
  return 'refuse: ' || left(sqlerrm, 60);
end $$;

select pg_temp.note('l''arrivant ne tranche pas sa propre demande', 'refuse', left(
  pg_temp.decider('e7110000-0000-0000-0000-000000000001',
    (select id from revendications_fiche where player_id = (select saiden from ctx)), 'confirme'), 6));
select pg_temp.note('un inconnu non plus', 'refuse', left(
  pg_temp.decider('e7110000-0000-0000-0000-000000000002',
    (select id from revendications_fiche where player_id = (select saiden from ctx)), 'confirme'), 6));
select pg_temp.note('le coach de l''equipe, oui', 'tranche',
  pg_temp.decider('e7110000-0000-0000-0000-000000000003',
    (select id from revendications_fiche where player_id = (select saiden from ctx)), 'confirme'));

-- ON RELIT LA VALEUR, pas le nombre de lignes.
select pg_temp.note('et LA VALEUR est posee', 'e7110000-0000-0000-0000-000000000001',
  coalesce((select user_id::text from player_profiles where id = (select saiden from ctx)), 'vide'));
select pg_temp.note('le compte passe d''un statut sans compte a actif', 'actif',
  (select account_status from player_profiles where id = (select saiden from ctx)));
select pg_temp.note('la fiche confirmee disparait de la liste a revendiquer', 'Dupont Martin',
  pg_temp.liste('e7110000-0000-0000-0000-000000000002', (select code_a from codes)));

-- ═══ 4. CORRIGER SON NOM, ET LA TRACE ══════════════════════════════════════════════════════════

create or replace function pg_temp.corriger(p_qui uuid, p_fiche uuid, p_prenom text, p_nom text) returns text
language plpgsql as $$
begin
  perform pg_temp.devenir(p_qui);
  perform corriger_identite_sportif(p_fiche, p_prenom, p_nom);
  perform pg_temp.systeme();
  return 'corrige';
exception when others then
  perform pg_temp.systeme();
  return 'refuse';
end $$;

select pg_temp.note('un inconnu ne corrige pas l''identite de Saiden', 'refuse',
  pg_temp.corriger('e7110000-0000-0000-0000-000000000002', (select saiden from ctx), 'Pirate', 'Pirate'));
select pg_temp.note('le coach non plus : la fiche appartient a son titulaire', 'refuse',
  pg_temp.corriger('e7110000-0000-0000-0000-000000000003', (select saiden from ctx), 'Coach', 'Corrige'));
select pg_temp.note('Saiden corrige l''orthographe de son nom', 'corrige',
  pg_temp.corriger('e7110000-0000-0000-0000-000000000001', (select saiden from ctx), 'Saiden', 'Koné'));
select pg_temp.note('et LA VALEUR est relue', 'Saiden Koné',
  (select prenom || ' ' || nom from player_profiles where id = (select saiden from ctx)));
select pg_temp.note('la correction est tracee, avec sa qualite', 'titulaire:Sayden>Saiden',
  (select qualite || ':' || avant || '>' || apres from identite_sportif_corrections
    where player_id = (select saiden from ctx) and champ = 'prenom'));
select pg_temp.note('les deux champs changes sont traces, pas un seul', '2',
  (select count(*)::text from identite_sportif_corrections where player_id = (select saiden from ctx)));

-- Le parent confirmé corrige aussi : « c'est la famille qui a raison » (Fouka).
insert into parent_profiles (id, user_id, prenom, nom)
values ('e7110000-0000-0000-0000-000000000004','e7110000-0000-0000-0000-000000000004','ZZ','Parent RV')
on conflict (id) do nothing;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'e7110000-0000-0000-0000-000000000004', homonyme, 'parent', 'confirme', now() from ctx;

select pg_temp.note('le parent confirme corrige le nom de son enfant', 'corrige',
  pg_temp.corriger('e7110000-0000-0000-0000-000000000004', (select homonyme from ctx), 'Dupond', 'Martin'));
select pg_temp.note('et sa correction est tracee en qualite de parent', 'parent',
  (select qualite from identite_sportif_corrections
    where player_id = (select homonyme from ctx) and champ = 'prenom'));

-- ═══ 5. LA REVENDICATION D'UN PARENT ALIMENTE LA FILE QUI EXISTE DÉJÀ ══════════════════════════

select pg_temp.note('un parent revendique la fiche de son enfant', 'depose',
  pg_temp.revendiquer('e7110000-0000-0000-0000-000000000004', (select autre_equipe from ctx), (select code_b from codes), 'parent'));
select pg_temp.note('le lien part EN ATTENTE, jamais confirme', 'en_attente_confirmation',
  (select ppr.statut from parent_player_relationships ppr
    where ppr.player_id = (select autre_equipe from ctx)));
-- LA FILE SE LIT AVEC LES DROITS DU CLUB. Lue en service_role, `liens_parents_a_decider` rend zéro
-- ligne (auth.uid() est nul, aucune de ses trois conditions n'est vraie) : une sonde mal identifiée
-- accuse le produit.
create or replace function pg_temp.file_parents(p_qui uuid, p_club uuid, p_joueur uuid) returns text
language plpgsql as $$
declare r integer;
begin
  perform pg_temp.devenir(p_qui);
  select count(*) into r from liens_parents_a_decider(p_club) where player_id = p_joueur;
  perform pg_temp.systeme();
  return r::text;
exception when others then
  perform pg_temp.systeme();
  return 'refuse';
end $$;
select pg_temp.note('et il apparait dans la file du club que v102 a posee', '1',
  pg_temp.file_parents('e7110000-0000-0000-0000-000000000003', (select club from ctx), (select autre_equipe from ctx)));
select pg_temp.note('aucune revendication joueur n''a ete creee pour un parent', '0',
  (select count(*)::text from revendications_fiche where player_id = (select autre_equipe from ctx)));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
