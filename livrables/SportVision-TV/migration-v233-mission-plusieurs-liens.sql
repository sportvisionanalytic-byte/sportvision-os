-- v233 — Une mission accepte autant de liens que nécessaire, et ils sont TOUS relus.
--
-- DEMANDE DE FOUKA, 14/09/2026 : « sur une mission parfois il y a plusieurs liens à mettre ou pas,
-- faire en sorte que les photographes-vidéastes mettent le nombre de liens qu'ils veulent pour
-- valider la presta ».
--
-- La base acceptait déjà N liens par mission : aucune unicité, aucun plafond. Ce qui manquait est
-- ailleurs, et c'est le revers de cette liberté : les contrôles de clôture se contentent de
-- TROUVER un lien valide par catégorie (). Avec trois liens
-- photo dont un seul relu, la mission se clôturait en laissant deux liens jamais vérifiés. Et un
-- lien pour lequel la Production avait explicitement DEMANDÉ UNE CORRECTION ne bloquait rien.
--
-- Autoriser plusieurs liens sans compter que le premier, c'est donc d'abord exiger qu'aucun ne
-- reste en souffrance. Deux contrôles s'ajoutent à la liste de clôture :
--   · un lien en « correction demandée » bloque, tant qu'il n'est pas repris ou retiré ;
--   · un livrable FINAL encore « à vérifier » bloque, pour qu'aucun ne passe sous le radar. Les
--     rushs et les livraisons annexes gardent leur régime : leur validation n'a jamais été exigée,
--     et ce n'est pas ici qu'on change cette règle.
--
-- Rien n'est exigé de plus à l'opérateur : il dépose ce qu'il a, autant de liens qu'il veut. C'est
-- la Production qui doit avoir regardé chacun avant de clore.
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

  -- v233 (14/09/2026) — Une mission peut porter PLUSIEURS liens par livrable : deux cartes, deux
  -- photographes, un montage et son teaser. Les contrôles ci-dessus se contentent d'UN lien valide
  -- par catégorie : avec trois liens photo dont un seul validé, la mission se clôturait en laissant
  -- deux liens jamais relus. Et un lien pour lequel la Production a DEMANDÉ UNE CORRECTION ne
  -- bloquait rien du tout.
  if exists (select 1 from media_liens where prestation_id = p_prestation_id
              and statut = 'correction_demandee') then
    v_manque := v_manque || 'Un lien attend une correction demandée par la Production'::text;
  end if;
  -- Restreint aux livrables FINAUX, et c'est important : la validation n'a jamais ete exigee des
  -- rushs ni des livraisons annexes, et ce n'est pas ici qu'on change cette regle. On corrige le
  -- comptage, pas le perimetre : la ou UN lien final valide suffisait, il les faut TOUS.
  if exists (select 1 from media_liens where prestation_id = p_prestation_id
              and categorie = 'final'
              and coalesce(statut,'a_verifier') = 'a_verifier') then
    v_manque := v_manque || 'Un livrable final n''a pas encore été vérifié par la Production'::text;
  end if;

  -- v232 : un travail refusé par la Production empêche de clore la mission. Clôturer, c'est dire
  -- « tout est en ordre » ; on ne le dit pas d'une mission dont on refuse justement le travail.
  v_manque := v_manque || mission_travail_refuse_manquant(p_prestation_id);

  return v_manque;
end
$function$
;