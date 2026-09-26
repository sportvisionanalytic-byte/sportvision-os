-- v284 — 26/09/2026 : un coach ou un CM qui ouvre la galerie ne doit pas voir le filigrane
--
-- Constat de Fouka : « quand je suis community manager sur Club+, j'ouvre la galerie, je vois le
-- filigrane. Alors que les coachs, les membres du club, du staff, eux doivent voir les photos
-- normalement. »
--
-- POURQUOI LA v281 NE SUFFISAIT PAS
--
-- Elle a bien donné l'aperçu net au staff du club — mais seulement sur les écrans « mes photos »,
-- ceux d'une famille. Or depuis Club+, « ouvrir la galerie » mène à la page PUBLIQUE par lien, et
-- `media_gallery_photos` ne regarde que le lien : elle ne sait pas QUI le présente. Un community
-- manager y était donc « quelqu'un avec un lien », exactement comme un parent d'équipe adverse.
--
-- C'est le même oubli que d'habitude sur ce projet : la règle posée sur un chemin, et un second
-- chemin qui l'ignore. Il y en a trois pour les photos d'une galerie, et ils doivent tous les trois
-- répondre pareil.
--
-- LE PLAFOND DU LIEN N'EST PAS TOUCHÉ, ET C'EST VOLONTAIRE
--
-- Un lien peut être limité à N photos (`preview_limit`) : c'est une décision commerciale prise sur
-- le lien, pas une protection contre le vol. Elle continue de s'appliquer à tout le monde, staff
-- compris. Ce que cette migration change, c'est la QUALITÉ de ce qui est servi, jamais la quantité.
--
-- Idempotent.

drop function if exists public.media_gallery_photos(text, text, text, integer, integer);

create or replace function public.media_gallery_photos(
  p_slug text, p_token text, p_password text default null::text,
  p_limit integer default 60, p_offset integer default 0
) returns table (
  id uuid, thumb_path text, preview_path text, preview_clair_path text,
  width integer, height integer, total bigint, visibles integer
)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  v_max integer;
  v_debut integer;
  v_page integer;
  v_net boolean;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then return; end if;

  -- LA SEULE NOUVEAUTÉ : on demande qui regarde. La réponse vaut `false` pour un visiteur non
  -- connecté, donc le comportement public ne change pas d'un iota.
  v_net := media_voit_sans_filigrane(r.album_id);

  v_max := _media_gallery_preview_limit(r.link_id);
  v_debut := greatest(0, coalesce(p_offset, 0));
  v_page := greatest(1, least(coalesce(p_limit, 60), 200));

  -- Lien plafonné : on ne sert jamais au-delà, et une page qui commence après le plafond ne
  -- renvoie rien plutôt que de re-servir les premières. Le plafond reste le même pour tous : c'est
  -- une décision commerciale sur le lien, pas une protection.
  if v_max is not null then
    if v_debut >= v_max then return; end if;
    v_page := least(v_page, v_max - v_debut);
  end if;

  return query
  select m.id, m.thumb_path, m.preview_path,
         -- Le chemin net ne sort que pour qui y a droit. La politique de stockage refuserait le
         -- fichier de toute façon, mais rendre un chemin inutilisable ferait afficher des images
         -- cassées au lieu d'aperçus marqués.
         case when v_net then m.preview_clair_path else null end,
         m.width, m.height,
         count(*) over () as total,
         v_max as visibles
  from media_assets m
  where m.album_id = r.album_id
    and m.status = 'ready'
    and m.thumb_path is not null
  order by m.position, m.created_at, m.id
  limit v_page
  offset v_debut;
end;
$function$;
