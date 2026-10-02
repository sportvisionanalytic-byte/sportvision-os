-- v461 (02/10/2026) — Une livraison faite ne doit pas être signalée en retard.
--
-- La v411 a réparé les deux boucles du retard de livraison, qui n'avaient jamais pu tourner. La
-- v460 vient de poser les échéances qui leur manquaient. Reste à vérifier que la première alerte
-- envoyée dise vrai — sinon on apprend aux gens à ne plus les lire.
--
-- MESURÉ, échéances posées, en transaction annulée : SV-2026-3843 est déclarée EN RETARD sur la
-- photo. Or elle porte DOUZE liens photo valides. Ils sont en catégorie `livraison`, et la règle
-- ne regardait que `final`.
--
-- Les deux catégories servent réellement à livrer, c'est mesuré sur l'ensemble des liens :
--
--     livraison / photo / valide   x12        final / photo / valide   x7
--     livraison / photo / a_verifier x2       final / video / valide   x3
--     livraison / video / a_verifier x1       ...
--
-- et la contrainte de la table autorise les deux (`final`, `livraison`), à côté des catégories
-- intermédiaires `depot`, `rushs`, `travail`, `previsualisation`, `bibliotheque` — qui, elles, ne
-- sont pas des livraisons et restent exclues.
--
-- Ce n'est donc pas un assouplissement : la règle regardait une seule des deux cases dans
-- lesquelles on livre pour de vrai. Un opérateur qui a livré douze liens validés recevait
-- « livraison en retard », et son responsable aussi.

create or replace function public.mission_livraison_en_retard(p_prestation_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    -- UNE MISSION TERMINEE NE SE RECLAME PLUS. Trouve en verifiant la correction ci-dessous :
    -- SV-2026-3122 est CLOTUREE et restait signalee en retard faute de lien video valide. Cloturer,
    -- c'est justement l'acte qui dit que l'affaire est reglee — la Production l'a regardee et l'a
    -- fermee. Continuer a reclamer apres ca, c'est reclamer a quelqu'un qui a deja repondu.
    -- Annulee et refusee pour la meme raison : on ne reclame pas la livraison de ce qui n'a pas eu
    -- lieu.
    p.statut::text not in ('cloturee','clôturée','annulée','refusée') and (
    (p.deadline_photo_at is not null
      and p.deadline_photo_at < now()
      and p.couverture in ('photo','photo_video')
      and not exists (select 1 from media_liens ml
                       where ml.prestation_id = p.id and ml.type_media = 'photo'
                         and ml.categorie in ('final','livraison') and ml.statut = 'valide'))
    or (p.deadline_video_at is not null
      and p.deadline_video_at < now()
      and p.couverture in ('video','photo_video')
      and not exists (select 1 from media_liens ml
                       where ml.prestation_id = p.id and ml.type_media = 'video'
                         and ml.categorie in ('final','livraison') and ml.statut = 'valide'))),
    false)
  from prestations p where p.id = p_prestation_id;
$function$;
