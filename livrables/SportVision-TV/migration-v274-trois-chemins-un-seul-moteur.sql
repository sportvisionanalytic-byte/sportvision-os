-- v274 — 25/09/2026 : trois facons de payer le Pass, un seul moteur pour l'ouvrir
--
-- Decision de Fouka : « ils peuvent soit le deverrouiller sur l'application soit sur la version
-- web en passant par Stripe. S'ils passent par l'application ils paieront par Apple, et s'ils
-- passent par le club ils me paieront en especes ou en virement et moi je debloque leur compte. »
--
-- Trois chemins d'encaissement, donc, et c'est exactement la situation ou ce projet a deja paye
-- cher le fait d'ecrire deux fois la meme regle (cf. « jamais un second moteur d'import »). La
-- logique qui transforme une commande payee en droits d'acces vit desormais UNE fois, ici, dans
-- media_activer_commande(). Stripe, Apple et l'encaissement manuel ne font que creer la commande
-- et appeler cette fonction.
--
-- Ce qui n'est PAS touche : le calcul des scopes est recopie a l'identique depuis la branche
-- mediaOrderId de stripe-webhook (product.scope_type team / event / repli club). Aucune regle
-- metier n'est modifiee par cette migration.
--
-- Idempotent.

-- ── 1. D'ou vient l'argent ───────────────────────────────────────────────────────────────────
alter table media_orders add column if not exists source text not null default 'stripe';
alter table media_orders add column if not exists apple_transaction_id text;
alter table media_orders add column if not exists encaisse_par uuid references auth.users(id);
alter table media_orders add column if not exists note_encaissement text;

do $$ begin
  alter table media_orders add constraint media_orders_source_check
    check (source in ('stripe','apple','especes','virement','offert'));
exception when duplicate_object then null; end $$;

-- L'identifiant de transaction Apple est la garde anti-rejeu : StoreKit peut relivrer la meme
-- transaction (reinstallation, restauration, retry reseau). Sans cet index, chaque relivraison
-- ouvrirait un second acces pour un seul paiement.
create unique index if not exists media_orders_apple_tx_uniq
  on media_orders (apple_transaction_id) where apple_transaction_id is not null;

-- Quel produit Apple represente ce Pass. NULL = ce produit n'est pas vendu dans l'app iOS, et
-- l'app n'affiche alors aucun bouton d'achat. On ne devine JAMAIS le produit Apple a partir du
-- prix : Apple impose ses propres paliers (19,99 la ou le club affiche 19,90), et un rapprochement
-- par montant finirait par ouvrir le mauvais acces le jour ou deux clubs se croisent sur un palier.
alter table media_products add column if not exists apple_product_id text;

-- ── 2. Le moteur, une seule fois ─────────────────────────────────────────────────────────────
create or replace function public.media_activer_commande(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order   record;
  v_product record;
  v_scope   record;
  v_n       int := 0;
begin
  -- Le passage 'pending' -> 'paid' EST le verrou d'idempotence, comme cote Stripe : s'il ne rend
  -- aucune ligne, la commande a deja ete activee et les droits ne doivent pas etre recrees.
  update media_orders
     set status = 'paid', paid_at = coalesce(paid_at, now())
   where id = p_order_id and status = 'pending'
  returning id, club_id, product_id, purchased_by_user_id, beneficiary_person_id
    into v_order;

  if v_order.id is null then
    return jsonb_build_object('ok', true, 'deja_activee', true, 'droits', 0);
  end if;

  select saison_id, scope_type, team_ids into v_product
    from media_products where id = v_order.product_id;

  if v_product.saison_id is null then
    -- Commande payee sans produit lisible : on ne fabrique pas de droit au hasard. La commande
    -- reste 'paid' (l'argent est bien encaisse) et l'appelant voit droits = 0.
    return jsonb_build_object('ok', false, 'motif', 'produit_introuvable', 'droits', 0);
  end if;

  for v_scope in
    select 'team'::text as scope_type, unnest(v_product.team_ids)::uuid as scope_id
     where v_product.scope_type = 'team'
       and v_product.team_ids is not null
       and array_length(v_product.team_ids, 1) > 0
    union all
    select 'event'::text, o.event_id
      from media_sales_operation_products sop
      join media_sales_operations o on o.id = sop.sales_operation_id
     where v_product.scope_type = 'event'
       and sop.product_id = v_order.product_id
       and o.event_id is not null
  loop
    insert into media_entitlements (club_id, saison_id, product_id, beneficiary_person_id,
                                    purchased_by_user_id, scope_type, scope_id, order_id, status)
    values (v_order.club_id, v_product.saison_id, v_order.product_id, v_order.beneficiary_person_id,
            v_order.purchased_by_user_id, v_scope.scope_type, v_scope.scope_id, v_order.id, 'active');
    v_n := v_n + 1;
  end loop;

  -- Repli club : un produit dont le scope ne designe aucune equipe ni aucun evenement ouvre tout
  -- le club. C'est la regle de stripe-webhook, recopiee telle quelle.
  if v_n = 0 then
    insert into media_entitlements (club_id, saison_id, product_id, beneficiary_person_id,
                                    purchased_by_user_id, scope_type, scope_id, order_id, status)
    values (v_order.club_id, v_product.saison_id, v_order.product_id, v_order.beneficiary_person_id,
            v_order.purchased_by_user_id, 'club', null, v_order.id, 'active');
    v_n := 1;
  end if;

  if v_order.purchased_by_user_id is not null then
    insert into member_notifications (user_id, category, title, body, target_href)
    values (v_order.purchased_by_user_id, 'payments', 'Accès média activé',
            'Votre achat est confirmé — les albums correspondants sont maintenant déverrouillés.',
            '/photos');
  end if;

  return jsonb_build_object('ok', true, 'deja_activee', false, 'droits', v_n);
end $function$;

-- Elle ecrit des droits d'acces payants : personne ne l'appelle depuis le navigateur. Seules les
-- Edge Functions (service_role) et les fonctions SECURITY DEFINER de cette migration la touchent.
-- Revoque depuis PUBLIC et non depuis `anon` : `anon` herite de PUBLIC, retirer le droit a anon
-- seul ne retire rien (lecon du 09/09/2026).
revoke all on function public.media_activer_commande(uuid) from public;

-- ── 3. Le chemin manuel : especes, virement, geste commercial ────────────────────────────────
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
  v_product record;
  v_order   uuid;
  v_res     jsonb;
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

  -- Un encaissement offert vaut 0 : la comptabilite ne doit pas voir une recette qui n'existe pas.
  insert into media_orders (club_id, product_id, purchased_by_user_id, beneficiary_person_id,
                            amount_cents, currency, status, shipping_status,
                            source, encaisse_par, note_encaissement)
  values (v_product.club_id, p_product_id,
          (select user_id from player_profiles where id = p_player_id),
          p_player_id,
          case when p_moyen = 'offert' then 0 else v_product.price_cents end,
          v_product.currency, 'pending', 'non_requis',
          p_moyen, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_order;

  v_res := media_activer_commande(v_order);
  return v_res || jsonb_build_object('order_id', v_order);
end $function$;

revoke all on function public.media_ouvrir_acces_manuellement(uuid, uuid, text, text) from public;
grant execute on function public.media_ouvrir_acces_manuellement(uuid, uuid, text, text) to authenticated;
