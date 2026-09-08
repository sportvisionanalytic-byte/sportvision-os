-- ═══════════════════════════════════════════════════════════════════════════════
-- Affecter un CM depuis l'OS doit le faire apparaitre dans Club+
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Fouka a affilie un CM a SF Villemomble depuis l'OS, et son compte CM ne voyait toujours qu'un
-- seul club. Cause : deux modeles, et un pont a sens unique.
--
--   club_cm_affectations  le modele du chantier CM. C'est lui que lit cm_clubs_autorises(),
--                         donc lui seul decide de ce que Club+ montre.
--   clients.cm_id         le modele historique. C'est lui qu'ecrivent l'ecran client de l'OS et
--                         la cascade Full Communication.
--
-- Le trigger cca_refleter_clients_cm() faisait deja affectation → clients.cm_id. L'inverse
-- n'existait pas : affecter un CM au client ne creait aucune affectation, et Club+ ne voyait rien.
--
-- Le pont est pose en BASE plutot que dans l'ecran qui a servi ce soir : le champ cm_id est ecrit
-- depuis la cascade Full Communication, depuis la fiche client, et sans doute ailleurs. Corriger
-- un seul appelant aurait laisse les autres muets.
--
-- Protection contre la boucle : on ne fait rien si l'affectation equivalente existe deja, ce qui
-- coupe l'aller-retour entre les deux declencheurs.

begin;

create or replace function public.refleter_cm_client_en_affectation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  set actif = false, date_fin = current_date, updated_at = now()
  where club_id = v_club and actif and role = 'principal';

  insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif, created_by)
  values (v_club, new.cm_id, 'principal', current_date, true, auth.uid());

  return new;
end $function$;

drop trigger if exists trg_refleter_cm_client on clients;
create trigger trg_refleter_cm_client
  after update of cm_id on clients
  for each row execute function public.refleter_cm_client_en_affectation();

-- ── Rattrapage des clients deja affectes mais absents de Club+ ───────────────
-- Uniquement ceux qui ont un club ET un CM, et pour lesquels aucune affectation active n'existe.
-- Aucune donnee n'est supprimee, aucune affectation existante n'est touchee.
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select c.id, cl.cm_id, 'principal', current_date, true
from clients cl
join clubs c on c.portail_client_id = cl.id
where cl.cm_id is not null
  and not exists (select 1 from club_cm_affectations a where a.club_id = c.id and a.actif);

commit;

select c.nom as club, p.email as cm, a.role, a.actif
from club_cm_affectations a
join clubs c on c.id = a.club_id
left join profiles p on p.id = a.cm_id
where a.actif order by c.nom;
