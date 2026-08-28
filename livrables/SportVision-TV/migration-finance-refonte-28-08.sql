-- ============================================================================
-- Migration : Refonte module Finance (28/08/2026, nuit)
-- ============================================================================
-- Contexte : audit du soir confirme que le socle transactionnel (factures,
-- paiements, devis, expenses, frais, employee_costs, v_rentabilite_missions)
-- est déjà solide et en prod. Cette migration n'ajoute QUE les deux morceaux
-- réellement absents identifiés par l'audit :
--   1. Un vrai générateur de charges récurrentes (expenses.recurrence était
--      purement déclaratif, aucun moteur ne régénérait une occurrence).
--   2. Un vrai moteur de rapprochement bancaire (loadRapprochement() existant
--      n'était qu'un suivi de statut manuel sur `prestations`, aucune table
--      de transactions bancaires normalisées n'existait).
--
-- Connecteur bancaire : aucune credential Revolut/Qonto n'est configurée ce
-- soir (.env vérifié) et Revolut Business ne propose pas d'API OAuth simple
-- à brancher sans pouvoir tester en conditions réelles. Décision : livrer un
-- provider 'csv_import' (Revolut Business permet l'export CSV de ses
-- transactions) comme première brique RÉELLEMENT UTILISABLE ce soir, avec un
-- schéma `bank_transactions.provider` déjà multi-provider (csv_import /
-- revolut / qonto) pour qu'un futur chantier ajoute l'API sans re-migrer.
--
-- Idempotente de bout en bout (create/alter ... if not exists, drop policy
-- if exists avant recreate) — aucune donnée financière existante n'est
-- modifiée par cette migration (uniquement des ajouts de colonnes nullables,
-- de tables neuves et de fonctions).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. GÉNÉRATEUR DE CHARGES RÉCURRENTES
-- ────────────────────────────────────────────────────────────────────────
-- expenses.recurrence existe déjà (migration-finance-lot0.sql) mais reste une
-- simple étiquette sur UNE ligne : rien ne créait l'occurrence suivante à
-- l'échéance. On ajoute une traçabilité générateur→occurrence + une clé
-- unique stricte pour garantir l'idempotence même si la fonction est
-- rejouée ou appelée en concurrence.

alter table expenses add column if not exists source_expense_id uuid references expenses(id) on delete set null;
alter table expenses add column if not exists periode_recurrence date;
comment on column expenses.source_expense_id is 'Si renseigné, cette ligne est une occurrence générée automatiquement à partir de la ligne récurrente source (cf. fin_generer_depenses_recurrentes).';
comment on column expenses.periode_recurrence is 'Échéance (date_prochaine_echeance du modèle au moment de la génération) que cette occurrence couvre — sert de clé d''idempotence avec source_expense_id.';

create unique index if not exists uq_expenses_recurrence_periode
  on expenses(source_expense_id, periode_recurrence)
  where source_expense_id is not null;

-- Génère, pour chaque ligne `expenses` récurrente (recurrence <> 'ponctuelle')
-- dont l'échéance (date_prochaine_echeance) est passée, une nouvelle
-- occurrence 'ponctuelle' (statut 'prevue'), puis avance l'échéance du
-- modèle. Idempotente : l'index unique ci-dessus empêche toute double
-- création si la fonction est rejouée (ON CONFLICT DO NOTHING) ; bornée à
-- 36 occurrences par appel et par ligne pour éviter toute boucle infinie si
-- une échéance est restée bloquée très longtemps dans le passé.
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

    -- avance l'échéance du modèle à la prochaine occurrence future
    update expenses set date_prochaine_echeance = v_next where id = r.id and date_prochaine_echeance is distinct from v_next;
  end loop;
  return;
end;
$$;

comment on function fin_generer_depenses_recurrentes() is 'Génère les occurrences dues des dépenses récurrentes (expenses.recurrence). Idempotente (index unique source_expense_id+periode_recurrence). Appelée depuis la page Dépenses (admin.findepenses) à chaque chargement + bouton manuel "Générer les échéances dues".';

-- Autorisation d'exécution : mêmes rôles que la gestion des dépenses.
revoke all on function fin_generer_depenses_recurrentes() from public;
grant execute on function fin_generer_depenses_recurrentes() to authenticated;
-- (la fonction est SECURITY DEFINER et ne fait qu'insérer/mettre à jour `expenses` de
-- façon bornée et idempotente ; le filtrage par rôle réel se fait dans l'app — admin/compta
-- uniquement appellent ce RPC, cf. VIEWS['admin.findepenses'] — cohérent avec le fait que
-- `expenses_manage` RLS limite de toute façon les effets à ce que admin/compta pourraient
-- déjà faire manuellement ligne par ligne).


-- ────────────────────────────────────────────────────────────────────────
-- 2. RAPPROCHEMENT BANCAIRE — transactions normalisées multi-provider
-- ────────────────────────────────────────────────────────────────────────
-- Aucune table de ce type n'existait avant cette migration (confirmé par
-- l'audit du soir : zéro edge function bancaire parmi les fonctions
-- existantes, zéro table de transactions). Schéma volontairement abstrait
-- côté provider pour ne pas re-migrer quand une vraie intégration API
-- (Revolut/Qonto) sera branchée — seule 'csv_import' est alimentée ce soir.

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'csv_import' check (provider in ('csv_import','revolut','qonto')),
  provider_account_id text,
  -- Identifiant unique côté provider. Pour 'csv_import', les exports bancaires n'ont pas
  -- toujours un ID stable par ligne : à défaut, l'import génère une clé déterministe
  -- (date|montant|libellé tronqué) côté client — cf. _finCsvRowKey() dans l'OS — pour que
  -- réimporter deux fois le même fichier ne duplique jamais les lignes (contrainte unique
  -- ci-dessous).
  provider_transaction_id text not null,
  booking_date date not null,
  amount numeric(12,2) not null,
  currency text not null default 'EUR',
  description text,
  counterparty text,
  raw_reference text,
  status text not null default 'a_traiter' check (status in ('a_traiter','rapprochee','ignoree')),
  matched_facture_id uuid references factures(id) on delete set null,
  matched_expense_id uuid references expenses(id) on delete set null,
  matched_paiement_id uuid references paiements(id) on delete set null,
  match_score numeric(5,2),
  match_method text,
  import_batch_id uuid,
  imported_by uuid references profiles(id) on delete set null,
  imported_at timestamptz not null default now(),
  reconciled_at timestamptz,
  reconciled_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_account_id, provider_transaction_id)
);

create index if not exists idx_bank_tx_status on bank_transactions(status);
create index if not exists idx_bank_tx_date on bank_transactions(booking_date);
create index if not exists idx_bank_tx_facture on bank_transactions(matched_facture_id) where matched_facture_id is not null;
create index if not exists idx_bank_tx_expense on bank_transactions(matched_expense_id) where matched_expense_id is not null;

drop trigger if exists trg_bank_transactions_upd on bank_transactions;
create trigger trg_bank_transactions_upd before update on bank_transactions
  for each row execute procedure update_updated_at_generic();

alter table bank_transactions enable row level security;

drop policy if exists "bank_transactions_manage" on bank_transactions;
create policy "bank_transactions_manage" on bank_transactions for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);
drop policy if exists "bank_transactions_read" on bank_transactions;
create policy "bank_transactions_read" on bank_transactions for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);

comment on table bank_transactions is 'Transactions bancaires normalisées, multi-provider (csv_import actif, revolut/qonto réservés pour une future intégration API). Alimentée ce soir uniquement via import CSV manuel (Revolut Business export) — cf. modalImporterCSVBancaire() dans SportVision-OS-Full.html.';

-- Suggestions de rapprochement pour UNE transaction : candidates factures
-- (si transaction positive = encaissement) ou expenses (si transaction
-- négative = dépense), scorées sur montant exact/proche, référence
-- retrouvée dans le libellé, nom de contrepartie retrouvé dans le nom
-- client/fournisseur, et proximité de date. Ne modifie rien : lecture
-- seule, l'action de rapprochement reste un choix explicite de
-- l'utilisateur (cf. fin_rapprocher_transaction).
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

revoke all on function fin_suggerer_rapprochements(uuid) from public;
grant execute on function fin_suggerer_rapprochements(uuid) to authenticated;

-- Action de rapprochement explicite : marque la transaction comme
-- 'rapprochee' et met à jour la facture (montant_paye + statut, plus une
-- ligne `paiements` traçant l'encaissement bancaire) ou la dépense
-- (statut='payee'). Idempotente au niveau transaction : si la transaction
-- est déjà 'rapprochee', la fonction est un no-op qui renvoie
-- already_reconciled=true SANS retoucher facture/dépense — rejouer l'appel
-- (double-clic, retry réseau) ne peut donc jamais dupliquer un paiement.
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

revoke all on function fin_rapprocher_transaction(uuid,uuid,uuid) from public;
grant execute on function fin_rapprocher_transaction(uuid,uuid,uuid) to authenticated;

-- Marque une transaction comme "ignorée" (ex. virement interne, mouvement
-- hors périmètre facturation/dépenses) sans la rapprocher à rien — reste
-- consultable, sort juste du filtre "à traiter".
create or replace function fin_ignorer_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update bank_transactions set status='ignoree', reconciled_at=now(), reconciled_by=auth.uid()
    where id = p_transaction_id and status = 'a_traiter';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'introuvable_ou_deja_traitee');
  end if;
  return jsonb_build_object('ok', true, 'transaction_id', p_transaction_id);
end;
$$;

revoke all on function fin_ignorer_transaction(uuid) from public;
grant execute on function fin_ignorer_transaction(uuid) to authenticated;
