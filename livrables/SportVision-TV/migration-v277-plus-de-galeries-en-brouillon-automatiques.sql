-- v277 — 25/09/2026 : plus aucune galerie créée automatiquement
--
-- Demande de Fouka : « il faut pas créer aussi des galeries en brouillon. Les brouillons là que tu
-- me fais, des prestations quand il y a une prestation, faut enlever ça. C'est le responsable
-- production qui les crée. Il crée tout lui-même. »
--
-- CE QUE FAISAIT LE DÉCLENCHEUR, ET POURQUOI ÇA NE TENAIT PAS
--
-- `trg_galeries_suivent_la_mission` appelait creer_galeries_mission_auto à deux moments : quand
-- l'équipe était affectée, et de nouveau à la livraison « en filet ». Résultat mesuré ce jour :
-- 18 galeries en brouillon, TOUTES vides, 0 photo, aucun lien. Elles s'accumulaient à chaque
-- mission et encombraient l'écran des galeries d'objets que personne n'avait demandés.
--
-- L'intention était bonne : avoir le réceptacle prêt avant que les photos arrivent. Mais le
-- Responsable Production crée et remplit ses galeries lui-même, au moment où il a les fichiers,
-- et il sait mieux que le déclencheur combien il en faut : un plateau de jeunes ne se découpe pas
-- toujours par équipe, et « une galerie par équipe de la mission » produisait quatre coquilles
-- vides là où il en voulait une.
--
-- CE QUI RESTE, ET C'EST VOLONTAIRE
--
--  * Le BOUTON « Créer les galeries » de la fiche mission (creer_galeries_mission) : c'est son
--    moyen de les créer d'un geste, avec le bon rattachement club/équipe/mission. Il n'est pas
--    touché — le retirer lui enlèverait la seule façon simple de faire ce qu'on lui demande.
--  * La PUBLICATION automatique à la livraison, pour les galeries qui portent une mission ET des
--    photos prêtes. Publier n'est pas créer : c'est la suite de sa validation, pas une décision
--    prise à sa place. Une galerie vide n'est jamais publiée, la condition sur les photos prêtes
--    était déjà là.
--
-- creer_galeries_mission_auto n'est PAS supprimée : la fonction reste en base, seulement plus
-- appelée. La supprimer casserait la restauration d'une sauvegarde antérieure à cette migration,
-- pour ne rien gagner.
--
-- Idempotent.

create or replace function public.galeries_suivent_la_mission()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.statut = old.statut then
    return new;
  end if;

  -- 25/09/2026 (v277) — PLUS AUCUNE CRÉATION ICI. Les deux appels à
  -- creer_galeries_mission_auto (à l'affectation, puis « en filet » à la livraison) ont produit
  -- 18 galeries vides que personne n'avait demandées. Le Responsable Production les crée
  -- lui-même, depuis le bouton de la fiche mission.
  if new.statut::text = 'livrée' then
    -- Ce qui contient de vraies photos part aux familles. La condition sur `ready` était déjà là
    -- et elle est le garde-fou : une coquille vide ne se publie jamais, même par erreur.
    update media_albums a
       set status = 'published', published_at = now()
     where a.mission_id = new.id
       and a.status = 'draft'
       and exists (select 1 from media_assets x where x.album_id = a.id and x.status = 'ready');
  end if;

  return new;
end $function$;

-- ── Retirer ce qui a déjà été créé ───────────────────────────────────────────────────────────
-- STRICTEMENT les coquilles vides issues d'une mission. Trois conditions, et les trois comptent :
--   mission_id non nul  → on ne touche à aucune galerie créée à la main (celle de Fouka avec ses
--                         110 photos de RCPF vs PSG est dans ce cas, elle ne doit pas bouger) ;
--   aucun asset         → photo_count est un compteur entretenu par un trigger ; on compte les
--                         lignes réelles, parce qu'un compteur faux effacerait de vraies photos ;
--   aucun lien          → un lien de partage déjà diffusé signifie que quelqu'un attend cette
--                         galerie, même vide pour l'instant.
delete from media_albums a
 where a.status = 'draft'
   and a.mission_id is not null
   and not exists (select 1 from media_assets s where s.album_id = a.id)
   and not exists (select 1 from media_album_links l where l.album_id = a.id);
