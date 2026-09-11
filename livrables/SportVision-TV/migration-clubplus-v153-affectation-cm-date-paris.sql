-- v153 : une affectation de CM compte en jours de Paris (11/09/2026).
--
-- La base tourne en UTC : current_date y bascule à 2 h du matin, heure de Paris (1 h l'hiver). Une
-- affectation posée entre minuit et 2 h, datée du jour, n'ouvrait le club au CM qu'à 2 h ; une
-- affectation qui se termine « aujourd'hui » se fermait à minuit UTC. Constaté le 11/09 en
-- préparant un test à 1 h du matin. Dans les sept fonctions qui lisent la fenêtre d'une affectation,
-- current_date devient la date de Paris ; rien d'autre ne change.
-- Test : tests/cm-affectation-date-paris.test.sql

create or replace function public.cca_refleter_clients_cm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_club uuid; v_cm uuid;
begin
  v_club := coalesce(new.club_id, old.club_id);
  -- Le CM principal actif du club, s'il y en a un.
  select a.cm_id into v_cm
  from club_cm_affectations a
  where a.club_id = v_club and a.role = 'principal' and a.actif
    and a.date_debut <= (now() at time zone 'Europe/Paris')::date
    and (a.date_fin is null or a.date_fin >= (now() at time zone 'Europe/Paris')::date)
  limit 1;

  update clients c set cm_id = v_cm
  where c.id = v_club or c.id in (select legacy_client_id from organizations where id = v_club);
  return null;
end $function$

;

create or replace function public.club_affectations_cm(p_club_id uuid)
 RETURNS TABLE(id uuid, cm_id uuid, prenom text, nom text, role text, date_debut date, date_fin date, actif boolean, en_cours boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select a.id, a.cm_id, p.prenom, p.nom, a.role, a.date_debut, a.date_fin, a.actif,
         (a.actif and a.date_debut <= (now() at time zone 'Europe/Paris')::date
          and (a.date_fin is null or a.date_fin >= (now() at time zone 'Europe/Paris')::date)) as en_cours
  from club_cm_affectations a
  join profiles p on p.id = a.cm_id
  where a.club_id = p_club_id
    and (
      -- La direction voit tout l'historique du club.
      exists (select 1 from profiles me where me.id = auth.uid() and me.actif and me.role in ('admin','com'))
      -- Un CM ne voit que les affectations d'un club qui est dans son perimetre.
      or p_club_id in (select cm_clubs_autorises())
    )
  order by a.actif desc, a.date_debut desc;
$function$

;

create or replace function public.cm_clubs_autorises()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Un compte OS desactive n'a plus aucun club, quelle que soit la branche qui les lui ouvrait
  -- (migration-decisions-os-v1). L'union d'origine est inchangee, simplement enveloppee.
  select autorises.id from (
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
    and a.date_debut <= (now() at time zone 'Europe/Paris')::date
    and (a.date_fin is null or a.date_fin >= (now() at time zone 'Europe/Paris')::date)

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
    and (d.expires_at is null or d.expires_at >= (now() at time zone 'Europe/Paris')::date)

  union

  -- (2) « CM responsable » : membre actif d'une agence CM avec cm_super_access, il voit tous les
  -- clubs. Regle metier posee le 22/08, conservee telle quelle.
  select c.id from clubs c
  where exists (
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.status = 'actif'
      and o.organization_type = 'cm_agency' and coalesce(m.cm_super_access, false)
  )
  ) autorises(id)
  where not public.compte_os_desactive();
$function$

;

create or replace function public.cm_clubs_autorises_de(p_cm uuid)
 RETURNS TABLE(club_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select a.club_id from club_cm_affectations a
  where a.cm_id = p_cm and a.actif
    and a.date_debut <= (now() at time zone 'Europe/Paris')::date
    and (a.date_fin is null or a.date_fin >= (now() at time zone 'Europe/Paris')::date)
  union
  select c.id from clubs c
  join clients cl on cl.id = c.portail_client_id
  where cl.cm_id = p_cm;
$function$

;

create or replace function public.cm_espaces_clubs()
 RETURNS TABLE(club_id uuid, nom text, logo_url text, origine text, role_affectation text, full_com boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
   and a.date_debut <= (now() at time zone 'Europe/Paris')::date and (a.date_fin is null or a.date_fin >= (now() at time zone 'Europe/Paris')::date)
  left join cm_agency_club_access d
    on d.club_id = c.id
   and exists (select 1 from memberships m where m.user_id = auth.uid()
                 and m.organization_id = d.cm_agency_org_id and m.status = 'actif')
  -- Un administrateur n'est pas un CM : cette liste est celle d'un gestionnaire de clubs.
  where exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'cm')
  order by c.nom;
$function$

;

create or replace function public.cm_mes_clubs()
 RETURNS TABLE(club_id uuid, nom text, logo_url text, full_com boolean, role_affectation text, date_debut date, date_fin date, onboarding_statut text, onboarding_debut timestamp with time zone, derniere_activite timestamp with time zone, equipes integer, membres integer, coachs integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    and not public.compte_os_desactive()
    and a.actif
    and a.date_debut <= (now() at time zone 'Europe/Paris')::date
    and (a.date_fin is null or a.date_fin >= (now() at time zone 'Europe/Paris')::date)
  order by c.nom;
$function$

;

create or replace function public.refleter_cm_client_en_affectation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_club uuid;
begin
  if new.cm_id is null or new.cm_id is not distinct from old.cm_id then
    return new;
  end if;

  select c.id into v_club from clubs c where c.portail_client_id = new.id limit 1;
  if v_club is null then
    return new;  -- un client sans club Club+ : rien a refleter
  end if;

  -- Deja en place : on sort avant toute ecriture, sinon les deux declencheurs se relancent
  -- mutuellement sans fin.
  if exists (select 1 from club_cm_affectations a
             where a.club_id = v_club and a.cm_id = new.cm_id and a.actif) then
    return new;
  end if;

  -- Un seul principal actif a la fois : l'ancien est clos a la date du jour, jamais supprime.
  update club_cm_affectations
  set actif = false, date_fin = (now() at time zone 'Europe/Paris')::date, updated_at = now()
  where club_id = v_club and actif and role = 'principal';

  insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif, created_by)
  values (v_club, new.cm_id, 'principal', (now() at time zone 'Europe/Paris')::date, true, auth.uid());

  return new;
end $function$

;

