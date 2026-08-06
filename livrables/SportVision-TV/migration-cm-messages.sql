-- Migration : accès CM à la messagerie client (messages_client).
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- messages_client (migration-portail-v1.sql) relie club et équipe interne
-- (distinct de `messages`, réservée au staff↔staff). Sa policy "mc_staff_all"
-- couvre admin/sec/com/prod mais jamais 'cm' — un CM ne pouvait donc ni lire
-- ni envoyer de message client depuis l'OS, alors qu'il gère la relation
-- éditoriale avec ses clients (portefeuille posé par migration-cm-tiers.sql).
--
-- Réutilise telle quelle contenus_visible_par_cm() (migration-contenus.sql) :
-- cette fonction n'a rien de spécifique à la table contenus, elle répond
-- simplement "ce CM peut-il voir ce client_id", donc directement applicable
-- ici sans dupliquer la logique par palier une troisième fois.
--
-- Contrairement à contenus_update, pas de risque de réattribution de
-- client_id : messages_client n'a pas de colonne d'appartenance (cm_id) qui
-- pourrait servir de bypass — la seule condition possible est la visibilité
-- du client, revalidée aussi bien sur l'ancienne que la nouvelle ligne par le
-- using réutilisé comme with check implicite. Aucun with check séparé requis.
--
-- Idempotente : DROP ... IF EXISTS avant CREATE. À exécuter après
-- migration-cm-tiers.sql ET migration-contenus.sql (dépend de
-- contenus_visible_par_cm()).

drop policy if exists "mc_cm_acces" on messages_client;
create policy "mc_cm_acces" on messages_client for all using (
  contenus_visible_par_cm(client_id, auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
);
