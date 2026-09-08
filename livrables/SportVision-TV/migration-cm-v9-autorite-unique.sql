-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 3B — Une seule autorite pour « quels clubs ce CM peut-il gerer »
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- L'audit de Club+ a montre qu'il existait deja DEUX sources de verite, auxquelles la phase 1 en
-- a ajoute une troisieme :
--
--   1. cm_agency_club_access        une agence CM a un acces delegue a des clubs (17/08)
--   2. memberships.cm_super_access  un « CM responsable » voit TOUS les clubs (22/08)
--   3. club_cm_affectations         un CM est affecte a un club (08/09, phase 1)
--
-- Trois listes independantes pour la meme question finissent toujours par diverger, et la
-- premiere oubliee est la fuite. cm_clubs_autorises() les reunit : c'est desormais la SEULE
-- reponse a « quels clubs ». L'OS et Club+ posent la meme question au meme endroit.
--
-- Les trois mecanismes gardent leur sens metier, ils ne se remplacent pas :
--   une agence CM externe n'est pas un CM salarie affecte, et un CM responsable n'est ni l'un
--   ni l'autre. On additionne des chemins d'autorisation, on n'en supprime aucun.

create or replace function public.cm_clubs_autorises()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- La direction et les fonctions transverses gardent leur vue globale.
  select c.id from clubs c
  where exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','com','sec','prod','compta','rh')
  )

  union

  -- (3) Affectation nominative : le modele de la phase 1. Active, et dans sa fenetre de dates —
  -- desactiver une affectation retire donc l'acces au prochain acces, sans tache de nettoyage.
  select a.club_id
  from club_cm_affectations a
  where a.cm_id = auth.uid()
    and a.actif
    and a.date_debut <= current_date
    and (a.date_fin is null or a.date_fin >= current_date)

  union

  -- (1) Delegation a une agence CM dont l'utilisateur est membre actif. Une delegation expiree
  -- n'ouvre rien : du point de vue de l'utilisateur, elle n'a jamais existe.
  select d.club_id
  from cm_agency_club_access d
  join memberships m on m.organization_id = d.cm_agency_org_id
  join organizations o on o.id = d.cm_agency_org_id
  where m.user_id = auth.uid()
    and m.status = 'actif'
    and o.organization_type = 'cm_agency'
    -- `allowed` et `denied` sont des listes de MODULES, pas des drapeaux : la delegation par
    -- module affine ce que l'agence peut faire dans le club, elle ne conditionne pas l'acces au
    -- club lui-meme. L'existence de la ligne suffit donc, comme dans getSpaces cote Club+.
    and (d.expires_at is null or d.expires_at >= current_date)

  union

  -- (2) « CM responsable » : membre actif d'une agence CM avec cm_super_access, il voit tous les
  -- clubs. Regle metier posee le 22/08, conservee telle quelle.
  select c.id from clubs c
  where exists (
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.status = 'actif'
      and o.organization_type = 'cm_agency' and coalesce(m.cm_super_access, false)
  );
$function$;

comment on function public.cm_clubs_autorises() is
  'LA reponse a « quels clubs cette personne peut-elle gerer ». Reunit les trois chemins d''autorisation : affectation nominative, delegation d''agence CM, et CM responsable. L''OS et Club+ posent tous deux la question ici, jamais a une table directement.';

-- ── Ce que Club+ appelle pour construire ses espaces ─────────────────────────
-- Renvoie les clubs geres AVEC leur origine, pour que l'interface puisse dire d'ou vient le
-- droit sans avoir a interroger trois tables elle-meme.
create or replace function public.cm_espaces_clubs()
returns table(club_id uuid, nom text, logo_url text, origine text, role_affectation text, full_com boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select c.id, c.nom, coalesce(c.logo_url, c.ecusson_url),
         case
           when a.id is not null then 'affectation'
           when d.id is not null then 'delegation_agence'
           else 'cm_responsable'
         end,
         a.role,
         c.club_plus_source = 'full_com_included'
  from clubs c
  join (select cm_clubs_autorises() as id) autorises on autorises.id = c.id
  left join club_cm_affectations a
    on a.club_id = c.id and a.cm_id = auth.uid() and a.actif
   and a.date_debut <= current_date and (a.date_fin is null or a.date_fin >= current_date)
  left join cm_agency_club_access d
    on d.club_id = c.id
   and exists (select 1 from memberships m where m.user_id = auth.uid()
                 and m.organization_id = d.cm_agency_org_id and m.status = 'actif')
  -- Un administrateur n'est pas un CM : cette liste est celle d'un gestionnaire de clubs.
  where exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm')
  order by c.nom;
$function$;

comment on function public.cm_espaces_clubs() is
  'Les clubs qu''un CM gere, avec l''origine de son droit. Utilisee par Club+ pour construire ses espaces : une seule question, une seule reponse, jamais trois tables lues separement cote client.';

revoke all on function public.cm_espaces_clubs() from public;
grant execute on function public.cm_espaces_clubs() to authenticated;

select 'OK' as verdict;
