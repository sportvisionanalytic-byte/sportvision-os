-- v470 (02/10/2026) — Deux stades le même jour font deux missions.
--
-- Fouka : « j'ai créé deux missions à Villemomble, un photographe à Mimoun et un à Claude Ripert,
-- mais ça n'a créé qu'une seule prestation. Mon responsable production ne voit qu'une mission. »
--
-- MESURÉ : 8 présences du 03/10, 6 au Stade Claude Ripert et 2 au Stade Alain Mimoun, toutes
-- rattachées à la MÊME prestation. Même chose le 26/09, déjà, sans que personne ne l'ait vu.
--
-- LA CAUSE EST UNE RÈGLE JUSTE, APPLIQUÉE TROP LARGEMENT. Le 25/09, la règle est devenue : « à
-- domicile, le terrain ne compte pas », parce qu'à Fontainebleau les terrains Mahut 1, 2 et 3 sont
-- le même complexe et qu'un opérateur y passe la journée sans se déplacer. Mais Villemomble a DEUX
-- stades distincts, Alain Mimoun et Claude Ripert, et « à domicile » les confondait.
--
-- LA RÈGLE DEVIENT : à domicile, ce n'est pas le TERRAIN qui compte, c'est le SITE. Deux terrains
-- du même stade, une mission. Deux stades, deux missions.
--
-- COMMENT ON RECONNAÎT UN SITE, et pourquoi pas une comparaison de chaînes : les libellés sont
-- écrits à la main et sales. Mesuré dans la base : « Stade Claude Ripert Villemomble », « STADE
-- CLAUDE RIPERT - VILLEMOMBLE », « Stade Alain Mimoun », « Stade Alain Mimoun Villemomble »…
-- Comparer les libellés ferait quatre missions au lieu de deux. On extrait donc les mots qui
-- DISTINGUENT : on retire les mots passe-partout (stade, parc, complexe, terrain…), le numéro de
-- terrain, et le nom de la ville du club, puis on trie ce qui reste. « Mahut 1 » et « Mahut 3 »
-- donnent tous les deux « mahut philippe » ; Ripert et Mimoun restent distincts.
--
-- LE CAS QUI M'AURAIT FAIT CASSER FONTAINEBLEAU : « T1 » et « T3 » ne nomment aucun stade, et le
-- 26/09 ils cohabitaient avec des présences au Mahut. Une clé naïve aurait fait deux missions là
-- où Fouka en voulait une. Un lieu qui ne nomme pas de site est donc traité comme COMPATIBLE avec
-- n'importe quel site déjà présent ce jour-là : il rejoint la mission existante au lieu d'en
-- ouvrir une. Vérifié sur les cinq journées réelles de Fontainebleau : aucune ne se scinde.

create or replace function public.site_de_couverture(p_lieu text, p_ville text default null)
returns text language sql immutable
set search_path to 'public', 'pg_temp'
as $function$
  with mots as (
    select unnest(string_to_array(
      btrim(regexp_replace(lower(unaccent(coalesce(p_lieu, ''))), '[^a-z0-9]+', ' ', 'g')), ' ')) as m
  ), utiles as (
    select m from mots
     where length(m) > 2
       and m not in ('stade','stades','parc','parcs','des','du','de','la','le','les','sport','sports',
                     'sportif','sportive','complexe','municipal','municipaux','omnisports','terrain',
                     'terrains','jeux','plaine','city','foot','football','annexe','synthetique','honneur')
       and m !~ '^[0-9]+$'
       and m !~ '^t[0-9]+$'
       and (p_ville is null or m <> lower(unaccent(p_ville)))
  )
  select nullif(string_agg(m, ' ' order by m), '') from utiles;
$function$;

comment on function public.site_de_couverture(text, text) is
  'Le SITE d''une couverture, pas le terrain : les mots qui distinguent un stade, une fois retirés les mots passe-partout, les numéros de terrain et la ville du club. NULL quand le lieu ne nomme aucun stade (« T1 », vide) — ce cas est alors compatible avec n''importe quel site.';

-- Correction après mesure : `clubs.ville` est NULLE pour SF Villemomble, si bien que
-- « Stade Alain Mimoun » et « Stade Alain Mimoun Villemomble » donnaient deux clés différentes —
-- donc deux missions pour le MÊME stade, l'inverse de ce qu'on cherche. On ne dépend donc plus
-- d'un seul champ : on retire les mots de la ville ET ceux du nom du club.

-- `drop` avant `create` : renommer un parametre est refuse par PostgreSQL (42P13), et la
-- premiere version de ce fichier l'appelait `p_ville`.
drop function if exists public.site_de_couverture(text, text);

create or replace function public.site_de_couverture(p_lieu text, p_contexte text default null)
returns text language sql immutable
set search_path to 'public', 'pg_temp'
as $function$
  with ignores as (
    select unnest(string_to_array(
      btrim(regexp_replace(lower(unaccent(coalesce(p_contexte, ''))), '[^a-z0-9]+', ' ', 'g')), ' ')) as m
  ), mots as (
    select unnest(string_to_array(
      btrim(regexp_replace(lower(unaccent(coalesce(p_lieu, ''))), '[^a-z0-9]+', ' ', 'g')), ' ')) as m
  ), utiles as (
    select m from mots
     where length(m) > 2
       and m not in ('stade','stades','parc','parcs','des','du','de','la','le','les','sport','sports',
                     'sportif','sportive','complexe','municipal','municipaux','omnisports','terrain',
                     'terrains','jeux','plaine','city','foot','football','annexe','synthetique','honneur')
       and m !~ '^[0-9]+$'
       and m !~ '^t[0-9]+$'
       and m not in (select i.m from ignores i where length(i.m) > 2)
  )
  select nullif(string_agg(distinct m, ' ' order by m), '') from utiles;
$function$;

-- Donnée manquante, comblée au passage : sans elle, aucune règle fondée sur la ville ne peut
-- fonctionner pour ce club.
update public.clubs set ville = 'Villemomble' where nom = 'SF Villemomble' and ville is null;

-- ── La règle de regroupement elle-même ─────────────────────────────────────────────────────
-- Seule la clé change : elle compare désormais des SITES et non des libellés. Une présence dont
-- le lieu ne nomme aucun stade porte la clé « * » et rejoint n'importe quelle mission du jour,
-- ce qui préserve la décision du 25/09 pour Fontainebleau (T1 et T3 avec le Mahut).

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
  -- v470 (02/10/2026) : la cle est le SITE, pas le terrain ni le libelle. Voir la migration.
  select public.site_de_couverture(v_pp.lieu, coalesce(c.ville, '') || ' ' || coalesce(c.nom, ''))
    into v_cle
    from (select 1) x
    left join clubs c on c.portail_client_id = v_client;
  if v_cle is null then
    -- Le lieu ne nomme aucun stade (« T1 », vide). On ne cree pas un site fantome : a domicile il
    -- rejoindra n'importe quelle mission du jour, a l'exterieur on retombe sur le libelle.
    select case when coalesce(m.is_home, false) then null
                else nullif(lower(btrim(v_pp.lieu)), '') end
      into v_cle
      from (select 1) x left join club_matches m on m.id = v_pp.match_id;
    if v_cle is null then v_cle := '*'; end if;   -- « compatible avec tout site »
  end if;

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
       -- Les SITES deja couverts par la mission candidate. Une presence sans site nomme (« * »)
       -- est compatible avec n'importe quelle mission du jour ; une presence qui nomme un site ne
       -- rejoint que les missions dont tous les sites nommes sont le meme.
       and (
         v_cle = '*'
         or coalesce((
              select array_agg(distinct s) from (
                select public.site_de_couverture(pp2.lieu, coalesce(c2.ville,'') || ' ' || coalesce(c2.nom,'')) as s
                  from planned_presences pp2
                  left join clubs c2 on c2.portail_client_id = p.client_id
                 where pp2.created_prestation_id = p.id and pp2.statut <> 'annule'
              ) q where s is not null
            ), '{}'::text[]) <@ array[v_cle]
       )
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
