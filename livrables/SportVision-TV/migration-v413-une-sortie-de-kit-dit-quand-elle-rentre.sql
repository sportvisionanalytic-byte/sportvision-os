-- v413 — UNE SORTIE DE KIT DIT QUAND ELLE RENTRE (01/10/2026)
--
-- == L'ÉTAT MESURÉ ==============================================================================
--
-- Les deux kits de SportVision — « KIT alpha 1 » et « Kit photo bad G » — sont sortis depuis le
-- 12 septembre. Leurs deux réservations sont au statut `réservé`, sans `date_retour_prevue`, sans
-- `heure_retour_prevue`, sans retour enregistré, et leurs missions sont clôturées depuis
-- trois semaines.
--
-- Depuis la v369, une réservation sans retour prévu occupe le kit JUSQU'À `infinity`. Mesuré par le
-- chemin réel, jeton de Mikael, transaction annulée :
--
--   insert into kit_reservations (…, 'réservé', now(), now()+interval '1 day') …
--   → P0001 : « Ce kit est sorti depuis le 12/09/2026 et n'est pas encore rentré (chez Antoine
--     Blin). Enregistrez son retour sur la réservation de la mission SV-2026-0725 avant de le
--     réserver à nouveau. »
--
-- AUCUNE RÉSERVATION N'EST DONC POSSIBLE, sur aucun des deux kits, depuis la v369.
--
-- == CE QUI A CRÉÉ CES DEUX LIGNES, ET QUI RECOMMENCERA ========================================
--
-- `kitsAttribuerSubmit()` dans l'OS web est le seul écrivain de nouvelles réservations. Son
-- formulaire traite la date de retour comme FACULTATIVE :
--
--     heure_retour_prevue: document.getElementById('attr-retour')?.value || null,
--
-- Laisser ce champ vide crée donc, en un clic et sans un mot, une sortie que rien ne refermera.
-- Mesuré en transaction annulée : l'insertion passe aujourd'hui, et le kit redevient aussitôt
-- irréservable. Enregistrer le retour des deux kits ne suffira pas : la prochaine attribution
-- refera exactement le même nœud.
--
-- == LA GARDE, ET SON PÉRIMÈTRE EXACT ==========================================================
--
-- SUR L'INSERTION SEULEMENT, et c'est délibéré. `rattacher_kits_mission()` (v135) met à jour le
-- titulaire des réservations `statut <> 'retourné'` quand quelqu'un accepte ou quitte une mission :
-- une garde posée sur l'UPDATE ferait échouer cette mise à jour sur les deux lignes existantes, qui
-- n'ont justement pas de retour prévu. On ferme la porte par où le problème entre, on ne piège pas
-- les lignes déjà dedans — elles se soldent par « Enregistrer le retour », geste qui existe dans
-- l'application depuis aujourd'hui.
--
-- LE MESSAGE DIT QUOI FAIRE. C'est la règle que la v369 s'était déjà donnée : « Ce kit est déjà
-- réservé » laisse quelqu'un bloqué devant son écran un samedi matin.
--
-- CE QUE CETTE MIGRATION NE DÉCIDE PAS : rien de ce qui touche à la durée. Elle n'impose aucune
-- durée maximale, aucun défaut. Elle demande seulement qu'une sortie annonce sa fin.

create or replace function public.kit_reservation_annonce_son_retour()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_occupants text[] := array['réservé','pré_réservé','sorti','en_prestation','à_récupérer','à_retourner'];
begin
  -- Une ligne qui n'occupe pas le kit n'a rien à annoncer.
  if new.statut is null or not (new.statut::text = any(v_occupants)) then
    return new;
  end if;
  if new.kit_id is null then
    return new;
  end if;
  -- Une réservation déjà rendue à la création (reprise de données) n'occupe rien non plus.
  if new.date_retour_effective is not null or new.heure_retour_reelle is not null then
    return new;
  end if;
  -- Sans date de sortie, `check_kit_reservation_overlap` ne compare rien et n'occupe rien non plus :
  -- on reste sur la même lecture que lui, pour ne pas inventer une seconde règle d'occupation.
  if coalesce(new.heure_sortie, new.date_sortie) is null then
    return new;
  end if;

  if coalesce(new.heure_retour_prevue, new.date_retour_prevue) is null then
    raise exception
      'Indiquez la date de retour prévue : sans elle, ce kit reste occupé sans fin et plus personne ne pourra le réserver. (Il se libérera ensuite en enregistrant son retour.)'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_kit_reservation_annonce_son_retour on public.kit_reservations;
create trigger trg_kit_reservation_annonce_son_retour
  before insert on public.kit_reservations
  for each row execute function public.kit_reservation_annonce_son_retour();
