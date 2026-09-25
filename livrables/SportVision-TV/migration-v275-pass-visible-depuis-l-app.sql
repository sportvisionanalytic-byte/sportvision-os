-- v275 — 25/09/2026 : ce que l'app a le droit de savoir du Pass avant de l'acheter
--
-- Pour proposer l'achat, l'app a besoin de trois choses : quel Pass ce club vend, combien il
-- coute, et sous quel identifiant Apple il est vendu. Elle a aussi besoin de savoir si le joueur
-- l'a deja — proposer d'acheter ce qu'on possede est la meilleure facon de se faire rembourser.
--
-- Pourquoi une fonction et pas une lecture directe de media_products : le catalogue porte les
-- marges, les operations de vente et les produits en brouillon. Une RLS de lecture ouverte sur la
-- table entiere exposerait tout ca a n'importe quel compte. Ici, on ne rend QUE la ligne active
-- du Pass saison, et seulement a quelqu'un qui a le droit d'acheter pour ce joueur.
--
-- Le prix rendu est celui du club. Sur iOS, ce n'est PAS celui qui sera debite : Apple impose ses
-- propres paliers. L'app affiche donc le prix que StoreKit lui donne, jamais celui-ci, et
-- `price_cents` ne sert qu'aux ecrans web. Confondre les deux afficherait 19,90 a quelqu'un a qui
-- Apple va prelever 19,99.
--
-- Idempotent.

create or replace function public.media_pass_disponible(
  p_club_id uuid,
  p_player_id uuid
) returns table (
  product_id uuid,
  name text,
  price_cents int,
  currency text,
  apple_product_id text,
  deja_actif boolean
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_autorise boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;

  -- Le joueur lui-meme...
  select exists (
    select 1 from player_profiles pp
     where pp.id = p_player_id and pp.user_id = auth.uid()
  ) into v_autorise;

  -- ...ou son parent confirme. Jamais un identifiant de joueur pris tel quel, meme doctrine que
  -- create-pass-photo-checkout et apple-iap-valider.
  if not v_autorise then
    select exists (
      select 1
        from parent_profiles pa
        join parent_player_relationships r on r.parent_id = pa.id
       where pa.user_id = auth.uid()
         and r.player_id = p_player_id
         and r.statut = 'confirme'
    ) into v_autorise;
  end if;

  if not v_autorise then
    raise exception 'Ce joueur n''est pas rattaché à votre compte.' using errcode = '42501';
  end if;

  return query
  select pr.id, pr.name, pr.price_cents, pr.currency, pr.apple_product_id,
         exists (
           select 1 from media_entitlements e
            where e.beneficiary_person_id = p_player_id
              and e.product_id = pr.id
              and e.status = 'active'
         ) as deja_actif
    from media_products pr
   where pr.club_id = p_club_id
     and pr.type = 'pass_saison'
     and pr.status = 'active'
     and (pr.valid_from is null or pr.valid_from <= current_date)
     and (pr.valid_until is null or pr.valid_until >= current_date)
   order by pr.price_cents
   limit 1;
end $function$;

revoke all on function public.media_pass_disponible(uuid, uuid) from public;
grant execute on function public.media_pass_disponible(uuid, uuid) to authenticated;
