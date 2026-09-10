-- Ville, vehicule et permis : Admin + Production, et l'interesse. Personne d'autre.
--
-- Decision de Fouka du 10/09/2026 : ces trois champs servent a organiser les DEPLACEMENTS, donc
-- ils appartiennent a la Production, pas a l'annuaire. Le telephone, lui, reste volontairement
-- ouvert a tout collaborateur interne : joindre quelqu'un sur le terrain est une urgence reelle.
--
-- Le test mesure ce que la BASE rend. L'ecran « Annuaire equipe » est ouvert a compta et com par
-- leur menu, et a photo et cm par le bouton de leur messagerie : masquer un badge n'aurait rien
-- protege, l'API repond a qui la questionne.
--
-- Identites fabriquees dans la transaction puis annulees : aucun identifiant a pourrir.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

create or replace function pg_temp.voit(q text) returns boolean language plpgsql as $i$
declare n integer;
begin execute 'select count(*) from ('||q||') z' into n; return n > 0;
exception when others then return false; end $i$;

create temp table res(role text, surface text, vu boolean) on commit drop;
grant all on res to authenticated, anon;
create temp table t(k text, v uuid) on commit drop;
grant all on t to authenticated, anon;

do $$
declare u uuid; x text; pf uuid; cible uuid;
begin
  perform set_config('role','postgres',true);
  pf := pole_football_id();

  -- Une cible : un collaborateur avec une ville, un vehicule et un permis renseignes.
  cible := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (cible,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cible-'||cible||'@example.invalid','',now(),now(),now());
  insert into profiles (id, role, prenom, nom, email, actif) values (cible,'photo','ZZ','CIBLE','zz-cible@example.invalid',true);
  insert into pole_affectations (pole_id, user_id, role_pole) values (pf, cible, 'membre') on conflict do nothing;
  insert into collaborateur_logistique (collaborateur_id, ville, vehicule, permis)
    values (cible, 'ZZ Villeneuve', true, true);
  insert into t values ('_cible', cible);

  foreach x in array array['admin','prod','sec','compta','cm','photo','com'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-'||x||'-'||u||'@example.invalid','',now(),now(),now());
    insert into profiles (id, role, prenom, nom, email, actif) values (u,x,'ZZ',upper(x),'zz-'||x||'-'||u||'@example.invalid',true);
    insert into pole_affectations (pole_id, user_id, role_pole) values (pf, u, 'membre') on conflict do nothing;
    insert into t values (x, u);
    -- Le photographe recoit SA propre ligne : sans elle, le controle « voit-il ses propres
    -- informations ? » ne mesurait rien et passait au vert pour de mauvaises raisons.
    if x = 'photo' then
      insert into collaborateur_logistique (collaborateur_id, ville, vehicule, permis)
        values (u, 'ZZ Sa Ville', true, false);
    end if;
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select k, v from t where k not like '\_%' loop
    perform pg_temp.incarner(r.v);
    insert into res values (r.k, 'logistique de la cible',
      pg_temp.voit('select 1 from collaborateur_logistique where collaborateur_id=(select v from t where k=''_cible'')'));
    insert into res values (r.k, 'ville via profiles',
      pg_temp.voit('select 1 from profiles where id=(select v from t where k=''_cible'') and ville is not null'));
    insert into res values (r.k, 'sa propre logistique',
      pg_temp.voit('select 1 from collaborateur_logistique where collaborateur_id=auth.uid()'));
  end loop;
  perform set_config('role','anon',true); perform set_config('request.jwt.claims','',true);
  insert into res values ('anon','logistique de la cible',
    pg_temp.voit('select 1 from collaborateur_logistique'));
  perform set_config('role','postgres',true);
end $$;

do $$
declare e text[] := '{}'; r record;
begin
  -- 1. Seuls admin et prod atteignent la logistique d'un collegue.
  for r in select role from res
    where vu and surface='logistique de la cible' and role not in ('admin','prod')
  loop e := e || format('%s lit la logistique d''un collegue', r.role); end loop;

  -- 2. La ville ne doit plus fuir par profiles, pour personne.
  for r in select role from res where vu and surface='ville via profiles'
  loop e := e || format('%s lit encore la ville via profiles', r.role); end loop;

  -- 3. Chacun garde acces a SES propres informations.
  if not exists (select 1 from res where vu and role='photo' and surface='sa propre logistique')
  then e := e || 'un photographe ne lit plus ses propres informations'::text; end if;

  -- 4. Vitalite : admin et prod doivent bien voir, sinon le test passe pour rien.
  if not exists (select 1 from res where vu and role='admin' and surface='logistique de la cible')
  then e := e || 'DECOR MORT : l''administration ne voit pas la logistique'::text; end if;
  if not exists (select 1 from res where vu and role='prod' and surface='logistique de la cible')
  then e := e || 'DECOR MORT : la Production ne voit pas la logistique'::text; end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select surface,
  coalesce(string_agg(role, ', ' order by role) filter (where vu), 'personne') as acces
from res group by surface order by surface;

rollback;
