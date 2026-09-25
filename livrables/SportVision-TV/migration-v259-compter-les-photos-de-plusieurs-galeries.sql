-- v259 — Compter « mes photos » sur toutes les galeries d'un coup (25/09/2026)
--
-- TROUVÉ EN AUDITANT L'APPLICATION, pas par un utilisateur.
--
-- L'écran Photos affiche, sur chaque galerie, combien de photos portent le visage du joueur.
-- Il appelait `media_compte_photos_du_joueur` UNE FOIS PAR GALERIE. Sur une saison qui en compte
-- trente, cela fait trente allers-retours pour afficher un seul écran — et cet écran s'ouvre
-- au bord d'un terrain, en 4G, souvent à la mi-temps quand tout le monde est sur le réseau en
-- même temps. Chaque aller-retour coûte sa latence, et ils s'additionnent.
--
-- Cette fonction fait le même travail en une seule requête, pour toutes les galeries à la fois.
--
-- ELLE NE CHANGE AUCUN DROIT, et c'est le point important : elle appelle exactement la même
-- `media_photos_du_joueur` que la version unitaire, qui porte les règles d'accès. Une galerie
-- que la personne n'a pas le droit de voir rend zéro ici comme elle rendait zéro là. Réécrire
-- la règle pour aller plus vite, c'est exactement comme ça qu'on finit par la contourner.
--
-- La version unitaire reste : elle est utilisée ailleurs, et rien n'oblige à tout migrer d'un
-- coup pour gagner une requête.

create or replace function public.media_compte_photos_du_joueur_lot(
  p_album_ids uuid[], p_player_id uuid
)
returns table (album_id uuid, nb integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.album_id,
         (select count(*)::int from media_photos_du_joueur(a.album_id, p_player_id)) as nb
  from unnest(coalesce(p_album_ids, '{}'::uuid[])) as a(album_id);
$$;

-- Mêmes droits que la version unitaire : un compte connecté, et c'est la fonction appelée qui
-- décide ce qu'il voit.
revoke execute on function public.media_compte_photos_du_joueur_lot(uuid[], uuid) from public, anon;
grant execute on function public.media_compte_photos_du_joueur_lot(uuid[], uuid) to authenticated;

comment on function public.media_compte_photos_du_joueur_lot(uuid[], uuid) is
  'Combien de photos portent le visage de ce joueur, pour plusieurs galeries a la fois. Evite '
  'un aller-retour par galerie sur l''ecran Photos de l''application. Voir migration v259.';
