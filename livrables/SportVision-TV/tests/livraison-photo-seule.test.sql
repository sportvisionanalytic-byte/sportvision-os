-- Livrer ce qu'on a, et que la Production l'apprenne (v206, 13/09/2026).
--
-- Cas réel du 12/09 : la mission SV-2026-0268 est enregistrée en couverture `photo_video`, et
-- Michael n'a fait que la photo. L'écran exige les TROIS livrables de la couverture avant
-- d'afficher « Envoyer à Production » : il ne pouvait rien valider, et aucun écran ne lui
-- permettait de dire qu'il n'y avait pas de vidéo sur cette mission.
--
-- Et même en livrant tout, personne côté SportVision n'était prévenu : le seul déclencheur de
-- notification sur les prestations prévient le CLIENT. Le responsable production découvrait la
-- livraison en allant regarder.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee33bb00-0000-0000-0000-000000000001','zz-operateur-livraison@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif)
values ('ee33bb00-0000-0000-0000-000000000001','ZZOperateur','Livraison','photo',true)
on conflict (id) do update set role='photo', actif=true;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Client Livraison (test)','client') returning id),
       pres as (insert into prestations (client_id, type_prestation, statut, couverture, date_prestation)
                select id, 'match_photo', 'médias_complets', 'photo_video', current_date - 1 from cli returning id),
       lien as (insert into media_liens (prestation_id, nom, url, categorie, type_media)
                select (select id from pres), 'ZZ Photos traitées', 'https://exemple.invalid/photos', 'final', 'photo'
                returning id),
       suivi as (insert into mission_suivi_operateur (prestation_id, collaborateur_id, livrables_non_fournis)
                 select (select id from pres), 'ee33bb00-0000-0000-0000-000000000001',
                        '{"montage":{"motif":"Pas de captation vidéo sur cette mission","at":"2026-09-13T00:10:00Z"}}'::jsonb
                 returning id)
  select (select id from pres) prestation;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

select pg_temp.note('un livrable peut etre declare sans objet, avec son motif', 'Pas de captation vidéo sur cette mission',
  coalesce((select m.livrables_non_fournis -> 'montage' ->> 'motif'
              from mission_suivi_operateur m, ctx where m.prestation_id = ctx.prestation), 'RIEN'));

-- L'operateur envoie a Production.
update prestations set statut = 'prêt_validation' where id = (select prestation from ctx);

select pg_temp.note('la Production est prevenue', 'oui',
  (select case when exists (
     select 1 from notifications n, ctx
      where n.lien_prestation_id = ctx.prestation and n.type = 'livraison_recue'
   ) then 'oui' else 'NON' end));

select pg_temp.note('et le message dit ce qui a ete fourni', 'oui',
  (select case when bool_or(n.message ilike '%ZZ Photos traitées%') then 'oui' else 'NON' end
     from notifications n, ctx where n.lien_prestation_id = ctx.prestation));

select pg_temp.note('et ce qui a ete declare sans objet', 'oui',
  (select case when bool_or(n.message ilike '%Pas de captation vidéo%') then 'oui' else 'NON' end
     from notifications n, ctx where n.lien_prestation_id = ctx.prestation));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
