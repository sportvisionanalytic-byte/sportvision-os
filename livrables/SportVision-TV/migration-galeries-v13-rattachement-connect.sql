-- Migration : Galeries — le rattachement automatique à un compte Connect
-- À exécuter APRÈS migration-galeries-v12-apercu-limite.sql.
--
-- ── L'état réel avant ce lot ──
-- media_gallery_claim_order() existe depuis la v4 et fonctionne. Elle n'est appelée DEPUIS NULLE
-- PART : le bouton « Créer mon compte » de la page de commande envoie `?commande=<jeton>` vers
-- /signup, et aucun fichier de Connect ne lit ce paramètre. Aucun achat n'a donc jamais été
-- rattaché automatiquement. Ce n'était pas une automatisation à améliorer, c'était un fil non
-- branché.
--
-- ── Ce que ce lot ajoute en base ──
--
--   1. media_gallery_claim_all() — rattache la commande d'origine ET toutes les autres commandes
--      invitées de la même adresse VÉRIFIÉE. Un parent achète souvent deux ou trois fois avant de
--      se décider à créer un compte ; ne récupérer que la dernière lui laisserait des commandes
--      orphelines qu'il faudrait rattacher à la main, exactement ce qu'on veut supprimer.
--
--   2. media_my_gallery_orders() — ses commandes, avec le titre de l'album et le club.
--      media_albums n'est lisible que par le staff : sans cette fonction, « Mes commandes »
--      afficherait des identifiants à la place des noms de match. On ne touche PAS aux policies
--      de media_albums pour autant — ouvrir une table entière pour afficher un titre serait
--      disproportionné.
--
-- ── La règle de sécurité, inchangée ──
-- Une commande ne se rattache QUE si l'adresse de l'acheteur est identique à l'adresse d'un
-- compte dont l'e-mail est confirmé. Ni un e-mail affiché dans un formulaire, ni la détention du
-- jeton ne suffisent : le jeton donne accès aux photos (c'est son rôle), il ne donne pas le droit
-- de s'approprier la commande pour toujours.

begin;

-- ── 1. Rattacher, y compris les achats antérieurs ──────────────────────────────────────────
create or replace function media_gallery_claim_all(p_token text default null)
returns table (
  ok boolean,
  raison text,
  rattachees integer,
  order_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  u record;
  v_order uuid := null;
  v_n integer := 0;
begin
  if auth.uid() is null then
    return query select false, 'non_connecte', 0, null::uuid;
    return;
  end if;

  select id, email, email_confirmed_at into u from auth.users where id = auth.uid();
  if u.email is null or u.email_confirmed_at is null then
    -- L'écran doit dire « confirmez votre adresse », pas « échec » : rien n'est perdu, le
    -- rattachement se rejouera tout seul à la première connexion après confirmation.
    return query select false, 'email_non_verifie', 0, null::uuid;
    return;
  end if;

  -- Le jeton ne sert qu'à SAVOIR OÙ RENVOYER l'utilisateur ensuite. Il ne donne aucun droit
  -- supplémentaire : la commande qu'il désigne ne sera rattachée que si son adresse correspond,
  -- exactement comme les autres.
  if p_token is not null then
    select g.order_id into v_order
    from media_download_grants g
    where g.token = p_token and lower(g.email) = lower(u.email);
  end if;

  -- Le droit devient permanent : c'est tout l'intérêt de créer un compte, et c'est ce qu'on a
  -- promis à l'écran. 100 ans plutôt qu'un NULL : `expires_at` est NOT NULL, et toute la chaîne
  -- de lecture compare déjà une date — un NULL demanderait de modifier chaque comparaison.
  with cibles as (
    select g.id, g.order_id
    from media_download_grants g
    join media_orders o on o.id = g.order_id
    where g.claimed_by_user_id is null
      and lower(g.email) = lower(u.email)
      and o.status = 'paid'
  ), maj_grants as (
    update media_download_grants g
    set claimed_by_user_id = auth.uid(),
        claimed_at = now(),
        expires_at = now() + interval '100 years'
    where g.id in (select id from cibles)
    returning g.order_id
  )
  select count(*)::integer into v_n from maj_grants;

  update media_orders o
  set purchased_by_user_id = auth.uid()
  where o.purchased_by_user_id is null
    and o.status = 'paid'
    and exists (
      select 1 from media_download_grants g
      where g.order_id = o.id and g.claimed_by_user_id = auth.uid()
    );

  return query select true, null::text, v_n, v_order;
end;
$$;

comment on function media_gallery_claim_all is
  'Rattache au compte connecté toutes les commandes galerie payées de son adresse VÉRIFIÉE, pas seulement celle d''où il vient. Le jeton ne sert qu''à savoir où le renvoyer ensuite : il ne donne aucun droit de rattachement.';

grant execute on function media_gallery_claim_all(text) to authenticated;

-- ── 2. Ses commandes et ses galeries ───────────────────────────────────────────────────────
-- Une seule fonction pour « Mes commandes » et « Mes galeries » : ce sont deux lectures du même
-- jeu de lignes, et deux requêtes différentes finiraient par ne plus dire la même chose.
create or replace function media_my_gallery_orders()
returns table (
  order_id uuid,
  album_id uuid,
  album_titre text,
  club_nom text,
  equipe text,
  event_date date,
  cover_url text,
  offre_nom text,
  offre_type text,
  total_cents integer,
  currency text,
  paid_at timestamptz,
  photos_count integer,
  album_photos_count integer,
  acces_permanent boolean,
  expires_at timestamptz,
  token text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    o.id,
    a.id,
    a.title,
    c.nom,
    t.name,
    a.event_date,
    a.cover_preview_url,
    p.name,
    p.type,
    o.amount_cents,
    o.currency,
    o.paid_at,
    -- Ce à quoi il a droit, et rien d'autre : pour un pack, ce sont les photos qu'il a
    -- choisies ; pour une galerie complète, celles figées au moment de l'achat. Jamais le
    -- contenu actuel de l'album, qui a pu grossir depuis.
    (select count(*)::integer from media_order_items i where i.order_id = o.id),
    -- Le contenu actuel de l'album, à titre d'information seulement.
    (select count(*)::integer from media_assets m where m.album_id = o.album_id and m.status = 'ready'),
    (g.claimed_by_user_id is not null),
    g.expires_at,
    g.token
  from media_orders o
  join media_download_grants g on g.order_id = o.id
  left join media_albums a on a.id = o.album_id
  left join clubs c on c.id = o.club_id
  left join club_teams t on t.id = a.team_id
  left join media_products p on p.id = o.product_id
  -- La sécurité tient à cette ligne : on ne lit que ce que CE compte a acheté. La fonction est
  -- SECURITY DEFINER uniquement pour lire le titre de l'album et le nom du club, qui ne sont pas
  -- lisibles par un compte Connect — pas pour élargir ce qu'il voit de ses commandes.
  where o.purchased_by_user_id = auth.uid()
    and o.status = 'paid'
  order by o.paid_at desc nulls last;
$$;

comment on function media_my_gallery_orders is
  'Commandes galerie du compte connecté, avec le titre de l''album et le club (non lisibles autrement par un compte Connect). Ne renvoie jamais de chemin d''original : le téléchargement reste signé au clic par gallery-download.';

grant execute on function media_my_gallery_orders() to authenticated;

commit;
