-- v190 — Le stockage se borne comme les tables (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. Le cloisonnement des médias s'arrêtait à la table. En lecture, tout est
-- correct : `sv_media_prive_media_select` appelle `can_access_media`, et la policy restrictive
-- `massets_photographe_perimetre` (v164) borne le photographe à ses missions. Mais en ÉCRITURE,
-- les policies de stockage ne demandaient qu'une chose : `media_upload_staff()`, c'est-à-dire
-- « être admin, sec, prod ou photo ». Aucune ne regardait de quel album il s'agissait.
--
-- Conséquence : un opérateur terrain, en fin de mission, pouvait effacer les originaux vendus de
-- TOUS les clubs (DELETE sur /storage/.../sportvision-media-prive/media/<album>/<photo>.jpg), ou
-- remplacer l'aperçu public d'une galerie en vente par n'importe quelle image (POST sur
-- /galerie-previews/<album>/<photo>-p.webp avec x-upsert). Il n'y a ni corbeille ni
-- versionnement : une suppression d'original est définitive.
--
-- Deuxième trou, même famille : `sv_media_prive_recrutement_select` ne vérifiait AUCUN rôle. Elle
-- se contentait de constater que le fichier est référencé par une candidature. Le cloisonnement
-- du recrutement posé en v130 (Production ne voit que son pôle, Secrétariat à partir de
-- « retenu », les autres métiers rien) s'appliquait donc à la fiche, pas au CV.
--
-- CE QUE FAIT CETTE MIGRATION. Les écritures sur les médias d'un album restent ouvertes à
-- l'exploitation (admin, sec, prod) et se bornent au périmètre de mission pour l'opérateur
-- terrain. Le CV demande la même autorisation que la candidature elle-même.
-- Idempotente.

-- ─── 1. Originaux : suppression et dépôt bornés au périmètre ─────────────────
drop policy if exists sv_media_prive_media_delete on storage.objects;
create policy sv_media_prive_media_delete on storage.objects for delete using (
  bucket_id = 'sportvision-media-prive'
  and (storage.foldername(name))[1] = 'media'
  and media_upload_staff()
  and (
    not est_operateur_terrain()
    or (
      (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
      and photographe_voit_album(((storage.foldername(name))[2])::uuid)
    )
  )
);

drop policy if exists sv_media_prive_media_write on storage.objects;
create policy sv_media_prive_media_write on storage.objects for insert with check (
  bucket_id = 'sportvision-media-prive'
  and (storage.foldername(name))[1] = 'media'
  and is_staff()
  and (
    not est_operateur_terrain()
    or (
      (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
      and photographe_voit_album(((storage.foldername(name))[2])::uuid)
    )
  )
);

-- ─── 2. Aperçus publics : idem, dépôt, remplacement et suppression ───────────
drop policy if exists galerie_previews_staff_delete on storage.objects;
create policy galerie_previews_staff_delete on storage.objects for delete using (
  bucket_id = 'galerie-previews'
  and media_upload_staff()
  and (
    not est_operateur_terrain()
    or (
      (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
      and photographe_voit_album(((storage.foldername(name))[1])::uuid)
    )
  )
);

drop policy if exists galerie_previews_staff_update on storage.objects;
create policy galerie_previews_staff_update on storage.objects for update using (
  bucket_id = 'galerie-previews'
  and media_upload_staff()
  and (
    not est_operateur_terrain()
    or (
      (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
      and photographe_voit_album(((storage.foldername(name))[1])::uuid)
    )
  )
);

drop policy if exists galerie_previews_staff_insert on storage.objects;
create policy galerie_previews_staff_insert on storage.objects for insert with check (
  bucket_id = 'galerie-previews'
  and media_upload_staff()
  and (
    not est_operateur_terrain()
    or (
      (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
      and photographe_voit_album(((storage.foldername(name))[1])::uuid)
    )
  )
);

-- ─── 3. Le CV suit la candidature ────────────────────────────────────────────
drop policy if exists sv_media_prive_recrutement_select on storage.objects;
create policy sv_media_prive_recrutement_select on storage.objects for select using (
  bucket_id = 'sportvision-media-prive'
  and (storage.foldername(name))[1] = 'recrutement-cv'
  and exists (
    select 1 from recruitment_applications ra
     where ra.cv_path = storage.objects.name
       and peut_voir_candidature(ra.poste, ra.pole_id, ra.statut)
  )
);

-- ─── 4. Le périmètre du photographe inclut ses propres galeries ──────────────
-- Sans cet ajout, le cloisonnement posé en v164 sur `media_assets` (et repris ci-dessus sur le
-- stockage) enfermait l'opérateur terrain dans le vide : `photographe_voit_album` ne connaissait
-- que les albums rattachés à une mission, et AUCUN des albums de production n'en a un. Un
-- photographe qui crée sa galerie et y dépose ses photos — le geste le plus courant — se voyait
-- refuser sa propre galerie. Le périmètre reste borné : ses missions, ou ce qu'il a créé.
create or replace function public.photographe_voit_album(p_album_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
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
