-- Les messages d'erreur ne nomment plus de colonnes (v178, 12/09/2026).
--
-- Ce que ce test tient pour vrai : aucune des fonctions réécrites ne renvoie à l'utilisateur un
-- nom de table ou de colonne, et les phrases visées ont bien été remplacées.
-- Lecture seule.

begin;
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.contient(p_fn text, p_txt text) returns text language sql as $$
  select case when exists (select 1 from pg_proc where proname = p_fn and prosrc like '%' || p_txt || '%')
              then 'oui' else 'non' end; $$;

select pg_temp.note('une adhésion ne se « déplace » plus par UPDATE', 'non',
  pg_temp.contient('protect_sensitive_club_member_fields', 'club_id est immuable'));
select pg_temp.note('le rattachement client ne dit plus « client_id »', 'non',
  pg_temp.contient('protect_sensitive_client_user_fields', 'client_id est réservé'));
select pg_temp.note('« user_id requis » a disparu', 'non',
  pg_temp.contient('clubplus_claim_self_service_onboarding', 'user_id requis'));
select pg_temp.note('la signature ne cite plus signature_statut', 'non',
  pg_temp.contient('check_signature_avant_activation', 'signature_statut = signee'));
select pg_temp.note('le devis non plus', 'non',
  pg_temp.contient('check_signature_avant_acceptation', 'signature_statut = signee'));
select pg_temp.note('la réservation ne cite plus portail_client_id', 'non',
  pg_temp.contient('club_booking_send_to_production', 'portail_client_id manquant'));
select pg_temp.note('et elle dit où rattacher le club', 'oui',
  pg_temp.contient('club_booking_send_to_production', 'Rattachez-le depuis Documents'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
