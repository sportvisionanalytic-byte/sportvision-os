-- migration-clubplus-onboarding-race-31-08.sql
--
-- Audit Auth/Signup/Onboarding Club+ (31/08/2026) : clubplus-onboarding (self-service Club+
-- Gratuit, seule route de tout le repo à créer un club sans validation staff ni Stripe) affirme
-- dans son propre commentaire être "Idempotente : si l'utilisateur a déjà une ligne club_members,
-- la renvoie telle quelle sans rien recréer" — mais l'implémentation faisait un SELECT (ligne
-- ~131) puis, bien plus loin, un INSERT séparé (lignes ~145-168), exactement le motif que ce
-- fichier avait déjà corrigé pour le rattachement `clients` juste en dessous (voir
-- find_or_create_client_by_email, "l'ancien motif SELECT puis INSERT séparés laissait une fenêtre
-- de course"). Reproduit et vérifié en réel : le double effect de React Strict Mode (dev
-- uniquement, mais deux onglets/un retry réseau produiraient exactement la même course en
-- production) sur src/app/auth/confirming/page.tsx a fait consommer le pending onboarding deux
-- fois pour le même utilisateur — DEUX clubs "Club Test Audit Gratuit" créés, le même user_id
-- admin des deux (club_members.user_id n'a qu'une contrainte UNIQUE(user_id, club_id), jamais sur
-- user_id seul — un rôle "cm_externe" existe pour un futur cas légitime multi-club, donc pas de
-- contrainte globale ajoutée ici).
--
-- Fix : même remède que find_or_create_client_by_email — tout le "vérifier puis créer" déplacé
-- dans une fonction Postgres SECURITY DEFINER unique, verrouillée par pg_advisory_xact_lock scopé
-- à l'utilisateur. Le verrou est tenu pour toute la durée de LA TRANSACTION DE CETTE FONCTION (un
-- appel RPC = une transaction) : un deuxième appel concurrent pour le même utilisateur attend que
-- le premier commit, puis retrouve la ligne club_members fraîchement créée et répond
-- already_onboarded=true au lieu de créer un second club.

create or replace function public.clubplus_claim_self_service_onboarding(
  p_user_id uuid,
  p_club_nom text,
  p_ville text,
  p_discipline text,
  p_plan text,
  p_engagement text,
  p_credits integer,
  p_prenom text,
  p_nom text,
  p_telephone text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing record;
  v_club_id uuid;
begin
  if p_user_id is null then
    raise exception 'user_id requis';
  end if;
  if p_club_nom is null or btrim(p_club_nom) = '' then
    raise exception 'club_nom requis';
  end if;

  -- Sérialise tous les appels concurrents pour un même utilisateur (double effect React,
  -- double onglet, retry réseau) — verrou relâché automatiquement à la fin de cette transaction.
  perform pg_advisory_xact_lock(hashtext('clubplus-onboarding:' || p_user_id::text));

  select cm.club_id, cm.role into v_existing
  from club_members cm
  where cm.user_id = p_user_id
  limit 1;

  if found then
    return jsonb_build_object('club_id', v_existing.club_id, 'role', v_existing.role, 'already_onboarded', true);
  end if;

  insert into clubs (nom, ville, discipline, plan, engagement, credits_monthly, credits_balance)
  values (btrim(p_club_nom), p_ville, p_discipline, p_plan, coalesce(p_engagement, '12mois'), p_credits, p_credits)
  returning id into v_club_id;

  insert into club_members (user_id, club_id, role, prenom, nom, telephone, status)
  values (p_user_id, v_club_id, 'admin', p_prenom, p_nom, p_telephone, 'actif');

  return jsonb_build_object('club_id', v_club_id, 'role', 'admin', 'already_onboarded', false);
end;
$$;

grant execute on function public.clubplus_claim_self_service_onboarding(uuid, text, text, text, text, text, integer, text, text, text) to anon, authenticated, service_role;
