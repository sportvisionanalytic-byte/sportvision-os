-- v384 — CONSTITUER L'EFFECTIF AVANT QUE LES FAMILLES ARRIVENT (01/10/2026)
--
-- Demande de Fouka, mot pour mot : « J'ai fait le média avec Fontainebleau. J'ai tous les noms,
-- prénoms, et les photos de tous les joueurs. Du coup je peux créer moi-même les profils des
-- joueurs. » Et : « Qui a le droit de créer : moi, le CM, et le coach uniquement pour sa catégorie. »
--
-- ═══ CE QUI EXISTE DÉJÀ, ET QU'ON NE REFAIT PAS ════════════════════════════════════════════════
--
-- Toute la suite du parcours est en place et vérifiée. Une fiche créée d'avance n'est pas un
-- doublon en attente : `request_team_membership_for_child` (durcie le 12/09) cherche d'abord si le
-- club connaît déjà l'enfant — même club, même date de naissance, noms normalisés — et rattache
-- alors la demande à CETTE fiche au lieu d'en créer une seconde. Le lien parental part en
-- `en_attente_confirmation` dans ce cas, et c'est volontaire : un nom plus une date de naissance ne
-- prouvent pas qu'on est le parent (leçon v102).
--
-- Et pour que la famille n'attende pas ce feu vert, le chemin nominatif existe aussi :
-- `clubplus-family-invite` crée une `parent_invitations` portant `player_id`, et
-- `accept_parent_invitation` pose le lien en `confirme` d'emblée — parce que là, c'est le CLUB qui a
-- désigné la personne par son adresse e-mail.
--
-- ═══ CE QUI MANQUE, MESURÉ PAR LE CHEMIN RÉEL ══════════════════════════════════════════════════
--
-- Un `insert into player_profiles` sur RCP Fontainebleau, en rôle `authenticated`, avec les claims
-- de chacun, en transaction annulée :
--
--     administration SportVision   → fiche créée          (peut_operer_club : rôle admin)
--     Production SportVision       → 42501 REFUSÉE         ← et elle ne voit même aucune fiche
--     CM SportVision affecté       → fiche créée
--     CM SportVision non affecté   → 42501 REFUSÉE         (correct)
--     président du club            → fiche créée           (is_club_admin)
--     coach U9                     → 42501 REFUSÉE         ← et il voit 0 fiche
--     coach U16A                   → 42501 REFUSÉE         ← il voit 1 fiche (par team_memberships)
--     opérateur terrain            → 42501 REFUSÉE         (correct)
--
-- Deux trous, donc, et un seul des deux est une question de policy.
--
-- ═══ POURQUOI UNE FONCTION, ET PAS UNE POLICY POUR LE COACH ════════════════════════════════════
--
-- Parce que l'équipe n'est pas une colonne de `player_profiles`. Le périmètre d'un coach se lit sur
-- `team_memberships`, qui n'existe pas encore à l'instant où la fiche s'insère : une policy
-- `with check` sur l'insertion n'a donc RIEN à interroger. Lui ouvrir l'insertion sans borne, c'est
-- lui ouvrir tout le club — exactement ce que Fouka a exclu.
--
-- La fiche et l'appartenance d'équipe s'écrivent donc ensemble, dans une fonction qui reçoit
-- l'équipe et vérifie le droit SUR elle. `is_team_educateur` fait déjà foi partout ailleurs pour
-- cette question : on ne récrit pas la règle, on l'appelle.
--
-- ═══ CE QUE CETTE MIGRATION CHANGE, ET RIEN D'AUTRE ════════════════════════════════════════════
--
-- 1. La Production voit les fiches joueurs de tous les clubs, et peut les corriger. On n'élargit
--    PAS `peut_operer_club` pour autant : `prod` en est volontairement absent, et l'y ajouter
--    changerait le comportement de dizaines de policies sous gel fonctionnel. Deux policies
--    nommées, lisibles, bornées à cette table.
-- 2. Deux fonctions : savoir si on a le droit, et constituer l'effectif.
--
-- Rien sur la biométrie. La photo de référence, c'est la v385, et elle ne se dépose pas ici.

begin;

-- ═══ 1. LA PRODUCTION, PARTOUT ═════════════════════════════════════════════════════════════════
-- Fouka : « l'administration et la production de SportVision partout ». L'administration passe déjà
-- par `peut_operer_club`. La Production, non : son rôle `prod` n'est pas dans la liste de cette
-- fonction, et c'est un choix (voir `media_retention_effacer`, qui distingue explicitement les
-- deux). On ouvre donc ici, et ici seulement.

create or replace function public.est_direction_sportvision()
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  -- L'administration et la Production, actives. Volontairement PAS `is_staff()` : un opérateur
  -- terrain en fait partie, et il n'a rien à faire dans le fichier joueurs d'un club.
  select exists (
    select 1 from profiles p
     where p.id = auth.uid() and p.actif and p.role in ('admin', 'prod')
  ) and not public.compte_os_desactive();
$$;

drop policy if exists pp_direction_select on public.player_profiles;
create policy pp_direction_select on public.player_profiles
  for select using (public.est_direction_sportvision());

drop policy if exists pp_direction_update on public.player_profiles;
create policy pp_direction_update on public.player_profiles
  for update using (public.est_direction_sportvision())
  with check (public.est_direction_sportvision());

-- ═══ 2. QUI PEUT CONSTITUER L'EFFECTIF D'UNE ÉQUIPE ════════════════════════════════════════════
-- Une seule vérité, interrogée par la fonction d'écriture ET par les écrans. Un écran qui devine le
-- droit affiche un bouton qui échoue, ou cache un bouton qui marcherait.

create or replace function public.effectif_peut_constituer(p_team_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from club_teams t where t.id = p_team_id and not coalesce(t.archivee, false))
     and (
       -- L'administration et la Production de SportVision, sur tous les clubs.
       public.est_direction_sportvision()
       -- Le CM affecté au club, et le bureau du club : l'autorité qui opère déjà ce club.
       or public.peut_operer_equipe(p_team_id)
       -- Le coach, sur SES équipes. `club_members.teams` borne, et lui seul : un coach ne peut pas
       -- s'élargir son propre périmètre (gelé par la v97).
       or public.is_team_educateur(p_team_id)
     );
$$;

-- ═══ 3. CONSTITUER L'EFFECTIF ══════════════════════════════════════════════════════════════════
-- En lot, parce que Fouka a des catégories entières à saisir. Et idempotente, parce qu'un import
-- qu'on ne peut pas rejouer sans créer des doublons n'est pas un import : c'est un pari.

-- `fiche_id` et non `player_id` : un paramètre de sortie qui porte le nom d'une colonne rend
-- `on conflict (player_id, …)` AMBIGU, et Postgres refuse la requête. Mesuré au premier essai.
drop function if exists public.effectif_constituer(uuid, jsonb);
create or replace function public.effectif_constituer(p_team_id uuid, p_lignes jsonb)
returns table(rang integer, fiche_id uuid, prenom text, nom text, verdict text, detail text)
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_club uuid;
  v_saison uuid;
  v_saison_label text;
  v_n integer;
  l record;
  v_prenom text; v_nom text; v_dn date; v_maillot text; v_sexe text;
  v_id uuid;
  v_rattache integer;
begin
  if not public.effectif_peut_constituer(p_team_id) then
    raise exception 'Vous ne pouvez pas constituer l''effectif de cette équipe.' using errcode = '42501';
  end if;

  select t.club_id, t.saison_id into v_club, v_saison from club_teams t where t.id = p_team_id;

  -- L'équipe peut ne porter aucune saison (mesuré : U16C de Fontainebleau). On retombe alors sur la
  -- saison active, jamais sur rien : `team_memberships.saison` entre dans la clé d'unicité, et une
  -- saison nulle ferait échapper la ligne à l'idempotence.
  if v_saison is null then
    select s.id into v_saison from saisons s where s.active order by s.date_debut desc limit 1;
  end if;
  select s.label into v_saison_label from saisons s where s.id = v_saison;
  if v_saison_label is null then
    raise exception 'Aucune saison active : impossible de rattacher un effectif à une saison inconnue.'
      using errcode = '22023';
  end if;

  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' then
    raise exception 'Il faut une liste de sportifs.' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_lignes);
  if v_n = 0 then return; end if;
  -- CENT PAR ENVOI. Au-delà, un refus en milieu de liste devient illisible et la transaction longue
  -- bloque la table. Une catégorie entière tient largement dessous.
  if v_n > 100 then
    raise exception 'Cent sportifs au maximum par envoi. Découpez la liste.' using errcode = '22023';
  end if;

  for l in select ordinality::integer as r, value as v
             from jsonb_array_elements(p_lignes) with ordinality
  loop
    v_prenom := btrim(coalesce(l.v->>'prenom', ''));
    v_nom    := btrim(coalesce(l.v->>'nom', ''));
    v_maillot := nullif(btrim(coalesce(l.v->>'numero_maillot', '')), '');
    v_sexe   := nullif(btrim(coalesce(l.v->>'sexe', '')), '');
    v_dn     := null;
    begin
      v_dn := (nullif(btrim(coalesce(l.v->>'date_naissance', '')), ''))::date;
    exception when others then
      v_dn := null;
    end;

    if v_prenom = '' or v_nom = '' then
      return query select l.r, null::uuid, v_prenom, v_nom, 'refusee'::text,
                          'Prénom et nom sont obligatoires.'::text;
      continue;
    end if;

    -- LA DATE DE NAISSANCE NE S'INVENTE PAS, ET NE SE DÉDUIT PAS DE LA CATÉGORIE.
    --
    -- C'est elle qui décide qui donne l'accord de reconnaissance : avant 15 ans un parent, de 15 à
    -- 17 ans le sportif lui-même, majeur il décide seul (`donner_consentement_biometrie`). Une date
    -- approchée, c'est un accord recueilli auprès de la mauvaise personne — et sur de la biométrie
    -- de mineur, cet accord est tout ce qui tient.
    if v_dn is null then
      return query select l.r, null::uuid, v_prenom, v_nom, 'refusee'::text,
                          'Date de naissance manquante ou illisible (format AAAA-MM-JJ).'::text;
      continue;
    end if;
    if v_dn > (now() at time zone 'Europe/Paris')::date or v_dn < date '1930-01-01' then
      return query select l.r, null::uuid, v_prenom, v_nom, 'refusee'::text,
                          'Date de naissance invraisemblable.'::text;
      continue;
    end if;
    if v_sexe is not null and v_sexe not in ('M', 'F') then
      v_sexe := null;
    end if;

    -- LE CLUB CONNAÎT-IL DÉJÀ CET ENFANT ? Même règle de rapprochement que
    -- `request_team_membership_for_child` : même club, même date de naissance, noms normalisés.
    -- Deux chemins qui rapprochent différemment finiraient par créer les doublons que chacun
    -- croit éviter.
    select pp.id into v_id
      from player_profiles pp
     where pp.club_id = v_club
       and pp.date_naissance = v_dn
       and normalize_person_name(pp.prenom) = normalize_person_name(v_prenom)
       and normalize_person_name(pp.nom) = normalize_person_name(v_nom)
     order by pp.created_at
     limit 1;

    if v_id is null then
      insert into player_profiles (club_id, prenom, nom, date_naissance, sexe, numero_maillot,
                                   account_status, created_by)
      values (v_club, v_prenom, v_nom, v_dn, v_sexe, v_maillot, 'sans_compte', auth.uid())
      returning id into v_id;

      insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
      values (v_id, p_team_id, v_club, v_saison_label, v_saison, 'active')
      on conflict (player_id, team_id, saison) do nothing;

      return query select l.r, v_id, v_prenom, v_nom, 'creee'::text, null::text;
    else
      -- La fiche existe. On ne touche NI à son identité NI à son numéro : une fiche déjà là a
      -- peut-être été corrigée par sa famille, et un import qui écrase est un import qui efface.
      insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
      values (v_id, p_team_id, v_club, v_saison_label, v_saison, 'active')
      on conflict (player_id, team_id, saison) do nothing;
      -- `found` n'est pas garanti après un `return query` : on relève le compte tout de suite.
      get diagnostics v_rattache = row_count;

      if v_rattache > 0 then
        return query select l.r, v_id, v_prenom, v_nom, 'rattachee'::text,
                            'Fiche déjà au club, rattachée à cette équipe.'::text;
      else
        return query select l.r, v_id, v_prenom, v_nom, 'deja_presente'::text,
                            'Déjà dans cette équipe : rien à faire.'::text;
      end if;
    end if;
  end loop;
end $$;

revoke all on function public.effectif_constituer(uuid, jsonb) from public, anon;
grant execute on function public.effectif_constituer(uuid, jsonb) to authenticated;
revoke all on function public.effectif_peut_constituer(uuid) from public, anon;
grant execute on function public.effectif_peut_constituer(uuid) to authenticated;

-- ═══ UNE FONCTION DE POLICY NE SE REVOKE PAS ═══════════════════════════════════════════════════
-- Leçon du 12/09, retrouvée ici au premier passage de la suite de tests : une policy s'évalue avec
-- les DROITS DU LECTEUR. Retirer `public` de l'EXECUTE d'une fonction appelée par une policy ne
-- borne rien : elle fait ÉCHOUER la lecture (« permission denied for function ») au lieu de rendre
-- faux. Mesuré : `multiclub-cloisonnement` est passé de vert à cassé.
--
-- Toutes les fonctions de policy de cette base gardent donc `=X` : `peut_operer_club`,
-- `is_club_admin`, `is_team_educateur`, `is_confirmed_parent_of`, `compte_os_desactive`. Les
-- fonctions ci-dessous sont dans ce cas, et le restent. Le revoke ne vaut que pour les fonctions
-- d'ACTION, que personne n'évalue à la place de quelqu'un d'autre.
grant execute on function public.est_direction_sportvision() to public;

comment on function public.effectif_constituer(uuid, jsonb) is
  'Crée en lot les fiches joueurs d''une équipe et les y rattache. Droit : administration et '
  'Production SportVision partout, CM affecté et bureau du club sur leur club, coach sur SES '
  'équipes uniquement. Idempotente. Ne dépose AUCUNE photo et ne calcule AUCUNE empreinte.';

commit;
