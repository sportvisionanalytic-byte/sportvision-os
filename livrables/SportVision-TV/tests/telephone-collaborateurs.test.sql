-- Le telephone des collaborateurs SportVision : ouvert en interne, ferme a l'exterieur.
--
-- DECISION DE FOUKA, 10/09/2026 : « je confirme qu'on le garde visible aux collaborateurs
-- SportVision internes. Sur le terrain, c'est reellement utile. [...] Le telephone ne doit
-- evidemment jamais etre expose aux clubs, coachs, joueurs ou parents. »
--
-- Les deux sens comptent. Un test qui ne verifie que la fermeture passerait aussi si le telephone
-- avait disparu pour tout le monde — y compris pour le photographe qui doit joindre son collegue
-- sur un parking de stade. On mesure donc l'ouverture ET la fermeture.
--
-- CE QUI A ETE INVENTORIE AVANT D'ECRIRE (10/09/2026) : le telephone d'un collaborateur ne vit que
-- dans profiles.telephone. Aucune vue publique n'expose de colonne telephone. La vue client_cm, qui
-- presente le CM au club dans l'ecran « Mon Community Manager », ne porte que nom, prenom, avatar
-- et niveau. Deux fonctions lisent profiles.telephone : un declencheur (non appelable), et
-- connect_os_account_detail, verrouillee d'entree par is_staff(). Ce sont ces trois chemins que le
-- test garde fermes.

-- NOTE DU 10/09/2026 SUR LE DECOR. Un garde (protect_sensitive_club_member_fields) interdit
-- desormais d'attribuer les roles admin, president et cm_externe d'un club a quiconque n'en est
-- pas l'administrateur. Ce durcissement a fait tomber ce test : son decor inserait ces roles en
-- `postgres` sans identite, que le garde traite comme un inconnu. En production, ces roles
-- n'entrent QUE par service_role (acceptation d'invitation, fonctions serveur) : le decor prend
-- donc le meme chemin. Les assertions, elles, restent jouees sous l'identite de chaque role.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

do $$
declare
  org uuid; cl uuid; pf uuid; cible uuid; collegue uuid;
  coach uuid; president uuid; joueur uuid; parent uuid; pp uuid; enfant uuid;
  qui text; uid uuid; n integer; e text[] := '{}'; det jsonb;
begin
  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  pf := pole_football_id();

  -- Un club, et le CM SportVision qui le suit.
  org := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut) values (org,'club','ZZ Club Tel','actif_standard');
  insert into clubs (id, nom, plan) values (org,'ZZ Club Tel','performance');

  -- La cible : un CM SportVision avec un numero, affecte au club — donc presente au club dans
  -- « Mon Community Manager ». C'est le cas le plus expose, d'ou ce choix.
  cible := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (cible,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cmtel-'||cible||'@example.invalid','',now(),now(),now());
  insert into profiles (id, role, prenom, nom, email, telephone, actif)
    values (cible,'cm','ZZ','CMTel','zz-cmtel@example.invalid','0600000099',true);
  insert into pole_affectations (pole_id, user_id, role_pole) values (pf, cible, 'membre') on conflict do nothing;
  insert into club_cm_affectations (club_id, cm_id, role, actif) values (org, cible, 'principal', true);
  insert into clients (nom, statut_relation, cm_id) values ('ZZ Client Tel','client',cible) returning id into cl;

  -- Un collegue interne, qui DOIT pouvoir le joindre.
  collegue := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (collegue,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-col-'||collegue||'@example.invalid','',now(),now(),now());
  insert into profiles (id, role, prenom, nom, email, actif) values (collegue,'photo','ZZ','Collegue','zz-col@example.invalid',true);
  insert into pole_affectations (pole_id, user_id, role_pole) values (pf, collegue, 'membre') on conflict do nothing;

  -- Quatre personnes du cote club et famille.
  coach := gen_random_uuid(); president := gen_random_uuid(); joueur := gen_random_uuid(); parent := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
    (coach,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-coach-'||coach||'@example.invalid','',now(),now(),now()),
    (president,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-pres-'||president||'@example.invalid','',now(),now(),now()),
    (joueur,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-jou-'||joueur||'@example.invalid','',now(),now(),now()),
    (parent,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-par-'||parent||'@example.invalid','',now(),now(),now());
  insert into club_members (club_id, user_id, role, status) values
    (org, coach, 'coach', 'actif'), (org, president, 'president', 'actif');
  insert into player_profiles (club_id, prenom, nom, date_naissance, user_id)
    values (org,'ZZ','Joueur','2009-02-02', joueur) returning id into enfant;
  insert into parent_profiles (user_id, prenom, nom) values (parent,'ZZ','Parent') returning id into pp;
  insert into parent_player_relationships (parent_id, player_id, relation_type, statut)
    values (pp, enfant, 'parent', 'confirme');

  -- ══ 1. OUVERT EN INTERNE ═════════════════════════════════════════════════
  perform pg_temp.incarner(collegue);
  select count(*) into n from profiles where id = cible and telephone = '0600000099';
  if n = 0 then
    e := e || 'Un collaborateur SportVision ne lit plus le telephone de son collegue'::text;
  end if;

  -- ══ 2. FERME A L EXTERIEUR ═══════════════════════════════════════════════
  foreach qui in array array['coach','president','joueur','parent'] loop
    uid := case qui when 'coach' then coach when 'president' then president when 'joueur' then joueur else parent end;
    perform pg_temp.incarner(uid);

    -- (a) la table elle-meme
    begin
      select count(*) into n from profiles where id = cible and telephone is not null;
      if n > 0 then e := e || format('Le %s lit le telephone du CM via profiles', qui); end if;
    exception when others then null; end;

    -- (b) la vue qui presente le CM au club
    begin
      execute 'select count(*) from client_cm where cm_id = $1' into n using cible;
      -- La vue ne porte pas de colonne telephone : si elle en gagnait une un jour, ce controle
      -- ne le verrait pas. On verifie donc aussi sa STRUCTURE plus bas.
    exception when others then null; end;

    -- (c) la fonction qui detaille un compte
    begin
      select connect_os_account_detail(cible) into det;
      if det is not null and det ? 'telephone' then
        e := e || format('Le %s obtient un telephone via connect_os_account_detail', qui);
      end if;
    exception when others then null; end;
  end loop;

  -- (d) un anonyme
  perform set_config('role','anon',true); perform set_config('request.jwt.claims','',true);
  begin
    select count(*) into n from profiles where telephone is not null;
    if n > 0 then e := e || format('Un anonyme lit %s telephone(s)', n); end if;
  exception when others then null; end;

  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);

  -- ══ 3. LA STRUCTURE NE DOIT PAS DERIVER ══════════════════════════════════
  -- Une vue qui gagnerait une colonne telephone exposerait le numero sans qu'aucune policy change.
  select count(*) into n
    from information_schema.columns c
    join information_schema.views v on v.table_name = c.table_name and v.table_schema = c.table_schema
   where c.table_schema = 'public' and c.column_name ~* '(telephone|phone|mobile)';
  if n > 0 then
    e := e || format('%s vue(s) publique(s) exposent desormais une colonne de telephone', n);
  end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — le telephone d un collaborateur reste lisible par ses collegues SportVision, et par personne cote club ni famille : ni coach, ni president, ni joueur, ni parent, ni anonyme, par aucun des trois chemins qui y menent.' as verdict;

rollback;
