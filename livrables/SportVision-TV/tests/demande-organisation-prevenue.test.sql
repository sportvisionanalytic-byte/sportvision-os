-- Une demande d'organisation non-club prévient le staff (v194, 12/09/2026).
--
-- Club+ a deux circuits de demande : `club_requests` pour un club, branché partout dans l'OS, et
-- `requests` pour un coach, une académie, un sponsor, un événement, une agence CM ou un espace
-- Projet. Ce second circuit n'était lu par aucun écran de l'OS et ne notifiait personne :
-- `submit_request` insérait la ligne et retournait. L'écran disait « Demande envoyée », et chez
-- SportVision personne ne l'apprenait.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee88ee88-0000-0000-0000-000000000001','zz-demandeur@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

create temp table ctx on commit drop as
  with org as (insert into organizations (id, nom, organization_type, statut)
               values (gen_random_uuid(), 'ZZ Academie Demande (test)', 'academie', 'actif_standard') returning id),
       dem as (insert into requests (organization_id, type, requester_id, status, urgency, detail, credits_reserved)
               select id, 'affiche_match', 'ee88ee88-0000-0000-0000-000000000001', 'recues', 'normale',
                      'ZZ demande de test', 0 from org returning id)
  select (select id from org) org, (select id from dem) demande;

select pg_temp.note('le staff est prévenu de la demande', 'oui',
  (select case when exists (
     select 1 from notifications n
      where n.titre ilike '%demande%' and n.message ilike '%ZZ Academie Demande%'
   ) then 'oui' else 'NON' end));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
