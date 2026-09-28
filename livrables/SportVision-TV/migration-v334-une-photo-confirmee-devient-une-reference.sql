-- v334 — Une photo confirmée par la famille devient une référence (28/09/2026).
--
-- DÉCISION DE FOUKA, prise explicitement : « oui, les conserver ». Jusqu'ici, un « oui c'est bien
-- moi » ne servait qu'à ranger une photo, puis était oublié. C'est pourtant la meilleure donnée du
-- système : une CERTITUDE HUMAINE, sur une vraie photo de match, dans une vraie lumière, sous un
-- angle que la photo de référence ne couvre pas.
--
-- CE QUE ÇA CHANGE. Au bout de quelques confirmations, un sportif est reconnu sous presque tous
-- les angles, et le bénéfice dure : il vaut aussi pour les galeries suivantes. C'est le seul
-- mécanisme du système qui s'améliore tout seul à l'usage.
--
-- POURQUOI UNE NOUVELLE VERSION DU TEXTE, ET PAS SEULEMENT DU CODE.
--
-- Le texte accepté par les familles dit aujourd'hui : « la photo que vous déposez et son empreinte
-- numérique. RIEN D'AUTRE. » Conserver en plus les empreintes issues des galeries est un
-- changement substantiel du traitement — il s'agit de données biométriques, souvent de mineurs. Un
-- accord donné sur l'ancien texte ne couvre pas ce nouveau traitement, et l'élargir en silence
-- serait exactement le genre de chose qu'on ne fait pas.
--
-- DONC : cette conservation n'a lieu QUE pour les accords donnés sur le texte `v2-2026-09` ou
-- suivant. Les accords en `v1-2026-09` continuent comme avant — tout est recalculé à chaque passe
-- et rien n'est gardé. La famille qui veut le nouveau comportement redonne son accord, en toute
-- connaissance de cause. Aucun compte n'est dégradé, aucun n'est élargi sans l'avoir accepté.
--
-- CE QUI NE CHANGE PAS, ET QUI RESTE VRAI DANS LE TEXTE :
--   - les visages des AUTRES personnes présentes sur la photo ne sont jamais enregistrés ; on ne
--     garde que le visage du sportif dont la famille vient de dire « c'est bien lui » ;
--   - retirer l'accord efface tout, ces empreintes comprises : `purger_visages_du_joueur` efface
--     `visages_reference` en entier pour ce joueur, sans regarder l'origine ;
--   - à la fin de la saison, tout est effacé et l'accord redemandé.
--
-- ET UNE BORNE : dix empreintes de galerie au plus. Au-delà, un angle de plus n'apprend plus rien,
-- et accumuler des données biométriques sans bénéfice n'a aucune justification.

create or replace function public.visage_reference_depuis_galerie(
  p_player_id uuid, p_asset_id uuid, p_empreinte vector, p_modele text)
returns uuid
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid; v_version text; v_combien int;
begin
  -- LE MOTEUR SEUL, ou le staff qui peut déjà marquer. Une famille n'appelle jamais ceci : elle
  -- confirme une photo, et c'est la passe suivante qui en tire une référence.
  if not (auth.role() = 'service_role' or media_upload_staff()) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  if not consentement_biometrie_actif(p_player_id) then
    raise exception 'La reconnaissance n''a pas été autorisée pour ce sportif.' using errcode = '42501';
  end if;

  -- LA VERSION DU TEXTE ACCEPTÉ FAIT FOI. Un accord donné sur le texte v1 ne couvre pas la
  -- conservation des empreintes de galerie : on ne l'élargit pas en silence.
  select c.texte_version into v_version from consentements_biometrie c
   where c.player_id = p_player_id and c.statut = 'accorde'
   order by c.accorde_le desc limit 1;
  if coalesce(v_version, 'v1') < 'v2' then
    return null;
  end if;

  -- LA PHOTO DOIT AVOIR ÉTÉ TRANCHÉE PAR UN HUMAIN. `valide_par` est nul quand c'est la machine
  -- qui a validé : on ne veut surtout pas qu'une certitude machine se transforme en référence, car
  -- une erreur se renforcerait elle-même à chaque passe.
  if not exists (
    select 1 from media_player_tags t
     where t.media_ref_type = 'media_asset' and t.media_ref_id = p_asset_id
       and t.player_id = p_player_id and t.statut = 'valide' and t.valide_par is not null)
  then
    raise exception 'Cette photo n''a pas été confirmée par une personne.' using errcode = '42501';
  end if;

  -- Dix au plus : au-delà, un angle supplémentaire n'apprend plus rien.
  select count(*) into v_combien from visages_reference
   where player_id = p_player_id and origine = 'galerie';
  if v_combien >= 10 then
    return null;
  end if;

  insert into visages_reference (player_id, empreinte, modele, origine, ajoute_par)
  values (p_player_id, p_empreinte, p_modele, 'galerie', auth.uid())
  returning id into v_id;
  return v_id;
end $function$;

grant execute on function public.visage_reference_depuis_galerie(uuid, uuid, vector, text) to authenticated;
