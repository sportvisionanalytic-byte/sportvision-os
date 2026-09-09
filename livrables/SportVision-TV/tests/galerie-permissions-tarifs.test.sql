-- Qui a le droit de fixer un prix de galerie. Tout est annule a la fin (rollback).
begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;
grant all on _res to authenticated;
create temp table _ctx(album uuid) on commit drop;
grant all on _ctx to authenticated;

do $$
declare a uuid;
begin
  insert into media_albums (club_id, team_id, saison_id, title, status)
  values ('8be55101-0d61-4b27-8d7b-a4761547d88b','bee719f7-d735-4a0b-b070-0d20eb73e7ec',
          (select id from saisons where label='2026-2027'),'ZZ permissions','published') returning id into a;
  insert into media_album_links (album_id, slug, label) values (a, media_gallery_unique_slug('ZZ permissions'), 'Test');
  insert into _ctx values (a);
end $$;

-- ── 1. Qui peut fixer un prix ─────────────────────────────────────────────
set local role authenticated;
-- ── Les comptes de reference du test ──────────────────────────────────────
--
-- Ce fichier incarnait sept comptes codes en dur. Quatre d'entre eux ont disparu avec le
-- nettoyage des donnees de test du 09/09/2026, et la suite est tombee sur une violation de cle
-- etrangere. Elle fabrique desormais ceux qui manquent, comme cm-cloisonnement et
-- calendrier-unifie : crees ici, annules avec la transaction, plus rien a supprimer sous ses
-- pieds. `on conflict do nothing` laisse intacts les comptes reels encore presents.
--
-- Les roles sont ceux que le test attend, lisibles dans ses propres libelles :
--   3259409d Admin | 97a7f67a Responsable Production | 2b0b7fae CM | b4eab475 Secretariat
set local role postgres;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'zz-' || x.libelle || '@example.invalid', '', now(), now(), now()
  from (values ('3259409d-b69f-4780-877c-b75e0e8d663d','admin'),
               ('97a7f67a-baa0-41e8-a891-7751aec9fd76','prod'),
               ('2b0b7fae-33eb-45be-b393-707725ad9e7e','cm'),
               ('b4eab475-3293-4804-8bf6-8b27a15d410c','sec')) as x(id, libelle)
on conflict (id) do nothing;

insert into profiles (id, role, prenom, nom, email)
select x.id::uuid, x.libelle, 'ZZ', x.libelle, 'zz-' || x.libelle || '@example.invalid'
  from (values ('3259409d-b69f-4780-877c-b75e0e8d663d','admin'),
               ('97a7f67a-baa0-41e8-a891-7751aec9fd76','prod'),
               ('2b0b7fae-33eb-45be-b393-707725ad9e7e','cm'),
               ('b4eab475-3293-4804-8bf6-8b27a15d410c','sec')) as x(id, libelle)
on conflict (id) do nothing;
set local role authenticated;


set local request.jwt.claims = '{"sub":"b4ff9a0e-9ae6-43a5-bddf-412fdf7d2cca","role":"authenticated"}';
insert into _res select '1', 'Fondateur (Fouka) : peut fixer un prix', 'true', media_pricing_staff()::text, media_pricing_staff();

set local request.jwt.claims = '{"sub":"3259409d-b69f-4780-877c-b75e0e8d663d","role":"authenticated"}';
insert into _res select '1', 'Admin : peut fixer un prix', 'true', media_pricing_staff()::text, media_pricing_staff();

set local request.jwt.claims = '{"sub":"97a7f67a-baa0-41e8-a891-7751aec9fd76","role":"authenticated"}';
insert into _res select '1', 'Responsable Production : peut fixer un prix', 'true', media_pricing_staff()::text, media_pricing_staff();

set local request.jwt.claims = '{"sub":"0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2","role":"authenticated"}';
insert into _res select '1', 'Photographe : REFUSE', 'false', media_pricing_staff()::text, not media_pricing_staff();
set local request.jwt.claims = '{"sub":"2b0b7fae-33eb-45be-b393-707725ad9e7e","role":"authenticated"}';
insert into _res select '1', 'Community Manager : REFUSE', 'false', media_pricing_staff()::text, not media_pricing_staff();

set local request.jwt.claims = '{"sub":"b2d5b116-ab57-47fe-987e-22eb9dc41e83","role":"authenticated"}';
insert into _res select '1', 'Comptabilite : REFUSE', 'false', media_pricing_staff()::text, not media_pricing_staff();

-- ── 2. Le secretariat : c'est le changement demande ────────────────────────
set local request.jwt.claims = '{"sub":"b4eab475-3293-4804-8bf6-8b27a15d410c","role":"authenticated"}';
insert into _res select '2', 'Secretariat : NE PEUT PLUS fixer un prix', 'false', media_pricing_staff()::text, not media_pricing_staff();

-- ── 3. Ses autres droits n'ont pas bouge ───────────────────────────────────
insert into _res select '3', 'Secretariat : media_staff_write inchange', 'true', media_staff_write()::text, media_staff_write();
insert into _res select '3', 'Secretariat : media_upload_staff inchange', 'true', media_upload_staff()::text, media_upload_staff();
insert into _res select '3', 'Secretariat : media_commerce_staff inchange', 'true', media_commerce_staff()::text, media_commerce_staff();

-- ── 4. RLS reelle sur media_album_links ────────────────────────────────────
do $$
declare v_a uuid; v_n integer; v_upd integer;
begin
  select album into v_a from _ctx;

  select count(*) into v_n from media_album_links where album_id = v_a;
  insert into _res values ('4', 'Secretariat : peut LIRE le lien (pour l envoyer)', '1', v_n::text, v_n = 1);

  update media_album_links set price_override_cents = 100 where album_id = v_a;
  get diagnostics v_upd = row_count;
  insert into _res values ('4', 'Secretariat : ne peut PAS changer le prix', '0 ligne', v_upd||' ligne', v_upd = 0);

  begin
    insert into media_album_links (album_id, slug) values (v_a, 'zz-sec-tentative');
    insert into _res values ('4', 'Secretariat : ne peut PAS creer un lien', 'refuse', 'ACCEPTE', false);
  exception when insufficient_privilege then
    insert into _res values ('4', 'Secretariat : ne peut PAS creer un lien', 'refuse', 'refuse', true);
  end;

  begin
    delete from media_album_links where album_id = v_a;
    get diagnostics v_upd = row_count;
    insert into _res values ('4', 'Secretariat : ne peut PAS supprimer un lien', '0 ligne', v_upd||' ligne', v_upd = 0);
  exception when insufficient_privilege then
    insert into _res values ('4', 'Secretariat : ne peut PAS supprimer un lien', '0 ligne', 'refuse', true);
  end;
end $$;

-- ── 5. Le photographe garde son acces a l'album, il ne voit juste pas les prix
set local request.jwt.claims = '{"sub":"0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2","role":"authenticated"}';
insert into _res select '5', 'Photographe : media_upload_staff inchange', 'true', media_upload_staff()::text, media_upload_staff();
do $$
declare v_n integer; v_upd integer;
begin
  select count(*) into v_n from media_album_links where album_id = (select album from _ctx);
  insert into _res values ('5', 'Photographe : voit le lien de son album', '1', v_n::text, v_n = 1);
  update media_album_links set price_override_cents = 100 where album_id = (select album from _ctx);
  get diagnostics v_upd = row_count;
  insert into _res values ('5', 'Photographe : ne peut PAS changer le prix', '0 ligne', v_upd||' ligne', v_upd = 0);
end $$;

-- ── 6. Le CM n'a rien a faire ici du tout ──────────────────────────────────
set local request.jwt.claims = '{"sub":"2b0b7fae-33eb-45be-b393-707725ad9e7e","role":"authenticated"}';
do $$
declare v_n integer;
begin
  select count(*) into v_n from media_album_links where album_id = (select album from _ctx);
  insert into _res values ('6', 'CM : ne voit meme pas le lien', '0', v_n::text, v_n = 0);
end $$;

reset role;

-- ── 7. Responsable de pole : on promeut le secretaire de test ──────────────
insert into pole_affectations (pole_id, user_id, role_pole, actif)
values ('086f7973-fd15-413d-8457-1afa3cc71643','b4eab475-3293-4804-8bf6-8b27a15d410c','responsable', true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"b4eab475-3293-4804-8bf6-8b27a15d410c","role":"authenticated"}';
insert into _res select '7', 'Responsable de pole actif : peut fixer un prix', 'true', media_pricing_staff()::text, media_pricing_staff();
do $$
declare v_upd integer;
begin
  update media_album_links set price_override_cents = 1500 where album_id = (select album from _ctx);
  get diagnostics v_upd = row_count;
  insert into _res values ('7', 'Responsable de pole : peut vraiment changer le prix (RLS)', '1 ligne', v_upd||' ligne', v_upd = 1);
end $$;
reset role;

-- Retire de son pole : il reperd le droit immediatement.
update pole_affectations set actif = false
where user_id = 'b4eab475-3293-4804-8bf6-8b27a15d410c' and role_pole = 'responsable';

set local role authenticated;
set local request.jwt.claims = '{"sub":"b4eab475-3293-4804-8bf6-8b27a15d410c","role":"authenticated"}';
insert into _res select '7', 'Responsable retire de son pole : REFUSE', 'false', media_pricing_staff()::text, not media_pricing_staff();
reset role;

-- Simple membre d'un pole actif : ce n'est pas un responsable, il n'a rien de plus.
update pole_affectations set role_pole = 'membre', actif = true
where user_id = 'b4eab475-3293-4804-8bf6-8b27a15d410c';

set local role authenticated;
set local request.jwt.claims = '{"sub":"b4eab475-3293-4804-8bf6-8b27a15d410c","role":"authenticated"}';
insert into _res select '7', 'Simple membre d un pole actif : REFUSE', 'false', media_pricing_staff()::text, not media_pricing_staff();
reset role;

-- ── 8. Le chiffre d'affaires par lien reste reserve ────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"b4eab475-3293-4804-8bf6-8b27a15d410c","role":"authenticated"}';
do $$
declare v_n integer;
begin
  begin
    select count(*) into v_n from media_album_links_stats((select album from _ctx));
    insert into _res values ('8', 'Secretariat : pas de CA par lien', 'refuse ou 0', v_n::text, v_n = 0);
  exception when others then
    insert into _res values ('8', 'Secretariat : pas de CA par lien', 'refuse ou 0', 'refuse', true);
  end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b4ff9a0e-9ae6-43a5-bddf-412fdf7d2cca","role":"authenticated"}';
do $$
declare v_n integer;
begin
  select count(*) into v_n from media_album_links_stats((select album from _ctx));
  insert into _res values ('8', 'Fondateur : voit le CA par lien', '1', v_n::text, v_n = 1);
end $$;
reset role;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
