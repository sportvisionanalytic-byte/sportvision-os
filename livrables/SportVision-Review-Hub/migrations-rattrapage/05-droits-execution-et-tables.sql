-- RATTRAPAGE REVIEW — droits (GRANT/REVOKE) restes differents de la production
-- Projet Review ffjktzmsezfrwmrtlhzo uniquement, le 12/09/2026.
--
-- Un schema identique ne suffit pas : le droit d'EXECUTE decide de ce qu'une session reelle peut
-- appeler. Quatre fonctions et deux tables differaient encore apres le rejeu complet.
-- Rappel utile ici : PostgreSQL accorde EXECUTE a PUBLIC par defaut, donc « revoke from anon,
-- authenticated » ne suffit pas — il faut revoquer depuis PUBLIC.
--
-- Trois de ces ecarts rendaient Review PLUS ouverte que la production : un audit externe y aurait
-- vu une surface qui n'existe pas en vrai.

begin;

-- ── Plus ouvert en Review qu'en production : on referme ─────────────────────────────────────
-- Compteur de limitation de debit : reserve au serveur en production.
revoke execute on function public.check_and_record_rate_limit(text, integer, integer)
  from public, anon, authenticated;

-- Lecture « ce club a-t-il un president connu » : pas exposee a l'API en production.
revoke execute on function public.club_president_connu(uuid) from public, anon, authenticated;

-- Creation d'une saison : en production, PUBLIC et anon ne l'ont pas.
revoke execute on function public.get_or_create_saison(text) from public, anon;

-- ── Plus ferme en Review qu'en production : on ouvre a l'identique ──────────────────────────
grant execute on function public.fin_generer_depenses_recurrentes() to authenticated;

-- ── Tables : les deux journaux d'audit ──────────────────────────────────────────────────────
-- En production, anon et authenticated ont l'ensemble des droits sur ces deux tables (la RLS,
-- elle, reste le vrai verrou). Review n'avait que la lecture : un test d'ecriture d'audit aurait
-- echoue pour la mauvaise raison, sans rien prouver de la RLS.
grant insert, update, delete, truncate, references, trigger on public.audit_logs to anon, authenticated;
grant insert, update, delete, truncate, references, trigger on public.communication_audit_logs to anon, authenticated;

commit;
