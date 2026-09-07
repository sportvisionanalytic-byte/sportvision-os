-- Migration : la synchronisation nocturne peut journaliser ses propres passages
-- À exécuter APRÈS migration-calendrier-sync-sources-v2-run-rpc.sql.
--
-- ── Ce qui manquait ──
-- `record_calendar_sync_run` (v2) n'accepte que l'administrateur du club ou le staff SportVision.
-- C'était juste tant que la seule façon de synchroniser était qu'un humain clique. La tâche
-- nocturne, elle, s'exécute avec la clé de service : `auth.uid()` y vaut NULL, donc
-- `is_club_admin()` et `is_staff()` sont faux tous les deux, et la fonction refusait d'écrire.
-- La synchronisation aurait donc fonctionné mais n'aurait laissé aucune trace, ce qui est
-- exactement le contraire de ce que sert un journal.
--
-- ── Pourquoi étendre la fonction plutôt qu'écrire directement depuis la tâche ──
-- La clé de service contourne la RLS : la tâche POURRAIT insérer dans calendar_sync_runs sans rien
-- demander à personne. Ce serait un deuxième chemin d'écriture sur le journal, avec sa propre
-- façon de remplir les colonnes, sa propre gestion de club_calendar_sources, et une divergence
-- garantie le jour où l'un des deux évolue. Un seul chemin, une seule vérité.
--
-- `auth.role()` lit le rôle porté par la requête (claim du JWT), donc 'service_role' n'est vrai
-- que pour un appelant qui détient réellement la clé de service : elle ne transite jamais par le
-- navigateur (route serveur uniquement). Un utilisateur ne peut pas se l'attribuer. Même garde que
-- protect_sensitive_club_match_fields, déjà en production sur club_matches.

begin;

create or replace function record_calendar_sync_run(
  p_club_id uuid,
  p_saison_id uuid,
  p_provider text,
  p_trigger_kind text,
  p_started_at timestamptz,
  p_status text,
  p_created integer,
  p_updated integer,
  p_cancelled integer,
  p_unchanged integer,
  p_changes jsonb,
  p_errors jsonb,
  p_source_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_id uuid;
  v_run_id uuid;
  v_sync_status text;
  v_last_error text;
begin
  -- Seul contrôle d'accès de la fonction (SECURITY DEFINER : la RLS de calendar_sync_runs ne
  -- s'applique pas ici). 'service_role' est la tâche de synchronisation planifiée ; les deux
  -- autres branches sont inchangées depuis la v2.
  if not (auth.role() = 'service_role' or is_club_admin(p_club_id) or is_staff()) then
    raise exception 'Journalisation refusée : réservée à l''administrateur du club.'
      using errcode = '42501';
  end if;

  if p_status not in ('success','partial','error') then
    raise exception 'Statut de run invalide : %', p_status using errcode = '22023';
  end if;

  v_sync_status := case p_status when 'success' then 'ok' when 'partial' then 'partial' else 'error' end;
  v_last_error := nullif(p_errors -> 0 ->> 'message', '');

  -- La source du club pour ce (saison, provider) est créée à la première synchronisation puis mise
  -- à jour, jamais dupliquée. `source_url` n'est PAS touchée ici : elle appartient au club, et une
  -- synchronisation ne doit pas pouvoir l'effacer en passant.
  if p_saison_id is not null then
    insert into club_calendar_sources (club_id, saison_id, provider, last_sync_at, sync_status, last_error, created_by)
    values (p_club_id, p_saison_id, p_provider, now(), v_sync_status, v_last_error, auth.uid())
    on conflict (club_id, saison_id, provider) do update
      set last_sync_at = now(),
          sync_status = excluded.sync_status,
          last_error = excluded.last_error,
          updated_at = now()
    returning id into v_source_id;
  end if;

  insert into calendar_sync_runs (
    club_id, saison_id, source_id, provider, trigger_kind,
    started_at, finished_at, status,
    events_created, events_updated, events_cancelled, events_unchanged,
    changes, errors, created_by, source_label
  )
  values (
    p_club_id, p_saison_id, v_source_id, p_provider, coalesce(p_trigger_kind, 'manual'),
    coalesce(p_started_at, now()), now(), p_status,
    coalesce(p_created, 0), coalesce(p_updated, 0), coalesce(p_cancelled, 0), coalesce(p_unchanged, 0),
    coalesce(p_changes, '[]'::jsonb), coalesce(p_errors, '[]'::jsonb), auth.uid(), p_source_label
  )
  returning id into v_run_id;

  return v_run_id;
end;
$$;

revoke all on function record_calendar_sync_run(uuid, uuid, text, text, timestamptz, text, integer, integer, integer, integer, jsonb, jsonb, text) from public;
grant execute on function record_calendar_sync_run(uuid, uuid, text, text, timestamptz, text, integer, integer, integer, integer, jsonb, jsonb, text) to authenticated, service_role;

commit;
