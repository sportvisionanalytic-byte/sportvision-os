-- Le club voit le planning éditorial que SportVision prépare pour lui (14/09/2026).
--
-- DEMANDE DE FOUKA : « il faut aussi bien que le président des clubs voie le planning éditorial ».
--
-- CE QUI N'ALLAIT PAS. Le planning du CM (v141) fait passer un contenu de `brouillon` à `pret` :
-- « prêt », c'est-à-dire écrit, relu, daté, il ne reste qu'à le programmer. La policy de lecture
-- côté club, elle, datait d'avant ce flux et masquait `pret` au même titre qu'un brouillon. Un
-- président ouvrait donc « Planning éditorial » sur un écran vide pendant que neuf contenus
-- l'attendaient — c'était exactement le cas de SF Villemomble, dont les neuf contenus étaient
-- tous en `pret`.
--
-- PUIS FOUKA EST ALLÉ PLUS LOIN le même jour : « je veux qu'il voie les brouillons du planning
-- éditorial » (v230). Le planning est un outil partagé avec le club, pas une vitrine de ce qui
-- est fini : voir qu'une publication est PRÉVUE pour samedi, même à l'état de titre posé dans la
-- grille, c'est ce qui permet au club de dire « ajoutez plutôt les féminines » avant que le
-- travail soit fait.
--
-- LA LIMITE QUI RESTE, et c'est voulu : les RELECTURES en cours ne se montrent pas. SportVision
-- qui se relit (a_valider_interne) et un CM Junior corrigé par son tuteur (a_valider_tuteur)
-- restent invisibles au club — ce n'est pas du travail en cours, c'est une correction en cours.
--
-- CE QU'ON MESURE, avec les yeux d'un président de club :
--   1. Il lit tout son planning : brouillon, prêt, à valider, programmé, publié.
--   2. Il ne lit ni la relecture interne SportVision, ni la relecture d'un tuteur.
--   3. Le calendrier du club (club_contenus_calendrier) reste cohérent avec cette lecture.
--   4. Un membre d'un AUTRE club ne lit rien de tout cela.
--   5. Lire ne donne pas le droit d'écrire : le président ne change pas un statut à la main.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

create or replace function pg_temp.serveur() returns void language plpgsql as $i$
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
end $i$;

do $$
declare
  v_client uuid; v_club uuid; v_cm uuid;
  v_president uuid; v_etranger uuid; v_club_etranger uuid;
  c_pret uuid; c_brouillon uuid;
  e text[] := '{}'; n int; msg text;
begin
  perform pg_temp.serveur();

  insert into clients (nom, statut) values ('ZZ Client Planning','client') returning id into v_client;
  insert into clubs (nom, plan, portail_client_id) values ('ZZ Club Planning','performance', v_client) returning id into v_club;
  insert into clubs (nom, plan) values ('ZZ Club Voisin','performance') returning id into v_club_etranger;

  v_president := gen_random_uuid(); v_etranger := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (v_president,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-president-planning@example.invalid','',now(),now(),now()),
      (v_etranger,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-voisin-planning@example.invalid','',now(),now(),now());
  insert into club_members (club_id, user_id, role, status, teams) values
    (v_club, v_president, 'president', 'actif', '[]'::jsonb),
    (v_club_etranger, v_etranger, 'president', 'actif', '[]'::jsonb);

  -- Le CM qui prépare : c'est lui qui porte les contenus.
  select id into v_cm from profiles where role='admin' and actif order by created_at limit 1;

  insert into contenus (client_id, cm_id, titre, statut, date_prevue) values
    (v_client, v_cm, 'ZZ prêt',             'pret',              current_date + 2) returning id into c_pret;
  insert into contenus (client_id, cm_id, titre, statut, date_prevue) values
    (v_client, v_cm, 'ZZ brouillon',        'brouillon',         current_date + 3) returning id into c_brouillon;
  insert into contenus (client_id, cm_id, titre, statut, date_prevue) values
    (v_client, v_cm, 'ZZ relecture interne','a_valider_interne', current_date + 4),
    (v_client, v_cm, 'ZZ relecture tuteur', 'a_valider_tuteur',  current_date + 5),
    (v_client, v_cm, 'ZZ à valider club',   'a_valider_client',  current_date + 6),
    (v_client, v_cm, 'ZZ programmé',        'programme',         current_date + 7),
    (v_client, v_cm, 'ZZ publié',           'publie',            current_date + 8);

  -- ══ 1. CE QUE LE PRÉSIDENT DOIT LIRE ═════════════════════════════════════
  perform pg_temp.incarner(v_president);
  select count(*) into n from contenus where client_id = v_client and statut = 'pret';
  if n <> 1 then e := e || 'le president ne lit pas les contenus prets (le cas SF Villemomble)'::text; end if;
  select count(*) into n from contenus where client_id = v_client and statut = 'brouillon';
  if n <> 1 then e := e || 'le president ne lit pas les brouillons du planning (v230)'::text; end if;
  select count(*) into n from contenus where client_id = v_client
    and statut in ('a_valider_client','programme','publie');
  if n <> 3 then e := e || format('le president lit %s contenus valides/programmes/publies sur 3', n); end if;

  -- ══ 2. CE QU'IL NE DOIT PAS LIRE ═════════════════════════════════════════
  -- Une relecture en cours n'est pas un brouillon : ni SportVision se corrigeant elle-même, ni
  -- un CM Junior corrige par son tuteur.
  select count(*) into n from contenus where client_id = v_client
    and statut in ('a_valider_interne','a_valider_tuteur');
  if n <> 0 then e := e || format('une relecture en cours fuite au club : %s ligne(s)', n); end if;

  -- ══ 3. LE CALENDRIER DU CLUB DIT LA MÊME CHOSE ═══════════════════════════
  begin
    select count(*) into n from club_contenus_calendrier(v_club, current_date, current_date + 30)
      where statut = 'pret';
    if n <> 1 then e := e || 'le calendrier du club n affiche pas le contenu pret'::text; end if;
  exception when others then
    e := e || ('le calendrier du club refuse le president — '||left(sqlerrm,70))::text;
  end;

  -- ══ 4. LE CLUB VOISIN NE LIT RIEN ════════════════════════════════════════
  perform pg_temp.incarner(v_etranger);
  select count(*) into n from contenus where client_id = v_client;
  if n <> 0 then e := e || format('un club voisin lit %s contenu(s) qui ne le regardent pas', n); end if;

  -- ══ 5. LIRE N'EST PAS ÉCRIRE ═════════════════════════════════════════════
  -- Le club ne pilote pas le workflow éditorial : il valide par client_valider_contenu, jamais
  -- en écrivant le statut lui-même.
  perform pg_temp.incarner(v_president);
  update contenus set statut = 'publie' where id = c_pret;
  perform pg_temp.serveur();
  if (select statut from contenus where id = c_pret) <> 'pret' then
    e := e || 'un president a change le statut d un contenu a la main'::text;
  end if;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — le président lit tout le planning de son club, brouillons compris, jamais une relecture en cours, et ne pilote pas les statuts.' as verdict;

rollback;
