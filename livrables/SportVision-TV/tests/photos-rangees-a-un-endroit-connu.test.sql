-- Chaque photo doit dire où elle est rangée, et ce nom doit être un nom que le code connaît.
--
-- Depuis le 24/09/2026, les photos vivent à deux endroits : Supabase pour les 2 085 d'avant,
-- Cloudflare R2 pour les nouvelles. C'est la colonne `media_assets.storage_bucket` qui décide, et
-- elle seule — aucune date, aucun seuil, aucune heuristique.
--
-- Le risque de cette architecture tient en une ligne : une valeur inattendue dans cette colonne,
-- et `urlOriginal` retombe sur Supabase pour une photo qui n'y est pas. La famille, elle, voit
-- « téléchargement momentanément indisponible » après avoir payé, et rien dans ce message ne
-- permet de deviner qu'une chaîne de caractères est mal écrite quelque part.
--
-- Une faute de frappe au moment de l'envoi ne doit donc pas attendre un client mécontent pour
-- se voir. Ce test la trouve au prochain passage de la batterie.
with valeurs as (
  select coalesce(nullif(trim(storage_bucket), ''), 'sportvision-media-prive') as seau,
         count(*) as nb
  from media_assets
  group by 1
),
inconnues as (
  select seau, nb from valeurs
  where seau not in ('r2', 'sportvision-media-prive')
),
sans_chemin as (
  -- Une photo sans chemin n'est servie de nulle part, quel que soit le seau. C'est une ligne
  -- orpheline : elle apparaîtra dans la galerie et refusera de se télécharger.
  select count(*) as nb from media_assets
  where coalesce(trim(original_path), '') = ''
)
select case
  when (select count(*) from inconnues) > 0
    then '❌ emplacement inconnu : '
         || (select string_agg(seau || ' (' || nb || ' photos)', ', ') from inconnues)
  when (select nb from sans_chemin) > 0
    then '❌ ' || (select nb from sans_chemin) || ' photo(s) sans chemin de fichier'
  else '✅ ' || (select sum(nb)::text from valeurs) || ' photos, toutes rangées à un endroit connu : '
       || (select string_agg(seau || ' (' || nb || ')', ', ' order by nb desc) from valeurs)
end as verdict;
