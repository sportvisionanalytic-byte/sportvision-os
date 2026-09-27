-- v313b — 27/09/2026 : la retenue est plafonnée à 100 €, comme la prime
--
-- Fouka a donné le même plafond pour les deux gestes : « des primes allant de 0 jusqu'à 100 euros, et
-- aussi des retraits de salaire de 0 jusqu'à 100 ».
--
-- Le plafond S'AJOUTE à la règle de la v231 (« pas plus que la rémunération ») sans la remplacer : la
-- plus stricte des deux gagne. Sur une mission à 60 €, la retenue maximale reste 60 € ; sur une
-- mission à 300 €, elle devient 100 € au lieu de 300.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION public.mission_penaliser(p_affectation_id uuid, p_montant numeric, p_motif text, p_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_pe prestations_equipe; v_ref text; v_motif text; v_id uuid; v_net numeric; v_deja numeric;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_pe from prestations_equipe where id = p_affectation_id;
  if v_pe.id is null then raise exception 'Affectation introuvable.' using errcode = 'P0002'; end if;
  if not peut_arbitrer_mission(v_pe.prestation_id) then
    raise exception 'Une pénalité se décide par la Production.' using errcode = '42501';
  end if;
  if v_pe.collaborateur_id = auth.uid() then
    raise exception 'On ne se pénalise pas soi-même : cette décision relève de l''Admin.' using errcode = '42501';
  end if;
  v_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if v_motif is null then
    raise exception 'Une pénalité sans motif écrit n''est pas défendable : dites ce qui est reproché.';
  end if;
  if p_montant is null or p_montant <= 0 then raise exception 'Montant de pénalité invalide.'; end if;
  -- v313 : plafond de 100 € par retenue, demande par Fouka le 27/09 en meme temps que la prime.
  -- Il s'AJOUTE a la regle existante (« pas plus que la remuneration ») sans la remplacer : la plus
  -- stricte des deux gagne. Au-dela de 100 €, ce n'est plus un ajustement de mission, c'est une
  -- decision qui remonte a l'Admin.
  if p_montant > 100 then
    raise exception 'Une retenue va de 1 à 100 € : au-delà, c''est une décision de l''Admin.';
  end if;
  -- Déjà payé : on ne reprend pas de l'argent versé. La ligne se rouvre d'abord.
  if v_pe.statut_paiement in ('payé','transmis_compta') then
    raise exception 'Cette mission est déjà % : rouvrez le règlement avant toute retenue.', v_pe.statut_paiement
      using errcode = '42501';
  end if;
  v_deja := mission_penalites_total(p_affectation_id);
  -- On ne facture pas quelqu'un pour avoir travaillé : la retenue s'arrête à la rémunération.
  if v_deja + p_montant > coalesce(v_pe.remuneration, 0) then
    raise exception 'Retenue trop élevée : % € déjà retenus sur % € de rémunération, il reste % € retenables.',
      v_deja, coalesce(v_pe.remuneration, 0), greatest(coalesce(v_pe.remuneration, 0) - v_deja, 0);
  end if;

  insert into mission_penalites (affectation_id, montant, motif, detail, cree_par)
  values (p_affectation_id, p_montant, v_motif, nullif(btrim(coalesce(p_detail, '')), ''), auth.uid())
  returning id into v_id;

  v_net := mission_net_a_payer(p_affectation_id);
  select reference into v_ref from prestations where id = v_pe.prestation_id;
  -- Aucune retenue silencieuse : l'opérateur apprend le montant, le motif et ce qu'il reste.
  insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                             source_type, source_id, lien_prestation_id, expediteur_id)
  values (v_pe.collaborateur_id, 'mission_penalite',
          'Retenue sur ta rémunération — ' || coalesce(v_ref, 'mission'),
          'Une retenue de ' || p_montant || ' € est appliquée sur cette mission. Motif : ' || v_motif ||
          '. Rémunération acceptée ' || coalesce(v_pe.remuneration, 0) || ' €, net à payer ' || v_net ||
          ' €. Si tu n''es pas d''accord, réponds depuis ta mission : ta contestation est enregistrée.',
          v_pe.prestation_id, 'haute', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), 'mission_penalite_appliquee', 'prestations_equipe', p_affectation_id,
          coalesce(v_pe.remuneration, 0) - v_deja, v_net,
          jsonb_build_object('penalite_id', v_id, 'montant', p_montant, 'motif', v_motif,
                             'operateur', v_pe.collaborateur_id, 'prestation', v_pe.prestation_id));

  return jsonb_build_object('ok', true, 'penalite_id', v_id, 'net_a_payer', v_net,
                            'remuneration', v_pe.remuneration, 'retenu_total', v_deja + p_montant);
end $function$
;
