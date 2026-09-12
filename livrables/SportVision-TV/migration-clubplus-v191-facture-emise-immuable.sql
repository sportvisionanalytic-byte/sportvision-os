-- v191 — Une facture émise devient immuable (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. L'écran d'émission dit au staff que le document devient définitif. La base
-- ne l'imposait nulle part : la policy `factures_staff` est en ALL, aucun trigger ne protégeait
-- quoi que ce soit. Numéro, lignes, montants, taux de TVA, date d'émission, client : tout restait
-- modifiable après émission, et la ligne restait supprimable sans laisser de trace. Une facture
-- est une pièce comptable : la réécrire ou l'effacer n'est pas une option, c'est un avoir qu'il
-- faut émettre.
--
-- CE QUE FAIT CETTE MIGRATION. Dès que le statut quitte 'brouillon', les éléments comptables sont
-- figés. Ce qui doit continuer de vivre continue : le statut, le montant payé, les références
-- Pennylane, le lien vers le PDF. Et la suppression n'est plus possible que sur un brouillon.
--
-- Le service role est soumis à la même règle : ce n'est pas une question de droits, c'est une
-- question de validité du document. Les corrections d'exploitation passent par un avoir.
-- Idempotente.

create or replace function public.proteger_facture_emise()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'DELETE' then
    if old.statut is distinct from 'brouillon' then
      raise exception 'La facture % est émise : elle ne peut plus être supprimée. Émettez un avoir.',
        coalesce(old.numero, '(sans numéro)') using errcode = '42501';
    end if;
    return old;
  end if;

  if old.statut is distinct from 'brouillon' then
    if new.numero is distinct from old.numero
       or new.lignes is distinct from old.lignes
       or new.montant_ht is distinct from old.montant_ht
       or new.tva_pct is distinct from old.tva_pct
       or new.montant_ttc is distinct from old.montant_ttc
       or new.date_emission is distinct from old.date_emission
       or new.client_id is distinct from old.client_id
       or new.prestation_id is distinct from old.prestation_id
       or new.devis_id is distinct from old.devis_id
       or new.type_facture is distinct from old.type_facture then
      raise exception 'La facture % est émise : son montant, son détail, sa date et son client sont figés. Émettez un avoir pour la corriger.',
        coalesce(old.numero, '(sans numéro)') using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists proteger_facture_emise on factures;
create trigger proteger_facture_emise
  before update or delete on factures
  for each row execute function proteger_facture_emise();
