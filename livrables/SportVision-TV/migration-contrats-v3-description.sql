-- Migration : contrats v3 — colonne « description » (périmètre / prestations incluses)
-- À exécuter dans Supabase → SQL Editor.
-- PRÉPARÉE MAIS NON EXÉCUTÉE — additive uniquement, aucune perte de données.
--
-- Contexte (audit Contrats/Signature, 2026-08) :
--   genererContratPDF() dans SportVision-OS-Full.html affiche déjà, depuis sa création,
--   un bloc « Périmètre / prestations incluses » conditionné à `c.description` (ligne
--   ~9539 : `${c.description?...}`). Mais la colonne `description` n'a jamais existé sur
--   la table `contrats` (absente de migration-contrats.sql et de toutes les migrations
--   ultérieures) : ce bloc ne s'est donc JAMAIS affiché, dans aucun contrat, depuis
--   l'origine. Le champ « NOTES » du formulaire (modalNouveauContrat / modalEditerContrat)
--   sauvegarde bien du texte, mais dans la colonne `notes` — un champ distinct que
--   genererContratPDF() n'imprime nulle part. Résultat pour le staff : tout ce qui est
--   tapé dans « NOTES » à la création/modification d'un contrat est enregistré, mais
--   n'apparaît JAMAIS ni dans l'aperçu, ni dans le PDF envoyé au client pour signature.
--
--   Cette migration ajoute la colonne manquante. Le câblage de sa saisie (UI) et de son
--   impression est fait séparément dans SportVision-OS-Full.html et dans l'edge function
--   send-signature-request (déjà prêts à consommer `contrats.description` dès que cette
--   migration est exécutée — ils la lisent en toute sécurité si elle est absente : le
--   bloc « Périmètre / prestations incluses » ne s'affiche simplement pas tant que la
--   colonne n'existe pas).
--
-- Propriété : idempotente (ré-exécutable sans erreur), n'écrit sur aucune ligne existante
-- (pas d'UPDATE — les contrats déjà émis restent inchangés, seul le comportement futur
-- est concerné par le câblage applicatif qui accompagne cette migration).

alter table contrats
  add column if not exists description text;

comment on column contrats.description is
$$Périmètre / prestations incluses, saisi par le staff à la création ou modification du contrat. Imprimé tel quel (échappé HTML) dans genererContratPDF() (SportVision-OS-Full.html) et dans le PDF envoyé en signature via l'edge function send-signature-request. Distinct de `notes`, qui reste un champ interne non imprimé.$$;
