-- P2 audit transversal (findings J67/J69), dernière brique du backlog post-audit (décision
-- Fouka 05/09) : (A) une vue consolidée Finance qui distingue CA facturé / encaissé / à
-- encaisser / remboursé / charges / coût équipe / résultat estimé (base caisse, jamais
-- fusionnés artificiellement — chaque colonne reste isolée, §38) ; (B) une échéance mensuelle
-- réelle pour les contrats Full Communication actifs (aucune facture générée automatiquement
-- aujourd'hui). Ni l'un ni l'autre ne duplique les transactions dans une 4e table (§36) : la
-- vue lit factures/media_orders/expenses/prestations_equipe telles quelles, la facturation
-- récurrente écrit dans `factures` (déjà la table de référence), avec une seule table
-- d'audit dédiée (full_com_billing_periods) pour garantir l'idempotence par période.

-- ============================================================================
-- A. Vue consolidée mensuelle (RPC plutôt qu'une vraie VIEW : les tables sources ont des RLS
-- financières fines déjà en place, une VIEW simple hériterait d'une visibilité incohérente
-- selon le rôle appelant — même contrainte déjà rencontrée cette session pour media_orders).
-- ============================================================================
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
      sum(f.montant_ht) filter (where f.statut <> 'annulee') as ca_facture_ht,
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

revoke all on function rpc_finance_consolidated_mensuel(date, date) from public;
grant execute on function rpc_finance_consolidated_mensuel(date, date) to authenticated;

comment on function rpc_finance_consolidated_mensuel(date, date) is
  'Finance consolidée mensuelle (§34-38, audit 04-05/09/2026) : CA facturé, encaissé, à '
  'encaisser, remboursé, charges, coût équipe, résultat estimé (base caisse). Trésorerie '
  'volontairement absente : aucun rapprochement bancaire cumulé fiable n''existe aujourd''hui '
  '(voir finding J70), l''afficher ici serait fabriquer un chiffre non vérifié.';

-- ============================================================================
-- B. Facturation récurrente Full Communication (§39-41)
-- ============================================================================
create table if not exists full_com_billing_periods (
  id uuid primary key default gen_random_uuid(),
  contrat_id uuid not null references contrats(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  period_start date not null,
  facture_id uuid references factures(id) on delete set null,
  skipped_reason text,
  created_at timestamptz not null default now(),
  unique (contrat_id, period_start)
);
comment on table full_com_billing_periods is
  'Trace une échéance mensuelle Full Communication déjà traitée (facturée ou explicitement '
  'ignorée) — garantit qu''un même contrat/mois ne génère jamais 2 factures (§40).';

alter table full_com_billing_periods enable row level security;
drop policy if exists "fcbp_staff_select" on full_com_billing_periods;
create policy "fcbp_staff_select" on full_com_billing_periods for select
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'compta')));

-- Idempotent par (contrat, mois courant) — jamais de backfill automatique des mois passés :
-- un contrat déjà actif depuis longtemps au moment de l'exécution ne génère qu'une seule
-- facture, celle du mois en cours, jamais un historique reconstitué qui pourrait surprendre.
-- Skip explicite (jamais silencieux) si montant_mensuel absent/nul (finding C1a).
create or replace function generate_full_com_monthly_invoices()
returns table (contrat_id uuid, client_id uuid, resultat text, facture_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_period date := date_trunc('month', now())::date;
  v_contrat record;
  v_facture_id uuid;
  v_ttc numeric;
begin
  if auth.uid() is not null and not exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'sec')
  ) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  for v_contrat in
    select c.id, c.client_id, c.montant_mensuel, c.tva_pct
    from contrats c
    where c.type_contrat = 'full_communication' and c.statut = 'actif'
  loop
    if exists (
      select 1 from full_com_billing_periods fcbp
      where fcbp.contrat_id = v_contrat.id and fcbp.period_start = v_period
    ) then
      continue;
    end if;

    if v_contrat.montant_mensuel is null or v_contrat.montant_mensuel <= 0 then
      insert into full_com_billing_periods (contrat_id, client_id, period_start, skipped_reason)
      values (v_contrat.id, v_contrat.client_id, v_period, 'montant_mensuel absent ou nul');
      perform notify_staff_by_role(
        array['admin', 'sec'],
        'Échéance Full Com non facturée',
        'Le contrat Full Communication du client concerné n''a pas de montant mensuel défini — aucune facture générée ce mois-ci.',
        'haute', null, v_contrat.client_id
      );
      contrat_id := v_contrat.id; client_id := v_contrat.client_id; resultat := 'ignoree_montant_absent'; facture_id := null;
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

    contrat_id := v_contrat.id; client_id := v_contrat.client_id; resultat := 'facture_creee'; facture_id := v_facture_id;
    return next;
  end loop;
end;
$function$;

revoke all on function generate_full_com_monthly_invoices() from public;
grant execute on function generate_full_com_monthly_invoices() to authenticated;

comment on function generate_full_com_monthly_invoices() is
  'Échéance mensuelle Full Communication (§39-41, audit 04-05/09/2026). Idempotent par '
  '(contrat, mois courant) via full_com_billing_periods, jamais de backfill des mois passés. '
  'Skip explicite + notification staff si montant_mensuel absent (jamais une facture à 0€).';

select cron.schedule(
  'sportvision-facturation-full-com-mensuelle',
  '0 6 1 * *',
  $$select generate_full_com_monthly_invoices();$$
) where not exists (select 1 from cron.job where jobname = 'sportvision-facturation-full-com-mensuelle');
