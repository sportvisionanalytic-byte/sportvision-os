-- v333 — La famille voit ses propres photos de référence (28/09/2026).
--
-- POURQUOI ELLE MANQUAIT. Tant qu'il n'y avait qu'UNE photo, un booléen suffisait : « déposée » ou
-- « à déposer ». La v332 permet d'en avoir plusieurs, et l'écran doit donc pouvoir les montrer,
-- dire laquelle est déjà calculée, et proposer d'en retirer une. Or `player_face_refs` n'est
-- lisible que par un administrateur : une famille ne peut pas lister ses propres photos.
--
-- SECURITY DEFINER, ET RIEN DE PLUS QUE LE STRICT NÉCESSAIRE : l'identifiant, le chemin, la date,
-- et si l'empreinte est calculée. Jamais l'empreinte elle-même, que personne n'a à lire.
--
-- LE DROIT EST CELUI DU DÉPÔT, pas un nouveau : `peut_deposer_photo_reference`. Qui peut déposer
-- peut voir et retirer. Une règle de plus aurait été une règle de plus à faire diverger.

create or replace function public.photos_de_reference_du_sportif(p_player_id uuid)
returns table(id uuid, storage_path text, created_at timestamptz, a_une_empreinte boolean)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select fr.id, fr.storage_path, fr.created_at,
         exists (select 1 from visages_reference vr where vr.face_ref_id = fr.id)
    from player_face_refs fr
   where fr.player_id = p_player_id
     and public.peut_deposer_photo_reference(p_player_id)
   order by fr.created_at;
$$;

grant execute on function public.photos_de_reference_du_sportif(uuid) to authenticated;
