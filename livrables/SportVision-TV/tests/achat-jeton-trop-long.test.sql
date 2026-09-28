-- Le reçu d'un magasin ne tient pas dans un index (28/09/2026).
--
-- DÉFAUT MESURÉ. `iap-valider` écrivait le reçu JWS complet d'Apple dans
-- `media_orders.store_transaction_id`, une colonne qui porte un index unique. Un reçu StoreKit 2
-- fait 3 000 à 4 000 octets ; un index btree refuse au-delà de 2 704 :
--
--   ERROR 54000 : index row size 3016 exceeds btree version 4 maximum 2704
--                 for index "media_orders_store_tx_uniq"
--
-- AUCUN achat iOS ne pouvait donc être enregistré. Apple validait le reçu, notre serveur le
-- refusait à l'écriture, et la famille lisait « Impossible d'enregistrer cet achat » APRÈS avoir
-- payé. Le relecteur d'Apple butait exactement là — c'est très probablement la raison du refus de
-- la version 1.0, et ça l'aurait été de la suivante.
--
-- On écrit désormais l'IDENTIFIANT de transaction, une vingtaine de chiffres, stable d'une
-- restauration à l'autre. Ce test tient les deux bouts : l'identifiant passe, et un reçu entier
-- est toujours refusé — parce que si quelqu'un le remet un jour, il faut que ça se voie ici et
-- non chez un client qui vient de payer.
--
-- Décor fictif, tout est annulé.

do $$
declare
  v_club uuid; v_produit uuid; v_acheteur uuid; v_rapport text := '';
  v_court text; v_long text; v_ok boolean;
begin
  select p.id, p.club_id into v_produit, v_club
    from media_products p where p.club_id is not null and p.status = 'active' limit 1;
  select id into v_acheteur from auth.users limit 1;
  if v_produit is null or v_acheteur is null then
    raise exception 'ROUGE : pas de produit actif ou pas de compte, le test ne mesure rien';
  end if;

  -- Un identifiant de transaction, tel qu'Apple le rend.
  v_court := '2000001243336628';
  -- Un reçu de la taille d'un vrai JWS, incompressible.
  -- `gen_random_bytes` est plafonne ; on fabrique donc l'aleatoire autrement. Il FAUT que ce soit
  -- incompressible : une suite de caracteres identiques passerait l'index sans rien prouver, parce
  -- que Postgres la compresse avant de l'indexer. C'est l'erreur que j'ai faite au premier essai.
  select string_agg(md5(random()::text || g::text), '') into v_long from generate_series(1, 100) g;

  begin
    insert into media_orders (club_id, product_id, purchased_by_user_id, amount_cents, currency,
                              status, shipping_status, source, store_transaction_id)
    values (v_club, v_produit, v_acheteur, 3999, 'eur', 'pending', 'non_requis', 'apple', v_court);
    v_rapport := v_rapport || E'\n  vert   un identifiant de transaction s''enregistre';
  exception when others then
    v_rapport := v_rapport || E'\n  ROUGE  un identifiant de transaction est refuse : ' || sqlerrm;
  end;

  begin
    insert into media_orders (club_id, product_id, purchased_by_user_id, amount_cents, currency,
                              status, shipping_status, source, store_transaction_id)
    values (v_club, v_produit, v_acheteur, 3999, 'eur', 'pending', 'non_requis', 'apple', v_long);
    v_rapport := v_rapport || E'\n  ROUGE  un recu entier a ete accepte : l''index ne protege plus rien';
  exception when others then
    v_rapport := v_rapport || format(E'\n  vert   un recu entier (%s octets) reste refuse, comme prevu', length(v_long));
  end;

  raise exception E'%\n', v_rapport using errcode = 'P0001';
end $$;
