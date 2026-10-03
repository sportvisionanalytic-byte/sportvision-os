-- v491 — La grille montre ce qui reste à prendre (03/10/2026)
--
-- SUITE DIRECTE DE LA v490, ET CORRECTION D'UN OUBLI DE MA PART. La v490 rouvre l'écran de choix
-- d'un pack entamé, mais `media_gallery_order_choices`, qui remplit la grille de cet écran, se
-- fermait sur la même idée fausse :
--
--   if exists (select 1 from media_order_items where order_id = o.id) then return; end if;
--
-- Une seule photo déjà prise et la fonction ne renvoie RIEN. Les deux parents rouverts par la v490
-- auraient donc atterri sur « Aucune photo à choisir » : un écran qui leur dit d'agir, et une page
-- vide. La v490 seule ne réparait rien.
--
-- Deux changements, le même raisonnement que la v490 : la garde compare au quota au lieu de
-- comparer à zéro, et les photos déjà acquises sortent de la grille — on ne propose pas de choisir
-- une photo qu'on possède déjà, et `media_gallery_order_select` les écarterait de toute façon.
-- `total` compte donc ce qui reste réellement disponible, sinon la pagination promet des photos
-- qui ne viennent jamais.

begin;

create or replace function public.media_gallery_order_choices(p_token text, p_limit integer default 200, p_offset integer default 0)
returns table(id uuid, thumb_path text, preview_path text, width integer, height integer, total integer)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  g record;
  o record;
  v_total integer;
  v_deja integer;
begin
  select * into g from media_download_grants where token = p_token;
  if not found then return; end if;

  select * into o from media_orders where media_orders.id = g.order_id;
  -- Payée et dotée d'un quota : hors de là il n'y a rien à choisir, et donc aucune raison
  -- d'exposer l'album entier.
  if not found or o.status <> 'paid' or o.photos_allowance is null then return; end if;

  -- LE CORRECTIF. Ce n'est pas « a-t-il déjà choisi quelque chose » qui ferme la grille, c'est
  -- « n'a-t-il plus de crédit ». Un pack de 15 entamé à 4 en a encore onze à montrer.
  select count(*)::integer into v_deja from media_order_items where order_id = o.id;
  if v_deja >= o.photos_allowance then return; end if;

  -- Un droit expiré ne rouvre pas l'album : sinon un jeton de l'an dernier ferait office de
  -- visionneuse permanente.
  if g.expires_at is not null and g.expires_at < now() then return; end if;

  -- Les photos déjà acquises sortent du décompte comme de la grille : les laisser ferait miroiter
  -- des choix qui n'en sont pas, et la pagination compterait des photos jamais servies.
  select count(*)::integer into v_total
  from media_assets m
  where m.album_id = o.album_id and m.status = 'ready'
    and not exists (select 1 from media_order_items oi
                    where oi.order_id = o.id and oi.asset_id = m.id);

  return query
  select m.id, m.thumb_path, m.preview_path, m.width, m.height, v_total
  from media_assets m
  where m.album_id = o.album_id and m.status = 'ready'
    and not exists (select 1 from media_order_items oi
                    where oi.order_id = o.id and oi.asset_id = m.id)
  order by m.position asc nulls last, m.created_at asc
  limit greatest(1, least(coalesce(p_limit, 200), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

commit;
