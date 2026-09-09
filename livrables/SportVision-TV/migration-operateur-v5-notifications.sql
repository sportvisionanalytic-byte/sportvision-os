-- ═══════════════════════════════════════════════════════════════════════════════
-- Notifications opérateurs / Production — vague finale du module
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Audit d'abord, comme demandé. Ce qui existe déjà et n'est PAS reconstruit :
--   • la table `notifications` (destinataire, type, titre, message, priorité, lien_prestation_id) ;
--   • le centre de notifications de l'OS (openNotifPanel / updateNavBadges) ;
--   • les préférences par catégorie (profiles.notification_prefs : rappels, taches,
--     invitations, materiel, messages) ;
--   • le cron `sportvision-rappels-prestation`, qui appelle send_prestation_reminders()
--     tous les jours à 17h.
--
-- On ÉTEND donc cette fonction plutôt que de créer un cron-v2, et on continue de lire les
-- mêmes sources que le cockpit — v_production_missions en tête. Aucun calcul parallèle : une
-- notification qui ne dirait pas la même chose que l'écran serait pire que pas de notification.

begin;

-- ── L'anti-spam, et c'est le point le plus important de la vague ─────────────
--
-- L'ancien garde-fou était « une notification de ce type par (mission, destinataire), pour
-- toujours ». Suffisant pour un rappel unique, inutilisable pour une relance quotidienne.
--
-- Une clé d'occurrence porte donc le type, la mission, la personne ET la fenêtre :
--   livraison_retard:<mission>:<user>:2026-09-12
-- Le cron relancé cinq fois dans la journée insère une seule ligne.
alter table notifications add column if not exists cle_occurrence text;

create unique index if not exists notifications_cle_occurrence_uniq
  on notifications (cle_occurrence) where cle_occurrence is not null;

comment on column notifications.cle_occurrence is
  'Clé d''idempotence : <type>:<mission>:<destinataire>:<fenêtre>. Un même rappel relancé n''insère qu''une ligne. NULL pour les notifications ponctuelles sans risque de répétition.';

-- ── Le point d'entrée unique ─────────────────────────────────────────────────
--
-- Respecte les préférences de la personne, comme le fait déjà l'interface, et ne double
-- jamais une occurrence. Renvoie true si la notification a réellement été créée.
create or replace function public.notifier(
  p_destinataire uuid,
  p_categorie text,          -- rappels | taches | invitations | materiel | messages
  p_type text,
  p_titre text,
  p_message text,
  p_prestation uuid,
  p_priorite text,
  p_cle text
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ok boolean;
begin
  if p_destinataire is null then return false; end if;

  select coalesce(prof.notification_prefs->>p_categorie, 'true') <> 'false'
    into v_ok from profiles prof where prof.id = p_destinataire;
  if not coalesce(v_ok, false) then return false; end if;

  insert into notifications (destinataire_id, type, titre, message, lien_prestation_id,
                             prestation_id, lue, priorite, source_type, source_id, cle_occurrence)
  values (p_destinataire, p_type, p_titre, p_message, p_prestation,
          p_prestation, false, p_priorite, 'prestations', p_prestation, p_cle)
  on conflict (cle_occurrence) where cle_occurrence is not null do nothing;

  return found;
end $function$;

comment on function public.notifier(uuid,text,text,text,text,uuid,text,text) is
  'Crée une notification en respectant les préférences du destinataire et sa clé d''occurrence. Point d''entrée unique — ne pas insérer dans `notifications` directement depuis un rappel.';

-- ── Qui prévenir côté Production ─────────────────────────────────────────────
-- Le responsable désigné sur la mission, à défaut les Responsables Production actifs.
create or replace function public.destinataires_production(p_prestation uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.responsable_prod_id from prestations p
   where p.id = p_prestation and p.responsable_prod_id is not null
  union
  select prof.id from profiles prof
   where prof.role = 'prod' and prof.actif
     and not exists (select 1 from prestations p2
                      where p2.id = p_prestation and p2.responsable_prod_id is not null);
$function$;

-- ── Les rappels, tous dans la fonction du cron existant ──────────────────────
--
-- Conditions de sortie : chaque bloc s'appuie sur l'état courant, donc un problème réglé
-- arrête de lui-même la relance. Mission acceptée, plus de rappel d'acceptation. Fichiers
-- sécurisés, plus de rappel de sauvegarde. Kit rendu, plus d'alerte de retour.
create or replace function public.send_prestation_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    select v.prestation_id as id, v.client_nom as client, v.livraison_en_retard,
           least(coalesce(v.deadline_photo_at,'infinity'), coalesce(v.deadline_video_at,'infinity')) as echeance,
           pe.collaborateur_id
      from v_production_missions v
      join prestations_equipe pe on pe.prestation_id = v.prestation_id and pe.statut = 'acceptée'
     where v.groupe not in ('terminees','annulees')
       and (v.deadline_photo_at is not null or v.deadline_video_at is not null)
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

end $function$;

commit;

select 'OK — rappels etendus dans le cron existant, cle d occurrence posee' as verdict;
