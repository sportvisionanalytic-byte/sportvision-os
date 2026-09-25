-- v279 — 26/09/2026 : Google Play encaisse aussi, par le même chemin qu'Apple
--
-- Décision de Fouka : « vas-y, fais les trucs de paiement sur Google Android ». C'est l'option la
-- plus sûre des trois que je lui avais présentées : Google Play exige son propre système de
-- facturation pour le contenu numérique, et le lien externe vers Stripe, même autorisé dans l'EEE
-- par le DMA, passe par un programme d'inscription. Mieux vaut un quatrième chemin conforme qu'un
-- refus au dépôt.
--
-- POURQUOI UNE COLONNE GÉNÉRIQUE ET NON UN `google_purchase_token` À CÔTÉ DE `apple_transaction_id`
--
-- Les deux magasins rendent la même chose : un identifiant opaque qui désigne un achat et qui ne
-- doit servir qu'une fois. Deux colonnes auraient voulu dire deux index uniques, deux contrôles de
-- rejeu, et la certitude qu'un jour l'un des deux soit oublié. `store_transaction_id` porte l'un
-- ou l'autre, et `source` dit lequel.
--
-- `apple_transaction_id` est conservée mais n'est plus écrite : aucune ligne ne la porte
-- aujourd'hui (aucun achat encore encaissé), et la garder évite de casser la restauration d'une
-- sauvegarde antérieure pour ne rien gagner.
--
-- LES PRIX DIVERGENT ENTRE LES DEUX MAGASINS, ET C'EST INÉVITABLE
--
-- Apple impose des paliers : 19,90 n'en est pas un, ce sera 19,99. Google laisse fixer le prix
-- librement : ce sera exactement 19,90, comme au web. Un même Pass coûtera donc 9 centimes de plus
-- sur iPhone. C'est assumé : afficher un prix différent de celui prélevé serait pire.
--
-- Idempotent.

alter table media_orders add column if not exists store_transaction_id text;

-- Reprise de ce qu'aurait écrit la version Apple seule, s'il y avait eu des lignes.
update media_orders
   set store_transaction_id = apple_transaction_id
 where apple_transaction_id is not null and store_transaction_id is null;

-- LA GARDE ANTI-REJEU, la même pour les deux magasins. Sans elle, une transaction représentée
-- (réinstallation, restauration d'achats, reprise réseau) ouvrirait un second accès pour un seul
-- paiement — et côté Google la représentation est la norme, pas l'exception : un achat non
-- consommé revient à chaque lancement.
create unique index if not exists media_orders_store_tx_uniq
  on media_orders (store_transaction_id) where store_transaction_id is not null;

-- Google rejoint la liste des encaisseurs possibles.
alter table media_orders drop constraint if exists media_orders_source_check;
alter table media_orders add constraint media_orders_source_check
  check (source in ('stripe','apple','google','especes','virement','offert'));

-- L'identifiant du produit côté Play. NULL = ce Pass n'est pas vendu dans l'app Android, et l'app
-- n'affiche alors aucun bouton d'achat. Jamais déduit du prix : deux clubs sur un même tarif
-- finiraient par ouvrir l'accès du mauvais.
alter table media_products add column if not exists google_product_id text;

-- Google accepte le prix exact du club, donc l'identifiant porte ce prix-là, pas un palier.
update media_products set google_product_id = 'pass_photo_19_90'
 where type = 'pass_saison' and price_cents = 1990 and google_product_id is null;
update media_products set google_product_id = 'pass_photo_39_90'
 where type = 'pass_saison' and price_cents = 3990 and google_product_id is null;

-- ── Ce que l'app a le droit de savoir, les deux magasins compris ─────────────────────────────
-- Remplace la version de la v275, qui ne rendait que l'identifiant Apple. Même cloisonnement :
-- le joueur lui-même ou son parent confirmé, jamais un identifiant de joueur pris tel quel.
drop function if exists public.media_pass_disponible(uuid, uuid);

create or replace function public.media_pass_disponible(
  p_club_id uuid,
  p_player_id uuid
) returns table (
  product_id uuid,
  name text,
  price_cents int,
  currency text,
  apple_product_id text,
  google_product_id text,
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

  select exists (
    select 1 from player_profiles pp
     where pp.id = p_player_id and pp.user_id = auth.uid()
  ) into v_autorise;

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
  select pr.id, pr.name, pr.price_cents, pr.currency,
         pr.apple_product_id, pr.google_product_id,
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
