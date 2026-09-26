-- Le filigrane doit dépendre de QUI regarde, et de rien d'autre.
--
-- Règle, énoncée une fois : Full Communication donne le droit de VOIR, le Pass donne le droit de
-- voir SANS FILIGRANE. Cinq cas, et le troisième est celui qui fait tout l'intérêt du test : une
-- famille d'un club en Full Communication PEUT ouvrir la galerie et voit pourtant le filigrane,
-- tant qu'elle n'a pas payé.
--
-- CE QUE CE TEST M'A APPRIS EN L'ÉCRIVANT : sa première version posait la galerie sur la saison
-- 2027-2028 (« la plus récente ») alors que le Pass vit en 2026-2027. Il annonçait donc un échec
-- qui n'existait pas — la borne de saison faisait exactement son travail. D'où le
-- `current_date between date_debut and date_fin` ci-dessous : un test qui se trompe de saison
-- accuse le code à tort, et on finit par corriger ce qui marchait.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction. Un test qui laisse une commande payée en
-- base fausse la comptabilité qu'il est censé protéger.
--
-- Lancer : via l'API Management, comme les autres tests .sql de ce dossier.

do $$
declare
  v_album uuid; v_club uuid; v_u16 uuid; v_prod uuid; v_saison uuid;
  v_admin uuid; v_parent uuid; v_joueur uuid; v_coach uuid; v_order uuid;
  rapport text := ''; r boolean;
  dire text;
begin
  select id into v_club from clubs where nom='RCP Fontainebleau';
  select id into v_u16 from club_teams where club_id=v_club and name='U16A';
  select id into v_saison from saisons where current_date between date_debut and date_fin limit 1;
  select id into v_prod from media_products where club_id=v_club and type='pass_saison';
  select id into v_admin from profiles where role='admin' and actif limit 1;
  select pp.id, pp.user_id into v_joueur, v_parent from player_profiles pp
   where pp.club_id=v_club and pp.user_id is not null limit 1;
  select cm.user_id into v_coach from club_members cm
   where cm.club_id=v_club and cm.status='actif' and cm.user_id is not null limit 1;

  -- Une galerie Full Communication, categorie U16A, comme celle de Fouka.
  insert into media_albums (title, club_id, team_id, saison_id, status, access_mode, watermark_previews, published_at)
  values ('TEST filigrane U16A', v_club, v_u16, v_saison, 'published', 'free_members', true, now())
  returning id into v_album;

  dire := 'sans filigrane';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  r := media_voit_sans_filigrane(v_album);
  rapport := rapport || format(E'\n  admin SportVision      -> %s (attendu sans filigrane)', case when r then dire else 'FILIGRANE' end);

  if v_coach is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text)::text, true);
    r := media_voit_sans_filigrane(v_album);
    rapport := rapport || format(E'\n  membre du club         -> %s (attendu sans filigrane)', case when r then dire else 'FILIGRANE' end);
  else
    rapport := rapport || E'\n  membre du club         -> AUCUN en base, non teste';
  end if;

  -- Une famille de ce club, SANS Pass : Full Communication ne suffit pas.
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent::text)::text, true);
  r := media_voit_sans_filigrane(v_album);
  rapport := rapport || format(E'\n  famille SANS Pass      -> %s (attendu FILIGRANE)', case when r then dire else 'FILIGRANE' end);
  -- ...alors qu'elle VOIT deja la galerie, c'est bien le point.
  rapport := rapport || format(E'\n     (elle peut l''ouvrir ? %s — Full Com donne le droit de voir)', can_access_media(v_album));

  -- La meme famille APRES avoir paye.
  insert into media_orders (club_id, product_id, purchased_by_user_id, beneficiary_person_id,
                            amount_cents, currency, status, shipping_status, source, encaisse_par)
  values (v_club, v_prod, v_parent, v_joueur, 3990, 'eur', 'pending', 'non_requis', 'especes', v_admin)
  returning id into v_order;
  perform media_activer_commande(v_order);

  perform set_config('request.jwt.claims', json_build_object('sub', v_parent::text)::text, true);
  r := media_voit_sans_filigrane(v_album);
  rapport := rapport || format(E'\n  famille AVEC Pass      -> %s (attendu sans filigrane)', case when r then dire else 'FILIGRANE' end);

  -- Personne d'autre.
  perform set_config('request.jwt.claims', '{}', true);
  r := media_voit_sans_filigrane(v_album);
  rapport := rapport || format(E'\n  non connecte           -> %s (attendu FILIGRANE)', case when r then dire else 'FILIGRANE' end);

  raise exception 'RAPPORT%', rapport;
end $$;
