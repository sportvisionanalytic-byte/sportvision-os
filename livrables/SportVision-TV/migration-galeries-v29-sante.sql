-- Migration : un seul endroit pour voir ce qui va mal
-- À exécuter APRÈS migration-galeries-v28-matrice-acces.sql.
--
-- ── Pourquoi ──
-- Nous entrons en production réelle. Aujourd'hui, une commande payée sans droit de téléchargement,
-- un e-mail définitivement échoué ou un dépôt de photo bloqué ne se découvrent que si un client
-- écrit. Il faut pouvoir les voir AVANT qu'il écrive.
--
-- ── Ce que ce n'est pas ──
-- Pas un système de supervision. Une fonction de lecture qui compte des anomalies et rend de quoi
-- les retrouver. Rien n'est corrigé automatiquement : une correction automatique sur des données
-- d'argent, décidée par une règle écrite un soir, fait plus de dégâts qu'un défaut visible.
--
-- ── Le principe des seuils ──
-- Chaque contrôle porte une gravité. « critique » signifie : un client a payé et n'a pas ce qu'il
-- a acheté. « attention » signifie : quelque chose mérite un regard. On ne mélange pas les deux,
-- sinon la liste devient un bruit qu'on cesse de lire.

begin;

create or replace function media_sante()
returns table (
  gravite text,
  domaine text,
  probleme text,
  nombre integer,
  detail jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not media_stats_access() then return; end if;

  -- ── Argent et livraison : un client a payé et n'a pas reçu ────────────────────────────────
  return query
  select 'critique', 'Livraison', 'Commande payée sans droit de téléchargement',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('commande', o.id, 'email', o.guest_email, 'paye_le', o.paid_at)), '[]'::jsonb)
  from media_orders o
  where o.status = 'paid'
    and not exists (select 1 from media_download_grants g where g.order_id = o.id)
  having count(*) > 0;

  return query
  select 'critique', 'Livraison', 'Commande payée sans aucune photo rattachée',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('commande', o.id, 'email', o.guest_email, 'montant', o.amount_cents)), '[]'::jsonb)
  from media_orders o
  where o.status = 'paid'
    -- Un pack dont la sélection n'est pas encore faite est normal : il attend le choix du client.
    and o.photos_allowance is null
    and not exists (select 1 from media_order_items i where i.order_id = o.id)
  having count(*) > 0;

  return query
  select 'critique', 'Livraison', 'Photo achetée dont le fichier original manque',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('photo', m.id, 'album', m.album_id)), '[]'::jsonb)
  from media_order_items i
  join media_orders o on o.id = i.order_id and o.status = 'paid'
  join media_assets m on m.id = i.asset_id
  where m.original_path is null
  having count(*) > 0;

  -- ── E-mails ───────────────────────────────────────────────────────────────────────────────
  return query
  select 'critique', 'E-mail', 'E-mail définitivement échoué',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('destinataire', n.recipient_email, 'gabarit', n.template_key,
                                               'erreur', left(coalesce(n.last_error,''), 120))), '[]'::jsonb)
  from notification_outbox n
  where n.status = 'FAILED'
  having count(*) > 0;

  return query
  select 'attention', 'E-mail', 'E-mail en attente depuis plus d''une heure',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('destinataire', n.recipient_email, 'depuis', n.created_at)), '[]'::jsonb)
  from notification_outbox n
  where n.status = 'PENDING' and n.created_at < now() - interval '1 hour'
  having count(*) > 0;

  -- ── Dépôts de photos ──────────────────────────────────────────────────────────────────────
  return query
  select 'attention', 'Médias', 'Dépôt de photo bloqué ou en échec',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('photo', m.id, 'album', m.album_id, 'etat', m.status,
                                               'erreur', left(coalesce(m.processing_error,''), 120))), '[]'::jsonb)
  from media_assets m
  where m.status in ('failed', 'processing')
    -- « processing » est normal pendant le dépôt : on n'alerte qu'au-delà d'une heure.
    and (m.status = 'failed' or m.updated_at < now() - interval '1 hour')
  having count(*) > 0;

  return query
  select 'attention', 'Médias', 'Photo publiable sans aperçu généré',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('photo', m.id, 'album', m.album_id)), '[]'::jsonb)
  from media_assets m
  where m.status = 'ready' and (m.thumb_path is null or m.preview_path is null)
  having count(*) > 0;

  -- ── Configuration commerciale ─────────────────────────────────────────────────────────────
  return query
  select 'attention', 'Galeries', 'Lien actif sur un album non publié',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('lien', l.slug, 'album', a.title)), '[]'::jsonb)
  from media_album_links l
  join media_albums a on a.id = l.album_id
  where l.is_enabled and a.status <> 'published'
  having count(*) > 0;

  return query
  select 'attention', 'Galeries', 'Album publié dont les aperçus ne sont pas filigranés',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('album', a.title)), '[]'::jsonb)
  from media_albums a
  where a.status = 'published' and not a.watermark_previews
    and exists (select 1 from media_album_link_offers o
                join media_album_links l on l.id = o.link_id
                where l.album_id = a.id and o.is_enabled and coalesce(o.price_override_cents, 1) > 0)
  having count(*) > 0;

  return query
  select 'attention', 'Galeries', 'Album sans pôle : invisible des responsables de pôle',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('album', a.title)), '[]'::jsonb)
  from media_albums a
  left join prestations pr on pr.id = a.mission_id
  where coalesce(a.pole_id, pr.pole_id) is null
  having count(*) > 0;

  -- ── Cohérence ─────────────────────────────────────────────────────────────────────────────
  return query
  select 'critique', 'Cohérence', 'Commande remboursée dont l''accès est encore ouvert',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('commande', o.id, 'expire_le', g.expires_at)), '[]'::jsonb)
  from media_orders o
  join media_download_grants g on g.order_id = o.id
  where o.status = 'refunded' and g.expires_at > now()
  having count(*) > 0;

  return query
  select 'attention', 'Cohérence', 'Paiement resté en attente depuis plus de 24 h',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('commande', o.id, 'email', o.guest_email, 'depuis', o.created_at)), '[]'::jsonb)
  from media_orders o
  where o.status = 'pending' and o.created_at < now() - interval '24 hours'
  having count(*) > 0;
end;
$$;

comment on function media_sante is
  'Anomalies à vérifier, lues en direct depuis les données réelles. Ne corrige RIEN : une correction automatique sur des données d''argent fait plus de dégâts qu''un défaut visible. « critique » = un client a payé et n''a pas ce qu''il a acheté.';

grant execute on function media_sante() to authenticated;

commit;
