-- v268 — Une journée chez un club, c'est UNE mission (25/09/2026)
--
-- « J'ai créé une mission d'une journée et ça a créé trois missions pour mon responsable
-- production. Il faut les réunir en une seule. » (Fouka)
--
-- Le regroupement comparait le LIBELLÉ du lieu. Un samedi à Fontainebleau donnait trois missions
-- — « T3 », « T1 » et « STADE PHILIPPE MAHUT 2 - FONTAINEBLEAU » — alors que ce sont trois
-- terrains du même complexe et que les sept matchs étaient à domicile.
--
-- À domicile, le terrain ne compte plus. À l'extérieur, le lieu compte toujours : on ne peut pas
-- être à Melun et à Provins le même après-midi.
--
-- Idempotente.

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
  v_cle text;
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

  -- La clé de regroupement de CETTE présence : « DOMICILE » quand le match est à domicile,
  -- sinon le lieu écrit. C'est elle qu'on compare, pas le libellé du terrain.
  select case when coalesce(m.is_home, false) then 'DOMICILE'
              else nullif(lower(btrim(v_pp.lieu)), '') end
    into v_cle
    from (select 1) x left join club_matches m on m.id = v_pp.match_id;

  -- ── Même club, même jour, même endroit : UNE mission ──
  -- Décision de Fouka du 10/09/2026, affinée le 25/09 : « j'ai créé une mission d'une journée et
  -- ça a créé trois missions pour mon responsable production, il faut les réunir en une seule ».
  --
  -- CE QUI CLOCHAIT : le regroupement comparait le LIBELLÉ du lieu. Un samedi à Fontainebleau
  -- donnait trois missions — « T3 », « T1 » et « STADE PHILIPPE MAHUT 2 - FONTAINEBLEAU » — alors
  -- que ce sont trois terrains du même complexe, et que les sept matchs étaient à domicile. Un
  -- opérateur y passe la journée, il ne fait pas trois déplacements.
  --
  -- LA RÈGLE DEVIENT DONC : à domicile, le terrain ne compte pas — c'est le même endroit. À
  -- l'extérieur, le lieu compte toujours, et il le faut : on ne peut pas être à Melun et à
  -- Provins le même après-midi.
  --
  -- Sans match rattaché ni lieu connu, on ne devine pas : mission à part.
  if v_cle is not null then
    select * into v_mission from prestations p
     where p.client_id = v_client and p.source = 'planning_mensuel_cm'
       and p.date_prestation = v_pp.date_presence
       and p.statut in ('planifiée', 'équipe_affectée')
       and coalesce((
             -- La cle de la mission candidate, calculee sur SES presences : « DOMICILE » si elles
             -- sont toutes a domicile, sinon le lieu, qui doit alors etre le meme.
             select case when bool_and(coalesce(m2.is_home, false)) then 'DOMICILE'
                         else lower(btrim(min(pp2.lieu))) end
               from planned_presences pp2
               left join club_matches m2 on m2.id = pp2.match_id
              where pp2.created_prestation_id = p.id and pp2.statut <> 'annule'
           ), lower(btrim(p.lieu))) = v_cle
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
$function$

;
