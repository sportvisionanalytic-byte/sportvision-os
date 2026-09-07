-- Migration : corriger la matrice d'accès des galeries
-- À exécuter APRÈS migration-galeries-v27-surcharge-perimetre.sql.
--
-- ── Le défaut, trouvé en interrogeant la base et non l'interface ──
-- `media_albums` n'était lisible que par admin et prod. Or l'écran Galeries de l'OS lit cette
-- table directement. Conséquences concrètes :
--
--   * le PHOTOGRAPHE ne voyait aucun album — donc il ne pouvait pas ouvrir une galerie pour y
--     déposer ses photos. Sa mission principale était impossible depuis cet écran, alors qu'il a
--     bien le droit d'écrire dans media_assets ;
--   * le SECRÉTARIAT, à qui la préparation des offres a été confiée le 07/09, ne pouvait pas
--     ouvrir la galerie pour les configurer.
--
-- Deux rôles portaient une responsabilité qu'ils ne pouvaient pas exercer. Un bouton caché n'est
-- pas une sécurité, mais une table fermée n'est pas une permission non plus.
--
-- ── Ce que cette migration change, et rien d'autre ──
--   1. LECTURE de media_albums ouverte à media_upload_staff() (admin, production, secrétariat,
--      photographe). Écriture inchangée : admin et production seulement.
--   2. Le photographe perd la lecture des offres et des tarifs.
--   3. La production gagne une lecture OPÉRATIONNELLE des commandes et droits de galerie.
--
-- ── P2 assumé : le photographe voit tous les albums ──
-- L'idéal serait qu'il ne voie que les albums sur lesquels il est affecté. Le chemin existe déjà
-- (media_albums.mission_id → prestations → prestations_equipe.collaborateur_id), MAIS aucun album
-- n'a de mission rattachée aujourd'hui : filtrer dessus lui montrerait zéro album, c'est-à-dire
-- pire que le défaut qu'on corrige.
--
-- On ouvre donc à media_upload_staff() maintenant, et le resserrement par affectation est classé
-- P2, à faire avant la montée en volume — c'est-à-dire avant d'avoir plusieurs photographes et
-- plusieurs clubs. Le jour venu, il n'y a qu'une policy à modifier, ici.

begin;

-- ── 1. Les albums ──────────────────────────────────────────────────────────────────────────
drop policy if exists photo_albums_staff_all on media_albums;

drop policy if exists malbums_staff_select on media_albums;
create policy malbums_staff_select on media_albums
  for select using (media_upload_staff());

-- Créer, modifier ou supprimer un album reste réservé : le photographe ne doit pas pouvoir
-- changer le club, le pôle ou le statut de publication de ce qu'il alimente.
drop policy if exists malbums_prod_insert on media_albums;
create policy malbums_prod_insert on media_albums
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','prod'))
  );

drop policy if exists malbums_prod_update on media_albums;
create policy malbums_prod_update on media_albums
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','prod'))
  ) with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','prod'))
  );

drop policy if exists malbums_prod_delete on media_albums;
create policy malbums_prod_delete on media_albums
  for delete using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','prod'))
  );

-- ── 2. Le photographe ne voit plus les tarifs ──────────────────────────────────────────────
-- Il dépose des photos ; il n'a aucune raison de lire les packs à 10, 20 ou 50 €, ni de savoir
-- que le club partenaire paie moins cher que l'équipe adverse. `media_pricing_staff()` couvre
-- déjà admin, production, secrétariat et responsables de pôle : c'est exactement le périmètre qui
-- a besoin de ces lignes.
--
-- Correction côté SERVEUR et pas seulement dans l'interface : la table était réellement lisible.
drop policy if exists malinks_team_select on media_album_links;
create policy malinks_team_select on media_album_links
  for select using (media_pricing_staff());

drop policy if exists malo_team_select on media_album_link_offers;
create policy malo_team_select on media_album_link_offers
  for select using (media_pricing_staff());

-- ── 3. La production peut diagnostiquer une commande ───────────────────────────────────────
-- Sans ça, « le parent dit qu'il a payé mais ne peut pas télécharger » est indiagnosticable par
-- celui-là même qui gère la galerie : il ne voit ni le statut, ni la formule, ni le droit.
--
-- LECTURE SEULE, et uniquement sur les commandes de galerie. Rembourser, écrire en comptabilité
-- ou toucher aux données Stripe restent hors de son périmètre : media_commerce_staff() garde
-- l'écriture, cette policy n'ajoute qu'un droit de regard.
drop policy if exists mord_prod_select on media_orders;
create policy mord_prod_select on media_orders
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'prod')
    and album_id is not null
  );

drop policy if exists moitems_prod_select on media_order_items;
create policy moitems_prod_select on media_order_items
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'prod')
  );

-- Le droit lui-même : savoir s'il existe, s'il est actif et jusqu'à quand. Le JETON reste
-- lisible, c'est une contrainte de la table ; c'est acceptable pour un rôle interne qui peut de
-- toute façon voir les photos, et ça lui permet de vérifier qu'un lien fonctionne.
drop policy if exists mdgrants_prod_select on media_download_grants;
create policy mdgrants_prod_select on media_download_grants
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'prod')
  );

commit;
