-- Un match qui porte un score ne peut pas être annoncé « à venir » (21/09/2026).
--
-- LE DÉFAUT, trouvé en fouillant la production le 21/09 : la synchronisation fédérale recopie le
-- score officiel des rencontres jouées (acquis du 10/09), mais laissait `sport_status` à
-- « scheduled ». 23 matchs de Villemomble et Fontainebleau portaient donc un score tout en étant
-- rangés parmi les matchs à jouer. Conséquences visibles : mauvaise file dans le Match Center du
-- club, « tous les matchs joués ont leur résultat » affiché à tort, et — depuis que les matchs
-- entrent dans le calendrier des joueurs — un résultat affiché sur un match soi-disant à venir.
--
-- La source publie un statut faux, c'est connu et assumé depuis le 10/09 : on ne s'en sert pas.
-- Mais un score officiel sur une rencontre passée dit exactement une chose, et le code ne
-- l'écoutait pas.
--
-- CE QU'ON MESURE, sur la production telle qu'elle est :
--   1. Aucun match ne porte un score en restant « scheduled ».
--   2. Aucun match ne porte un score en restant « a_venir ».
--   3. Le trigger de cohérence tient toujours dans les deux sens (garde-fou de non-régression).

do $$
declare n int; e text[] := '{}';
begin
  select count(*) into n from club_matches
   where nullif(btrim(coalesce(score,'')),'') is not null
     and coalesce(sport_status,'scheduled') = 'scheduled';
  if n > 0 then e := e || format('%s match(s) portent un score en etant encore « scheduled »', n); end if;

  select count(*) into n from club_matches
   where nullif(btrim(coalesce(score,'')),'') is not null
     and status = 'a_venir';
  if n > 0 then e := e || format('%s match(s) portent un score en etant encore « a_venir »', n); end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

-- Le garde-fou du trigger, dans un decor annule.
begin;
do $$
declare v_cm uuid; v_client uuid; v_club uuid; v_m uuid; v_sport text; v_statut text; e text[] := '{}';
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  v_cm := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_cm,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-score-statut@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values (v_cm,'ZZ','ScoreStatut','zz-score-statut@example.invalid','cm',true);
  insert into clients (nom, statut, cm_id) values ('ZZ Client ScoreStatut','client', v_cm) returning id into v_client;
  insert into clubs (nom, plan, portail_client_id) values ('ZZ Club ScoreStatut','performance', v_client) returning id into v_club;
  insert into club_matches (club_id, team, opponent, match_date, kickoff_time)
    values (v_club,'ZZ Equipe','ZZ Adversaire', current_date - 3, '15:00') returning id into v_m;

  -- Ce que fait desormais la synchronisation : score + statut joue, du meme geste.
  update club_matches set score = '3 - 1', sport_status = 'completed', status = 'recu' where id = v_m;
  select sport_status, status into v_sport, v_statut from club_matches where id = v_m;
  if v_sport <> 'completed' or v_statut <> 'recu' then
    e := e || format('le match joue n''est pas marque comme tel : sport=%s statut=%s', v_sport, v_statut);
  end if;

  -- L'autre sens : le Match Center ecrit « recu », le calendrier doit suivre.
  update club_matches set sport_status = 'scheduled', status = 'a_venir' where id = v_m;
  update club_matches set status = 'recu' where id = v_m;
  select sport_status into v_sport from club_matches where id = v_m;
  if v_sport <> 'completed' then
    e := e || format('« recu » ne fait plus passer le sport_status a completed : %s', v_sport);
  end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;
rollback;

select 'OK — aucun match ne porte un score en restant annoncé à venir, et le trigger de cohérence tient dans les deux sens.' as verdict;
