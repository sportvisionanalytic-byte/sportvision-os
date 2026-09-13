-- v210 — L'administrateur SportVision retrouve les espaces club, et l'import d'effectif s'ouvre
-- à qui opère le club (13/09/2026).
--
-- Deux blocages trouvés en préparant l'intégration des effectifs, vérifiés en base sous les
-- identités réelles.
--
-- 1. `cm_espaces_clubs()` exige `profiles.role = 'cm'`. Le compte de Fouka est `admin` : la
--    fonction lui rend ZÉRO espace, alors que `cm_clubs_autorises()` lui ouvre les trois clubs et
--    que la RLS lui donne les 78 équipes. Mesuré : 0 espace. Il devait emprunter le compte d'un
--    autre pour entrer dans Club+.
--    Le commentaire disait « un administrateur n'est pas un CM ». C'est vrai pour le métier, faux
--    pour l'accès : la direction voit déjà tout le reste, et se voyait refuser la seule porte
--    d'entrée. On l'ouvre à l'administrateur, qui est déjà autorisé partout ailleurs.
--
-- 2. `match_player_candidates` exige `is_club_admin` — c'est-à-dire d'être administrateur DU CLUB.
--    Or c'est SportVision qui intègre les effectifs de ses clubs. Mesuré : le CM affecté aux trois
--    clubs, et le compte contact@sportvision-an.fr, reçoivent « Non autorisé ». Seul le président
--    passait. L'import devient impossible pour l'équipe qui le fait réellement.
--    On aligne sur `peut_preparer_club`, qui est déjà la règle des autres gestes d'exploitation.
-- Idempotente.

create or replace function public.cm_espaces_clubs()
returns table(club_id uuid, nom text, logo_url text, origine text, role_affectation text, full_com boolean)
language sql stable security definer set search_path to 'public', 'pg_temp'
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
   and a.date_debut <= (now() at time zone 'Europe/Paris')::date
   and (a.date_fin is null or a.date_fin >= (now() at time zone 'Europe/Paris')::date)
  left join cm_agency_club_access d
    on d.club_id = c.id
   and exists (select 1 from memberships m where m.user_id = auth.uid()
                 and m.organization_id = d.cm_agency_org_id and m.status = 'actif')
  -- Le CM gère ses clubs, l'administrateur SportVision les voit tous : c'est déjà vrai partout
  -- ailleurs, et c'était la seule porte qui lui restait fermée (13/09/2026).
  where exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role in ('cm','admin'))
  order by c.nom;
$function$;

create or replace function public.match_player_candidates(
  p_club_id uuid, p_prenom text, p_nom text, p_date_naissance date, p_numero_licence text default null)
returns table(player_id uuid, match_strength text, existing_prenom text, existing_nom text, existing_date_naissance date)
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  -- `peut_preparer_club` couvre l'administrateur du club ET qui opère le club côté SportVision.
  -- `is_club_admin` seul fermait l'import a l'equipe qui l'effectue reellement.
  if not peut_preparer_club(p_club_id) then
    raise exception 'Non autorisé pour ce club.' using errcode = '42501';
  end if;

  return query select * from find_player_match_candidates(p_club_id, p_prenom, p_nom, p_date_naissance, p_numero_licence);
end;
$function$;
