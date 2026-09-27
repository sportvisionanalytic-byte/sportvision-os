-- Un Pass payé ouvre les galeries de son club, y compris celles qui n'ont aucune équipe.
--
-- CE QUE CE TEST GARDE, et pourquoi il a fallu trois migrations pour y arriver :
--
--   v296  Les 24 galeries publiées n'avaient NI club NI saison. `media_album_list` filtre sur le
--         club : aucune famille ne les voyait. `can_access_media` compare `me.club_id =
--         v_album.club_id` : NULL = NULL est faux, le Pass ne pouvait rien ouvrir.
--   v297  Le Pass ouvre un périmètre `team`. Une galerie de club n'a AUCUNE équipe, donc
--         `me.scope_id = any(v_equipes)` comparait à un tableau vide. 39,90 € payés, cadenas
--         identique. Même défaut que la v280 pour les galeries à PLUSIEURS équipes, un cran plus
--         loin.
--   v298  La même règle de périmètre était écrite DEUX FOIS. Corriger `can_access_media` laissait
--         `media_voit_sans_filigrane` se tromper, et le parcours se bloquait une marche plus loin :
--         galerie ouverte, et zéro photo à identifier. Les deux appellent maintenant
--         `media_droit_paye()`.
--
-- Les trois se mesurent ici sur les MÊMES données que celles d'un vrai club, décor fictif mis à part.
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_autre_club uuid; v_album uuid; v_equipe uuid;
  v_prod uuid; v_admin uuid; v_joueur uuid; v_user uuid; v_order uuid;
  v_etranger uuid; e text[] := '{}'; n int;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_admin from profiles where role='admin' and actif order by created_at limit 1;

  insert into clubs (nom) values ('ZZ Club Pass') returning id into v_club;
  insert into clubs (nom) values ('ZZ Club Voisin') returning id into v_autre_club;
  insert into club_teams (club_id, name) values (v_club, 'ZZ Pass U13') returning id into v_equipe;

  -- LA galerie du cas : celle du club, sans aucune equipe.
  insert into media_albums (club_id, team_id, saison_id, title, status, event_date, published_at)
    select v_club, null, s.id, 'ZZ Plateau du club', 'published', current_date, now()
      from saisons s where current_date between s.date_debut and s.date_fin
    returning id into v_album;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position)
    values (v_album, v_club, 'photo','sportvision-media-prive','zz/pass1.jpg','ready',1);

  v_user := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'zz-pass-famille@example.invalid','',now(),now(),now());
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_club, v_user, 'ZZ','Passeur', '2012-05-05','actif') returning id into v_joueur;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_joueur, v_equipe, v_club, '2026-2027','active');

  -- Une famille du club VOISIN, qui ne doit rien gagner.
  v_etranger := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_etranger,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'zz-pass-voisin@example.invalid','',now(),now(),now());
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_autre_club, v_etranger, 'ZZ','Voisin','2012-06-06','actif');

  -- Le Pass est declare en perimetre `team`, comme celui de SF Villemomble : c'est CETTE
  -- configuration qui produisait le defaut. Celui de RCP Fontainebleau est en `club` et n'a jamais
  -- eu le probleme — deux clubs configures differemment, un seul en souffrait, et c'est pourquoi le
  -- defaut ne se voyait pas partout.
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, team_ids, status, metadata)
    select v_club, s.id, 'ZZ Pass saison', 'pass_saison', 1990, 'eur', 'team', array[v_equipe], 'active', '{}'
      from saisons s where current_date between s.date_debut and s.date_fin
    returning id into v_prod;

  -- ══ 1. AVANT L'ACHAT : TOUT EST FERMÉ ════════════════════════════════════
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_user::text,'role','authenticated')::text, true);
  if can_access_media(v_album) then e := e || 'la galerie est ouverte AVANT tout paiement'::text; end if;
  if media_voit_sans_filigrane(v_album) then e := e || 'les photos sont nettes AVANT tout paiement'::text; end if;
  select count(*) into n from media_galerie_a_identifier(v_album, v_joueur);
  if n <> 0 then e := e || format('%s photo(s) a identifier sans Pass (la breche v287)', n); end if;

  -- ══ 2. LE PASS EST ENCAISSÉ ══════════════════════════════════════════════
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into media_orders (club_id, product_id, purchased_by_user_id, beneficiary_person_id,
                            amount_cents, currency, status, shipping_status, source, encaisse_par)
    values (v_club, v_prod, v_user, v_joueur, 3990,'eur','pending','non_requis','especes', v_admin)
    returning id into v_order;
  perform media_activer_commande(v_order);

  -- ══ 3. LA GALERIE DE CLUB S'OUVRE (v297) ═════════════════════════════════
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_user::text,'role','authenticated')::text, true);
  if not can_access_media(v_album) then
    e := e || 'PASS PAYE ET GALERIE DE CLUB TOUJOURS VERROUILLEE (v297)'::text;
  end if;

  -- ══ 4. ET LE FILIGRANE TOMBE, DU MÊME COUP (v298) ════════════════════════
  --
  -- C'est ici que la règle recopiée se voyait : la galerie s'ouvrait et les photos restaient
  -- filigranées, parce que la seconde copie du test de périmètre n'avait pas été corrigée.
  if not media_voit_sans_filigrane(v_album) then
    e := e || 'GALERIE OUVERTE MAIS PHOTOS FILIGRANEES : les deux regles ont divergé (v298)'::text;
  end if;
  select count(*) into n from media_galerie_a_identifier(v_album, v_joueur);
  if n <> 1 then e := e || format('apres achat : %s photo(s) a identifier au lieu de 1', n); end if;

  -- ══ 5. LE CLUB VOISIN NE GAGNE RIEN ══════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub',v_etranger::text,'role','authenticated')::text, true);
  if can_access_media(v_album) then e := e || 'une famille d un AUTRE club ouvre la galerie'::text; end if;
  if media_voit_sans_filigrane(v_album) then e := e || 'une famille d un AUTRE club voit sans filigrane'::text; end if;

  -- ══ 6. LES DEUX FONCTIONS NE PEUVENT PLUS DIVERGER ═══════════════════════
  --
  -- Le vrai garde-fou de la v298 : une SEULE écriture de la règle. Si quelqu'un remet une copie
  -- dans l'une des deux, cette vérification le dit.
  perform set_config('role','postgres',true);
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname in ('can_access_media','media_voit_sans_filigrane')
     and p.prosrc like '%from media_entitlements%';
  if n <> 0 then
    e := e || format('%s fonction(s) gardent leur propre copie de la regle de perimetre au lieu d appeler media_droit_paye', n);
  end if;

  if cardinality(e) > 0 then
    raise exception 'ROUGE : %', array_to_string(e, ' | ');
  end if;
  raise exception 'VERT : le Pass paye ouvre la galerie de club, retire le filigrane, et n ouvre rien au club voisin';
end $$;
