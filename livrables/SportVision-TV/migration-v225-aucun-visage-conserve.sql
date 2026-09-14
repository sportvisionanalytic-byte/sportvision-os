-- v225 — Aucune empreinte de visage de galerie n'est conservée (14/09/2026).
--
-- CE QUI CLOCHAIT. Le texte de consentement, écrit le 12/09 et destiné à de vrais parents, promet
-- noir sur blanc : « Les visages des autres enfants présents sur une photo ne sont jamais
-- enregistrés. » Or la v222 créait `visages_detectes` et y gardait l'empreinte de TOUS les visages
-- trouvés sur chaque photo — y compris ceux d'enfants dont aucun parent n'a rien signé, et de
-- toute personne passant dans le champ.
--
-- Un texte de consentement qui ne décrit pas le traitement réel n'est pas un consentement valable.
-- Entre changer le texte et changer le code, il n'y a pas à hésiter : c'est le code qui change.
--
-- CE QU'ON FAIT À LA PLACE. L'empreinte d'un visage de galerie est comparée À LA VOLÉE, en un seul
-- appel, et n'est jamais écrite. Elle ne quitte le navigateur que le temps de la comparaison. Il ne
-- reste en base que le résultat : un marquage, avec le modèle et la distance.
--
-- CE QU'ON PERD, ET C'EST ACCEPTABLE : changer de seuil n'est plus une requête, il faut repasser
-- les photos. Le bouton « Identifier les sportifs » le fait déjà, et cette opération est rare.
--
-- La table `visages_detectes` est supprimée : vide au moment de cette migration, et elle ne doit
-- pas rester à disposition — une table de biométrie qui existe finit par être remplie.
--
-- Idempotente.

create or replace function public.visage_rapprocher_direct(
  p_asset_id uuid, p_empreinte extensions.vector, p_modele text, p_seuil numeric default 0.55)
returns table(player_id uuid, distance numeric)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare v_team uuid; v_album uuid;
begin
  select a.album_id, al.team_id into v_album, v_team
    from media_assets a join media_albums al on al.id = a.album_id where a.id = p_asset_id;
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;
  if not peut_marquer_galerie(v_album) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;

  -- On ne compare qu'aux joueurs de l'équipe de cette galerie, et seulement à ceux dont l'accord
  -- est en cours. Un visage ne peut donc être rapproché ni d'un enfant d'un autre club, ni de
  -- quelqu'un qui n'a rien autorisé.
  return query
  select r.player_id, min(p_empreinte <=> r.empreinte)::numeric as d
    from visages_reference r
   where r.modele = p_modele
     and consentement_biometrie_actif(r.player_id)
     and (v_team is null or exists (
           select 1 from team_memberships tm
            where tm.team_id = v_team and tm.player_id = r.player_id and tm.statut = 'active'))
   group by r.player_id
  having min(p_empreinte <=> r.empreinte) < p_seuil
   order by d
   limit 3;
end $$;

comment on function public.visage_rapprocher_direct(uuid, extensions.vector, text, numeric) is
  'v225 — Compare un visage de galerie aux références de l''équipe, SANS jamais conserver son empreinte.';

revoke all on function public.visage_rapprocher_direct(uuid, extensions.vector, text, numeric) from public;
grant execute on function public.visage_rapprocher_direct(uuid, extensions.vector, text, numeric) to authenticated;

-- Les deux fonctions qui écrivaient ou lisaient les visages conservés n'ont plus d'objet.
drop function if exists public.visage_detecte_ajouter(uuid, extensions.vector, text, jsonb, numeric);
drop function if exists public.visage_rapprocher(uuid, numeric);
drop table if exists public.visages_detectes;
