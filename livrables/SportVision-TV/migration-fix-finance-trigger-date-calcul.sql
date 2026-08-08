-- ============================================================
-- Migration — Corrige le trigger de clôture financière (bloquait
-- l'ajout de toute dépense)
--
-- check_periode_non_clotoree() (migration-finance-lot0.sql) est
-- partagée par deux triggers, sur "expenses" et sur "commissions", et
-- référence en dur new.date_depense (colonne de expenses) ET
-- new.date_calcul (colonne de commissions) dans le même coalesce().
-- En PL/pgSQL, NEW est un type RECORD générique quand la même fonction
-- sert plusieurs tables : chaque champ référencé doit exister sur la
-- ligne réellement passée, sinon Postgres lève immédiatement "record
-- "new" has no field ..." — le coalesce() ne protège pas contre ça,
-- l'accès au champ échoue avant même que sa valeur soit comparée.
-- Résultat : impossible d'ajouter une dépense (expenses n'a pas
-- date_calcul), alors que l'ajout d'une commission fonctionnait.
--
-- Correction : passer par to_jsonb(new)->>'colonne', qui renvoie NULL
-- pour une clé absente au lieu de lever une erreur — fonctionne pour
-- les deux tables sans avoir à dupliquer la fonction.
--
-- Idempotent (create or replace). À exécuter dans Supabase → SQL Editor.
-- ============================================================

create or replace function check_periode_non_clotoree()
returns trigger language plpgsql as $$
declare v_periode text; v_statut text; v_row jsonb;
begin
  v_row := to_jsonb(new);
  v_periode := to_char(
    coalesce(
      (v_row->>'date_depense')::date,
      (v_row->>'date_calcul')::date,
      current_date
    ), 'YYYY-MM'
  );
  select statut into v_statut from accounting_periods where periode = v_periode;
  if v_statut = 'cloturee' then
    raise exception 'La période % est clôturée : impossible d''ajouter ou modifier une écriture.', v_periode;
  end if;
  return new;
end; $$;
