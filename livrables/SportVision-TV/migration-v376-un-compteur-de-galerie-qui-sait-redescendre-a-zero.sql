-- v376 — UN COMPTEUR DE GALERIE QUI SAIT REDESCENDRE À ZÉRO
--
-- NON APPLIQUÉE. Écrite le 01/10/2026 en construisant l'écran « Galeries photo » de l'application
-- OS. Le gel fonctionnel est en vigueur : elle attend une décision de Fouka.
--
-- ── CE QUI A ÉTÉ MESURÉ ─────────────────────────────────────────────────────────────────────
--
-- `media_albums.photo_count` est un compteur dénormalisé, tenu par le trigger
-- `trg_media_assets_count` → `media_album_refresh_photo_count()`. Son corps se termine ainsi :
--
--     if v_count > 0 then
--       update media_albums set photo_count = v_count, updated_at = now() where id = v_album;
--     end if;
--
-- La garde `v_count > 0` fait qu'un compte qui tombe à ZÉRO n'est jamais écrit. Conséquence : une
-- galerie vidée de sa dernière photo — supprimée, passée en `failed`, ou déplacée vers une autre
-- galerie — garde son ancien chiffre pour toujours. Elle annonce « 146 photos » et n'en a plus une.
--
-- Le cas ne s'est pas encore produit en production, et c'est pour ça qu'il est encore réparable :
-- sur les 57 galeries, une seule dérive aujourd'hui (« Olympique du Loing plateau », 46 annoncées
-- contre 47 réelles), et c'est une dérive dans l'autre sens.
--
-- CE QUE ÇA COÛTERAIT LE JOUR OÙ. Le compteur n'est pas seulement décoratif : il s'affiche dans
-- Club+, dans Connect et dans l'OS. Une galerie vide qui annonce cent photos, c'est une famille qui
-- ouvre un lien payant pour trouver une page blanche.
--
-- ── POURQUOI LA GARDE EXISTAIT SANS DOUTE ──────────────────────────────────────────────────
--
-- Le trigger est AFTER DELETE ligne à ligne. En supprimant une galerie entière, chaque `delete`
-- d'asset réécrit le compteur, et le dernier l'écrirait à zéro sur une ligne qui va disparaître.
-- La garde évitait cette écriture inutile — au prix d'un compteur qui ne redescend jamais.
--
-- ── CE QUE FAIT LA CORRECTION ──────────────────────────────────────────────────────────────
--
-- On écrit toujours le compte, y compris zéro, mais SEULEMENT s'il change, et seulement si la
-- galerie existe encore. L'écriture inutile disparaît pour une autre raison que la garde d'avant :
-- `photo_count is distinct from v_count`. Aucune règle métier n'est touchée.
--
-- ── VÉRIFICATION APRÈS APPLICATION (test rouge avant, vert après) ───────────────────────────
--
--   begin;
--     -- une galerie de décor et une photo
--     insert into media_albums (id, title) values ('00000000-0000-0000-0000-0000000000cc', 'Essai');
--     insert into media_assets (album_id, original_path, checksum, width, height, status, created_by)
--       values ('00000000-0000-0000-0000-0000000000cc', 'media/essai/1.jpg', 'essai-1', 10, 10, 'ready', auth.uid());
--     select photo_count from media_albums where id = '00000000-0000-0000-0000-0000000000cc';  -- 1
--     delete from media_assets where checksum = 'essai-1';
--     select photo_count from media_albums where id = '00000000-0000-0000-0000-0000000000cc';  -- AVANT : 1 (faux). APRÈS : 0
--   rollback;

create or replace function public.media_album_refresh_photo_count()
returns trigger
language plpgsql
as $function$
declare
  v_album uuid := coalesce(new.album_id, old.album_id);
  v_count integer;
begin
  select count(*) into v_count from media_assets
  where album_id = v_album and status = 'ready';

  -- 01/10/2026 (v376). La garde `if v_count > 0` a été remplacée par une comparaison : un compteur
  -- qui ne redescend jamais à zéro fait annoncer cent photos à une galerie vide. `is distinct from`
  -- évite l'écriture inutile que la garde évitait, sans mentir sur le zéro. Le `where` porte déjà
  -- sur l'identifiant : une galerie supprimée n'est plus là, l'update ne touche aucune ligne.
  update media_albums
     set photo_count = v_count, updated_at = now()
   where id = v_album
     and photo_count is distinct from v_count;

  return null;
end;
$function$;

-- Remettre d'aplomb ce qui dérive déjà. Une seule galerie aujourd'hui (46 annoncées, 47 réelles) ;
-- la requête est écrite pour n'écrire que les lignes fausses, elle ne touche rien si tout est juste.
update media_albums a
   set photo_count = r.n, updated_at = now()
  from (select x.album_id, count(*) as n
          from media_assets x
         where x.status = 'ready'
         group by x.album_id) r
 where r.album_id = a.id
   and a.photo_count is distinct from r.n;

-- Et les galeries qui n'ont plus AUCUNE photo `ready` : elles sont absentes du regroupement
-- ci-dessus, donc invisibles pour lui. C'est exactement la classe de galeries que le défaut
-- fabriquait.
update media_albums a
   set photo_count = 0, updated_at = now()
 where a.photo_count <> 0
   and not exists (select 1 from media_assets x where x.album_id = a.id and x.status = 'ready');
