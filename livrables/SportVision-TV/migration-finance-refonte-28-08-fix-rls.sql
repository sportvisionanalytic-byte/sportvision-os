-- ============================================================================
-- migration-finance-refonte-28-08-fix-rls.sql
-- ============================================================================
-- Correctif de sécurité sur migration-finance-refonte-28-08.sql, appliqué
-- avant merge (relecture du 28/08/2026 soir). Les 4 fonctions RPC créées par
-- cette migration sont SECURITY DEFINER avec `grant execute ... to
-- authenticated` — donc bypass RLS par construction — mais AUCUNE ne
-- revérifiait le rôle de l'appelant à l'intérieur du corps de la fonction.
-- N'importe quel compte authentifié du projet (Club+, Connect, CM externe...)
-- pouvait donc appeler ces RPC directement via PostgREST et manipuler des
-- factures/dépenses réelles (marquer payé, créer des lignes `paiements`,
-- générer des dépenses), ou lire des montants de factures via la fonction de
-- suggestion. Toutes les autres fonctions SECURITY DEFINER écrites ce soir
-- (provisionner_club_plus_full_com, generate_missions_from_plan,
-- enforce_cm_single_correction_per_postprod...) revérifient systématiquement
-- le rôle via auth.uid() — cette migration réaligne Finance sur ce même
-- principe, jamais confiance dans le fait que seule l'UI admin appelle ces
-- RPC.
--
-- Additif et idempotent (create or replace), aucune donnée touchée.
-- ============================================================================

create or replace function fin_generer_depenses_recurrentes()
returns table(nouvelle_depense_id uuid, source_id uuid, periode date)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_periode date;
  v_new_id uuid;
  v_iter int;
  v_next date;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta')) then
    raise exception 'Accès refusé : réservé à l''administration/comptabilité.';
  end if;

  for r in
    select * from expenses
    where recurrence in ('mensuelle','trimestrielle','annuelle')
      and date_prochaine_echeance is not null
      and date_prochaine_echeance <= current_date
  loop
    v_iter := 0;
    v_next := r.date_prochaine_echeance;
    while v_next <= current_date and v_iter < 36 loop
      v_periode := v_next;
      v_new_id := null;

      insert into expenses(
        vendor_id, prestation_id, categorie, libelle, montant_ht, tva_pct, montant_ttc,
        recurrence, date_depense, date_prochaine_echeance, statut, justificatif_url,
        created_by, source_expense_id, periode_recurrence
      ) values (
        r.vendor_id, r.prestation_id, r.categorie, r.libelle, r.montant_ht, r.tva_pct, r.montant_ttc,
        'ponctuelle', v_periode, null, 'prevue', null,
        r.created_by, r.id, v_periode
      )
      on conflict (source_expense_id, periode_recurrence) where source_expense_id is not null do nothing
      returning id into v_new_id;

      if v_new_id is not null then
        nouvelle_depense_id := v_new_id;
        source_id := r.id;
        periode := v_periode;
        return next;
      end if;

      v_next := case r.recurrence
        when 'mensuelle' then v_next + interval '1 month'
        when 'trimestrielle' then v_next + interval '3 months'
        when 'annuelle' then v_next + interval '1 year'
      end::date;
      v_iter := v_iter + 1;
    end loop;

    update expenses set date_prochaine_echeance = v_next where id = r.id and date_prochaine_echeance is distinct from v_next;
  end loop;
  return;
end;
$$;

create or replace function fin_suggerer_rapprochements(p_transaction_id uuid)
returns table(
  cible_type text,
  cible_id uuid,
  libelle text,
  montant numeric,
  score numeric,
  raison text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx bank_transactions;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur')) then
    raise exception 'Accès refusé : réservé à l''administration/comptabilité.';
  end if;

  select * into v_tx from bank_transactions where id = p_transaction_id;
  if not found then raise exception 'Transaction introuvable'; end if;

  if v_tx.amount >= 0 then
    return query
    select
      'facture'::text,
      f.id,
      coalesce(f.numero,'Facture')||' — '||coalesce(c.nom,'Client inconnu'),
      (f.montant_ttc - coalesce(f.montant_paye,0)),
      (
        (case when abs((f.montant_ttc - coalesce(f.montant_paye,0)) - v_tx.amount) < 0.01 then 50
              when abs((f.montant_ttc - coalesce(f.montant_paye,0)) - v_tx.amount) <= greatest(v_tx.amount*0.02, 1) then 30
              else 0 end)
        + (case when f.numero is not null and v_tx.description ilike '%'||f.numero||'%' then 30 else 0 end)
        + (case when c.nom is not null and (v_tx.description ilike '%'||c.nom||'%' or v_tx.counterparty ilike '%'||c.nom||'%') then 20 else 0 end)
        + (case when abs(f.date_echeance - v_tx.booking_date) <= 3 then 10
                when abs(f.date_echeance - v_tx.booking_date) <= 15 then 5
                else 0 end)
      )::numeric as score,
      trim(
        (case when abs((f.montant_ttc - coalesce(f.montant_paye,0)) - v_tx.amount) < 0.01 then 'montant exact ' else '' end) ||
        (case when f.numero is not null and v_tx.description ilike '%'||f.numero||'%' then 'référence trouvée ' else '' end) ||
        (case when c.nom is not null and (v_tx.description ilike '%'||c.nom||'%' or v_tx.counterparty ilike '%'||c.nom||'%') then 'client trouvé ' else '' end)
      )
    from factures f
    left join clients c on c.id = f.client_id
    where f.statut in ('emise','partiellement_payee','en_retard')
      and (f.montant_ttc - coalesce(f.montant_paye,0)) > 0
      and f.date_emission >= v_tx.booking_date - interval '90 days'
    order by 5 desc
    limit 5;
  else
    return query
    select
      'depense'::text,
      e.id,
      coalesce(e.libelle,'Dépense')||' — '||coalesce(v.nom,'Fournisseur inconnu'),
      e.montant_ttc,
      (
        (case when abs(e.montant_ttc - abs(v_tx.amount)) < 0.01 then 50
              when abs(e.montant_ttc - abs(v_tx.amount)) <= greatest(abs(v_tx.amount)*0.02, 1) then 30
              else 0 end)
        + (case when v.nom is not null and (v_tx.description ilike '%'||v.nom||'%' or v_tx.counterparty ilike '%'||v.nom||'%') then 30 else 0 end)
        + (case when abs(coalesce(e.date_prochaine_echeance, e.date_depense) - v_tx.booking_date) <= 3 then 10
                when abs(coalesce(e.date_prochaine_echeance, e.date_depense) - v_tx.booking_date) <= 15 then 5
                else 0 end)
      )::numeric as score,
      trim(
        (case when abs(e.montant_ttc - abs(v_tx.amount)) < 0.01 then 'montant exact ' else '' end) ||
        (case when v.nom is not null and (v_tx.description ilike '%'||v.nom||'%' or v_tx.counterparty ilike '%'||v.nom||'%') then 'fournisseur trouvé ' else '' end)
      )
    from expenses e
    left join vendors v on v.id = e.vendor_id
    where e.statut in ('prevue','engagee')
      and e.date_depense >= v_tx.booking_date - interval '90 days'
    order by 5 desc
    limit 5;
  end if;
end;
$$;

create or replace function fin_rapprocher_transaction(
  p_transaction_id uuid,
  p_facture_id uuid default null,
  p_expense_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx bank_transactions;
  v_facture factures;
  v_new_montant_paye numeric;
  v_new_statut text;
  v_paiement_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta')) then
    raise exception 'Accès refusé : réservé à l''administration/comptabilité.';
  end if;

  if p_facture_id is null and p_expense_id is null then
    raise exception 'Aucune cible de rapprochement fournie (facture ou dépense).';
  end if;
  if p_facture_id is not null and p_expense_id is not null then
    raise exception 'Une seule cible à la fois (facture OU dépense).';
  end if;

  select * into v_tx from bank_transactions where id = p_transaction_id for update;
  if not found then raise exception 'Transaction introuvable'; end if;

  if v_tx.status = 'rapprochee' then
    return jsonb_build_object('already_reconciled', true, 'transaction_id', v_tx.id);
  end if;

  if p_facture_id is not null then
    select * into v_facture from factures where id = p_facture_id for update;
    if not found then raise exception 'Facture introuvable'; end if;

    v_new_montant_paye := coalesce(v_facture.montant_paye,0) + v_tx.amount;
    v_new_statut := case when v_new_montant_paye >= v_facture.montant_ttc then 'payee' else 'partiellement_payee' end;

    insert into paiements(facture_id, client_id, prestation_id, devis_id, type_paiement, montant, devise, statut, stripe_payment_intent_id, recu_url)
    values (v_facture.id, v_facture.client_id, v_facture.prestation_id, v_facture.devis_id, 'totalite', v_tx.amount, v_tx.currency, 'reussi', 'bank_reconciliation:'||v_tx.id::text, null)
    returning id into v_paiement_id;

    update factures set montant_paye = v_new_montant_paye, statut = v_new_statut where id = p_facture_id;

    update bank_transactions set status='rapprochee', matched_facture_id=p_facture_id, matched_paiement_id=v_paiement_id,
      match_method='manuel', reconciled_at=now(), reconciled_by=auth.uid() where id=p_transaction_id;

    insert into financial_audit_log(acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
    values (auth.uid(), 'rapprochement_bancaire', 'factures', p_facture_id, coalesce(v_facture.montant_paye,0), v_new_montant_paye,
      jsonb_build_object('bank_transaction_id', p_transaction_id, 'paiement_id', v_paiement_id, 'montant', v_tx.amount));

    return jsonb_build_object('ok', true, 'transaction_id', p_transaction_id, 'facture_id', p_facture_id, 'paiement_id', v_paiement_id, 'nouveau_statut', v_new_statut);
  else
    update expenses set statut = 'payee' where id = p_expense_id;
    if not found then raise exception 'Dépense introuvable'; end if;

    update bank_transactions set status='rapprochee', matched_expense_id=p_expense_id,
      match_method='manuel', reconciled_at=now(), reconciled_by=auth.uid() where id=p_transaction_id;

    insert into financial_audit_log(acteur_id, action, table_cible, ligne_id, details)
    values (auth.uid(), 'rapprochement_bancaire', 'expenses', p_expense_id,
      jsonb_build_object('bank_transaction_id', p_transaction_id, 'montant', v_tx.amount));

    return jsonb_build_object('ok', true, 'transaction_id', p_transaction_id, 'expense_id', p_expense_id);
  end if;
end;
$$;

create or replace function fin_ignorer_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta')) then
    raise exception 'Accès refusé : réservé à l''administration/comptabilité.';
  end if;

  update bank_transactions set status='ignoree', reconciled_at=now(), reconciled_by=auth.uid()
    where id = p_transaction_id and status = 'a_traiter';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'introuvable_ou_deja_traitee');
  end if;
  return jsonb_build_object('ok', true, 'transaction_id', p_transaction_id);
end;
$$;
