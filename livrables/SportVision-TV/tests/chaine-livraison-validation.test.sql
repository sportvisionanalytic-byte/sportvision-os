-- La chaîne complète : l'opérateur livre ce qu'il a, la Production valide, l'opérateur est payé
-- et gagne ses XP (v206/v207, 13/09/2026).
--
-- Le process décrit par Fouka : le photographe reçoit sa mission, déclare son arrivée, fait la
-- prestation, dépose ses liens — photo, vidéo, galerie — coche « sans objet » ce qui n'existe pas,
-- et envoie. Son travail est fini. La Production reçoit, vérifie les liens, et valide. C'est CETTE
-- validation, et elle seule, qui débloque la rémunération et les XP de l'opérateur.
--
-- Ce que ce test tient pour vrai : une mission photo_video sans vidéo ni galerie se clôture quand
-- c'est déclaré, une mission sans AUCUN lien déposé ne se clôture pas, et la validation donne
-- la rémunération et les XP, une seule fois. Décor fictif, tout est annulé.
--
-- 21/09/2026 (v240) : la couverture n'impose plus aucun livrable nommé. C'est l'opérateur qui
-- décide combien de liens il dépose. Le seul plancher qui reste : au moins un lien, sinon la
-- Production n'a rien à vérifier.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee44cc00-0000-0000-0000-000000000001','zz-photographe-chaine@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif)
values ('ee44cc00-0000-0000-0000-000000000001','ZZPhotographe','Chaine','photo',true)
on conflict (id) do update set role='photo', actif=true;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation, type_client) values ('ZZ Client Chaine (test)','client','particulier') returning id),
       pres as (insert into prestations (client_id, type_prestation, statut, couverture, date_prestation)
                select id, 'match_photo', 'prêt_validation', 'photo_video', current_date - 1 from cli returning id),
       eq as (insert into prestations_equipe (prestation_id, collaborateur_id, statut, remuneration)
              select (select id from pres), 'ee44cc00-0000-0000-0000-000000000001', 'acceptée', 80 returning id),
       lien as (insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, transfert_confirme)
                select (select id from pres), 'ZZ Photos traitées', 'https://exemple.invalid/photos', 'final', 'photo', 'valide', true
                returning id),
       suivi as (insert into mission_suivi_operateur (prestation_id, collaborateur_id, prestation_terminee_at, fichiers_securises_at, livrables_non_fournis)
                 select (select id from pres), 'ee44cc00-0000-0000-0000-000000000001', now(), now(),
                        '{"montage":{"motif":"Pas de captation vidéo","at":"2026-09-13T00:10:00Z"},
                          "rushs":{"motif":"Pas de captation vidéo","at":"2026-09-13T00:10:00Z"},
                          "galerie":{"motif":"Livraison par lien direct, pas de galerie","at":"2026-09-13T00:10:00Z"}}'::jsonb
                 returning id)
  select (select id from pres) prestation;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

select pg_temp.note('une mission sans video ni galerie, declarees, est cloturable', 'rien ne manque',
  coalesce(nullif(array_to_string(mission_cloture_manquant((select prestation from ctx)), ' ; '), ''), 'rien ne manque'));

-- La Production valide : prêt_validation → livrée → clôturée.
update prestations set statut = 'livrée' where id = (select prestation from ctx);
update prestations set statut = 'clôturée' where id = (select prestation from ctx);

select pg_temp.note('l''operateur gagne ses XP', '50',
  coalesce((select sum(x.montant)::text from xp_events x, ctx
             where x.source_id = ctx.prestation and x.collaborateur_id = 'ee44cc00-0000-0000-0000-000000000001'), 'AUCUN'));

-- Un rejeu de la validation ne doit pas doubler les XP.
update prestations set statut = 'clôturée' where id = (select prestation from ctx);
select pg_temp.note('et une seule fois', '1',
  (select count(*)::text from xp_events x, ctx where x.source_id = ctx.prestation));

-- Une mission sans aucun lien depose ne se cloture pas : la Production n'aurait rien a verifier.
update media_liens set transfert_confirme = false where prestation_id = (select prestation from ctx);
delete from media_liens where prestation_id = (select prestation from ctx);
update mission_suivi_operateur set livrables_non_fournis = livrables_non_fournis || '{"photo":{"motif":"rien"}}'::jsonb
 where prestation_id = (select prestation from ctx);
select pg_temp.note('une mission sans aucun lien reste bloquee', 'oui',
  (select case when 'Aucun lien déposé par l''opérateur' = any(mission_cloture_manquant((select prestation from ctx)))
               then 'oui' else 'NON' end));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
