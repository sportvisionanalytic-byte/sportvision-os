-- ============================================================================
-- migration-poles-v28-recrutement-pole-id.sql
-- recruitment_applications n'avait aucune notion de pôle (audit confirmé
-- deux fois cette nuit) — ajoute la colonne, nullable (candidatures
-- existantes non rétro-taguées, aucun moyen fiable de deviner). RLS déjà
-- ouverte (is_staff()) : le filtrage par pôle se fait côté requête front
-- (comme devis/factures), pas besoin de nouvelle policy.
-- ============================================================================

alter table public.recruitment_applications
  add column if not exists pole_id uuid references public.poles(id);

comment on column public.recruitment_applications.pole_id is 'Pôle sportif visé par la candidature -- posé par le formulaire public (submit-recruitment-application), nullable pour compat avec les candidatures antérieures à cette colonne. NULL = candidature non catégorisée par pôle, visible uniquement en Recrutement admin, pas dans "Mon pôle > Recrutement" d''un Responsable.';

-- ROLLBACK : alter table public.recruitment_applications drop column pole_id;
