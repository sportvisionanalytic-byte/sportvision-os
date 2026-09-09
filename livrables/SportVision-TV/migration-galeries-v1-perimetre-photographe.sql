-- ═══════════════════════════════════════════════════════════════════════════════
-- Un photographe ne voit plus toutes les galeries
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Demande de Fouka le 09/09/2026. Etat avant : `malbums_staff_select` autorise la lecture a
-- `media_upload_staff()`, qui inclut le role `photo`. Un photographe voyait donc l'integralite
-- des galeries de SportVision, tous clubs confondus.
--
-- Perimetre retenu (arbitrage Fouka) : SES MISSIONS **ET** SES CREATIONS.
--
-- Un point a fallu etre tranche avant d'ecrire quoi que ce soit : pris au pied de la lettre,
-- « uniquement celles qu'il a creees » lui aurait montre ZERO galerie, puisque l'insertion
-- etait reservee a admin/prod — il ne pouvait en creer aucune. D'ou les deux volets, et
-- l'ouverture de la creation ci-dessous.

begin;

-- ── La regle, en un seul endroit ─────────────────────────────────────────────
--
-- SECURITY DEFINER : appelee depuis une policy et depuis une fonction, elle ne doit pas
-- redeclencher les policies des tables qu'elle lit — meme motif que operateur_affecte_prestation.
--
-- Le lien « mission » reutilise exactement la condition du module operateur : une ligne dans
-- prestations_equipe. Aucune deuxieme definition de ce qu'est « ma mission ».
create or replace function public.photographe_voit_album(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from media_albums a
     where a.id = p_album_id
       and (
         a.created_by = auth.uid()
         or (a.mission_id is not null and exists (
              select 1 from prestations_equipe pe
               where pe.prestation_id = a.mission_id
                 and pe.collaborateur_id = auth.uid()))
       )
  );
$function$;

comment on function public.photographe_voit_album(uuid) is
  'Un operateur terrain voit une galerie s''il l''a creee, ou si elle est rattachee a une mission ou il figure dans prestations_equipe. Source unique — ne pas redefinir cette condition ailleurs.';

-- ── La ceinture sur la table ─────────────────────────────────────────────────
--
-- Policy RESTRICTIVE : elle se combine en ET et ne peut que RETIRER de l'acces. Elle commence
-- par `not est_operateur_terrain()`, donc admin, production, secretariat et CM ne sont pas
-- touches et `malbums_staff_select` reste en place. Meme patron que le cloisonnement CM et
-- celui des livraisons.
drop policy if exists malbums_photographe_perimetre on media_albums;
create policy malbums_photographe_perimetre on media_albums as restrictive for all to authenticated
  using (not est_operateur_terrain() or photographe_voit_album(id))
  with check (not est_operateur_terrain() or created_by = auth.uid());

comment on policy malbums_photographe_perimetre on media_albums is
  'RESTRICTIVE : un operateur terrain ne voit que ses missions et ses creations, et ne peut creer qu''en son propre nom. Aucun autre role n''est affecte.';

-- ── Lui donner de quoi creer ─────────────────────────────────────────────────
-- Sans cela, le volet « ses creations » resterait theorique. L'ecriture reste bornee par la
-- policy restrictive ci-dessus : il ne peut poser que `created_by = lui-meme`, et ne modifier
-- ou supprimer que ce qui entre dans son perimetre.
drop policy if exists malbums_photographe_insert on media_albums;
create policy malbums_photographe_insert on media_albums for insert to authenticated
  with check (est_operateur_terrain() and created_by = auth.uid());

drop policy if exists malbums_photographe_update on media_albums;
create policy malbums_photographe_update on media_albums for update to authenticated
  using (est_operateur_terrain() and created_by = auth.uid())
  with check (est_operateur_terrain() and created_by = auth.uid());

-- Volontairement PAS de suppression : effacer une galerie detruit le travail d'une prestation
-- entiere et peut casser des liens deja transmis a un club. Cela reste une decision Production.

-- ── Les photos elles-memes ───────────────────────────────────────────────────
--
-- Sans ceci, la restriction serait cosmetique : `media_album_assets` est SECURITY DEFINER et
-- contourne donc la RLS. Un photographe connaissant un identifiant d'album aurait continue a
-- lire ses photos malgre la policy.
CREATE OR REPLACE FUNCTION public.media_album_assets(p_album_id uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_include_hidden boolean DEFAULT true)
 RETURNS TABLE(id uuid, original_filename text, mime_type text, original_path text, preview_path text, thumb_path text, width integer, height integer, bytes bigint, "position" integer, status text, processing_error text, created_at timestamp with time zone, is_cover boolean, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.original_filename, a.mime_type, a.original_path, a.preview_path, a.thumb_path,
         a.width, a.height, a.bytes, a.position, a.status, a.processing_error, a.created_at,
         (al.cover_asset_id = a.id) as is_cover,
         count(*) over () as total
  from media_assets a
  join media_albums al on al.id = a.album_id
  where a.album_id = p_album_id
    and media_upload_staff()
    -- Ajout 09/09/2026 : un operateur terrain reste borne a son perimetre, ici aussi.
    -- Sans cette ligne la policy serait cosmetique : cette fonction est SECURITY DEFINER
    -- et contourne donc la RLS de media_albums.
    and (not est_operateur_terrain() or photographe_voit_album(p_album_id))
    and a.status <> 'removed'
    and (p_include_hidden or a.status = 'ready')
  order by a.position, a.created_at, a.id
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
$function$;

commit;

select 'OK — perimetre photographe pose sur les galeries et sur les photos' as verdict;
