-- v327 — Deux visages se comparent en distance euclidienne (28/09/2026).
--
-- LE DÉFAUT. `visage_rapprocher_direct` comparait deux empreintes avec `<=>`, la distance COSINUS
-- de pgvector. Les deux seuils du produit, 0,42 et 0,55, sont les seuils EUCLIDIENS usuels de
-- face-api — c'est écrit noir sur blanc dans le commentaire de RECO_CFG, « distance euclidienne
-- entre deux empreintes ». On mesurait dans une unité, on tranchait dans une autre.
--
-- CE QUE ÇA COÛTAIT. Pour deux empreintes de norme 1, le cosinus vaut le carré de l'euclidien
-- divisé par deux. Le seuil « propose » de 0,55 acceptait donc tout jusqu'à 1,05 en euclidien,
-- c'est-à-dire n'importe quels deux visages ; et le seuil « certain » de 0,42, celui qui écrit le
-- marquage en `valide` sans qu'aucun humain le relise, allait jusqu'à 0,92. Autrement dit : la
-- photo d'un enfant envoyée à la famille d'un autre, automatiquement, sans relecture.
--
-- LA MESURE QUI L'A RÉVÉLÉ. Sur la galerie réelle « RCPF VS PSG U16 », un seul joueur avait déposé
-- sa photo de référence. Le moteur lui a attribué 79 des 110 photos, toutes en `valide`, avec des
-- distances de 0,012 à 0,185. Le modèle, lui, n'avait rien fait de mal : deux personnes
-- différentes du même banc de touche sortent à 0,574 en euclidien. C'est la comparaison qui
-- mentait, pas la détection.
--
-- LE CORRECTIF tient en un opérateur : `<->`, la distance L2 de pgvector. Les seuils ne bougent
-- pas — ils étaient justes, c'est ce qu'on leur donnait à comparer qui ne l'était pas. Aucun index
-- vectoriel n'existe sur `visages_reference`, donc rien d'autre n'est à refaire.
--
-- LES 79 MARQUAGES DÉJÀ POSÉS sont effacés plus bas : ils ont été écrits par le défaut, aucun ne
-- repose sur une vraie ressemblance, et ils sont en `valide`, donc visibles d'une famille. On
-- n'efface que ceux de la machine (`source = 'suggestion'`) : un marquage posé à la main par un
-- humain n'est jamais touché.

create or replace function public.visage_rapprocher_direct(
  p_asset_id uuid, p_empreinte vector, p_modele text, p_seuil numeric default 0.55)
returns table(player_id uuid, distance numeric)
language plpgsql stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_teams uuid[]; v_album uuid;
begin
  select a.album_id into v_album
    from media_assets a where a.id = p_asset_id;
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;
  if not peut_marquer_galerie(v_album) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  v_teams := public.media_equipes_de_la_galerie(v_album);

  -- On ne compare qu'aux joueurs des équipes de cette galerie — TOUTES ses équipes, y compris les
  -- supplémentaires — et seulement à ceux dont l'accord est en cours. Un visage ne peut donc être
  -- rapproché ni d'un enfant d'un autre club, ni de quelqu'un qui n'a rien autorisé.
  --
  -- `<->` ET NON `<=>`. Le premier est la distance euclidienne, la seule que les seuils 0,42 et
  -- 0,55 savent lire. Le second est le cosinus : il rend des nombres deux à dix fois plus petits,
  -- donc tout passe, et tout passe même en « certain ». Voir l'en-tête de cette migration.
  return query
  select r.player_id, min(p_empreinte <-> r.empreinte)::numeric as d
    from visages_reference r
   where r.modele = p_modele
     and consentement_biometrie_actif(r.player_id)
     and (coalesce(cardinality(v_teams), 0) = 0 or exists (
           select 1 from team_memberships tm
            where tm.team_id = any(v_teams) and tm.player_id = r.player_id and tm.statut = 'active'))
   group by r.player_id
  having min(p_empreinte <-> r.empreinte) < p_seuil
   order by d
   limit 3;
end $function$;

-- Les marquages posés par la machine sous l'ancienne comparaison. Ils seront recalculés : la file
-- de la v325 est rouverte pour chaque galerie concernée, et le moteur repassera dessus.
with efface as (
  delete from media_player_tags
   where source = 'suggestion' and moteur is not null
  returning media_ref_id, player_id
)
insert into reconnaissance_a_faire (album_id, player_id)
select distinct a.album_id, e.player_id
  from efface e join media_assets a on a.id = e.media_ref_id
on conflict do nothing;
