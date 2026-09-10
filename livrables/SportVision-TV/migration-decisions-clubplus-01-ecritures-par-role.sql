-- Décisions Club+ du 10/09/2026, n° 1 : un rôle n'écrit que ce que la matrice lui donne.
--
-- ── Pourquoi ──
-- Fouka a décidé que chaque rôle de club ne voit dans Club+ que les entrées qu'il a le droit
-- d'utiliser. Avant de masquer quoi que ce soit, on a mesuré ce que la BASE laisse faire aux
-- quatre rôles concernés (responsable d'équipe, lecture seule, membre du bureau, responsable
-- sponsors), par PostgREST et avec leur propre jeton (tests/clubplus-menus-roles.test.mjs).
--
-- Lectures sensibles : rien à fermer. Factures, devis et contrats restent au bureau (v41),
-- invitations et jetons à qui opère le club (peut_operer_club), abonnement Stripe à l'Owner Club+
-- (vérifié côté serveur), données des joueurs aux encadrants de leur équipe.
--
-- Écritures : deux failles, parce que dix tables d'exploitation s'ouvrent en écriture à « tout
-- membre actif du club » (is_club_member), sans regarder le rôle :
--
--   1. Un compte « Lecture seule » écrit. Mesuré : il crée une demande de visuel (201). Il pouvait
--      aussi, comme le membre du bureau et le responsable sponsors, réserver une prestation
--      SportVision au nom du club, modifier un match sans équipe, ajouter un événement au
--      calendrier, proposer une actualité, commenter une demande. Aucun des trois n'a ces écrans
--      dans son menu : la matrice ne leur donne que la lecture (lecture seule), les documents
--      financiers (membre du bureau, règle v41) et les sponsors (responsable sponsors).
--
--   2. Les paramètres du club (lieux, créneaux d'entraînement, avancement de l'onboarding)
--      s'écrivaient par tout membre. Un responsable sponsors pouvait supprimer tout le planning
--      d'entraînement ; un responsable d'équipe, les créneaux d'une équipe qui n'est pas la sienne ;
--      n'importe qui, marquer l'onboarding « soumis » à SportVision. Le seul écran qui écrit ces
--      tables (l'onboarding) est réservé à l'Owner Club+, au Président et au CM SportVision : la
--      règle V1 close le dit — le CM opère, le Président administre, le coach tient SES équipes.
--
-- ── Ce que la migration fait ──
--   A. `club_role_sans_exploitation(club_id)` : vrai si l'appelant est, dans CE club, lecture
--      seule, membre du bureau ou responsable sponsors, et n'opère pas le club par ailleurs.
--      Policies RESTRICTIVES en insertion / modification / suppression sur les sept tables
--      d'exploitation restantes. Restrictives : elles s'ajoutent aux policies existantes sans en
--      réécrire aucune, et ne touchent aucun autre rôle.
--   B. Lieux et avancement de l'onboarding : les policies « tout membre » disparaissent ; restent
--      celles de qui opère le club (peut_operer_club = Owner Club+, Président, CM SportVision),
--      du CM cloisonné et du staff. Créneaux d'entraînement : l'encadrement de l'équipe
--      (is_team_educateur) ou qui opère le club.
--
-- ── Ce qu'elle ne fait pas ──
--   • Aucune lecture n'est retirée : l'annuaire du club, les sponsors, le calendrier, les équipes
--     et la messagerie avec SportVision restent lisibles par tout membre actif (règles existantes).
--   • Le responsable sponsors garde l'écriture des sponsors (csp_member_insert/update, inchangées).
--   • Chacun garde sa propre fiche (cm_self_update), l'ouverture d'un ticket d'aide et le
--     signalement d'un média : ce ne sont pas des données d'exploitation.
--   • Coach, directeur sportif, responsable d'équipe, secrétaire, communication, trésorier,
--     administratif : inchangés en A. En B, ils perdent l'écriture des lieux, des créneaux des
--     équipes qu'ils n'encadrent pas et de l'avancement de l'onboarding — trois droits sans écran
--     pour eux, que la matrice réserve à qui opère le club.
--
-- Vérifié par tests/clubplus-roles-ecritures.test.sql (transaction annulée) : rouge sur la base
-- actuelle, vert avec cette migration, contrôles positifs compris (l'Owner Club+ écrit toujours,
-- le responsable d'équipe tient toujours les créneaux de SON équipe, le responsable sponsors gère
-- toujours les sponsors, la lecture seule ouvre toujours un ticket d'aide).

begin;

-- ── A. Les rôles sans droit d'exploitation ──────────────────────────────────────────────────

create or replace function public.club_role_sans_exploitation(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- `coalesce(…, false)` : un club_id nul ne doit ni refuser ni autoriser par accident ; il
  -- laisse les autres policies décider, exactement comme avant.
  select coalesce(
           p_club_id is not null
           and exists (
             select 1 from club_members cm
              where cm.club_id = p_club_id
                and cm.user_id = auth.uid()
                and cm.status = 'actif'
                and cm.role in ('lecture_seule', 'membre_bureau', 'sponsor_mgr')
           )
           -- Un membre du staff SportVision rattaché au club sous un de ces rôles garde ce que
           -- son métier lui donne : peut_operer_club est l'autorité unique pour opérer un club.
           and not public.peut_operer_club(p_club_id),
         false);
$$;

comment on function public.club_role_sans_exploitation(uuid) is
  'Vrai si l''appelant est, dans ce club, lecture seule, membre du bureau ou responsable sponsors '
  '(sans opérer le club par ailleurs) : ces rôles n''écrivent aucune donnée d''exploitation. '
  'Décisions Club+ du 10/09/2026, n° 1.';

-- PostgreSQL accorde EXECUTE à PUBLIC par défaut : on le retire à PUBLIC, pas seulement à anon.
revoke all on function public.club_role_sans_exploitation(uuid) from public;
grant execute on function public.club_role_sans_exploitation(uuid) to authenticated, service_role;

-- Une policy par commande : une policy restrictive « for all » s'appliquerait aussi aux lectures.
do $$
declare
  t text;
begin
  foreach t in array array['club_creations', 'club_matches', 'club_calendar_events',
                           'club_media', 'club_newsroom_items', 'club_requests']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_sans_exploitation_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_sans_exploitation_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_sans_exploitation_del', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated
         with check (not public.club_role_sans_exploitation(club_id))', t || '_sans_exploitation_ins', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated
         using (not public.club_role_sans_exploitation(club_id))
         with check (not public.club_role_sans_exploitation(club_id))', t || '_sans_exploitation_upd', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated
         using (not public.club_role_sans_exploitation(club_id))', t || '_sans_exploitation_del', t);
  end loop;
end $$;

-- Réservations : une famille réserve pour SON enfant (cbk_family_insert, player_id renseigné).
-- Un parent peut aussi être, dans le même club, membre du bureau : sa réservation familiale ne
-- doit pas tomber avec la règle. Seules les réservations au nom du club (sans joueur) sont visées.
drop policy if exists club_bookings_sans_exploitation_ins on public.club_bookings;
drop policy if exists club_bookings_sans_exploitation_upd on public.club_bookings;
drop policy if exists club_bookings_sans_exploitation_del on public.club_bookings;
create policy club_bookings_sans_exploitation_ins on public.club_bookings as restrictive for insert to authenticated
  with check (player_id is not null or not public.club_role_sans_exploitation(club_id));
create policy club_bookings_sans_exploitation_upd on public.club_bookings as restrictive for update to authenticated
  using (player_id is not null or not public.club_role_sans_exploitation(club_id))
  with check (player_id is not null or not public.club_role_sans_exploitation(club_id));
create policy club_bookings_sans_exploitation_del on public.club_bookings as restrictive for delete to authenticated
  using (player_id is not null or not public.club_role_sans_exploitation(club_id));

-- ── B. Paramètres du club : qui opère le club, et l'encadrement pour ses propres créneaux ──

-- Lieux : cven_operateur_manage (peut_operer_club), club_venues_cm_prepare et cven_staff_all
-- restent en place et couvrent l'Owner Club+, le Président, le CM et le staff.
drop policy if exists cven_member_insert on public.club_venues;
drop policy if exists cven_member_update on public.club_venues;

-- Avancement de l'onboarding : aucune policy « opérateur » n'existait, l'Owner et le Président
-- passaient par celles de tout membre. On la crée, avec la même borne de statut qu'avant : la
-- validation (`validated`, `needs_information`) reste au staff SportVision.
drop policy if exists cop_member_upsert on public.club_onboarding_progress;
drop policy if exists cop_member_update on public.club_onboarding_progress;
drop policy if exists cop_operateur_insert on public.club_onboarding_progress;
drop policy if exists cop_operateur_update on public.club_onboarding_progress;
create policy cop_operateur_insert on public.club_onboarding_progress for insert to authenticated
  with check (public.peut_operer_club(club_id) and statut in ('not_started', 'in_progress', 'submitted'));
create policy cop_operateur_update on public.club_onboarding_progress for update to authenticated
  using (public.peut_operer_club(club_id))
  with check (public.peut_operer_club(club_id) and statut in ('not_started', 'in_progress', 'submitted'));

-- Créneaux d'entraînement : l'encadrement de l'équipe (is_team_educateur couvre l'Owner, le
-- Président et le coach / responsable d'équipe / directeur sportif de CETTE équipe) ou qui
-- opère le club. ctts_cm_prepare et ctts_staff_all restent en place.
drop policy if exists ctts_member_insert on public.club_team_training_slots;
drop policy if exists ctts_member_update on public.club_team_training_slots;
drop policy if exists ctts_member_delete on public.club_team_training_slots;
drop policy if exists ctts_encadrement_insert on public.club_team_training_slots;
drop policy if exists ctts_encadrement_update on public.club_team_training_slots;
drop policy if exists ctts_encadrement_delete on public.club_team_training_slots;
create policy ctts_encadrement_insert on public.club_team_training_slots for insert to authenticated
  with check (exists (select 1 from public.club_teams ct
                       where ct.id = club_team_training_slots.team_id
                         and (public.is_team_educateur(ct.id) or public.peut_operer_club(ct.club_id))));
create policy ctts_encadrement_update on public.club_team_training_slots for update to authenticated
  using (exists (select 1 from public.club_teams ct
                  where ct.id = club_team_training_slots.team_id
                    and (public.is_team_educateur(ct.id) or public.peut_operer_club(ct.club_id))))
  with check (exists (select 1 from public.club_teams ct
                       where ct.id = club_team_training_slots.team_id
                         and (public.is_team_educateur(ct.id) or public.peut_operer_club(ct.club_id))));
create policy ctts_encadrement_delete on public.club_team_training_slots for delete to authenticated
  using (exists (select 1 from public.club_teams ct
                  where ct.id = club_team_training_slots.team_id
                    and (public.is_team_educateur(ct.id) or public.peut_operer_club(ct.club_id))));

commit;
