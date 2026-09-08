-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — « Mes clubs » et la gestion des affectations
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Deux fonctions de lecture seulement. Aucun droit d'ecriture nouveau pour le CM : la phase 2
-- rend l'architecture visible et utilisable, elle ne lui ouvre pas la configuration du club.
--
-- §25 : rien n'est duplique, tout est lu depuis club_cm_affectations et les tables existantes.
-- §26 : une requete par ecran, pas une par club.

begin;

-- ── Ce que voit un CM sur son accueil ────────────────────────────────────────
-- Le perimetre est celui des affectations, calcule ici, pas filtre apres coup dans le navigateur
-- (§7). Un club qui n'est pas affecte ne quitte jamais la base.
create or replace function public.cm_mes_clubs()
returns table(
  club_id uuid, nom text, logo_url text, full_com boolean,
  role_affectation text, date_debut date, date_fin date,
  onboarding_statut text, onboarding_debut timestamptz, derniere_activite timestamptz,
  equipes integer, membres integer, coachs integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select c.id, c.nom, c.logo_url,
         c.club_plus_source = 'full_com_included',
         a.role, a.date_debut, a.date_fin,
         o.statut, o.started_at, o.last_activity_at,
         (select count(*)::integer from club_teams   t where t.club_id = c.id),
         (select count(*)::integer from club_members m where m.club_id = c.id),
         (select count(*)::integer from club_members m where m.club_id = c.id and m.role = 'coach')
  from club_cm_affectations a
  join clubs c on c.id = a.club_id
  left join club_onboarding_progress o on o.club_id = c.id
  where a.cm_id = auth.uid()
    and a.actif
    and a.date_debut <= current_date
    and (a.date_fin is null or a.date_fin >= current_date)
  order by c.nom;
$function$;

comment on function public.cm_mes_clubs() is
  'Les clubs affectes a l''utilisateur courant, avec l''etat de leur onboarding. Le perimetre vient des affectations actives et dans leur fenetre de dates : un club non affecte ne quitte jamais la base.';

-- ── L'equipe SportVision d'un club, historique compris ───────────────────────
-- Sert a l'ecran d'affectation cote direction, et au bloc « Referent SportVision » (§15, §36).
-- L'historique est conserve : savoir qui a gere un club compte (§5).
create or replace function public.club_affectations_cm(p_club_id uuid)
returns table(
  id uuid, cm_id uuid, prenom text, nom text, role text,
  date_debut date, date_fin date, actif boolean, en_cours boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select a.id, a.cm_id, p.prenom, p.nom, a.role, a.date_debut, a.date_fin, a.actif,
         (a.actif and a.date_debut <= current_date
          and (a.date_fin is null or a.date_fin >= current_date)) as en_cours
  from club_cm_affectations a
  join profiles p on p.id = a.cm_id
  where a.club_id = p_club_id
    and (
      -- La direction voit tout l'historique du club.
      exists (select 1 from profiles me where me.id = auth.uid() and me.role in ('admin','com'))
      -- Un CM ne voit que les affectations d'un club qui est dans son perimetre.
      or p_club_id in (select cm_clubs_autorises())
    )
  order by a.actif desc, a.date_debut desc;
$function$;

comment on function public.club_affectations_cm(uuid) is
  'Qui gere ce club chez SportVision, aujourd''hui et avant. La direction voit tout ; un CM ne voit que les clubs de son perimetre.';

revoke all on function public.cm_mes_clubs()             from public;
revoke all on function public.club_affectations_cm(uuid) from public;
grant execute on function public.cm_mes_clubs()             to authenticated;
grant execute on function public.club_affectations_cm(uuid) to authenticated;

commit;
