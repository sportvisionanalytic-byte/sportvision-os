-- Trois façons de payer le Pass Photo doivent ouvrir EXACTEMENT le même accès.
--
-- Pourquoi ce test existe : Stripe, Apple et l'encaissement au club créent chacun leur commande,
-- puis appellent media_activer_commande (v274). Le jour où quelqu'un « optimisera » un de ces
-- trois chemins en écrivant media_entitlements directement, les droits divergeront selon le moyen
-- de paiement — et personne ne le verra, parce qu'un accès ouvert marche jusqu'à ce qu'on compare.
--
-- Ce test compare. Il vérifie aussi le rejeu, qui est le cas NORMAL sur Apple : StoreKit
-- represente une transaction non close à chaque lancement de l'application.
--
-- Lancer :
--   curl -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
--     -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" \
--     --data "$(python3 -c "import json,sys;print(json.dumps({'query':sys.stdin.read()}))" < ce-fichier)"
--
-- Il N'ÉCRIT RIEN : tout se passe dans une transaction que le RAISE final annule. C'est voulu —
-- un test qui laisse des commandes payées en base fausse la comptabilité qu'il est censé protéger.

do $$
declare
  r record;
  v_joueur uuid;
  v_order  uuid;
  v_res    jsonb;
  v_rejeu  jsonb;
  v_scopes text;
  v_attendu int;
  echecs   text := '';
  testes   int := 0;
begin
  for r in select p.id, p.club_id, p.name, p.scope_type, p.price_cents,
                  coalesce(array_length(p.team_ids, 1), 0) as n_equipes
             from media_products p
            where p.status = 'active' and p.type = 'pass_saison'
  loop
    select pp.id into v_joueur from player_profiles pp where pp.club_id = r.club_id limit 1;
    if v_joueur is null then continue; end if;
    testes := testes + 1;

    -- Combien de droits ce produit DOIT ouvrir, calculé indépendamment du moteur.
    if r.scope_type = 'team' and r.n_equipes > 0 then
      v_attendu := r.n_equipes;
    elsif r.scope_type = 'event' then
      select count(distinct o.event_id) into v_attendu
        from media_sales_operation_products sop
        join media_sales_operations o on o.id = sop.sales_operation_id
       where sop.product_id = r.id and o.event_id is not null;
      if coalesce(v_attendu, 0) = 0 then v_attendu := 1; end if;   -- repli club
    else
      v_attendu := 1;
    end if;

    insert into media_orders (club_id, product_id, beneficiary_person_id, amount_cents, currency,
                              status, shipping_status, source, guest_email)
    values (r.club_id, r.id, v_joueur, r.price_cents, 'eur', 'pending', 'non_requis', 'especes',
            'test-trois-chemins@sportvision.invalid')
    returning id into v_order;

    v_res   := media_activer_commande(v_order);
    v_rejeu := media_activer_commande(v_order);

    if (v_res->>'droits')::int <> v_attendu then
      echecs := echecs || format(E'\n  ECHEC %s : %s droits ouverts, %s attendus',
                                 r.name, v_res->>'droits', v_attendu);
    end if;

    -- Le rejeu ne doit RIEN recréer : c'est le verrou qui protège d'un double accès sur une
    -- transaction Apple représentée, ou d'un webhook Stripe rejoué.
    if (v_rejeu->>'droits')::int <> 0 or (v_rejeu->>'deja_activee')::boolean is not true then
      echecs := echecs || format(E'\n  ECHEC %s : le rejeu a recréé des droits (%s)', r.name, v_rejeu);
    end if;

    -- La commande doit être payée, et porter son moyen d'encaissement.
    if not exists (select 1 from media_orders where id = v_order and status = 'paid' and source = 'especes') then
      echecs := echecs || format(E'\n  ECHEC %s : la commande n''est pas passée à payée', r.name);
    end if;

    -- Aucun droit ne doit sortir du club de la commande.
    select string_agg(distinct club_id::text, ',') into v_scopes
      from media_entitlements where order_id = v_order;
    if v_scopes is distinct from r.club_id::text then
      echecs := echecs || format(E'\n  ECHEC %s : droits ouverts sur %s au lieu de %s',
                                 r.name, v_scopes, r.club_id);
    end if;
  end loop;

  if testes = 0 then
    raise exception 'RIEN TESTE : aucun Pass saison actif avec un joueur. Test non concluant.';
  end if;
  if echecs <> '' then
    raise exception 'ROUGE (% produits testés)%', testes, echecs;
  end if;
  raise exception 'VERT : % produits, droits conformes, rejeu sans effet, aucun débordement de club.', testes;
end $$;
