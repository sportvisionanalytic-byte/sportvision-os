-- « À couvrir » par le CM, et le coach adjoint (migration v124, 10/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • le CM affecté marque un match « À couvrir », en type Communication ; la demande est tracée
--     `cm_initiated`, se lit au calendrier, et le CM peut l'annuler ;
--   • un coach, ou un CM d'un autre club, ne marque rien ;
--   • un coach invité comme adjoint le reste une fois son invitation acceptée, et n'a ni plus ni
--     moins de droits qu'un coach.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid as club_id,
         (select id from clubs where nom = 'Villeneuve 340 SC') as autre_club,
         (select m.id from club_matches m where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
            and m.match_date >= current_date
            and not exists (select 1 from coverage_wishes w where w.match_id = m.id and w.status <> 'cancelled')
          order by m.match_date limit 1) as match_id,
         (select t.name from club_teams t where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' order by t.name limit 1) as equipe;
grant select on ctx to authenticated, anon;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('efefefef-0000-0000-0000-000000000001','zz-couv-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('efefefef-0000-0000-0000-000000000002','zz-couv-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('efefefef-0000-0000-0000-000000000003','zz-couv-cm-autre@example.invalid','',now(),'authenticated','authenticated'),
  ('efefefef-0000-0000-0000-000000000004','zz-couv-adjoint@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role) values
  ('efefefef-0000-0000-0000-000000000001','QA','CM','cm'),
  ('efefefef-0000-0000-0000-000000000003','QA','CM autre','cm')
on conflict (id) do update set role = excluded.role;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'efefefef-0000-0000-0000-000000000001'::uuid, 'secondaire', current_date, true from ctx
union all
select autre_club, 'efefefef-0000-0000-0000-000000000003'::uuid, 'secondaire', current_date, true from ctx;
insert into club_members (user_id, club_id, role, status, teams)
select 'efefefef-0000-0000-0000-000000000002'::uuid, club_id, 'coach', 'actif', to_jsonb(array[equipe]) from ctx;

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated, anon;
create temp table memo (cle text primary key, v text) on commit drop;
grant select, insert, update on memo to authenticated;

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

do $$ begin
  if (select match_id from ctx) is null then
    raise exception 'DÉCOR INVALIDE : aucun match à venir sans demande de couverture.';
  end if;
end $$;

-- ── Un coach, puis un CM d'un autre club, ne marquent rien ──
do $$
declare r record; v_ok text;
begin
  for r in select * from (values ('coach du club', 'efefefef-0000-0000-0000-000000000002'::uuid),
                                 ('CM d''un autre club', 'efefefef-0000-0000-0000-000000000003'::uuid)) t(qui, uid) loop
    perform pg_temp.en(r.uid);
    begin
      perform create_coverage_wishes((select club_id from ctx),
        jsonb_build_array(jsonb_build_object('match_id', (select match_id from ctx), 'coverage_type', 'photo')));
      v_ok := 'autorisé';
    exception when others then v_ok := 'refusé';
    end;
    perform pg_temp.hors();
    perform pg_temp.note('marquer « À couvrir » — ' || r.qui, 'refusé', v_ok);
  end loop;
end $$;

-- ── Le CM marque, en Communication ──
do $$
declare v_ok text; v_w coverage_wishes; v_lu int;
begin
  perform pg_temp.en('efefefef-0000-0000-0000-000000000001');
  begin
    select * into v_w from create_coverage_wishes((select club_id from ctx),
      jsonb_build_array(jsonb_build_object('match_id', (select match_id from ctx), 'coverage_type', 'communication', 'note', 'QA')));
    v_ok := 'autorisé';
  exception when others then v_ok := 'refusé : ' || sqlerrm;
  end;
  select count(*) into v_lu from club_souhaits_couverture((select club_id from ctx)) s where s.match_id = (select match_id from ctx);
  perform pg_temp.hors();
  insert into memo values ('wish', v_w.id::text);
  perform pg_temp.note('marquer « À couvrir » — CM affecté', 'autorisé', v_ok);
  perform pg_temp.note('la demande porte le type Communication', 'communication', coalesce(v_w.requested_coverage_type, 'nul'));
  perform pg_temp.note('la demande est tracée « initiée par le CM »', 'cm_initiated', coalesce(v_w.source, 'nul'));
  perform pg_temp.note('le calendrier la lit', '1', v_lu::text);
end $$;

-- ── Le CM l'annule ──
do $$
declare v_ok text;
begin
  perform pg_temp.en('efefefef-0000-0000-0000-000000000001');
  begin perform cancel_coverage_wish((select v from memo where cle = 'wish')::uuid); v_ok := 'autorisé';
  exception when others then v_ok := 'refusé : ' || sqlerrm; end;
  perform pg_temp.hors();
  perform pg_temp.note('annuler sa demande — CM affecté', 'autorisé', v_ok);
  perform pg_temp.note('la demande est annulée', 'cancelled',
    (select status from coverage_wishes where id = (select v from memo where cle = 'wish')::uuid));
end $$;

-- ── Le coach adjoint : un libellé, pas un droit ──
do $$
declare v_inv club_invitations; v_m club_members; v_educ boolean; v_team uuid;
begin
  perform pg_temp.en('efefefef-0000-0000-0000-000000000001');
  select * into v_inv from preparer_invitation_club((select club_id from ctx), 'zz-couv-adjoint@example.invalid', 'coach', 'Ada', 'Adjointe', null,
                                                     to_jsonb(array[(select equipe from ctx)]));
  update club_invitations set fonction = 'adjoint', statut = 'envoyee' where id = v_inv.id;
  perform pg_temp.hors();

  create temp table lien on commit drop as select token from club_invitations where id = v_inv.id;
  grant select on lien to authenticated;
  perform pg_temp.en('efefefef-0000-0000-0000-000000000004');
  select * into v_m from accepter_invitation_club((select token from lien));
  select id into v_team from club_teams where club_id = (select club_id from ctx) and name = (select equipe from ctx);
  v_educ := is_team_educateur(v_team);
  perform pg_temp.hors();

  perform pg_temp.note('adjoint : la fonction suit l''invitation jusqu''au membre', 'adjoint', coalesce(v_m.fonction, 'nul'));
  perform pg_temp.note('adjoint : son rôle reste « coach »', 'coach', coalesce(v_m.role, 'nul'));
  perform pg_temp.note('adjoint : il encadre son équipe comme un coach', 'oui', case when v_educ then 'oui' else 'non' end);
end $$;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
