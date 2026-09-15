-- v236 — Le CM du club travaille le club, sans voir ni l'argent ni les gens.
--
-- CORRECTION DE MA v235. J'avais ajouté le CM du club à `peut_operer_club()`, la fonction qui dit
-- « cette personne travaille sur ce club ». C'était trop large, et la batterie l'a dit tout de
-- suite : club-donnees-restreintes est passé au rouge sur cinq points. Ce rôle se retrouvait à
-- lire :
--   · les MONTANTS des réservations du club,
--   · les sponsors et leurs opérations commerciales,
--   · l'annuaire des membres, téléphones compris,
--   · les adresses e-mail des personnes invitées.
-- C'est-à-dire exactement l'argent et les accès, les deux choses que Fouka avait exclues en
-- répondant à ma question. Une seule fonction gouvernait des domaines qui n'ont rien à voir.
--
-- CE QUE FAIT CETTE MIGRATION : `peut_operer_club` retrouve sa définition d'origine, et une
-- seconde fonction, `peut_travailler_club`, ajoute le CM du club. Seules les policies du travail
-- éditorial et opérationnel basculent dessus ; celles qui gardent l'argent, les gens et les
-- réglages restent sur `peut_operer_club`.
--
-- OUVERT (le travail) : calendrier et ses sources, matchs, créneaux, lieux, équipes, actualités,
-- créations, médias du club, règles d'accès aux médias, marquage des joueurs sur les photos,
-- signalements, projets d'équipe, tickets de support.
--
-- FERMÉ, et c'est la décision de Fouka : réservations et montants, sponsors, invitations,
-- annuaire des membres, fiches des joueurs en écriture, onboarding du club, logo du club.
--
-- Idempotent.

-- ── 1. peut_operer_club retrouve sa definition d'origine ──────────────────────────────────────
create or replace function peut_operer_club(p_club_id uuid)
returns boolean language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
begin
  if p_club_id is null then
    return false;
  end if;
  if is_club_admin(p_club_id) then
    return true;
  end if;
  return coalesce(
    exists (
      select 1 from profiles p
       where p.id = auth.uid()
         and p.actif
         and p.role in ('admin', 'com', 'sec', 'cm')
    )
    and p_club_id in (select public.cm_clubs_autorises()),
    false);
end;
$$;

-- ── 2. Le CM du club, designe par son club ────────────────────────────────────────────────────
create or replace function est_cm_du_club_id(p_club_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_club_id is not null and exists (
    select 1 from club_members m
     where m.user_id = auth.uid() and m.club_id = p_club_id
       and m.status = 'actif' and m.role = 'comm'
  );
$$;

create or replace function peut_travailler_club(p_club_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select peut_operer_club(p_club_id) or est_cm_du_club_id(p_club_id);
$$;

comment on function peut_travailler_club(uuid) is
  'Qui TRAVAILLE sur ce club : tous ceux de peut_operer_club, plus le Community Manager du club (v236). À employer pour le travail éditorial et opérationnel. Ce qui touche à l''argent, aux personnes et aux réglages reste sur peut_operer_club.';

-- ── 3. Les policies du travail basculent, une par une ─────────────────────────────────────────
do $$
declare
  r record;
  v_qual text; v_check text; v_cmd text; v_roles text;
  cibles text[][] := array[
    ['club_calendar_events','ccal_operateur_manage'],
    ['club_calendar_sources','ccs_operateur_manage'],
    ['club_matches','cma_operateur_manage'],
    ['club_team_source_mappings','ctsm_operateur_manage'],
    ['club_venues','cven_operateur_manage'],
    ['club_team_training_slots','ctts_encadrement_insert'],
    ['club_team_training_slots','ctts_encadrement_update'],
    ['club_team_training_slots','ctts_encadrement_delete'],
    ['club_newsroom_items','cni_operateur_manage'],
    ['club_creations','ccr_operateur_manage'],
    ['club_media','cmd_operateur_manage'],
    ['media_access_rules','mar_operateur_manage'],
    ['media_access_selected_players','masp_operateur_manage'],
    ['media_player_tags','mpt_operateur_manage'],
    ['media_reports','mrp_operateur_update'],
    ['team_projects','tpr_operateur_manage'],
    ['club_support_tickets','cst_operateur_manage'],
    ['club_teams','ctm_operateur_insert'],
    ['club_teams','ctm_operateur_update'],
    ['player_profiles','pp_operateur_select']
  ];
  i int;
begin
  for i in 1 .. array_length(cibles, 1) loop
    select pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid),
           case pol.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
                           when 'd' then 'delete' else 'all' end,
           coalesce((select string_agg(quote_ident(rolname), ', ') from pg_roles where oid = any(pol.polroles)), 'public')
      into v_qual, v_check, v_cmd, v_roles
      from pg_policy pol join pg_class c on c.oid = pol.polrelid
     where c.relname = cibles[i][1] and pol.polname = cibles[i][2];

    if v_qual is null and v_check is null then
      continue;  -- policy absente ou deja rejouee : rien a faire
    end if;
    -- Rien n'est reecrit a la main : on remplace UNIQUEMENT le nom de la fonction, le reste de
    -- l'expression est repris tel quel. Une policy recopiee de memoire serait une policy changee.
    v_qual := replace(coalesce(v_qual, ''), 'peut_operer_club(', 'peut_travailler_club(');
    v_check := replace(coalesce(v_check, ''), 'peut_operer_club(', 'peut_travailler_club(');

    execute format('drop policy if exists %I on %I', cibles[i][2], cibles[i][1]);
    execute format('create policy %I on %I for %s to %s %s %s',
      cibles[i][2], cibles[i][1], v_cmd, v_roles,
      case when v_qual <> '' and v_cmd <> 'insert' then 'using (' || v_qual || ')' else '' end,
      case when v_check <> '' then 'with check (' || v_check || ')'
           when v_cmd in ('insert','update','all') and v_qual <> '' then 'with check (' || v_qual || ')'
           else '' end);
  end loop;
end $$;
