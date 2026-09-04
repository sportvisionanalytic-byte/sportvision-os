-- ============================================================================
-- migration-clubplus-v56-import-effectif-anti-doublon.sql (03/09/2026)
-- ============================================================================
-- Chantier Fouka du 03/09/2026 ("effectifs/Smart Links/QR/affiliations", priorité choisie en
-- premier parmi 5 : anti-doublon + import CSV effectif, fondation indispensable avant Smart
-- Links/QR et avant la transition de saison).
--
-- Audit préalable (voir mémoire sportvision_clubplus_effectifs_smartlinks_qr_master_prompt) :
-- `player_profiles` EST déjà la "personne canonique" (pas de table `persons` séparée à créer —
-- réutilisation stricte de l'existant, conforme à la consigne "audite avant de créer"). Un
-- `player_profiles` avec `user_id is null` et `account_status='sans_compte'` EST déjà, dans ce
-- schéma, la distinction ROSTER ENTRY (joueur déclaré par le club) vs MEMBERSHIP (compte Connect
-- actif) que le master prompt demandait — pas de nouvelle colonne nécessaire, juste une nouvelle
-- fonction d'import qui écrit dans ce schéma existant.
--
-- `player_profiles` n'a AUCUNE policy INSERT aujourd'hui (seulement select/update/delete pour
-- admin/éducateur/parent/self) : toute création passe par une fonction security definer qui fait
-- elle-même le contrôle d'autorisation — cohérent avec le patron déjà utilisé partout ailleurs
-- dans ce fichier (validate_team_membership, etc.). Pas de nouvelle policy RLS ajoutée ici.
--
-- Règle d'anti-doublon verrouillée par Fouka le même jour (voir mémoire
-- sportvision_clubplus_connect_affiliation_regles_03-09) : jamais prénom+nom seul. Correspondance
-- FORTE = prénom + nom + (date de naissance OU numéro de licence) → réutilisation automatique du
-- profil existant. Correspondance MOYENNE (nom sans date de naissance fiable) = jamais fusionnée
-- automatiquement, toujours signalée pour vérification humaine, jamais un simple rapprochement de
-- nom (MATCH FAIBLE) ne déclenche quoi que ce soit.
-- ============================================================================

create extension if not exists unaccent;

-- Normalisation nom/prénom pour comparaison — insensible aux accents/casse/espaces multiples,
-- jamais utilisée seule comme preuve de correspondance (voir match_player_candidates ci-dessous :
-- toujours combinée à date de naissance ou licence pour une correspondance FORTE).
create or replace function normalize_person_name(p_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(unaccent(coalesce(p_text, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;

-- Renvoie les profils existants du club dont le nom normalisé correspond, classés forte/moyenne.
-- Jamais de résultat sur nom seul sans qu'un des deux camps n'ait au moins une info de nom : la
-- classification elle-même (forte si date de naissance ou licence coïncide, moyenne sinon) est
-- ensuite utilisée par import_club_players pour décider fusion automatique ou création prudente.
create or replace function match_player_candidates(
  p_club_id uuid,
  p_prenom text,
  p_nom text,
  p_date_naissance date,
  p_numero_licence text default null
)
returns table(player_id uuid, match_strength text, existing_prenom text, existing_nom text, existing_date_naissance date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_club_admin(p_club_id) then
    raise exception 'Non autorisé';
  end if;

  return query
  select
    pp.id,
    case
      when p_numero_licence is not null and pp.numero_licence is not null and pp.numero_licence = p_numero_licence then 'forte'
      when p_date_naissance is not null and pp.date_naissance = p_date_naissance then 'forte'
      else 'moyenne'
    end as match_strength,
    pp.prenom,
    pp.nom,
    pp.date_naissance
  from player_profiles pp
  where pp.club_id = p_club_id
    and normalize_person_name(pp.prenom) = normalize_person_name(p_prenom)
    and normalize_person_name(pp.nom) = normalize_person_name(p_nom);
end;
$$;
revoke all on function match_player_candidates(uuid, text, text, date, text) from public;
grant execute on function match_player_candidates(uuid, text, text, date, text) to authenticated;

-- Aperçu AVANT import (§6 du master prompt : "afficher un preview... ne jamais fusionner
-- automatiquement une correspondance ambiguë"). N'écrit rien. p_rows : tableau jsonb d'objets
-- {prenom, nom, date_naissance (ISO), numero_licence?}.
create or replace function preview_club_players_import(p_club_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_idx int := 0;
  v_results jsonb := '[]'::jsonb;
  v_prenom text;
  v_nom text;
  v_date_naissance date;
  v_licence text;
  v_strong_count int;
  v_medium_count int;
begin
  if not is_club_admin(p_club_id) then
    raise exception 'Non autorisé';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_prenom := trim(coalesce(v_row->>'prenom', ''));
    v_nom := trim(coalesce(v_row->>'nom', ''));
    begin
      v_date_naissance := nullif(v_row->>'date_naissance', '')::date;
    exception when others then
      v_date_naissance := null;
    end;
    v_licence := nullif(trim(coalesce(v_row->>'numero_licence', '')), '');

    if v_prenom = '' or v_nom = '' or v_date_naissance is null then
      v_results := v_results || jsonb_build_object('index', v_idx, 'categorie', 'erreur');
      continue;
    end if;

    select
      count(*) filter (where match_strength = 'forte'),
      count(*) filter (where match_strength = 'moyenne')
    into v_strong_count, v_medium_count
    from match_player_candidates(p_club_id, v_prenom, v_nom, v_date_naissance, v_licence);

    v_results := v_results || jsonb_build_object(
      'index', v_idx,
      'categorie', case
        when v_strong_count = 1 then 'existant'
        when v_strong_count > 1 then 'ambigu'
        when v_medium_count > 0 then 'a_verifier'
        else 'nouveau'
      end
    );
  end loop;

  return jsonb_build_object('resultats', v_results);
end;
$$;
revoke all on function preview_club_players_import(uuid, jsonb) from public;
grant execute on function preview_club_players_import(uuid, jsonb) to authenticated;

-- Import réel. Chaque ligne est traitée dans son propre bloc exception (savepoint implicite) :
-- une ligne en erreur n'annule jamais les lignes déjà traitées (§92 "ne pas laisser 183
-- correctement créés et 117 cassés sans moyen de reprise"). Idempotent par construction : un
-- deuxième import du même CSV retrouve les mêmes joueurs par correspondance FORTE (date de
-- naissance obligatoire dans les deux imports) et met seulement à jour team_memberships
-- (on conflict), sans jamais recréer player_profiles (§93 "double import ne double pas effectif").
-- N'attache automatiquement QUE sur correspondance forte et univoque — un homonyme réel partageant
-- la même date de naissance (jamais rencontré mais pas impossible) désactive la fusion et crée un
-- nouveau profil plutôt que de deviner lequel des deux la ligne concerne.
create or replace function import_club_players(
  p_club_id uuid,
  p_team_id uuid,
  p_saison text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_idx int := 0;
  v_results jsonb := '[]'::jsonb;
  v_prenom text;
  v_nom text;
  v_date_naissance date;
  v_licence text;
  v_maillot text;
  v_player_id uuid;
  v_strong_count int;
  v_status text;
begin
  if not is_club_admin(p_club_id) then
    raise exception 'Seul un administrateur du club peut importer un effectif';
  end if;
  if p_team_id is not null and not exists (select 1 from club_teams where id = p_team_id and club_id = p_club_id) then
    raise exception 'Équipe introuvable pour ce club';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_prenom := trim(coalesce(v_row->>'prenom', ''));
      v_nom := trim(coalesce(v_row->>'nom', ''));
      v_date_naissance := nullif(v_row->>'date_naissance', '')::date;
      v_licence := nullif(trim(coalesce(v_row->>'numero_licence', '')), '');
      v_maillot := nullif(trim(coalesce(v_row->>'numero_maillot', '')), '');

      if v_prenom = '' or v_nom = '' or v_date_naissance is null then
        v_results := v_results || jsonb_build_object('index', v_idx, 'statut', 'erreur', 'message', 'Prénom, nom et date de naissance sont obligatoires.');
        continue;
      end if;

      select count(*) filter (where match_strength = 'forte')
      into v_strong_count
      from match_player_candidates(p_club_id, v_prenom, v_nom, v_date_naissance, v_licence);

      v_player_id := null;
      if v_strong_count = 1 then
        select pc.player_id into v_player_id
        from match_player_candidates(p_club_id, v_prenom, v_nom, v_date_naissance, v_licence) pc
        where pc.match_strength = 'forte';
        v_status := 'existant';
      else
        insert into player_profiles (club_id, prenom, nom, date_naissance, numero_licence, numero_maillot, account_status, created_by)
        values (p_club_id, v_prenom, v_nom, v_date_naissance, v_licence, v_maillot, 'sans_compte', auth.uid())
        returning id into v_player_id;
        v_status := 'nouveau';
      end if;

      if p_team_id is not null then
        insert into team_memberships (player_id, team_id, club_id, saison, statut)
        values (v_player_id, p_team_id, p_club_id, p_saison, 'active')
        on conflict (player_id, team_id, saison) do update set statut = 'active';
      end if;

      v_results := v_results || jsonb_build_object('index', v_idx, 'statut', v_status, 'player_id', v_player_id);
    exception when others then
      v_results := v_results || jsonb_build_object('index', v_idx, 'statut', 'erreur', 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('resultats', v_results);
end;
$$;
revoke all on function import_club_players(uuid, uuid, text, jsonb) from public;
grant execute on function import_club_players(uuid, uuid, text, jsonb) to authenticated;

-- ============================================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- Avec un club de test et un compte admin :
--   1. preview_club_players_import avec une ligne neuve → categorie 'nouveau'.
--   2. import_club_players avec cette même ligne → statut 'nouveau', un player_profiles créé.
--   3. Réimporter EXACTEMENT la même ligne (même date de naissance) → statut 'existant', AUCUN
--      nouveau player_profiles (select count(*) inchangé), team_memberships juste mis à jour.
--   4. Importer une ligne avec même prénom+nom mais date de naissance différente → statut
--      'nouveau' (pas de fusion sur nom seul).
--   5. Appeler ces 3 fonctions avec un compte non-admin du club → exception "Non autorisé".
-- ============================================================================
