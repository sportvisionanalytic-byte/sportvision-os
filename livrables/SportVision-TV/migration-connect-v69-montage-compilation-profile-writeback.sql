-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v69
-- Écriture retour, sûre en cas de double-soumission, des infos physiques/maillot du wizard
-- Montage Compilation (migration-connect-v68) sur le profil du bénéficiaire — "saisi une fois,
-- jamais redemandé" (décidé par Fouka le 15/08). Câblage frontend (formulaire, pré-remplissage,
-- appel de cette fonction depuis connect-player-prestations) fait dans le même chantier, côté
-- app-connect + edge function.
--
-- ────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE FONCTION SQL PLUTÔT QU'UN .update() SUPABASE-JS CLASSIQUE
-- ────────────────────────────────────────────────────────────────────────
--
-- La règle produit est stricte : ne JAMAIS écraser une valeur déjà connue du profil, même en cas
-- de double-soumission (double-clic, retry réseau, deux réservations concurrentes pour le même
-- sportif géré par deux comptes différents). Un aller-retour SELECT (lire l'existant côté edge
-- function) puis UPDATE (écrire le merge calculé en JS) laisse une fenêtre de course : deux
-- requêtes concurrentes peuvent toutes les deux lire NULL avant qu'aucune n'ait écrit, puis
-- écraser l'une la valeur de l'autre. `UPDATE ... SET col = coalesce(col, $valeur)` est atomique
-- côté Postgres — la valeur de `col` relue au moment de l'UPDATE (jamais celle lue par un SELECT
-- antérieur) gagne toujours si elle est déjà non NULL, quel que soit l'ordre d'arrivée des
-- requêtes concurrentes. PostgREST (utilisé par supabase-js) ne permet pas d'exprimer un
-- `coalesce(col, ...)` dans un .update() — d'où cette fonction, appelée par l'edge function via
-- le client service_role (même patron que connect_declare_club, migration-connect-v54).
--
-- p_target_user_id / p_managed_id sont des paramètres explicites (pas auth.uid()) car appelée en
-- service_role, qui n'a pas de JWT utilisateur — l'edge function a DÉJÀ vérifié le droit du
-- caller à réserver pour ce bénéficiaire (resolveBeneficiaryClientId /
-- connect_resolve_beneficiary_client_id, migration-connect-v51) avant d'arriver jusqu'ici ; cette
-- fonction ne revérifie donc rien d'autre que la validité de p_kind. EXECUTE réservé à
-- service_role uniquement (jamais authenticated/anon) pour qu'un client ne puisse jamais appeler
-- cette fonction directement et écrire sur le profil de n'importe qui en contournant ce contrôle.
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor. Idempotente
-- (create or replace function).
-- ============================================================

create or replace function connect_athlete_profile_coalesce_update(
  p_kind text,               -- 'self' | 'linked' | 'managed'
  p_target_user_id uuid,     -- player_profiles.user_id à cibler ("self"/"linked" uniquement)
  p_managed_id uuid,         -- managed_athlete_profiles.id à cibler ("managed" uniquement)
  p_taille_cm integer,
  p_poids_kg numeric,
  p_poste text,
  p_numero_maillot text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'managed' then
    if p_managed_id is null then
      raise exception 'Sportif géré requis.';
    end if;
    update managed_athlete_profiles set
      taille_cm = coalesce(taille_cm, p_taille_cm),
      poids_kg = coalesce(poids_kg, p_poids_kg),
      poste = coalesce(nullif(poste, ''), nullif(p_poste, '')),
      numero_maillot = coalesce(nullif(numero_maillot, ''), nullif(p_numero_maillot, ''))
    where id = p_managed_id;
  elsif p_kind = 'self' or p_kind = 'linked' then
    if p_target_user_id is null then
      raise exception 'Utilisateur requis.';
    end if;
    -- player_profiles.numero_maillot existe depuis migration-clubplus-v13 (réutilisé tel quel,
    -- même règle coalesce que les 3 autres colonnes ajoutées par v68).
    update player_profiles set
      taille_cm = coalesce(taille_cm, p_taille_cm),
      poids_kg = coalesce(poids_kg, p_poids_kg),
      poste = coalesce(nullif(poste, ''), nullif(p_poste, '')),
      numero_maillot = coalesce(nullif(numero_maillot, ''), nullif(p_numero_maillot, ''))
    where user_id = p_target_user_id;
  else
    raise exception 'Bénéficiaire invalide.';
  end if;
end;
$$;

revoke all on function connect_athlete_profile_coalesce_update(text, uuid, uuid, integer, numeric, text, text) from public;
grant execute on function connect_athlete_profile_coalesce_update(text, uuid, uuid, integer, numeric, text, text) to service_role;

-- ============================================================
-- FIN.
-- ============================================================
