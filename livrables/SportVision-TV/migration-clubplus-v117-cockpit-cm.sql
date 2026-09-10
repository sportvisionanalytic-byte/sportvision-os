-- Le cockpit du CM : ce qui demande une action, l'état réel du club, qui a modifié quoi, et le
-- lancement du club sous le contrôle du CM.
--
-- Demande de Fouka, 10/09/2026 : « Un CM doit pouvoir recevoir un nouveau club et se dire : je
-- peux préparer entièrement ce club, inviter tout le monde et gérer ensuite son activité sans
-- avoir besoin de passer par le président à chaque étape. »
--
-- ── Ce qui a été mesuré avant d'écrire ──
--   • Le journal `club_onboarding_events` existe, est lu par le tableau de bord du CM… et reste
--     VIDE : rien n'y écrit. « Activité récente » affichait donc toujours « Rien ne s'est encore
--     passé », et « qui a modifié cette section » n'avait aucune réponse possible.
--   • « Responsables » se cochait dès qu'un seul membre actif existait — le compte Owner suffisait,
--     sans qu'aucun président soit connu.
--   • Aucun statut ne distinguait un club en préparation d'un club lancé.
--
-- ── Ce que pose ce fichier ──
--   1. Le journal s'alimente seul, par déclencheur, avec l'auteur réel (`auth.uid()`). Les
--      écritures en rafale (425 matchs importés) se regroupent en une ligne. Un déclencheur de
--      journal ne bloque JAMAIS l'écriture métier qu'il observe.
--   2. `club_journal()` : le fil d'activité lisible — le journal, plus les faits déjà datés
--      ailleurs (autorisations validées, présences planifiées, publications, arrivées).
--   3. `club_equipes_etat()` : pour chaque équipe, effectif, encadrement, créneaux, calendrier,
--      droit à l'image. Une seule source pour le tableau de bord, l'onboarding et Équipes.
--   4. `club_sante()` : « Club opérationnel : X % » et les problèmes, chacun actionnable.
--   5. `club_onboarding_sections()` : les 9 sections, obligatoires ou non, terminé / incomplet /
--      attention, dernière modification et son auteur.
--   6. Le lancement : `clubs.lance_at`, `club_statut_lancement()`, `lancer_club()`. Le club reste
--      EN PRÉPARATION tant que le CM ne le lance pas ; rien ne part avant.
--   7. `cm_tableau_de_bord()` gagne ce qui manquait aux « Actions à traiter » et au mois Full
--      Communication. Ses clés existantes sont conservées (test calendrier-unifie).
--
-- Accès : partout `peut_operer_club` — l'Owner, le président et le CM affecté. Rien de nouveau à
-- ce sujet ; le chantier Permissions CM / Club V1 est clos et n'est pas rouvert ici.

begin;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Le journal
-- ════════════════════════════════════════════════════════════════════════════════════════════

alter table public.club_onboarding_events
  add column if not exists section text,
  add column if not exists nb integer not null default 1,
  add column if not exists derniere_at timestamptz not null default now();

create index if not exists club_onboarding_events_club_derniere
  on public.club_onboarding_events (club_id, derniere_at desc);

create or replace function public.noter_evenement_club(
  p_club_id uuid, p_section text, p_action text, p_detail text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_auteur uuid := auth.uid();
  v_id uuid;
begin
  if p_club_id is null then return; end if;
  -- Même auteur, même geste, même section, dans les 20 dernières minutes : on regroupe.
  -- C'est ce qui fait qu'un import de 425 matchs donne UNE ligne « 425 matchs ajoutés ».
  select id into v_id
    from club_onboarding_events
   where club_id = p_club_id
     and section is not distinct from p_section
     and action = p_action
     and auteur_id is not distinct from v_auteur
     and derniere_at > now() - interval '20 minutes'
   order by derniere_at desc
   limit 1;

  if v_id is not null then
    update club_onboarding_events set nb = nb + 1, derniere_at = now() where id = v_id;
  else
    insert into club_onboarding_events (club_id, auteur_id, action, detail, section, nb, derniere_at)
    values (p_club_id, v_auteur, p_action, p_detail, p_section, 1, now());
  end if;
end;
$$;

revoke execute on function public.noter_evenement_club(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.journaliser_modification_club()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
$$;

do $$
declare t text;
begin
  foreach t in array array['club_teams','club_team_training_slots','club_venues','club_matches',
                           'club_calendar_events','club_sponsors','club_social_accounts','club_invitations'] loop
    execute format('drop trigger if exists trg_journal_club on public.%I', t);
    execute format('create trigger trg_journal_club after insert or update or delete on public.%I
                    for each row execute function public.journaliser_modification_club()', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 2. Le lancement (colonnes d'abord : le déclencheur de `clubs` les lit)
-- ════════════════════════════════════════════════════════════════════════════════════════════

alter table public.clubs
  add column if not exists lance_at timestamptz,
  add column if not exists lance_par uuid references auth.users(id) on delete set null;

comment on column public.clubs.lance_at is
  'Moment où le CM (ou l''Owner, ou le président) a lancé le club. Nul : le club est en préparation, aucune invitation ne part en masse. Ne s''écrit que par lancer_club().';

drop trigger if exists trg_journal_club on public.clubs;
create trigger trg_journal_club
  after update on public.clubs
  for each row execute function public.journaliser_modification_club();

create or replace function public.proteger_lancement_club()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.lance_at is not distinct from old.lance_at and new.lance_par is not distinct from old.lance_par then
    return new;
  end if;
  if auth.role() = 'service_role'
     or coalesce(current_setting('app.lancement_club', true), '') = 'on'
     or exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    return new;
  end if;
  raise exception 'Le lancement du club passe par « Lancer le club », qui vérifie d''abord que la configuration obligatoire est complète.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_proteger_lancement_club on public.clubs;
create trigger trg_proteger_lancement_club
  before update of lance_at, lance_par on public.clubs
  for each row execute function public.proteger_lancement_club();

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 3. L'état de chaque équipe
-- ════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.club_equipes_etat(p_club_id uuid)
returns table (
  team_id uuid, nom text, categorie text,
  joueurs integer,
  encadrant text, encadrant_statut text,
  creneaux integer,
  matchs_a_venir integer, prochain_match_date date, prochain_match_adversaire text,
  evenements integer,
  image_valides integer, image_en_attente integer, image_refus integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_saison text;
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select saison into v_saison from clubs where id = p_club_id;

  return query
  with eq as (
    select t.id, t.name, t.categorie, t.coach from club_teams t
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
  -- L'encadrant le plus avancé : un membre actif l'emporte sur une invitation, une invitation
  -- envoyée sur une invitation seulement préparée, et tout cela sur le simple nom saisi.
  encadrement as (
    select e.id as team_id,
           coalesce(
             (select jsonb_build_object('nom', nullif(btrim(concat_ws(' ', m.prenom, m.nom)), ''), 'statut', 'actif')
                from club_members m
               where m.club_id = p_club_id and m.status = 'actif'
                 and m.role in ('coach', 'educateur', 'resp_equipe') and m.teams ? e.name
               order by (m.role = 'coach') desc limit 1),
             (select jsonb_build_object('nom', nullif(btrim(concat_ws(' ', ci.prenom, ci.nom)), ''),
                                        'statut', case ci.statut when 'envoyee' then 'invite' else 'prepare' end)
                from club_invitations ci
               where ci.club_id = p_club_id and ci.statut in ('preparee', 'envoyee')
                 and ci.expire_at > now() and ci.role in ('coach', 'resp_equipe') and ci.teams ? e.name
               order by (ci.statut = 'envoyee') desc limit 1),
             case when nullif(btrim(coalesce(e.coach, '')), '') is not null
                  then jsonb_build_object('nom', btrim(e.coach), 'statut', 'renseigne') end
           ) as j
      from eq e
  )
  select e.id, e.name, e.categorie,
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
$$;

revoke execute on function public.club_equipes_etat(uuid) from public, anon;
grant execute on function public.club_equipes_etat(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 4. « Responsables » demande un président connu
-- ════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.club_president_connu(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from club_members where club_id = p_club_id and role = 'president' and status = 'actif')
      or exists (select 1 from club_invitations where club_id = p_club_id and role = 'president'
                  and statut in ('preparee', 'envoyee', 'acceptee'))
      or exists (select 1 from client_organigramme o join clubs c on c.portail_client_id = o.client_id
                  where c.id = p_club_id and o.role ilike '%pr_sident%');
$$;

revoke execute on function public.club_president_connu(uuid) from public, anon;

-- Corps inchangé sauf `v_responsables` : le compte Owner seul ne suffit plus à dire que les
-- responsables du club sont connus. L'OS lit la même fonction et suivra.
create or replace function public.club_onboarding_completion(p_club_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_identite boolean;
  v_responsables boolean;
  v_equipes boolean;
  v_entrainements boolean;
  v_calendrier boolean;
  v_branding boolean;
  v_sponsors boolean;
  v_communication boolean;
  v_droit_image boolean;
  v_sections_total int := 9;
  v_sections_ok int;
begin
  if not (is_club_member(p_club_id) or is_staff()) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select (nom is not null and ville is not null and adresse is not null)
    into v_identite from clubs where id = p_club_id;

  select exists(select 1 from club_members where club_id = p_club_id and status = 'actif')
         and club_president_connu(p_club_id)
    into v_responsables;

  select exists(select 1 from club_teams where club_id = p_club_id)
    into v_equipes;

  select exists(
    select 1 from club_team_training_slots ctts
    join club_teams ct on ct.id = ctts.team_id
    where ct.club_id = p_club_id
  ) into v_entrainements;

  select (
    exists(select 1 from club_calendar_events where club_id = p_club_id)
    or exists(select 1 from club_matches where club_id = p_club_id)
  ) into v_calendrier;

  select (logo_url is not null or ecusson_url is not null)
    into v_branding from clubs where id = p_club_id;

  select exists(select 1 from club_sponsors where club_id = p_club_id)
    into v_sponsors;

  select (
    exists(select 1 from club_social_accounts where club_id = p_club_id)
    and objectifs_communication is not null and array_length(objectifs_communication, 1) > 0
  ) into v_communication from clubs where id = p_club_id;

  select (droit_image_mode is not null) into v_droit_image from clubs where id = p_club_id;

  v_sections_ok := (case when v_identite then 1 else 0 end)
    + (case when v_responsables then 1 else 0 end)
    + (case when v_equipes then 1 else 0 end)
    + (case when v_entrainements then 1 else 0 end)
    + (case when v_calendrier then 1 else 0 end)
    + (case when v_branding then 1 else 0 end)
    + (case when v_sponsors then 1 else 0 end)
    + (case when v_communication then 1 else 0 end)
    + (case when v_droit_image then 1 else 0 end);

  return jsonb_build_object(
    'identite', coalesce(v_identite, false),
    'responsables', coalesce(v_responsables, false),
    'equipes', v_equipes,
    'entrainements', v_entrainements,
    'calendrier', v_calendrier,
    'branding', coalesce(v_branding, false),
    'sponsors', v_sponsors,
    'communication', coalesce(v_communication, false),
    'droit_image', coalesce(v_droit_image, false),
    'sections_completees', v_sections_ok,
    'sections_total', v_sections_total,
    'pourcentage', round((v_sections_ok::numeric / v_sections_total) * 100)
  );
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 5. Les 9 sections de l'onboarding
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- Les sections obligatoires avant lancement. UNE liste, ici, que l'écran lit : il ne la
-- redéclare pas. Choix proposé à Fouka le 10/09/2026 — à changer ici seulement.
create or replace function public.club_sections_obligatoires()
returns text[]
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$ select array['identite','responsables','equipes','entrainements','calendrier','droit_image']; $$;

create or replace function public.club_onboarding_sections(p_club_id uuid)
returns table (cle text, libelle text, obligatoire boolean, etat text, detail text,
               derniere_at timestamptz, derniere_par text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_c jsonb;
  v_sans_coach int; v_sans_creneau int; v_sans_calendrier int; v_nb_equipes int;
  v_joueurs int; v_image_ok int;
  v_president_actif boolean;
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  v_c := club_onboarding_completion(p_club_id);

  select count(*), count(*) filter (where e.encadrant_statut = 'aucun'),
         count(*) filter (where e.creneaux = 0), count(*) filter (where e.evenements = 0),
         coalesce(sum(e.joueurs), 0), coalesce(sum(e.image_valides), 0)
    into v_nb_equipes, v_sans_coach, v_sans_creneau, v_sans_calendrier, v_joueurs, v_image_ok
    from club_equipes_etat(p_club_id) e;

  select exists (select 1 from club_members where club_id = p_club_id and role = 'president' and status = 'actif')
    into v_president_actif;

  return query
  with s(cle, libelle, ordre) as (values
    ('identite', 'Identité', 1), ('responsables', 'Responsables', 2), ('equipes', 'Équipes', 3),
    ('entrainements', 'Entraînements', 4), ('calendrier', 'Calendrier', 5), ('branding', 'Branding', 6),
    ('sponsors', 'Sponsors', 7), ('communication', 'Communication', 8), ('droit_image', 'Droit à l''image', 9)
  ),
  modif as (
    select distinct on (ev.section) ev.section, ev.derniere_at,
           coalesce(nullif(btrim(concat_ws(' ', p.prenom, p.nom)), ''),
                    case when ev.auteur_id is null then 'SportVision' end, 'Un membre') as par
      from club_onboarding_events ev
      left join profiles p on p.id = ev.auteur_id
     where ev.club_id = p_club_id and ev.section is not null
     order by ev.section, ev.derniere_at desc
  )
  select s.cle, s.libelle, s.cle = any (club_sections_obligatoires()),
         case
           when not coalesce((v_c->>s.cle)::boolean, false) then 'incomplet'
           when s.cle = 'equipes' and v_sans_coach > 0 then 'attention'
           when s.cle = 'entrainements' and v_sans_creneau > 0 then 'attention'
           when s.cle = 'calendrier' and v_sans_calendrier > 0 then 'attention'
           when s.cle = 'responsables' and not v_president_actif then 'attention'
           when s.cle = 'droit_image' and v_joueurs > 0 and v_image_ok < v_joueurs then 'attention'
           else 'termine'
         end,
         case s.cle
           when 'equipes' then case when v_nb_equipes = 0 then 'Aucune équipe'
                                    when v_sans_coach > 0 then v_sans_coach || ' équipe' || case when v_sans_coach > 1 then 's' else '' end || ' sans coach'
                                    else v_nb_equipes || ' équipes' end
           when 'entrainements' then case when v_sans_creneau > 0 and v_nb_equipes > 0
                                          then v_sans_creneau || ' équipe' || case when v_sans_creneau > 1 then 's' else '' end || ' sans créneau' end
           when 'calendrier' then case when v_sans_calendrier > 0 and v_nb_equipes > 0
                                       then v_sans_calendrier || ' équipe' || case when v_sans_calendrier > 1 then 's' else '' end || ' sans aucun événement' end
           when 'responsables' then case when not coalesce((v_c->>'responsables')::boolean, false) then 'Président à renseigner'
                                         when not v_president_actif then 'Président connu, pas encore connecté' end
           when 'droit_image' then case when v_joueurs > 0 then v_image_ok || ' / ' || v_joueurs || ' autorisations validées' end
         end,
         m.derniere_at, m.par
    from s
    left join modif m on m.section = s.cle
   order by s.ordre;
end;
$$;

revoke execute on function public.club_onboarding_sections(uuid) from public, anon;
grant execute on function public.club_onboarding_sections(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 6. Le statut de lancement, et le lancement
-- ════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.club_statut_lancement(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_lance_at timestamptz; v_lance_par text;
  v_manquantes text[];
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select c.lance_at, nullif(btrim(concat_ws(' ', p.prenom, p.nom)), '')
    into v_lance_at, v_lance_par
    from clubs c left join profiles p on p.id = c.lance_par
   where c.id = p_club_id;

  select coalesce(array_agg(s.libelle order by s.libelle), '{}')
    into v_manquantes
    from club_onboarding_sections(p_club_id) s
   where s.obligatoire and s.etat = 'incomplet';

  return jsonb_build_object(
    'statut', case when v_lance_at is not null then 'actif'
                   when cardinality(v_manquantes) = 0 then 'pret'
                   else 'en_preparation' end,
    'lance_at', v_lance_at,
    'lance_par', v_lance_par,
    'sections_manquantes', to_jsonb(v_manquantes),
    'invitations_preparees', (select count(*) from club_invitations
                               where club_id = p_club_id and statut = 'preparee' and expire_at > now())
  );
end;
$$;

revoke execute on function public.club_statut_lancement(uuid) from public, anon;
grant execute on function public.club_statut_lancement(uuid) to authenticated;

-- Lance le club et rend les invitations préparées, que l'écran envoie ensuite une par une par la
-- fonction d'envoi existante (clubplus-envoyer-invitation) — une seule chaîne d'envoi, pas deux.
create or replace function public.lancer_club(p_club_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_statut jsonb;
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  v_statut := club_statut_lancement(p_club_id);
  if v_statut->>'statut' = 'actif' then
    raise exception 'Ce club est déjà lancé.';
  end if;
  if v_statut->>'statut' <> 'pret' then
    raise exception 'Configuration incomplète : %.',
      (select string_agg(x, ', ') from jsonb_array_elements_text(v_statut->'sections_manquantes') x);
  end if;

  perform set_config('app.lancement_club', 'on', true);
  update clubs set lance_at = now(), lance_par = auth.uid() where id = p_club_id;
  perform set_config('app.lancement_club', 'off', true);

  return jsonb_build_object(
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'email', email, 'role', role)
                                              order by role, email)
                               from club_invitations
                              where club_id = p_club_id and statut = 'preparee' and expire_at > now()), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.lancer_club(uuid) from public, anon;
grant execute on function public.lancer_club(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 7. La santé du club
-- ════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.club_sante(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_nb int; v_coach int; v_creneau int; v_cal int; v_effectif int; v_effectif_vide_avec_matchs int;
  v_joueurs int; v_image_ok int; v_image_attente int; v_image_refus int;
  v_identite boolean; v_president boolean;
  v_parts numeric[] := '{}';
  v_problemes jsonb := '[]'::jsonb;
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select count(*),
         count(*) filter (where encadrant_statut <> 'aucun'),
         count(*) filter (where creneaux > 0),
         count(*) filter (where evenements > 0),
         count(*) filter (where joueurs > 0),
         count(*) filter (where joueurs = 0 and evenements > 0),
         coalesce(sum(joueurs), 0), coalesce(sum(image_valides), 0),
         coalesce(sum(image_en_attente), 0), coalesce(sum(image_refus), 0)
    into v_nb, v_coach, v_creneau, v_cal, v_effectif, v_effectif_vide_avec_matchs,
         v_joueurs, v_image_ok, v_image_attente, v_image_refus
    from club_equipes_etat(p_club_id);

  select (nom is not null and ville is not null and adresse is not null) into v_identite
    from clubs where id = p_club_id;
  v_president := club_president_connu(p_club_id);

  -- Le score : la moyenne de ce qui est vérifiable. Une composante sans objet (pas de joueur,
  -- donc pas de droit à l'image à mesurer) n'entre pas dans la moyenne — elle ne compte ni pour
  -- ni contre.
  v_parts := v_parts || (case when coalesce(v_identite, false) then 1 else 0 end)::numeric
                     || (case when v_president then 1 else 0 end)::numeric;
  if v_nb > 0 then
    v_parts := v_parts || (v_coach::numeric / v_nb) || (v_creneau::numeric / v_nb)
                       || (v_cal::numeric / v_nb) || (v_effectif::numeric / v_nb);
  else
    v_parts := v_parts || 0::numeric;
  end if;
  if v_joueurs > 0 then
    v_parts := v_parts || (v_image_ok::numeric / v_joueurs);
  end if;

  if v_nb = 0 then
    v_problemes := v_problemes || jsonb_build_object('code', 'aucune_equipe', 'niveau', 'a_faire', 'nombre', 0,
      'texte', 'Aucune équipe renseignée', 'lien', '/onboarding?section=equipes');
  end if;
  if v_nb - v_coach > 0 then
    v_problemes := v_problemes || jsonb_build_object('code', 'equipes_sans_coach', 'niveau', 'a_faire', 'nombre', v_nb - v_coach,
      'texte', (v_nb - v_coach) || ' équipe' || case when v_nb - v_coach > 1 then 's' else '' end || ' sans coach',
      'lien', '/teams?filtre=sans_coach');
  end if;
  if v_nb > 0 and v_joueurs - v_image_ok > 0 then
    v_problemes := v_problemes || jsonb_build_object('code', 'joueurs_sans_droit_image', 'niveau', 'a_faire', 'nombre', v_joueurs - v_image_ok,
      'texte', (v_joueurs - v_image_ok) || ' joueur' || case when v_joueurs - v_image_ok > 1 then 's' else '' end || ' sans droit à l''image validé',
      'lien', '/teams?filtre=image');
  end if;
  if not v_president then
    v_problemes := v_problemes || jsonb_build_object('code', 'president', 'niveau', 'a_faire', 'nombre', 1,
      'texte', 'Informations du président à renseigner', 'lien', '/onboarding?section=responsables');
  end if;
  if not coalesce(v_identite, false) then
    v_problemes := v_problemes || jsonb_build_object('code', 'identite', 'niveau', 'a_faire', 'nombre', 1,
      'texte', 'Identité du club incomplète', 'lien', '/onboarding?section=identite');
  end if;
  if v_nb - v_creneau > 0 then
    v_problemes := v_problemes || jsonb_build_object('code', 'equipes_sans_entrainement', 'niveau', 'a_faire', 'nombre', v_nb - v_creneau,
      'texte', (v_nb - v_creneau) || ' équipe' || case when v_nb - v_creneau > 1 then 's' else '' end || ' sans entraînement',
      'lien', '/onboarding?section=entrainements');
  end if;
  if v_effectif_vide_avec_matchs > 0 then
    v_problemes := v_problemes || jsonb_build_object('code', 'effectif_non_renseigne', 'niveau', 'information', 'nombre', v_effectif_vide_avec_matchs,
      'texte', v_effectif_vide_avec_matchs || ' équipe' || case when v_effectif_vide_avec_matchs > 1 then 's' else '' end || ' avec des matchs mais sans effectif',
      'lien', '/teams?filtre=effectif');
  end if;
  if v_nb - v_cal > 0 then
    v_problemes := v_problemes || jsonb_build_object('code', 'equipes_sans_calendrier', 'niveau', 'information', 'nombre', v_nb - v_cal,
      'texte', (v_nb - v_cal) || ' équipe' || case when v_nb - v_cal > 1 then 's' else '' end || ' sans aucun événement au calendrier',
      'lien', '/calendar');
  end if;

  return jsonb_build_object(
    'score', round(100 * (select avg(x) from unnest(v_parts) x)),
    'problemes', v_problemes,
    'equipes', v_nb,
    'joueurs', v_joueurs,
    'image', jsonb_build_object('valides', v_image_ok, 'en_attente', v_image_attente, 'refus', v_image_refus)
  );
end;
$$;

revoke execute on function public.club_sante(uuid) from public, anon;
grant execute on function public.club_sante(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 8. Le fil d'activité
-- ════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.club_journal(p_club_id uuid, p_limite integer default 30)
returns table (quand timestamptz, qui text, texte text, genre text, lien text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
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
$$;

revoke execute on function public.club_journal(uuid, integer) from public, anon;
grant execute on function public.club_journal(uuid, integer) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 9. Le tableau de bord du CM
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Les clés existantes (aujourdhui, a_faire, semaine, adoption) sont conservées telles quelles ;
-- s'y ajoutent les compteurs des « Actions à traiter » et le mois Full Communication.

create or replace function public.cm_tableau_de_bord(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_debut date := (current_date - ((extract(isodow from current_date)::int - 1)))::date;
  v_fin date := v_debut + 6;
  v_mois_debut date := date_trunc('month', current_date)::date;
  v_mois_fin date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_client uuid;
  v_resultat jsonb;
begin
  if not peut_preparer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select portail_client_id into v_client from clubs where id = p_club_id;

  select jsonb_build_object(

    'aujourdhui', jsonb_build_object(
      'matchs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.ref, 'equipe', c.equipe, 'adversaire', c.adversaire,
                 'heure', to_char(c.heure_debut,'HH24:MI'), 'domicile', c.domicile,
                 'lieu', c.lieu, 'competition', c.competition,
                 'couverture', c.couverture is not null,
                 'type_couverture', c.type_couverture)
               order by c.heure_debut nulls last)
        from club_calendrier(p_club_id, current_date, current_date) c
        where c.genre = 'match' and c.statut <> 'cancelled'), '[]'::jsonb),
      'entrainements', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'equipe', c.equipe,
                 'debut', to_char(c.heure_debut,'HH24:MI'),
                 'fin', to_char(c.heure_fin,'HH24:MI'),
                 'lieu', c.lieu,
                 'annule', c.statut = 'annulee',
                 'couverture', c.couverture is not null)
               order by c.heure_debut)
        from club_calendrier(p_club_id, current_date, current_date) c
        where c.genre = 'entrainement'), '[]'::jsonb),
      'autres', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'genre', c.genre, 'titre', c.titre, 'equipe', c.equipe,
                 'heure', to_char(c.heure_debut,'HH24:MI'), 'lieu', c.lieu,
                 'couverture', c.couverture is not null)
               order by c.heure_debut nulls last)
        from club_calendrier(p_club_id, current_date, current_date) c
        where c.genre not in ('match', 'entrainement')), '[]'::jsonb),
      'publications', case when v_client is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('id', ct.id, 'titre', ct.titre, 'statut', ct.statut,
                                            'plateforme', ct.plateforme,
                                            'heure', to_char(ct.date_prevue, 'HH24:MI'))
               order by ct.date_prevue)
        from contenus ct
        where ct.client_id = v_client and ct.date_prevue::date = current_date
          and coalesce(ct.statut, '') not in ('archive', 'refuse')), '[]'::jsonb) end
    ),

    'a_faire', jsonb_build_object(
      'demandes_du_club', (
        select count(*) from club_requests r
        where r.club_id = p_club_id
          and coalesce(r.status,'recues') in ('recues','info_manquante','en_traitement')),
      'demandes_urgentes', (
        select count(*) from club_requests r
        where r.club_id = p_club_id and r.urgency = 'haute'
          and coalesce(r.status,'recues') in ('recues','info_manquante','en_traitement')),
      'resultats_manquants', (
        select count(*) from club_matches m
        where m.club_id = p_club_id and m.match_date < current_date
          and coalesce(m.sport_status,'') <> 'cancelled'
          and nullif(btrim(coalesce(m.score,'')),'') is null),
      'resultats_recents', (
        select count(*) from club_matches m
        where m.club_id = p_club_id and m.match_date between current_date - 3 and current_date - 1
          and coalesce(m.sport_status,'') <> 'cancelled'
          and nullif(btrim(coalesce(m.score,'')),'') is null),
      'prochaine_sans_couverture', (
        select jsonb_build_object('id', m.id, 'equipe', m.team, 'adversaire', m.opponent,
                                  'date', m.match_date, 'heure', to_char(m.kickoff_time,'HH24:MI'))
        from club_matches m
        where m.club_id = p_club_id and m.match_date >= current_date
          and coalesce(m.sport_status,'scheduled') <> 'cancelled'
          and not exists (select 1 from planned_presences pp
                          where pp.match_id = m.id and coalesce(pp.statut,'prevu') <> 'annule')
        order by m.match_date, m.kickoff_time nulls last limit 1),
      'equipes_sans_coach', (
        select count(*) from club_equipes_etat(p_club_id) e where e.encadrant_statut = 'aucun'),
      'sections_mise_en_place', (
        select count(*) from club_onboarding_sections(p_club_id) s where s.etat = 'incomplet'),
      'invitations_preparees', (
        select count(*) from club_invitations ci
        where ci.club_id = p_club_id and ci.statut = 'preparee' and ci.expire_at > now()),
      'invitations_en_attente', (
        select count(*) from club_invitations ci
        where ci.club_id = p_club_id and ci.statut = 'envoyee' and ci.expire_at > now()),
      'joueurs_sans_droit_image', (
        select coalesce(sum(e.joueurs - e.image_valides), 0) from club_equipes_etat(p_club_id) e),
      'contenus_a_valider', case when v_client is null then 0 else (
        select count(*) from contenus ct
        where ct.client_id = v_client
          and ct.statut in ('a_valider_interne','a_valider_client','a_valider_tuteur','corrections')) end,
      'contenus_a_valider_proches', case when v_client is null then 0 else (
        select count(*) from contenus ct
        where ct.client_id = v_client
          and ct.statut in ('a_valider_interne','a_valider_client','a_valider_tuteur','corrections')
          and ct.date_prevue::date <= current_date + 2) end,
      'souhaits_couverture', (
        select count(*) from coverage_wishes w
        where w.club_id = p_club_id and w.status in ('wished','reviewing'))
    ),

    'semaine', jsonb_build_object(
      'du', v_debut, 'au', v_fin,
      'matchs', (select count(*) from club_calendrier(p_club_id, v_debut, v_fin) c
                 where c.genre = 'match' and c.statut <> 'cancelled'),
      'entrainements', (select count(*) from club_calendrier(p_club_id, v_debut, v_fin) c
                        where c.genre = 'entrainement' and c.statut <> 'annulee'),
      'presences', (select count(*) from club_calendrier(p_club_id, v_debut, v_fin) c
                    where c.couverture is not null),
      'contenus_a_publier', case when v_client is null then 0 else (
        select count(*) from contenus c
        where c.client_id = v_client
          and coalesce(c.statut,'') not in ('publie','archive','refuse')
          and c.date_prevue::date between v_debut and v_fin) end,
      'demandes', (select count(*) from club_requests r
                   where r.club_id = p_club_id
                     and coalesce(r.status,'recues') in ('recues','info_manquante','en_traitement'))
    ),

    -- Le mois Full Communication, pour la carte de la barre latérale du CM.
    'mois', jsonb_build_object(
      'presences_prevues', (
        select count(*) from planned_presences pr
        where coalesce(pr.statut,'prevu') <> 'annule'
          and pr.date_presence between v_mois_debut and v_mois_fin
          and (exists (select 1 from club_matches m where m.id = pr.match_id and m.club_id = p_club_id)
               or exists (select 1 from club_calendar_events e where e.id = pr.calendar_event_id and e.club_id = p_club_id))),
      'presences_realisees', (
        select count(*) from planned_presences pr
        where coalesce(pr.statut,'prevu') <> 'annule'
          and pr.date_presence between v_mois_debut and least(v_mois_fin, current_date - 1)
          and (exists (select 1 from club_matches m where m.id = pr.match_id and m.club_id = p_club_id)
               or exists (select 1 from club_calendar_events e where e.id = pr.calendar_event_id and e.club_id = p_club_id))),
      'contenus_produits', case when v_client is null then 0 else (
        select count(*) from contenus ct
        where ct.client_id = v_client and ct.statut in ('pret','valide','programme','publie')
          and coalesce(ct.date_publication, ct.updated_at)::date between v_mois_debut and v_mois_fin) end
    ),

    'adoption', jsonb_build_object(
      'clubplus_total', (select count(*) from club_members cm
                         where cm.club_id = p_club_id and cm.role in ('coach','educateur')),
      'clubplus_actifs', (select count(*) from club_members cm
                          where cm.club_id = p_club_id and cm.role in ('coach','educateur')
                            and cm.status = 'actif'),
      'connect_total', (select count(*) from player_profiles pp
                        where pp.club_id = p_club_id
                          and coalesce(pp.account_status,'sans_compte') <> 'retire'),
      'connect_actifs', (select count(*) from player_profiles pp
                         where pp.club_id = p_club_id and pp.account_status = 'actif')
    )
  ) into v_resultat;

  return v_resultat;
end $function$;

commit;
