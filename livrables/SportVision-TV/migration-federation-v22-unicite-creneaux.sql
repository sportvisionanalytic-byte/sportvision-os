-- Empecher un VRAI doublon de creneau, sans interdire deux seances legitimes.
--
-- ── Ce que l'audit a trouve, et ce qu'il n'a pas trouve ──
-- Fouka signale des entrainements « deux fois le meme » sur le calendrier de Villemomble. Verifie
-- a la source, ligne par ligne :
--
--   * AUCUN doublon dans club_team_training_slots : chaque ligne est unique par
--     (equipe, jour, heure, TERRAIN). Le premier comptage sans le terrain en montrait trois, il
--     etait faux.
--   * AUCUN entrainement materialise dans club_calendar_events : la table est vide pour ce club.
--     Les entrainements ne viennent que des creneaux recurrents, il n'y a pas deux autorites.
--   * AUCUNE exception en double sur (slot_id, date_seance), qui aurait multiplie les lignes par
--     la jointure de club_calendrier.
--
-- Ce que voit Fouka, ce sont CINQ equipes ayant deux seances le meme jour sur deux terrains
-- differents. Ce ne sont pas des doublons de donnees : ce sont des lignes distinctes que
-- l'interface ne permettait pas de distinguer, faute d'afficher le lieu.
--
-- ── La contrainte posee ──
-- Le terrain fait partie de l'identite d'un creneau : le planning municipal reserve deux terrains
-- a une meme categorie, et rabattre les deux sur une seule ligne perdrait une reservation.
--
-- La periode aussi : un creneau de septembre a decembre et le meme creneau de janvier a juin sont
-- deux lignes legitimes. Un UNIQUE naif sur (equipe, jour, heure) casserait l'historique.
--
-- D'ou l'index sur (team_id, jour, heure_debut, venue_id, active_from, active_to), en
-- NULLS NOT DISTINCT : sans cette clause, deux lignes ou venue_id vaut NULL seraient considerees
-- differentes par PostgreSQL, et l'index n'empecherait justement rien dans le cas le plus courant.
--
-- Verifie avant creation : aucune ligne existante ne viole cette contrainte.

begin;

create unique index if not exists club_team_training_slots_uniq
  on public.club_team_training_slots (team_id, jour, heure_debut, venue_id, active_from, active_to)
  nulls not distinct;

comment on index public.club_team_training_slots_uniq is
  'Un créneau est identifié par son équipe, son jour, son heure, SON TERRAIN et sa période de validité. Le terrain en fait partie : le planning municipal réserve parfois deux terrains à la même catégorie au même moment. La période aussi : le même créneau sur deux demi-saisons est deux lignes légitimes.';

commit;
