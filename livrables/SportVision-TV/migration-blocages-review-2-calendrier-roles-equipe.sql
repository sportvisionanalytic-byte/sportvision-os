-- ============================================================================================
-- migration-blocages-review-2-calendrier-roles-equipe.sql
-- Blocage n°1 de l'audit Review du 11/09/2026 : la RPC club_calendrier rendait TOUT le calendrier
-- du club à un coach (794 événements au lieu de ceux de son équipe, mesuré sur Review ; 226 au lieu
-- de 104 sur Villeneuve 340 SC en production, mesuré le 11/09/2026 avec un vrai jeton de coach).
-- ============================================================================================
--
-- DÉCISION DE FOUKA (11/09/2026, tranchée) : même règle que club_dashboard_upcoming_events (v124,
-- en production depuis le 11/09) :
--   - rôles administratifs du club : tout le calendrier. Liste de la v124, reprise telle quelle :
--     admin (Owner Club+), president, secretaire, tresorier, membre_bureau, administratif, comm,
--     cm_externe, lecture_seule ;
--   - rôles d'équipe (coach, resp_equipe, directeur_sportif) : les événements de LEURS équipes
--     (is_team_educateur, inchangée) + les événements du club rattachés à aucune équipe ;
--   - responsable sponsors (sponsor_mgr), seul rôle de club hors des deux listes : comme dans la
--     v124, les seuls événements du club sans équipe (is_team_educateur ne lui rend aucune équipe).
--
-- QUI GARDE LE CALENDRIER COMPLET SANS ÊTRE UN RÔLE ADMINISTRATIF DE CLUB_MEMBERS.
--   - Qui opère le club (peut_operer_club : Owner Club+, Président, CM SportVision affecté,
--     délégation d'agence, CM responsable, staff de l'OS non cloisonné). Testé AVANT le rôle de
--     club_members : un CM SportVision qui aurait aussi une ligne « coach » dans le club garde sa
--     vue d'opérateur — la RLS de club_calendar_events lui donne déjà tout (ccal_operateur_manage).
--   - Qui n'a AUCUNE ligne active dans club_members et lit le calendrier par un autre chemin de
--     peut_lire_calendrier_club (staff de l'OS non cloisonné, délégation d'agence, joueur du club,
--     parent confirmé d'un joueur) : inchangé depuis la v120. La décision ne porte que sur les rôles
--     d'équipe ; le cas joueur/parent est signalé dans le rapport, pas tranché ici.
--   - Un coach qui est AUSSI joueur ou parent confirmé d'un joueur du club garde ce que la v120 lui
--     donnait à ce titre (tout le calendrier) : on ne lui retire pas en tant que coach un droit
--     qu'il tient en tant que parent.
--
-- APPELANTS INVENTORIÉS LE 11/09/2026 (tous restent corrects) :
--   - Club+ : page Calendrier (fetchClubCalendrier) et fiche d'un contenu du planning éditorial
--     (FicheContenu). Un coach n'y voit plus que ses équipes et le club ; les autres, inchangé.
--   - base : equipe_apercu (prochain événement et prochain entraînement d'UNE équipe : elle ne
--     s'ouvre qu'à qui opère le club ou encadre l'équipe, et filtre ensuite sur cette équipe —
--     le résultat est identique) ; cm_tableau_de_bord (CM SportVision, peut_operer_club : tout).
--   - Connect, l'OS et les fonctions serveur n'appellent pas club_calendrier.
--   - Les 3 widgets de la v124 (club_dashboard_upcoming_events, club_onboarding_calendrier,
--     club_presence_request_calendrier) lisent club_calendrier_interne directement : non touchés.
--
-- CE QUI NE CHANGE PAS : club_calendrier_interne (le calendrier lui-même), peut_lire_calendrier_club
-- (qui a le droit d'appeler), is_team_educateur, les colonnes rendues, les droits d'exécution
-- (`create or replace` les conserve : authenticated et service_role, jamais anon).
--
-- COÛT. Les équipes encadrées sont calculées UNE fois par appel (une évaluation de
-- is_team_educateur par équipe du club, pas par événement : 4 664 occurrences sur un an chez
-- SF Villemomble pour une cinquantaine d'équipes).
--
-- GARDE-FOU. club_calendrier est recréée à partir de sa définition de production du 11/09/2026
-- (v120). Si elle a changé depuis, la migration s'arrête AVANT toute modification. Rejouable.
--
-- REVIEW. La copie Review de club_calendrier_interne n'a que 15 colonnes (écart documenté dans
-- app-next/src/lib/data/club/calendar.ts) : cette migration ne s'y rejoue pas telle quelle, le
-- garde-fou l'y arrêtera. Il faudra y reporter la même règle sur sa propre définition.
--
-- Testée en transaction annulée : tests/blocages-review.test.sql (rouge sans elle).
-- Vérification par le chemin réel après exécution : tests/blocages-review.test.mjs.
-- ============================================================================================

begin;

set lock_timeout = '5s';

-- ── 0. Garde-fou ─────────────────────────────────────────────────────────────────────────────
do $garde$
declare
  f text := md5(pg_get_functiondef('public.club_calendrier(uuid, date, date)'::regprocedure));
begin
  if f not in ('4add3e58f1bc949a92655c39b8ecb34a', 'c8bbd1c443e02cc6064a173a39578b01') then
    raise exception 'blocages-review-2 : club_calendrier a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié. Reporter la règle des rôles d''équipe sur sa NOUVELLE définition et son empreinte ici.', f;
  end if;
end $garde$;


-- ── 1. club_calendrier : la règle de la v124 ─────────────────────────────────────────────────
create or replace function public.club_calendrier(p_club_id uuid, p_du date, p_au date)
returns table(ref text, genre text, date_evenement date, heure_debut time without time zone, heure_fin time without time zone, titre text, equipe text, team_id uuid, adversaire text, domicile boolean, lieu text, competition text, score text, statut text, couverture text, adversaire_logo text, type_couverture text, buteurs text, passeurs text, homme_du_match text, cartons text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text;
  v_tout_le_club boolean;
  v_equipes uuid[];
begin
  -- 1. Le droit d'ouvrir le calendrier du club : inchangé depuis la v120.
  if not peut_lire_calendrier_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  -- 2. Ce qu'on y voit. Une seule ligne par (user_id, club_id) : contrainte
  --    club_members_user_id_club_id_key.
  select cm.role into v_role
    from club_members cm
   where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif';

  v_tout_le_club :=
    -- Pas de rôle dans le club : l'accès vient d'ailleurs (opérateur, staff, agence, joueur,
    -- parent). Inchangé depuis la v120.
    v_role is null
    -- Rôles administratifs : la liste de club_dashboard_upcoming_events (v124), telle quelle.
    or v_role in ('admin', 'president', 'secretaire', 'tresorier', 'membre_bureau', 'administratif',
                  'comm', 'cm_externe', 'lecture_seule')
    -- Qui opère le club garde sa vue d'opérateur, même avec une ligne de rôle d'équipe.
    or peut_operer_club(p_club_id)
    -- Joueur du club ou parent confirmé d'un joueur du club : ce que la v120 lui donne déjà.
    or exists (
      select 1 from player_profiles pp
       where pp.club_id = p_club_id
         and coalesce(pp.account_status, '') <> 'retire'
         and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
    );

  if v_tout_le_club then
    return query select * from club_calendrier_interne(p_club_id, p_du, p_au);
    return;
  end if;

  -- 3. Rôles d'équipe (coach, resp_equipe, directeur_sportif) et responsable sponsors : leurs
  --    équipes (is_team_educateur, la règle qui fait foi partout ailleurs), plus le club.
  v_equipes := array(
    select ct.id from club_teams ct
     where ct.club_id = p_club_id and is_team_educateur(ct.id)
  );

  return query
  select e.*
    from club_calendrier_interne(p_club_id, p_du, p_au) e
   where e.team_id is null
      or e.team_id = any (v_equipes);
end;
$$;

comment on function public.club_calendrier(uuid, date, date) is
  'Le calendrier unifié d''un club. Vérifie le lien avec le club (peut_lire_calendrier_club, v120), puis, décision de Fouka du 11/09/2026 (même règle que club_dashboard_upcoming_events, v124) : tout le club pour les rôles administratifs, qui opère le club, et qui n''y a pas de rôle (staff, agence, joueur, parent) ; pour coach, resp_equipe, directeur_sportif et sponsor_mgr, les événements de leurs équipes (is_team_educateur) et ceux sans équipe.';

-- Droits d'exécution réaffirmés (inchangés depuis la v120) : jamais anon, jamais PUBLIC.
revoke execute on function public.club_calendrier(uuid, date, date) from public, anon;
grant execute on function public.club_calendrier(uuid, date, date) to authenticated;

commit;
