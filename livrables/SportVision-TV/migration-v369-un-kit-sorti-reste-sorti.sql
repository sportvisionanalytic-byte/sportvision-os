-- v369 — Un kit sorti reste sorti (30/09/2026)
--
-- LE DÉFAUT, MESURÉ AVANT D'ÉCRIRE
--
-- Les deux seuls kits de SportVision sont sortis depuis le 12 septembre, chez Antoine Blin et chez
-- Mikael Athanase Ruffine. Aucune date de retour n'a jamais été prévue, aucun retour n'a jamais été
-- enregistré, et les deux réservations sont toujours « réservé » dix-huit jours plus tard.
--
-- Test rouge passé sur la base de production, dans une transaction annulée : réserver KIT alpha 1
-- pour le samedi 3 octobre est ACCEPTÉ. Le même kit est donc promis à deux personnes, et les deux
-- l'apprendront le samedi matin, sur le terrain.
--
-- POURQUOI LA GARDE NE VOYAIT RIEN
--
-- `check_kit_reservation_overlap` compare deux intervalles. Quand une réservation n'a pas de date
-- de retour prévue, elle en invente une : `date_sortie + 1 jour`. C'est un fait fabriqué. Une
-- réservation sans retour prévu ne dure pas vingt-quatre heures — elle dure jusqu'à ce que le kit
-- revienne, et personne ne sait quand. Dès le 13 septembre, la base considérait donc ces deux kits
-- comme libres, alors qu'ils sont physiquement dans le coffre de quelqu'un.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Une réservation ACTIVE dont le retour n'est ni prévu ni enregistré occupe le kit SANS FIN, au
-- lieu d'un jour. C'est la seule lecture honnête : tant que le retour n'est pas noté, le kit est
-- dehors. La conséquence est voulue et assumée — on ne pourra plus réserver ces deux kits tant que
-- leur retour n'aura pas été enregistré. C'est exactement la question qu'il faut poser, et le
-- message la pose en nommant la personne qui a le kit.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS, DÉLIBÉRÉMENT
--
-- Elle ne clôt pas les deux réservations en cours. Un retour de matériel est un fait physique :
-- seul quelqu'un qui a le kit sous les yeux peut dire qu'il est rentré. L'inventer en SQL, c'est
-- écrire dans la base une chose que personne n'a vérifiée — et ce serait la troisième fois ce
-- mois-ci qu'une correction de données se dégrade parce qu'elle ne tenait à rien.
--
-- Elle ne touche pas non plus `kits.statut`. Cette colonne ne sert PAS à la garde (vérifié :
-- `check_kit_reservation_kit_available` ne refuse que sur endommagé / en_maintenance /
-- indisponible / en_contrôle). Elle sert à l'affichage, et elle ment aujourd'hui. C'est un défaut
-- réel mais distinct, traité côté écran.

begin;

create or replace function public.check_kit_reservation_overlap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_conflict record;
  active_statuts text[] := array['réservé','pré_réservé','sorti','en_prestation','à_récupérer','à_retourner'];
begin
  -- Ne vérifie que si la ligne entrante occupe réellement le kit
  if new.statut is null or not (new.statut::text = any(active_statuts)) then
    return new;
  end if;
  if new.kit_id is null then
    return new;
  end if;

  v_start := coalesce(new.heure_sortie, new.date_sortie);
  if v_start is null then
    return new; -- rien de comparable, on ne bloque pas
  end if;

  -- SANS RETOUR PRÉVU, LA RÉSERVATION ENTRANTE EST OUVERTE, pas d'un jour. Le « + 1 jour » d'avant
  -- inventait une fin : deux réservations sans retour prévu, à deux dates différentes, ne se
  -- voyaient jamais. Une borne inventée est pire qu'une borne absente, parce qu'elle a l'air d'un
  -- calcul.
  v_end := coalesce(new.heure_retour_prevue, new.date_retour_prevue, 'infinity'::timestamptz);

  select kr.id, kr.prestation_id, p.reference,
         coalesce(kr.heure_sortie, kr.date_sortie) as sortie,
         coalesce(kr.heure_retour_prevue, kr.date_retour_prevue) as retour_prevu,
         trim(coalesce(pr.prenom, '') || ' ' || coalesce(pr.nom, '')) as chez_qui
  into v_conflict
  from kit_reservations kr
  left join prestations p on p.id = kr.prestation_id
  left join profiles pr on pr.id = coalesce(kr.collaborateur_id, kr.responsable_id)
  where kr.kit_id = new.kit_id
    and kr.id is distinct from new.id
    and kr.statut::text = any(active_statuts)
    -- UN RETOUR ENREGISTRÉ LIBÈRE LE KIT, quoi que dise le statut de la réservation. C'est le fait
    -- physique qui tranche, pas l'étiquette.
    and kr.date_retour_effective is null
    and kr.heure_retour_reelle is null
    and coalesce(kr.heure_sortie, kr.date_sortie) < v_end
    and v_start < coalesce(kr.heure_retour_prevue, kr.date_retour_prevue, 'infinity'::timestamptz)
  order by coalesce(kr.heure_sortie, kr.date_sortie)
  limit 1;

  if found then
    -- LE MESSAGE DOIT DIRE QUOI FAIRE. « Ce kit est déjà réservé » laisse quelqu'un bloqué devant
    -- son écran un samedi matin. On nomme donc la mission, la date de sortie, la personne qui l'a,
    -- et le geste qui débloque.
    if v_conflict.retour_prevu is null then
      raise exception
        'Ce kit est sorti depuis le % et n''est pas encore rentré%. Enregistrez son retour sur la réservation de la mission % avant de le réserver à nouveau.',
        to_char(v_conflict.sortie at time zone 'Europe/Paris', 'DD/MM/YYYY'),
        case when coalesce(v_conflict.chez_qui, '') = '' then '' else ' (chez ' || v_conflict.chez_qui || ')' end,
        coalesce(v_conflict.reference, 'sans référence')
        using errcode = 'P0001';
    else
      raise exception
        'Ce kit est déjà réservé sur cette période (mission %, du % au %).',
        coalesce(v_conflict.reference, 'sans référence'),
        to_char(v_conflict.sortie at time zone 'Europe/Paris', 'DD/MM/YYYY'),
        to_char(v_conflict.retour_prevu at time zone 'Europe/Paris', 'DD/MM/YYYY')
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

commit;
