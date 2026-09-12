-- Une facture émise ne se réécrit plus (v191, 12/09/2026).
--
-- L'écran d'émission affirme au staff que le document devient définitif. La base, elle, ne
-- l'imposait nulle part : la policy `factures_staff` est en ALL, aucun trigger ne protégeait
-- quoi que ce soit. Le numéro, les lignes, les montants, la date d'émission et le client
-- restaient modifiables, et la ligne restait supprimable — sans laisser de trace.
--
-- Ce test tient pour vrai : tant qu'une facture est en brouillon, on la corrige ; dès qu'elle est
-- émise, ses éléments comptables sont figés, mais son suivi de paiement (statut, montant payé,
-- références Pennylane) continue de s'écrire. Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Client Facture (test)','client') returning id),
       f as (insert into factures (client_id, type_facture, lignes, montant_ht, tva_pct, montant_ttc,
                                   statut, date_emission, date_echeance)
             select id, 'totalite', '[{"libelle":"ZZ prestation","quantite":1,"prix_unitaire":100}]'::jsonb,
                    100, 20, 120, 'brouillon', current_date, current_date + 30 from cli returning id)
  select (select id from f) facture;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.essai(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'passe'; exception when others then return 'refus'; end $$;

-- 1. En brouillon, tout se corrige.
select pg_temp.note('un brouillon se corrige encore', 'passe',
  pg_temp.essai('update factures set montant_ht = 90, montant_ttc = 108 where id = '''||(select facture from ctx)||''''));

-- 2. On emet.
update factures set statut = 'emise' where id = (select facture from ctx);

select pg_temp.note('le montant d''une facture emise est fige', 'refus',
  pg_temp.essai('update factures set montant_ht = 1 where id = '''||(select facture from ctx)||''''));
select pg_temp.note('son detail est fige', 'refus',
  pg_temp.essai('update factures set lignes = ''[]''::jsonb where id = '''||(select facture from ctx)||''''));
select pg_temp.note('son numero est fige', 'refus',
  pg_temp.essai('update factures set numero = ''FAC-2026-9999'' where id = '''||(select facture from ctx)||''''));
select pg_temp.note('sa date d''emission est figee', 'refus',
  pg_temp.essai('update factures set date_emission = current_date - 40 where id = '''||(select facture from ctx)||''''));
select pg_temp.note('son client est fige', 'refus',
  pg_temp.essai('update factures set client_id = null where id = '''||(select facture from ctx)||''''));
select pg_temp.note('elle ne se supprime plus', 'refus',
  pg_temp.essai('delete from factures where id = '''||(select facture from ctx)||''''));

-- 3. Le suivi du paiement doit continuer de vivre.
select pg_temp.note('le paiement continue de s''enregistrer', 'passe',
  pg_temp.essai('update factures set statut = ''payee'', montant_paye = 108 where id = '''||(select facture from ctx)||''''));
select pg_temp.note('la reference Pennylane continue de s''ecrire', 'passe',
  pg_temp.essai('update factures set pennylane_invoice_id = ''12345'' where id = '''||(select facture from ctx)||''''));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
