-- Le socle de la reconnaissance : consentement d'abord, cloisonnement toujours, retrait qui efface
-- (v222/v223, 14/09/2026).
--
-- POURQUOI CE FICHIER. Une empreinte de visage est une donnée biométrique : interdite par principe,
-- sauf consentement explicite (article 9 du RGPD), et sur des MINEURS. Trois choses doivent tenir
-- quoi qu'il arrive, et aucune ne doit dépendre d'un écran :
--   • rien n'entre sans consentement en cours ;
--   • un visage n'est jamais rapproché d'un enfant d'une autre équipe ;
--   • retirer son accord efface l'empreinte, pas seulement une case.
--
-- CE QU'ON MESURE :
--   1. Sans consentement, poser une empreinte est refusé.
--   2. Avec le consentement, elle entre.
--   3. Une famille ne pose pas l'empreinte de l'enfant d'une autre.
--   4. Le rapprochement ne propose que des joueurs de l'équipe de la galerie.
--   5. Il ignore un joueur dont le consentement a été retiré.
--   6. Le retrait efface l'empreinte ET les marquages posés par la machine, mais garde ceux posés
--      par un humain — la famille a payé pour ces photos-là.
--   7. Les tables d'empreintes ne sont lisibles par personne en direct.

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
  v_club uuid; v_equipe uuid; v_autre uuid; v_saison uuid; v_album uuid; v_photo uuid;
  v_lina uuid; v_sacha uuid; v_ext uuid;
  v_cpt_lina uuid; v_cpt_sacha uuid; v_staff uuid;
  -- Le consentement biometrique d'un mineur ne peut venir que d'un parent confirme : l'enfant ne
  -- peut pas se l'accorder a lui-meme, meme s'il a son propre compte depuis la v217.
  v_cpt_parent uuid; v_parent uuid;
  e text[] := '{}'; n int; msg text; v_res jsonb;
  emp extensions.vector;
begin
  perform pg_temp.serveur();
  select id into v_saison from saisons where label = '2026-2027';
  select id into v_staff from profiles where role='admin' and actif order by created_at limit 1;

  v_club := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut) values (v_club,'club','ZZ Club Reco','actif_standard');
  insert into clubs (id, nom, plan, saison_id) values (v_club,'ZZ Club Reco','performance', v_saison);
  insert into club_teams (club_id, name) values (v_club,'ZZ Reco U13') returning id into v_equipe;
  insert into club_teams (club_id, name) values (v_club,'ZZ Reco U15') returning id into v_autre;

  v_cpt_lina := gen_random_uuid(); v_cpt_sacha := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (v_cpt_lina,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-reco-lina@example.invalid','',now(),now(),now()),
      (v_cpt_sacha,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-reco-sacha@example.invalid','',now(),now(),now());
  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (v_cpt_lina,'ZZ','RecoLina', v_club, date '2013-01-01') returning id into v_lina;
  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (v_cpt_sacha,'ZZ','RecoSacha', v_club, date '2013-02-02') returning id into v_sacha;
  -- Un joueur de l'AUTRE équipe : il ne doit jamais être propose sur cette galerie.
  insert into player_profiles (prenom, nom, club_id, date_naissance)
    values ('ZZ','RecoAutre', v_club, date '2011-03-03') returning id into v_ext;
  v_cpt_parent := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_cpt_parent,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-reco-parent@example.invalid','',now(),now(),now());
  insert into parent_profiles (user_id, prenom, nom) values (v_cpt_parent,'ZZ','RecoParent') returning id into v_parent;
  insert into parent_player_relationships (parent_id, player_id, statut, confirmed_at)
    values (v_parent, v_lina, 'confirme', now());

  insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut) values
    (v_lina, v_equipe, v_club, '2026-2027', v_saison, 'active'),
    (v_sacha, v_equipe, v_club, '2026-2027', v_saison, 'active'),
    (v_ext, v_autre, v_club, '2026-2027', v_saison, 'active');

  insert into media_albums (club_id, team_id, saison_id, title, status, event_date)
    values (v_club, v_equipe, v_saison, 'ZZ Match Reco', 'published', current_date) returning id into v_album;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position)
    values (v_album, v_club, 'photo','sportvision-media-prive','zz/reco1.jpg','ready',1) returning id into v_photo;

  emp := '[0.10,0.20,0.30]'::extensions.vector;

  -- ══ 1. SANS CONSENTEMENT, RIEN N'ENTRE ═══════════════════════════════════
  perform pg_temp.incarner(v_cpt_parent);
  msg := null;
  begin
    perform visage_reference_ajouter(v_lina, emp, 'essai-navigateur-v1');
    e := e || 'une empreinte est entree SANS consentement'::text;
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%autorisee%' then
    e := e || ('le refus sans consentement n est pas explicite : '||coalesce(left(msg,60),'(aucun)'))::text;
  end if;

  -- ══ 2. AVEC LE CONSENTEMENT, ELLE ENTRE ══════════════════════════════════
  perform donner_consentement_biometrie(v_lina, 'texte-v1-14-09-2026');
  begin
    perform visage_reference_ajouter(v_lina, emp, 'essai-navigateur-v1');
  exception when others then
    e := e || ('empreinte refusee malgre le consentement — '||left(sqlerrm,70))::text;
  end;
  perform pg_temp.serveur();
  select count(*) into n from visages_reference where player_id = v_lina;
  if n <> 1 then e := e || format('empreintes de reference : %s au lieu de 1', n); end if;

  -- ══ 3. PAS L'ENFANT D'UNE AUTRE FAMILLE ══════════════════════════════════
  perform pg_temp.incarner(v_cpt_parent);
  msg := null;
  begin
    perform visage_reference_ajouter(v_sacha, emp, 'essai-navigateur-v1');
    e := e || 'une famille a pose l empreinte de l enfant d une autre'::text;
  exception when others then msg := sqlerrm;
  end;

  -- ══ 4. LE RAPPROCHEMENT RESTE DANS L'ÉQUIPE ══════════════════════════════
  perform pg_temp.serveur();
  -- Ce joueur n'a pas de compte : on pose son consentement en direct, comme le ferait le club.
  insert into consentements_biometrie (player_id, club_id, saison_id, donne_par, qualite, texte_version, statut, accorde_le)
    values (v_ext, v_club, v_saison, v_staff, 'parent', 'texte-v1-14-09-2026', 'accorde', now());
  insert into visages_reference (player_id, empreinte, modele, origine)
    values (v_ext, emp, 'essai-navigateur-v1', 'club');
  -- v225 — Aucune empreinte de visage de galerie n'est conservee : on compare a la volee.
  perform pg_temp.incarner(v_staff);
  select count(*) into n from visage_rapprocher_direct(v_photo, emp, 'essai-navigateur-v1') where player_id = v_ext;
  if n <> 0 then e := e || 'un joueur d une autre equipe est propose'::text; end if;
  select count(*) into n from visage_rapprocher_direct(v_photo, emp, 'essai-navigateur-v1') where player_id = v_lina;
  if n <> 1 then e := e || format('le joueur de l equipe n est pas reconnu : %s', n); end if;

  -- ══ 5. UN CONSENTEMENT RETIRÉ SORT DU RAPPROCHEMENT ══════════════════════
  perform pg_temp.serveur();
  insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut)
    values ('media_asset', v_photo, v_lina, 'suggestion', 'valide'),
           ('media_asset', v_photo, v_sacha, 'humain', 'valide');

  perform pg_temp.incarner(v_cpt_parent);
  v_res := retirer_consentement_biometrie(v_lina);

  perform pg_temp.incarner(v_staff);
  select count(*) into n from visage_rapprocher_direct(v_photo, emp, 'essai-navigateur-v1') where player_id = v_lina;
  if n <> 0 then e := e || 'un joueur dont le consentement est retire reste propose'::text; end if;

  -- ══ 6. LE RETRAIT EFFACE L'EMPREINTE ET LES MARQUAGES MACHINE ════════════
  perform pg_temp.serveur();
  select count(*) into n from visages_reference where player_id = v_lina;
  if n <> 0 then e := e || format('apres retrait : %s empreinte(s) subsistent', n); end if;
  select count(*) into n from media_player_tags where player_id = v_lina and source = 'suggestion';
  if n <> 0 then e := e || 'les marquages de la machine survivent au retrait'::text; end if;
  select count(*) into n from media_player_tags where player_id = v_sacha and source = 'humain';
  if n <> 1 then e := e || 'un marquage humain a ete efface par le retrait d une AUTRE famille'::text; end if;

  -- ══ 6bis. AUCUNE EMPREINTE DE GALERIE N'EST CONSERVEE (v225) ═════════════
  -- Le texte de consentement promet aux parents que les visages des autres enfants ne sont jamais
  -- enregistres. La table qui les gardait ne doit donc plus exister du tout.
  perform pg_temp.serveur();
  select count(*) into n from information_schema.tables
   where table_schema = 'public' and table_name = 'visages_detectes';
  if n <> 0 then e := e || 'la table des visages de galerie existe encore'::text; end if;

  -- ══ 7. PERSONNE NE LIT CES TABLES EN DIRECT ══════════════════════════════
  perform pg_temp.incarner(v_staff);
  begin
    perform count(*) from visages_reference;
    e := e || 'la table des empreintes est lisible directement'::text;
  exception when others then null; end;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — aucune empreinte sans consentement, jamais celle de l''enfant d''un autre ; le rapprochement reste dans l''équipe et ignore un consentement retiré ; le retrait efface l''empreinte et les marquages de la machine, garde ceux des humains ; les tables ne se lisent pas en direct.' as verdict;

rollback;
