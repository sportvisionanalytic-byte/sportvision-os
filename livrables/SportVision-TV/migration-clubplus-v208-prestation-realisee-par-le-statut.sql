-- v208 — Le statut de la mission fait foi sur « prestation réalisée » (13/09/2026).
--
-- CE QUI N'ALLAIT PAS. `mission_cloture_manquant` exige un horodatage personnel de l'opérateur,
-- `mission_suivi_operateur.prestation_terminee_at`. Sur la mission SV-2026-0268, cet horodatage
-- est nul alors que la mission est en « prêt_validation » : Michael a avancé son parcours sans
-- passer par le bouton qui le pose.
--
-- Et il n'y a plus aucun moyen de le poser : ce bouton n'apparaît qu'au statut
-- « production_démarrée », que la mission a dépassé depuis longtemps. Le responsable production se
-- voyait donc refuser la validation, avec « Prestation non déclarée réalisée », sur une mission
-- livrée, sans aucune action possible ni pour lui ni pour l'opérateur. Un cul-de-sac.
--
-- CE QUE FAIT CETTE MIGRATION. Une mission dont le STATUT a dépassé la production est réalisée :
-- c'est le fait, et il est écrit sur la prestation elle-même. L'horodatage reste un suivi
-- personnel utile — savoir QUAND, et par qui — mais il cesse d'être la seule preuve d'un fait que
-- la mission porte déjà.
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

  -- Terrain : l'horodatage personnel de l'opérateur, OU le statut de la mission, qui dit la même
  -- chose et que l'opérateur ne peut plus corriger une fois passé.
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

    -- La galerie compte comme livrable fourni, mais ne bloque pas (voir v207).
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

  if exists (
    select 1 from kit_reservations kr
     where kr.prestation_id = p_prestation_id
       and kr.statut not in ('retourné','en_contrôle','disponible')
       and (kr.date_retour_prevue is null or kr.date_retour_prevue <= now())
  ) then
    v_manque := v_manque || 'Kit non restitué'::text;
  end if;

  return v_manque;
end
$function$;
