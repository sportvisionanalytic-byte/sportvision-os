-- v460 (02/10/2026) — L'échéance de livraison se pose toute seule, parce que personne ne la saisit.
--
-- MESURÉ : sur les 10 prestations de la base, `deadline_photo_at` et `deadline_video_at` sont
-- NULLES sur les 10. Elles sont LUES en quatre endroits de l'OS web et dans l'application, et
-- ÉCRITES nulle part : aucun écran, aucun tunnel, aucune fonction. Ce n'était pas un bug, c'était
-- un geste qui n'existait pas.
--
-- La v411 vient de réparer les deux boucles de rappel du retard de livraison, qui n'avaient jamais
-- pu tourner. Elles peuvent maintenant partir — mais elles ne partiront JAMAIS tant qu'aucune
-- mission n'a d'échéance. Réparer l'alerte sans poser l'échéance, c'était réparer un réveil qu'on
-- n'a pas remonté.
--
-- LE DÉLAI EST CELUI QUI EST DÉJÀ ANNONCÉ PARTOUT : 24 heures maximum, sur le site, dans les CGV
-- et dans la base depuis le 19/08/2026. On ne décide donc rien de neuf ici, on arrête simplement
-- de promettre une chose et de n'en mesurer aucune. Il est porté par une fonction, sur le modèle
-- de `seuil_ecart_remuneration()` : le changer se fait en une ligne, sans toucher à la règle.
--
-- CE QUI EST VOLONTAIREMENT PRUDENT :
--
-- · On ne remplace JAMAIS une échéance posée à la main. Le déclencheur ne remplit que du NULL.
--   Une date négociée avec un club vaut mieux que la règle générale, et elle doit survivre à une
--   modification de la mission.
-- · Une mission SANS COUVERTURE déclarée ne reçoit aucune échéance. Depuis la v240, la couverture
--   n'impose plus de livrable : lui réclamer une livraison serait lui reprocher ce qu'on ne lui a
--   pas demandé. C'est la même décision que celle prise pour `echeance_manquante` dans la v411.
-- · On pose l'échéance photo seulement si la couverture parle de photo, et la vidéo seulement si
--   elle parle de vidéo. Les 9 missions couvertes sont en `photo_video` : elles reçoivent les deux.
-- · Une mission annulée ou refusée n'en reçoit pas : on ne réclame pas la livraison de ce qui
--   n'aura pas lieu.
--
-- Le RATTRAPAGE des lignes existantes est volontairement SÉPARÉ de ce fichier, dans
-- `donnees-echeances-rattrapage-02-10.sql` : poser une échéance sur une mission de septembre la
-- rend immédiatement en retard, donc déclenche de vraies notifications à de vraies personnes. Ça
-- se mesure avant de se lancer, et ça ne se glisse pas dans une migration de structure.

create or replace function public.delai_livraison_heures()
returns integer language sql immutable
set search_path to 'public', 'pg_temp'
as $function$ select 24; $function$;

comment on function public.delai_livraison_heures() is
  'Le délai de livraison annoncé au client : 24 h après la prestation (site, CGV et base depuis le 19/08/2026). Changer la valeur ici change la règle partout.';

create or replace function public.poser_echeance_de_livraison()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_echeance timestamptz;
begin
  if new.date_prestation is null
     -- `::text` et pas un coalesce nu : `statut` est un ÉNUMÉRÉ, et la chaîne vide n'en est pas
     -- une valeur — le garde levait 22P02 au lieu de protéger. Trouvé par le test, pas après coup.
     or coalesce(new.statut::text, '') in ('annulée', 'refusée')
     or new.couverture is null then
    return new;
  end if;

  -- LE COMPTE À REBOURS PART DE LA FIN DE LA PRESTATION, pas du coup d'envoi : on ne peut pas
  -- livrer ce qu'on n'a pas encore photographié. À défaut d'heure de fin, l'heure de début ;
  -- à défaut des deux, la fin de la journée — une échéance calculée depuis minuit réclamerait la
  -- livraison avant même que le match ne soit joué.
  v_echeance := (new.date_prestation::timestamp
                 + coalesce(new.heure_fin, new.heure_debut, time '23:59'))
                at time zone 'Europe/Paris'
                + make_interval(hours => delai_livraison_heures());

  if new.deadline_photo_at is null and new.couverture ilike '%photo%' then
    new.deadline_photo_at := v_echeance;
  end if;
  if new.deadline_video_at is null and new.couverture ilike '%video%' then
    new.deadline_video_at := v_echeance;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_poser_echeance_de_livraison on public.prestations;

create trigger trg_poser_echeance_de_livraison
  before insert or update of date_prestation, heure_debut, heure_fin, couverture, statut
  on public.prestations
  for each row execute function public.poser_echeance_de_livraison();
