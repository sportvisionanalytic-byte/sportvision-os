-- v337 — « Cette photo est-elle calculée ? » n'a de sens que pour un modèle donné (29/09/2026).
--
-- LE DÉFAUT, ET IL BLOQUAIT TOUT EN SILENCE. `reconnaissance_joueurs_prets` répondait qu'une photo
-- de référence était déjà calculée dès qu'une empreinte existait pour elle — sans regarder AVEC
-- QUEL MODÈLE. En passant au nouveau moteur, les anciennes empreintes face-api ont donc fait
-- déclarer « déjà fait » à toutes les photos, le moteur les a sautées, aucune empreinte ArcFace
-- n'a été créée, et la passe a rendu zéro identification sur 284 visages relevés.
--
-- Une empreinte n'existe que dans l'espace de son modèle : deux empreintes de modèles différents
-- ne se comparent pas, et `visage_rapprocher_direct` filtre d'ailleurs déjà sur ce champ. La
-- question « reste-t-il une photo à calculer ? » doit donc porter le même filtre, sinon les deux
-- fonctions ne parlent pas de la même chose.
--
-- Le modèle est un ARGUMENT, avec la valeur de l'ancien par défaut : les appels existants — l'OS
-- notamment — continuent de répondre exactement comme avant.

drop function if exists public.reconnaissance_joueurs_prets(uuid);
drop function if exists public.reconnaissance_joueurs_prets(uuid, text);

create function public.reconnaissance_joueurs_prets(
  p_album_id uuid, p_modele text default 'face-api-1.7.15-ssd128')
returns table(player_id uuid, joueur text, face_ref_id uuid, chemin_photo text, a_une_empreinte boolean)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_teams uuid[];
begin
  if not peut_marquer_galerie(p_album_id) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  v_teams := public.media_equipes_de_la_galerie(p_album_id);

  return query
  select p.id,
         coalesce(nullif(btrim(p.prenom || ' ' || p.nom), ''), 'Sportif'),
         fr.id,
         fr.storage_path,
         -- LE MODÈLE FAIT PARTIE DE LA QUESTION. Sans lui, une empreinte d'un autre moteur fait
         -- croire que le travail est fait.
         exists (select 1 from visages_reference vr
                  where vr.face_ref_id = fr.id and vr.modele = p_modele)
    from player_profiles p
    join team_memberships tm on tm.player_id = p.id and tm.statut = 'active'
    -- Jointure ouverte : cette fonction dit aussi QUI peut être marqué, et un sportif sans photo
    -- de référence doit rester proposé au marquage manuel.
    left join player_face_refs fr on fr.player_id = p.id
   where coalesce(cardinality(v_teams), 0) > 0
     and tm.team_id = any(v_teams)
     and consentement_biometrie_actif(p.id)
   group by p.id, p.prenom, p.nom, fr.id, fr.storage_path, fr.created_at
   order by 2, fr.created_at;
end $function$;

grant execute on function public.reconnaissance_joueurs_prets(uuid, text) to authenticated;
