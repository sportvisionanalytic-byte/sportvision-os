-- Achat en etant deja connecte : la commande est rattachee des le depart, le droit est permanent
-- tout de suite, et le parcours invite n'a pas bouge. Transaction annulée.
--
-- On verifie ce que la BASE doit constater. Le fait que le checkout reconnaisse la session est
-- verifie separement contre la fonction deployee (voir le rapport).
begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;
create temp table _ctx(nom text, val text) on commit drop;
grant all on _res to authenticated;
grant all on _ctx to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at)
values ('44444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'zz-connecte@exemple.fr','x',now(),now(),now());
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('55555555-5555-4555-8555-555555555555','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'zz-nonverifie@exemple.fr','x',now(),now());

do $$
declare
  v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  v_saison uuid; v_album uuid; v_ids uuid[] := '{}'; v_id uuid; i integer;
  oA uuid; oB uuid; oC uuid;
begin
  select id into v_saison from saisons where label='2026-2027';
  insert into media_albums (club_id, saison_id, title, status)
  values (v_club, v_saison, 'ZZ achat connecte', 'published') returning id into v_album;
  for i in 1..6 loop
    insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status, position)
    values (v_album, v_club, 'm/'||i||'.jpg','p/'||i,'t/'||i,'P'||i||'.JPG','ready',i) returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- CAS A : achat invite, comportement d'avant. Droit de 30 jours, non reclame.
  insert into media_orders (club_id, album_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, v_album, 'zz-invite@exemple.fr', 1000, 'eur', 'paid', now()) returning id into oA;
  insert into media_order_items (order_id, asset_id, album_id, unit_price_cents, quantity)
  select oA, id, v_album, 0, 1 from unnest(v_ids[1:2]) as id;
  insert into media_download_grants (order_id, email) values (oA, 'zz-invite@exemple.fr');

  -- CAS B : acheteur connecte et verifie. Ce que le checkout ecrit desormais.
  insert into media_orders (club_id, album_id, purchased_by_user_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, v_album, '44444444-4444-4444-8444-444444444444', 'zz-connecte@exemple.fr', 1500, 'eur', 'paid', now())
  returning id into oB;
  insert into media_order_items (order_id, asset_id, album_id, unit_price_cents, quantity)
  select oB, id, v_album, 0, 1 from unnest(v_ids[3:5]) as id;
  insert into media_download_grants (order_id, email, claimed_by_user_id, claimed_at, expires_at)
  values (oB, 'zz-connecte@exemple.fr', '44444444-4444-4444-8444-444444444444', now(), now() + interval '100 years');

  -- CAS D : offre gratuite, acheteur connecte.
  insert into media_orders (club_id, album_id, purchased_by_user_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, v_album, '44444444-4444-4444-8444-444444444444', 'zz-connecte@exemple.fr', 0, 'eur', 'paid', now())
  returning id into oC;
  insert into media_order_items (order_id, asset_id, album_id, unit_price_cents, quantity)
  select oC, id, v_album, 0, 1 from unnest(v_ids[6:6]) as id;
  insert into media_download_grants (order_id, email, claimed_by_user_id, claimed_at, expires_at)
  values (oC, 'zz-connecte@exemple.fr', '44444444-4444-4444-8444-444444444444', now(), now() + interval '100 years');

  insert into _ctx values ('album', v_album::text), ('oA', oA::text), ('oB', oB::text), ('oC', oC::text);
end $$;

-- ── CAS B et D, vus par l'acheteur connecte ──────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare v_n integer; v_txt text;
begin
  select count(*)::integer into v_n from media_my_galleries()
   where album_id = (select val::uuid from _ctx where nom='album');
  insert into _res values ('B','la galerie apparait immediatement, sans claim','1',v_n::text,v_n=1);

  select photos_acquises into v_n from media_my_galleries()
   where album_id = (select val::uuid from _ctx where nom='album');
  insert into _res values ('B','4 photos : 3 payantes + 1 gratuite','4',v_n::text,v_n=4);

  select commandes into v_n from media_my_galleries()
   where album_id = (select val::uuid from _ctx where nom='album');
  insert into _res values ('B','deux commandes, une seule galerie','2',v_n::text,v_n=2);

  select count(*)::integer into v_n from media_my_gallery_orders()
   where acces_permanent and expires_at > now() + interval '10 years';
  insert into _res values ('B','droit permanent des le paiement, sans les 30 jours','2',v_n::text,v_n=2);

  -- La commande de l'invite ne lui appartient pas.
  select count(*)::integer into v_n from media_my_gallery_orders()
   where order_id = (select val::uuid from _ctx where nom='oA');
  insert into _res values ('B','la commande invitee d un autre reste invisible','0',v_n::text,v_n=0);

  -- CAS D : la commande gratuite s'affiche normalement, a 0.
  select total_cents::text into v_txt from media_my_gallery_orders()
   where order_id = (select val::uuid from _ctx where nom='oC');
  insert into _res values ('D','commande gratuite presente, montant 0','0',coalesce(v_txt,'ABSENTE'),v_txt='0');
  select count(*)::integer into v_n from media_my_gallery_orders()
   where order_id = (select val::uuid from _ctx where nom='oC') and acces_permanent;
  insert into _res values ('D','et son droit est permanent','1',v_n::text,v_n=1);

  -- Un rejeu de claim ne doit rien casser pour lui.
  select rattachees into v_n from media_gallery_claim_all(null);
  insert into _res values ('B','claim rejoue : plus rien a rattacher','0',v_n::text,v_n=0);
end $$;
reset role;

-- ── CAS A : le parcours invite n'a pas bouge ─────────────────────────────
do $$
declare v_n integer;
begin
  select count(*)::integer into v_n from media_download_grants g
   where g.order_id=(select val::uuid from _ctx where nom='oA')
     and g.claimed_by_user_id is null
     and g.expires_at between now() + interval '20 days' and now() + interval '40 days';
  insert into _res values ('A','achat invite : droit de 30 jours, non reclame','1',v_n::text,v_n=1);
  select count(*)::integer into v_n from media_orders
   where id=(select val::uuid from _ctx where nom='oA') and purchased_by_user_id is null;
  insert into _res values ('A','et la commande n appartient a personne','1',v_n::text,v_n=1);
end $$;

-- ── CAS C : un compte tiers ne recupere rien ─────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare r record; v_n integer;
begin
  -- Compte NON verifie : meme s'il fournit le jeton de la commande invitee.
  select * into r from media_gallery_claim_all(
    (select g.token from media_download_grants g where g.order_id=(select val::uuid from _ctx where nom='oA')));
  insert into _res values ('C','compte non verifie : refuse','email_non_verifie',coalesce(r.raison,'ACCEPTE'),r.raison='email_non_verifie');
  select count(*)::integer into v_n from media_my_galleries();
  insert into _res values ('C','et aucune galerie','0',v_n::text,v_n=0);
end $$;
reset role;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
