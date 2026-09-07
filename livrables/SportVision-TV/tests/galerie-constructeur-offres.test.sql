-- Le constructeur d'offres : enregistrement atomique, validations, permissions.
-- Les SEPT offres du §23, saisies telles quelles. Transaction annulée.
begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;
create temp table _ctx(album uuid, lien uuid, slug text, token text) on commit drop;
grant all on _res to authenticated;
grant all on _ctx to authenticated;

insert into media_albums (club_id, team_id, saison_id, title, status)
values ('8be55101-0d61-4b27-8d7b-a4761547d88b','bee719f7-d735-4a0b-b070-0d20eb73e7ec',
        (select id from saisons where label='2026-2027'),'ZZ constructeur','published');
insert into _ctx (album) select id from media_albums where title='ZZ constructeur';

insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status, position)
select (select album from _ctx), '8be55101-0d61-4b27-8d7b-a4761547d88b',
       'm/'||i||'.jpg','p/'||i,'t/'||i,'P'||i||'.JPG','ready',i
from generate_series(1,60) i;

-- On agit comme le ferait le SECRETARIAT depuis l'OS : c'est lui qui prepare les liens.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b4eab475-3293-4804-8bf6-8b27a15d410c","role":"authenticated"}';

do $$
declare r record; v_n integer; v_txt text; v_album uuid;
begin
  select album into v_album from _ctx;

  -- ── 1. Les sept offres du §23, en une seule fois ───────────────────────
  select * into r from media_link_save(v_album, $j$[
    {"type":"pack","name":"3 photos","price_cents":0,"photos_allowance":3,"display_order":1},
    {"type":"pack","name":"5 photos","price_cents":600,"photos_allowance":5,"display_order":2},
    {"type":"pack","name":"12 photos","price_cents":900,"photos_allowance":12,"display_order":3},
    {"type":"pack","name":"17 photos","price_cents":1700,"photos_allowance":17,"display_order":4,"featured":true},
    {"type":"pack","name":"25 photos","price_cents":1900,"photos_allowance":25,"display_order":5},
    {"type":"pack","name":"50 photos","price_cents":2200,"photos_allowance":50,"display_order":6},
    {"type":"album_complet","name":"Galerie complete","price_cents":3500,"display_order":7}
  ]$j$::jsonb, null, 'Parents U12', 'club_partenaire');
  insert into _res values ('1','le secretariat enregistre les 7 offres','true',r.ok::text,r.ok);
  update _ctx set lien = r.link_id, slug = r.slug, token = r.token;

  select count(*)::integer into v_n from media_link_offers((select lien from _ctx));
  insert into _res values ('1','sept offres vendables','7',v_n::text,v_n = 7);

  -- ── 2. Le catalogue n'a pas grossi de sept produits ────────────────────
  select count(distinct product_id)::integer into v_n from media_link_offers((select lien from _ctx));
  insert into _res values ('2','deux produits de catalogue suffisent','2',v_n::text,v_n = 2);

  -- ── 3. Les valeurs saisies sont rendues telles quelles ─────────────────
  select string_agg(photos_allowance::text,'/' order by display_order) into v_txt
  from media_link_offers((select lien from _ctx)) where photos_allowance is not null;
  insert into _res values ('3','quotas exacts','3/5/12/17/25/50',v_txt,v_txt = '3/5/12/17/25/50');
  select string_agg(price_cents::text,'/' order by display_order) into v_txt
  from media_link_offers((select lien from _ctx));
  insert into _res values ('3','prix exacts (centimes)','0/600/900/1700/1900/2200/3500',v_txt,
    v_txt = '0/600/900/1700/1900/2200/3500');
  select offer_name into v_txt from media_link_offers((select lien from _ctx)) where is_featured;
  insert into _res values ('3','mise en avant conservee','17 photos',coalesce(v_txt,'NULL'),v_txt = '17 photos');

  -- ── 4. Rien n'est ecrit quand une offre est invalide ───────────────────
  -- C'est le point du §14 : une configuration a moitie enregistree est pire qu'un echec.
  select * into r from media_link_save(v_album, $j$[
    {"type":"pack","name":"Bon debut","price_cents":500,"photos_allowance":5},
    {"type":"pack","name":"Sans nombre","price_cents":800}
  ]$j$::jsonb, (select lien from _ctx), 'Parents U12', 'club_partenaire');
  insert into _res values ('4','pack sans nombre de photos : refuse','false',r.ok::text, not r.ok);
  select count(*)::integer into v_n from media_link_offers((select lien from _ctx));
  insert into _res values ('4','les 7 offres precedentes sont intactes','7',v_n::text,v_n = 7);

  select * into r from media_link_save(v_album, $j$[{"type":"pack","name":"","price_cents":500,"photos_allowance":5}]$j$::jsonb,
    (select lien from _ctx), 'Parents U12');
  insert into _res values ('4','offre sans nom : refusee','false',r.ok::text, not r.ok);
  select * into r from media_link_save(v_album, $j$[{"type":"pack","name":"Negatif","price_cents":-100,"photos_allowance":5}]$j$::jsonb,
    (select lien from _ctx), 'Parents U12');
  insert into _res values ('4','prix negatif : refuse','false',r.ok::text, not r.ok);
  select * into r from media_link_save(v_album, $j$[{"type":"pack","name":"Zero photo","price_cents":500,"photos_allowance":0}]$j$::jsonb,
    (select lien from _ctx), 'Parents U12');
  insert into _res values ('4','pack de 0 photo : refuse','false',r.ok::text, not r.ok);
  select * into r from media_link_save(v_album, $j$[
    {"type":"pack","name":"A","price_cents":500,"photos_allowance":5,"featured":true},
    {"type":"pack","name":"B","price_cents":800,"photos_allowance":9,"featured":true}
  ]$j$::jsonb, (select lien from _ctx), 'Parents U12');
  insert into _res values ('4','deux offres mises en avant : refuse','false',r.ok::text, not r.ok);
  select count(*)::integer into v_n from media_link_offers((select lien from _ctx));
  insert into _res values ('4','apres 5 refus, la configuration est toujours intacte','7',v_n::text,v_n = 7);

  -- ── 5. Le prix a 0 EUR est une valeur, pas une absence ─────────────────
  select price_cents into v_n from media_link_offers((select lien from _ctx)) where offer_name = '3 photos';
  insert into _res values ('5','offre gratuite conservee a 0','0',v_n::text,v_n = 0);

  -- ── 6. Modifier ne casse pas le lien deja envoye ───────────────────────
  select * into r from media_link_save(v_album, $j$[
    {"type":"pack","name":"17 photos","price_cents":2000,"photos_allowance":17,"display_order":1},
    {"type":"album_complet","name":"Galerie complete","price_cents":3500,"display_order":2}
  ]$j$::jsonb, (select lien from _ctx), 'Parents U12', 'club_partenaire');
  insert into _res values ('6','modification acceptee','true',r.ok::text,r.ok);
  insert into _res select '6','le slug ne change JAMAIS (des parents l ont deja)',(select slug from _ctx), r.slug, r.slug = (select slug from _ctx);
  insert into _res select '6','le jeton non plus','identique', case when r.token = (select token from _ctx) then 'identique' else 'CHANGE' end, r.token = (select token from _ctx);
  select price_cents into v_n from media_link_offers((select lien from _ctx)) where offer_name = '17 photos';
  insert into _res values ('6','nouveau tarif applique aux futurs achats','2000',v_n::text,v_n = 2000);
  select count(*)::integer into v_n from media_link_offers((select lien from _ctx));
  insert into _res values ('6','offres remplacees, pas cumulees','2',v_n::text,v_n = 2);

  -- ── 7. Relire pour editer ──────────────────────────────────────────────
  select (media_link_editor((select lien from _ctx))->>'label') into v_txt;
  insert into _res values ('7','l editeur relit le lien','Parents U12',coalesce(v_txt,'NULL'),v_txt = 'Parents U12');
  select jsonb_array_length(media_link_editor((select lien from _ctx))->'offres') into v_n;
  insert into _res values ('7','avec ses offres','2',v_n::text,v_n = 2);
end $$;

reset role;

-- ── 8. Qui peut se servir du constructeur ─────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2","role":"authenticated"}';
do $$
declare r record;
begin
  select * into r from media_link_save((select album from _ctx), $j$[{"type":"pack","name":"X","price_cents":100,"photos_allowance":2}]$j$::jsonb);
  insert into _res values ('8','Photographe : REFUSE','non_autorise',coalesce(r.raison,'ACCEPTE'), r.raison = 'non_autorise');
end $$;
set local request.jwt.claims = '{"sub":"2b0b7fae-33eb-45be-b393-707725ad9e7e","role":"authenticated"}';
do $$
declare r record;
begin
  select * into r from media_link_save((select album from _ctx), $j$[{"type":"pack","name":"X","price_cents":100,"photos_allowance":2}]$j$::jsonb);
  insert into _res values ('8','Community Manager : REFUSE','non_autorise',coalesce(r.raison,'ACCEPTE'), r.raison = 'non_autorise');
end $$;
set local request.jwt.claims = '{"sub":"b2d5b116-ab57-47fe-987e-22eb9dc41e83","role":"authenticated"}';
do $$
declare r record;
begin
  select * into r from media_link_save((select album from _ctx), $j$[{"type":"pack","name":"X","price_cents":100,"photos_allowance":2}]$j$::jsonb);
  insert into _res values ('8','Comptabilite : REFUSE','non_autorise',coalesce(r.raison,'ACCEPTE'), r.raison = 'non_autorise');
end $$;
set local request.jwt.claims = '{"sub":"97a7f67a-baa0-41e8-a891-7751aec9fd76","role":"authenticated"}';
do $$
declare r record;
begin
  select * into r from media_link_save((select album from _ctx), $j$[{"type":"album_complet","name":"Tout","price_cents":3000}]$j$::jsonb, (select lien from _ctx), 'Parents U12');
  insert into _res values ('8','Responsable Production : accepte','true',r.ok::text, r.ok);
end $$;
reset role;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
