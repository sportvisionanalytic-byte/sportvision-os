-- Matrice d'acces complete : 11 identites, ce que la BASE rend, pas ce que l'ecran affiche.
--
-- POURQUOI CE FICHIER REMPLACE audit-acces-roles.test.sql. L'ancienne matrice codait en dur six
-- identifiants de production. Au 10/09/2026, TROIS d'entre eux ne correspondaient plus a aucun
-- profil (Production, Secretariat, CM : comptes supprimes depuis). Quand le `sub` d'un jeton
-- pointe vers un profil inexistant, get_my_role() rend NULL : ces trois lignes mesuraient un
-- utilisateur sans role, pas le role annonce. Et comme l'ancien fichier se contentait d'AFFICHER
-- des comptages sans rien affirmer, personne ne pouvait s'en apercevoir. Une matrice qui rassure
-- sans rien verifier est pire que pas de matrice.
--
-- Ce test ne code donc aucun identifiant : il fabrique ses onze identites, joue, et annule tout.
-- Rien ne subsiste en production, et rien ne peut pourrir.
--
-- LE DECOR COMPTE. Premiere version de cette mesure : tous les roles internes semblaient ne voir
-- que leur propre fiche, Production comprise. L'instrument etait bon, le decor faux — les deux
-- policies en cause passent par le POLE (pole_scope_ok, profile_shares_pole_with_caller) et mes
-- comptes fabriques n'en avaient aucun. En production, tout collaborateur est affecte a un pole
-- des sa creation (ensure_default_pole_affectation, avec repli sur Football). On reproduit donc
-- ce decor, sinon on mesure une situation qui n'existe pas.
--
-- CE QUE LE TEST AFFIRME. Pas chaque case de la matrice : elle bougera legitimement. Seulement ce
-- qui ne doit JAMAIS arriver, plus trois controles de vitalite du decor.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

-- Un refus prend deux formes acceptables : zero ligne, ou une erreur de permission. Les deux
-- comptent comme « ne voit pas ». Ce qui compte est qu'aucune ligne ne sorte.
create or replace function pg_temp.voit(q text) returns boolean language plpgsql as $i$
declare n integer;
begin execute 'select count(*) from ('||q||') z' into n; return n > 0;
exception when insufficient_privilege then return false;
          when others then return false; end $i$;

create temp table res(role text, surface text, vu boolean) on commit drop;
grant all on res to authenticated, anon;
create temp table t(k text, v uuid) on commit drop;
grant all on t to authenticated, anon;

do $$
declare cl uuid; pr uuid; org uuid; org2 uuid; team uuid; alb uuid; u uuid; x text; pf uuid;
begin
  perform set_config('role','postgres',true);
  pf := pole_football_id();

  -- Un client, une mission, sa facture, son devis, un echange : la chaine commerciale complete.
  insert into clients (nom, statut_relation) values ('ZZ Client Matrice','prospect') returning id into cl;
  insert into prestations (client_id, date_prestation, montant_ht, montant_ttc)
    values (cl, current_date+3, 100, 120) returning id into pr;
  insert into factures (numero, client_id, prestation_id, montant_ht, montant_ttc) values ('ZZ-MAT-F', cl, pr, 100, 120);
  insert into devis (numero, client_id, prestation_id, total_ttc) values ('ZZ-MAT-D', cl, pr, 120);
  insert into messages_client (client_id, auteur_type, contenu) values (cl,'client','ZZ temoin');

  -- Deux clubs : le second sert a verifier qu'un club n'atteint pas son voisin.
  org := gen_random_uuid(); org2 := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut)
    values (org,'club','ZZ Club Matrice','actif_standard'), (org2,'club','ZZ Club Voisin','actif_standard');
  insert into clubs (id, nom, plan) values (org,'ZZ Club Matrice','performance'), (org2,'ZZ Club Voisin','performance');
  insert into club_teams (club_id, name) values (org,'ZZ Equipe M') returning id into team;
  insert into club_teams (club_id, name) values (org2,'ZZ Equipe Voisine');
  insert into media_albums (club_id, team_id, title, status) values (org, team,'ZZ Galerie M','published') returning id into alb;
  insert into t values ('_client',cl),('_prestation',pr),('_org',org),('_org2',org2),('_album',alb);

  -- Sept roles internes, chacun avec le pole Football comme en production.
  foreach x in array array['admin','prod','sec','compta','cm','photo','com'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-'||x||'-'||u||'@example.invalid','',now(),now(),now());
    insert into profiles (id, role, prenom, nom, email, actif) values (u,x,'ZZ',upper(x),'zz-'||x||'-'||u||'@example.invalid',true);
    insert into pole_affectations (pole_id, user_id, role_pole) values (pf, u, 'membre') on conflict do nothing;
    insert into t values (x, u);
  end loop;
  insert into club_cm_affectations (club_id, cm_id, role, actif) values (org,(select v from t where k='cm'),'principal',true);

  -- Une huitieme fiche interne, JAMAIS incarnee : elle sert de cible pour « voit-il un collegue ? ».
  -- Sans elle, la question posee au comptable revenait a lui demander s'il se voit lui-meme.
  u := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cible-'||u||'@example.invalid','',now(),now(),now());
  insert into profiles (id, role, prenom, nom, email, actif) values (u,'photo','ZZ','CIBLE','zz-cible-'||u||'@example.invalid',true);
  insert into pole_affectations (pole_id, user_id, role_pole) values (pf, u, 'membre') on conflict do nothing;
  insert into t values ('_cible', u);

  -- Quatre identites externes : cote club et cote famille.
  foreach x in array array['coach','president','joueur','parent'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-'||x||'-'||u||'@example.invalid','',now(),now(),now());
    insert into t values (x, u);
  end loop;
  insert into club_members (club_id, user_id, role, status) values
    (org,(select v from t where k='coach'),'coach','actif'),
    (org,(select v from t where k='president'),'president','actif');
end $$;

do $$
declare r record; i integer; s text[][];
begin
  s := array[
    array['clients',        'select 1 from clients where id=(select v from t where k=''_client'')'],
    array['prestations',    'select 1 from prestations where id=(select v from t where k=''_prestation'')'],
    array['factures',       'select 1 from factures where numero=''ZZ-MAT-F'''],
    array['devis',          'select 1 from devis where numero=''ZZ-MAT-D'''],
    array['messages_client','select 1 from messages_client where contenu=''ZZ temoin'''],
    array['galerie',        'select 1 from media_albums where id=(select v from t where k=''_album'')'],
    array['membres du club','select 1 from club_members where club_id=(select v from t where k=''_org'')'],
    array['equipes du club','select 1 from club_teams where club_id=(select v from t where k=''_org'')'],
    array['club voisin',    'select 1 from club_teams where club_id=(select v from t where k=''_org2'')'],
    array['annuaire',       'select 1 from profiles where id=(select v from t where k=''_cible'')'],
    array['notifs autrui',  'select 1 from notifications where destinataire_id<>auth.uid()']
  ];
  for r in select k, v from t where k not like '\_%' loop
    perform pg_temp.incarner(r.v);
    for i in 1..array_length(s,1) loop insert into res values (r.k, s[i][1], pg_temp.voit(s[i][2])); end loop;
  end loop;
  perform set_config('role','anon',true); perform set_config('request.jwt.claims','',true);
  for i in 1..array_length(s,1) loop insert into res values ('anon', s[i][1], pg_temp.voit(s[i][2])); end loop;
  perform set_config('role','postgres',true);
end $$;

-- Ce qui ne doit jamais arriver
do $$
declare e text[] := '{}'; r record;
begin
  -- 1. Commercial et finance : reserves a l'interne qui en a l'usage.
  for r in select role, surface from res
    where vu and surface in ('clients','prestations','factures','devis','messages_client')
      and role in ('photo','cm','coach','president','joueur','parent','anon')
  loop e := e || format('%s atteint %s', r.role, r.surface); end loop;

  -- 2. Un anonyme ne lit rien, nulle part.
  for r in select role, surface from res where vu and role='anon'
  loop e := e || format('un anonyme lit %s', r.surface); end loop;

  -- 3. Aucun club n'atteint le club voisin.
  for r in select role, surface from res where vu and surface='club voisin' and role in ('cm','coach','president')
  loop e := e || format('%s atteint le club voisin', r.role); end loop;

  -- 4. Joueur et parent non rattaches ne voient rien du club.
  for r in select role, surface from res where vu and role in ('joueur','parent')
  loop e := e || format('%s (non rattache) lit %s', r.role, r.surface); end loop;

  -- 5. Les notifications d'autrui n'appartiennent qu'a l'administration.
  for r in select role from res where vu and surface='notifs autrui' and role<>'admin'
  loop e := e || format('%s lit les notifications d''autrui', r.role); end loop;

  -- 6. Le CM reste cloisonne hors de l'annuaire interne (policy RESTRICTIVE cm_hors_perimetre).
  if exists (select 1 from res where vu and surface='annuaire' and role='cm')
  then e := e || 'le CM lit l''annuaire interne'::text; end if;

  -- 7. Le decor doit etre vivant, sinon tout ce qui precede passe pour de mauvaises raisons.
  if not exists (select 1 from res where vu and role='admin' and surface='factures')
  then e := e || 'DECOR MORT : l''administration ne voit pas ses propres factures'::text; end if;
  if not exists (select 1 from res where vu and role='photo' and surface='annuaire')
  then e := e || 'DECOR MORT : le photographe ne voit pas l''annuaire (pole non applique ?)'::text; end if;
  if not exists (select 1 from res where vu and role='coach' and surface='equipes du club')
  then e := e || 'DECOR MORT : le coach ne voit pas les equipes de son club'::text; end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

-- La matrice complete, pour lecture humaine.
select surface,
  coalesce(string_agg(role, ', ' order by role) filter (where vu), 'personne') as acces,
  coalesce(string_agg(role, ', ' order by role) filter (where not vu), '-') as refuse
from res group by surface order by surface;

rollback;
