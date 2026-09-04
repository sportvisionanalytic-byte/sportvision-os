-- Checkout invité pour le moteur média (04/09/2026, prompt #8 backlog Club+ V2) — décision Fouka :
-- construire le parcours invité plutôt que de le laisser hors V1. Contrairement à une cotisation
-- (/cotisation/[token], paiement ponctuel qui n'a besoin d'aucun compte après coup),
-- media_entitlements est un DROIT D'ACCÈS DURABLE : sans un compte (celui du bénéficiaire ou de
-- l'acheteur) pour le vérifier plus tard, l'invité n'aurait aucun moyen de revoir ce qu'il a
-- acheté. Le parcours invité crée donc (ou réutilise, jamais deviné) un compte auth.users en
-- coulisses, exactement comme clubplus-family-invite (edge function) le fait déjà pour les
-- invitations joueur/parent — pas de nouveau mécanisme d'identité inventé ici.
--
-- Sécurité (le vrai sujet) : un joueur mineur n'a pas d'e-mail public consultable, et
-- beneficiary_person_id ne doit JAMAIS être fourni tel quel par un client anonyme (aucune
-- vérification "parent confirmé" possible pour quelqu'un qui n'a pas encore de compte — c'est
-- justement le problème que ce token résout). Le token est donc généré côté staff (media_
-- staff_write(), même garde que media_products/media_club_policy) pour UN produit et UN
-- bénéficiaire précis, envoyé par le club/CM à la bonne famille — jamais une recherche publique
-- de joueur. Aucune policy SELECT publique sur la table : la validation se fait exclusivement via
-- l'edge function create-guest-media-checkout (service_role) ou la RPC de preview ci-dessous, qui
-- ne révèle jamais que le prénom du bénéficiaire (même niveau de divulgation que preview_invite_
-- code : club/équipe visibles, jamais de donnée personnelle complète).

create table if not exists media_guest_checkout_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  club_id uuid not null references clubs(id) on delete cascade,
  product_id uuid not null references media_products(id) on delete cascade,
  beneficiary_person_id uuid not null references player_profiles(id) on delete cascade,
  created_by uuid references auth.users on delete set null,
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

comment on table media_guest_checkout_tokens is 'Lien d''achat média envoyé à une famille sans compte Connect — scope UN produit + UN bénéficiaire précis, jamais une recherche de joueur ouverte. Consommé exclusivement par create-guest-media-checkout (edge function, service_role).';

create index idx_mgct_token on media_guest_checkout_tokens(token);

alter table media_guest_checkout_tokens enable row level security;
create policy "mgct_staff_all" on media_guest_checkout_tokens for all using (media_staff_write()) with check (media_staff_write());
-- Volontairement aucune policy SELECT anon/authenticated : la lecture publique passe uniquement
-- par preview_media_checkout_token() ci-dessous (SECURITY DEFINER, divulgation minimale), jamais
-- par une lecture directe de la table.

create or replace function public.preview_media_checkout_token(p_token text)
returns table(
  valide boolean,
  raison text,
  club_nom text,
  produit_nom text,
  prix_cents integer,
  devise text,
  beneficiaire_prenom text
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
begin
  select * into v_token_row from media_guest_checkout_tokens where token = p_token;
  if v_token_row.id is null then
    return query select false, 'introuvable'::text, null::text, null::text, null::integer, null::text, null::text;
    return;
  end if;

  select c.nom, p.name, p.price_cents, p.currency, p.status, pl.prenom
  into v_club_nom, v_produit_nom, v_prix_cents, v_devise, v_produit_statut, v_beneficiaire_prenom
  from clubs c, media_products p, player_profiles pl
  where c.id = v_token_row.club_id and p.id = v_token_row.product_id and pl.id = v_token_row.beneficiary_person_id;

  if v_token_row.expires_at < now() then
    return query select false, 'expire'::text, v_club_nom, v_produit_nom, null::integer, null::text, null::text;
    return;
  end if;
  if v_token_row.used_count >= v_token_row.max_uses then
    return query select false, 'epuise'::text, v_club_nom, v_produit_nom, null::integer, null::text, null::text;
    return;
  end if;
  if v_produit_statut is distinct from 'active' then
    return query select false, 'produit_indisponible'::text, v_club_nom, v_produit_nom, null::integer, null::text, null::text;
    return;
  end if;

  return query select true, null::text, v_club_nom, v_produit_nom, v_prix_cents, v_devise, v_beneficiaire_prenom;
end;
$$;
comment on function public.preview_media_checkout_token(text) is 'Aperçu public d''un lien d''achat média (page /media-checkout/[token], app-connect) — même niveau de divulgation que preview_invite_code : jamais de nom complet, jamais d''email, jamais l''id du bénéficiaire.';

grant execute on function public.preview_media_checkout_token(text) to anon, authenticated;
