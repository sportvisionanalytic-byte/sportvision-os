-- Le cas complet : une couverture réellement affectée à deux opérateurs.
-- Tout est monté puis annulé (rollback) : rien ne subsiste en base.

begin;

create temp table ctx on commit drop as
  select id as match_id, 'match:' || id::text as ref, club_id,
         (select portail_client_id from clubs where id = m.club_id) as client_id
    from club_matches m
   where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   limit 1;

-- Les comptes : un CM, un opérateur photo, un vidéaste, et un rôle non interne.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values ('11111111-1111-1111-1111-111111111111','zz-cm@example.invalid','',now(),'authenticated','authenticated'),
       ('22222222-2222-2222-2222-222222222222','zz-externe@example.invalid','',now(),'authenticated','authenticated'),
       ('33333333-3333-3333-3333-333333333333','zz-photo@example.invalid','',now(),'authenticated','authenticated'),
       ('44444444-4444-4444-4444-444444444444','zz-video@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into profiles (id, prenom, nom, role) values
  ('11111111-1111-1111-1111-111111111111','Test','CM','cm'),
  ('22222222-2222-2222-2222-222222222222','Test','Externe','photo'),
  ('33333333-3333-3333-3333-333333333333','Mickaël','Photographe','photo'),
  ('44444444-4444-4444-4444-444444444444','Lincoln','Vidéaste','photo')
on conflict (id) do update set prenom = excluded.prenom, nom = excluded.nom, role = excluded.role;

-- On n'invente pas un CM : Villemomble en a déjà un, et une contrainte garantit qu'il n'y en a
-- qu'un seul principal actif par club. On teste donc avec le CM RÉEL du club — c'est aussi le
-- périmètre réel qu'on vérifie, pas un périmètre fabriqué pour l'occasion.
create temp table cm on commit drop as
  select cm_id as id from club_cm_affectations, ctx
   where club_cm_affectations.club_id = ctx.club_id and actif limit 1;

-- La chaîne réelle : plan du mois → présence planifiée → prestation → équipe.
insert into monthly_production_plans (id, client_id, cm_id, mois)
select '55555555-5555-5555-5555-555555555555', client_id,
       '11111111-1111-1111-1111-111111111111', date_trunc('month', current_date)::date
  from ctx;

insert into prestations (id, client_id, date_prestation, type_prestation, statut)
select '66666666-6666-6666-6666-666666666666', client_id, current_date, 'match', 'équipe_affectée' from ctx;

insert into planned_presences (plan_id, date_presence, match_id, occurrence_ref, type_couverture, statut, created_prestation_id)
select '55555555-5555-5555-5555-555555555555', current_date, match_id, ref, 'photo_video', 'mission_creee',
       '66666666-6666-6666-6666-666666666666'
  from ctx;

-- Deux opérateurs affectés, un troisième qui a REFUSÉ.
--
-- Ni rémunération ni est_responsable dans cet INSERT : un trigger existant
-- (protect_sensitive_affectation_fields) les réserve à la Production et à la Comptabilité, et il a
-- refusé l'écriture — ce qui est exactement le comportement voulu. Que ces champs ne SORTENT pas
-- est de toute façon garanti par la signature de la fonction, vérifiée séparément.
-- Le montage se fait sous un profil admin : protect_sensitive_affectation_fields réserve la pose
-- d'un statut à la Production. C'est la protection voulue, on s'y conforme au lieu de la
-- contourner.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values ('99999999-9999-9999-9999-999999999999','zz-admin@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role)
values ('99999999-9999-9999-9999-999999999999','Test','Admin','admin')
on conflict (id) do update set role = 'admin';
select set_config('request.jwt.claims','{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);

insert into prestations_equipe (prestation_id, collaborateur_id, fonction, statut)
values ('66666666-6666-6666-6666-666666666666','33333333-3333-3333-3333-333333333333','Photographe','acceptée'),
       ('66666666-6666-6666-6666-666666666666','44444444-4444-4444-4444-444444444444','Vidéaste','acceptée'),
       ('66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222','Photographe','refusée');

create temp table resultats(cas text, valeur text) on commit drop;

-- ── Le CM voit les opérateurs ──
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from cm), 'role', 'authenticated')::text, true);
insert into resultats
select 'CM — opérateurs vus',
       coalesce(string_agg(o.prenom || ' (' || o.fonction || ')', ', ' order by o.prenom), '(aucun)')
  from ctx, lateral couverture_operateurs(ctx.ref) o;

-- ── Un refus n'est pas une affectation ──
insert into resultats
select 'CM — un refus est-il affiché ?',
       case when bool_or(o.prenom = 'Test') then 'OUI (défaut)' else 'non' end
  from ctx, lateral couverture_operateurs(ctx.ref) o;

-- ── Le rôle non interne ne voit rien ──
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
insert into resultats
select 'rôle non interne — lignes rendues', count(*)::text
  from ctx, lateral couverture_operateurs(ctx.ref) o;

-- Diagnostic : à quelle étape la chaîne se rompt-elle ?
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from cm), 'role', 'authenticated')::text, true);
insert into resultats select 'diag — club dans le périmètre du CM',
  case when (select club_id from ctx) in (select cm_clubs_autorises()) then 'oui' else 'NON' end;
insert into resultats select 'diag — CM réel du club',
  coalesce((select p.prenom || ' ' || p.nom from profiles p, cm where p.id = cm.id), '(aucun)');
insert into resultats select 'diag — présence retrouvée',
  count(*)::text from planned_presences pp, ctx where pp.occurrence_ref = ctx.ref;
insert into resultats select 'diag — équipe de prestation',
  count(*)::text from prestations_equipe where prestation_id='66666666-6666-6666-6666-666666666666';

select * from resultats;

rollback;
