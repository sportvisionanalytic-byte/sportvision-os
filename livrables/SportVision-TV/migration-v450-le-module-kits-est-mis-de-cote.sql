-- v450 (02/10/2026) — Le module des kits est mis de cote, pas supprime.
--
-- Fouka : « pour le moment on retire les trucs de kit, les kits attribues tout ca, je vais les
-- refaire bien plus tard ». Tout est donc ETEINT et rien n'est detruit : les 2 kits, les
-- 6 materiels et les 2 reservations restent en base, intacts.
--
-- CE QUE CETTE MIGRATION FAIT, ET POURQUOI CHAQUE POINT COMPTE :
--
-- 1. `kits_actifs()` rend false. C'est l'unique interrupteur cote base, jumeau de `KITS_ACTIFS`
--    dans l'application et dans l'OS web. Le rallumage est un `create or replace` d'une ligne.
--
-- 2. Les deux boucles de rappel liees aux kits ne partent plus (« Kit a preparer », « Retour de
--    kit en attente » / « Kit non restitue » / « Kit a restituer »). On ajoute une condition a
--    leur `where` plutot que de les retirer : la fonction en compte onze, et une boucle enlevee
--    puis remise de memoire est une boucle qu'on reecrit mal. La phrase « Verifiez votre kit, vos
--    batteries, vos cartes SD » du rappel de la veille RESTE : c'est un conseil de preparation,
--    pas une reclamation de module.
--
-- 3. `trg_rattacher_kits_mission` est RETIRE de `prestations_equipe`. C'est le point le plus
--    important, et il n'a rien de cosmetique : ce declencheur se posait sur
--    `AFTER INSERT OR UPDATE OF statut, collaborateur_id`, c'est-a-dire qu'il s'executait A CHAQUE
--    ACCEPTATION DE MISSION. Tant qu'il existe, une garde de kit qui leve (v369 « ce kit est sorti
--    depuis le 12/09 », v413 « une sortie de kit dit quand elle rentre ») fait echouer
--    l'acceptation d'une mission — le geste le plus irreversible de l'OS — pour une raison
--    totalement etrangere a la mission. Le laisser en place en eteignant les ecrans aurait
--    conserve exactement le risque qu'on voulait retirer.
--
-- CE QU'ON NE FAIT PAS, DELIBEREMENT : on ne marque pas les deux reservations « retournees ».
-- Elles ne le sont pas. Ecrire qu'un kit est rentre alors que personne ne l'a vu rentrer, c'est
-- fabriquer une fausse trace sur du materiel qui vaut de l'argent. Elles restent telles quelles,
-- et plus aucun ecran ne s'en sert.
--
-- POUR RALLUMER LE MODULE : `kits_actifs()` rend true, `KITS_ACTIFS = true` dans
-- `SportVision-OS-App/src/lib/modules.ts` et dans `SportVision-OS-Full.html`, les lignes de menu
-- marquees « 02/10/2026 » se decommentent, et il faut RELIRE le chemin d'acceptation d'une mission
-- avant de recreer `trg_rattacher_kits_mission`.

create or replace function public.kits_actifs()
returns boolean language sql immutable
set search_path to 'public', 'pg_temp'
as $$ select false $$;

comment on function public.kits_actifs() is
  'Interrupteur du module kits (02/10/2026 : eteint, a reprendre plus tard). Rendre true le rallume cote base ; voir v450 pour le reste.';

drop trigger if exists trg_rattacher_kits_mission on public.prestations_equipe;

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
       -- v450 (02/10/2026) : module kits mis de cote. Reclamer un kit dans un module qu'on ne
       -- tient plus, c'est envoyer quelqu'un vers un ecran retire du menu.
       and public.kits_actifs()
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
       and public.kits_actifs()  -- v450 : idem, module mis de cote
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
