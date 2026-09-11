-- v150 : le barème de pôle et la Finance Production restent deux circuits distincts (11/09/2026).
--
-- pole_valider_remuneration_responsable validait un calcul par son identifiant, sans regarder le
-- bénéficiaire : depuis v149, elle aurait pu valider ou marquer payé le calcul d'un Responsable
-- Production en contournant production_regler_remuneration (règles par rôle, journal). Elle ne
-- touche plus que les calculs du responsable de pôle.

create or replace function public.pole_valider_remuneration_responsable(p_calcul_id uuid, p_statut text DEFAULT NULL::text, p_ajustement_montant numeric DEFAULT NULL::numeric, p_ajustement_motif text DEFAULT NULL::text)
 RETURNS pole_remuneration_calculs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row pole_remuneration_calculs;
  v_statut_final text;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'seule la Direction (admin) peut valider une rémunération de responsable' using errcode = '42501';
  end if;
  if p_statut is not null and p_statut not in ('a_valider','valide','paye') then
    raise exception 'statut invalide: %', p_statut;
  end if;

  -- p_statut NULL = on ne change PAS le statut (utilisé par l'action "Ajuster le montant" seule,
  -- pour ne jamais faire régresser un calcul déjà validé/payé vers "à valider" par effet de bord).
  update pole_remuneration_calculs set
    statut = coalesce(p_statut, statut),
    ajustement_montant = coalesce(p_ajustement_montant, ajustement_montant),
    ajustement_motif = coalesce(p_ajustement_motif, ajustement_motif),
    valide_par = case when p_statut in ('valide','paye') then auth.uid() else valide_par end,
    valide_le = case when p_statut in ('valide','paye') and valide_le is null then now() else valide_le end,
    paye_le = case when p_statut = 'paye' then now() else paye_le end,
    updated_at = now()
  where id = p_calcul_id and beneficiaire = 'responsable_pole'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'calcul de rémunération introuvable: %', p_calcul_id;
  end if;

  return v_row;
end;
$function$;
