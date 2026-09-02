-- migration-media-v3-preserve-history-on-club-delete.sql (02/09/2026)
--
-- Trou CRITIQUE trouvé lors de l'audit backend du moteur média (02/09) : media_orders.club_id et
-- media_entitlements.club_id étaient en ON DELETE CASCADE depuis clubs — une suppression de club
-- effaçait silencieusement les commandes payées et les droits d'accès déjà vendus, contraire au
-- master prompt Fouka §34 ("Si un club quitte SportVision : ne pas supprimer commandes, factures,
-- albums, historique, anciens entitlements — désactiver les nouvelles ventes"). Reproduit en réel
-- lors de l'audit : delete from clubs a bien fait disparaître media_orders/media_entitlements liés.
--
-- media_albums.club_id (ex-photo_albums, hérité de la migration d'origine) avait la même faille —
-- "albums" est explicitement cité dans la liste à préserver du master prompt.
--
-- Correctif : ON DELETE RESTRICT sur ces 3 FK. Une suppression de club avec un historique de vente
-- échoue désormais explicitement plutôt que d'effacer silencieusement des preuves de paiement —
-- oblige à une décision consciente (archiver, réassigner...) plutôt qu'une perte de données. Les
-- tables de configuration pure (media_products/media_club_policy/media_sales_operations) restent
-- en cascade, volontairement : ce ne sont pas des preuves d'achat, rien dans le master prompt
-- n'exige de les conserver après le départ d'un club.

alter table public.media_orders drop constraint media_orders_club_id_fkey;
alter table public.media_orders add constraint media_orders_club_id_fkey
  foreign key (club_id) references public.clubs(id) on delete restrict;

alter table public.media_entitlements drop constraint media_entitlements_club_id_fkey;
alter table public.media_entitlements add constraint media_entitlements_club_id_fkey
  foreign key (club_id) references public.clubs(id) on delete restrict;

alter table public.media_albums drop constraint photo_albums_club_id_fkey;
alter table public.media_albums add constraint media_albums_club_id_fkey
  foreign key (club_id) references public.clubs(id) on delete restrict;
