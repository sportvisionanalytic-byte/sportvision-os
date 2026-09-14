-- v232 — Un travail refusé bloque la clôture, et l'OS lit le net à payer.
--
-- Suite directe de la v231. Deux branchements, sans nouvelle règle :
--   1. mission_cloture_manquant ajoute « Travail d'un opérateur non validé » à sa liste. Clôturer
--      une mission, c'est déclarer que tout est en ordre : on ne le déclare pas d'une mission dont
--      la Production refuse justement le travail.
--   2. prestations_equipe_display expose le verdict, le total retenu et le NET À PAYER. Sans ça,
--      l'écran Rémunérations de l'OS continuerait d'afficher et de régler le montant brut, et la
--      pénalité n'existerait que dans une table que personne ne regarde.
--
-- La visibilité suit exactement celle du montant, déjà en place : l'opérateur voit sa ligne, la
-- Production voit celles de son périmètre. Personne ne découvre la retenue d'un autre.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION public.mission_cloture_manquant(p_prestation_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cov text;
  v_statut text;
  v_manque text[] := '{}';
  v_sans_objet jsonb := '{}'::jsonb;
  v_fournis int := 0;
begin
  select couverture, statut::text into v_cov, v_statut from prestations where id = p_prestation_id;

  select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) into v_sans_objet
    from (
      select t.cle, t.valeur
        from mission_suivi_operateur m,
             lateral jsonb_each(coalesce(m.livrables_non_fournis, '{}'::jsonb)) as t(cle, valeur)
       where m.prestation_id = p_prestation_id
    ) s;

  -- Terrain : l'horodatage personnel de l'opérateur, OU le statut de la mission (v208).
  if not exists (select 1 from mission_suivi_operateur
                  where prestation_id = p_prestation_id and prestation_terminee_at is not null)
     and v_statut not in ('production_terminée','médias_à_transférer','médias_complets','à_monter',
                          'montage_en_cours','prêt_validation','à_valider_client','prête_à_livrer',
                          'livrée','facturée','partiellement_payée','payée','clôturée') then
    v_manque := v_manque || 'Prestation non déclarée réalisée'::text;
  end if;

  if not exists (select 1 from mission_suivi_operateur
                  where prestation_id = p_prestation_id and fichiers_securises_at is not null) then
    v_manque := v_manque || 'Fichiers non sécurisés'::text;
  end if;

  if not exists (select 1 from media_liens
                  where prestation_id = p_prestation_id and transfert_confirme is true) then
    -- 13/09/2026 — Libelle repris : « Aucun transfert confirme » ne disait ni ce qui manquait ni
    -- qui devait agir. Fouka l'a lu sans comprendre. Ce qui manque, c'est la confirmation par
    -- l'operateur que ses fichiers sont copies et verifies — la regle qui interdit de formater une
    -- carte avant d'avoir une seconde copie.
    v_manque := v_manque || 'Sauvegarde non confirmée par l''opérateur (il doit cocher « fichiers copiés et vérifiés »)'::text;
  end if;

  if v_cov is null then
    v_manque := v_manque || 'Couverture non renseignée'::text;
  end if;

  if v_cov in ('photo','photo_video') then
    if exists (select 1 from media_liens where prestation_id = p_prestation_id
                and type_media = 'photo' and categorie = 'final') then
      v_fournis := v_fournis + 1;
      if not exists (select 1 from media_liens where prestation_id = p_prestation_id
                      and type_media = 'photo' and categorie = 'final' and statut = 'valide') then
        v_manque := v_manque || 'Photos non validées par la Production'::text;
      end if;
    elsif not (v_sans_objet ? 'photo') then
      v_manque := v_manque || 'Photos traitées non livrées'::text;
    end if;

    if exists (select 1 from media_liens where prestation_id = p_prestation_id
                and categorie = 'livraison') then
      v_fournis := v_fournis + 1;
    end if;
  end if;

  if v_cov in ('video','photo_video') then
    if exists (select 1 from media_liens where prestation_id = p_prestation_id
                and type_media = 'video' and categorie = 'final') then
      v_fournis := v_fournis + 1;
      if not exists (select 1 from media_liens where prestation_id = p_prestation_id
                      and type_media = 'video' and categorie = 'final' and statut = 'valide') then
        v_manque := v_manque || 'Montage non validé par la Production'::text;
      end if;
    elsif not (v_sans_objet ? 'montage') then
      v_manque := v_manque || 'Montage final non livré'::text;
    end if;

    if exists (select 1 from media_liens where prestation_id = p_prestation_id
                and categorie = 'rushs') then
      v_fournis := v_fournis + 1;
    elsif not (v_sans_objet ? 'rushs') then
      v_manque := v_manque || 'Rushs vidéo non transmis'::text;
    end if;
  end if;

  if v_cov is not null and v_fournis = 0 then
    v_manque := v_manque || 'Aucun livrable réellement transmis'::text;
  end if;

  -- Le matériel ne bloque plus (décision Fouka du 13/09). La relance existe ailleurs, toutes les
  -- heures : kit_a_restituer et kit_retour_attendu à l'opérateur, kit_non_restitue à la Production.

  -- v232 : un travail refusé par la Production empêche de clore la mission. Clôturer, c'est dire
  -- « tout est en ordre » ; on ne le dit pas d'une mission dont on refuse justement le travail.
  v_manque := v_manque || mission_travail_refuse_manquant(p_prestation_id);

  return v_manque;
end
$function$
;

create or replace view prestations_equipe_display as
 SELECT id, prestation_id, collaborateur_id, est_responsable, fonction, heure_rdv,
    CASE WHEN collaborateur_id = auth.uid() THEN remuneration
         WHEN peut_voir_couts_mission(prestation_id) THEN remuneration
         ELSE NULL::numeric END AS remuneration,
    frais_km, km_estimes, statut, date_reponse, notes, created_at, notes_refus,
    heures_declarees, km_declares, frais_declares, notes_declaration, statut_paiement, date_paiement,
    CASE WHEN peut_voir_couts_mission(prestation_id) THEN montant_recommande ELSE NULL::numeric END AS montant_recommande,
    CASE WHEN peut_voir_couts_mission(prestation_id) THEN motif_ajustement ELSE NULL::text END AS motif_ajustement,
    CASE WHEN peut_voir_couts_mission(prestation_id) THEN override_reason ELSE NULL::text END AS motif_detail,
    exception_montant, exception_motif, exception_statut, exception_demandee_le, exception_decidee_le,
    travail_valide, travail_motif, travail_decide_le,
    CASE WHEN collaborateur_id = auth.uid() OR peut_voir_couts_mission(prestation_id)
         THEN mission_penalites_total(id) ELSE NULL::numeric END AS penalites_total,
    CASE WHEN collaborateur_id = auth.uid() OR peut_voir_couts_mission(prestation_id)
         THEN mission_net_a_payer(id) ELSE NULL::numeric END AS net_a_payer
   FROM prestations_equipe
  WHERE peut_voir_couts_mission(prestation_id) OR collaborateur_id = auth.uid() AND statut <> 'a_envoyer'::statut_affectation;

comment on view prestations_equipe_display is
  'Affectations de mission telles que les écrans les lisent. net_a_payer = rémunération acceptée moins les pénalités appliquées (v231) : c''est ce montant qui doit être réglé, jamais le brut.';
