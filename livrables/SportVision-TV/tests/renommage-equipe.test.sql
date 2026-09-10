-- Renommer une équipe ne doit RIEN changer d'autre que son nom.
--
-- L'invariant, en une phrase : après un renommage, le coach garde exactement les mêmes droits sur
-- la même équipe, et toutes les références qui la désignaient la désignent encore.
--
-- Il vient d'un vrai défaut, mesuré en production le 10/09/2026 : un coach rattaché à
-- « Séniors R2 » passait de 28 matchs visibles à 0 dès que le CM renommait son équipe, sans le
-- moindre message. `club_members.teams` référence par NOM, `is_team_educateur` compare à la
-- lettre près, et rien ne les tenait synchronisés.
--
-- Ce test restera utile TANT QUE le rattachement se fait par nom. Le jour où il passera par
-- `team_id`, il devra continuer de passer — un invariant ne se périme pas avec son implémentation.
--
--   Exécution : coller ce fichier dans l'éditeur SQL, ou le POSTer sur
--   /v1/projects/<ref>/database/query. Tout est annulé, rien ne subsiste.

begin;

-- ── Le décor ──
create temp table ctx on commit drop as
  select t.id as team_id, t.club_id, t.name as nom_avant, t.name || ' Élite' as nom_apres
    from club_teams t
   where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
     and not coalesce(t.archivee, false)
     and exists (select 1 from club_matches m where m.team_id = t.id)
   limit 1;

-- Les tables temporaires appartiennent à `postgres` : sans ce droit, la lecture échoue dès qu'on
-- prend l'identité d'un utilisateur (`set local role authenticated`). Le test mesurerait alors une
-- erreur de décor et non le comportement du produit.
grant select on ctx to authenticated;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values ('aaaaaaaa-0000-0000-0000-000000000001','zz-coach-renommage@example.invalid','',now(),'authenticated','authenticated'),
       ('aaaaaaaa-0000-0000-0000-000000000002','zz-cm-renommage@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into profiles (id, prenom, nom, role)
values ('aaaaaaaa-0000-0000-0000-000000000002','QA','CM','cm')
on conflict (id) do update set role = 'cm';

insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'aaaaaaaa-0000-0000-0000-000000000002', 'secondaire', current_date, true from ctx;

insert into club_members (user_id, club_id, role, status, teams)
select 'aaaaaaaa-0000-0000-0000-000000000001', club_id, 'coach', 'actif', to_jsonb(array[nom_avant]) from ctx;

insert into club_invitations (club_id, email, prenom, role, teams, created_by, statut)
select club_id, 'zz-invite-renommage@example.invalid', 'QA', 'coach', to_jsonb(array[nom_avant]),
       'aaaaaaaa-0000-0000-0000-000000000002', 'envoyee' from ctx;

insert into club_newsroom_items (club_id, title, status, team)
select club_id, 'QA renommage', 'recu', nom_avant from ctx;

-- ── Mesure AVANT, avec l'identité du coach ──
select set_config('request.jwt.claims',
       json_build_object('sub','aaaaaaaa-0000-0000-0000-000000000001','role','authenticated')::text, false);
set local role authenticated;

create temp table avant on commit drop as
  select is_team_educateur((select team_id from ctx)) as acces,
         (select count(*) from club_matches where team_id = (select team_id from ctx)) as matchs;

reset role;
grant select on avant to authenticated;
select set_config('request.jwt.claims',
       json_build_object('sub','aaaaaaaa-0000-0000-0000-000000000001','role','authenticated')::text, false);
set local role authenticated;

-- Contrôle de vitalité du décor : si le coach n'a PAS accès avant le renommage, ce test ne mesure
-- rien et son succès ne prouverait rien.
do $$
begin
  if not (select acces from avant) then
    raise exception 'DÉCOR INVALIDE : le coach n''a pas accès à son équipe AVANT le renommage. Le test ne mesure rien.';
  end if;
  if (select matchs from avant) = 0 then
    raise exception 'DÉCOR INVALIDE : aucun match visible avant le renommage. Le test ne mesure rien.';
  end if;
end $$;

-- ── Le renommage, par le CM ──
reset role;
select set_config('request.jwt.claims',
       json_build_object('sub','aaaaaaaa-0000-0000-0000-000000000002','role','authenticated')::text, false);
set local role authenticated;

update club_teams set name = (select nom_apres from ctx) where id = (select team_id from ctx);

-- ── Mesure APRÈS, toujours avec l'identité du coach ──
reset role;
select set_config('request.jwt.claims',
       json_build_object('sub','aaaaaaaa-0000-0000-0000-000000000001','role','authenticated')::text, false);
set local role authenticated;

do $$
declare
  v_acces boolean;
  v_matchs bigint;
begin
  select is_team_educateur((select team_id from ctx)) into v_acces;
  select count(*) from club_matches where team_id = (select team_id from ctx) into v_matchs;

  if not v_acces then
    raise exception 'ÉCHEC : le coach a PERDU l''accès à son équipe après son renommage.';
  end if;
  if v_matchs <> (select matchs from avant) then
    raise exception 'ÉCHEC : le coach voyait % match(s) avant le renommage, % après.',
      (select matchs from avant), v_matchs;
  end if;
end $$;

-- ── Les références suivent ──
reset role;
do $$
declare v_nom text;
begin
  select nom_apres into v_nom from ctx;

  if not exists (select 1 from club_members
                  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and teams ? v_nom) then
    raise exception 'ÉCHEC : le périmètre du coach (club_members.teams) n''a pas suivi le renommage.';
  end if;
  if not exists (select 1 from club_invitations
                  where email = 'zz-invite-renommage@example.invalid' and teams ? v_nom) then
    raise exception 'ÉCHEC : l''invitation en cours désigne encore l''ancien nom.';
  end if;
  if not exists (select 1 from club_newsroom_items where title = 'QA renommage' and team = v_nom) then
    raise exception 'ÉCHEC : l''actualité désigne encore l''ancien nom.';
  end if;
  if exists (select 1 from club_matches
              where club_id = (select club_id from ctx) and team = (select nom_avant from ctx)) then
    raise exception 'ÉCHEC : des matchs portent encore l''ancien libellé d''équipe.';
  end if;
end $$;

-- ── Un nom déjà pris est refusé, proprement ──
do $$
declare v_autre uuid;
begin
  select id into v_autre from club_teams
   where club_id = (select club_id from ctx) and id <> (select team_id from ctx) limit 1;

  begin
    update club_teams set name = (select name from club_teams where id = v_autre)
     where id = (select team_id from ctx);
    raise exception 'ÉCHEC : renommer une équipe avec le nom d''une autre a été accepté.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'ÉCHEC%' then raise; end if;   -- ne pas avaler notre propre échec
    when unique_violation then null;
  end;
end $$;

select 'renommage-equipe : OK — le coach garde ses droits, les références suivent, la collision est refusée' as resultat;

rollback;
