-- Le rattachement automatique d'un achat a un compte Connect. Transaction annulée.
--
-- On joue les vrais cas de Fouka (§35) : nouveau compte non verifie, e-mail different, compte
-- existant, plusieurs commandes, et rejeu idempotent.
begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;
create temp table _ctx(nom text, val text) on commit drop;
grant all on _res to authenticated;
grant all on _ctx to authenticated;

do $$
declare
  v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  v_album uuid; v_saison uuid; v_ids uuid[] := '{}'; v_id uuid; i integer;
  o1 uuid; o2 uuid; o3 uuid;
  v_mail text := 'zz-claim@exemple.fr';
begin
  select id into v_saison from saisons where label='2026-2027';
  insert into media_albums (club_id, saison_id, title, status)
  values (v_club, v_saison, 'ZZ claim', 'published') returning id into v_album;
  for i in 1..10 loop
    insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status, position)
    values (v_album, v_club, 'm/'||i||'.jpg','p/'||i,'t/'||i,'P'||i||'.JPG','ready',i) returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- Trois achats invites du MEME parent, faits avant toute creation de compte.
  insert into media_orders (club_id, album_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, v_album, v_mail, 1000, 'eur', 'paid', now()) returning id into o1;
  insert into media_order_items (order_id, asset_id, album_id, unit_price_cents, quantity)
  select o1, id, v_album, 0, 1 from unnest(v_ids[1:4]) as id;
  insert into media_download_grants (order_id, email) values (o1, v_mail);

  insert into media_orders (club_id, album_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, v_album, v_mail, 1500, 'eur', 'paid', now()) returning id into o2;
  insert into media_order_items (order_id, asset_id, album_id, unit_price_cents, quantity)
  select o2, id, v_album, 0, 1 from unnest(v_ids[3:8]) as id;  -- recouvre o1 sur 2 photos
  insert into media_download_grants (order_id, email) values (o2, v_mail);

  -- Une commande NON payee : elle ne doit jamais etre rattachee.
  insert into media_orders (club_id, album_id, guest_email, amount_cents, currency, status)
  values (v_club, v_album, v_mail, 900, 'eur', 'pending') returning id into o3;
  insert into media_download_grants (order_id, email) values (o3, v_mail);

  insert into _ctx values ('album', v_album::text), ('mail', v_mail),
                          ('o1', o1::text), ('o2', o2::text), ('o3', o3::text);
end $$;

-- ── 1. E-mail NON verifie : rien n'est rattache ───────────────────────────
-- On fabrique un compte dont l'adresse correspond, mais non confirmee.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        (select val from _ctx where nom='mail'), 'x', now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare r record; v_n integer;
begin
  select * into r from media_gallery_claim_all(null);
  insert into _res values ('1','e-mail non verifie : aucun rattachement','email_non_verifie',coalesce(r.raison,'ACCEPTE'), r.raison='email_non_verifie');
  select count(*)::integer into v_n from media_download_grants g
   where g.email=(select val from _ctx where nom='mail') and g.claimed_by_user_id is not null;
  insert into _res values ('1','aucun droit promu','0',v_n::text,v_n=0);
end $$;
reset role;

-- ── 2. Adresse verifiee : les commandes payees sont rattachees ────────────
update auth.users set email_confirmed_at = now()
where id = '11111111-1111-4111-8111-111111111111';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare r record; v_n integer;
begin
  select * into r from media_gallery_claim_all(null);
  insert into _res values ('2','apres verification : rattachement','true',r.ok::text,r.ok);
  -- Les DEUX commandes payees, pas seulement celle d'ou il vient (§10).
  insert into _res values ('2','les 2 commandes payees recuperees','2',r.rattachees::text,r.rattachees=2);

  select count(*)::integer into v_n from media_orders o
   where o.id in ((select val::uuid from _ctx where nom='o1'),(select val::uuid from _ctx where nom='o2'))
     and o.purchased_by_user_id = auth.uid();
  insert into _res values ('2','les commandes portent le compte','2',v_n::text,v_n=2);

  -- La commande NON payee reste dehors.
  select count(*)::integer into v_n from media_orders o
   where o.id=(select val::uuid from _ctx where nom='o3') and o.purchased_by_user_id is not null;
  insert into _res values ('2','la commande non payee reste dehors','0',v_n::text,v_n=0);

  -- Le droit devient permanent. On le lit par media_my_gallery_orders et NON en interrogeant
  -- media_download_grants : cette table est reservee au staff (RLS), et un compte Connect n'y voit
  -- rien. Compter dessus ici renverrait 0 pour une raison de permission, pas de comportement.
  select count(*)::integer into v_n from media_my_gallery_orders()
   where acces_permanent and expires_at > now() + interval '10 years';
  insert into _res values ('2','les 2 droits deviennent permanents','2',v_n::text,v_n=2);

  -- Et la table des droits reste bien fermee a un compte Connect.
  select count(*)::integer into v_n from media_download_grants;
  insert into _res values ('2','un compte Connect ne lit pas les droits en direct','0',v_n::text,v_n=0);

  -- ── 3. Rejeu idempotent ────────────────────────────────────────────────
  select * into r from media_gallery_claim_all(null);
  insert into _res values ('3','rejeu : accepte sans rien redoubler','true',r.ok::text,r.ok);
  insert into _res values ('3','rejeu : 0 nouvelle commande','0',r.rattachees::text,r.rattachees=0);
  select count(*)::integer into v_n from media_orders o where o.purchased_by_user_id = auth.uid();
  insert into _res values ('3','toujours 2 commandes, pas 4','2',v_n::text,v_n=2);

  -- ── 4. Ce qu'il voit dans Connect ──────────────────────────────────────
  select count(*)::integer into v_n from media_my_galleries();
  insert into _res values ('4','UNE galerie malgre deux achats dessus','1',v_n::text,v_n=1);
  select photos_acquises into v_n from media_my_galleries();
  -- o1 = photos 1..4, o2 = photos 3..8 : union = 8, pas 10.
  insert into _res values ('4','union des photos sans doublon','8',v_n::text,v_n=8);
  select commandes into v_n from media_my_galleries();
  insert into _res values ('4','mais bien deux commandes','2',v_n::text,v_n=2);
  select count(*)::integer into v_n from media_my_gallery_photos((select val::uuid from _ctx where nom='album'));
  insert into _res values ('4','Mes photos : les 8 acquises','8',v_n::text,v_n=8);
  select count(*)::integer into v_n from media_my_galleries() where acces_complet;
  insert into _res values ('4','8 sur 10 : ce n est pas un acces complet','0',v_n::text,v_n=0);
  select count(*)::integer into v_n from media_my_gallery_orders();
  insert into _res values ('4','Mes commandes : les 2 payees','2',v_n::text,v_n=2);
end $$;
reset role;

-- ── 5. Un AUTRE compte ne recupere rien ───────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at)
values ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-autre@exemple.fr', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare r record; v_n integer;
begin
  -- Il connait meme le jeton de la commande : ca ne lui donne rien.
  select * into r from media_gallery_claim_all(
    (select g.token from media_download_grants g where g.order_id=(select val::uuid from _ctx where nom='o1')));
  insert into _res values ('5','autre adresse : 0 commande rattachee','0',r.rattachees::text,r.rattachees=0);
  select count(*)::integer into v_n from media_my_galleries();
  insert into _res values ('5','et aucune galerie visible','0',v_n::text,v_n=0);
  select count(*)::integer into v_n from media_my_gallery_photos((select val::uuid from _ctx where nom='album'));
  insert into _res values ('5','aucune photo accessible','0',v_n::text,v_n=0);
end $$;
reset role;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
