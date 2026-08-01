-- Migration : réinitialisation de la progression et de l'XP des anciennes formations
-- remplacées ou retirées du Centre de formation SportVision.
--
-- Formations concernées :
--   - photo-sony-a7        (contenu totalement remplacé : ancienne version 3 modules
--                            devenue une formation complète 9 modules avec quiz et vidéos)
--   - photo-football, video-bases, cert-drone, cert-veo, montage-base,
--     interview-sport, cert-responsable
--                          (retirées du catalogue, remplacées à terme par des
--                           formations dédiées créées une à une)
--
-- Tout collaborateur ayant démarré ou terminé l'une de ces anciennes versions
-- voit sa progression et l'XP correspondante réinitialisées, afin que le
-- Centre de formation ne reflète que des données à jour et cohérentes avec
-- le catalogue actuel.
--
-- Ordre des opérations : on retire d'abord l'XP créditée (profiles.xp), puis
-- on supprime les enregistrements dépendants (xp_events, certifications,
-- progression détaillée) avant de supprimer les inscriptions elles-mêmes.
--
-- Idempotente : peut être exécutée plusieurs fois sans effet supplémentaire
-- une fois le nettoyage effectué (les jointures ne trouveront plus rien).
-- À exécuter dans Supabase → SQL Editor.

do $$
declare
  target_ids text[] := array[
    'photo-sony-a7','photo-football','video-bases','cert-drone',
    'cert-veo','montage-base','interview-sport','cert-responsable'
  ];
begin

  -- 1. Retirer de profiles.xp l'XP créditée par ces anciennes formations
  --    (XP de formation terminée + bonus quiz, enregistrés dans xp_events)
  update profiles p
  set xp = greatest(0, p.xp - sub.total)
  from (
    select xe.collaborateur_id, sum(xe.montant) as total
    from xp_events xe
    join formation_inscriptions fi
      on fi.id = xe.source_id and xe.source_type = 'formation_inscriptions'
    where fi.formation_id = any(target_ids)
    group by xe.collaborateur_id
  ) sub
  where p.id = sub.collaborateur_id;

  -- 2. Supprimer les événements XP liés à ces formations
  delete from xp_events xe
  using formation_inscriptions fi
  where xe.source_type = 'formation_inscriptions'
    and xe.source_id = fi.id
    and fi.formation_id = any(target_ids);

  -- 3. Supprimer les certifications obtenues via ces anciennes formations
  delete from collaborateur_certifications
  where formation_id = any(target_ids);

  -- 4. Supprimer la progression détaillée (leçons cochées)
  delete from formation_progression fp
  using formation_inscriptions fi
  where fp.inscription_id = fi.id
    and fi.formation_id = any(target_ids);

  -- 5. Supprimer les inscriptions elles-mêmes (repartent de zéro)
  delete from formation_inscriptions
  where formation_id = any(target_ids);

end $$;
