-- Un community manager fait partie de l'équipe (v370, 30/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • un `cm` voit l'annuaire interne de SportVision, comme les autres métiers ;
--   • il ne modifie toujours AUCUN profil que le sien — l'ouverture est en lecture seule ;
--   • un profil qui n'est PAS de l'équipe reste invisible à un `cm` cloisonné.
--
-- LE DÉFAUT QUE ÇA FIGE : la policy restrictive `cm_hors_perimetre_profiles` réduisait un `cm` à
-- son seul profil. Mesuré le 30/09 par le chemin réel — 1 profil visible pour chris et Tony, 18
-- pour tous les autres. Tony avait deux messages qu'il ne pouvait pas retrouver : la messagerie
-- construit sa liste de contacts à partir des profils.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('cc11cc11-0000-0000-0000-000000000001','zz-cm-annuaire@example.invalid','',now(),'authenticated','authenticated'),
  ('cc11cc11-0000-0000-0000-000000000002','zz-photo-annuaire@example.invalid','',now(),'authenticated','authenticated'),
  ('cc11cc11-0000-0000-0000-000000000003','zz-hors-equipe@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into profiles (id, prenom, nom, role, actif) values
  ('cc11cc11-0000-0000-0000-000000000001','ZZ','CM test','cm',true),
  ('cc11cc11-0000-0000-0000-000000000002','ZZ','Photo test','photo',true),
  -- Celui-ci a une fiche joueur : ce n'est PAS quelqu'un de l'équipe SportVision, et il doit
  -- rester invisible au CM. C'est le contrôle qui empêche cette migration de tout ouvrir.
  ('cc11cc11-0000-0000-0000-000000000003','ZZ','Hors équipe','photo',true)
on conflict (id) do nothing;

insert into player_profiles (user_id, prenom, nom, date_naissance, account_status)
values ('cc11cc11-0000-0000-0000-000000000003','ZZ','Hors équipe', date '2010-01-01','actif');

-- Le partage de pôle est la SECONDE porte (policy permissive `Staff lecture annuaire`). Sans lui,
-- ce test serait vert pour la mauvaise raison : on ne verrait rien, et on croirait tester la
-- restriction alors qu'on testerait le pôle.
insert into pole_affectations (user_id, pole_id)
select id, (select pole_id from pole_affectations group by pole_id order by count(*) desc limit 1)
from profiles where id in ('cc11cc11-0000-0000-0000-000000000001','cc11cc11-0000-0000-0000-000000000002','cc11cc11-0000-0000-0000-000000000003')
on conflict do nothing;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

-- On se met VRAIMENT dans la peau du CM : rôle `authenticated` et claims JWT. Interroger en
-- `postgres` répondrait « oui » à tout (leçon du 10/09).
create or replace function pg_temp.vu_par(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'refusé';
end $$;

select pg_temp.note('le CM voit le photographe de son pôle', 'true',
  pg_temp.vu_par('cc11cc11-0000-0000-0000-000000000001',
    'select exists(select 1 from profiles where id = ''cc11cc11-0000-0000-0000-000000000002'')::text'));

select pg_temp.note('le CM se voit lui-même', 'true',
  pg_temp.vu_par('cc11cc11-0000-0000-0000-000000000001',
    'select exists(select 1 from profiles where id = ''cc11cc11-0000-0000-0000-000000000001'')::text'));

select pg_temp.note('un profil hors équipe reste invisible au CM', 'false',
  pg_temp.vu_par('cc11cc11-0000-0000-0000-000000000001',
    'select exists(select 1 from profiles where id = ''cc11cc11-0000-0000-0000-000000000003'')::text'));

select pg_temp.note('le photographe, lui, voit ce même profil', 'true',
  pg_temp.vu_par('cc11cc11-0000-0000-0000-000000000002',
    'select exists(select 1 from profiles where id = ''cc11cc11-0000-0000-0000-000000000003'')::text'));

select pg_temp.note('le CM ne modifie PAS le profil d''un collègue', '0',
  pg_temp.vu_par('cc11cc11-0000-0000-0000-000000000001',
    'with m as (update profiles set telephone = ''0600000000'' where id = ''cc11cc11-0000-0000-0000-000000000002'' returning 1) select count(*)::text from m'));

select pg_temp.note('le CM modifie bien le sien', '1',
  pg_temp.vu_par('cc11cc11-0000-0000-0000-000000000001',
    'with m as (update profiles set telephone = ''0600000000'' where id = ''cc11cc11-0000-0000-0000-000000000001'' returning 1) select count(*)::text from m'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
