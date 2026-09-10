-- Le journal observe aussi l'organigramme du club.
--
-- Depuis le 10/09/2026, le CM note les coordonnées du président dans l'organigramme
-- (`client_organigramme`) : c'est ce qui fait passer « Informations du président » au vert sans
-- qu'il ait à inviter un président, ce que v116 lui interdit. Le journal de v117 ne regardait pas
-- cette table : la section « Responsables » aurait affiché une dernière modification fausse.
--
-- Corps de journaliser_modification_club() inchangé, une branche ajoutée ; `club_journal` sait
-- déjà afficher l'action par son détail.

begin;

CREATE OR REPLACE FUNCTION public.journaliser_modification_club()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_club uuid;
  v_section text;
  v_action text := case tg_op when 'INSERT' then 'ajout' when 'UPDATE' then 'modification' else 'suppression' end;
  v_detail text;
  r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;

  if tg_table_name = 'clubs' then
    v_club := r.id;
    if tg_op = 'UPDATE' then
      if new.logo_url is distinct from old.logo_url or new.ecusson_url is distinct from old.ecusson_url
         or new.couleur_primaire is distinct from old.couleur_primaire
         or new.couleur_secondaire is distinct from old.couleur_secondaire then
        v_section := 'branding';
      elsif new.droit_image_mode is distinct from old.droit_image_mode
         or new.droit_image_licencies_exclus is distinct from old.droit_image_licencies_exclus
         or new.droit_image_notes is distinct from old.droit_image_notes then
        v_section := 'droit_image';
      elsif new.objectifs_communication is distinct from old.objectifs_communication
         or new.ton_communication is distinct from old.ton_communication
         or new.sujets_sensibles is distinct from old.sujets_sensibles
         or new.instagram_handle is distinct from old.instagram_handle then
        v_section := 'communication';
      elsif new.nom is distinct from old.nom or new.ville is distinct from old.ville
         or new.adresse is distinct from old.adresse or new.siret is distinct from old.siret then
        v_section := 'identite';
      elsif new.lance_at is distinct from old.lance_at and new.lance_at is not null then
        v_section := 'lancement'; v_action := 'lancement';
      else
        return null;   -- crédits, abonnement, synchronisations : rien que le CM ait à lire
      end if;
    else
      return null;
    end if;
  elsif tg_table_name = 'club_teams' then
    v_club := r.club_id; v_section := 'equipes'; v_detail := r.name;
  elsif tg_table_name = 'club_team_training_slots' then
    select t.club_id, t.name into v_club, v_detail from club_teams t where t.id = r.team_id;
    v_section := 'entrainements';
  elsif tg_table_name = 'club_venues' then
    v_club := r.club_id; v_section := 'entrainements'; v_detail := r.nom;
  elsif tg_table_name = 'club_matches' then
    v_club := r.club_id; v_section := 'calendrier';
    v_detail := concat_ws(' contre ', r.team, r.opponent);
    if tg_op = 'UPDATE' then
      -- Un score saisi n'est pas une modification du calendrier : c'est un résultat.
      if new.score is distinct from old.score then
        v_action := 'resultat';
      -- La synchronisation fédérale réécrit chaque match à chaque passage (`last_synced_at`) :
      -- seul un changement visible mérite une ligne, sinon le journal se noie.
      elsif not (new.match_date is distinct from old.match_date or new.kickoff_time is distinct from old.kickoff_time
                 or new.opponent is distinct from old.opponent or new.lieu is distinct from old.lieu
                 or new.sport_status is distinct from old.sport_status or new.team is distinct from old.team
                 or new.is_home is distinct from old.is_home) then
        return null;
      end if;
    end if;
  elsif tg_table_name = 'club_calendar_events' then
    v_club := r.club_id; v_section := 'calendrier'; v_detail := r.title;
    if tg_op = 'UPDATE' and not (new.event_date is distinct from old.event_date or new.event_time is distinct from old.event_time
                                 or new.title is distinct from old.title or new.location is distinct from old.location
                                 or new.team is distinct from old.team or new.type is distinct from old.type) then
      return null;
    end if;
  elsif tg_table_name = 'club_sponsors' then
    v_club := r.club_id; v_section := 'sponsors'; v_detail := r.name;
  elsif tg_table_name = 'club_social_accounts' then
    v_club := r.club_id; v_section := 'communication';
  elsif tg_table_name = 'client_organigramme' then
    -- Les coordonnées du président et du bureau, notées par le CM (v118).
    select c.id into v_club from clubs c where c.portail_client_id = r.client_id limit 1;
    v_section := 'responsables'; v_detail := concat_ws(' ', r.prenom, r.nom);
    v_action := case when r.role ilike '%sident%' then 'contact_president' else 'contact_bureau' end;
  elsif tg_table_name = 'club_invitations' then
    v_club := r.club_id; v_section := 'responsables';
    v_detail := concat_ws(' ', r.prenom, r.nom);
    if tg_op = 'INSERT' then v_action := 'invitation_preparee';
    elsif new.statut is distinct from old.statut then
      v_action := case new.statut when 'envoyee' then 'invitation_envoyee'
                                  when 'acceptee' then 'invitation_acceptee'
                                  when 'revoquee' then 'invitation_revoquee' else 'modification' end;
    else return null;
    end if;
  else
    return null;
  end if;

  perform noter_evenement_club(v_club, v_section, v_action, v_detail);
  return null;
exception when others then
  -- Le journal observe, il ne décide pas : une erreur ici ne doit jamais faire échouer
  -- l'enregistrement d'une équipe, d'un match ou d'une invitation.
  return null;
end;
$function$;

drop trigger if exists trg_journal_club on public.client_organigramme;
create trigger trg_journal_club
  after insert or update or delete on public.client_organigramme
  for each row execute function public.journaliser_modification_club();

-- Le fil d'activité sait le dire.
CREATE OR REPLACE FUNCTION public.club_journal(p_club_id uuid, p_limite integer DEFAULT 30)
 RETURNS TABLE(quand timestamp with time zone, qui text, texte text, genre text, lien text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_client uuid;
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select portail_client_id into v_client from clubs where id = p_club_id;

  return query
  select * from (
    -- Le journal : ce qu'on a configuré, qui l'a fait.
    select ev.derniere_at,
           coalesce(nullif(btrim(concat_ws(' ', p.prenom, p.nom)), ''),
                    case when ev.auteur_id is null then 'SportVision' end, 'Un membre du club'),
           case
             when ev.action = 'lancement' then 'a lancé le club'
             when ev.action = 'invitation_preparee' then 'a préparé ' || case when ev.nb > 1 then ev.nb || ' invitations' else 'l''invitation de ' || coalesce(nullif(ev.detail, ''), 'un encadrant') end
             when ev.action = 'invitation_envoyee' then 'a envoyé ' || case when ev.nb > 1 then ev.nb || ' invitations' else 'l''invitation de ' || coalesce(nullif(ev.detail, ''), 'un encadrant') end
             when ev.action = 'invitation_acceptee' then coalesce(nullif(ev.detail, ''), 'Un encadrant') || ' a accepté son invitation'
             when ev.action = 'invitation_revoquee' then 'a annulé ' || case when ev.nb > 1 then ev.nb || ' invitations' else 'l''invitation de ' || coalesce(nullif(ev.detail, ''), 'un encadrant') end
             when ev.action = 'contact_president' then 'a noté les coordonnées du président' || coalesce(' (' || nullif(ev.detail, '') || ')', '')
             when ev.action = 'contact_bureau' then 'a mis à jour les contacts du bureau'
             when ev.action = 'resultat' then 'a renseigné ' || case when ev.nb > 1 then ev.nb || ' résultats' else 'le résultat ' || coalesce(ev.detail, '') end
             when ev.section = 'calendrier' and ev.action = 'ajout' then 'a ajouté ' || case when ev.nb > 1 then ev.nb || ' événements au calendrier' else coalesce('« ' || ev.detail || ' » au calendrier', 'un événement') end
             when ev.section = 'calendrier' then 'a modifié ' || case when ev.nb > 1 then ev.nb || ' événements du calendrier' else coalesce('« ' || ev.detail || ' »', 'le calendrier') end
             when ev.section = 'equipes' and ev.action = 'ajout' then 'a créé ' || case when ev.nb > 1 then ev.nb || ' équipes' else 'l''équipe ' || coalesce(ev.detail, '') end
             when ev.section = 'equipes' then 'a modifié ' || case when ev.nb > 1 then ev.nb || ' équipes' else 'l''équipe ' || coalesce(ev.detail, '') end
             when ev.section = 'entrainements' then 'a mis à jour les entraînements' || case when ev.nb = 1 and ev.detail is not null then ' de ' || ev.detail else '' end
             when ev.section = 'sponsors' then 'a mis à jour les sponsors'
             when ev.section = 'branding' then 'a mis à jour le branding du club'
             when ev.section = 'communication' then 'a mis à jour les informations de communication'
             when ev.section = 'droit_image' then 'a mis à jour les règles de droit à l''image'
             when ev.section = 'identite' then 'a mis à jour l''identité du club'
             else coalesce(ev.detail, ev.action)
           end,
           coalesce(ev.section, 'club'),
           case ev.section when 'calendrier' then '/calendar' when 'equipes' then '/teams'
                           when 'responsables' then '/invitations' else '/onboarding?section=' || coalesce(ev.section, 'identite') end
      from club_onboarding_events ev
      left join profiles p on p.id = ev.auteur_id
     where ev.club_id = p_club_id

    union all
    -- Les arrivées dans le club.
    select m.created_at, nullif(btrim(concat_ws(' ', m.prenom, m.nom)), ''),
           'a rejoint le club' || case when m.role = 'coach' then ' comme coach' when m.role = 'president' then ' comme président' else '' end
             || case when jsonb_array_length(coalesce(m.teams, '[]')) > 0
                     then ' (' || (select string_agg(x, ', ') from jsonb_array_elements_text(m.teams) x) || ')' else '' end,
           'membre', '/users'
      from club_members m
     where m.club_id = p_club_id and m.status = 'actif' and m.role <> 'admin'

    union all
    -- Le droit à l'image validé.
    select pa.verified_at, null::text,
           'Le droit à l''image de ' || pp.prenom || ' ' || left(pp.nom, 1) || '. a été validé',
           'droit_image', '/teams'
      from parental_authorizations pa
      join authorization_types aty on aty.id = pa.authorization_type_id and aty.code = 'droit_image'
      join player_profiles pp on pp.id = pa.player_id
     where pp.club_id = p_club_id and pa.statut = 'valide' and pa.verified_at is not null

    union all
    -- Les présences SportVision planifiées.
    select pr.created_at, 'SportVision',
           'a planifié une présence' || coalesce(' sur ' || nullif(pr.equipe, ''), '')
             || ' le ' || to_char(pr.date_presence, 'DD/MM'),
           'presence', '/presences'
      from planned_presences pr
     where coalesce(pr.statut, 'prevu') <> 'annule'
       and (exists (select 1 from club_matches m where m.id = pr.match_id and m.club_id = p_club_id)
            or exists (select 1 from club_calendar_events e where e.id = pr.calendar_event_id and e.club_id = p_club_id))

    union all
    -- Les publications.
    select c.date_publication, 'SportVision', 'a publié « ' || coalesce(c.titre, 'un contenu') || ' »',
           'publication', '/content'
      from contenus c
     where v_client is not null and c.client_id = v_client and c.statut = 'publie' and c.date_publication is not null
  ) j(quand, qui, texte, genre, lien)
  where j.quand is not null
  order by j.quand desc
  limit greatest(1, least(p_limite, 200));
end;
$function$;

commit;
