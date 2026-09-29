-- Qui a le droit de fixer un prix de galerie. Tout est annule a la fin (rollback).
--
-- ATTENTES REALIGNEES LE 28/09/2026 SUR LA DECISION DU 07/09. Ce test affirmait que le Secretariat
-- ne peut PAS fixer un prix — la decision de la migration galeries-v7. Fouka l'a inversee le 07/09
-- au soir, et la migration galeries-v14 l'ecrit noir sur blanc : « Le SECRETARIAT retrouve le droit
-- de fixer les prix (decision inverse de la v7). Fouka a tranche : c'est lui qui prepare les liens
-- au quotidien. » La production applique la v14 depuis. Le test, lui, est reste sur la v7 pendant
-- trois semaines, et personne ne l'a vu parce que le lanceur ne lisait pas les verdicts renvoyes.
--
-- Ce qui n'a PAS change, et que ce test continue de tenir : photographes, CM et comptabilite ne
-- fixent aucun prix. Ceux-la sont les bornes qui comptent.
begin;

-- DÉCOR MANQUANT, AJOUTÉ LE 26/09/2026. Ce test tenait pour acquis un club et une équipe dont il
-- codait l'identifiant en dur. Ce club a été supprimé de la production, et le test a cessé de
-- s'exécuter sans que personne ne le voie : il levait une violation de clé étrangère, pas un ROUGE.
-- Un test qui ne s'exécute pas ne prouve rien, et 26 tests étaient dans cet état. Il crée
-- désormais son propre décor, et le `rollback` final l'efface comme le reste.
insert into clubs (id, nom) values ('8be55101-0d61-4b27-8d7b-a4761547d88b', 'ZZ Club de test')
  on conflict (id) do nothing;
insert into club_teams (id, club_id, name)
  values ('bee719f7-d735-4a0b-b070-0d20eb73e7ec', '8be55101-0d61-4b27-8d7b-a4761547d88b', 'ZZ Equipe de test')
  on conflict (id) do nothing;

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
  -- `pole_id` AJOUTE LE 28/09/2026 : depuis la v318, les policies de media_album_links appellent
  -- media_pricing_staff_album, qui borne le responsable de pole au pole DE LA GALERIE. Un album sans
  -- pole n'est tarifable que par admin / production / secretariat, donc la section 7 ne pouvait pas
  -- mesurer le droit d'un responsable de pole.
  update media_albums set pole_id = (select id from poles where nom = 'Football') where id = a;
  -- UNE OFFRE, AJOUTEE LE 28/09/2026 : media_album_links_stats fait un `cross join lateral` sur
  -- l'offre du lien, donc un lien SANS offre disparait entierement de l'ecran des statistiques. Le
  -- test mesurait cette absence au lieu du droit de lire le chiffre d'affaires.
  insert into media_album_links (album_id, slug, label) values (a, media_gallery_unique_slug('ZZ permissions'), 'Test');
  insert into media_album_link_offers (link_id, offer_type, label, price_override_cents, photos_allowance, display_order)
  select id, 'pack', 'ZZ 5 photos', 600, 5, 1 from media_album_links where album_id = a;
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
-- Decision du 07/09 (galeries-v14), inverse de la v7 : le Secretariat prepare les liens, donc il
-- en fixe les prix.
insert into _res select '2', 'Secretariat : peut fixer un prix (decision du 07/09)', 'true', media_pricing_staff()::text, media_pricing_staff();

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
  insert into _res values ('4', 'Secretariat : peut changer le prix', '1 ligne', v_upd||' ligne', v_upd = 1);

  begin
    insert into media_album_links (album_id, slug) values (v_a, 'zz-sec-tentative');
    insert into _res values ('4', 'Secretariat : peut creer un lien', 'ACCEPTE', 'ACCEPTE', true);
  exception when insufficient_privilege then
    insert into _res values ('4', 'Secretariat : peut creer un lien', 'ACCEPTE', 'refuse', false);
  end;

  -- LA SUPPRESSION PORTE SUR LE LIEN JETABLE QU'ON VIENT DE CREER, ET NON SUR CELUI DE L'ALBUM
  -- (28/09/2026). Tant que le Secretariat etait censé se voir refuser la suppression, effacer
  -- `where album_id = v_a` etait sans consequence : il ne se passait rien. Depuis la decision du
  -- 07/09 il en a le droit, donc cette ligne emportait le lien de l'album — et les sections 5, 7 et
  -- 8 mesuraient ensuite un album SANS lien, ce qui rend « 0 » a toutes leurs questions et ressemble
  -- a un droit refuse. Deux faux rouges venaient de la.
  begin
    delete from media_album_links where slug = 'zz-sec-tentative';
    get diagnostics v_upd = row_count;
    insert into _res values ('4', 'Secretariat : peut supprimer un lien', 'au moins 1 ligne', v_upd||' ligne', v_upd >= 1);
  exception when insufficient_privilege then
    insert into _res values ('4', 'Secretariat : peut supprimer un lien', 'au moins 1 ligne', 'refuse', false);
  end;
end $$;

-- ── 5. Le photographe garde son acces a l'album, il ne voit juste pas les prix
set local request.jwt.claims = '{"sub":"0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2","role":"authenticated"}';
insert into _res select '5', 'Photographe : media_upload_staff inchange', 'true', media_upload_staff()::text, media_upload_staff();
do $$
declare v_n integer; v_upd integer;
begin
  select count(*) into v_n from media_album_links where album_id = (select album from _ctx);
  -- ATTENTE CORRIGEE LE 28/09/2026 : la policy de lecture de media_album_links est reservee a qui
  -- fixe les prix, et la migration galeries-v14 le dit sans ambiguite — « Volontairement PAS les
  -- photographes (ils deposent, ils ne vendent pas) ». Le photographe ne voit donc pas le lien, et
  -- ce test affirmait le contraire depuis toujours.
  insert into _res values ('5', 'Photographe : ne voit pas le lien de vente', '0', v_n::text, v_n = 0);
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

-- ── 7. Responsable de pole : on promeut le CM de test ─────────────────────
--
-- LE COMPTE A CHANGE LE 28/09/2026, et c'etait la cause de deux faux rouges alarmants. Cette section
-- promouvait le SECRETAIRE au rang de responsable de pole. Or depuis la decision du 07/09 le
-- secretariat a DEJA le droit de fixer les prix par son role : « responsable retire de son pole » et
-- « simple membre d'un pole » repondaient donc toujours OUI, et le test semblait annoncer qu'un
-- simple membre pouvait tarifer. Il ne mesurait plus rien du tout.
--
-- Le CM, lui, n'a aucun droit tarifaire par son role. Ce qu'il obtient ici, il l'obtient par son
-- pole et par lui seul : c'est la seule facon d'isoler la regle qu'on veut mesurer.
insert into pole_affectations (pole_id, user_id, role_pole, actif)
values ((select id from poles where nom = 'Football'),'2b0b7fae-33eb-45be-b393-707725ad9e7e','responsable', true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"2b0b7fae-33eb-45be-b393-707725ad9e7e","role":"authenticated"}';
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
where user_id = '2b0b7fae-33eb-45be-b393-707725ad9e7e' and role_pole = 'responsable';

set local role authenticated;
set local request.jwt.claims = '{"sub":"2b0b7fae-33eb-45be-b393-707725ad9e7e","role":"authenticated"}';
insert into _res select '7', 'Responsable retire de son pole : REFUSE', 'false', media_pricing_staff()::text, not media_pricing_staff();
reset role;

-- Simple membre d'un pole actif : ce n'est pas un responsable, il n'a rien de plus.
update pole_affectations set role_pole = 'membre', actif = true
where user_id = '2b0b7fae-33eb-45be-b393-707725ad9e7e';

set local role authenticated;
set local request.jwt.claims = '{"sub":"2b0b7fae-33eb-45be-b393-707725ad9e7e","role":"authenticated"}';
insert into _res select '7', 'Simple membre d un pole actif : REFUSE', 'false', media_pricing_staff()::text, not media_pricing_staff();
reset role;

-- ── 8. Le chiffre d'affaires par lien reste reserve ────────────────────────
--
-- ARBITRE PAR FOUKA LE 29/09/2026 : « Non, le CA reste reserve. »
--
-- La decision du 07/09 portait sur le droit de FIXER les prix : « c'est lui qui prepare les liens au
-- quotidien ». Elle ne disait rien du droit de VOIR L'ARGENT. Mais les deux passaient par la meme
-- fonction, `media_pricing_staff()`, donc le Secretariat avait gagne l'acces au chiffre d'affaires
-- par lien en meme temps, sans que ce soit demande ni examine. Ce test tenait son rouge en attente
-- plutot que de graver un choix que personne n'avait fait.
--
-- CE QUE LA CORRECTION FAIT (v357), ET CE QU'ELLE NE FAIT PAS. L'attente d'origine de ce test etait
-- « aucune ligne ». C'etait trop large : cette fonction alimente l'ecran de GESTION des liens
-- — libelles, offres, prix, activation, vues — c'est-a-dire le materiel de travail que la decision
-- du 07/09 confie justement au Secretariat. Zero ligne, c'est un ecran vide, et on aurait echange
-- une fuite de donnees contre un blocage de travail (la faute symetrique, celle du 11/09).
--
-- Il voit donc ses liens, et l'ARGENT est masque : `orders_count` et `revenue_cents` reviennent
-- null. Les deux ensemble, parce que masquer le seul chiffre d'affaires ne sert a rien quand le
-- nombre de commandes multiplie par le prix le redonne. C'est ce que ce test verifie desormais.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b4eab475-3293-4804-8bf6-8b27a15d410c","role":"authenticated"}';
do $$
declare v_n integer;
begin
  begin
    -- Il garde ses liens : un ecran vide serait l'autre faute.
    select count(*) into v_n from media_album_links_stats((select album from _ctx));
    insert into _res values ('8', 'Secretariat : il voit bien ses liens', 'au moins 1',
                             v_n::text, v_n >= 1);
    -- Mais pas un centime : les deux colonnes d'argent sont null.
    select count(*) into v_n from media_album_links_stats((select album from _ctx))
     where revenue_cents is not null or orders_count is not null;
    insert into _res values ('8', 'Secretariat : aucun montant ni nombre de commandes', '0',
                             v_n::text, v_n = 0);
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
