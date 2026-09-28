-- v318 — 28/09/2026 : le tarif d'une galerie se changeait depuis n'importe quel pôle
--
-- DEUX RÈGLES, UN NOM À UNE LETTRE PRÈS, ET LE MAUVAIS CÔTÉ BRANCHÉ.
--
--   media_pricing_staff()             admin / production / secrétariat, OU responsable de
--                                     N'IMPORTE QUEL pôle actif
--   media_pricing_staff_album(album)  les mêmes rôles, mais le responsable de pôle UNIQUEMENT sur
--                                     le pôle de cette galerie
--
-- La seconde existe depuis le 07/09 (galeries-v17 puis v18), et son commentaire dit exactement
-- pourquoi : « un album explicitement rattaché à Basket ne doit pas rester accessible au
-- responsable Football parce que sa mission était encore rangée là ».
--
-- Les RPC l'appellent. Les NEUF policies RLS de `media_album_links` et `media_album_link_offers`
-- appelaient l'autre. Le chemin par la table, celui que PostgREST expose à tout compte connecté,
-- n'était donc borné par aucun pôle. Ce n'est pas une divergence qui s'est installée avec le temps :
-- la bonne règle existait, et les policies ne l'ont jamais appelée.
--
-- MESURÉ AVANT CORRECTION, avec un compte `role='cm'` (aucun droit tarifaire) responsable du seul
-- pôle Basket, sur une galerie du pôle Football :
--   media_pricing_staff_album(galerie)         false    la fonction refuse
--   update media_album_links       → 1 ligne            10,00 € devient 99,99 €
--   update media_album_link_offers → 1 ligne            une offre passe à 0,01 €
--   delete media_album_link_offers → 1 ligne            une offre disparaît
--   insert media_album_link_offers → accepté            une offre pirate apparaît sur le lien
--
-- Ce que ça veut dire en clair : un opérateur pouvait changer ce que les familles d'un autre pôle
-- paient, ou ce qu'elles reçoivent pour leur argent, sans jamais passer par un écran qui l'y
-- autorise.
--
-- PORTÉE DU RESSERREMENT, mesurée avant d'écrire : 45 des 49 galeries portent un pôle, il existe UN
-- SEUL responsable de pôle actif, et son `profiles.role` est `admin` — il garde donc tout par son
-- rôle. Les 4 galeries sans pôle restent tarifables par admin / production / secrétariat, c'est-à-
-- dire par tout le monde qui a ce droit. Aucun travail légitime en cours n'est touché.
--
-- LE BARÈME RESTE GLOBAL. `media_bareme_galerie` garde `media_pricing_staff()`, et c'est voulu :
-- c'est un barème maison qui s'applique à toutes les galeries, il n'appartient à aucun pôle.
--
-- Idempotent.

-- Les offres pendent d'un lien, pas d'un album : une seule écriture de plus, pour que la règle du
-- pôle n'ait pas à être réécrite dans chaque policy.
create or replace function public.media_pricing_staff_lien(p_link_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select exists (
    select 1 from media_album_links l
     where l.id = p_link_id
       and public.media_pricing_staff_album(l.album_id)
  );
$f$;

comment on function public.media_pricing_staff_lien(uuid) is
  'Peut fixer les tarifs de CE lien : la regle de media_pricing_staff_album, remontee au lien. '
  'Utilisee par les policies de media_album_link_offers. Ne pas recopier la regle du pole ailleurs.';

grant execute on function public.media_pricing_staff_lien(uuid) to authenticated;

-- ── media_album_links ───────────────────────────────────────────────────────────────────────────
drop policy if exists malinks_team_select on public.media_album_links;
create policy malinks_team_select on public.media_album_links
  for select using (public.media_pricing_staff_album(album_id));

drop policy if exists malinks_pricing_insert on public.media_album_links;
create policy malinks_pricing_insert on public.media_album_links
  for insert with check (public.media_pricing_staff_album(album_id));

drop policy if exists malinks_pricing_update on public.media_album_links;
create policy malinks_pricing_update on public.media_album_links
  for update using (public.media_pricing_staff_album(album_id))
              with check (public.media_pricing_staff_album(album_id));

drop policy if exists malinks_pricing_delete on public.media_album_links;
create policy malinks_pricing_delete on public.media_album_links
  for delete using (public.media_pricing_staff_album(album_id));

-- ── media_album_link_offers ─────────────────────────────────────────────────────────────────────
drop policy if exists malo_team_select on public.media_album_link_offers;
create policy malo_team_select on public.media_album_link_offers
  for select using (public.media_pricing_staff_lien(link_id));

drop policy if exists malo_pricing_insert on public.media_album_link_offers;
create policy malo_pricing_insert on public.media_album_link_offers
  for insert with check (public.media_pricing_staff_lien(link_id));

drop policy if exists malo_pricing_update on public.media_album_link_offers;
create policy malo_pricing_update on public.media_album_link_offers
  for update using (public.media_pricing_staff_lien(link_id))
              with check (public.media_pricing_staff_lien(link_id));

drop policy if exists malo_pricing_delete on public.media_album_link_offers;
create policy malo_pricing_delete on public.media_album_link_offers
  for delete using (public.media_pricing_staff_lien(link_id));
