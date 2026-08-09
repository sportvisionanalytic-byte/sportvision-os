-- Migration : colonnes complémentaires pour club_matches (feuille de
-- match complète, SportVision Connect — Match Center).
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- club_matches (migration-clubplus-v3.sql) n'a que id, club_id, team,
-- opponent, match_date, lieu, status, score, scorers, man_of_match, contents,
-- created_by, created_at, updated_at. Le formulaire "Saisir un résultat"
-- (SportVision-Connect/app-next, src/components/matchcenter/
-- MatchResultModal.tsx) proposait avant correction 14 champs, dont 7 sans
-- colonne réelle : compétition, domicile/extérieur, affluence, passeurs
-- décisifs, cartons, commentaire — et une 8ᵉ (lieu) qui existe en base mais
-- n'était pas écrite par saveClubMatchResult (src/lib/data/club/
-- matches.ts). Le correctif appliqué au frontend (lot audit du 09/08) a
-- retiré ces champs du formulaire plutôt que de continuer à les collecter
-- pour rien — voir le rapport de ce lot pour le détail.
--
-- Cette migration documente le chemin pour les réintroduire plus tard, si
-- Fouka le souhaite. Elle n'est PAS exécutée par l'agent qui l'a écrite et
-- le formulaire n'est PAS re-branché dessus dans ce lot : uniquement le
-- schéma, prêt si besoin. Idempotente (add column if not exists).
--
-- À exécuter après migration-clubplus-v3.sql.

alter table club_matches add column if not exists competition text;
alter table club_matches add column if not exists is_home boolean default true;
alter table club_matches add column if not exists attendance integer;
alter table club_matches add column if not exists assists text;
alter table club_matches add column if not exists cards text;
alter table club_matches add column if not exists comment text;

-- Note : `lieu` existe déjà (migration-clubplus-v3.sql) et se lit déjà
-- correctement (fetchClubMatches) — seule saveClubMatchResult ne l'écrit
-- pas. Si ces colonnes sont un jour exploitées, il faudra aussi étendre
-- saveClubMatchResult (src/lib/data/club/matches.ts) pour les écrire
-- (aujourd'hui limité à status/score/scorers/man_of_match), remettre les
-- champs correspondants dans MatchResultModal.tsx, et réintégrer `lieu`
-- dans le patch écrit (actuellement lu mais jamais mis à jour par ce
-- formulaire). Aucune policy RLS supplémentaire n'est nécessaire : les
-- policies existantes de club_matches (is_club_member(club_id)) couvrent
-- déjà l'update de ces nouvelles colonnes.
