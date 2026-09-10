-- Une demande du club devient un contenu, au même endroit (migration v125, 10/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • le CM transforme une demande : un contenu en brouillon, relié à la demande, et la demande
--     passe « en traitement » ;
--   • transformer deux fois ne crée pas deux contenus ;
--   • le suivi des demandes et le calendrier voient ce contenu ;
--   • un coach, ou un CM d'un autre club, ne transforme rien.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid as club_id,
         (select id from clubs where nom = 'Villeneuve 340 SC') as autre_club;
grant select on ctx to authenticated;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('bcbcbcbc-0000-0000-0000-000000000001','zz-parc-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('bcbcbcbc-0000-0000-0000-000000000002','zz-parc-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('bcbcbcbc-0000-0000-0000-000000000003','zz-parc-cm-autre@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role) values
  ('bcbcbcbc-0000-0000-0000-000000000001','QA','CM','cm'),
  ('bcbcbcbc-0000-0000-0000-000000000003','QA','CM autre','cm')
on conflict (id) do update set role = excluded.role;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'bcbcbcbc-0000-0000-0000-000000000001'::uuid, 'secondaire', current_date, true from ctx
union all
select autre_club, 'bcbcbcbc-0000-0000-0000-000000000003'::uuid, 'secondaire', current_date, true from ctx;
insert into club_members (user_id, club_id, role, status, teams)
select 'bcbcbcbc-0000-0000-0000-000000000002'::uuid, club_id, 'coach', 'actif', '[]'::jsonb from ctx;

create temp table demande on commit drop as
  with ins as (
    insert into club_requests (club_id, team, type, requester_name, status, urgency, detail)
    select club_id, 'U12', 'affiche', 'QA', 'recues', 'normale', 'Affiche tournoi U12' from ctx
    returning id)
  select id from ins;
grant select on demande to authenticated;

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
create temp table memo (cle text primary key, v text) on commit drop;
grant select, insert on memo to authenticated;

create or replace function pg_temp.en(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.hors() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts values (p_c, p_a, p_o); $$;

do $$
declare r record; v_ok text;
begin
  for r in select * from (values ('coach du club', 'bcbcbcbc-0000-0000-0000-000000000002'::uuid),
                                 ('CM d''un autre club', 'bcbcbcbc-0000-0000-0000-000000000003'::uuid)) t(qui, uid) loop
    perform pg_temp.en(r.uid);
    begin perform transformer_demande_en_contenu((select id from demande)); v_ok := 'autorisé';
    exception when others then v_ok := 'refusé'; end;
    perform pg_temp.hors();
    perform pg_temp.note('transformer en contenu — ' || r.qui, 'refusé', v_ok);
  end loop;
end $$;

do $$
declare v_id uuid; v_id2 uuid; v_c contenus; v_suivi int; v_cal int;
begin
  perform pg_temp.en('bcbcbcbc-0000-0000-0000-000000000001');
  v_id := transformer_demande_en_contenu((select id from demande), null, current_date + 3, 'instagram');
  v_id2 := transformer_demande_en_contenu((select id from demande));
  select count(*) into v_suivi from club_demandes_contenus((select club_id from ctx)) s where s.request_id = (select id from demande);
  select count(*) into v_cal from club_contenus_calendrier((select club_id from ctx), current_date, current_date + 7) c where c.id = v_id;
  perform pg_temp.hors();
  select * into v_c from contenus where id = v_id;
  perform pg_temp.note('le contenu naît en brouillon', 'brouillon', coalesce(v_c.statut, 'absent'));
  perform pg_temp.note('le contenu est relié à la demande', 'oui', case when v_c.request_id = (select id from demande) then 'oui' else 'non' end);
  perform pg_temp.note('le contenu est porté par le CM', 'oui', case when v_c.cm_id = 'bcbcbcbc-0000-0000-0000-000000000001' then 'oui' else 'non' end);
  perform pg_temp.note('la demande passe en traitement', 'en_traitement', (select status from club_requests where id = (select id from demande)));
  perform pg_temp.note('transformer deux fois ne crée pas de doublon', 'oui', case when v_id = v_id2 then 'oui' else 'non' end);
  perform pg_temp.note('le suivi des demandes voit le contenu', '1', v_suivi::text);
  perform pg_temp.note('le calendrier voit la publication prévue', '1', v_cal::text);
end $$;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
