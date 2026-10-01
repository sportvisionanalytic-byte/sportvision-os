-- v430 — L'APERÇU SANS FILIGRANE SE JUGE PHOTO PAR PHOTO, PAS GALERIE PAR GALERIE (01/10/2026)
--
-- ═══ CE QUI A ÉTÉ MESURÉ, PAR LE CHEMIN RÉEL, AVEC UN VRAI JETON DE FAMILLE ═══════════════════
--
-- Compte : demo.joueur.fontainebleau@example.invalid, Pass Photo payé (portée « club »).
-- Galerie : « RCPF VS PSG U16 », 110 photos, dont 8 marquées comme étant les siennes.
--
--   1. POST /rest/v1/rpc/media_galerie_a_identifier   →  200, 110 lignes.
--      96 d'entre elles ne sont ni les siennes, ni des propositions à trancher. Chacune porte son
--      `preview_path`, le chemin de l'aperçu filigrané, qui est PUBLIC.
--
--   2. L'aperçu SANS filigrane se déduit de ce chemin, sans rien deviner :
--          <album>/<uuid>-p.webp     →     apercus-clairs/<album>/<uuid>-pc.webp
--
--   3. POST /storage/v1/object/sign/sportvision-media-prive/apercus-clairs/…-pc.webp
--          →  200, et l'image se télécharge : 249 166 octets, image/webp.
--      C'est la photo d'un AUTRE ENFANT, sans filigrane, dans les mains d'une famille qui n'a payé
--      que pour voir les siennes.
--
--   4. En SQL, par le chemin réel (`set local role authenticated`), ce même compte lit
--      2 467 objets du dossier `apercus-clairs` — pour 8 photos qui sont les siennes.
--
-- POURQUOI. La policy de lecture du dossier posait UNE SEULE question :
--
--     media_voit_sans_filigrane( (storage.foldername(name))[2]::uuid )
--
-- c'est-à-dire « cette personne a-t-elle le droit de voir CETTE GALERIE sans filigrane ». La
-- réponse est oui dès que le Pass est payé. Mais ce que le Pass retire, c'est le filigrane SUR SES
-- PHOTOS — la règle est écrite noir sur blanc dans la v330, et `media_photos_du_joueur` la tient.
-- Le stockage, lui, ne la connaissait pas : il raisonnait par galerie. Les deux portes donnent sur
-- la même pièce, une seule était fermée. C'est exactement la leçon du 27/09 (v303).
--
-- CE QUE CETTE MIGRATION CHANGE. La policy pose désormais la question à la PHOTO. Une fonction,
-- `media_apercu_clair_lisible(nom de l'objet)`, dit qui peut lire ce fichier-là :
--
--     le staff SportVision          toutes les photos de ses prestations (c'est son travail)
--     le club                       toutes les photos de ses galeries (il les publie)
--     la famille                    SES photos (un marquage valide) et les photos de GROUPE,
--                                   et seulement si le Pass est payé
--
-- C'est mot pour mot la règle de `media_photos_du_joueur` : « ses photos, plus les photos de
-- groupe, jamais celles des autres ». Elle n'est pas réécrite ici, elle est posée au même endroit
-- que le fichier qu'elle protège.
--
-- POURQUOI PAR LE CHEMIN ET NON PAR L'IDENTIFIANT. L'objet est retrouvé par `preview_clair_path`,
-- son chemin exact tel qu'il est écrit dans `media_assets`. Pas de découpage de dossier, pas de
-- cast d'uuid sur un fragment de nom : un fichier qui ne correspond à aucune photo connue n'est
-- lisible par personne, et rien ne lève d'erreur. Un `::uuid` sur un nom de dossier inattendu
-- aurait fait tomber la lecture en 500 au lieu de la refuser.
--
-- CE QUE ÇA NE CHANGE PAS : le dépôt, la modification et la suppression de ces fichiers restent
-- réservés à `media_upload_staff()`, inchangés. Et `media_voit_sans_filigrane` n'est pas touchée :
-- elle reste la porte de la galerie, elle n'est plus la seule serrure.
--
-- ROUGE AVANT / VERT APRÈS : livrables/SportVision-TV/tests/apercu-net-photo-par-photo.test.mjs

begin;

-- L'INDEX D'ABORD. La policy s'évalue UNE FOIS PAR OBJET : signer les 110 aperçus d'un match, c'est
-- 110 appels. Sans index, chacun parcourait les 7 784 lignes de media_assets. L'écran d'une galerie
-- s'ouvre au bord d'un terrain, en 4G.
create index if not exists idx_massets_preview_clair_path
  on public.media_assets (preview_clair_path)
  where preview_clair_path is not null;

create or replace function public.media_apercu_clair_lisible(p_nom text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from media_assets a
      join media_albums al on al.id = a.album_id
     where a.preview_clair_path = p_nom
       and al.status = 'published'
       and (
         -- 1. LE STAFF SPORTVISION. Même nuance que partout ailleurs : un opérateur terrain n'est
         -- staff que pour SES prestations, sinon il récupérerait n'importe quelle galerie.
         (is_staff() and (not est_operateur_terrain() or photographe_voit_album(a.album_id)))

         -- 2. LE CLUB. Coach de l'équipe concernée, président, secrétaire, CM affilié. La règle de
         -- cloisonnement vit dans media_club_voit_la_galerie(), et nulle part ailleurs (v303).
         or public.media_club_voit_la_galerie(a.album_id)

         -- 3. LA FAMILLE. Le Pass payé ouvre la galerie ; la photo doit être la sienne.
         or (
           public.media_voit_sans_filigrane(a.album_id)
           and (
             -- Une photo de groupe est une photo que le Pass DONNE (v353).
             a.photo_de_groupe
             -- Ou un marquage VALIDE pour un sportif dont ce compte a la charge. Une suggestion
             -- que personne n'a tranchée ne suffit pas : tant que c'est une proposition, la photo
             -- reste filigranée. C'est la règle de la v330.
             or exists (
               select 1 from media_player_tags t
                where t.media_ref_type = 'media_asset'
                  and t.media_ref_id = a.id
                  and t.statut = 'valide'
                  and (is_own_player(t.player_id) or is_confirmed_parent_of(t.player_id))
             )
           )
         )
       )
  );
$$;

comment on function public.media_apercu_clair_lisible(text) is
  'v430 — Qui peut lire CE fichier d''aperçu sans filigrane. Le staff et le club voient toute la '
  'galerie ; une famille voit ses photos et les photos de groupe, et seulement avec le Pass payé. '
  'L''objet est retrouvé par son chemin exact (media_assets.preview_clair_path) : un fichier '
  'inconnu n''est lisible par personne.';

-- La policy de lecture du dossier. On la remplace, on n'en ajoute pas une seconde : deux policies
-- SELECT sur la même table se cumulent en OU, et l'ancienne aurait continué d'ouvrir la galerie
-- entière.
drop policy if exists sv_media_prive_apercus_clairs_select on storage.objects;

create policy sv_media_prive_apercus_clairs_select
on storage.objects for select
using (
  bucket_id = 'sportvision-media-prive'
  and (storage.foldername(name))[1] = 'apercus-clairs'
  and public.media_apercu_clair_lisible(name)
);

commit;
