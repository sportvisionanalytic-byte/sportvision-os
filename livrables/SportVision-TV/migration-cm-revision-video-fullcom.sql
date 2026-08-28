-- ============================================================================
-- migration-cm-revision-video-fullcom.sql
-- ============================================================================
-- Objectif : le rôle `cm` (Community Manager SportVision, staff interne) peut
-- consulter les vidéos de montage de ses clients Full Communication
-- (media_postproductions liées via prestations.client_id → clients.cm_id) et
-- déposer EXACTEMENT UNE SEULE demande de modification (media_corrections)
-- par livrable vidéo (postproduction_id). Aucune limite pour admin/prod/sec.
--
-- ─── Ce qui existe déjà (vérifié, non modifié ici) ─────────────────────────
-- - media_postproductions / media_versions / media_corrections
--   (migration-medias.sql).
-- - mc_read/mc_write (media_corrections) et mv_read/mv_write (media_versions)
--   utilisent déjà is_staff() (migration-connect-v60-fix-policies-profiles-
--   exists-ghost-account.sql), qui inclut role='cm' — un CM peut donc déjà
--   lire/écrire ces deux tables au niveau RLS. mp_write (media_postproductions)
--   reste réservé à admin/prod, volontairement inchangé : un CM ne doit pas
--   éditer le brief/l'attribution du montage.
-- - Aucun trigger BEFORE INSERT n'existe aujourd'hui sur media_corrections
--   (seul trg_mc_upd, BEFORE UPDATE, met à jour updated_at) — pas de conflit
--   avec le trigger additif posé ici.
--
-- ─── Ce que fait cette migration ───────────────────────────────────────────
-- Un seul trigger BEFORE INSERT sur media_corrections : si le profil qui
-- insère a role='cm' ET qu'une ligne media_corrections existe déjà pour le
-- même (postproduction_id, auteur_id=auth.uid()), l'insertion est rejetée.
-- Aucun autre rôle n'est concerné (admin/prod/sec gardent un usage interne
-- illimité, mécanisme différent). Le contrôle se fait sur auth.uid() (pas sur
-- new.auteur_id) pour ne pas pouvoir être contourné en usurpant l'auteur.
--
-- Idempotente : CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS avant
-- CREATE TRIGGER, peut être rejouée sans erreur.
-- À exécuter dans Supabase → SQL Editor (ou Management API).
-- ============================================================================

create or replace function enforce_cm_single_correction_per_postprod()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
begin
  select role into v_role from profiles where id = auth.uid();

  if v_role = 'cm' then
    if exists (
      select 1 from media_corrections
      where postproduction_id = new.postproduction_id
        and auteur_id = auth.uid()
    ) then
      raise exception 'Un Community Manager ne peut déposer qu''une seule demande de modification par livrable vidéo.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mc_cm_single_correction on media_corrections;
create trigger trg_mc_cm_single_correction
  before insert on media_corrections
  for each row execute function enforce_cm_single_correction_per_postprod();
