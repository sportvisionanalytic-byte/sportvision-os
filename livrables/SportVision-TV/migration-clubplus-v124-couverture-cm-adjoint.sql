-- « À couvrir » par le CM, le type Communication, et le coach adjoint.
--
-- Demande de Fouka, 10/09/2026 (priorité 3) : « Pour un match ou événement, le CM doit pouvoir
-- marquer : À couvrir par SportVision. Puis : Photo, Vidéo, Photo + vidéo, Communication, Autre.
-- Cette demande doit ensuite remonter dans SportVision OS. » La donnée existait déjà
-- (`coverage_wishes`, reliée aux présences de l'OS). Deux choses empêchaient le geste :
--
--   • `create_coverage_wishes` et `cancel_coverage_wish` n'acceptaient qu'un dirigeant membre du
--     club. Le CM SportVision n'est membre d'aucun club : il ne pouvait rien marquer. Il le peut
--     désormais (`peut_operer_club`) ; sa demande est tracée `cm_initiated`.
--   • le type « Communication » n'existait pas.
--
-- S'y ajoutent :
--   • `club_souhaits_couverture(club)` : les demandes en cours, pour les montrer au calendrier.
--   • le coach ADJOINT, décidé par Fouka comme un libellé, sans droit nouveau : `fonction`
--     ('principal' | 'adjoint') sur l'invitation, recopiée sur le membre à l'acceptation. Le rôle
--     reste `coach` — ses droits sont ceux d'un coach sur ses équipes, rien de plus. Limite
--     assumée : un encadrant de plusieurs équipes porte une seule fonction.

begin;

-- ── Communication ──
alter table public.coverage_wishes drop constraint coverage_wishes_requested_coverage_type_check;
alter table public.coverage_wishes add constraint coverage_wishes_requested_coverage_type_check
  check (requested_coverage_type = any (array['photo','video','photo_video','interview','communication','autre']));

-- ── Le CM marque et annule ──
CREATE OR REPLACE FUNCTION public.create_coverage_wishes(p_club_id uuid, p_items jsonb)
 RETURNS SETOF coverage_wishes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item jsonb;
  v_match_id uuid;
  v_calendar_id uuid;
  v_row coverage_wishes;
  v_client_id uuid;
  v_cm_id uuid;
  v_label text;
  v_source text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  -- 10/09/2026 — Le CM SportVision du club marque lui aussi un événement « À couvrir » : c'est
  -- son geste quotidien en Full Communication, et il n'est membre d'aucun club. Sa demande est
  -- tracée comme `cm_initiated` ; celle d'un dirigeant reste `club_request`.
  if exists (
    select 1 from club_members cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('admin', 'president', 'comm', 'directeur_sportif')
  ) then
    v_source := 'club_request';
  elsif peut_operer_club(p_club_id) then
    v_source := 'cm_initiated';
  else
    raise exception 'Non autorisé à signaler une présence souhaitée pour ce club.';
  end if;
  if not exists (
    select 1 from organization_entitlements oe
    where oe.organization_id = p_club_id and oe.module_key = 'presences' and oe.actif = true
      and (oe.expires_at is null or oe.expires_at > now())
  ) then
    raise exception 'Cette fonctionnalité n''est pas incluse dans votre offre actuelle.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_match_id := nullif(v_item->>'match_id', '')::uuid;
    v_calendar_id := nullif(v_item->>'calendar_event_id', '')::uuid;
    if (v_match_id is null) = (v_calendar_id is null) then
      raise exception 'Chaque souhait doit référencer exactement un événement (match ou calendrier).';
    end if;
    if v_match_id is not null and not exists (select 1 from club_matches where id = v_match_id and club_id = p_club_id) then
      raise exception 'Événement introuvable pour ce club.';
    end if;
    if v_calendar_id is not null and not exists (select 1 from club_calendar_events where id = v_calendar_id and club_id = p_club_id) then
      raise exception 'Événement introuvable pour ce club.';
    end if;

    -- ON CONFLICT ne peut cibler qu'UN arbitre par insert, et match_id/calendar_event_id
    -- s'excluent mutuellement (contrainte coverage_wishes_one_event) — deux branches distinctes,
    -- chacune avec l'index partiel qui la concerne réellement, plutôt qu'un double essai qui
    -- risquerait de créer une 2e ligne (exactement ce que §30/31 interdit).
    if v_match_id is not null then
      insert into coverage_wishes (club_id, match_id, calendar_event_id, requested_by_user_id, requested_coverage_type, priority, note, source)
      values (
        p_club_id, v_match_id, null, auth.uid(),
        coalesce(nullif(v_item->>'coverage_type', ''), 'photo_video'),
        coalesce(nullif(v_item->>'priority', ''), 'normale'),
        nullif(v_item->>'note', ''),
        v_source
      )
      on conflict (club_id, match_id) where status <> 'cancelled' and match_id is not null
      do update set updated_at = now()
      returning * into v_row;
    else
      insert into coverage_wishes (club_id, match_id, calendar_event_id, requested_by_user_id, requested_coverage_type, priority, note, source)
      values (
        p_club_id, null, v_calendar_id, auth.uid(),
        coalesce(nullif(v_item->>'coverage_type', ''), 'photo_video'),
        coalesce(nullif(v_item->>'priority', ''), 'normale'),
        nullif(v_item->>'note', ''),
        v_source
      )
      on conflict (club_id, calendar_event_id) where status <> 'cancelled' and calendar_event_id is not null
      do update set updated_at = now()
      returning * into v_row;
    end if;

    insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
    values ((select id from profiles where id = auth.uid()), 'coverage_wish_created', 'coverage_wish', v_row.id, jsonb_build_object('club_id', p_club_id, 'acteur_reel', auth.uid()));

    return next v_row;
  end loop;

  -- Notification groupée (§17 : une notification utile, pas une par événement) au CM principal, ou
  -- fallback Admin/Responsable CM si aucun CM principal n'est affecté (§16 : la demande n'est
  -- jamais perdue).
  select portail_client_id into v_client_id from clubs where id = p_club_id;
  if v_client_id is not null then
    select cm_id, nom into v_cm_id, v_label from clients where id = v_client_id;
  end if;
  select c.nom into v_label from clubs c where c.id = p_club_id;
  if v_cm_id is not null then
    insert into notifications (type, titre, message, destinataire_id, lue, priorite, lien_client_id)
    values ('systeme', 'Nouveau souhait de présence', v_label || ' a signalé une présence SportVision souhaitée.', v_cm_id, false, 'normale', v_client_id);
  else
    perform notify_staff_by_role(array['admin'], 'Souhait de présence sans CM principal', v_label || ' a signalé une présence souhaitée, mais aucun CM principal n''est affecté à ce club.', 'haute', null, v_client_id);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_coverage_wish(p_wish_id uuid)
 RETURNS coverage_wishes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_wish coverage_wishes;
  v_client_id uuid;
begin
  select * into v_wish from coverage_wishes where id = p_wish_id;
  if v_wish.id is null then raise exception 'Souhait introuvable.'; end if;
  if not (exists (
    select 1 from club_members cm
    where cm.club_id = v_wish.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('admin', 'president', 'comm', 'directeur_sportif')
  ) or peut_operer_club(v_wish.club_id)) then
    raise exception 'Non autorisé.';
  end if;
  if v_wish.status in ('completed', 'cancelled') then raise exception 'Ce souhait ne peut plus être annulé.'; end if;

  select portail_client_id into v_client_id from clubs where id = v_wish.club_id;

  if v_wish.status = 'selected' and v_wish.planned_presence_id is not null then
    update planned_presences set statut = 'annule' where id = v_wish.planned_presence_id and statut = 'prevu';
    if exists (select 1 from clients where id = v_client_id and cm_id is not null) then
      insert into notifications (type, titre, message, destinataire_id, lue, priorite, lien_client_id)
      select 'systeme', 'Souhait de présence annulé par le club', 'Une présence que vous aviez retenue a été annulée par le club.', cm_id, false, 'normale', v_client_id
      from clients where id = v_client_id;
    end if;
  elsif v_wish.status in ('sent_to_production', 'production_confirmed') then
    if exists (select 1 from clients where id = v_client_id and cm_id is not null) then
      insert into notifications (type, titre, message, destinataire_id, lue, priorite, lien_client_id)
      select 'systeme', 'Souhait de présence annulé — déjà envoyé Production', 'Le club a annulé un souhait déjà transmis à la Production. Vérifiez la mission associée.', cm_id, false, 'haute', v_client_id
      from clients where id = v_client_id;
    end if;
    perform notify_staff_by_role(array['prod'], 'Souhait de présence annulé — vérifier la mission', 'Un club a annulé un souhait déjà envoyé à Production.', 'haute', null, v_client_id);
  end if;

  update coverage_wishes set status = 'cancelled' where id = p_wish_id returning * into v_wish;

  insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
  values ((select id from profiles where id = auth.uid()), 'coverage_wish_cancelled', 'coverage_wish', p_wish_id, jsonb_build_object('acteur_reel', auth.uid()));

  return v_wish;
end;
$function$;

-- ── Les demandes en cours, pour le calendrier ──
create or replace function public.club_souhaits_couverture(p_club_id uuid)
returns table (id uuid, match_id uuid, calendar_event_id uuid, status text, requested_coverage_type text,
               priority text, note text, source text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not peut_lire_calendrier_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select w.id, w.match_id, w.calendar_event_id, w.status, w.requested_coverage_type,
         w.priority, w.note, w.source, w.created_at
    from coverage_wishes w
   where w.club_id = p_club_id and w.status not in ('cancelled', 'not_selected');
end;
$$;
revoke execute on function public.club_souhaits_couverture(uuid) from public, anon;
grant execute on function public.club_souhaits_couverture(uuid) to authenticated;

-- ── Le coach adjoint : un libellé ──
alter table public.club_invitations add column if not exists fonction text
  check (fonction is null or fonction in ('principal', 'adjoint'));
alter table public.club_members add column if not exists fonction text
  check (fonction is null or fonction in ('principal', 'adjoint'));
comment on column public.club_members.fonction is
  'Libellé de l''encadrant dans son équipe (coach principal ou adjoint). Aucun droit n''en dépend : les droits suivent `role` et `teams`. Décision de Fouka, 10/09/2026.';

CREATE OR REPLACE FUNCTION public.accepter_invitation_club(p_token text)
 RETURNS club_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inv club_invitations;
  v_membre club_members;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour accepter cette invitation.';
  end if;

  select * into v_inv from club_invitations where token = p_token;
  if v_inv.id is null then raise exception 'Ce lien d''invitation n''est pas valide.'; end if;
  if v_inv.statut = 'acceptee' then
    raise exception 'Cette invitation a déjà été utilisée.';
  end if;
  if v_inv.statut = 'revoquee' then
    raise exception 'Cette invitation a été annulée par le club.';
  end if;
  if v_inv.expire_at <= now() then
    raise exception 'Cette invitation a expiré. Demandez-en une nouvelle au club.';
  end if;

  -- L'adresse doit correspondre. Une invitation de coach accorde l'administration d'une équipe :
  -- un lien transféré ne doit pas suffire à la prendre. Le prix de cette rigueur est réel — un
  -- coach qui s'inscrit avec une autre adresse est refusé — d'où un message qui le dit
  -- explicitement plutôt qu'un « non autorisé » opaque.
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'Cette invitation a été envoyée à une autre adresse e-mail. Connectez-vous avec l''adresse qui l''a reçue, ou demandez au club de la renvoyer.';
  end if;

  select * into v_membre from club_members
   where club_id = v_inv.club_id and user_id = auth.uid();

  if v_membre.id is null then
    insert into club_members (user_id, club_id, role, status, prenom, nom, telephone, teams, fonction)
    values (auth.uid(), v_inv.club_id, v_inv.role, 'actif',
            v_inv.prenom, v_inv.nom, v_inv.telephone, coalesce(v_inv.teams, '[]'::jsonb), v_inv.fonction)
    returning * into v_membre;
  else
    -- Déjà membre : on ÉLARGIT, on ne remplace pas. Un coach de Seniors R2 invité sur U18 doit
    -- garder Seniors R2 (§17), et un administrateur du club invité comme coach ne doit pas
    -- perdre son rôle d'administrateur au passage.
    update club_members
       set teams = (
             select coalesce(jsonb_agg(distinct t), '[]'::jsonb)
               from (
                 select jsonb_array_elements_text(coalesce(v_membre.teams, '[]'::jsonb)) as t
                 union
                 select jsonb_array_elements_text(coalesce(v_inv.teams, '[]'::jsonb))
               ) x
           ),
           role = case when v_membre.role in ('admin', 'president') then v_membre.role else v_inv.role end,
           status = 'actif',
           fonction = coalesce(v_inv.fonction, v_membre.fonction)
     where id = v_membre.id
     returning * into v_membre;
  end if;

  update club_invitations
     set statut = 'acceptee', accepted_at = now(), accepted_by = auth.uid()
   where id = v_inv.id;

  return v_membre;
end;
$function$;

CREATE OR REPLACE FUNCTION public.equipe_apercu(p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_team club_teams;
  v_saison text;
  v_client uuid;
  v_joueurs jsonb;
  v_encadrement jsonb;
  v_prochain jsonb;
  v_entrainement jsonb;
  v_presence jsonb;
  v_inscriptions jsonb;
  v_contenus int;
  v_souhaits int;
  v_creneaux int;
  v_matchs int;
  v_alertes jsonb := '[]'::jsonb;
  n_total int; n_valides int; n_attente int; n_refus int;
  n_demandes int; n_inscrits int; n_invit_joueurs int;
begin
  select * into v_team from club_teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Équipe introuvable.';
  end if;
  if not (peut_operer_club(v_team.club_id) or is_team_educateur(p_team_id)) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select saison, portail_client_id into v_saison, v_client from clubs where id = v_team.club_id;

  -- L'effectif, avec le droit à l'image de chacun (la dernière autorisation fait foi).
  with effectif as (
    select pp.id, pp.prenom, pp.nom
      from team_memberships tm
      join player_profiles pp on pp.id = tm.player_id
     where tm.team_id = p_team_id and tm.statut = 'active'
       and (v_saison is null or tm.saison = v_saison)
  ),
  image as (
    select distinct on (pa.player_id) pa.player_id, pa.statut
      from parental_authorizations pa
      join authorization_types aty on aty.id = pa.authorization_type_id and aty.code = 'droit_image'
     where pa.player_id in (select id from effectif)
     order by pa.player_id, pa.updated_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'prenom', e.prenom, 'nom', e.nom,
           'image', case when i.statut = 'valide' then 'valide'
                         when i.statut in ('refusee', 'retiree') then 'refus'
                         when i.statut is null then 'aucune'
                         else 'en_attente' end)
           order by e.nom, e.prenom), '[]'::jsonb)
    into v_joueurs
    from effectif e left join image i on i.player_id = e.id;

  select count(*),
         count(*) filter (where j->>'image' = 'valide'),
         count(*) filter (where j->>'image' in ('en_attente', 'aucune')),
         count(*) filter (where j->>'image' = 'refus')
    into n_total, n_valides, n_attente, n_refus
    from jsonb_array_elements(v_joueurs) j;

  -- L'encadrement : les comptes, puis les invitations en cours, chacune avec son vrai statut.
  select coalesce(jsonb_agg(x order by x->>'ordre', x->>'nom'), '[]'::jsonb) into v_encadrement
    from (
      select jsonb_build_object(
               'ordre', '1', 'source', 'membre', 'id', m.id,
               'nom', coalesce(nullif(btrim(concat_ws(' ', m.prenom, m.nom)), ''), 'Encadrant'),
               'role', m.role, 'fonction', m.fonction,
               'statut', case when m.status = 'actif' then 'actif' else 'suspendu' end) as x
        from club_members m
       where m.club_id = v_team.club_id and m.teams ? v_team.name
         and m.role in ('coach', 'resp_equipe', 'directeur_sportif')
      union all
      select jsonb_build_object(
               'ordre', '2', 'source', 'invitation', 'id', ci.id,
               'nom', coalesce(nullif(btrim(concat_ws(' ', ci.prenom, ci.nom)), ''), ci.email),
               'email', ci.email, 'role', ci.role, 'fonction', ci.fonction,
               'statut', case when ci.expire_at <= now() then 'expiree'
                              when ci.statut = 'envoyee' and ci.ouverte_at is not null then 'ouverte'
                              else ci.statut end,
               'envoyee_at', ci.sent_at, 'ouverte_at', ci.ouverte_at)
        from club_invitations ci
       where ci.club_id = v_team.club_id and ci.teams ? v_team.name
         and ci.role in ('coach', 'resp_equipe', 'directeur_sportif')
         and ci.statut in ('preparee', 'envoyee')
    ) s(x);

  -- Le prochain événement qui n'est pas un entraînement, et le prochain entraînement.
  select to_jsonb(c) into v_prochain
    from club_calendrier(v_team.club_id, current_date, current_date + 60) c
   where (c.team_id = p_team_id or (c.team_id is null and c.equipe = v_team.name))
     and c.genre <> 'entrainement' and coalesce(c.statut, '') not in ('cancelled', 'annulee')
     and (c.date_evenement > current_date or c.heure_debut is null or c.heure_debut >= localtime)
   order by c.date_evenement, c.heure_debut nulls last
   limit 1;

  select jsonb_build_object('date', c.date_evenement, 'debut', to_char(c.heure_debut, 'HH24:MI'),
                            'fin', to_char(c.heure_fin, 'HH24:MI'), 'lieu', c.lieu) into v_entrainement
    from club_calendrier(v_team.club_id, current_date, current_date + 14) c
   where (c.team_id = p_team_id or (c.team_id is null and c.equipe = v_team.name))
     and c.genre = 'entrainement' and coalesce(c.statut, '') <> 'annulee'
   order by c.date_evenement, c.heure_debut
   limit 1;

  -- SportVision : la prochaine présence planifiée, et les souhaits de couverture en attente.
  select jsonb_build_object('date', pr.date_presence, 'heure', to_char(pr.heure_debut, 'HH24:MI'),
                            'type', pr.type_couverture, 'adversaire', pr.adversaire, 'lieu', pr.lieu)
    into v_presence
    from planned_presences pr
   where coalesce(pr.statut, 'prevu') <> 'annule' and pr.date_presence >= current_date
     and (exists (select 1 from club_matches m where m.id = pr.match_id
                   and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name)))
          or exists (select 1 from club_calendar_events e where e.id = pr.calendar_event_id
                      and (e.team_id = p_team_id or (e.team_id is null and e.team = v_team.name))))
   order by pr.date_presence, pr.heure_debut nulls last
   limit 1;

  select count(*) into v_souhaits
    from coverage_wishes w
   where w.club_id = v_team.club_id and w.status in ('wished', 'reviewing')
     and (exists (select 1 from club_matches m where m.id = w.match_id
                   and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name)))
          or exists (select 1 from club_calendar_events e where e.id = w.calendar_event_id
                      and (e.team_id = p_team_id or (e.team_id is null and e.team = v_team.name))));

  -- Communication : les contenus prévus rattachés à un match ou un événement de l'équipe.
  select count(*) into v_contenus
    from contenus ct
   where v_client is not null and ct.client_id = v_client
     and coalesce(ct.statut, '') not in ('publie', 'archive', 'refuse')
     and (exists (select 1 from club_matches m where m.id = ct.match_id
                   and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name)))
          or exists (select 1 from club_calendar_events e where e.id = ct.calendar_event_id
                      and (e.team_id = p_team_id or (e.team_id is null and e.team = v_team.name))));

  -- Les inscriptions par le lien et les invitations nominatives de joueurs.
  select count(*) filter (where mr.statut in ('a_verifier', 'autorisation_manquante', 'en_attente_parent', 'pret_a_valider')),
         count(*) filter (where mr.statut = 'validee'),
         coalesce(jsonb_agg(jsonb_build_object(
           'nom', nullif(btrim(concat_ws(' ', pp.prenom, pp.nom)), ''),
           'statut', mr.statut, 'source', mr.source, 'le', mr.created_at)
           order by mr.created_at desc) filter (where mr.created_at > now() - interval '60 days'), '[]'::jsonb)
    into n_demandes, n_inscrits, v_inscriptions
    from membership_requests mr
    left join player_profiles pp on pp.id = mr.player_id
   where mr.team_id = p_team_id;

  select count(*) into n_invit_joueurs from player_invitations pi
   where pi.team_id = p_team_id and pi.statut = 'envoyee';

  select count(*) into v_creneaux from club_team_training_slots s
   where s.team_id = p_team_id and (s.active_to is null or s.active_to >= current_date);
  select count(*) into v_matchs from club_matches m
   where m.club_id = v_team.club_id and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name));

  -- Les alertes, chacune avec l'endroit où elle se résout.
  if not exists (select 1 from jsonb_array_elements(v_encadrement) x where x->>'statut' in ('actif', 'preparee', 'envoyee', 'ouverte')) then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'sans_coach',
      'texte', 'Aucun encadrant rattaché ni invité', 'action', 'inviter_encadrant');
  end if;
  if n_total = 0 and v_matchs > 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'information', 'code', 'effectif',
      'texte', 'Effectif non renseigné, alors que l''équipe a ' || v_matchs || ' match' || case when v_matchs > 1 then 's' else '' end || ' au calendrier',
      'action', 'inviter_joueurs');
  end if;
  if n_total > 0 and n_valides < n_total then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'droit_image',
      'texte', (n_total - n_valides) || ' joueur' || case when n_total - n_valides > 1 then 's' else '' end || ' sans droit à l''image validé',
      'action', 'droit_image');
  end if;
  if v_creneaux = 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'creneau',
      'texte', 'Aucun créneau d''entraînement', 'action', 'creneaux');
  end if;
  if n_demandes > 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'demandes',
      'texte', n_demandes || ' demande' || case when n_demandes > 1 then 's' else '' end || ' d''inscription à valider',
      'action', 'demandes');
  end if;

  return jsonb_build_object(
    'equipe', jsonb_build_object('id', v_team.id, 'nom', v_team.name, 'categorie', v_team.categorie,
                                 'section', v_team.section, 'saison', v_saison, 'joueurs', n_total,
                                 'encadrants', (select count(*) from jsonb_array_elements(v_encadrement) x where x->>'statut' = 'actif'),
                                 'creneaux', v_creneaux),
    'prochain_evenement', v_prochain,
    'prochain_entrainement', v_entrainement,
    'droit_image', jsonb_build_object('total', n_total, 'valides', n_valides, 'en_attente', n_attente, 'refus', n_refus,
                                      'joueurs', v_joueurs),
    'communication', jsonb_build_object('contenus_prevus', v_contenus),
    'sportvision', jsonb_build_object('prochaine_presence', v_presence, 'souhaits', v_souhaits),
    'encadrement', v_encadrement,
    'inscriptions', jsonb_build_object('inscrits', n_inscrits, 'en_attente', n_demandes,
                                       'invitations_joueurs', n_invit_joueurs, 'recentes', v_inscriptions),
    'alertes', v_alertes
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.club_equipes_etat(p_club_id uuid)
 RETURNS TABLE(team_id uuid, nom text, categorie text, section text, joueurs integer, encadrant text, encadrant_statut text, creneaux integer, matchs_a_venir integer, prochain_match_date date, prochain_match_adversaire text, evenements integer, image_valides integer, image_en_attente integer, image_refus integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_saison text;
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select saison into v_saison from clubs where id = p_club_id;

  return query
  with eq as (
    select t.id, t.name, t.categorie, t.section, t.coach from club_teams t
     where t.club_id = p_club_id and not coalesce(t.archivee, false)
  ),
  effectif as (
    select tm.team_id, tm.player_id from team_memberships tm
     where tm.club_id = p_club_id and tm.statut = 'active'
       and (v_saison is null or tm.saison = v_saison)
  ),
  image as (
    select distinct on (pa.player_id) pa.player_id, pa.statut
      from parental_authorizations pa
      join authorization_types aty on aty.id = pa.authorization_type_id and aty.code = 'droit_image'
     where pa.player_id in (select player_id from effectif)
     order by pa.player_id, pa.updated_at desc
  ),
  encadrement as (
    select e.id as team_id,
           coalesce(
             (select jsonb_build_object('nom', nullif(btrim(concat_ws(' ', m.prenom, m.nom)), ''), 'statut', 'actif')
                from club_members m
               where m.club_id = p_club_id and m.status = 'actif'
                 and m.role in ('coach', 'resp_equipe', 'directeur_sportif') and m.teams ? e.name
               order by (m.role = 'coach') desc, (m.fonction = 'adjoint') nulls first limit 1),
             (select jsonb_build_object('nom', nullif(btrim(concat_ws(' ', ci.prenom, ci.nom)), ''),
                                        'statut', case ci.statut when 'envoyee' then 'invite' else 'prepare' end)
                from club_invitations ci
               where ci.club_id = p_club_id and ci.statut in ('preparee', 'envoyee')
                 and ci.expire_at > now() and ci.role in ('coach', 'resp_equipe', 'directeur_sportif') and ci.teams ? e.name
               order by (ci.statut = 'envoyee') desc limit 1),
             case when nullif(btrim(coalesce(e.coach, '')), '') is not null
                  then jsonb_build_object('nom', btrim(e.coach), 'statut', 'renseigne') end
           ) as j
      from eq e
  )
  select e.id, e.name, e.categorie, e.section,
         (select count(*)::int from effectif f where f.team_id = e.id),
         enc.j->>'nom', coalesce(enc.j->>'statut', 'aucun'),
         (select count(*)::int from club_team_training_slots s
           where s.team_id = e.id and (s.active_to is null or s.active_to >= current_date)),
         (select count(*)::int from club_matches m
           where m.club_id = p_club_id and (m.team_id = e.id or (m.team_id is null and m.team = e.name))
             and m.match_date >= current_date and coalesce(m.sport_status, 'scheduled') <> 'cancelled'),
         (select min(m.match_date) from club_matches m
           where m.club_id = p_club_id and (m.team_id = e.id or (m.team_id is null and m.team = e.name))
             and m.match_date >= current_date and coalesce(m.sport_status, 'scheduled') <> 'cancelled'),
         (select m.opponent from club_matches m
           where m.club_id = p_club_id and (m.team_id = e.id or (m.team_id is null and m.team = e.name))
             and m.match_date >= current_date and coalesce(m.sport_status, 'scheduled') <> 'cancelled'
           order by m.match_date, m.kickoff_time nulls last limit 1),
         (select count(*)::int from club_matches m
           where m.club_id = p_club_id and (m.team_id = e.id or (m.team_id is null and m.team = e.name)))
         + (select count(*)::int from club_calendar_events ce
             where ce.club_id = p_club_id and (ce.team_id = e.id or (ce.team_id is null and ce.team = e.name))),
         (select count(*)::int from effectif f join image i on i.player_id = f.player_id
           where f.team_id = e.id and i.statut = 'valide'),
         (select count(*)::int from effectif f left join image i on i.player_id = f.player_id
           where f.team_id = e.id and (i.statut is null or i.statut in ('non_transmise','en_attente','transmise','a_verifier','incomplete','expiree'))),
         (select count(*)::int from effectif f join image i on i.player_id = f.player_id
           where f.team_id = e.id and i.statut in ('refusee','retiree'))
    from eq e
    left join encadrement enc on enc.team_id = e.id
   order by e.categorie nulls last, e.name;
end;
$function$;

commit;
