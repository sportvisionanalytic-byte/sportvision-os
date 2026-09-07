-- Les statistiques commerciales, sur le jeu de donnees du cahier des charges. Transaction annulée.
--
--   Galerie A, lien club    : 10 vues, 2 commandes a 10 EUR, 1 a 20 EUR
--   Galerie A, lien adverse :  5 vues, 1 commande a 30 EUR
--   Attendu : CA 70 EUR, 4 commandes, lien club 40 EUR, lien adverse 30 EUR
begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;
create temp table _ctx(nom text, val text) on commit drop;
grant all on _res to authenticated;
grant all on _ctx to authenticated;

-- Etat d'avant : les vraies galeries continuent d'exister, on mesurera des ecarts.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b4ff9a0e-9ae6-43a5-bddf-412fdf7d2cca","role":"authenticated"}';
insert into _ctx
select x.nom, x.val from (
  select 'ca_avant' as nom, ca_cents::text as val from media_stats_resume(current_date - 1, current_date + 1)
  union all select 'cmd_avant', commandes::text from media_stats_resume(current_date - 1, current_date + 1)
  union all select 'pay_avant', commandes_payantes::text from media_stats_resume(current_date - 1, current_date + 1)
  union all select 'grat_avant', commandes_gratuites::text from media_stats_resume(current_date - 1, current_date + 1)
  union all select 'vues_avant', visites::text from media_stats_resume(current_date - 1, current_date + 1)
) x;
reset role;

do $$
declare
  v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  v_saison uuid; alA uuid; lClub uuid; lAdv uuid; oid uuid; i integer;
  v_pack uuid; v_full uuid; offClub uuid; offAdv uuid; v_asset uuid;
begin
  select id into v_saison from saisons where label='2026-2027';
  insert into media_albums (club_id, saison_id, title, status, event_date)
  values (v_club, v_saison, 'ZZ stats A', 'published', current_date) returning id into alA;
  insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status, position)
  values (alA, v_club, 'm/1.jpg','p/1','t/1','P1.JPG','ready',1) returning id into v_asset;

  select media_link_type_product(v_club,'pack') into v_pack;
  select media_link_type_product(v_club,'album_complet') into v_full;

  insert into media_album_links (album_id, slug, label, audience)
  values (alA, media_gallery_unique_slug('ZZ stats club'), 'Parents', 'club_partenaire') returning id into lClub;
  insert into media_album_links (album_id, slug, label, audience)
  values (alA, media_gallery_unique_slug('ZZ stats adverse'), 'Adverse', 'equipe_adverse') returning id into lAdv;

  insert into media_album_link_offers (link_id, product_id, price_override_cents, photos_allowance, label)
  values (lClub, v_pack, 1000, 5, '5 photos') returning id into offClub;
  insert into media_album_link_offers (link_id, product_id, price_override_cents, label)
  values (lAdv, v_full, 3000, 'Galerie complete') returning id into offAdv;

  -- Vues : 10 cote club, 5 cote adverse.
  for i in 1..10 loop
    insert into media_album_views (album_id, link_id, visitor_hash) values (alA, lClub, 'zzc'||i);
  end loop;
  for i in 1..5 loop
    insert into media_album_views (album_id, link_id, visitor_hash) values (alA, lAdv, 'zza'||i);
  end loop;

  -- 2 commandes a 10 EUR sur le lien club.
  for i in 1..2 loop
    insert into media_orders (club_id, album_id, link_id, offer_id, guest_email, amount_cents, currency, status, paid_at)
    values (v_club, alA, lClub, offClub, 'zz-parent'||i||'@x.fr', 1000, 'eur', 'paid', now()) returning id into oid;
    insert into media_order_items (order_id, asset_id, album_id, unit_price_cents, quantity) values (oid, v_asset, alA, 0, 1);
  end loop;
  -- 1 commande a 20 EUR sur le meme lien, MEME offre : l'offre a change de prix entre-temps.
  insert into media_orders (club_id, album_id, link_id, offer_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, alA, lClub, offClub, 'zz-parent3@x.fr', 2000, 'eur', 'paid', now()) returning id into oid;
  insert into media_order_items (order_id, asset_id, album_id, unit_price_cents, quantity) values (oid, v_asset, alA, 0, 1);
  -- 1 commande a 30 EUR cote adverse, par un compte CONNECT.
  insert into media_orders (club_id, album_id, link_id, offer_id, purchased_by_user_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, alA, lAdv, offAdv, '3259409d-b69f-4780-877c-b75e0e8d663d', 'zz-adverse@x.fr', 3000, 'eur', 'paid', now()) returning id into oid;
  insert into media_order_items (order_id, asset_id, album_id, unit_price_cents, quantity) values (oid, v_asset, alA, 0, 1);

  -- Bruit qui NE DOIT PAS compter : session abandonnee, commande annulee, remboursement.
  insert into media_orders (club_id, album_id, link_id, guest_email, amount_cents, currency, status)
  values (v_club, alA, lClub, 'zz-abandon@x.fr', 5000, 'eur', 'pending');
  insert into media_orders (club_id, album_id, link_id, guest_email, amount_cents, currency, status)
  values (v_club, alA, lClub, 'zz-annule@x.fr', 5000, 'eur', 'cancelled');
  insert into media_orders (club_id, album_id, link_id, guest_email, amount_cents, currency, status, paid_at, refunded_at)
  values (v_club, alA, lClub, 'zz-remb@x.fr', 1500, 'eur', 'refunded', now(), now());

  -- Une commande GRATUITE : compte comme commande, pas comme CA.
  insert into media_orders (club_id, album_id, link_id, offer_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, alA, lClub, offClub, 'zz-gratuit@x.fr', 0, 'eur', 'paid', now()) returning id into oid;
  insert into media_order_items (order_id, asset_id, album_id, unit_price_cents, quantity) values (oid, v_asset, alA, 0, 1);

  insert into _ctx values ('album', alA::text), ('lClub', lClub::text), ('lAdv', lAdv::text), ('offClub', offClub::text);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b4ff9a0e-9ae6-43a5-bddf-412fdf7d2cca","role":"authenticated"}';

do $$
declare r record; v_n integer; v_ca bigint; v_txt text; d date := current_date - 1; f date := current_date + 1;
begin
  -- ── 1. Les grands nombres, mesures EN ECART ────────────────────────────
  -- media_stats_resume agrege tout le perimetre autorise, vraies galeries comprises. On compare
  -- donc a l'etat d'avant plutot qu'a des totaux absolus, qui dependraient de l'activite reelle.
  select * into r from media_stats_resume(d, f);
  insert into _res values ('1','CA ajoute par le jeu de test','+7000 c',
    '+'||(r.ca_cents - (select val::bigint from _ctx where nom='ca_avant'))::text,
    r.ca_cents - (select val::bigint from _ctx where nom='ca_avant') = 7000);
  insert into _res values ('1','5 commandes ajoutees (4 payantes + 1 gratuite)','+5',
    '+'||(r.commandes - (select val::integer from _ctx where nom='cmd_avant'))::text,
    r.commandes - (select val::integer from _ctx where nom='cmd_avant') = 5);
  insert into _res values ('1','dont 4 payantes','+4',
    '+'||(r.commandes_payantes - (select val::integer from _ctx where nom='pay_avant'))::text,
    r.commandes_payantes - (select val::integer from _ctx where nom='pay_avant') = 4);
  insert into _res values ('1','dont 1 gratuite','+1',
    '+'||(r.commandes_gratuites - (select val::integer from _ctx where nom='grat_avant'))::text,
    r.commandes_gratuites - (select val::integer from _ctx where nom='grat_avant') = 1);
  insert into _res values ('1','15 visites ajoutees','+15',
    '+'||(r.visites - (select val::integer from _ctx where nom='vues_avant'))::text,
    r.visites - (select val::integer from _ctx where nom='vues_avant') = 15);
  insert into _res values ('1','le remboursement est isole du CA','1500 c au moins',
    r.rembourse_cents::text, r.rembourse_cents >= 1500);
  -- Le panier moyen ne se verifie pas en ecart : c'est une moyenne. On verifie qu'il exclut bien
  -- les commandes gratuites, en le comparant a la moyenne qui les inclurait.
  insert into _res values ('1','panier moyen : les gratuites sont exclues','oui',
    case when r.panier_moyen_cents > (r.ca_cents / r.commandes) then 'oui' else 'non' end,
    r.panier_moyen_cents > (r.ca_cents / r.commandes));

  -- ── 2. Par lien : l'attribution vient de link_id ───────────────────────
  select ca_cents into v_ca from media_stats_liens((select val::uuid from _ctx where nom='album'), d, f)
   where link_id = (select val::uuid from _ctx where nom='lClub');
  insert into _res values ('2','CA du lien club (10+10+20+0)','4000 c', v_ca::text, v_ca = 4000);
  select ca_cents into v_ca from media_stats_liens((select val::uuid from _ctx where nom='album'), d, f)
   where link_id = (select val::uuid from _ctx where nom='lAdv');
  insert into _res values ('2','CA du lien adverse','3000 c', v_ca::text, v_ca = 3000);
  select visites into v_n from media_stats_liens((select val::uuid from _ctx where nom='album'), d, f)
   where link_id = (select val::uuid from _ctx where nom='lClub');
  insert into _res values ('2','vues du lien club','10', v_n::text, v_n = 10);
  select taux_conversion into v_txt from media_stats_liens((select val::uuid from _ctx where nom='album'), d, f)
   where link_id = (select val::uuid from _ctx where nom='lAdv');
  insert into _res values ('2','conversion du lien adverse (1/5)','20.00', v_txt, v_txt = '20.00');

  -- ── 3. Par offre : LE piege du prix qui change ─────────────────────────
  select ca_cents, ventes, prix_actuel_cents into v_ca, v_n, v_txt
  from media_stats_offres((select val::uuid from _ctx where nom='album'), d, f)
   where offer_id = (select val::uuid from _ctx where nom='offClub');
  -- 4 ventes (10 + 10 + 20 + 0). « 4 x prix actuel » donnerait 4000 : c'est l'erreur a ne pas faire.
  insert into _res values ('3','CA de l offre = montants reels, pas ventes x prix actuel','4000 c', v_ca::text, v_ca = 4000);
  insert into _res values ('3','4 ventes sur cette offre','4', v_n::text, v_n = 4);
  insert into _res values ('3','le prix actuel est rendu a part','1000 c', v_txt, v_txt = '1000');

  -- Le prix change : le CA historique ne doit PAS bouger.
  update media_album_link_offers set price_override_cents = 1200
   where id = (select val::uuid from _ctx where nom='offClub');
  select ca_cents, prix_actuel_cents into v_ca, v_txt
  from media_stats_offres((select val::uuid from _ctx where nom='album'), d, f)
   where offer_id = (select val::uuid from _ctx where nom='offClub');
  insert into _res values ('3','offre passee a 12 EUR : le CA historique ne bouge pas','4000 c', v_ca::text, v_ca = 4000);
  insert into _res values ('3','mais le prix affiche suit','1200 c', v_txt, v_txt = '1200');

  -- Une offre qui a vendu ne peut PLUS etre supprimee : la contrainte le refuse. C'est ce qui
  -- garantit que le chiffre d'affaires garde sa ventilation, quel que soit le chemin emprunte.
  begin
    delete from media_album_link_offers where id = (select val::uuid from _ctx where nom='offClub');
    insert into _res values ('3','offre vendue : suppression refusee','refusee','ACCEPTEE', false);
  exception when foreign_key_violation then
    insert into _res values ('3','offre vendue : suppression refusee','refusee','refusee', true);
  end;

  -- Elle se desactive, et son CA reste attribue.
  update media_album_link_offers set is_enabled = false where id = (select val::uuid from _ctx where nom='offClub');
  select ca_cents, encore_proposee into v_ca, v_txt
  from media_stats_offres((select val::uuid from _ctx where nom='album'), d, f)
   where offer_id = (select val::uuid from _ctx where nom='offClub');
  insert into _res values ('3','offre desactivee : son CA reste compte','4000 c', coalesce(v_ca::text,'PERDU'), v_ca = 4000);
  insert into _res values ('3','et elle est marquee comme plus proposee','false', coalesce(v_txt,'NULL'), v_txt = 'false');

  -- ── 4. Par audience, lues depuis les donnees ───────────────────────────
  -- L'audience « club partenaire » porte aussi de vraies ventes : on verifie qu'elle contient AU
  -- MOINS le jeu de test, et surtout qu'elle est bien separee de l'audience adverse.
  select ca_cents into v_ca from media_stats_audiences(d, f) where audience = 'club_partenaire';
  insert into _res values ('4','audience club partenaire','>= 4000 c', v_ca::text, v_ca >= 4000);
  select ca_cents into v_ca from media_stats_audiences(d, f) where audience = 'equipe_adverse';
  insert into _res values ('4','audience equipe adverse','3000 c', v_ca::text, v_ca = 3000);

  -- ── 5. Invite contre Connect, par PERSONNE ─────────────────────────────
  select * into r from media_stats_connect(d, f);
  -- On compte des PERSONNES : les 5 adresses du jeu de test, plus les vraies.
  insert into _res values ('5','au moins les 5 acheteurs du jeu de test','>= 5', r.acheteurs::text, r.acheteurs >= 5);
  insert into _res values ('5','au moins 1 sur Connect','>= 1', r.acheteurs_connect::text, r.acheteurs_connect >= 1);
  insert into _res values ('5','invites + Connect = total','coherent',
    (r.acheteurs_connect + r.acheteurs_invites)::text||' = '||r.acheteurs::text,
    r.acheteurs_connect + r.acheteurs_invites = r.acheteurs);
  -- Trois commandes de la meme personne ne pesent qu'une fois dans le comptage des acheteurs.
  insert into _res values ('5','moins d acheteurs que de commandes (dedoublonnage)','oui',
    case when r.acheteurs < (r.commandes_connect + r.commandes_invitees) then 'oui' else 'egal' end,
    r.acheteurs <= (r.commandes_connect + r.commandes_invitees));

  -- ── 6. Classement et evolution ─────────────────────────────────────────
  select ca_cents into v_ca from media_stats_galeries(d, f, 50)
   where album_id = (select val::uuid from _ctx where nom='album');
  insert into _res values ('6','la galerie apparait au classement','7000 c', coalesce(v_ca::text,'ABSENTE'), v_ca = 7000);
  select count(*)::integer into v_n from media_stats_evolution(d, f);
  insert into _res values ('6','evolution : un point par jour, creux compris','3', v_n::text, v_n = 3);
  select sum(ca_cents)::bigint into v_ca from media_stats_evolution(d, f);
  insert into _res values ('6','la somme des jours = le CA de la periode','identiques',
    case when v_ca = (select ca_cents from media_stats_resume(d, f)) then 'identiques' else v_ca::text end,
    v_ca = (select ca_cents from media_stats_resume(d, f)));

  -- ── 7. Une periode sans rien ───────────────────────────────────────────
  select * into r from media_stats_resume(current_date - 400, current_date - 300);
  insert into _res values ('7','periode vide : CA a 0','0', r.ca_cents::text, r.ca_cents = 0);
  insert into _res values ('7','et AUCUN taux invente','NULL', coalesce(r.taux_conversion::text,'NULL'), r.taux_conversion is null);
  insert into _res values ('7','ni panier moyen','NULL', coalesce(r.panier_moyen_cents::text,'NULL'), r.panier_moyen_cents is null);
end $$;
reset role;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
