-- ============================================================================
-- migration-contenus-prestation-link.sql
-- ============================================================================
-- Relie `contenus` (calendrier éditorial CM) à `prestations` (déroulé
-- shooting) — les deux étaient deux pistes totalement séparées en base,
-- confirmé par exploration complète du code le 28/08/2026 (aucune
-- migration n'ajoutait ce lien, aucun code ne le lisait). Sert à préparer
-- automatiquement un brouillon de contenu pour le CM affecté quand une
-- prestation Full Communication est livrée, plutôt qu'une simple
-- notification sans rien de concret à ouvrir.
-- ============================================================================

alter table contenus add column if not exists prestation_id uuid references prestations(id) on delete set null;

create index if not exists idx_contenus_prestation_id on contenus(prestation_id) where prestation_id is not null;

-- contenus_insert (migration-contenus.sql) exige cm_id = auth.uid() — un CM
-- ne peut créer que ses propres brouillons. contenus_admin_all couvre déjà
-- l'admin pour tout. Le flux de livraison (confirmerLivraison,
-- SportVision-OS-Full.html) est aussi déclenché par sec/prod (canDeliver),
-- qui doivent pouvoir préparer un brouillon POUR le CM affecté sans être
-- eux-mêmes ce CM — sans cette policy, l'insertion échouerait en silence
-- pour ces deux rôles.
drop policy if exists "contenus_staff_insert_livraison" on contenus;
create policy "contenus_staff_insert_livraison" on contenus for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod'))
);

-- Nécessaire en plus de la policy d'insertion ci-dessus : sbFetch() (client
-- OS) envoie systématiquement Prefer: return=representation sur un POST —
-- Postgres applique alors AUSSI la policy SELECT à la ligne renvoyée par
-- RETURNING, et lève "new row violates row-level security policy" (même
-- message que pour un insert refusé) si le SELECT échoue, même quand
-- l'INSERT lui-même a réussi. contenus_select ne couvre pas sec/prod
-- (logique CM uniquement) — confirmé en conditions réelles le 28/08/2026
-- avec un compte de test jetable role=prod : l'insert marchait sans
-- Prefer:return=representation, échouait avec, jusqu'à l'ajout de cette
-- policy SELECT miroir.
drop policy if exists "contenus_staff_select_livraison" on contenus;
create policy "contenus_staff_select_livraison" on contenus for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod'))
);
