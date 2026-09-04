-- Exclusion temporaire et réversible d'un contrat Full Com du moteur de facturation
-- automatique, sans toucher au cron global (décision Fouka, 05/09/2026, suite au signalement
-- du risque sur "Villleneuve 340SC"). Le moteur global (generate_full_com_monthly_invoices,
-- migration-finance-consolidation-facturation-recurrente.sql) reste actif et inchangé pour tous
-- les autres contrats éligibles.

alter table contrats add column if not exists auto_invoice_enabled boolean not null default true;
comment on column contrats.auto_invoice_enabled is
  'Coupe-circuit par contrat pour generate_full_com_monthly_invoices() (audit 05/09/2026) : '
  'false = ce contrat précis est exclu de la facturation automatique mensuelle, tracé et '
  'réversible, sans désactiver le moteur pour les autres contrats.';

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
    where c.type_contrat = 'full_communication' and c.statut = 'actif' and c.auto_invoice_enabled = true
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

  -- Contrats explicitement exclus ce mois-ci (auto_invoice_enabled = false) : tracés dans le
  -- résultat de l'appel, jamais silencieux, sans écrire dans full_com_billing_periods (une
  -- exclusion n'est pas une période traitée — la réactiver doit permettre une vraie facturation
  -- immédiate au prochain appel, pas un skip figé par une ligne d'idempotence).
  for v_contrat in
    select c.id, c.client_id
    from contrats c
    where c.type_contrat = 'full_communication' and c.statut = 'actif' and c.auto_invoice_enabled = false
      and not exists (
        select 1 from full_com_billing_periods fcbp where fcbp.contrat_id = c.id and fcbp.period_start = v_period
      )
  loop
    contrat_id := v_contrat.id; client_id := v_contrat.client_id; resultat := 'exclu_manuellement'; facture_id := null;
    return next;
  end loop;
end;
$function$;

-- Exclusion effective pour Villleneuve 340SC : historique vérifié le 05/09/2026 (voir mémoire
-- de l'audit) — aucune facture ni paiement antérieur à celle générée automatiquement le
-- 04/09/2026 (FAC-2026-0022, 500€HT/600€TTC, non payée, jamais synchronisée Pennylane).
-- Exclusion posée par précaution le temps que Fouka confirme le mode de facturation voulu pour
-- ce client précis — à lever explicitement une fois confirmé, pas automatiquement.
update contrats
set auto_invoice_enabled = false
where id = 'a82dac6d-a829-4a17-9136-25808d762158';
