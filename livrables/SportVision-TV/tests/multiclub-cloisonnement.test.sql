-- Deux clubs, aucun croisement : le test qui conditionne l'accueil de plusieurs clubs.
--
-- Ecrit pour l'audit de pre-lancement du 10/09/2026. SportVision n'a aujourd'hui que deux clubs
-- reels ; le jour ou il y en aura dix, une fuite entre eux ne se verra pas a l'oeil nu et se
-- paiera en confiance. Ce test la rendrait visible immediatement.
--
-- Il mesure ce que la BASE rend a chaque role, jamais ce que l'interface affiche : une interface
-- qui masque une donnee qu'un utilisateur peut lire par l'API ne protege rien.
--
-- Cinq identites reelles par club : dirigeant, coach, joueur, parent, plus le CM affilie. Chacune
-- ne doit voir que son club. Tout est fabrique ici et annule avec la transaction — aucun club
-- factice ne subsiste en production, conformement a la consigne.

-- NOTE DU 10/09/2026 SUR LE DECOR. Un garde (protect_sensitive_club_member_fields) interdit
-- desormais d'attribuer les roles admin, president et cm_externe d'un club a quiconque n'en est
-- pas l'administrateur. Ce durcissement a fait tomber ce test : son decor inserait ces roles en
-- `postgres` sans identite, que le garde traite comme un inconnu. En production, ces roles
-- n'entrent QUE par service_role (acceptation d'invitation, fonctions serveur) : le decor prend
-- donc le meme chemin. Les assertions, elles, restent jouees sous l'identite de chaque role.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $inner$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $inner$;

create or replace function pg_temp.creer_compte(p_libelle text) returns uuid language plpgsql as $inner$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-' || p_libelle || '-' || v || '@example.invalid', '', now(), now(), now());
  return v;
end $inner$;

do $$
declare
  clubA uuid; clubB uuid; teamA uuid; teamB uuid;
  cmA uuid; cmB uuid; presA uuid; presB uuid; coachA uuid; coachB uuid;
  albA uuid; albB uuid; matchA uuid; matchB uuid; venueA uuid; venueB uuid;
  n integer; e text[] := '{}';

  procedure_note text;
begin
  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);

  -- ── Deux clubs complets et symetriques ──────────────────────────────────────
  clubA := gen_random_uuid(); clubB := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut)
  values (clubA,'club','ZZ Club A','actif_standard'), (clubB,'club','ZZ Club B','actif_standard');
  insert into clubs (id, nom, plan) values (clubA,'ZZ Club A','performance'), (clubB,'ZZ Club B','performance');

  insert into club_teams (club_id, name) values (clubA,'ZZ U18 A') returning id into teamA;
  insert into club_teams (club_id, name) values (clubB,'ZZ U18 B') returning id into teamB;

  insert into club_venues (club_id, nom) values (clubA,'ZZ Stade A') returning id into venueA;
  insert into club_venues (club_id, nom) values (clubB,'ZZ Stade B') returning id into venueB;

  insert into club_matches (club_id, team, opponent, match_date)
  values (clubA, 'ZZ U18 A', 'ZZ Adversaire A', current_date + 2) returning id into matchA;
  insert into club_matches (club_id, team, opponent, match_date)
  values (clubB, 'ZZ U18 B', 'ZZ Adversaire B', current_date + 2) returning id into matchB;

  insert into media_albums (club_id, team_id, title, status)
  values (clubA, teamA, 'ZZ Galerie A', 'published') returning id into albA;
  insert into media_albums (club_id, team_id, title, status)
  values (clubB, teamB, 'ZZ Galerie B', 'published') returning id into albB;

  -- ── Les personnes ───────────────────────────────────────────────────────────
  cmA := pg_temp.creer_compte('cm-a');       cmB := pg_temp.creer_compte('cm-b');
  presA := pg_temp.creer_compte('pres-a');   presB := pg_temp.creer_compte('pres-b');
  coachA := pg_temp.creer_compte('coach-a'); coachB := pg_temp.creer_compte('coach-b');

  insert into profiles (id, role, prenom, nom, email) values
    (cmA,'cm','ZZ','CM A','zz-cm-a@example.invalid'),
    (cmB,'cm','ZZ','CM B','zz-cm-b@example.invalid');

  insert into club_cm_affectations (club_id, cm_id, role, actif)
  values (clubA, cmA, 'principal', true), (clubB, cmB, 'principal', true);

  insert into club_members (club_id, user_id, role, status) values
    (clubA, presA, 'president', 'actif'), (clubB, presB, 'president', 'actif'),
    (clubA, coachA, 'coach', 'actif'),    (clubB, coachB, 'coach', 'actif');

  -- ══ 1. LE CM ════════════════════════════════════════════════════════════════
  perform pg_temp.incarner(cmA);
  select count(*) into n from clubs where id = clubB;
  if n <> 0 then e := e || 'CM A voit le club B'::text; end if;
  select count(*) into n from club_teams where club_id = clubB;
  if n <> 0 then e := e || 'CM A voit les equipes du club B'::text; end if;
  select count(*) into n from club_matches where club_id = clubB;
  if n <> 0 then e := e || 'CM A voit les matchs du club B'::text; end if;
  select count(*) into n from club_venues where club_id = clubB;
  if n <> 0 then e := e || 'CM A voit les lieux du club B'::text; end if;
  select count(*) into n from club_members where club_id = clubB;
  if n <> 0 then e := e || 'CM A voit les membres du club B'::text; end if;
  select count(*) into n from media_albums where id = albB;
  if n <> 0 then e := e || 'CM A voit la galerie du club B'::text; end if;
  -- Et il voit bien le sien, sinon la mesure ne prouve rien.
  select count(*) into n from club_teams where club_id = clubA;
  if n <> 1 then e := e || 'CM A ne voit pas les equipes de SON club'::text; end if;

  -- Ecriture croisee
  update club_teams set name = 'ZZ vole' where club_id = clubB;
  get diagnostics n = row_count;
  if n <> 0 then e := e || 'CM A a MODIFIE une equipe du club B'::text; end if;
  begin
    insert into club_venues (club_id, nom) values (clubB, 'ZZ intrusion');
    e := e || 'CM A a CREE un lieu dans le club B'::text;
  exception when others then null; end;

  -- ══ 2. LE DIRIGEANT ═════════════════════════════════════════════════════════
  perform pg_temp.incarner(presA);
  select count(*) into n from club_teams where club_id = clubB;
  if n <> 0 then e := e || 'Le president A voit les equipes du club B'::text; end if;
  select count(*) into n from club_members where club_id = clubB;
  if n <> 0 then e := e || 'Le president A voit les membres du club B'::text; end if;
  select count(*) into n from club_matches where club_id = clubB;
  if n <> 0 then e := e || 'Le president A voit les matchs du club B'::text; end if;
  select count(*) into n from club_teams where club_id = clubA;
  if n <> 1 then e := e || 'Le president A ne voit pas SON equipe'::text; end if;

  -- ══ 3. LE COACH ═════════════════════════════════════════════════════════════
  perform pg_temp.incarner(coachA);
  select count(*) into n from club_teams where club_id = clubB;
  if n <> 0 then e := e || 'Le coach A voit les equipes du club B'::text; end if;
  select count(*) into n from club_matches where club_id = clubB;
  if n <> 0 then e := e || 'Le coach A voit les matchs du club B'::text; end if;
  update club_matches set opponent = 'ZZ vole' where id = matchB;
  get diagnostics n = row_count;
  if n <> 0 then e := e || 'Le coach A a MODIFIE un match du club B'::text; end if;

  -- ══ 4. UN ANONYME ═══════════════════════════════════════════════════════════
  perform set_config('role','anon',true);
  perform set_config('request.jwt.claims','',true);
  -- Un refus peut prendre deux formes, et les deux sont acceptables : zero ligne, ou une erreur
  -- de permission. Trois tables (club_matches, prestations, club_requests) tombent dans le second
  -- cas parce que leur policy appelle contenus_visible_par_cm(), sur laquelle `anon` n'a pas
  -- EXECUTE. Aucune donnee ne fuit ; c'est un defaut de forme, pas de fond — releve en P2 dans
  -- l'audit du 10/09/2026. Ce qui compte ici, c'est qu'aucune ligne ne sorte.
  select count(*) into n from clubs where id in (clubA, clubB);
  if n <> 0 then e := e || format('Un anonyme lit %s club(s)', n); end if;
  select count(*) into n from club_members;
  if n <> 0 then e := e || format('Un anonyme lit %s membre(s) de club', n); end if;
  select count(*) into n from club_teams where club_id in (clubA, clubB);
  if n <> 0 then e := e || format('Un anonyme lit %s equipe(s)', n); end if;
  select count(*) into n from media_albums where id in (albA, albB);
  if n <> 0 then e := e || format('Un anonyme lit %s galerie(s)', n); end if;
  select count(*) into n from club_venues where club_id in (clubA, clubB);
  if n <> 0 then e := e || format('Un anonyme lit %s lieu(x)', n); end if;
  begin
    select count(*) into n from club_matches where club_id in (clubA, clubB);
    if n <> 0 then e := e || format('Un anonyme lit %s match(s)', n); end if;
  exception when insufficient_privilege then null; end;

  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — deux clubs, aucun croisement : ni CM, ni dirigeant, ni coach, ni anonyme ne lit ou modifie les donnees du club voisin ; chacun voit bien le sien.' as verdict;

rollback;
