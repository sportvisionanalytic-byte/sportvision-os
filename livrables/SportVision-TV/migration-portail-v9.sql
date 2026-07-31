-- ============================================================
-- SPORTVISION PORTAIL — Migration v9
-- La nouvelle interface staff "Catalogue public" ajoutée dans l'OS est
-- accessible aux rôles admin et sec (cohérent avec le fait que sec gère déjà
-- devis/contrats/abonnements), mais la policy d'écriture de catalogue_offres
-- ne couvrait que ('admin','com'). Sans ce correctif, un compte 'sec' voit
-- le nouvel écran mais toute sauvegarde échoue silencieusement (RLS).
-- Idempotente. À exécuter après migration-portail-v8.sql.
-- ============================================================

drop policy if exists "catalogue_staff_write" on catalogue_offres;
create policy "catalogue_staff_write" on catalogue_offres for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
);
