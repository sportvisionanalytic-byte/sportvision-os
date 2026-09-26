-- v286 — 26/09/2026 : dire à la famille où elle en est
--
-- Ordre voulu par Fouka : « ça doit proposer d'acheter le pass pour pouvoir voir ses photos. Quand
-- il va acheter son pass, après, il fait sa reconnaissance faciale. »
--
-- CE QUI MANQUAIT N'ÉTAIT PAS UN DROIT, C'ÉTAIT UNE PHRASE
--
-- La chaîne compte quatre marches : le Pass, l'accord biométrique, la photo de référence, puis les
-- photos retrouvées. Tout existe et fonctionne — mesure du 26/09 sur les six joueurs : deux ont
-- donné leur accord, AUCUN n'a déposé de photo de référence, donc aucune empreinte, donc zéro photo
-- retrouvée.
--
-- Or l'écran ne disait rien de tout ça. Il affichait « Rien pour le moment », ce qui est vrai et
-- inutile : la famille ne pouvait pas savoir qu'il lui restait une chose à faire, ni laquelle. Une
-- famille qui paie le Pass et tombe sur une galerie vide demande un remboursement, et elle a raison.
--
-- Cette fonction rend donc l'état des quatre marches, pour que l'écran puisse nommer la SUIVANTE.
-- Elle ne rend aucune donnée biométrique : quatre booléens et un compteur, rien de plus.
--
-- Le cloisonnement est le même que partout ailleurs : le joueur lui-même, son parent confirmé, ou
-- le staff dans son périmètre. Jamais une famille sur l'enfant d'une autre.
--
-- Idempotent.

create or replace function public.media_etat_reconnaissance(p_player_id uuid)
returns table (
  consentement boolean,
  photo_reference boolean,
  empreinte boolean,
  photos_trouvees integer
)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;
  if not (
    is_own_player(p_player_id)
    or is_confirmed_parent_of(p_player_id)
    or media_upload_staff()
  ) then
    raise exception 'Ce joueur n''est pas rattaché à votre compte.' using errcode = '42501';
  end if;

  return query
  select
    consentement_biometrie_actif(p_player_id),
    exists (select 1 from player_face_refs f where f.player_id = p_player_id),
    exists (select 1 from visages_reference v where v.player_id = p_player_id),
    (select count(*)::integer from media_player_tags t
      where t.player_id = p_player_id and t.statut = 'valide');
end $function$;

revoke all on function public.media_etat_reconnaissance(uuid) from public;
grant execute on function public.media_etat_reconnaissance(uuid) to authenticated;
