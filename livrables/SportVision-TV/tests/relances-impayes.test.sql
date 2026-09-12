-- Les relances d'impayés partent vraiment (12/09/2026).
--
-- `migration-finance-relances-auto.sql` existait dans le dépôt depuis le 06/08 mais n'avait
-- JAMAIS été exécutée : `check_factures_en_retard` n'existait pas en base, aucun cron ne la
-- lançait, et `factures.statut` ne passait jamais à `en_retard` — ce qui rendait muets tous les
-- écrans et filtres bâtis sur ce statut. Aucun impayé n'avait donc jamais été relancé.
--
-- Ce test crée une facture échue de 7 jours pour un client fictif, déclenche la relance, et
-- vérifie qu'un e-mail est bien mis en file ET que le statut bascule. Tout est annulé : aucun
-- message ne part réellement.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, email, prenom_contact, statut_relation)
               values ('ZZ Client Relance (test)', 'zz-relance@example.invalid', 'Zoe', 'client') returning id),
       f as (insert into factures (client_id, type_facture, lignes, montant_ht, tva_pct, montant_ttc,
                                   statut, date_emission, date_echeance)
             select id, 'totalite', '[{"libelle":"ZZ","quantite":1,"prix_unitaire":100}]'::jsonb,
                    100, 20, 120, 'emise', current_date - 37, current_date - 7 from cli returning id)
  select (select id from cli) client, (select id from f) facture;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

select check_factures_en_retard();

select pg_temp.note('la relance J+7 est mise en file', '1',
  (select count(*)::text from notification_outbox o, ctx
    where o.entity_type = 'facture' and o.entity_id = ctx.facture));
select pg_temp.note('elle part à l''adresse du client', 'zz-relance@example.invalid',
  coalesce((select o.recipient_email from notification_outbox o, ctx
             where o.entity_type = 'facture' and o.entity_id = ctx.facture limit 1), 'RIEN'));
select pg_temp.note('la facture échue est marquée en retard', 'en_retard',
  (select f.statut from factures f, ctx where f.id = ctx.facture));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
