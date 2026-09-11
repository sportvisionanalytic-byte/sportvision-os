-- v174 : la prime ventes se compte à l'heure de Paris, et la comptabilité voit pour qui elle paie.
-- (12/09/2026)
--
-- 1. LES BORNES DU MOIS. production_remuneration_detail() comparait des instants (paid_at,
--    updated_at, created_at, tous en timestamptz) à des dates, ce que Postgres interprète en UTC.
--    Un encaissement du 1er à 01 h du matin, heure de Paris, tombait donc dans le mois précédent,
--    et le passage « prévisionnel → acquis » avait deux heures de retard. La règle Europe/Paris
--    avait été posée le 11/09 pour les affectations (v153) ; l'argent suit la même règle.
--
-- 2. LA COMPTABILITÉ VALIDAIT SANS VOIR LE NOM. L'écran Finance Production lisait les profils par
--    une jointure sur pole_affectations, table fermée à la comptabilité : la jointure ne rendait
--    rien, et la colonne « Personne » restait vide. Valider et régler un montant sans savoir à qui
--    il revient est exactement ce qu'un contrôle financier doit empêcher. Cette fonction rend la
--    liste, à ceux qui ont à la lire.
-- Test : tests/finance-production-noms-et-paris.test.sql

create or replace function public.production_du_pole(p_pole_id uuid)
returns table (id uuid, prenom text, nom text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.prenom, p.nom
    from profiles p
    join pole_affectations pa on pa.user_id = p.id and pa.pole_id = p_pole_id and pa.actif
   where p.role = 'prod' and coalesce(p.actif, true)
     and exists (select 1 from profiles moi where moi.id = auth.uid()
                  and moi.role in ('admin', 'compta', 'sec', 'prod', 'rh'))
   order by p.nom, p.prenom;
$$;
revoke execute on function public.production_du_pole(uuid) from public, anon;
grant execute on function public.production_du_pole(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.production_remuneration_detail(p_pole_id uuid, p_beneficiaire uuid, p_periode date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_debut date := date_trunc('month', p_periode)::date;
  v_fin date := (date_trunc('month', p_periode) + interval '1 month')::date;
  c production_remuneration_config;
  v_palier record;
  v_missions jsonb;
  v_ventes jsonb;
  v_ca numeric; v_remb numeric; v_base numeric; v_taux numeric; v_bonus numeric := 0; v_prime numeric;
  v_nb_acq int; v_nb_prev int;
  v_tva numeric;
begin
  select * into c from production_remuneration_config where pole_id = p_pole_id;
  v_tva := coalesce(c.tva_pct, 20);
  select * into v_palier from pole_palier_du_mois(p_pole_id, v_debut);

  -- Coordination : les missions que la personne pilote (responsable_prod_id), ce mois-là, non
  -- annulées. Acquise à la livraison validée ; avant, prévisionnelle.
  select coalesce(jsonb_agg(jsonb_build_object(
           'prestation_id', p.id, 'reference', p.reference, 'date', p.date_prestation,
           'client', cl.nom, 'libelle', coalesce(nullif(p.equipes, ''), p.type_prestation),
           'statut_mission', p.statut, 'acquis', mission_livree(p.statut),
           'coordination', coalesce(c.coordination_montant, 0)) order by p.date_prestation, p.reference), '[]'::jsonb),
         count(*) filter (where mission_livree(p.statut)), count(*)
    into v_missions, v_nb_acq, v_nb_prev
    from prestations p left join clients cl on cl.id = p.client_id
   where p.responsable_prod_id = p_beneficiaire
     and coalesce(p.pole_id, cl.pole_id) = p_pole_id
     and p.date_prestation >= v_debut and p.date_prestation < v_fin
     and p.statut not in ('annulée', 'refusée');

  -- Ventes encaissées du pôle ce mois-là, HT, avec leur famille. Rien n'est « facturé » ici :
  -- une facture impayée ne génère rien.
  with enc as (
    -- Virements rapprochés d'une facture.
    select bt.booking_date as jour, 'Facture ' || coalesce(f.numero, '') as libelle,
           case when f.prestation_id is not null then 'ponctuelles' else 'abonnements' end as famille,
           round(bt.amount * coalesce(f.montant_ht / nullif(f.montant_ttc, 0), 1 / (1 + v_tva / 100)), 2) as ht
      from bank_transactions bt join factures f on f.id = bt.matched_facture_id join clients cl on cl.id = f.client_id
     where cl.pole_id = p_pole_id and bt.amount > 0 and bt.booking_date >= v_debut and bt.booking_date < v_fin
    union all
    -- Paiements en ligne réussis (hors ceux déjà rapprochés par un virement).
    select (pa.updated_at at time zone 'Europe/Paris')::date, 'Paiement ' || coalesce(f.numero, pa.type_paiement),
           case when coalesce(f.prestation_id, pa.prestation_id) is not null then 'ponctuelles' else 'abonnements' end,
           round(pa.montant * coalesce(f.montant_ht / nullif(f.montant_ttc, 0), 1 / (1 + v_tva / 100)), 2)
      from paiements pa left join factures f on f.id = pa.facture_id
      join clients cl on cl.id = coalesce(pa.client_id, f.client_id)
     where cl.pole_id = p_pole_id and pa.statut = 'reussi'
       and (pa.updated_at at time zone 'Europe/Paris')::date >= v_debut and (pa.updated_at at time zone 'Europe/Paris')::date < v_fin
       and not exists (select 1 from bank_transactions bt where bt.matched_paiement_id = pa.id)
    union all
    -- Galeries payées (prix TTC).
    select (o.paid_at at time zone 'Europe/Paris')::date, 'Galerie · commande ' || left(o.id::text, 8), 'galeries',
           round(o.amount_cents / 100.0 / (1 + v_tva / 100), 2)
      from media_orders o join clubs k on k.id = o.club_id join clients cl on cl.id = k.portail_client_id
     where cl.pole_id = p_pole_id and o.paid_at is not null and o.status in ('paid', 'refunded')
       and (o.paid_at at time zone 'Europe/Paris')::date >= v_debut and (o.paid_at at time zone 'Europe/Paris')::date < v_fin
  ), remb as (
    select r.rembourse_le::date as jour, 'Remboursement galerie' as libelle, 'galeries' as famille,
           round(r.montant_cents / 100.0 / (1 + v_tva / 100), 2) as ht
      from media_orders_remboursements r join media_orders o on o.id = r.order_id
      join clubs k on k.id = o.club_id join clients cl on cl.id = k.portail_client_id
     where cl.pole_id = p_pole_id and r.rembourse_le >= v_debut and r.rembourse_le < v_fin
    union all
    select (a.created_at at time zone 'Europe/Paris')::date, 'Avoir ' || coalesce(a.numero, ''),
           case when a.prestation_id is not null then 'ponctuelles' else 'abonnements' end, a.montant_ht
      from avoirs a join clients cl on cl.id = a.client_id
     where cl.pole_id = p_pole_id and a.statut in ('emis', 'comptabilise', 'rembourse')
       and (a.created_at at time zone 'Europe/Paris')::date >= v_debut and (a.created_at at time zone 'Europe/Paris')::date < v_fin
    union all
    select (pa.updated_at at time zone 'Europe/Paris')::date, 'Paiement remboursé ' || coalesce(f.numero, ''),
           case when coalesce(f.prestation_id, pa.prestation_id) is not null then 'ponctuelles' else 'abonnements' end,
           round(pa.montant * coalesce(f.montant_ht / nullif(f.montant_ttc, 0), 1 / (1 + v_tva / 100)), 2)
      from paiements pa left join factures f on f.id = pa.facture_id
      join clients cl on cl.id = coalesce(pa.client_id, f.client_id)
     where cl.pole_id = p_pole_id and pa.statut = 'rembourse' and (pa.updated_at at time zone 'Europe/Paris')::date >= v_debut and (pa.updated_at at time zone 'Europe/Paris')::date < v_fin
  ), lignes as (
    select jour, libelle, famille, ht, 'encaissement' as nature from enc
    union all
    select jour, libelle, famille, -ht, 'remboursement' from remb
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', jour, 'libelle', libelle, 'famille', famille, 'nature', nature,
                                               'ht', ht, 'eligible', famille = any(coalesce(c.ventes_familles, '{}')))
                            order by jour, libelle), '[]'::jsonb),
         coalesce(sum(ht) filter (where nature = 'encaissement' and famille = any(coalesce(c.ventes_familles, '{}'))), 0),
         coalesce(-sum(ht) filter (where nature = 'remboursement' and famille = any(coalesce(c.ventes_familles, '{}'))), 0)
    into v_ventes, v_ca, v_remb
    from lignes;

  v_base := greatest(v_ca - v_remb, 0);
  select coalesce((select (e->>'taux_pct')::numeric from jsonb_array_elements(coalesce(c.ventes_paliers, '[]'::jsonb)) e
                    where (e->>'a_partir_de')::numeric <= v_base order by (e->>'a_partir_de')::numeric desc limit 1),
                  coalesce(c.ventes_taux_pct, 0))
    into v_taux;
  if c.ventes_objectif_mensuel is not null and v_base >= c.ventes_objectif_mensuel then
    v_bonus := coalesce(c.ventes_bonus_fixe, 0);
  end if;
  v_prime := round(v_base * v_taux / 100, 2) + v_bonus;

  return jsonb_build_object(
    'pole_id', p_pole_id, 'beneficiaire', p_beneficiaire, 'periode', v_debut,
    'mois_termine', current_date >= v_fin,
    'configure', c.pole_id is not null,
    'fixe', jsonb_build_object('montant', v_palier.fixe, 'nb_contrats', v_palier.nb_contrats,
                               'palier', v_palier.libelle, 'hors_grille', v_palier.hors_grille),
    'coordination', jsonb_build_object('montant_unitaire', coalesce(c.coordination_montant, 0),
                                       'nb_missions', v_nb_prev, 'nb_acquises', v_nb_acq,
                                       'montant_previsionnel', v_nb_prev * coalesce(c.coordination_montant, 0),
                                       'montant_acquis', v_nb_acq * coalesce(c.coordination_montant, 0),
                                       'missions', v_missions),
    'ventes', jsonb_build_object('familles', to_jsonb(coalesce(c.ventes_familles, '{}')), 'ca_eligible', v_ca,
                                 'rembourse', v_remb, 'base', v_base, 'taux_pct', v_taux,
                                 'paliers', coalesce(c.ventes_paliers, '[]'::jsonb),
                                 'bonus', v_bonus, 'objectif', c.ventes_objectif_mensuel,
                                 'montant', v_prime, 'tva_pct', v_tva, 'lignes', v_ventes)
  );
end $function$
;
