-- v169 : on ne reprend pas à son nom une ligne déjà validée (12/09/2026).
--
-- Trouvé par l'audit du 12/09. Toutes les gardes « jamais juge et partie » de v148 et v149 posent
-- la même question : « la ligne est-elle à moi ? », en regardant collaborateur_id. Or la Production
-- a le droit de changer collaborateur_id. Le contournement tenait donc en trois écritures, hors
-- écran, par l'API :
--   1. créer l'affectation d'un collègue à 500 euros (pas la sienne : aucune garde ne se déclenche),
--   2. la passer « validé » (toujours pas la sienne),
--   3. y écrire son propre identifiant.
-- Aucun contrôle ne se rejouait : la ligne validée devenait la sienne. Même chose sur les notes de
-- frais.
--
-- Deux règles, simples et vérifiables :
--   • on ne se met jamais soi-même sur une affectation ou un frais existant (l'Admin seul le peut,
--     par exemple pour corriger une saisie) ;
--   • réattribuer une ligne à quelqu'un d'autre remet son circuit de paiement à zéro et recalcule
--     le montant recommandé pour cette personne : une rémunération suit celui qui a fait la
--     mission, elle ne se transporte pas.
-- Test : tests/reattribution-ligne-financiere.test.sql

create or replace function public.proteger_reattribution_affectation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text;
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.collaborateur_id is not distinct from old.collaborateur_id then return new; end if;

  select role into v_role from profiles where id = auth.uid();

  if new.collaborateur_id = auth.uid() and v_role is distinct from 'admin' then
    raise exception 'Une affectation existante ne se reprend pas à son nom. Créez la vôtre, elle suivra la grille.'
      using errcode = '42501';
  end if;

  -- La ligne change de titulaire : son paiement repart de zéro, et le montant recommandé est celui
  -- du nouveau titulaire, pas de l'ancien.
  if coalesce(old.statut_paiement, 'en_attente') <> 'en_attente' then
    new.statut_paiement := 'en_attente';
    new.date_paiement := null;
  end if;
  new.montant_recommande := remuneration_recommandee(new.collaborateur_id, new.prestation_id);
  new.exception_statut := null; new.exception_montant := null; new.exception_motif := null;
  new.exception_demandee_le := null; new.exception_decidee_par := null; new.exception_decidee_le := null;
  return new;
end $$;

-- Il doit passer AVANT protect_sensitive_affectation_fields, qui décidera ensuite sur la ligne
-- telle qu'elle sera réellement écrite. L'ordre d'exécution des triggers BEFORE est alphabétique :
-- « aaa_ » le place en tête.
drop trigger if exists aaa_proteger_reattribution_affectation on public.prestations_equipe;
create trigger aaa_proteger_reattribution_affectation
  before update of collaborateur_id on public.prestations_equipe
  for each row execute function public.proteger_reattribution_affectation();

create or replace function public.proteger_reattribution_frais()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text;
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.collaborateur_id is not distinct from old.collaborateur_id then return new; end if;
  select role into v_role from profiles where id = auth.uid();
  if new.collaborateur_id = auth.uid() and v_role is distinct from 'admin' then
    raise exception 'Une note de frais existante ne se reprend pas à son nom.' using errcode = '42501';
  end if;
  if coalesce(old.statut, 'en_attente') <> 'en_attente' then
    new.statut := 'en_attente';
  end if;
  return new;
end $$;

drop trigger if exists aaa_proteger_reattribution_frais on public.frais;
create trigger aaa_proteger_reattribution_frais
  before update of collaborateur_id on public.frais
  for each row execute function public.proteger_reattribution_frais();
