-- Qui voit quoi dans les statistiques commerciales. Transaction annulée.
begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;
create temp table _ctx(nom text, val text) on commit drop;
grant all on _res to authenticated;
grant all on _ctx to authenticated;

do $$
declare
  v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  v_saison uuid; alFoot uuid; alBasket uuid; alSansPole uuid;
  pFoot uuid; pBasket uuid; v_lien uuid; oid uuid;
begin
  select id into v_saison from saisons where label='2026-2027';
  select id into pFoot from poles where nom='Football';
  select id into pBasket from poles where nom='Basket';

  insert into media_albums (club_id, saison_id, title, status, pole_id)
  values (v_club, v_saison, 'ZZ perm foot', 'published', pFoot) returning id into alFoot;
  insert into media_albums (club_id, saison_id, title, status, pole_id)
  values (v_club, v_saison, 'ZZ perm basket', 'published', pBasket) returning id into alBasket;
  -- Un album SANS pole : il ne doit apparaitre chez AUCUN responsable de pole.
  insert into media_albums (club_id, saison_id, title, status)
  values (v_club, v_saison, 'ZZ perm sans pole', 'published') returning id into alSansPole;

  insert into media_album_links (album_id, slug) values (alFoot, media_gallery_unique_slug('ZZ pf')) returning id into v_lien;
  insert into media_orders (club_id, album_id, link_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, alFoot, v_lien, 'zz-f@x.fr', 1000, 'eur', 'paid', now());
  insert into media_album_views (album_id, link_id, visitor_hash) values (alFoot, v_lien, 'zzpf1');

  insert into media_album_links (album_id, slug) values (alBasket, media_gallery_unique_slug('ZZ pb')) returning id into v_lien;
  insert into media_orders (club_id, album_id, link_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, alBasket, v_lien, 'zz-b@x.fr', 2000, 'eur', 'paid', now());

  insert into media_album_links (album_id, slug) values (alSansPole, media_gallery_unique_slug('ZZ ps')) returning id into v_lien;
  insert into media_orders (club_id, album_id, link_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, alSansPole, v_lien, 'zz-s@x.fr', 5000, 'eur', 'paid', now());

  insert into _ctx values ('foot', alFoot::text), ('basket', alBasket::text), ('sanspole', alSansPole::text),
                          ('pFoot', pFoot::text), ('pBasket', pBasket::text);
end $$;

-- Un responsable de pole Football, qui n'est ni admin ni prod : le CM de test fera l'affaire.
insert into pole_affectations (pole_id, user_id, role_pole, actif)
values ((select val::uuid from _ctx where nom='pFoot'), '2b0b7fae-33eb-45be-b393-707725ad9e7e', 'responsable', true);

-- ── Fondateur : tout ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"b4ff9a0e-9ae6-43a5-bddf-412fdf7d2cca","role":"authenticated"}';
do $$
declare v_n integer;
begin
  select count(*)::integer into v_n from _media_stats_albums()
   where album_id in ((select val::uuid from _ctx where nom='foot'),
                      (select val::uuid from _ctx where nom='basket'),
                      (select val::uuid from _ctx where nom='sanspole'));
  insert into _res values ('1','Fondateur : les 3 albums','3', v_n::text, v_n = 3);
end $$;
reset role;

-- ── Responsable de pole Football : Football SEULEMENT ─────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"2b0b7fae-33eb-45be-b393-707725ad9e7e","role":"authenticated"}';
do $$
declare v_n integer; v_ca bigint;
begin
  insert into _res select '2','il a acces aux statistiques','true', media_stats_access()::text, media_stats_access();

  select count(*)::integer into v_n from _media_stats_albums()
   where album_id = (select val::uuid from _ctx where nom='foot');
  insert into _res values ('2','voit son album Football','1', v_n::text, v_n = 1);

  select count(*)::integer into v_n from _media_stats_albums()
   where album_id = (select val::uuid from _ctx where nom='basket');
  insert into _res values ('2','ne voit PAS le Basket','0', v_n::text, v_n = 0);

  -- Le point le plus important : un album sans pole n'est pas « a tout le monde ».
  select count(*)::integer into v_n from _media_stats_albums()
   where album_id = (select val::uuid from _ctx where nom='sanspole');
  insert into _res values ('2','ne voit PAS un album sans pole','0', v_n::text, v_n = 0);

  -- Son CA ne contient que le sien : 10 EUR, ni les 20 du Basket ni les 50 sans pole.
  select ca_cents into v_ca from media_stats_resume(current_date - 1, current_date + 1);
  insert into _res values ('2','son CA = son pole uniquement','1000 c', v_ca::text, v_ca = 1000);

  select count(*)::integer into v_n from media_stats_liens((select val::uuid from _ctx where nom='basket'), current_date - 1, current_date + 1);
  insert into _res values ('2','aucun detail sur un album d un autre pole','0', v_n::text, v_n = 0);
end $$;
reset role;

-- ── Photographe : aucun acces ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2","role":"authenticated"}';
do $$
declare v_n integer; v_ca bigint;
begin
  insert into _res select '3','Photographe : aucun acces','false', media_stats_access()::text, not media_stats_access();
  select count(*)::integer into v_n from _media_stats_albums();
  insert into _res values ('3','et aucun album dans son perimetre','0', v_n::text, v_n = 0);
  select ca_cents into v_ca from media_stats_resume(current_date - 1, current_date + 1);
  insert into _res values ('3','son CA est vide','0', v_ca::text, v_ca = 0);
end $$;
reset role;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
