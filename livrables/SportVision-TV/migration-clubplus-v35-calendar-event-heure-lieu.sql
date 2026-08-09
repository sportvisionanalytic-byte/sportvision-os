-- Migration : heure et lieu pour club_calendar_events (calendrier central,
-- SportVision Connect).
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- club_calendar_events (migration-clubplus-v4.sql) n'a que event_date (type
-- `date`, sans heure) — aucune colonne lieu. La modale "Ajouter un
-- événement" (SportVision-Connect/app-next, src/components/calendar/
-- AddEventModal.tsx) proposait avant correction des champs Heure et Lieu :
-- l'heure n'était jamais envoyée à createClubCalendarEvent (src/lib/data/
-- club/calendar.ts, silencieusement ignorée) et le lieu était réinjecté
-- dans l'objet retourné localement (affiché un instant côté client) sans
-- jamais être écrit en base — disparaissait au rechargement. Le correctif
-- appliqué au frontend (lot audit du 09/08) a retiré ces deux champs du
-- formulaire plutôt que de continuer à mentir sur ce qui est sauvegardé —
-- voir le rapport de ce lot pour le détail.
--
-- Cette migration documente le chemin pour les réintroduire plus tard, si
-- Fouka le souhaite. Elle n'est PAS exécutée par l'agent qui l'a écrite et
-- le formulaire n'est PAS re-branché dessus dans ce lot : uniquement le
-- schéma, prêt si besoin. Idempotente (add column if not exists).
--
-- À exécuter après migration-clubplus-v4.sql.

alter table club_calendar_events add column if not exists event_time time;
alter table club_calendar_events add column if not exists location text;

-- Note : si ces colonnes sont un jour exploitées, il faudra remettre les
-- champs Heure/Lieu dans AddEventModal.tsx, étendre l'input de
-- createClubCalendarEvent (src/lib/data/club/calendar.ts) pour les écrire
-- réellement (insert + select), et les lire dans fetchClubCalendarEvents
-- pour peupler CalendarEvent.location (déjà utilisé côté affichage,
-- EventDetailPanel.tsx). Aucune policy RLS supplémentaire n'est nécessaire :
-- les policies existantes de club_calendar_events (is_club_member(club_id))
-- couvrent déjà l'update de ces nouvelles colonnes.
