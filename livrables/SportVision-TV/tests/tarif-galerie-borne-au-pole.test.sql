-- Le tarif d'une galerie se change dans SON pôle, et nulle part ailleurs (28/09/2026).
--
-- LE DÉFAUT MESURÉ. Depuis le 07/09, deux règles portent le même nom à une lettre près :
--
--   media_pricing_staff()             admin / production / secrétariat, OU responsable de N'IMPORTE
--                                     quel pôle actif
--   media_pricing_staff_album(album)  les mêmes rôles, mais le responsable de pôle seulement sur le
--                                     pôle DE CETTE GALERIE — « un album explicitement rattaché à
--                                     Basket ne doit pas rester accessible au responsable Football »
--                                     (commentaire de la migration galeries-v18)
--
-- Les RPC (`media_link_save`) appellent la seconde. Les NEUF policies RLS de `media_album_links` et
-- `media_album_link_offers` appelaient la PREMIÈRE. Le chemin par la table, celui que PostgREST
-- expose, n'était donc borné par aucun pôle.
--
-- Exploité en réel avant correction, avec un compte `role='cm'` (aucun droit tarifaire) responsable
-- du seul pôle Basket, sur une galerie du pôle Football :
--   media_pricing_staff_album(galerie)  →  false        la fonction refuse
--   update media_album_links ...        →  1 ligne      la table accepte, 10 € devient 99,99 €
--
-- C'est la quatrième fois en une journée qu'une règle métier recopiée à deux endroits finit par
-- diverger. Ici les deux copies ne divergent même pas par accident : la bonne existait, et les
-- policies ne l'ont jamais appelée.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Un responsable de pôle, et RIEN d'autre : `role='cm'` ne donne aucun droit sur les tarifs, donc
-- ce que ce compte obtient, il l'obtient par son pôle et par lui seul.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ac000000-0000-0000-0000-000000000001','zz-pole-basket@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, role, actif) values ('ac000000-0000-0000-0000-000000000001','cm',true)
on conflict (id) do update set role='cm', actif=true;

insert into poles (id, nom, slug, sport) values
  ('ac000000-0000-0000-0000-0000000000f1','ZZ Pole Football','zz-pole-football','football'),
  ('ac000000-0000-0000-0000-0000000000f2','ZZ Pole Basket','zz-pole-basket','basket')
on conflict (id) do nothing;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
values ('ac000000-0000-0000-0000-0000000000f2','ac000000-0000-0000-0000-000000000001','responsable',true);

-- La galerie, son lien et une offre : tout appartient au pôle Football.
insert into clubs (id, nom, plan) values ('ac000000-0000-0000-0000-0000000000c1','ZZ Club Tarif','performance');
insert into media_albums (id, club_id, pole_id, title, status) values
  ('ac000000-0000-0000-0000-0000000000b1','ac000000-0000-0000-0000-0000000000c1',
   'ac000000-0000-0000-0000-0000000000f1','ZZ Galerie du pole Football','published');
insert into media_album_links (id, album_id, slug, label, price_override_cents) values
  ('ac000000-0000-0000-0000-0000000000e1','ac000000-0000-0000-0000-0000000000b1','zz-tarif-pole-slug','ZZ Parents',1000);
insert into media_album_link_offers (id, link_id, offer_type, label, price_override_cents, photos_allowance, display_order) values
  ('ac000000-0000-0000-0000-0000000000d1','ac000000-0000-0000-0000-0000000000e1','pack','5 photos',600,5,1);

create temp table v(n serial, controle text, attendu text, obtenu text, ok boolean) on commit drop;
grant all on v to authenticated;
grant usage on sequence v_n_seq to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"ac000000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into v (controle, attendu, obtenu, ok)
select 'la regle bornee au pole refuse ce responsable', 'false',
  media_pricing_staff_album('ac000000-0000-0000-0000-0000000000b1')::text,
  media_pricing_staff_album('ac000000-0000-0000-0000-0000000000b1') = false;

do $$
declare n integer;
begin
  update media_album_links set price_override_cents = 9999
   where id = 'ac000000-0000-0000-0000-0000000000e1';
  get diagnostics n = row_count;
  insert into v (controle, attendu, obtenu, ok)
  values ('il ne change pas le tarif du LIEN par la table', '0 ligne', n||' ligne', n = 0);

  update media_album_link_offers set price_override_cents = 1
   where id = 'ac000000-0000-0000-0000-0000000000d1';
  get diagnostics n = row_count;
  insert into v (controle, attendu, obtenu, ok)
  values ('ni le tarif d''une OFFRE de ce lien', '0 ligne', n||' ligne', n = 0);

  delete from media_album_link_offers where id = 'ac000000-0000-0000-0000-0000000000d1';
  get diagnostics n = row_count;
  insert into v (controle, attendu, obtenu, ok)
  values ('il ne supprime pas une offre de ce lien', '0 ligne', n||' ligne', n = 0);

  begin
    insert into media_album_link_offers (link_id, offer_type, label, price_override_cents, photos_allowance, display_order)
    values ('ac000000-0000-0000-0000-0000000000e1','pack','ZZ offre pirate',1,1,9);
    insert into v (controle, attendu, obtenu, ok)
    values ('il n''ajoute pas une offre a ce lien', 'refuse', 'ACCEPTE', false);
  exception when others then
    insert into v (controle, attendu, obtenu, ok)
    values ('il n''ajoute pas une offre a ce lien', 'refuse', 'refuse', true);
  end;
end $$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into v (controle, attendu, obtenu, ok)
select 'et le tarif en base n''a pas bouge', '1000',
  price_override_cents::text, price_override_cents = 1000
  from media_album_links where id = 'ac000000-0000-0000-0000-0000000000e1';

-- VITALITÉ. La borne ne doit pas tout fermer : le responsable du pôle DE LA GALERIE, lui, passe.
-- Sans ce contrôle, refermer les policies pourrait bloquer le travail légitime sans qu'on le voie.
insert into pole_affectations (pole_id, user_id, role_pole, actif)
values ('ac000000-0000-0000-0000-0000000000f1','ac000000-0000-0000-0000-000000000001','responsable',true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"ac000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n integer;
begin
  update media_album_links set price_override_cents = 1500
   where id = 'ac000000-0000-0000-0000-0000000000e1';
  get diagnostics n = row_count;
  insert into v (controle, attendu, obtenu, ok)
  values ('le responsable du pole DE LA GALERIE change bien le tarif', '1 ligne', n||' ligne', n = 1);
end $$;
reset role;

select case when ok then '✅' else '❌' end ok, controle, attendu, obtenu from v order by n;
rollback;
