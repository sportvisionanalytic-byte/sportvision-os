-- Une mission par club, par jour et par lieu : les présences du même plateau se regroupent.
--
-- Premier usage réel, Villemomble, 10/09/2026 : le CM coche les quatre matchs U10 du samedi
-- (9 h 30, stade Claude Ripert) et les quatre U11 du dimanche. Huit présences, huit missions,
-- huit notifications à la Production — pour deux déplacements d'opérateur. Fouka : « quand je
-- coche plusieurs, faut tout regrouper ».
--
-- Règle : même club, même jour, même lieu = une seule mission, que les matchs soient cochés
-- ensemble ou un par un. La mission garde toutes ses présences (planned_presences.created_prestation_id),
-- et affiche combien de matchs elle couvre, lesquels, et à quelle heure commence le premier.
--   • un match ajouté rejoint la mission tant que l'équipe n'est pas partie (planifiée ou équipe
--     affectée) ; la Production est prévenue, et invitée à revoir l'équipe si elle est déjà prévue ;
--   • retirer un match d'une mission regroupée retire ce match, pas la mission des autres ;
--   • lieu inconnu : on ne devine pas, mission à part ; jour différent : mission à part (une
--     mission n'a qu'une date, et deux jours peuvent demander deux opérateurs).
--
-- Et les huit missions déjà créées se regroupent en deux. Les doublons sont SUPPRIMÉS plutôt
-- qu'annulés : annuler notifierait « Prestation annulée » aux comptes du club, alors qu'aucune
-- équipe n'y était affectée et qu'elles avaient vingt minutes. Trace dans audit_logs.

begin;

create or replace function public.rafraichir_mission_regroupee(p_mission uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v record;
  v_type_lib text;
begin
  select count(*) as n,
         count(*) filter (where pp.match_id is not null) as nb_matchs,
         min(pp.heure_debut) as heure,
         case when count(distinct pp.type_couverture) = 1 then min(pp.type_couverture) else 'photo_video' end as couverture,
         string_agg(nullif(pp.equipe, ''), ', ' order by pp.heure_debut nulls last, pp.equipe) as equipes,
         string_agg(concat_ws(' contre ', nullif(pp.equipe, ''), nullif(pp.adversaire, ''))
                      || coalesce(' (' || to_char(pp.heure_debut, 'HH24:MI') || ')', ''),
                    ' ; ' order by pp.heure_debut nulls last, pp.equipe) as liste
    into v
    from planned_presences pp
   where pp.created_prestation_id = p_mission and pp.statut <> 'annule';
  if v.n = 0 then
    return;
  end if;
  v_type_lib := case v.couverture when 'photo' then 'photo' when 'video' then 'vidéo' else 'photo + vidéo' end;

  perform set_config('sv.ecriture_systeme', 'regroupement_mission', true);
  update prestations
     set heure_debut = v.heure,
         couverture = v.couverture,
         equipes = v.equipes,
         description_besoin = 'Couverture ' || v_type_lib || ' — '
           || case when v.n > 1
                   then v.n || case when v.nb_matchs = v.n then ' matchs' else ' événements' end || ' au même endroit : '
                   else '' end
           || v.liste
   where id = p_mission;
  perform set_config('sv.ecriture_systeme', '', true);
end;
$$;
-- Interne : appelée par les fonctions de présence, jamais depuis l'API.
revoke execute on function public.rafraichir_mission_regroupee(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_prestation_operational_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_privileged boolean;
  is_valid_transition boolean;
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Le regroupement de missions (v133) tient à jour horaire, équipes et description de la mission
  -- commune, au nom du CM qui ajoute un match. Le marqueur n'est posé que par
  -- rafraichir_mission_regroupee (interne, non exécutable depuis l'API) et ne vit que le temps de
  -- sa mise à jour.
  if current_setting('sv.ecriture_systeme', true) = 'regroupement_mission' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','compta')
  ) into is_privileged;

  if is_privileged then
    return new;
  end if;

  if new.lieu is distinct from old.lieu
     or new.adresse_complete is distinct from old.adresse_complete
     or new.contact_sur_place is distinct from old.contact_sur_place
     or new.telephone_sur_place is distinct from old.telephone_sur_place
     or new.date_prestation is distinct from old.date_prestation
     or new.heure_debut is distinct from old.heure_debut
     or new.heure_fin is distinct from old.heure_fin
     or new.heure_rdv is distinct from old.heure_rdv
     or new.type_prestation is distinct from old.type_prestation
     or new.reference is distinct from old.reference
     or new.description_besoin is distinct from old.description_besoin
     or new.livrables_demandes is distinct from old.livrables_demandes
     or new.notes_internes is distinct from old.notes_internes
     or new.sport is distinct from old.sport
     or new.equipes is distinct from old.equipes
     or new.responsable_prod_id is distinct from old.responsable_prod_id
     or new.responsable_prestation_id is distinct from old.responsable_prestation_id
  then
    raise exception 'Modification non autorisée : le lieu, l''horaire et les informations de mission d''une prestation sont réservés au secrétariat/à la production.';
  end if;

  if new.statut is distinct from old.statut then
    is_valid_transition := (
      (old.statut = 'planifiée' and new.statut = 'équipe_affectée')
      or (old.statut = 'équipe_affectée' and new.statut = 'planifiée')
      or (old.statut = 'confirmée' and new.statut = 'équipe_en_route')
      or (old.statut = 'équipe_affectée' and new.statut = 'équipe_en_route')
      or (old.statut = 'planifiée' and new.statut = 'équipe_en_route')
      or (old.statut = 'prête' and new.statut = 'équipe_en_route')
      or (old.statut = 'prête' and new.statut = 'production_démarrée')
      or (old.statut = 'équipe_en_route' and new.statut = 'arrivée_sur_place')
      or (old.statut = 'arrivée_sur_place' and new.statut = 'production_démarrée')
      or (old.statut = 'production_démarrée' and new.statut = 'production_terminée')
      or (old.statut = 'production_terminée' and new.statut = 'médias_à_transférer')
      or (old.statut = 'médias_à_transférer' and new.statut = 'médias_complets')
    );
    if not is_valid_transition then
      raise exception 'Modification non autorisée : ce changement de statut n''est pas ouvert au collaborateur affecté (réservé au secrétariat/à la production).';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.creer_mission_depuis_presence(p_presence_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pp planned_presences;
  v_client uuid;
  v_club_nom text;
  v_discipline text;
  v_mission prestations;
  v_resp uuid;
  v_type text;
  v_libelle text;
  v_dest uuid;
begin
  select * into v_pp from planned_presences where id = p_presence_id;
  if v_pp.id is null or v_pp.statut = 'annule' then
    return null;
  end if;
  select mpp.client_id into v_client from monthly_production_plans mpp where mpp.id = v_pp.plan_id;
  select c.nom, c.discipline into v_club_nom, v_discipline from clubs c where c.portail_client_id = v_client limit 1;

  v_libelle := concat_ws(' · ', v_club_nom,
                         concat_ws(' contre ', nullif(v_pp.equipe, ''), nullif(v_pp.adversaire, '')),
                         to_char(v_pp.date_presence, 'DD/MM') || coalesce(' ' || to_char(v_pp.heure_debut, 'HH24:MI'), ''),
                         case v_pp.type_couverture when 'photo' then 'Photo' when 'video' then 'Vidéo'
                                                   when 'photo_video' then 'Photo + vidéo' end);

  -- Déjà une mission : on la tient à jour du type de couverture, et on prévient.
  if v_pp.created_prestation_id is not null then
    select * into v_mission from prestations where id = v_pp.created_prestation_id;
    if v_mission.id is not null and v_mission.couverture is distinct from v_pp.type_couverture
       and v_mission.statut not in ('annulée', 'clôturée') then
      perform rafraichir_mission_regroupee(v_mission.id);
      for v_dest in select destinataires_production(v_mission.id) loop
        insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                                   source_type, source_id, lien_prestation_id, lien_client_id, expediteur_id)
        values (v_dest, 'changement_planning_cm', 'Type de couverture modifié',
                v_libelle || ' — le CM a changé le type de couverture.', v_mission.id, 'normale',
                'prestation', v_mission.id, v_mission.id, v_client, auth.uid());
      end loop;
    end if;
    return v_pp.created_prestation_id;
  end if;

  -- ── Même club, même jour, même lieu : UNE mission (décision de Fouka, 10/09/2026) ──
  -- Un plateau U10 à 9 h 30 au même stade, c'est un opérateur, pas quatre missions. La présence
  -- rejoint la mission déjà ouverte ce jour-là à cet endroit, tant que l'équipe n'est pas partie.
  -- Sans lieu connu, on ne devine pas : mission à part.
  if nullif(btrim(v_pp.lieu), '') is not null then
    select * into v_mission from prestations p
     where p.client_id = v_client and p.source = 'planning_mensuel_cm'
       and p.date_prestation = v_pp.date_presence
       and p.statut in ('planifiée', 'équipe_affectée')
       and lower(btrim(p.lieu)) = lower(btrim(v_pp.lieu))
     order by p.created_at
     limit 1
     for update;
    if v_mission.id is not null then
      update planned_presences
         set statut = 'mission_creee', created_prestation_id = v_mission.id, updated_at = now()
       where id = v_pp.id;
      perform rafraichir_mission_regroupee(v_mission.id);
      for v_dest in select destinataires_production(v_mission.id) loop
        insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                                   source_type, source_id, lien_prestation_id, lien_client_id, expediteur_id)
        values (v_dest, 'changement_planning_cm', 'Match ajouté à une mission',
                v_libelle || ' — ajouté à ' || coalesce(v_mission.reference, 'la mission') || ' (même jour, même lieu).'
                  || case when exists (select 1 from prestations_equipe pe where pe.prestation_id = v_mission.id
                                        and pe.statut in ('invitation_envoyée', 'en_attente', 'acceptée'))
                          then ' Une équipe est déjà prévue : vérifiez qu''elle suffit, et sa rémunération.' else '' end,
                v_mission.id, 'normale', 'prestation', v_mission.id, v_mission.id, v_client, auth.uid());
      end loop;
      return v_mission.id;
    end if;
  end if;

  v_type := case when v_pp.match_id is not null then 'match'
                 when v_pp.occurrence_ref is not null then 'entrainement'
                 else 'evenement' end;
  v_resp := responsable_production_du_client(v_client);

  insert into prestations (client_id, date_prestation, heure_debut, lieu, equipes, sport,
                           type_prestation, statut, source, planned_presence_id, match_id,
                           calendar_event_id, couverture, responsable_prod_id, created_by,
                           description_besoin, notes_internes)
  values (v_client, v_pp.date_presence, v_pp.heure_debut, v_pp.lieu, v_pp.equipe, v_discipline,
          v_type, 'planifiée', 'planning_mensuel_cm', v_pp.id, v_pp.match_id,
          v_pp.calendar_event_id, v_pp.type_couverture, v_resp, auth.uid(),
          'Couverture ' || coalesce(case v_pp.type_couverture when 'photo' then 'photo' when 'video' then 'vidéo'
                                                              when 'photo_video' then 'photo + vidéo' end, '')
            || coalesce(' — ' || nullif(v_pp.equipe, ''), '') || coalesce(' contre ' || nullif(v_pp.adversaire, ''), ''),
          'Créée automatiquement le ' || to_char(now() at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI')
            || ' depuis la couverture décidée par le CM dans Club+.')
  returning * into v_mission;

  update planned_presences
     set statut = 'mission_creee', created_prestation_id = v_mission.id, updated_at = now()
   where id = v_pp.id;

  for v_dest in select destinataires_production(v_mission.id) loop
    insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                               source_type, source_id, lien_prestation_id, lien_client_id, expediteur_id)
    values (v_dest, 'nouvelle_mission', 'Nouvelle mission à affecter',
            v_libelle || ' — présence décidée par le CM, équipe à affecter.', v_mission.id, 'haute',
            'prestation', v_mission.id, v_mission.id, v_client, auth.uid());
  end loop;

  return v_mission.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cm_annuler_couverture(p_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_presence record;
  v_club uuid;
  v_mission prestations;
  v_equipe_engagee boolean := false;
  v_dest uuid;
begin
  select pp.*, mpp.client_id into v_presence
  from planned_presences pp
  join monthly_production_plans mpp on mpp.id = pp.plan_id
  where (pp.match_id::text = nullif(split_part(p_ref,':',2),'') or pp.occurrence_ref = p_ref
         or pp.calendar_event_id::text = nullif(split_part(p_ref,':',2),''))
    and pp.statut <> 'annule'
  limit 1;

  if v_presence.id is null then
    return jsonb_build_object('ok', true, 'raison', 'aucune couverture à annuler');
  end if;

  select c.id into v_club from clubs c where c.portail_client_id = v_presence.client_id;
  if not peut_planifier_presence(v_club) then
    raise exception 'Seul le CM SportVision du club décide d''une présence.' using errcode = '42501';
  end if;

  if v_presence.created_prestation_id is not null then
    select * into v_mission from prestations where id = v_presence.created_prestation_id;
    -- Mission regroupée (v133) : retirer UN match ne retire pas la mission des autres. La présence
    -- quitte la mission, la mission se met à jour, la Production est prévenue.
    if exists (select 1 from planned_presences o where o.created_prestation_id = v_mission.id
                and o.id <> v_presence.id and o.statut <> 'annule')
       and v_mission.statut not in ('annulée', 'clôturée') then
      update planned_presences set statut = 'annule', updated_at = now() where id = v_presence.id;
      perform rafraichir_mission_regroupee(v_mission.id);
      for v_dest in select destinataires_production(v_mission.id) loop
        insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                                   source_type, source_id, lien_prestation_id, lien_client_id, expediteur_id)
        values (v_dest, 'changement_planning_cm', 'Match retiré d''une mission',
                coalesce(v_mission.reference, 'La mission') || ' : le CM a retiré '
                  || coalesce(nullif(concat_ws(' contre ', nullif(v_presence.equipe, ''), nullif(v_presence.adversaire, '')), ''), 'un événement')
                  || '. La mission reste prévue pour les autres.',
                v_mission.id, 'normale', 'prestation', v_mission.id, v_mission.id, v_presence.client_id, auth.uid());
      end loop;
      return jsonb_build_object('ok', true, 'presence_id', v_presence.id, 'statut', 'annule', 'mission_conservee', v_mission.id);
    end if;
    v_equipe_engagee := v_mission.statut not in ('planifiée', 'annulée')
      or exists (select 1 from prestations_equipe pe
                  where pe.prestation_id = v_mission.id
                    and pe.statut in ('invitation_envoyée', 'en_attente', 'acceptée'));
    if v_equipe_engagee then
      raise exception 'Une équipe SportVision est déjà invitée ou affectée à cette mission. Signalez l''annulation au responsable production.'
        using errcode = '42501';
    end if;
  end if;

  update planned_presences set statut = 'annule', updated_at = now() where id = v_presence.id;

  -- La mission n'a pas encore d'équipe : le responsable production l'annule — c'est son geste.
  if v_mission.id is not null and v_mission.statut <> 'annulée' then
    for v_dest in select destinataires_production(v_mission.id) loop
      insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                                 source_type, source_id, lien_prestation_id, lien_client_id, expediteur_id)
      values (v_dest, 'changement_planning_cm', 'Couverture retirée par le CM',
              coalesce(v_mission.reference, 'La mission') || ' : le CM a retiré cette couverture. Mission à annuler.',
              v_mission.id, 'haute', 'prestation', v_mission.id, v_mission.id, v_presence.client_id, auth.uid());
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'presence_id', v_presence.id, 'statut', 'annule',
                            'mission_a_annuler', v_mission.id is not null);
end $function$;

-- ── Regrouper les missions déjà créées en double ──
do $$
declare
  g record;
  v_garde prestations;
  v_doublons uuid[];
  v_refs text;
  v_dest uuid;
  v_n int;
begin
  for g in
    select p.client_id, p.date_prestation, lower(btrim(p.lieu)) as lieu,
           array_agg(p.id order by p.created_at) as ids
      from prestations p
     where p.source = 'planning_mensuel_cm' and p.statut = 'planifiée'
       and nullif(btrim(p.lieu), '') is not null
       and not exists (select 1 from prestations_equipe pe where pe.prestation_id = p.id)
     group by 1, 2, 3
    having count(*) > 1
  loop
    select * into v_garde from prestations where id = g.ids[1];
    v_doublons := g.ids[2:];
    select string_agg(reference, ', ' order by reference) into v_refs from prestations where id = any (v_doublons);

    update planned_presences set created_prestation_id = v_garde.id, updated_at = now()
     where created_prestation_id = any (v_doublons);
    delete from notifications where prestation_id = any (v_doublons) or lien_prestation_id = any (v_doublons);
    delete from activity_log where entity_id = any (v_doublons);
    delete from prestations where id = any (v_doublons);
    perform rafraichir_mission_regroupee(v_garde.id);
    select count(*) into v_n from planned_presences where created_prestation_id = v_garde.id and statut <> 'annule';

    for v_dest in select destinataires_production(v_garde.id) loop
      insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                                 source_type, source_id, lien_prestation_id, lien_client_id)
      values (v_dest, 'changement_planning_cm', 'Missions regroupées',
              coalesce(v_garde.reference, 'La mission') || ' couvre désormais les ' || v_n || ' matchs du '
                || to_char(v_garde.date_prestation, 'DD/MM') || ' au même endroit. Doublons supprimés (aucune équipe affectée) : '
                || v_refs || '.',
              v_garde.id, 'normale', 'prestation', v_garde.id, v_garde.id, v_garde.client_id);
    end loop;
    insert into audit_logs (action, cible_type, cible_id, details)
    values ('missions_regroupees', 'prestation', v_garde.id,
            jsonb_build_object('conservee', v_garde.reference, 'supprimees', v_refs, 'presences', v_n,
                               'raison', 'même club, même jour, même lieu (v133, 10/09/2026)'));
    raise notice 'Regroupé : % garde % présences, doublons supprimés : %', v_garde.reference, v_n, v_refs;
  end loop;
end $$;

commit;
