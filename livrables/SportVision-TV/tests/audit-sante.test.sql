-- La detection d'anomalies : elle doit voir ce qui est reellement casse, et se taire sur ce qui
-- est normal. Transaction annulée.
begin;
create temp table _res(cas text, attendu text, obtenu text, ok boolean) on commit drop;
grant all on _res to authenticated;
create temp table _ctx(nom text, val text) on commit drop;
grant all on _ctx to authenticated;

do $$
declare v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b'; v_saison uuid; a uuid; o uuid; m uuid;
begin
  select id into v_saison from saisons where label='2026-2027';
  insert into media_albums (club_id, saison_id, title, status, pole_id)
  values (v_club, v_saison, 'ZZ sante', 'published', (select id from poles limit 1)) returning id into a;
  insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status)
  values (a, v_club, 'm/1.jpg','p/1','t/1','P1.JPG','ready') returning id into m;

  -- Anomalie 1 : commande payee SANS droit de telechargement.
  insert into media_orders (club_id, album_id, guest_email, amount_cents, currency, status, paid_at)
  values (v_club, a, 'zz-sante1@x.fr', 1000, 'eur', 'paid', now()) returning id into o;
  insert into media_order_items (order_id, asset_id, album_id, unit_price_cents, quantity) values (o, m, a, 0, 1);

  -- Anomalie 2 : e-mail definitivement echoue.
  insert into notification_outbox (event_type, template_key, channel, idempotency_key, recipient_email,
                                   status, last_error, scheduled_at, next_attempt_at)
  values ('zz.test','zz.test','EMAIL','zz-sante-'||gen_random_uuid(),'zz-sante2@x.fr','FAILED','boite pleine', now(), now());

  -- Anomalie 3 : photo publiable sans apercu.
  insert into media_assets (album_id, club_id, original_path, original_filename, status)
  values (a, v_club, 'm/2.jpg','P2.JPG','ready');

  -- PAS une anomalie : un pack paye dont la selection n'est pas encore faite.
  insert into media_orders (club_id, album_id, guest_email, amount_cents, currency, status, paid_at, photos_allowance)
  values (v_club, a, 'zz-sante-ok@x.fr', 900, 'eur', 'paid', now(), 5) returning id into o;
  insert into media_download_grants (order_id, email) values (o, 'zz-sante-ok@x.fr');

  insert into _ctx values ('album', a::text);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b4ff9a0e-9ae6-43a5-bddf-412fdf7d2cca","role":"authenticated"}';
do $$
declare n integer;
begin
  select nombre into n from media_sante() where probleme like 'Commande payée sans droit%';
  insert into _res values ('detecte une commande payee sans droit','>= 1', coalesce(n::text,'0'), coalesce(n,0) >= 1);

  select nombre into n from media_sante() where probleme like 'E-mail définitivement%';
  insert into _res values ('detecte un e-mail definitivement echoue','>= 1', coalesce(n::text,'0'), coalesce(n,0) >= 1);

  select nombre into n from media_sante() where probleme like 'Photo publiable sans%';
  insert into _res values ('detecte une photo sans apercu','>= 1', coalesce(n::text,'0'), coalesce(n,0) >= 1);

  -- Le point le plus important : ne pas crier au loup sur un cas normal.
  select nombre into n from media_sante() where probleme like 'Commande payée sans aucune photo%';
  insert into _res values ('ne signale PAS un pack en attente de selection','0 ou absent',
    coalesce(n::text,'absent'), coalesce(n,0) = 0);

  -- Chaque anomalie doit fournir de quoi la retrouver.
  select jsonb_array_length(detail) into n from media_sante() where probleme like 'Commande payée sans droit%';
  insert into _res values ('le detail permet de retrouver le cas','>= 1', coalesce(n::text,'0'), coalesce(n,0) >= 1);

  -- Gravites correctement attribuees.
  insert into _res select 'une commande payee sans droit est CRITIQUE','critique',
    coalesce((select gravite from media_sante() where probleme like 'Commande payée sans droit%'),'?'),
    (select gravite from media_sante() where probleme like 'Commande payée sans droit%') = 'critique';
end $$;
reset role;

-- Un role sans acces aux statistiques ne doit rien voir.
set local role authenticated;
set local request.jwt.claims = '{"sub":"0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*)::integer into n from media_sante();
  insert into _res values ('photographe : aucune anomalie visible','0', n::text, n = 0);
end $$;
reset role;

select cas, attendu, obtenu, ok from _res order by cas;
rollback;
