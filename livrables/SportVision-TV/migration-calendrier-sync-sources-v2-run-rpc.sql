-- Migration : journal de synchronisation écrivable sans casser son inaltérabilité (Lot 0, suite)
-- À exécuter dans Supabase → SQL Editor, APRÈS migration-calendrier-sync-sources-v1.sql
-- et migration-calendrier-sync-sources-v1-fix-dedup.sql.
--
-- ── Le trou fonctionnel trouvé en branchant le TypeScript ──
-- La v1 pose `calendar_sync_runs` et une SEULE policy, en lecture :
--     create policy csr_admin_select on calendar_sync_runs for select ...
-- C'était volontaire et le commentaire le dit : « le journal est écrit par le moteur de
-- synchronisation (service_role) [...] personne ne doit pouvoir maquiller l'historique ».
--
-- Sauf qu'il n'existe aujourd'hui aucun moteur service_role : l'import est déclenché depuis le
-- navigateur de l'admin du club (Club+ n'a aucune route API serveur, vérifié — src/app/api
-- n'existe pas et aucun fichier du repo n'utilise SUPABASE_SECRET_KEY). Avec les policies de la
-- v1, AUCUNE synchronisation ne pouvait donc être journalisée : l'insert était refusé par la RLS.
--
-- ── Le choix retenu ──
-- Ni policy INSERT ouverte (elle donnerait aussi le droit d'écrire n'importe quelle ligne, à
-- n'importe quelles valeurs, et il faudrait ensuite une policy UPDATE pour clore le run), ni route
-- serveur avec la clé service_role (elle exposerait une clé d'administration à un déploiement
-- Netlify qui n'en héberge aucune aujourd'hui).
--
-- À la place : une seule fonction SECURITY DEFINER qui écrit un run COMPLET et DÉJÀ CLOS en un
-- appel. Elle vérifie elle-même que l'appelant est admin du club (ou staff SportVision), et il
-- n'existe toujours ni UPDATE ni DELETE possible sur la table. L'historique reste donc
-- inaltérable : on peut y ajouter une ligne, jamais réécrire ou effacer la précédente.

begin;

-- Nom du fichier (ou de la source) à l'origine du run. Sans lui, un club qui importe trois
-- fichiers dans la même journée ne peut pas savoir lequel a produit quel diff.
alter table calendar_sync_runs add column if not exists source_label text;

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
  -- SECURITY DEFINER : la fonction s'exécute avec les droits du propriétaire, donc la RLS de
  -- calendar_sync_runs ne s'applique pas. C'est ici, et nulle part ailleurs, que se joue le
  -- contrôle d'accès — même règle que les policies de la v1 (admin du club ou staff).
  if not (is_club_admin(p_club_id) or is_staff()) then
    raise exception 'Journalisation refusée : réservée à l''administrateur du club.'
      using errcode = '42501';
  end if;

  if p_status not in ('success','partial','error') then
    raise exception 'Statut de run invalide : %', p_status using errcode = '22023';
  end if;

  v_sync_status := case p_status when 'success' then 'ok' when 'partial' then 'partial' else 'error' end;
  v_last_error := nullif(p_errors -> 0 ->> 'message', '');

  -- §28/§29 « dernière synchronisation » : la source du club pour ce (saison, provider) est créée
  -- à la première synchronisation puis mise à jour, jamais dupliquée. Ignorée si la saison n'est
  -- pas connue : club_calendar_sources.saison_id est NOT NULL, et inventer une saison ici
  -- reviendrait exactement à ce que le chantier interdit.
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

  -- `finished_at` posé tout de suite : le run est déjà terminé au moment où il est enregistré.
  -- Aucune ligne 'running' n'est donc jamais laissée en suspens, et aucune policy UPDATE n'est
  -- nécessaire pour la clore.
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

comment on function record_calendar_sync_run is
  'Enregistre une synchronisation de calendrier déjà terminée (journal + mise à jour de la source du club). SECURITY DEFINER : vérifie is_club_admin/is_staff. Seul chemin d''écriture sur calendar_sync_runs, qui n''a ni policy INSERT, ni UPDATE, ni DELETE — l''historique reste inaltérable.';

revoke all on function record_calendar_sync_run(uuid, uuid, text, text, timestamptz, text, integer, integer, integer, integer, jsonb, jsonb, text) from public;
grant execute on function record_calendar_sync_run(uuid, uuid, text, text, timestamptz, text, integer, integer, integer, integer, jsonb, jsonb, text) to authenticated;

commit;
