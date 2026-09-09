-- ═══════════════════════════════════════════════════════════════════════════════
-- Socle du module « Procedure terrain » — couverture, preset club, echeances
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Trois manques identifies a l'audit du 09/09/2026 et tranches par Fouka le meme jour.
-- Rien d'autre : les statuts, l'acceptation, les kits, les incidents, la boucle de validation
-- Production et la confirmation de transfert existent deja et sont reutilises tels quels.

begin;

-- ── 1. La couverture : photo, video, ou les deux ─────────────────────────────
--
-- C'est elle qui commandera la checklist (Lightroom d'un cote, montage + rushs de l'autre).
-- Aujourd'hui rien ne la porte : `type_prestation` et `livrables_demandes` sont du texte libre,
-- et `format_mission` (standard/double/journee/exceptionnelle) decrit le volume, pas le metier.
--
-- Memes valeurs, meme type et meme contrainte que planned_presences.type_couverture, dont elle
-- doit pouvoir heriter sans conversion. Volontairement PAS de valeur par defaut : une mission
-- dont personne n'a dit ce qu'elle couvre doit se voir, pas se deviner.
alter table prestations add column if not exists couverture text;

alter table prestations drop constraint if exists prestations_couverture_check;
alter table prestations add constraint prestations_couverture_check
  check (couverture is null or couverture in ('photo','video','photo_video'));

comment on column prestations.couverture is
  'photo | video | photo_video. Commande la checklist de l''operateur et les livrables exiges. Heritee de planned_presences.type_couverture quand la mission vient d''une presence ; obligatoire a la creation manuelle. NULL = a renseigner avant d''affecter un operateur, jamais devine.';

-- Backfill : UNIQUEMENT depuis une source structuree qui donne la valeur avec certitude.
-- Aucune deduction a partir des mots du brief, sur consigne explicite de Fouka : une mission
-- mal classee enverrait un operateur faire le mauvais travail. Le reste reste NULL et se
-- corrige a la main.
update prestations p
   set couverture = pp.type_couverture
  from planned_presences pp
 where pp.id = p.planned_presence_id
   and p.couverture is null
   and pp.type_couverture in ('photo','video','photo_video');

-- Heritage automatique pour la suite : une mission creee depuis une presence ne doit jamais
-- demander de ressaisir ce que la presence sait deja (« aucune double saisie », §61).
create or replace function public.heriter_couverture_presence()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.couverture is null and new.planned_presence_id is not null then
    select pp.type_couverture into new.couverture
      from planned_presences pp where pp.id = new.planned_presence_id;
  end if;
  return new;
end $function$;

drop trigger if exists trg_heriter_couverture_presence on prestations;
create trigger trg_heriter_couverture_presence
  before insert or update of planned_presence_id on prestations
  for each row execute function public.heriter_couverture_presence();

-- ── 2. Le preset club ────────────────────────────────────────────────────────
--
-- N'existait nulle part : un photographe devait deviner le rendu attendu. Pose sur `clients`,
-- qui EST la fiche club cote OS (prestations.client_id la reference ; il n'y a aucun lien entre
-- `clients` et la table `clubs` de Club+).
--
-- Deux champs, pas un gestionnaire Adobe : le nom du preset et les consignes. Le fichier .xmp
-- n'est pas stocke ici — s'il doit l'etre un jour, ce sera par la bibliotheque de ressources
-- existante, pas par une colonne de plus.
--
-- Lecture par l'operateur : deja couverte par clients_collaborateur_missions_select, qui ouvre
-- la fiche client des missions ou il est affecte. Ecriture : reservee aux roles de
-- clients_write_acces (admin/sec/com/compta/prod/rh) — un photographe applique le preset, il
-- ne le decide pas. Aucune policy a ajouter.
alter table clients add column if not exists photo_preset_name text;
alter table clients add column if not exists photo_preset_notes text;

comment on column clients.photo_preset_name is
  'Nom du preset photo officiel du club, ex. « Villemomble — Officiel ». Remonte tel quel dans le brief de mission. NULL = afficher « Preset non renseigne — verifier avec Production », jamais en inventer un.';
comment on column clients.photo_preset_notes is
  'Consignes de traitement libres : contraste, exposition, rendu, noir et blanc. Affichees sous le nom du preset dans le brief.';

-- ── 3. Les echeances de livraison ────────────────────────────────────────────
--
-- Par mission, jamais globales : aucune regle metier SportVision ne dit « toute photo sous 24h »,
-- et en coder une reviendrait a en inventer une. Nullable, sans defaut.
--
-- Pour la V1, montage final et rushs partagent la meme echeance video. Les separer demanderait
-- un besoin reel qui n'existe pas aujourd'hui.
alter table prestations add column if not exists deadline_photo_at timestamptz;
alter table prestations add column if not exists deadline_video_at timestamptz;

comment on column prestations.deadline_photo_at is
  'Echeance de livraison des photos traitees. NULL = « Aucune echeance renseignee » a l''ecran ; ne jamais substituer un delai par defaut.';
comment on column prestations.deadline_video_at is
  'Echeance de livraison video : montage final ET rushs, qui partagent la meme date en V1. NULL = aucune echeance affichee.';

commit;

-- Ce que Production devra completer : les missions sans couverture ne peuvent pas encore
-- piloter la checklist d'un operateur.
select
  count(*) filter (where couverture is null) as a_renseigner,
  count(*) filter (where couverture is not null) as renseignees,
  count(*) as total
from prestations;
