-- Le périmètre d'équipes d'un encadrant : qui le fixe, et ce qu'il ouvre vraiment.
--
-- POURQUOI CE FICHIER (13/09/2026). Fouka : « il y a des coachs qui font plusieurs équipes ou des
-- dirigeants qui ont plusieurs équipes ». Club+ ne savait attribuer qu'UNE équipe, au moment de
-- l'invitation, et plus jamais ensuite. L'écran vient d'être ouvert au multi-équipes et à la
-- modification après coup : il faut verrouiller ce que ce geste donne et ce qu'il refuse, parce
-- que `club_members.teams` n'est pas un affichage — `is_team_educateur` s'en sert pour décider qui
-- peut agir sur une équipe. Cocher une équipe donne des droits.
--
-- CE QU'ON MESURE :
--   1. Un coach n'agit que sur ses équipes.
--   2. L'administration du club élargit son périmètre, et les droits suivent immédiatement.
--   3. Un dirigeant (resp_equipe) multi-équipes a les mêmes droits terrain qu'un coach : inutile
--      de lui fabriquer un second compte « coach ».
--   4. Le coach ne s'élargit pas lui-même (v97), même sur sa propre ligne.
--   5. Retirer une équipe retire les droits, sans toucher aux autres.
--   6. Le périmètre ne traverse pas les clubs : une équipe d'un club voisin n'ouvre rien.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

create or replace function pg_temp.compte_os() returns void language plpgsql as $i$
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
end $i$;

do $$
declare
  orgA uuid; orgB uuid; t15 uuid; t17 uuid; tB uuid;
  patron uuid; coach uuid; dirigeant uuid;
  e text[] := '{}';
  refus text;
begin
  perform pg_temp.compte_os();

  orgA := gen_random_uuid(); orgB := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut) values
    (orgA,'club','ZZ Club Perim A','actif_standard'), (orgB,'club','ZZ Club Perim B','actif_standard');
  insert into clubs (id, nom, plan) values (orgA,'ZZ Club Perim A','performance'), (orgB,'ZZ Club Perim B','performance');
  insert into club_teams (club_id, name) values (orgA,'ZZ Perim U15 A') returning id into t15;
  insert into club_teams (club_id, name) values (orgA,'ZZ Perim U17 A') returning id into t17;
  insert into club_teams (club_id, name) values (orgB,'ZZ Perim U15 B') returning id into tB;

  patron := gen_random_uuid(); coach := gen_random_uuid(); dirigeant := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (patron,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-perim-patron@example.invalid','',now(),now(),now()),
      (coach,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-perim-coach@example.invalid','',now(),now(),now()),
      (dirigeant,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-perim-dir@example.invalid','',now(),now(),now());

  insert into club_members (club_id, user_id, role, status, teams) values
    (orgA, patron, 'admin', 'actif', '[]'::jsonb),
    (orgA, coach, 'coach', 'actif', to_jsonb(array['ZZ Perim U15 A'])),
    (orgA, dirigeant, 'resp_equipe', 'actif', to_jsonb(array['ZZ Perim U15 A','ZZ Perim U17 A']));

  -- ══ 1. UN COACH N'AGIT QUE SUR SES ÉQUIPES ════════════════════════════════
  perform pg_temp.incarner(coach);
  if not is_team_educateur(t15) then e := e || 'le coach n a pas ses droits sur son equipe'::text; end if;
  if is_team_educateur(t17) then e := e || 'le coach agit sur une equipe hors de son perimetre'::text; end if;

  -- ══ 2. LE CLUB ÉLARGIT, LES DROITS SUIVENT ════════════════════════════════
  perform pg_temp.incarner(patron);
  update club_members set teams = to_jsonb(array['ZZ Perim U15 A','ZZ Perim U17 A'])
   where club_id = orgA and user_id = coach;

  perform pg_temp.incarner(coach);
  if not is_team_educateur(t17) then e := e || 'le perimetre elargi par le club n ouvre rien'::text; end if;
  if not is_team_educateur(t15) then e := e || 'elargir le perimetre a fait perdre l equipe d origine'::text; end if;

  -- ══ 3. UN DIRIGEANT MULTI-ÉQUIPES : MÊMES DROITS QU'UN COACH ══════════════
  -- La remarque de Fouka : « des dirigeants qui ont plusieurs équipes ou qui sont coachs
  -- d'équipe ». Pas besoin de deux comptes, `resp_equipe` porte déjà les droits terrain.
  perform pg_temp.incarner(dirigeant);
  if not is_team_educateur(t15) or not is_team_educateur(t17) then
    e := e || 'un dirigeant responsable de deux equipes n a pas les droits terrain'::text;
  end if;

  -- ══ 4. PERSONNE NE S'ÉLARGIT SOI-MÊME (v97) ═══════════════════════════════
  perform pg_temp.incarner(coach);
  refus := null;
  begin
    update club_members set teams = to_jsonb(array['ZZ Perim U15 A','ZZ Perim U17 A','ZZ Perim U15 B'])
     where club_id = orgA and user_id = coach;
    -- Refus silencieux par la RLS : la ligne n'a pas bougé, et c'est une protection valable.
    if exists (select 1 from club_members where club_id = orgA and user_id = coach
                and teams @> to_jsonb(array['ZZ Perim U15 B'])) then
      e := e || 'un coach s est ajoute une equipe tout seul'::text;
    end if;
  exception when others then
    refus := sqlerrm;
  end;

  -- ══ 5. RETIRER UNE ÉQUIPE RETIRE LES DROITS, ET SEULEMENT CEUX-LÀ ═════════
  perform pg_temp.incarner(patron);
  update club_members set teams = to_jsonb(array['ZZ Perim U17 A'])
   where club_id = orgA and user_id = coach;

  perform pg_temp.incarner(coach);
  if is_team_educateur(t15) then e := e || 'l equipe retiree laisse ses droits ouverts'::text; end if;
  if not is_team_educateur(t17) then e := e || 'retirer une equipe a emporte les autres'::text; end if;

  -- ══ 6. LE PÉRIMÈTRE NE TRAVERSE PAS LES CLUBS ═════════════════════════════
  -- Même nom d'équipe et même tableau : sans appartenance au club voisin, rien ne s'ouvre.
  perform pg_temp.compte_os();
  update club_members set teams = to_jsonb(array['ZZ Perim U17 A','ZZ Perim U15 B'])
   where club_id = orgA and user_id = coach;
  perform pg_temp.incarner(coach);
  if is_team_educateur(tB) then e := e || 'un nom d equipe suffit a ouvrir une equipe d un autre club'::text; end if;

  perform pg_temp.compte_os();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — le club fixe le périmètre et les droits suivent ; un dirigeant multi-équipes vaut un coach ; personne ne s''élargit seul ; retirer une équipe n''emporte pas les autres ; rien ne traverse les clubs.' as verdict;

rollback;
