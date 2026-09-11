-- v149 : la Finance du Responsable Production (11/09/2026).
--
-- Décisions de Fouka, 11/09/2026 :
--   • le Responsable Production pilote, le système calcule ce qu'il gagne, l'Admin et la
--     comptabilité gardent la validation finale ; il n'est jamais juge et partie ;
--   • quatre blocs séparés : terrain (quand il opère lui-même), coordination (par mission pilotée),
--     prime sur ventes, frais ;
--   • le fixe vient du barème de pôle EXISTANT (pole_remuneration_paliers : 300 € à 2-3 contrats
--     Full Com…), qui s'applique désormais aussi au Responsable Production du pôle ;
--   • la prime sur ventes se calcule sur le CA ENCAISSÉ HT net de remboursements, par familles
--     cochées ; aucun taux n'est inventé : 0 € tant que l'Admin ne l'a pas réglé ;
--   • terrain et coordination deviennent « acquis » à la livraison validée (mission « livrée » ou
--     au-delà) ; une vente, à l'encaissement confirmé ;
--   • statuts : prévisionnel → acquis → validé → transmis compta → payé.
--
-- Réutilisé plutôt que recréé :
--   • pole_remuneration_paliers (fixe) et pole_remuneration_calculs (calcul mensuel, validation,
--     paiement), étendus d'un bénéficiaire « responsable_production » ;
--   • prestations_equipe et son circuit de paiement pour le terrain (v148 pour l'auto-affectation) ;
--   • la table frais pour les remboursements ;
--   • financial_audit_log pour l'historique.
-- Test : tests/finance-production-mensuel.test.sql

-- ── 1. La configuration par pôle (Admin seulement, journalisée) ──
create table if not exists public.production_remuneration_config (
  pole_id uuid primary key references public.poles(id) on delete cascade,
  responsable_production_id uuid references public.profiles(id),
  coordination_montant numeric not null default 0 check (coordination_montant >= 0),
  ventes_familles text[] not null default '{}'
    check (ventes_familles <@ array['abonnements', 'ponctuelles', 'galeries', 'autres']::text[]),
  ventes_taux_pct numeric not null default 0 check (ventes_taux_pct between 0 and 100),
  -- Paliers facultatifs : [{"a_partir_de": 2000, "taux_pct": 5}, …]. Le taux du palier le plus haut
  -- atteint s'applique à tout le CA éligible ; sans palier, ventes_taux_pct.
  ventes_paliers jsonb not null default '[]'::jsonb check (jsonb_typeof(ventes_paliers) = 'array'),
  -- Bonus fixe versé quand l'objectif mensuel est atteint (sans objectif, pas de bonus).
  ventes_bonus_fixe numeric not null default 0 check (ventes_bonus_fixe >= 0),
  ventes_objectif_mensuel numeric check (ventes_objectif_mensuel is null or ventes_objectif_mensuel >= 0),
  -- Les galeries sont vendues TTC : taux de TVA pour les ramener au HT.
  tva_pct numeric not null default 20 check (tva_pct between 0 and 100),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.production_remuneration_config enable row level security;
drop policy if exists prc_lecture on public.production_remuneration_config;
create policy prc_lecture on public.production_remuneration_config for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'compta', 'sec'))
         or (exists (select 1 from profiles where id = auth.uid() and role = 'prod') and coalesce(pole_scope_ok(pole_id), false)));
drop policy if exists prc_admin on public.production_remuneration_config;
create policy prc_admin on public.production_remuneration_config for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
revoke all on public.production_remuneration_config from anon;

create or replace function public.journaliser_config_production()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, details)
  values (auth.uid(), case when tg_op = 'INSERT' then 'creation' else 'modification' end,
          'production_remuneration_config', new.pole_id,
          jsonb_build_object('avant', case when tg_op = 'UPDATE' then to_jsonb(old) - 'updated_at' - 'updated_by' end,
                             'apres', to_jsonb(new) - 'updated_at' - 'updated_by'));
  return new;
end $$;
drop trigger if exists trg_journaliser_config_production on public.production_remuneration_config;
create trigger trg_journaliser_config_production before insert or update on public.production_remuneration_config
  for each row execute function public.journaliser_config_production();

-- Le Responsable Production d'un pôle : celui que l'Admin a désigné, sinon l'unique Production
-- active du pôle. Deux Productions sans désignation : personne (l'Admin doit trancher).
create or replace function public.responsable_production_du_pole(p_pole_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select responsable_production_id from production_remuneration_config where pole_id = p_pole_id),
    (select min(pa.user_id::text)::uuid from pole_affectations pa join profiles p on p.id = pa.user_id
      where pa.pole_id = p_pole_id and pa.actif and p.role = 'prod' and coalesce(p.actif, true)
      having count(distinct pa.user_id) = 1));
$$;
revoke execute on function public.responsable_production_du_pole(uuid) from public, anon;
grant execute on function public.responsable_production_du_pole(uuid) to authenticated;

-- ── 2. Le palier du mois : UNE règle, pour le responsable de pôle comme pour la Production ──
create or replace function public.pole_palier_du_mois(p_pole_id uuid, p_periode date)
returns table (nb_contrats integer, palier_id uuid, fixe numeric, variable_pct numeric, hors_grille boolean, libelle text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_debut date := date_trunc('month', p_periode)::date;
  v_fin date := (date_trunc('month', p_periode) + interval '1 month')::date;
  v_nb integer;
  v_p pole_remuneration_paliers;
begin
  select count(*) into v_nb
    from contrats c join clients cl on cl.id = c.client_id
   where cl.pole_id = p_pole_id and c.type_contrat = 'full_communication' and c.statut = 'actif'
     and (c.date_debut is null or c.date_debut < v_fin) and (c.date_fin is null or c.date_fin >= v_debut);
  select * into v_p from pole_remuneration_paliers
   where actif and (pole_id = p_pole_id or pole_id is null)
     and borne_min <= v_nb and (borne_max is null or borne_max >= v_nb)
   order by (pole_id = p_pole_id) desc, borne_min desc limit 1;
  return query select v_nb, v_p.id, coalesce(v_p.fixe_mensuel, 0), coalesce(v_p.variable_pct, 0), v_p.id is null, v_p.libelle_statut;
end $$;
revoke execute on function public.pole_palier_du_mois(uuid, date) from public, anon, authenticated;

-- ── 3. Le calcul mensuel existant accueille un second bénéficiaire ──
alter table public.pole_remuneration_calculs add column if not exists beneficiaire text not null default 'responsable_pole';
alter table public.pole_remuneration_calculs drop constraint if exists pole_remuneration_calculs_beneficiaire_check;
alter table public.pole_remuneration_calculs add constraint pole_remuneration_calculs_beneficiaire_check
  check (beneficiaire in ('responsable_pole', 'responsable_production'));
alter table public.pole_remuneration_calculs drop constraint if exists pole_remuneration_calculs_pole_id_periode_key;
alter table public.pole_remuneration_calculs drop constraint if exists pole_remuneration_calculs_pole_periode_beneficiaire_key;
alter table public.pole_remuneration_calculs add constraint pole_remuneration_calculs_pole_periode_beneficiaire_key
  unique (pole_id, periode, beneficiaire);
alter table public.pole_remuneration_calculs drop constraint if exists pole_remuneration_calculs_statut_check;
alter table public.pole_remuneration_calculs add constraint pole_remuneration_calculs_statut_check
  check (statut in ('a_valider', 'valide', 'transmis_compta', 'paye'));
alter table public.pole_remuneration_calculs add column if not exists coordination_nb integer not null default 0;
alter table public.pole_remuneration_calculs add column if not exists coordination_montant numeric not null default 0;
alter table public.pole_remuneration_calculs add column if not exists ventes_ca_eligible numeric not null default 0;
alter table public.pole_remuneration_calculs add column if not exists ventes_rembourse numeric not null default 0;
alter table public.pole_remuneration_calculs add column if not exists ventes_montant numeric not null default 0;
alter table public.pole_remuneration_calculs add column if not exists transmis_le timestamptz;
alter table public.pole_remuneration_calculs add column if not exists transmis_par uuid references public.profiles(id);
alter table public.pole_remuneration_calculs add column if not exists paye_par uuid references public.profiles(id);

-- Chacun lit SON calcul ; la comptabilité et le secrétariat lisent tout (ils règlent).
drop policy if exists pole_remuneration_calculs_beneficiaire_select on public.pole_remuneration_calculs;
create policy pole_remuneration_calculs_beneficiaire_select on public.pole_remuneration_calculs for select to authenticated
  using (responsable_id = auth.uid()
         or exists (select 1 from profiles where id = auth.uid() and role in ('compta', 'sec')));

-- Le calcul du responsable de pôle, inchangé sauf le bénéficiaire et le palier partagé.
create or replace function public.pole_calculer_remuneration_responsable(p_pole_id uuid, p_periode date)
returns pole_remuneration_calculs
language plpgsql security definer set search_path = public as $function$
declare
  v_periode date := date_trunc('month', p_periode)::date;
  v_periode_fin date := (date_trunc('month', p_periode) + interval '1 month')::date;
  v_existing pole_remuneration_calculs;
  v_responsable uuid;
  v_palier record;
  v_ventil jsonb;
  v_revenus_total numeric;
  v_charges_total numeric;
  v_benefice numeric;
  v_variable numeric := 0;
  v_row pole_remuneration_calculs;
begin
  if not pole_finance_access_ok(p_pole_id) then
    raise exception 'accès refusé au pôle %', p_pole_id using errcode = '42501';
  end if;

  select * into v_existing from pole_remuneration_calculs
    where pole_id = p_pole_id and periode = v_periode and beneficiaire = 'responsable_pole';
  if found and v_existing.statut = 'paye' then
    return v_existing;
  end if;

  select user_id into v_responsable
  from pole_affectations
  where pole_id = p_pole_id and role_pole = 'responsable' and actif = true
  order by affecte_le asc
  limit 1;

  select * into v_palier from pole_palier_du_mois(p_pole_id, v_periode);

  v_ventil := pole_finance_ventilation(p_pole_id, v_periode, v_periode_fin);
  v_revenus_total := coalesce((v_ventil->'revenus'->>'total')::numeric, 0);
  v_charges_total := coalesce((v_ventil->'charges'->>'total')::numeric, 0);
  v_benefice := v_revenus_total - v_charges_total - v_palier.fixe;
  if v_benefice > 0 then
    v_variable := round(v_benefice * v_palier.variable_pct / 100.0, 2);
  end if;

  insert into pole_remuneration_calculs (
    pole_id, responsable_id, periode, beneficiaire, nb_contrats_recurrents, palier_id, hors_grille,
    fixe_mensuel, revenus_pole, charges_pole, benefice_eligible, variable_pct, variable_montant,
    total, detail_calcul, statut
  ) values (
    p_pole_id, v_responsable, v_periode, 'responsable_pole', v_palier.nb_contrats, v_palier.palier_id, v_palier.hors_grille,
    v_palier.fixe, v_revenus_total, v_charges_total, v_benefice, v_palier.variable_pct, v_variable,
    v_palier.fixe + v_variable,
    v_ventil || jsonb_build_object(
      'alerte', case when v_palier.hors_grille then 'Plus de 10 contrats récurrents actifs : revue stratégique Direction obligatoire — aucun palier automatique appliqué.' else null end
    ),
    'a_valider'
  )
  on conflict (pole_id, periode, beneficiaire) do update set
    responsable_id = excluded.responsable_id,
    nb_contrats_recurrents = excluded.nb_contrats_recurrents,
    palier_id = excluded.palier_id,
    hors_grille = excluded.hors_grille,
    fixe_mensuel = excluded.fixe_mensuel,
    revenus_pole = excluded.revenus_pole,
    charges_pole = excluded.charges_pole,
    benefice_eligible = excluded.benefice_eligible,
    variable_pct = excluded.variable_pct,
    variable_montant = excluded.variable_montant,
    total = excluded.total,
    detail_calcul = excluded.detail_calcul,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

-- ── 4. Les états d'une mission qui valent « livraison validée » ──
create or replace function public.mission_livree(p_statut statut_prestation)
returns boolean language sql immutable as $$
  select p_statut in ('livrée', 'facturée', 'partiellement_payée', 'payée', 'clôturée');
$$;

-- ── 5. Fixe, coordination et ventes d'un pôle pour un mois : UN calcul, lu par l'écran et
--      recopié tel quel dans le montant à valider. Aucun montant n'est saisi à la main. ──
create or replace function public.production_remuneration_detail(p_pole_id uuid, p_beneficiaire uuid, p_periode date)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
    select pa.updated_at::date, 'Paiement ' || coalesce(f.numero, pa.type_paiement),
           case when coalesce(f.prestation_id, pa.prestation_id) is not null then 'ponctuelles' else 'abonnements' end,
           round(pa.montant * coalesce(f.montant_ht / nullif(f.montant_ttc, 0), 1 / (1 + v_tva / 100)), 2)
      from paiements pa left join factures f on f.id = pa.facture_id
      join clients cl on cl.id = coalesce(pa.client_id, f.client_id)
     where cl.pole_id = p_pole_id and pa.statut = 'reussi'
       and pa.updated_at >= v_debut and pa.updated_at < v_fin
       and not exists (select 1 from bank_transactions bt where bt.matched_paiement_id = pa.id)
    union all
    -- Galeries payées (prix TTC).
    select o.paid_at::date, 'Galerie · commande ' || left(o.id::text, 8), 'galeries',
           round(o.amount_cents / 100.0 / (1 + v_tva / 100), 2)
      from media_orders o join clubs k on k.id = o.club_id join clients cl on cl.id = k.portail_client_id
     where cl.pole_id = p_pole_id and o.paid_at is not null and o.status in ('paid', 'refunded')
       and o.paid_at >= v_debut and o.paid_at < v_fin
  ), remb as (
    select r.rembourse_le::date as jour, 'Remboursement galerie' as libelle, 'galeries' as famille,
           round(r.montant_cents / 100.0 / (1 + v_tva / 100), 2) as ht
      from media_orders_remboursements r join media_orders o on o.id = r.order_id
      join clubs k on k.id = o.club_id join clients cl on cl.id = k.portail_client_id
     where cl.pole_id = p_pole_id and r.rembourse_le >= v_debut and r.rembourse_le < v_fin
    union all
    select a.created_at::date, 'Avoir ' || coalesce(a.numero, ''),
           case when a.prestation_id is not null then 'ponctuelles' else 'abonnements' end, a.montant_ht
      from avoirs a join clients cl on cl.id = a.client_id
     where cl.pole_id = p_pole_id and a.statut in ('emis', 'comptabilise', 'rembourse')
       and a.created_at >= v_debut and a.created_at < v_fin
    union all
    select pa.updated_at::date, 'Paiement remboursé ' || coalesce(f.numero, ''),
           case when coalesce(f.prestation_id, pa.prestation_id) is not null then 'ponctuelles' else 'abonnements' end,
           round(pa.montant * coalesce(f.montant_ht / nullif(f.montant_ttc, 0), 1 / (1 + v_tva / 100)), 2)
      from paiements pa left join factures f on f.id = pa.facture_id
      join clients cl on cl.id = coalesce(pa.client_id, f.client_id)
     where cl.pole_id = p_pole_id and pa.statut = 'rembourse' and pa.updated_at >= v_debut and pa.updated_at < v_fin
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
end $$;
revoke execute on function public.production_remuneration_detail(uuid, uuid, date) from public, anon, authenticated;

-- ── 6. Le montant à valider : le calcul, recopié. Figé dès qu'il est validé. ──
create or replace function public.production_calculer_remuneration(p_pole_id uuid, p_periode date)
returns pole_remuneration_calculs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_periode date := date_trunc('month', p_periode)::date;
  v_benef uuid := responsable_production_du_pole(p_pole_id);
  v_role text;
  v_d jsonb;
  v_row pole_remuneration_calculs;
  v_existant pole_remuneration_calculs;
  v_total numeric;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select role into v_role from profiles where id = auth.uid();
  if not (v_role in ('admin', 'compta', 'sec') or (v_benef is not null and v_benef = auth.uid())) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if v_benef is null then
    raise exception 'Aucun Responsable Production désigné pour ce pôle.' using errcode = 'P0002';
  end if;
  select * into v_existant from pole_remuneration_calculs
   where pole_id = p_pole_id and periode = v_periode and beneficiaire = 'responsable_production';
  if found and v_existant.statut <> 'a_valider' then
    return v_existant;
  end if;

  v_d := production_remuneration_detail(p_pole_id, v_benef, v_periode);
  v_total := (v_d->'fixe'->>'montant')::numeric + (v_d->'coordination'->>'montant_acquis')::numeric
             + (v_d->'ventes'->>'montant')::numeric;

  insert into pole_remuneration_calculs (
    pole_id, responsable_id, periode, beneficiaire, nb_contrats_recurrents, palier_id, hors_grille,
    fixe_mensuel, coordination_nb, coordination_montant, ventes_ca_eligible, ventes_rembourse,
    variable_pct, variable_montant, ventes_montant, total, detail_calcul, statut)
  values (
    p_pole_id, v_benef, v_periode, 'responsable_production', (v_d->'fixe'->>'nb_contrats')::int,
    (select palier_id from pole_palier_du_mois(p_pole_id, v_periode)), (v_d->'fixe'->>'hors_grille')::boolean,
    (v_d->'fixe'->>'montant')::numeric, (v_d->'coordination'->>'nb_acquises')::int, (v_d->'coordination'->>'montant_acquis')::numeric,
    (v_d->'ventes'->>'ca_eligible')::numeric, (v_d->'ventes'->>'rembourse')::numeric,
    (v_d->'ventes'->>'taux_pct')::numeric, (v_d->'ventes'->>'montant')::numeric, (v_d->'ventes'->>'montant')::numeric,
    v_total, v_d, 'a_valider')
  on conflict (pole_id, periode, beneficiaire) do update set
    responsable_id = excluded.responsable_id, nb_contrats_recurrents = excluded.nb_contrats_recurrents,
    palier_id = excluded.palier_id, hors_grille = excluded.hors_grille, fixe_mensuel = excluded.fixe_mensuel,
    coordination_nb = excluded.coordination_nb, coordination_montant = excluded.coordination_montant,
    ventes_ca_eligible = excluded.ventes_ca_eligible, ventes_rembourse = excluded.ventes_rembourse,
    variable_pct = excluded.variable_pct, variable_montant = excluded.variable_montant,
    ventes_montant = excluded.ventes_montant, total = excluded.total, detail_calcul = excluded.detail_calcul,
    updated_at = now()
  returning * into v_row;

  if v_existant.id is null or v_existant.total is distinct from v_row.total then
    insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
    values (auth.uid(), 'calcul', 'pole_remuneration_calculs', v_row.id, v_existant.total, v_row.total,
            jsonb_build_object('beneficiaire', 'responsable_production', 'responsable_id', v_benef, 'periode', v_periode,
                               'regle', 'fixe du palier + coordination acquise + prime ventes encaissées'));
  end if;
  return v_row;
end $$;
revoke execute on function public.production_calculer_remuneration(uuid, date) from public, anon;
grant execute on function public.production_calculer_remuneration(uuid, date) to authenticated;

-- ── 7. Valider, transmettre, payer : jamais sur son propre calcul ──
create or replace function public.production_regler_remuneration(p_calcul_id uuid, p_action text, p_commentaire text default null)
returns pole_remuneration_calculs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text;
  v_row pole_remuneration_calculs;
  v_avant text;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select role into v_role from profiles where id = auth.uid();
  select * into v_row from pole_remuneration_calculs where id = p_calcul_id for update;
  if v_row.id is null or v_row.beneficiaire <> 'responsable_production' then
    raise exception 'Calcul introuvable.' using errcode = 'P0002';
  end if;
  if v_row.responsable_id = auth.uid() then
    raise exception 'Votre propre rémunération est validée par l''Admin ou la comptabilité, et réglée par la comptabilité ou le secrétariat.'
      using errcode = '42501';
  end if;
  v_avant := v_row.statut;
  if p_action = 'valider' and v_role in ('admin', 'compta') and v_row.statut = 'a_valider' then
    update pole_remuneration_calculs set statut = 'valide', valide_par = auth.uid(), valide_le = now(), updated_at = now()
     where id = p_calcul_id returning * into v_row;
  elsif p_action = 'transmettre' and v_role in ('admin', 'compta') and v_row.statut = 'valide' then
    update pole_remuneration_calculs set statut = 'transmis_compta', transmis_par = auth.uid(), transmis_le = now(), updated_at = now()
     where id = p_calcul_id returning * into v_row;
  elsif p_action = 'payer' and v_role in ('admin', 'compta', 'sec') and v_row.statut in ('valide', 'transmis_compta') then
    update pole_remuneration_calculs set statut = 'paye', paye_par = auth.uid(), paye_le = now(), updated_at = now()
     where id = p_calcul_id returning * into v_row;
  elsif p_action = 'rouvrir' and v_role = 'admin' and v_row.statut in ('valide', 'transmis_compta') then
    update pole_remuneration_calculs set statut = 'a_valider', valide_par = null, valide_le = null,
           transmis_par = null, transmis_le = null, updated_at = now()
     where id = p_calcul_id returning * into v_row;
  else
    raise exception 'Action « % » impossible pour votre rôle sur un calcul « % ».', p_action, v_row.statut using errcode = '42501';
  end if;
  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), p_action, 'pole_remuneration_calculs', p_calcul_id, v_row.total, v_row.total,
          jsonb_build_object('statut_avant', v_avant, 'statut_apres', v_row.statut, 'beneficiaire', 'responsable_production',
                             'responsable_id', v_row.responsable_id, 'periode', v_row.periode,
                             'commentaire', nullif(btrim(coalesce(p_commentaire, '')), '')));
  return v_row;
end $$;
revoke execute on function public.production_regler_remuneration(uuid, text, text) from public, anon;
grant execute on function public.production_regler_remuneration(uuid, text, text) to authenticated;

-- ── 8. « Mes finances » : les quatre blocs, les totaux par statut, le détail ligne par ligne ──
create or replace function public.production_mes_finances(p_mois date, p_user uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
  v_role text;
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin date := (date_trunc('month', p_mois) + interval '1 month')::date;
  v_poles jsonb := '[]'::jsonb;
  v_pole record;
  v_d jsonb;
  v_calc pole_remuneration_calculs;
  v_terrain jsonb; v_frais jsonb;
  t_prev numeric := 0; t_acq numeric := 0; t_val numeric := 0; t_paye numeric := 0;
  v_statut text; v_montant numeric;
begin
  select role into v_role from profiles where id = auth.uid();
  if not (v_user = auth.uid() or v_role in ('admin', 'compta', 'sec')) then
    raise exception 'Accès refusé : ces finances ne sont pas les vôtres.' using errcode = '42501';
  end if;

  -- Fixe, coordination, ventes : pour chaque pôle dont la personne est Responsable Production.
  for v_pole in select po.id, po.nom from poles po where responsable_production_du_pole(po.id) = v_user order by po.nom loop
    v_d := production_remuneration_detail(v_pole.id, v_user, v_debut);
    select * into v_calc from pole_remuneration_calculs
     where pole_id = v_pole.id and periode = v_debut and beneficiaire = 'responsable_production';
    -- Statut du bloc mensuel : prévisionnel pendant le mois, acquis ensuite, puis celui du calcul.
    v_statut := case when v_calc.statut in ('valide', 'transmis_compta', 'paye') then v_calc.statut
                     when (v_d->>'mois_termine')::boolean then 'acquis' else 'previsionnel' end;
    -- Une fois validé, c'est le montant validé qui fait foi, pas le recalcul du jour.
    v_montant := case when v_calc.statut in ('valide', 'transmis_compta', 'paye') then v_calc.total
                      else (v_d->'fixe'->>'montant')::numeric + (v_d->'coordination'->>'montant_acquis')::numeric
                           + (v_d->'ventes'->>'montant')::numeric end;
    t_prev := t_prev + (v_d->'fixe'->>'montant')::numeric + (v_d->'coordination'->>'montant_previsionnel')::numeric
              + (v_d->'ventes'->>'montant')::numeric;
    if v_statut <> 'previsionnel' then t_acq := t_acq + v_montant; end if;
    if v_statut in ('valide', 'transmis_compta', 'paye') then t_val := t_val + v_montant; end if;
    if v_statut = 'paye' then t_paye := t_paye + v_montant; end if;
    v_poles := v_poles || jsonb_build_array(v_d || jsonb_build_object(
      'pole', v_pole.nom, 'statut', v_statut, 'montant_mensuel', v_montant,
      'calcul_id', v_calc.id, 'calcul_statut', v_calc.statut, 'valide_le', v_calc.valide_le, 'paye_le', v_calc.paye_le));
  end loop;

  -- Terrain : ses propres affectations acceptées, ce mois-là, missions non annulées.
  select coalesce(jsonb_agg(jsonb_build_object(
           'equipe_id', pe.id, 'prestation_id', p.id, 'reference', p.reference, 'date', p.date_prestation,
           'client', cl.nom, 'libelle', coalesce(nullif(p.equipes, ''), p.type_prestation),
           'montant', coalesce(pe.remuneration, 0), 'recommande', pe.montant_recommande,
           'frais_km', coalesce(pe.frais_km, 0),
           'exception_statut', pe.exception_statut, 'exception_montant', pe.exception_montant,
           'statut', case when pe.statut_paiement = 'payé' then 'paye'
                          when pe.statut_paiement = 'transmis_compta' then 'transmis_compta'
                          when pe.statut_paiement = 'validé' then 'valide'
                          when mission_livree(p.statut) then 'acquis' else 'previsionnel' end)
         order by p.date_prestation, p.reference), '[]'::jsonb)
    into v_terrain
    from prestations_equipe pe join prestations p on p.id = pe.prestation_id left join clients cl on cl.id = p.client_id
   where pe.collaborateur_id = v_user and pe.statut = 'acceptée'
     and p.date_prestation >= v_debut and p.date_prestation < v_fin and p.statut not in ('annulée', 'refusée');

  -- Frais : ses notes de frais du mois (hors refusées), et les km posés sur ses affectations.
  select coalesce(jsonb_agg(x order by x->>'date'), '[]'::jsonb) into v_frais from (
    select jsonb_build_object('source', 'note', 'id', f.id, 'date', f.date_frais, 'type', f.type,
             'libelle', coalesce(nullif(f.description, ''), f.type), 'montant', coalesce(f.montant, 0),
             'statut', case f.statut when 'remboursé' then 'paye' when 'validé' then 'valide' else 'previsionnel' end) x
      from frais f
     where f.collaborateur_id = v_user and f.statut <> 'refusé' and f.date_frais >= v_debut and f.date_frais < v_fin
    union all
    select jsonb_build_object('source', 'mission', 'id', t->>'equipe_id', 'date', t->>'date', 'type', 'km',
             'libelle', 'Déplacement · ' || (t->>'reference'), 'montant', (t->>'frais_km')::numeric, 'statut', t->>'statut')
      from jsonb_array_elements(v_terrain) t where (t->>'frais_km')::numeric > 0
  ) s;

  select t_prev + coalesce(sum((t->>'montant')::numeric), 0),
         t_acq + coalesce(sum((t->>'montant')::numeric) filter (where t->>'statut' <> 'previsionnel'), 0),
         t_val + coalesce(sum((t->>'montant')::numeric) filter (where t->>'statut' in ('valide', 'transmis_compta', 'paye')), 0),
         t_paye + coalesce(sum((t->>'montant')::numeric) filter (where t->>'statut' = 'paye'), 0)
    into t_prev, t_acq, t_val, t_paye
    from jsonb_array_elements(v_terrain || v_frais) t;

  return jsonb_build_object(
    'mois', v_debut, 'user_id', v_user,
    'personne', (select prenom || ' ' || coalesce(nom, '') from profiles where id = v_user),
    'poles', v_poles, 'terrain', v_terrain, 'frais', v_frais,
    'totaux', jsonb_build_object('previsionnel', t_prev, 'acquis', t_acq, 'valide', t_val, 'paye', t_paye,
                                 'restant', t_val - t_paye));
end $$;
revoke execute on function public.production_mes_finances(date, uuid) from public, anon;
grant execute on function public.production_mes_finances(date, uuid) to authenticated;

-- ── 9. Les notes de frais : on ne valide ni ne rembourse les siennes ──
-- La policy frais_update laissait la Production modifier toute note de son pôle, les siennes
-- comprises : elle pouvait se passer « validé », voire « remboursé ».
create or replace function public.proteger_frais()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text;
begin
  if auth.role() = 'service_role' then return new; end if;
  select role into v_role from profiles where id = auth.uid();
  if new.statut is distinct from old.statut then
    if old.collaborateur_id = auth.uid() and v_role is distinct from 'admin' then
      raise exception 'Vos propres frais sont validés par l''Admin ou la comptabilité.' using errcode = '42501';
    end if;
    if new.statut = 'remboursé' and v_role not in ('admin', 'compta', 'sec') then
      raise exception 'Le remboursement relève de la comptabilité ou du secrétariat.' using errcode = '42501';
    end if;
  end if;
  if old.collaborateur_id = auth.uid() and v_role is distinct from 'admin' and old.statut <> 'en_attente'
     and (new.montant is distinct from old.montant or new.km is distinct from old.km) then
    raise exception 'Une note de frais validée ne se modifie plus.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_frais on public.frais;
create trigger trg_proteger_frais before update on public.frais for each row execute function public.proteger_frais();
