-- v332 — Plusieurs angles, et une seule règle pour déposer (28/09/2026).
--
-- DEUX DÉFAUTS, TROUVÉS PAR LE MÊME TEST.
--
-- 1. LA SECONDE PHOTO EFFAÇAIT LA PREMIÈRE. `enregistrer_photo_reference` supprimait toutes les
--    photos de l'accord avant d'insérer la nouvelle, et envoyait l'ancienne à la purge. La v331
--    venait de lever le verrou du moteur pour rien : il n'y avait jamais plus d'une photo à
--    calculer. Or c'est LE levier mesuré — une seule photo de référence ne reconnaît que les
--    prises de vue qui lui ressemblent, et `visage_rapprocher_direct` retient déjà spontanément la
--    meilleure de plusieurs empreintes.
--
-- 2. UN MINEUR DE MOINS DE 15 ANS NE POUVAIT PAS DÉPOSER SA PROPRE PHOTO. Cette fonction exigeait
--    « parent confirmé, ou le joueur ET 15 ans ou plus ». Mais la v323, le matin même, avait ouvert
--    la policy de stockage à « parent confirmé, ou le joueur », l'accord faisant foi — sur décision
--    de Fouka : « lui-même dépose lui-même sa photo, le parent n'est pas obligé de le faire à sa
--    place ». Le fichier partait donc dans le stockage, puis l'enregistrement était refusé. Deux
--    endroits pour une même règle, et ils avaient divergé en une journée.
--
-- LA RÈGLE VIT DÉSORMAIS DANS `peut_deposer_photo_reference`, et la fonction comme la policy de
-- stockage l'appellent. C'est la seule façon de ne pas revivre ça.
--
-- CE QUI NE CHANGE PAS : l'accord d'abord, toujours. Une photo de visage n'entre jamais sans un
-- consentement actif, et c'est lui qui protège un mineur — pas la main qui téléverse. Les
-- conditions pour DONNER cet accord (parent confirmé, ou le sportif de 15 ans et plus) sont une
-- autre règle, légale, et cette migration n'y touche pas.
--
-- ET LA BORNE : cinq photos. Une donnée biométrique de mineur ne s'accumule pas sans fin.

create or replace function public.peut_deposer_photo_reference(p_player_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select (public.is_confirmed_parent_of(p_player_id) or public.is_own_player(p_player_id))
     and public.consentement_biometrie_actif(p_player_id);
$$;

create or replace function public.enregistrer_photo_reference(
  p_player_id uuid, p_storage_path text)
returns uuid
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_consent uuid; v_id uuid; v_combien int;
begin
  -- UNE SEULE RÈGLE, celle que la policy de stockage applique déjà.
  if not public.peut_deposer_photo_reference(p_player_id) then
    raise exception 'Vous ne pouvez pas déposer la photo de ce sportif, ou son accord de reconnaissance n''est pas enregistré.'
      using errcode = '42501';
  end if;
  if p_storage_path is null or p_storage_path not like 'visages/' || p_player_id::text || '/%' then
    raise exception 'Chemin de photo invalide.' using errcode = '22023';
  end if;

  select id into v_consent from consentements_biometrie
   where player_id = p_player_id and statut = 'accorde' order by accorde_le desc limit 1;
  if not found then
    raise exception 'Aucun accord actif : la photo ne peut pas être enregistrée.' using errcode = '42501';
  end if;

  -- Reposer le MÊME fichier ne crée pas de doublon : on réappuie sur le bouton, il ne se passe
  -- rien de plus. C'est l'identifiant existant qui revient.
  select id into v_id from player_face_refs
   where consentement_id = v_consent and storage_path = p_storage_path;
  if found then
    return v_id;
  end if;

  -- CINQ AU PLUS. Au-delà, on accumulerait des données biométriques de mineurs sans qu'aucune
  -- n'améliore quoi que ce soit : le gain d'un angle supplémentaire s'épuise vite.
  select count(*) into v_combien from player_face_refs where consentement_id = v_consent;
  if v_combien >= 5 then
    raise exception 'Cinq photos de référence suffisent. Retirez-en une avant d''en ajouter une autre.'
      using errcode = '22023';
  end if;

  -- ON N'EFFACE PLUS RIEN ICI. Retirer une photo est un geste volontaire, qui passe par
  -- `retirer_photo_reference` et alimente la purge. Un ajout n'est pas un remplacement.
  insert into player_face_refs (player_id, consentement_id, moteur, storage_bucket, storage_path, created_by)
  values (p_player_id, v_consent, 'en_attente', 'sportvision-media-prive', p_storage_path, auth.uid())
  returning id into v_id;
  return v_id;
end $function$;

-- ── Retirer une photo, puisqu'on peut désormais en avoir plusieurs ────────────────────────────
--
-- Sans ce geste, une photo ratée resterait pour toujours, et la borne de cinq deviendrait un mur.
-- La purge est alimentée ici, là où la suppression est VOULUE — et non plus à chaque dépôt.
create or replace function public.retirer_photo_reference(p_face_ref_id uuid)
returns boolean
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_ref record;
begin
  select * into v_ref from player_face_refs where id = p_face_ref_id;
  if not found then
    return false;
  end if;
  if not public.peut_deposer_photo_reference(v_ref.player_id) then
    raise exception 'Vous ne pouvez pas retirer la photo de ce sportif.' using errcode = '42501';
  end if;
  if v_ref.storage_path is not null then
    insert into biometrie_a_purger (player_id, storage_bucket, storage_path, motif)
    values (v_ref.player_id, v_ref.storage_bucket, v_ref.storage_path, 'photo_retiree');
  end if;
  -- L'empreinte s'en va avec la photo : `visages_reference.face_ref_id` est en cascade (v331).
  delete from player_face_refs where id = p_face_ref_id;
  return true;
end $function$;

grant execute on function public.peut_deposer_photo_reference(uuid) to authenticated;
grant execute on function public.enregistrer_photo_reference(uuid, text) to authenticated;
grant execute on function public.retirer_photo_reference(uuid) to authenticated;
