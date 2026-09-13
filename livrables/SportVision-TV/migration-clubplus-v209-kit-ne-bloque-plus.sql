-- v209 — Le kit non rendu ne bloque plus la validation d'une prestation (13/09/2026).
--
-- Décision de Fouka, 13/09 : « on s'en fiche du kit non restitué, on court juste après ».
--
-- CE QUI N'ALLAIT PAS. `mission_cloture_manquant` refusait la clôture tant qu'une réservation de
-- kit restait ouverte. Deux choses sans rapport se trouvaient liées : le travail livré au client
-- d'un côté, le matériel qui traîne dans un coffre de voiture de l'autre. Résultat concret : une
-- prestation livrée, vérifiée et validable restait bloquée — donc l'opérateur n'était ni payé ni
-- crédité de ses XP — parce qu'un kit n'avait pas été rendu.
--
-- CE QUE FAIT CETTE MIGRATION. Le matériel sort des conditions de validation. Il n'est pas
-- abandonné pour autant : `send_prestation_reminders` relance déjà l'opérateur (kit_a_restituer,
-- kit_retour_attendu) et alerte la Production (kit_non_restitue), désormais toutes les heures.
-- C'est une relance, pas un verrou sur l'argent de quelqu'un.
-- Idempotente.

create or replace function public.mission_cloture_manquant(p_prestation_id uuid)
returns text[]
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
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
    v_manque := v_manque || 'Aucun transfert confirmé'::text;
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

  return v_manque;
end
$function$;
