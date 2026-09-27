-- L'aperçu qui donne une raison d'acheter : quatre photos de la galerie, filigranées (v299).
--
-- CE QU'IL GARDE. Mesure du 27/09/2026 en production : 3 399 photos prêtes, 26 galeries publiées,
-- **0 marquage**, **0 Pass vendu**. L'aperçu ne rendait que des photos DÉJÀ MARQUÉES, et le marquage
-- vient soit du staff, soit de l'identification par la famille — laquelle exige le Pass payé. Une
-- famille ouvrait l'app, voyait zéro photo, et n'avait aucune raison de payer. Le tunnel de vente
-- commençait par une page blanche.
--
-- La reconnaissance faciale n'était pas la sortie : elle part de la photo de référence de l'enfant,
-- qu'on ne demande QU'APRÈS paiement (donnée biométrique, ordre corrigé le 26/09).
--
-- LES QUATRE VÉRIFICATIONS, et la troisième est celle qu'on oublierait :
--   1. Sans Pass et sans marquage : quatre photos de la galerie, filigranées, le vrai total à côté.
--   2. Le drapeau `apercu_galerie` est levé, pour que l'écran ne dise pas « vos photos ».
--   3. Si la famille a DÉJÀ des photos marquées, ce sont les SIENNES qu'elle voit — le repli ne doit
--      jamais remplacer un aperçu personnel, qui convertit mieux.
--   4. Aucun chemin d'aperçu NET ne sort tant que le Pass n'est pas payé.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_equipe uuid; v_album uuid; v_saison uuid; v_prod uuid; v_admin uuid;
  v_joueur uuid; v_user uuid; v_order uuid; ph1 uuid;
  e text[] := '{}'; n int; t int; g int; i int;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_saison from saisons where current_date between date_debut and date_fin;
  select id into v_admin from profiles where role='admin' and actif order by created_at limit 1;

  insert into clubs (nom) values ('ZZ Club Apercu') returning id into v_club;
  insert into club_teams (club_id, name) values (v_club,'ZZ Apercu U13') returning id into v_equipe;
  -- LA GALERIE PORTE L'EQUIPE DE L'ENFANT, et ce detail est le sujet d'une correction du 27/09.
  -- Ce decor posait `team_id = null`, une « galerie de club ». Fouka a tranche le meme jour : une
  -- famille ne voit que les galeries de l'equipe de son enfant, et une galerie sans equipe n'est
  -- plus une affaire de famille (v302, v304). Le test tombait donc en rouge sur un comportement
  -- VOULU — et laisser un decor qui n'existe plus dans le produit aurait pousse quelqu'un a defaire
  -- la regle pour « faire passer le test ».
  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
    values (v_club, v_equipe, v_saison, 'ZZ Plateau Apercu', 'published', current_date, now())
    returning id into v_album;
  -- Dix photos, dont deux de groupe : le repli doit sortir les photos de groupe d'abord.
  for i in 1..10 loop
    insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, preview_path,
                              preview_clair_path, status, position, photo_de_groupe)
      values (v_album, v_club, 'photo','sportvision-media-prive','zz/ap'||i||'.jpg',
              'apercu/ap'||i||'.webp', 'apercus-clairs/'||v_album||'/ap'||i||'.webp', 'ready', i, i > 8)
      returning id into ph1;
  end loop;

  v_user := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'zz-apercu-famille@example.invalid','',now(),now(),now());
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_club, v_user, 'ZZ','Apercu','2012-04-04','actif') returning id into v_joueur;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_joueur, v_equipe, v_club, '2026-2027','active');
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, team_ids, status, metadata)
    values (v_club, v_saison, 'ZZ Pass', 'pass_saison', 3990, 'eur', 'team', array[v_equipe], 'active', '{}')
    returning id into v_prod;

  -- ══ 1 et 2. SANS PASS, SANS MARQUAGE : L'APERÇU DE LA GALERIE ════════════
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_user::text,'role','authenticated')::text, true);
  select count(*), max(total), count(*) filter (where apercu_galerie)
    into n, t, g from media_photos_du_joueur(v_album, v_joueur);
  if n <> 4 then e := e || format('sans Pass : %s photo(s) au lieu de 4', n); end if;
  if t <> 10 then e := e || format('le total annonce est %s au lieu de 10 : la famille ne sait pas ce qu elle achete', t); end if;
  if g <> 4 then e := e || format('apercu_galerie leve sur %s ligne(s) sur 4 : l ecran dira « vos photos »', g); end if;

  -- ══ 4. ET AUCUN CHEMIN NET ═══════════════════════════════════════════════
  select count(preview_clair_path) into n from media_photos_du_joueur(v_album, v_joueur);
  if n <> 0 then e := e || format('%s chemin(s) d apercu NET servis sans Pass', n); end if;

  -- Les photos de groupe d'abord : c'est l'equipe qu'une famille cherche, et c'est le choix le
  -- moins intrusif pour les enfants des autres. Les positions 9 et 10 sont les deux photos de
  -- groupe du decor.
  --
  -- ON NE JOINT PAS media_assets ICI, et c'est une erreur que j'ai faite en ecrivant ce test : la
  -- famille n'a aucun droit de lecture directe sur cette table, la jointure rendait donc zero ligne
  -- et le test accusait la fonction. On lit `ordre`, que la fonction rend elle-meme.
  select count(*) into n from (select ordre from media_photos_du_joueur(v_album, v_joueur) limit 2) x
   where x.ordre in (9, 10);
  if n <> 2 then e := e || format('les photos de groupe ne passent pas en premier (%s sur les 2 premieres)', n); end if;

  -- ══ 3. UN APERÇU PERSONNEL PRIME SUR LE REPLI ════════════════════════════
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into ph1 from media_assets where album_id = v_album and position = 5;
  insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut)
    values ('media_asset', ph1, v_joueur, 'humain', 'valide');

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_user::text,'role','authenticated')::text, true);
  select count(*), max(total), count(*) filter (where apercu_galerie)
    into n, t, g from media_photos_du_joueur(v_album, v_joueur);
  if n <> 1 or t <> 1 then
    e := e || format('avec 1 photo marquee : %s ligne(s) / total %s, le repli a ecrase son apercu personnel', n, t);
  end if;
  if g <> 0 then e := e || 'apercu_galerie reste leve alors que ce sont SES photos'::text; end if;

  if cardinality(e) > 0 then
    raise exception 'ROUGE : %', array_to_string(e, ' | ');
  end if;
  raise exception 'VERT : 4 photos de la galerie filigranees quand elle n a rien, ses photos des qu elle en a';
end $$;
