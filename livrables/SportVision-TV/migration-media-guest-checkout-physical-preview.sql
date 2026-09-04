-- Complément à migration-media-guest-checkout.sql : preview_media_checkout_token() doit exposer
-- si le produit est physique pour que /media-checkout/[token] (app-connect) sache s'il faut
-- collecter une adresse de livraison avant l'appel à create-guest-media-checkout. Le type de
-- retour change (nouvelle colonne produit_physique) : drop requis avant le create or replace.
drop function if exists public.preview_media_checkout_token(text);

create function public.preview_media_checkout_token(p_token text)
returns table(
  valide boolean,
  raison text,
  club_nom text,
  produit_nom text,
  prix_cents integer,
  devise text,
  beneficiaire_prenom text,
  produit_physique boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token_row media_guest_checkout_tokens%rowtype;
  v_club_nom text;
  v_produit_nom text;
  v_prix_cents integer;
  v_devise text;
  v_produit_statut text;
  v_beneficiaire_prenom text;
  v_produit_physique boolean;
begin
  select * into v_token_row from media_guest_checkout_tokens where token = p_token;
  if v_token_row.id is null then
    return query select false, 'introuvable'::text, null::text, null::text, null::integer, null::text, null::text, null::boolean;
    return;
  end if;

  select c.nom, p.name, p.price_cents, p.currency, p.status, pl.prenom, p.physical_product
  into v_club_nom, v_produit_nom, v_prix_cents, v_devise, v_produit_statut, v_beneficiaire_prenom, v_produit_physique
  from clubs c, media_products p, player_profiles pl
  where c.id = v_token_row.club_id and p.id = v_token_row.product_id and pl.id = v_token_row.beneficiary_person_id;

  if v_token_row.expires_at < now() then
    return query select false, 'expire'::text, v_club_nom, v_produit_nom, null::integer, null::text, null::text, null::boolean;
    return;
  end if;
  if v_token_row.used_count >= v_token_row.max_uses then
    return query select false, 'epuise'::text, v_club_nom, v_produit_nom, null::integer, null::text, null::text, null::boolean;
    return;
  end if;
  if v_produit_statut is distinct from 'active' then
    return query select false, 'produit_indisponible'::text, v_club_nom, v_produit_nom, null::integer, null::text, null::text, null::boolean;
    return;
  end if;

  return query select true, null::text, v_club_nom, v_produit_nom, v_prix_cents, v_devise, v_beneficiaire_prenom, coalesce(v_produit_physique, false);
end;
$$;

grant execute on function public.preview_media_checkout_token(text) to anon, authenticated;
