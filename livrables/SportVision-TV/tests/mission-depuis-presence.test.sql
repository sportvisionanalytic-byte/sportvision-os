-- Une présence décidée par le CM crée sa mission chez le responsable production (v126, 10/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • décider une présence crée AUSSITÔT la mission (« planifiée », prête à affecter), adressée au
--     responsable production du pôle du club, qui reçoit une notification ;
--   • rechanger le type met la mission à jour, sans en créer une seconde ;
--   • retirer avant affectation annule la présence et prévient la production, qui annule la
--     mission elle-même ; une fois une équipe invitée, le retrait est refusé au CM.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid as club_id,
         (select m.id from club_matches m where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
            and m.match_date >= current_date
            and not exists (select 1 from planned_presences pp where pp.match_id = m.id and pp.statut <> 'annule')
          order by m.match_date limit 1) as match_id,
         (select m.id from club_matches m where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
            and m.match_date >= current_date
            and not exists (select 1 from planned_presences pp where pp.match_id = m.id and pp.statut <> 'annule')
          order by m.match_date offset 1 limit 1) as match_id_2,
         (select responsable_production_du_client(c.portail_client_id) from clubs c where c.id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54') as resp_prod;
grant select on ctx to authenticated;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('dededede-0000-0000-0000-000000000001','zz-mission-cm@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role) values ('dededede-0000-0000-0000-000000000001','QA','CM','cm')
on conflict (id) do update set role = excluded.role;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'dededede-0000-0000-0000-000000000001'::uuid, 'secondaire', current_date, true from ctx;

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;

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
  if (select match_id_2 from ctx) is null then raise exception 'DÉCOR INVALIDE : deux matchs à venir sans présence requis.'; end if;
end $$;

-- ── Décider une présence ──
do $$
declare v jsonb; v_pp planned_presences; v_m prestations; v_notif int;
begin
  perform pg_temp.en('dededede-0000-0000-0000-000000000001');
  v := cm_definir_couverture('match:' || (select match_id from ctx), 'photo');
  perform pg_temp.hors();
  select * into v_pp from planned_presences where match_id = (select match_id from ctx) and statut <> 'annule';
  select * into v_m from prestations where id = v_pp.created_prestation_id;
  -- Un responsable unique dans le pôle la reçoit seul ; sinon toute la production active la reçoit
  -- (règle existante, destinataires_production). Le test vaut dans les deux cas.
  select count(*) into v_notif from notifications n where n.prestation_id = v_m.id and n.type = 'nouvelle_mission'
     and n.destinataire_id in (select destinataires_production(v_m.id));
  perform pg_temp.note('la présence passe « mission créée »', 'mission_creee', coalesce(v_pp.statut, 'absente'));
  perform pg_temp.note('la mission est « planifiée », prête à affecter', 'planifiée', coalesce(v_m.statut::text, 'absente'));
  perform pg_temp.note('la mission porte le type de couverture', 'photo', coalesce(v_m.couverture, 'nul'));
  perform pg_temp.note('la mission est adressée au responsable production du pôle (ou à toute la production)', 'oui',
    case when v_m.responsable_prod_id is not distinct from (select resp_prod from ctx) then 'oui' else 'non' end);
  perform pg_temp.note('chaque destinataire production est notifié, une fois', (select count(*)::text from destinataires_production(v_m.id)), v_notif::text);
  perform pg_temp.note('la mission est reliée au match', 'oui', case when v_m.match_id = (select match_id from ctx) then 'oui' else 'non' end);
end $$;

-- ── Changer le type : la même mission, mise à jour ──
do $$
declare v_n int; v_couv text; v_notif int;
begin
  perform pg_temp.en('dededede-0000-0000-0000-000000000001');
  perform cm_definir_couverture('match:' || (select match_id from ctx), 'photo_video');
  perform pg_temp.hors();
  select count(*), max(couverture) into v_n, v_couv from prestations where match_id = (select match_id from ctx) and statut <> 'annulée';
  select count(*) into v_notif from notifications n join prestations p on p.id = n.prestation_id
   where p.match_id = (select match_id from ctx) and n.titre = 'Type de couverture modifié';
  perform pg_temp.note('changer le type ne crée pas de seconde mission', '1', v_n::text);
  perform pg_temp.note('la mission prend le nouveau type', 'photo_video', coalesce(v_couv, 'nul'));
  perform pg_temp.note('la production est prévenue du changement', 'oui', case when v_notif > 0 then 'oui' else 'non' end);
end $$;

-- ── Retirer avant affectation ──
do $$
declare v_ok text; v_statut_pp text; v_statut_m text; v_notif int;
begin
  perform pg_temp.en('dededede-0000-0000-0000-000000000001');
  begin perform cm_annuler_couverture('match:' || (select match_id from ctx)); v_ok := 'autorisé';
  exception when others then v_ok := 'refusé : ' || sqlerrm; end;
  perform pg_temp.hors();
  select pp.statut, p.statut::text into v_statut_pp, v_statut_m
    from planned_presences pp join prestations p on p.id = pp.created_prestation_id
   where pp.match_id = (select match_id from ctx) order by pp.updated_at desc limit 1;
  select count(*) into v_notif from notifications n join prestations p on p.id = n.prestation_id
   where p.match_id = (select match_id from ctx) and n.titre = 'Couverture retirée par le CM';
  perform pg_temp.note('retirer avant affectation — CM', 'autorisé', v_ok);
  perform pg_temp.note('la présence est annulée', 'annule', coalesce(v_statut_pp, 'nul'));
  perform pg_temp.note('la mission reste à la production, qui l''annule', 'planifiée', coalesce(v_statut_m, 'nul'));
  perform pg_temp.note('la production est prévenue du retrait', 'oui', case when v_notif > 0 then 'oui' else 'non' end);
end $$;

-- ── Retirer une fois une équipe invitée : refusé ──
do $$
declare v_ok text; v_mission uuid;
begin
  perform pg_temp.en('dededede-0000-0000-0000-000000000001');
  perform cm_definir_couverture('match:' || (select match_id_2 from ctx), 'video');
  perform pg_temp.hors();
  select created_prestation_id into v_mission from planned_presences where match_id = (select match_id_2 from ctx) and statut <> 'annule';
  insert into prestations_equipe (prestation_id, collaborateur_id, statut)
  values (v_mission, (select id from profiles where role = 'photo' and coalesce(actif, true) limit 1), 'invitation_envoyée');
  perform pg_temp.en('dededede-0000-0000-0000-000000000001');
  begin perform cm_annuler_couverture('match:' || (select match_id_2 from ctx)); v_ok := 'autorisé';
  exception when others then v_ok := 'refusé'; end;
  perform pg_temp.hors();
  perform pg_temp.note('retirer une fois une équipe invitée — CM', 'refusé', v_ok);
end $$;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
