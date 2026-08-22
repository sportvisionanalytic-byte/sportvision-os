-- ============================================================================
-- migration-sync-clients-clubs-bidirectionnel.sql
-- ============================================================================
-- Demande explicite de Fouka (22/08/2026) : si un club modifie ses infos
-- (logo, adresse, ville) dans Club+, ça doit se répercuter côté OS (table
-- `clients`) — et inversement si le staff modifie la fiche client dans l'OS.
-- Jusqu'ici ces deux tables étaient strictement indépendantes en écriture
-- une fois le compte activé, reliées uniquement par la FK de lecture
-- `clubs.portail_client_id` (voir audit du 22/08).
--
-- Champs synchronisés : nom, logo_url, adresse, ville — les seuls présents
-- sur les deux tables. `clients.code_postal` n'a pas d'équivalent sur
-- `clubs`, non synchronisé.
--
-- Protection anti-boucle infinie (A→B déclenche B→A qui redéclenche A→B...) :
-- chaque trigger ne propage QUE si les valeurs ont réellement changé (IF ...
-- IS DISTINCT FROM), ET l'UPDATE vers la table miroir est lui-même conditionné
-- par une clause WHERE ... IS DISTINCT FROM — si les valeurs sont déjà
-- identiques après le premier saut, l'UPDATE affecte 0 ligne et le trigger
-- FOR EACH ROW de la table miroir ne se déclenche donc pas une seconde fois.
-- Pattern standard pour une synchro bidirectionnelle sûre.
-- ============================================================================

create or replace function sync_client_to_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (NEW.nom is distinct from OLD.nom)
     or (NEW.logo_url is distinct from OLD.logo_url)
     or (NEW.adresse is distinct from OLD.adresse)
     or (NEW.ville is distinct from OLD.ville) then
    update clubs set
      nom = NEW.nom,
      logo_url = NEW.logo_url,
      adresse = NEW.adresse,
      ville = NEW.ville,
      updated_at = now()
    where portail_client_id = NEW.id
      and (nom is distinct from NEW.nom
        or logo_url is distinct from NEW.logo_url
        or adresse is distinct from NEW.adresse
        or ville is distinct from NEW.ville);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_client_to_club on clients;
create trigger trg_sync_client_to_club
  after update on clients
  for each row execute function sync_client_to_club();

create or replace function sync_club_to_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.portail_client_id is null then
    return NEW;
  end if;
  if (NEW.nom is distinct from OLD.nom)
     or (NEW.logo_url is distinct from OLD.logo_url)
     or (NEW.adresse is distinct from OLD.adresse)
     or (NEW.ville is distinct from OLD.ville) then
    update clients set
      nom = NEW.nom,
      logo_url = NEW.logo_url,
      adresse = NEW.adresse,
      ville = NEW.ville,
      updated_at = now()
    where id = NEW.portail_client_id
      and (nom is distinct from NEW.nom
        or logo_url is distinct from NEW.logo_url
        or adresse is distinct from NEW.adresse
        or ville is distinct from NEW.ville);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_club_to_client on clubs;
create trigger trg_sync_club_to_client
  after update on clubs
  for each row execute function sync_club_to_client();
