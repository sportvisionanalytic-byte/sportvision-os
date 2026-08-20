-- ============================================================
-- Migration additive : ajoute prestations.source (P0 "inbox unique",
-- audit externe du 20/08/2026 §13 — "Je ne veux pas cinq systèmes séparés").
--
-- Jusqu'ici, l'origine d'une prestation (Vitrine / Connect / interne) n'était
-- lisible qu'en texte libre dans description_besoin (ex. "Prestation
-- demandée (Connect — Espace joueur)") — pas de colonne dédiée, donc pas de
-- filtre fiable possible côté OS.
--
-- 2 lignes réelles en production au moment de cette migration :
--   SV-2026-0059 : description_besoin mentionne explicitement "Connect —
--                  Espace joueur" → backfillée à 'connect'.
--   SV-2026-0060 : aucun marqueur d'origine identifiable avec certitude →
--                  laissée à la valeur par défaut ('interne'), pas de
--                  supposition.
--
-- Les créateurs connus (connect-player-prestations, create-guest-request)
-- sont mis à jour séparément pour renseigner explicitement cette colonne à
-- partir de maintenant. Idempotente.
-- ============================================================

alter table prestations add column if not exists source text not null default 'interne'
  check (source in ('vitrine','connect','clubplus','interne'));

comment on column prestations.source is 'Origine de la demande (vitrine/connect/clubplus/interne) — P0 inbox unique, migration-prestations-v89.';

update prestations set source = 'connect'
  where reference = 'SV-2026-0059' and source = 'interne';
