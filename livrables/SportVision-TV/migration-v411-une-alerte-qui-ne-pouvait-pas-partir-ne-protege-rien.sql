-- v411 — LE RETARD DE LIVRAISON NE POUVAIT PAS ÊTRE SIGNALÉ, POUR DEUX RAISONS (01/10/2026)
--
-- == CE QUI A ÉTÉ MESURÉ ========================================================================
--
-- `notifications` ne contient AUCUNE ligne de type `livraison_en_retard`, `livraison_en_retard_prod`
-- ni `echeance_proche`. Zéro, depuis l'origine. Et les dix missions de la base ont
-- `deadline_photo_at` et `deadline_video_at` NULS, les deux, sur les dix.
--
-- La première raison est connue : sans échéance, pas de retard. LA SECONDE EST PLUS GRAVE, parce
-- qu'elle resterait après avoir saisi les échéances.
--
-- == LA SECONDE RAISON : UNE BOUCLE QUI NE POUVAIT PAS TOURNER ==================================
--
-- Les boucles 7 et 8 de `send_prestation_reminders()` lisent `v_production_missions`. Cette vue se
-- termine par :
--
--     where is_staff() and pole_scope_ok(p.pole_id)
--
-- Or cette fonction est appelée par le cron `5 * * * *` (jobid 13), qui tourne en `postgres`. Pour
-- `postgres`, `is_staff()` rend FAUX. La vue rend donc 0 ligne à l'intérieur du cron, et les deux
-- boucles n'itèrent jamais. Être SECURITY DEFINER n'y change rien : le propriétaire est `postgres`
-- lui-même, et le `where` de la vue n'est pas une RLS qu'on contourne, c'est une condition écrite.
--
-- PREUVE ROUGE, en transaction annulée, telle que le cron s'exécute :
--
--     update prestations set deadline_photo_at = now() - interval '3 days' where reference='SV-2026-3121';
--     select (select count(*) from v_production_missions) as vue,
--            send_prestation_reminders() is null,
--            (select count(*) from notifications where type in ('livraison_en_retard',
--             'livraison_en_retard_prod','echeance_proche')) as apres;
--     → vue = 0, apres = 0
--
-- Les neuf autres boucles de cette fonction lisent des TABLES, et elles fonctionnent : ce sont les
-- seules deux qui passaient par une vue, et ce sont exactement celles qui portent le retard de
-- livraison. Un test vert qui ne peut pas rougir ne prouve rien ; une alerte qui ne peut pas partir
-- ne protège rien.
--
-- == LE CORRECTIF ===============================================================================
--
--  1. `mission_livraison_en_retard(uuid)` et `mission_echeance_manquante(uuid)` : la règle du
--     retard et celle de l'échéance manquante deviennent DEUX FONCTIONS, appelées par la vue ET
--     par le rappel. On ne recopie pas une règle dans une boucle.
--
--  2. AU PASSAGE, LE MUTISME DU NULL EST FERMÉ. Dans la vue, `livraison_en_retard` et
--     `echeance_manquante` s'écrivaient `couverture = any(array['photo','photo_video']) and …`.
--     Sur SV-2026-5455, `couverture` EST NULLE : l'expression entière rend NULL, pas FAUX. La vue
--     annonçait donc « échéance manquante » sur 9 missions sur 10 alors que la dixième n'a pas
--     d'échéance non plus — elle n'a simplement pas de couverture, et une comparaison avec NULL
--     est muette. Les deux fonctions rendent désormais vrai ou faux, jamais NULL.
--
--     CE QUE CE CHOIX DIT : une mission sans couverture déclarée n'attend aucun livrable (v240), on
--     ne lui reproche donc pas d'échéance. Elle n'est plus comptée dans les 9 par erreur ; ce qui
--     lui manque reste dit par `mission_cloture_manquant`.
--
--  3. La boucle 7/8 lit les tables, avec le MÊME filtre de statuts que le groupe de la vue.
--
-- == CE QUI RESTE À FOUKA =======================================================================
--
-- PERSONNE N'ÉCRIT `deadline_photo_at` NI `deadline_video_at`. Mesuré : ces deux colonnes sont lues
-- en 4 endroits de l'OS web et dans l'application, et AUCUNE fonction de la base, aucun écran, aucun
-- tunnel ne les renseigne. Il n'y a pas de bug à corriger : il manque un geste, et son délai. Le
-- délai standard annoncé partout (site, CGV) est de 24 h max depuis le 19/08 — faut-il le poser
-- automatiquement à la confirmation de la mission, ou le laisser saisir à la Production ? Cette
-- migration rend l'alerte capable de partir ; elle ne décide pas de l'échéance.

-- ── 1. La règle du retard, écrite une fois ────────────────────────────────────────────────────
create or replace function public.mission_livraison_en_retard(p_prestation_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (p.deadline_photo_at is not null
      and p.deadline_photo_at < now()
      and p.couverture in ('photo','photo_video')
      and not exists (select 1 from media_liens ml
                       where ml.prestation_id = p.id and ml.type_media = 'photo'
                         and ml.categorie = 'final' and ml.statut = 'valide'))
    or (p.deadline_video_at is not null
      and p.deadline_video_at < now()
      and p.couverture in ('video','photo_video')
      and not exists (select 1 from media_liens ml
                       where ml.prestation_id = p.id and ml.type_media = 'video'
                         and ml.categorie = 'final' and ml.statut = 'valide')),
    false)
  from prestations p where p.id = p_prestation_id;
$function$;

-- ── 2. L'échéance manquante, écrite une fois, et qui ne rend jamais NULL ──────────────────────
create or replace function public.mission_echeance_manquante(p_prestation_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  -- `p.couverture in (...)` vaut NULL quand la couverture est nulle, et `NULL or NULL` vaut NULL.
  -- Le coalesce est ce qui empêche la colonne de répondre « je ne sais pas » là où l'écran lit un
  -- booléen et comprend « non ».
  select coalesce(
    (p.couverture in ('photo','photo_video') and p.deadline_photo_at is null)
    or (p.couverture in ('video','photo_video') and p.deadline_video_at is null),
    false)
  from prestations p where p.id = p_prestation_id;
$function$;

grant execute on function public.mission_livraison_en_retard(uuid) to authenticated;
grant execute on function public.mission_echeance_manquante(uuid) to authenticated;

-- ── 3. La vue appelle les deux fonctions, et ne rend plus NULL ──────────────────────────────
create or replace view public.v_production_missions as
 SELECT p.id AS prestation_id,
    p.reference,
    p.statut,
    p.couverture,
    p.date_prestation,
    p.heure_debut,
    p.heure_rdv,
    p.lieu,
    p.pole_id,
    p.responsable_prod_id,
    p.deadline_photo_at,
    p.deadline_video_at,
    c.nom AS client_nom,
        CASE
            WHEN p.statut = ANY (ARRAY['clôturée'::statut_prestation, 'payée'::statut_prestation, 'facturée'::statut_prestation]) THEN 'terminees'::text
            WHEN p.statut = 'annulée'::statut_prestation THEN 'annulees'::text
            WHEN (EXISTS ( SELECT 1
               FROM media_liens ml
              WHERE ml.prestation_id = p.id AND ml.statut = 'correction_demandee'::text)) THEN 'corrections'::text
            WHEN p.statut = ANY (ARRAY['prêt_validation'::statut_prestation, 'à_valider_client'::statut_prestation, 'prête_à_livrer'::statut_prestation, 'livrée'::statut_prestation]) THEN 'a_verifier'::text
            WHEN p.statut = ANY (ARRAY['équipe_en_route'::statut_prestation, 'arrivée_sur_place'::statut_prestation, 'production_démarrée'::statut_prestation]) THEN 'terrain'::text
            WHEN p.statut = ANY (ARRAY['production_terminée'::statut_prestation, 'médias_à_transférer'::statut_prestation, 'médias_complets'::statut_prestation, 'à_monter'::statut_prestation, 'montage_en_cours'::statut_prestation]) THEN 'post_production'::text
            WHEN (EXISTS ( SELECT 1
               FROM prestations_equipe pe
              WHERE pe.prestation_id = p.id AND (pe.statut = ANY (ARRAY['invitation_envoyée'::statut_affectation, 'en_attente'::statut_affectation])))) THEN 'attente_acceptation'::text
            WHEN p.statut = ANY (ARRAY['demande_reçue'::statut_prestation, 'à_qualifier'::statut_prestation, 'à_valider_production'::statut_prestation, 'devis_accepté'::statut_prestation, 'documents_complets'::statut_prestation, 'confirmée'::statut_prestation, 'à_planifier'::statut_prestation]) THEN 'a_planifier'::text
            WHEN p.statut = ANY (ARRAY['planifiée'::statut_prestation, 'équipe_affectée'::statut_prestation, 'prête'::statut_prestation]) THEN 'a_venir'::text
            ELSE 'autres'::text
        END AS groupe,
    ( SELECT min(pe.created_at) AS min
           FROM prestations_equipe pe
          WHERE pe.prestation_id = p.id AND (pe.statut = ANY (ARRAY['invitation_envoyée'::statut_affectation, 'en_attente'::statut_affectation]))) AS invitation_depuis,
    ( SELECT string_agg((COALESCE(pr.prenom, ''::text) || ' '::text) || COALESCE(pr.nom, ''::text), ', '::text) AS string_agg
           FROM prestations_equipe pe
             JOIN profiles pr ON pr.id = pe.collaborateur_id
          WHERE pe.prestation_id = p.id AND pe.statut = 'acceptée'::statut_affectation) AS operateurs,
    ( SELECT max(mso.arrive_at) AS max
           FROM mission_suivi_operateur mso
          WHERE mso.prestation_id = p.id) AS arrive_at,
    ( SELECT max(mso.livre_at) AS max
           FROM mission_suivi_operateur mso
          WHERE mso.prestation_id = p.id) AS livre_at,
    ( SELECT count(*) AS count
           FROM media_liens ml
          WHERE ml.prestation_id = p.id AND ml.type_media = 'photo'::text AND ml.categorie = 'final'::text) AS nb_photos,
    ( SELECT count(*) AS count
           FROM media_liens ml
          WHERE ml.prestation_id = p.id AND ml.type_media = 'video'::text AND ml.categorie = 'final'::text) AS nb_montages,
    ( SELECT count(*) AS count
           FROM media_liens ml
          WHERE ml.prestation_id = p.id AND ml.categorie = 'rushs'::text) AS nb_rushs,
    (EXISTS ( SELECT 1
           FROM media_liens ml
          WHERE ml.prestation_id = p.id AND ml.transfert_confirme IS TRUE)) AS transfert_confirme,
    ( SELECT kt.nom
           FROM kit_reservations kr
             JOIN kits kt ON kt.id = kr.kit_id
          WHERE kr.prestation_id = p.id AND (kr.statut <> ALL (ARRAY['retourné'::statut_kit, 'en_contrôle'::statut_kit]))
         LIMIT 1) AS kit_nom,
    ( SELECT kr.date_retour_prevue
           FROM kit_reservations kr
          WHERE kr.prestation_id = p.id AND (kr.statut <> ALL (ARRAY['retourné'::statut_kit, 'en_contrôle'::statut_kit]))
         LIMIT 1) AS kit_retour_prevu,
    (EXISTS ( SELECT 1
           FROM incidents i
          WHERE i.prestation_id = p.id AND i.cloture = false)) AS incident_ouvert,
    mission_livraison_en_retard(p.id) AS livraison_en_retard,
    mission_echeance_manquante(p.id) AS echeance_manquante,
    mission_cloture_manquant(p.id) AS cloture_manquant,
    ( SELECT mp.operateur_confirme AND mp.brief_rempli AND mp.lieu_horaire_ok AND mp.kit_ok AND mp.pas_incident_ouvert
           FROM v_mission_prete mp
          WHERE mp.prestation_id = p.id) AS mission_prete
   FROM prestations p
     LEFT JOIN clients c ON c.id = p.client_id
  WHERE is_staff() AND pole_scope_ok(p.pole_id);

-- ── 4. Les boucles 7 et 8 du rappel lisent les tables, comme les neuf autres ────────────────
CREATE OR REPLACE FUNCTION public.send_prestation_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_jour text := to_char(current_date, 'YYYY-MM-DD');
begin

  -- 1. Mission proposée et toujours sans réponse, à J-3 ou moins.
  --    Une seule relance par jour et par personne ; l'invitation elle-même a déjà été
  --    annoncée ailleurs, on ne double pas le jour même de l'envoi.
  for r in
    select pe.collaborateur_id, p.id, p.reference, p.date_prestation, p.heure_debut, c.nom as client
      from prestations p
      join prestations_equipe pe on pe.prestation_id = p.id
      left join clients c on c.id = p.client_id
     where pe.statut in ('invitation_envoyée','en_attente')
       and p.statut not in ('annulée','refusée','clôturée')
       and p.date_prestation between current_date and (current_date + interval '3 days')::date
       and pe.created_at < now() - interval '12 hours'
  loop
    perform notifier(r.collaborateur_id, 'invitations', 'mission_non_acceptee',
      'Mission en attente de réponse',
      coalesce(r.client,'Mission')||coalesce(' — '||to_char(r.date_prestation,'DD/MM'),'')||
        coalesce(' à '||to_char(r.heure_debut,'HH24:MI'),'')||'. Merci de confirmer votre disponibilité.',
      r.id, 'normale', 'mission_non_acceptee:'||r.id||':'||r.collaborateur_id||':'||v_jour);

    -- Escalade : la mission approche et personne n'a répondu.
    if r.date_prestation <= (current_date + interval '2 days')::date then
      perform notifier(d, 'taches', 'mission_non_acceptee_prod',
        'Mission toujours non acceptée',
        coalesce((select coalesce(prenom,'')||' '||coalesce(nom,'') from profiles where id = r.collaborateur_id),'Un opérateur')||
          ' n''a pas encore répondu pour '||coalesce(r.client,'une mission')||'.',
        r.id, 'haute', 'mission_non_acceptee_prod:'||r.id||':'||d||':'||v_jour)
      from destinataires_production(r.id) d;
    end if;
  end loop;

  -- 2. Mission demain (comportement historique conservé, clé ajoutée).
  for r in
    select pe.collaborateur_id, p.id, p.reference, p.heure_rdv, p.heure_debut, p.lieu, c.nom as client
      from prestations p
      join prestations_equipe pe on pe.prestation_id = p.id and pe.statut = 'acceptée'
      left join clients c on c.id = p.client_id
     where p.date_prestation = (current_date + interval '1 day')::date
       and p.statut not in ('annulée','refusée','clôturée','livrée')
  loop
    perform notifier(r.collaborateur_id, 'rappels', 'rappel_prestation',
      'Mission demain — '||coalesce(r.client,'SportVision'),
      'Arrivée demandée : '||coalesce(to_char(r.heure_rdv,'HH24:MI'), to_char(r.heure_debut,'HH24:MI'), 'à confirmer')||
        coalesce(' — '||r.lieu,'')||'. Vérifiez votre kit, vos batteries, vos cartes SD et votre tenue SportVision.',
      r.id, 'faible', 'rappel_prestation:'||r.id||':'||r.collaborateur_id||':'||v_jour);
  end loop;

  -- 3. Kit à préparer — uniquement s'il y a un VRAI problème, pas en doublon du rappel ci-dessus.
  for r in
    select pe.collaborateur_id, p.id, c.nom as client
      from prestations p
      join prestations_equipe pe on pe.prestation_id = p.id and pe.statut = 'acceptée'
      left join clients c on c.id = p.client_id
     where p.date_prestation = (current_date + interval '1 day')::date
       and p.statut not in ('annulée','refusée','clôturée')
       and not exists (select 1 from kit_reservations kr where kr.prestation_id = p.id)
       and coalesce((select prof.materiel_personnel from profiles prof where prof.id = pe.collaborateur_id), '') = ''
  loop
    perform notifier(r.collaborateur_id, 'materiel', 'kit_a_preparer',
      'Kit à préparer',
      'Votre mission '||coalesce(r.client,'')||' est demain et aucun kit ne vous est attribué.',
      r.id, 'normale', 'kit_a_preparer:'||r.id||':'||r.collaborateur_id||':'||v_jour);
  end loop;

  -- 4. Arrivée non confirmée. Formulation volontairement prudente (§5) : nous ne savons pas
  --    que l'opérateur est en retard, seulement qu'il n'a pas confirmé son arrivée.
  for r in
    select p.id, c.nom as client, p.heure_rdv,
           (select string_agg(coalesce(pr.prenom,'')||' '||coalesce(pr.nom,''), ', ')
              from prestations_equipe pe join profiles pr on pr.id = pe.collaborateur_id
             where pe.prestation_id = p.id and pe.statut = 'acceptée') as ops
      from prestations p
      left join clients c on c.id = p.client_id
     where p.date_prestation = current_date
       and p.heure_rdv is not null
       and (p.date_prestation + p.heure_rdv + interval '20 minutes') < now()
       and p.statut in ('prête','équipe_affectée','équipe_en_route')
       and not exists (select 1 from mission_suivi_operateur m
                        where m.prestation_id = p.id and m.arrive_at is not null)
  loop
    perform notifier(d, 'taches', 'arrivee_non_confirmee',
      'Arrivée non confirmée',
      coalesce(r.client,'Mission')||' — arrivée prévue à '||to_char(r.heure_rdv,'HH24:MI')||
        coalesce(', opérateur : '||r.ops,'')||'.',
      r.id, 'haute', 'arrivee_non_confirmee:'||r.id||':'||d||':'||v_jour)
    from destinataires_production(r.id) d;
  end loop;

  -- 5. Prestation réalisée mais fichiers pas encore sécurisés. Notification importante.
  for r in
    select m.collaborateur_id, p.id, c.nom as client
      from mission_suivi_operateur m
      join prestations p on p.id = m.prestation_id
      left join clients c on c.id = p.client_id
     where m.prestation_terminee_at is not null
       and m.prestation_terminee_at < now() - interval '4 hours'
       and m.fichiers_securises_at is null
       and p.statut not in ('annulée','clôturée')
  loop
    perform notifier(r.collaborateur_id, 'rappels', 'fichiers_a_securiser',
      'Sécurisez vos fichiers',
      'Votre prestation '||coalesce(r.client,'')||' est terminée, mais vos fichiers ne sont pas encore déclarés sécurisés.',
      r.id, 'faible', 'fichiers_a_securiser:'||r.id||':'||r.collaborateur_id||':'||v_jour);
  end loop;

  -- 6. Livraison à faire : fichiers sécurisés, livrables encore manquants. Le message dit ce
  --    qui manque, en s'appuyant sur la même règle que la clôture.
  for r in
    select m.collaborateur_id, p.id, c.nom as client, mission_cloture_manquant(p.id) as manque
      from mission_suivi_operateur m
      join prestations p on p.id = m.prestation_id
      left join clients c on c.id = p.client_id
     where m.fichiers_securises_at is not null
       and m.fichiers_securises_at < now() - interval '20 hours'
       and m.livre_at is null
       and p.statut not in ('annulée','clôturée')
  loop
    if array_length(r.manque, 1) is not null then
      perform notifier(r.collaborateur_id, 'rappels', 'livraison_a_faire',
        'Livraison à terminer',
        coalesce(r.client,'Mission')||' — il reste : '||array_to_string(r.manque, ', ')||'.',
        r.id, 'normale', 'livraison_a_faire:'||r.id||':'||r.collaborateur_id||':'||v_jour);
    end if;
  end loop;

  -- 7. Échéance approchante, et 8. échéance dépassée. Uniquement sur une VRAIE date : aucune
  --    échéance ne déclenche jamais ni rappel ni retard.
  for r in
    -- v411 : ON NE LIT PLUS `v_production_missions` ICI. Cette vue se ferme sur
    --   `where is_staff() and pole_scope_ok(...)`, et ce cron tourne en `postgres`, pour qui
    --   `is_staff()` est FAUX : la boucle ne tournait jamais, meme avec une echeance depassee.
    --   Mesure en transaction annulee : echeance posee a J-3 sur une mission vivante, la vue rend
    --   0 ligne au cron et 0 notification part. Les trois types `livraison_en_retard`,
    --   `livraison_en_retard_prod` et `echeance_proche` nexistent dans aucune notification depuis
    --   l'origine. On lit donc les tables, comme les neuf autres boucles de cette fonction.
    --   LE FILTRE EST LE MEME, mot pour mot : groupe `terminees` = statut clôturée/payée/facturée,
    --   groupe `annulees` = annulée.
    --   LA REGLE DU RETARD, ELLE, N'EST PAS RECOPIEE : `mission_livraison_en_retard()` la porte, et
    --   la vue appelle la meme fonction.
    select p.id as id, c.nom as client, mission_livraison_en_retard(p.id) as livraison_en_retard,
           least(coalesce(p.deadline_photo_at,'infinity'), coalesce(p.deadline_video_at,'infinity')) as echeance,
           pe.collaborateur_id
      from prestations p
      left join clients c on c.id = p.client_id
      join prestations_equipe pe on pe.prestation_id = p.id and pe.statut = 'acceptée'
     where p.statut not in ('clôturée','payée','facturée','annulée')
       and (p.deadline_photo_at is not null or p.deadline_video_at is not null)
  loop
    if r.livraison_en_retard then
      perform notifier(r.collaborateur_id, 'rappels', 'livraison_en_retard',
        'Livraison en retard',
        coalesce(r.client,'Mission')||' — la livraison était attendue le '||to_char(r.echeance,'DD/MM à HH24:MI')||'.',
        r.id, 'normale', 'livraison_en_retard:'||r.id||':'||r.collaborateur_id||':'||v_jour);

      perform notifier(d, 'taches', 'livraison_en_retard_prod',
        'Livraison en retard',
        coalesce(r.client,'Mission')||coalesce(' — opérateur : '||(select coalesce(prenom,'')||' '||coalesce(nom,'') from profiles where id = r.collaborateur_id),'')||'.',
        r.id, 'normale', 'livraison_en_retard_prod:'||r.id||':'||d||':'||v_jour)
      from destinataires_production(r.id) d;

    elsif r.echeance < now() + interval '24 hours' then
      perform notifier(r.collaborateur_id, 'rappels', 'echeance_proche',
        'Livraison prévue le '||to_char(r.echeance,'DD/MM à HH24:MI'),
        coalesce(r.client,'Mission')||' — pensez à finaliser votre livraison.',
        r.id, 'faible', 'echeance_proche:'||r.id||':'||r.collaborateur_id||':'||v_jour);
    end if;
  end loop;

  -- 9. Kit à rendre aujourd'hui, et 10. kit non restitué. Une conservation autorisée (retour
  --    prévu plus tard) ne déclenche évidemment rien.
  for r in
    select kr.collaborateur_id, kr.prestation_id as id, kt.nom as kit,
           kr.date_retour_prevue, kr.lieu_retour, c.nom as client
      from kit_reservations kr
      join kits kt on kt.id = kr.kit_id
      left join prestations p on p.id = kr.prestation_id
      left join clients c on c.id = p.client_id
     where kr.statut not in ('retourné','en_contrôle','disponible')
       and kr.date_retour_prevue is not null
       and kr.date_retour_prevue < now() + interval '12 hours'
  loop
    if r.date_retour_prevue < now() then
      perform notifier(r.collaborateur_id, 'materiel', 'kit_retour_attendu',
        'Retour de kit en attente',
        r.kit||' — retour prévu le '||to_char(r.date_retour_prevue,'DD/MM à HH24:MI')||'.',
        r.id, 'normale', 'kit_retour_attendu:'||coalesce(r.id::text,r.kit)||':'||r.collaborateur_id||':'||v_jour);

      perform notifier(d, 'materiel', 'kit_non_restitue',
        'Kit non restitué',
        r.kit||coalesce(' — '||(select coalesce(prenom,'')||' '||coalesce(nom,'') from profiles where id = r.collaborateur_id),'')||'.',
        r.id, 'normale', 'kit_non_restitue:'||coalesce(r.id::text,r.kit)||':'||d||':'||v_jour)
      from destinataires_production(r.id) d;
    else
      perform notifier(r.collaborateur_id, 'materiel', 'kit_a_restituer',
        'Kit à restituer',
        r.kit||' — retour prévu le '||to_char(r.date_retour_prevue,'DD/MM à HH24:MI')||
          coalesce(', '||r.lieu_retour,'')||'.',
        r.id, 'faible', 'kit_a_restituer:'||coalesce(r.id::text,r.kit)||':'||r.collaborateur_id||':'||v_jour);
    end if;
  end loop;

end $function$
;
