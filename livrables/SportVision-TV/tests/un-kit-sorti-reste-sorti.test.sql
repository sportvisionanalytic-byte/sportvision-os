-- Un kit sorti reste sorti (v369, 30/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • un kit sorti dont AUCUN retour n'est enregistré ne peut plus être réservé, quelle que soit
--     la date demandée — même des mois plus tard ;
--   • le message de refus dit QUOI FAIRE : il nomme la mission qui tient le kit ;
--   • enregistrer le retour libère le kit ;
--   • deux réservations bornées qui ne se chevauchent pas restent permises ;
--   • deux réservations bornées qui se chevauchent restent refusées.
--
-- LE DÉFAUT QUE ÇA FIGE : la garde inventait une fin de réservation à `date_sortie + 1 jour` quand
-- aucun retour n'était prévu. Dès le lendemain, un kit encore dehors était considéré libre. Mesuré
-- le 30/09 sur la production : réserver KIT alpha 1, sorti depuis le 12 septembre et jamais rentré,
-- était ACCEPTÉ.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  with k as (insert into kits (nom, type_kit, statut) values ('ZZ Kit test sortie','photo','disponible') returning id),
       cli as (insert into clients (nom, statut_relation) values ('ZZ Client kit (test)','partenaire') returning id),
       p1 as (insert into prestations (client_id, date_prestation, statut, couverture)
              select id, current_date + 1, 'confirmée', 'photo' from cli returning id),
       p2 as (insert into prestations (client_id, date_prestation, statut, couverture)
              select id, current_date + 30, 'confirmée', 'photo' from cli returning id)
  select (select id from k) kit_id, (select id from p1) presta1, (select id from p2) presta2;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;

-- `essai` rend « accepté » ou le message d'erreur. Un test qui ne regarde que « ça n'a pas planté »
-- est un test vert creux : on veut lire ce que la base répond.
create or replace function pg_temp.essai(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'accepté';
exception when others then
  return sqlerrm;
end $$;

create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

-- ── Le kit part, sans retour prévu ────────────────────────────────────────────────────────────
insert into kit_reservations (kit_id, prestation_id, statut, date_sortie)
select kit_id, presta1, 'réservé', now() - interval '18 days' from ctx;

select pg_temp.note('un kit sorti sans retour ne se réserve pas 18 jours après', 'refusé',
  case when pg_temp.essai($$
    insert into kit_reservations (kit_id, prestation_id, statut, date_sortie)
    select kit_id, presta2, 'réservé', now() + interval '3 days' from ctx $$) = 'accepté'
  then 'accepté' else 'refusé' end);

select pg_temp.note('le refus dit quoi faire (il parle du retour)', 'oui',
  case when pg_temp.essai($$
    insert into kit_reservations (kit_id, prestation_id, statut, date_sortie)
    select kit_id, presta2, 'réservé', now() + interval '3 days' from ctx $$) ilike '%retour%'
  then 'oui' else 'non' end);

-- ── Le retour est enregistré ──────────────────────────────────────────────────────────────────
update kit_reservations set date_retour_effective = now() - interval '17 days'
where kit_id = (select kit_id from ctx);

select pg_temp.note('une fois le retour enregistré, le kit se réserve', 'accepté',
  pg_temp.essai($$
    insert into kit_reservations (kit_id, prestation_id, statut, date_sortie, date_retour_prevue)
    select kit_id, presta1, 'réservé', date_trunc('day', now()) + interval '3 days' + interval '8 hours',
           date_trunc('day', now()) + interval '3 days' + interval '20 hours' from ctx $$));

-- ── Deux créneaux bornés ──────────────────────────────────────────────────────────────────────
select pg_temp.note('deux créneaux bornés qui ne se chevauchent pas', 'accepté',
  pg_temp.essai($$
    insert into kit_reservations (kit_id, prestation_id, statut, date_sortie, date_retour_prevue)
    select kit_id, presta2, 'réservé', date_trunc('day', now()) + interval '10 days' + interval '8 hours',
           date_trunc('day', now()) + interval '10 days' + interval '20 hours' from ctx $$));

select pg_temp.note('deux créneaux bornés qui se chevauchent', 'refusé',
  case when pg_temp.essai($$
    insert into kit_reservations (kit_id, prestation_id, statut, date_sortie, date_retour_prevue)
    select kit_id, presta2, 'réservé', date_trunc('day', now()) + interval '10 days' + interval '14 hours',
           date_trunc('day', now()) + interval '11 days' + interval '20 hours' from ctx $$) = 'accepté'
  then 'accepté' else 'refusé' end);

-- ── Une réservation ANNULÉE ne tient rien ─────────────────────────────────────────────────────
-- Sans ce contrôle, la garde bloquerait sur des réservations mortes et on ne pourrait plus rien
-- réserver du tout : le remède serait pire que le mal.
update kit_reservations set statut = 'retourné' where kit_id = (select kit_id from ctx);
select pg_temp.note('des réservations closes ne bloquent pas', 'accepté',
  pg_temp.essai($$
    insert into kit_reservations (kit_id, prestation_id, statut, date_sortie, date_retour_prevue)
    select kit_id, presta1, 'réservé', date_trunc('day', now()) + interval '40 days' + interval '8 hours',
           date_trunc('day', now()) + interval '40 days' + interval '20 hours' from ctx $$));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
