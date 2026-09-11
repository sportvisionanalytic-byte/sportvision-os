-- Point 4 de l'audit Review du 11/09/2026 : le premier rattachement d'une fiche joueur à son client
-- (migration-blocages-review-4), en transaction annulée sur la base de production.
--
-- CE QUE LE TEST AFFIRME.
--   - Un joueur rattaché à un club, dont la fiche n'a pas encore de client, obtient son client par
--     les deux chemins de Connect : connect_resolve_beneficiary_client_id('self') (Mes commandes,
--     Factures, Réserver) et resolve_player_client_id (Messages). ROUGE sans la migration : le
--     déclencheur proteger_identite_joueur (v109) annulait tout.
--   - Le second appel rend le même client (rien n'est recréé), et le marqueur ne survit pas à l'appel.
--   - Personne ne DÉPLACE ce lien à la main : ni le joueur sur sa fiche (vers le client d'un autre,
--     ni même depuis NULL), ni le Président, ni le coach, ni le CM SportVision.
--
--   AVEC_MIGRATION=1 SEULEMENT=SQL node livrables/SportVision-TV/tests/blocages-review.test.mjs
--
-- Villeneuve 340 SC uniquement. Tout est annulé par le rollback final.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
end $i$;
create or replace function pg_temp.hors() returns void language plpgsql as $i$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $i$;
-- Exécute q ; rend sa valeur, ou « REFUS : <message> » quand la base refuse.
create or replace function pg_temp.essai(q text) returns text language plpgsql as $i$
declare v text;
begin
  execute q into v;
  return coalesce(v, '∅');
exception when others then
  return 'REFUS : ' || left(sqlerrm, 90);
end $i$;

create temp table ids (k text primary key, v uuid) on commit drop;
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant all on ids, verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;

-- ── Décor ─────────────────────────────────────────────────────────────────────────────────────
do $$
declare v_club uuid; u uuid; r text; pp uuid;
begin
  perform pg_temp.hors();
  select id into v_club from clubs where nom = 'Villeneuve 340 SC';
  if v_club is null then raise exception 'club de test introuvable'; end if;
  insert into ids values ('_club', v_club);
  -- Trois joueurs du club, fiche revendiquée, sans client : comme après une vraie inscription.
  foreach r in array array['joueur1', 'joueur2', 'joueur3'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'zz-blocages-' || r || '-' || u || '@example.invalid', '', now(), now(), now(),
              jsonb_build_object('first_name', 'ZZ', 'last_name', 'Blocages ' || r));
    insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
      values (v_club, u, 'ZZ', 'Blocages ' || r, '2010-01-01', 'actif') returning id into pp;
    insert into ids values (r, u), ('_pp_' || r, pp);
  end loop;
  -- Le club et SportVision, qui ne doivent pas pouvoir déplacer ce lien.
  foreach r in array array['president', 'coach'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-blocages-' || r || '-' || u || '@example.invalid', '', now(), now(), now());
    insert into club_members (club_id, user_id, role, status, prenom, nom, teams)
      values (v_club, u, r, 'actif', 'ZZ', 'Blocages ' || r, '[]'::jsonb);
    insert into ids values (r, u);
  end loop;
  u := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-blocages-cm-' || u || '@example.invalid', '', now(), now(), now());
  insert into profiles (id, role, prenom, nom, email, actif) values (u, 'cm', 'ZZ', 'CM', 'zz-blocages-cm-' || u || '@example.invalid', true);
  insert into club_cm_affectations (club_id, cm_id, role, actif) values (v_club, u, 'principal', true);
  insert into ids values ('cm', u);
end $$;

-- @@MIGRATIONS@@

-- ── 1. Le premier rattachement, par les deux chemins de Connect ──────────────────────────────
do $$
declare a text; b text; m text;
begin
  -- Mes commandes / Factures / Réserver : connect-player-prestations appelle cette fonction avec
  -- le jeton du joueur.
  perform pg_temp.incarner((select v from ids where k = 'joueur1'));
  a := pg_temp.essai('select connect_resolve_beneficiary_client_id(''self'', null)::text');
  m := coalesce(current_setting('sv.ecriture_systeme', true), '');
  b := pg_temp.essai('select connect_resolve_beneficiary_client_id(''self'', null)::text');
  perform pg_temp.hors();
  insert into ids values ('_client1', case when a ~ '^[0-9a-f-]{36}$' then a::uuid end);
  insert into verdicts (controle, attendu, obtenu) values
    ('[joueur1] Mes commandes : connect_resolve_beneficiary_client_id(self) rend son client', 'un client',
     case when a ~ '^[0-9a-f-]{36}$' then 'un client' else a end),
    ('[joueur1] la fiche porte ce client', 'oui',
     case when (select client_id::text from player_profiles where id = (select v from ids where k = '_pp_joueur1')) = a then 'oui' else 'non' end),
    ('[joueur1] second appel : le même client, rien de recréé', 'le même',
     case when b = a and a ~ '^[0-9a-f-]{36}$' then 'le même' else format('%s puis %s', a, b) end),
    ('[joueur1] le marqueur ne survit pas à l''appel', 'vide', case when m = '' then 'vide' else m end);

  -- Messages : resolve_player_client_id, avec le jeton du joueur.
  perform pg_temp.incarner((select v from ids where k = 'joueur2'));
  a := pg_temp.essai(format('select resolve_player_client_id(%L)::text', (select v from ids where k = '_pp_joueur2')));
  perform pg_temp.hors();
  insert into ids values ('_client2', case when a ~ '^[0-9a-f-]{36}$' then a::uuid end);
  insert into verdicts (controle, attendu, obtenu) values
    ('[joueur2] Messages : resolve_player_client_id rend son client', 'un client',
     case when a ~ '^[0-9a-f-]{36}$' then 'un client' else a end),
    ('[joueur2] la fiche porte ce client', 'oui',
     case when (select client_id::text from player_profiles where id = (select v from ids where k = '_pp_joueur2')) = a then 'oui' else 'non' end);
end $$;

-- ── 2. Personne ne déplace ce lien à la main ─────────────────────────────────────────────────
do $$
declare a text; p record;
  c2 uuid := coalesce((select v from ids where k = '_client2'), (select id from clients order by created_at limit 1));
  pp1 uuid := (select v from ids where k = '_pp_joueur1');
  pp3 uuid := (select v from ids where k = '_pp_joueur3');
begin
  -- Le joueur 1 tente de prendre le client du joueur 2 (sa fiche a déjà un client).
  perform pg_temp.incarner((select v from ids where k = 'joueur1'));
  a := pg_temp.essai(format('with m as (update player_profiles set client_id = %L where id = %L returning 1) select count(*)::text from m', c2, pp1));
  insert into verdicts (controle, attendu, obtenu) values ('[joueur1] remplace le client de sa fiche par celui d''un autre', 'refusé',
    case when a like 'REFUS%' or a = '0' then 'refusé' else 'ACCEPTÉ (' || a || ')' end);
  -- Le joueur 3 (fiche SANS client) tente de s'attribuer le client du joueur 2 : le premier
  -- rattachement n'est ouvert qu'aux fonctions de résolution, pas à une mise à jour directe.
  perform pg_temp.incarner((select v from ids where k = 'joueur3'));
  a := pg_temp.essai(format('with m as (update player_profiles set client_id = %L where id = %L returning 1) select count(*)::text from m', c2, pp3));
  insert into verdicts (controle, attendu, obtenu) values ('[joueur3] s''attribue directement le client d''un autre (fiche sans client)', 'refusé',
    case when a like 'REFUS%' or a = '0' then 'refusé' else 'ACCEPTÉ (' || a || ')' end);
  -- Le club et le CM SportVision, sur une fiche sans client puis sur une fiche avec client.
  for p in select k, v from ids where k in ('president', 'coach', 'cm') loop
    perform pg_temp.incarner(p.v);
    a := pg_temp.essai(format('with m as (update player_profiles set client_id = %L where id = %L returning 1) select count(*)::text from m', c2, pp3));
    insert into verdicts (controle, attendu, obtenu) values (format('[%s] rattache une fiche sans client à un client', p.k), 'refusé',
      case when a like 'REFUS%' or a = '0' then 'refusé' else 'ACCEPTÉ (' || a || ')' end);
    a := pg_temp.essai(format('with m as (update player_profiles set client_id = %L where id = %L returning 1) select count(*)::text from m', c2, pp1));
    insert into verdicts (controle, attendu, obtenu) values (format('[%s] remplace le client d''une fiche', p.k), 'refusé',
      case when a like 'REFUS%' or a = '0' then 'refusé' else 'ACCEPTÉ (' || a || ')' end);
  end loop;
  perform pg_temp.hors();
  insert into verdicts (controle, attendu, obtenu) values ('contrôle : la fiche du joueur 3 est toujours sans client', 'oui',
    case when (select client_id from player_profiles where id = pp3) is null then 'oui' else 'non' end);
end $$;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;

rollback;
