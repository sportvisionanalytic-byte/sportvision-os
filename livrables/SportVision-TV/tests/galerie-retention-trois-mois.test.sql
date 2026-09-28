-- Les galeries vendues par lien s'archivent à 3 mois et se suppriment à 4 (v321, 28/09/2026).
--
-- Décision de Fouka : « archivé le 3e mois, supprimer pour de bon, libérer le 4e mois. Ça pour les
-- galeries pas en Full Communication, pour les galeries non rattachées à un club. Les clubs eux
-- gardent les photos toute l'année, et ceux qui ont le Pass Photo. » Départ : la date de publication.
--
-- CE TEST TIENT AUTANT LES REFUS QUE LES ACTIONS, et c'est le sens de la moitié de ses lignes : une
-- règle qui efface ne vaut que par ce qu'elle refuse d'effacer. Un archivage se rattrape, une
-- suppression non.
--
-- Décor fictif, toutes les dates sont fabriquées, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ca110000-0000-0000-0000-000000000001','zz-retention-admin@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, role, actif) values ('ca110000-0000-0000-0000-000000000001','admin',true)
on conflict (id) do update set role='admin', actif=true;

insert into clubs (id, nom, plan) values ('ca110000-0000-0000-0000-0000000000c1','ZZ Club Retention','performance');

-- Six galeries, chacune pour une raison précise.
insert into media_albums (id, club_id, title, status, published_at, archived_at) values
  -- A : sans club, publiée il y a 4 mois, rien ne la protège → doit être archivée.
  ('ca110000-0000-0000-0000-0000000000a1', null, 'ZZ A vendue par lien, 4 mois', 'published', now() - interval '4 months', null),
  -- B : sans club, 4 mois, mais quelqu'un a payé → protégée.
  ('ca110000-0000-0000-0000-0000000000a2', null, 'ZZ B payee par une famille', 'published', now() - interval '4 months', null),
  -- C : rattachée à un club, 4 mois → le club garde ses photos toute l'année.
  ('ca110000-0000-0000-0000-0000000000a3', 'ca110000-0000-0000-0000-0000000000c1', 'ZZ C du club', 'published', now() - interval '4 months', null),
  -- D : sans club, publiée il y a 1 mois → pas encore mûre.
  ('ca110000-0000-0000-0000-0000000000a4', null, 'ZZ D recente', 'published', now() - interval '1 month', null),
  -- E : déjà archivée il y a 2 mois, rien ne la protège → mûre pour la suppression.
  ('ca110000-0000-0000-0000-0000000000a5', null, 'ZZ E archivee depuis 2 mois', 'archived', now() - interval '6 months', now() - interval '2 months'),
  -- F : archivée hier → beaucoup trop tôt pour effacer.
  ('ca110000-0000-0000-0000-0000000000a6', null, 'ZZ F archivee hier', 'archived', now() - interval '4 months', now() - interval '1 day'),
  -- G : archivée depuis 2 mois ET payée. Elle passe toutes les gardes de DATE, et ne doit être
  --     arrêtée que par le paiement — c'est la seule façon de mesurer cette garde-là seule.
  ('ca110000-0000-0000-0000-0000000000a7', null, 'ZZ G archivee mais payee', 'archived', now() - interval '6 months', now() - interval '2 months');

insert into media_assets (id, album_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked) values
  ('ca110000-0000-0000-0000-0000000000f1','ca110000-0000-0000-0000-0000000000a5','photo','sportvision-media-prive','zz/e1.jpg','zz/e1-p.webp','zz/e1-t.webp','ready',1,true),
  ('ca110000-0000-0000-0000-0000000000f2','ca110000-0000-0000-0000-0000000000a5','photo','sportvision-media-prive','zz/e2.jpg','zz/e2-p.webp','zz/e2-t.webp','ready',2,true),
  ('ca110000-0000-0000-0000-0000000000f3','ca110000-0000-0000-0000-0000000000a2','photo','sportvision-media-prive','zz/b1.jpg','zz/b1-p.webp','zz/b1-t.webp','ready',1,true);

-- L'achat qui protège la galerie B : payé, et le droit de télécharger n'a pas de date de fin.
insert into media_orders (id, album_id, guest_email, amount_cents, currency, status, paid_at)
values ('ca110000-0000-0000-0000-0000000000d1','ca110000-0000-0000-0000-0000000000a2','zz-retention@example.invalid',1000,'eur','paid', now() - interval '3 months');
insert into media_download_grants (order_id, email) values ('ca110000-0000-0000-0000-0000000000d1','zz-retention@example.invalid');
-- L'achat qui protège la galerie G, celle qui est archivée depuis assez longtemps.
insert into media_orders (id, album_id, guest_email, amount_cents, currency, status, paid_at)
values ('ca110000-0000-0000-0000-0000000000d2','ca110000-0000-0000-0000-0000000000a7','zz-retention-g@example.invalid',1000,'eur','paid', now() - interval '5 months');
insert into media_download_grants (order_id, email) values ('ca110000-0000-0000-0000-0000000000d2','zz-retention-g@example.invalid');

-- Un lien et une offre sur la galerie E : la suppression doit les emporter aussi.
insert into media_album_links (id, album_id, slug, label) values
  ('ca110000-0000-0000-0000-0000000000e1','ca110000-0000-0000-0000-0000000000a5','zz-retention-slug','ZZ');
insert into media_album_link_offers (link_id, offer_type, label, price_override_cents, photos_allowance, display_order)
values ('ca110000-0000-0000-0000-0000000000e1','pack','ZZ 5 photos',600,5,1);

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant all on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(c text, a text, o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (c, a, o); $$;

-- ── 1. L'archivage ──────────────────────────────────────────────────────────────────────────────
create temp table archivees on commit drop as select * from media_retention_archiver();

select pg_temp.note('la galerie sans club de 4 mois est archivee', 'oui',
  case when exists (select 1 from archivees where album_id='ca110000-0000-0000-0000-0000000000a1') then 'oui' else 'NON' end);
select pg_temp.note('celle qu''une famille a payee ne l''est PAS', 'non',
  case when exists (select 1 from archivees where album_id='ca110000-0000-0000-0000-0000000000a2') then 'OUI' else 'non' end);
select pg_temp.note('celle d''un club ne l''est PAS : gardee toute l''annee', 'non',
  case when exists (select 1 from archivees where album_id='ca110000-0000-0000-0000-0000000000a3') then 'OUI' else 'non' end);
select pg_temp.note('celle publiee il y a un mois ne l''est pas encore', 'non',
  case when exists (select 1 from archivees where album_id='ca110000-0000-0000-0000-0000000000a4') then 'OUI' else 'non' end);
select pg_temp.note('la galerie archivee porte bien sa date d''archivage', 'oui',
  (select case when archived_at is not null and status='archived' then 'oui' else 'NON' end
     from media_albums where id='ca110000-0000-0000-0000-0000000000a1'));

-- ── 2. Ce qui est mûr pour la suppression, et les fichiers à effacer ────────────────────────────
select pg_temp.note('la galerie archivee depuis 2 mois est mure', 'oui',
  case when exists (select 1 from media_retention_a_supprimer() where album_id='ca110000-0000-0000-0000-0000000000a5') then 'oui' else 'NON' end);
select pg_temp.note('celle archivee hier ne l''est pas', 'non',
  case when exists (select 1 from media_retention_a_supprimer() where album_id='ca110000-0000-0000-0000-0000000000a6') then 'OUI' else 'non' end);
select pg_temp.note('une galerie payee n''est jamais proposee a la suppression', 'non',
  case when exists (select 1 from media_retention_a_supprimer() where album_id='ca110000-0000-0000-0000-0000000000a7') then 'OUI' else 'non' end);
select pg_temp.note('elle rend les 6 chemins de fichiers de ses 2 photos', '6',
  (select coalesce(cardinality(chemins),0)::text from media_retention_a_supprimer() where album_id='ca110000-0000-0000-0000-0000000000a5'));

-- ── 3. L'effacement, et surtout ses refus ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca110000-0000-0000-0000-000000000001","role":"authenticated"}';

select pg_temp.note('effacer une galerie archivee hier : refuse', 'archivee depuis moins d''un mois',
  (media_retention_effacer('ca110000-0000-0000-0000-0000000000a6')->>'raison'));
select pg_temp.note('effacer une galerie de club : refuse', 'rattachee a un club : gardee toute l''annee',
  (media_retention_effacer('ca110000-0000-0000-0000-0000000000a3')->>'raison'));
-- La galerie G a passe toutes les gardes de date : seul le paiement peut encore l'arreter. La
-- galerie B, elle, n'a jamais ete archivee justement PARCE QU'elle est protegee — la refuser pour
-- « pas archivee » serait exact mais ne mesurerait pas la garde qu'on veut tenir.
select pg_temp.note('effacer une galerie archivee mais payee : refuse', 'un droit paye court encore',
  (media_retention_effacer('ca110000-0000-0000-0000-0000000000a7')->>'raison'));
select pg_temp.note('effacer celle qui est mure : accepte', '2',
  (media_retention_effacer('ca110000-0000-0000-0000-0000000000a5')->>'photos'));

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select pg_temp.note('ses photos ont disparu', '0',
  (select count(*)::text from media_assets where album_id='ca110000-0000-0000-0000-0000000000a5'));
select pg_temp.note('son lien et son offre aussi', '0',
  (select (count(*) + (select count(*) from media_album_link_offers where link_id='ca110000-0000-0000-0000-0000000000e1'))::text
     from media_album_links where album_id='ca110000-0000-0000-0000-0000000000a5'));
select pg_temp.note('la galerie elle-meme a disparu', '0',
  (select count(*)::text from media_albums where id='ca110000-0000-0000-0000-0000000000a5'));
select pg_temp.note('et la galerie payee est toujours la, intacte', 'ZZ B payee par une famille',
  coalesce((select title from media_albums where id='ca110000-0000-0000-0000-0000000000a2'), 'DISPARUE'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
