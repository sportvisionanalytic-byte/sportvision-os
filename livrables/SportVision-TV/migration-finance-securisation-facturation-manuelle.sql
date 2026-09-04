-- Sécurisation suite au constat du 05/09/2026 : un appel manuel de test de
-- generate_full_com_monthly_invoices() (fonction générique, sans scope) a réellement facturé
-- un vrai contrat de production (Villleneuve 340SC, FAC-2026-0022). Deux correctifs distincts,
-- décision Fouka :
--   A. Neutraliser FAC-2026-0022 (brouillon, jamais supprimée, jamais exportée/envoyée) tant
--      qu'elle n'est pas validée métier, et l'exclure du CA facturé de la vue consolidée.
--   B. Un appel manuel ne peut plus jamais facturer tous les contrats éligibles par défaut :
--      doit préciser des contrats explicites ou passer par dry_run. Seul le cron (contexte
--      interne, auth.uid() null) garde le droit d'agir en mode global.

-- ============================================================================
-- A. FAC-2026-0022 neutralisée, jamais supprimée
-- ============================================================================
update factures
set statut = 'brouillon'
where id = '78ebff90-7532-4427-a38c-a56600de9a90';

insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
values (
  null, 'facture_mise_en_attente_test', 'facture', '78ebff90-7532-4427-a38c-a56600de9a90',
  jsonb_build_object(
    'raison', 'Facture générée lors d''un test manuel du moteur de facturation récurrente le 04/09/2026. Mise en attente (statut brouillon) en attente de validation métier — jamais envoyée au client ni exportée vers Pennylane.',
    'contrat_id', 'a82dac6d-a829-4a17-9136-25808d762158',
    'client', 'Villleneuve 340SC'
  )
);

-- Vue consolidée : une facture 'brouillon' n'est ni facturée ni exigible tant qu'un humain ne
-- l'a pas validée — exclue du CA facturé (et donc du "à encaisser", calculé à partir de lui),
-- même convention que les KPIs Finance déjà existants ailleurs dans l'OS (statut=eq.payee).
create or replace function rpc_finance_consolidated_mensuel(p_mois_debut date default null, p_mois_fin date default null)
returns table (
  mois date,
  ca_facture_ht numeric,
  encaisse numeric,
  a_encaisser numeric,
  rembourse numeric,
  charges numeric,
  cout_equipe numeric,
  resultat_estime_encaisse numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_debut date := coalesce(p_mois_debut, date_trunc('month', now() - interval '11 months')::date);
  v_fin date := coalesce(p_mois_fin, date_trunc('month', now())::date);
begin
  if auth.uid() is not null and not exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'compta')
  ) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  return query
  with mois_serie as (
    select generate_series(v_debut, v_fin, interval '1 month')::date as mois
  ),
  fact as (
    select date_trunc('month', f.date_emission)::date as mois,
      sum(f.montant_ht) filter (where f.statut not in ('annulee', 'brouillon')) as ca_facture_ht,
      sum(f.montant_paye) as encaisse_factures,
      sum(f.montant_ht) filter (where f.statut = 'remboursee') as rembourse_factures
    from factures f
    group by 1
  ),
  media as (
    select date_trunc('month', mo.paid_at)::date as mois,
      sum(mo.amount_cents) filter (where mo.status = 'paid') / 100.0 as encaisse_media,
      sum(mo.amount_cents) filter (where mo.status = 'refunded') / 100.0 as rembourse_media
    from media_orders mo
    where mo.paid_at is not null
    group by 1
  ),
  cout as (
    select date_trunc('month', p.date_prestation)::date as mois,
      sum(pe.remuneration) as cout_equipe
    from prestations_equipe pe
    join prestations p on p.id = pe.prestation_id
    where pe.statut = 'acceptée'
    group by 1
  ),
  ch as (
    select date_trunc('month', e.date_depense)::date as mois,
      sum(e.montant_ht) filter (where e.statut in ('engagee', 'payee', 'comptabilisee')) as charges
    from expenses e
    group by 1
  )
  select
    m.mois,
    coalesce(fact.ca_facture_ht, 0),
    coalesce(fact.encaisse_factures, 0) + coalesce(media.encaisse_media, 0),
    coalesce(fact.ca_facture_ht, 0) - coalesce(fact.encaisse_factures, 0),
    coalesce(fact.rembourse_factures, 0) + coalesce(media.rembourse_media, 0),
    coalesce(ch.charges, 0),
    coalesce(cout.cout_equipe, 0),
    (coalesce(fact.encaisse_factures, 0) + coalesce(media.encaisse_media, 0)) - coalesce(ch.charges, 0) - coalesce(cout.cout_equipe, 0)
  from mois_serie m
  left join fact on fact.mois = m.mois
  left join media on media.mois = m.mois
  left join cout on cout.mois = m.mois
  left join ch on ch.mois = m.mois
  order by m.mois desc;
end;
$function$;

-- ============================================================================
-- B. Appel manuel jamais global par défaut — cron seul autorisé en mode global
-- ============================================================================
drop function if exists generate_full_com_monthly_invoices();
drop function if exists generate_full_com_monthly_invoices(uuid[], boolean);

create or replace function generate_full_com_monthly_invoices(
  p_contract_ids uuid[] default null,
  p_dry_run boolean default false
)
returns table (
  contrat_id uuid,
  client_id uuid,
  period_start date,
  montant_ht numeric,
  resultat text,
  facture_id uuid
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_period date := date_trunc('month', now())::date;
  -- auth.uid() est NULL quand la fonction est appelée directement en SQL par pg_cron (contexte
  -- interne de confiance, hors PostgREST) — c'est la seule façon dont un appel "global" (tous
  -- les contrats éligibles) reste possible. Tout appel avec une identité JWT réelle (staff via
  -- l'OS, un dev via l'API) est un appel manuel et tombe sous le garde-fou ci-dessous.
  v_is_cron boolean := auth.uid() is null;
  v_contrat record;
  v_facture_id uuid;
  v_ttc numeric;
begin
  if not v_is_cron then
    if not exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec')) then
      raise exception 'Accès refusé.' using errcode = '42501';
    end if;
    if not p_dry_run and (p_contract_ids is null or coalesce(array_length(p_contract_ids, 1), 0) = 0) then
      raise exception 'Un appel manuel doit préciser p_contract_ids (liste explicite de contrats) ou p_dry_run=true — jamais un scope vide en production.' using errcode = '42501';
    end if;
  end if;

  for v_contrat in
    select c.id, c.client_id, c.montant_mensuel, c.tva_pct
    from contrats c
    where c.type_contrat = 'full_communication' and c.statut = 'actif' and c.auto_invoice_enabled = true
      and (p_contract_ids is null or c.id = any(p_contract_ids))
  loop
    if exists (
      select 1 from full_com_billing_periods fcbp
      where fcbp.contrat_id = v_contrat.id and fcbp.period_start = v_period
    ) then
      continue;
    end if;

    if v_contrat.montant_mensuel is null or v_contrat.montant_mensuel <= 0 then
      if not p_dry_run then
        insert into full_com_billing_periods (contrat_id, client_id, period_start, skipped_reason)
        values (v_contrat.id, v_contrat.client_id, v_period, 'montant_mensuel absent ou nul');
        perform notify_staff_by_role(
          array['admin', 'sec'],
          'Échéance Full Com non facturée',
          'Le contrat Full Communication du client concerné n''a pas de montant mensuel défini — aucune facture générée ce mois-ci.',
          'haute', null, v_contrat.client_id
        );
      end if;
      contrat_id := v_contrat.id; client_id := v_contrat.client_id; period_start := v_period;
      montant_ht := null;
      resultat := case when p_dry_run then 'ignoree_montant_absent_dry_run' else 'ignoree_montant_absent' end;
      facture_id := null;
      return next;
      continue;
    end if;

    if p_dry_run then
      contrat_id := v_contrat.id; client_id := v_contrat.client_id; period_start := v_period;
      montant_ht := v_contrat.montant_mensuel; resultat := 'candidat_dry_run'; facture_id := null;
      return next;
      continue;
    end if;

    v_ttc := v_contrat.montant_mensuel * (1 + coalesce(v_contrat.tva_pct, 20) / 100.0);

    insert into factures (client_id, type_facture, montant_ht, tva_pct, montant_ttc, statut, date_emission, date_echeance, lignes)
    values (
      v_contrat.client_id, 'totalite', v_contrat.montant_mensuel, coalesce(v_contrat.tva_pct, 20), v_ttc,
      'emise', current_date, current_date + interval '30 days',
      jsonb_build_array(jsonb_build_object(
        'libelle', 'Full Communication — ' || to_char(v_period, 'TMMonth YYYY'),
        'montant_ht', v_contrat.montant_mensuel
      ))
    )
    returning id into v_facture_id;

    insert into full_com_billing_periods (contrat_id, client_id, period_start, facture_id)
    values (v_contrat.id, v_contrat.client_id, v_period, v_facture_id);

    insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
    values (
      (select id from profiles where id = auth.uid()), 'full_com_invoice_generated', 'facture', v_facture_id,
      jsonb_build_object('contrat_id', v_contrat.id, 'client_id', v_contrat.client_id, 'period_start', v_period, 'montant_ht', v_contrat.montant_mensuel)
    );

    contrat_id := v_contrat.id; client_id := v_contrat.client_id; period_start := v_period;
    montant_ht := v_contrat.montant_mensuel; resultat := 'facture_creee'; facture_id := v_facture_id;
    return next;
  end loop;

  -- Contrats explicitement exclus (auto_invoice_enabled = false), jamais silencieux.
  for v_contrat in
    select c.id, c.client_id, c.montant_mensuel
    from contrats c
    where c.type_contrat = 'full_communication' and c.statut = 'actif' and c.auto_invoice_enabled = false
      and (p_contract_ids is null or c.id = any(p_contract_ids))
      and not exists (
        select 1 from full_com_billing_periods fcbp where fcbp.contrat_id = c.id and fcbp.period_start = v_period
      )
  loop
    contrat_id := v_contrat.id; client_id := v_contrat.client_id; period_start := v_period;
    montant_ht := v_contrat.montant_mensuel; resultat := 'exclu_manuellement'; facture_id := null;
    return next;
  end loop;
end;
$function$;

revoke all on function generate_full_com_monthly_invoices(uuid[], boolean) from public;
grant execute on function generate_full_com_monthly_invoices(uuid[], boolean) to authenticated;

comment on function generate_full_com_monthly_invoices(uuid[], boolean) is
  'Échéance mensuelle Full Communication. SÉCURISÉ le 05/09/2026 suite à FAC-2026-0022 : un '
  'appel avec une identité JWT réelle (staff/dev) DOIT préciser p_contract_ids ou p_dry_run=true '
  '— ne peut jamais facturer tous les contrats éligibles par défaut. Seul pg_cron (auth.uid() '
  'null, contexte interne) garde le droit d''agir en mode global, via le job '
  '''sportvision-facturation-full-com-mensuelle''.';
