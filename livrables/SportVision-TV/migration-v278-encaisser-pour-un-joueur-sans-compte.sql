-- v278 — 26/09/2026 : ouvrir un accès à un joueur qui n'a pas de compte
--
-- DÉFAUT TROUVÉ EN TESTANT LA v274, PAS EN PRODUCTION — et c'est la seule bonne nouvelle.
--
-- `media_ouvrir_acces_manuellement` posait `purchased_by_user_id = player_profiles.user_id`. Or
-- ce champ est vide pour 2 des 6 joueurs en base : un enfant n'a pas de compte Connect, c'est son
-- parent qui en a un. La contrainte media_orders_buyer_check (« une commande a toujours un
-- acheteur : un compte, un e-mail d'invité, ou un acheteur supprimé ») faisait donc échouer
-- l'insertion sur une erreur 23514 brute.
--
-- Concrètement : une famille tend un billet au bord du terrain, et l'écran répond par un message
-- illisible. Le genre de panne qui arrive un samedi matin, quand personne ne peut rien y faire.
--
-- DEUX CORRECTIONS, ET AUCUNE DES DEUX N'INVENTE DE DONNÉE
--
-- 1. L'acheteur est cherché là où il se trouve vraiment : le compte du joueur s'il en a un,
--    sinon celui d'un parent confirmé. C'est aussi la bonne personne à prévenir — le parent est
--    celui qui va regarder les photos, pas l'enfant de huit ans.
--
-- 2. Quand il n'y a VRAIMENT aucun compte, la commande reste valable et `encaisse_par` devient
--    son ancrage. C'est l'esprit de la contrainte : une commande doit toujours remonter à
--    quelqu'un. Ici ce quelqu'un est le membre du staff qui a pris l'argent, ce qui est plus vrai
--    qu'un faux e-mail d'invité — et un faux e-mail aurait fini par recevoir un envoi qui
--    rebondit. On élargit donc la contrainte au lieu de fabriquer une donnée pour la satisfaire.
--
-- Le droit d'accès, lui, n'a jamais dépendu de tout ça : il est porté par
-- `beneficiary_person_id`, le joueur. L'accès fonctionnera le jour où une famille se rattachera
-- à ce joueur, même si personne n'a de compte aujourd'hui.
--
-- Idempotent.

alter table media_orders drop constraint if exists media_orders_buyer_check;
alter table media_orders add constraint media_orders_buyer_check check (
  purchased_by_user_id is not null
  or guest_email is not null
  or acheteur_supprime_le is not null
  -- 26/09/2026 : l'encaissement au club. La tracabilite est assuree par qui a pris l'argent.
  or encaisse_par is not null
);

create or replace function public.media_ouvrir_acces_manuellement(
  p_product_id uuid,
  p_player_id  uuid,
  p_moyen      text,
  p_note       text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_product   record;
  v_order     uuid;
  v_acheteur  uuid;
  v_res       jsonb;
begin
  if not media_commerce_staff() then
    raise exception 'Seule l''administration SportVision ouvre un accès sans paiement en ligne.'
      using errcode = '42501';
  end if;
  if p_moyen not in ('especes','virement','offert') then
    raise exception 'Moyen d''encaissement inconnu.' using errcode = '22023';
  end if;

  select id, club_id, price_cents, currency, status into v_product
    from media_products where id = p_product_id;
  if v_product.id is null or v_product.status <> 'active' then
    raise exception 'Ce produit n''est pas disponible.' using errcode = '22023';
  end if;

  if not exists (select 1 from player_profiles where id = p_player_id) then
    raise exception 'Ce joueur est introuvable.' using errcode = 'P0002';
  end if;

  if exists (select 1 from media_entitlements
              where beneficiary_person_id = p_player_id
                and product_id = p_product_id and status = 'active') then
    raise exception 'Ce joueur a déjà cet accès.' using errcode = '22023';
  end if;

  -- Le compte du joueur s'il en a un, sinon celui d'un parent confirme : c'est lui qui recevra la
  -- notification d'acces ouvert, et c'est lui qui regarde les photos.
  select pp.user_id into v_acheteur from player_profiles pp where pp.id = p_player_id;
  if v_acheteur is null then
    select pa.user_id into v_acheteur
      from parent_player_relationships r
      join parent_profiles pa on pa.id = r.parent_id
     where r.player_id = p_player_id and r.statut = 'confirme' and pa.user_id is not null
     order by r.created_at
     limit 1;
  end if;

  -- Un encaissement offert vaut 0 : la comptabilite ne doit pas voir une recette qui n'existe pas.
  insert into media_orders (club_id, product_id, purchased_by_user_id, beneficiary_person_id,
                            amount_cents, currency, status, shipping_status,
                            source, encaisse_par, note_encaissement)
  values (v_product.club_id, p_product_id, v_acheteur, p_player_id,
          case when p_moyen = 'offert' then 0 else v_product.price_cents end,
          v_product.currency, 'pending', 'non_requis',
          p_moyen, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_order;

  v_res := media_activer_commande(v_order);
  return v_res || jsonb_build_object('order_id', v_order,
                                     'prevenu', v_acheteur is not null);
end $function$;

revoke all on function public.media_ouvrir_acces_manuellement(uuid, uuid, text, text) from public;
grant execute on function public.media_ouvrir_acces_manuellement(uuid, uuid, text, text) to authenticated;
