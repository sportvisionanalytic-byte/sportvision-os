-- v223 — Retirer son consentement efface VRAIMENT les empreintes (14/09/2026).
--
-- CE QUI MANQUAIT. `retirer_consentement_biometrie` (v159) marquait le consentement « retiré » et
-- renvoyait la liste des photos de référence à purger — un modèle pensé pour un moteur EXTERNE, où
-- la photo était stockée et le gabarit vivait chez un prestataire.
--
-- La v222 a pris un autre chemin, décidé avec Fouka : l'empreinte est calculée dans le navigateur
-- et stockée ici (`visages_reference`), la photo de référence n'est jamais conservée. Sans cette
-- migration, un parent qui retire son accord verrait le consentement passer à « retiré » pendant
-- que l'empreinte de son enfant, elle, resterait en base. Le droit de retrait serait une case à
-- cocher sans effet — exactement ce qu'un contrôle sanctionne.
--
-- CE QUE FAIT CETTE MIGRATION. Le retrait efface les empreintes de référence ET les marquages qui
-- en découlaient (ceux posés par la machine, `source = 'suggestion'`). Les marquages posés par un
-- humain — le club, SportVision, la famille elle-même — restent : ils ne reposent sur aucune donnée
-- biométrique, et les effacer ferait disparaître des photos que la famille a déjà payées.
--
-- `player_face_refs` reste en place, vide : c'est le chemin d'un moteur externe, qu'on n'utilise
-- pas. On le laisse plutôt que de retirer quatre fonctions qui n'ont jamais servi, mais le retrait
-- couvre désormais les DEUX modèles.
--
-- Idempotente.

create or replace function public.retirer_consentement_biometrie(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_chemins text[]; v_n integer; v_empreintes integer;
begin
  if not (is_confirmed_parent_of(p_player_id) or is_own_player(p_player_id)
          or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')) then
    raise exception 'Cet enfant n''est pas le vôtre.' using errcode = '42501';
  end if;

  -- Chemin « moteur externe » (v159) : les photos de référence à purger du stockage.
  select array_agg(r.storage_path) into v_chemins
    from player_face_refs r
    join consentements_biometrie c on c.id = r.consentement_id
   where c.player_id = p_player_id and c.statut = 'accorde' and r.storage_path is not null;

  update consentements_biometrie set statut = 'retire', retire_le = now(), retire_par = auth.uid()
   where player_id = p_player_id and statut = 'accorde';
  get diagnostics v_n = row_count;

  -- Chemin retenu (v222) : les empreintes vivent ici, elles partent ici. Sans cette ligne, le
  -- droit de retrait n'aurait aucun effet sur la donnée elle-même.
  v_empreintes := purger_visages_du_joueur(p_player_id);

  return jsonb_build_object('retires', v_n, 'empreintes_effacees', v_empreintes,
                            'chemins', coalesce(v_chemins, array[]::text[]));
end $$;

comment on function public.retirer_consentement_biometrie(uuid) is
  'v223 — Retire le consentement biométrique ET efface les empreintes de référence, plus les marquages qui en découlaient.';
