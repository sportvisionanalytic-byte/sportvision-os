-- ═══════════════════════════════════════════════════════════════════════════════
-- FAILLE — un anonyme pouvait creer un club et y rattacher n'importe quel compte
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Reproduit en conditions reelles le 09/09/2026, en transaction annulee :
--   select clubplus_claim_self_service_onboarding('<uuid d un vrai compte>','Club','Paris',
--          'football','free','sans',0,'X','Y',null)
--   → {"role":"admin","club_id":"...","already_onboarded":false}
-- avec la seule cle publique, celle qui se trouve dans le JavaScript du site.
--
-- Aucune exploitation constatee dans les donnees. Le parcours legitime est inchange : il appelle
-- toujours la fonction avec l'identifiant de la personne connectee, c'est-a-dire auth.uid().
--
-- Le CORPS est repris a l'identique de migration-clubplus-onboarding-race-31-08.sql. Une premiere
-- version ecrite de memoire avait perdu `credits_monthly` et la valeur par defaut de l'engagement.

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
  -- On ne peut reclamer un espace QUE pour soi-meme (faille trouvee a l'audit du 09/09/2026 :
  -- p_user_id etait pris tel quel, jamais compare a l'appelant, sur une fonction SECURITY DEFINER
  -- executable par `anon` — avec la seule cle publique du site, on creait un club et on y
  -- rattachait un compte REEL comme administrateur).
  -- Le service role (edge functions) reste autorise a agir pour un tiers : le role courant n'y
  -- est ni `anon` ni `authenticated`.
  -- current_user ne convient PAS ici : dans une fonction SECURITY DEFINER il vaut le
  -- proprietaire (postgres), jamais l'appelant — un premier correctif ecrit ainsi ne bloquait
  -- rien du tout, ce qu'a montre le test. C'est le role porte par le jeton qui fait foi.
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon')
       <> 'service_role'
     and p_user_id is distinct from auth.uid() then
    raise exception 'Accès refusé : un espace ne peut être réclamé que pour son propre compte.'
      using errcode = '42501';
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

select 'OK — un espace ne peut plus etre reclame que pour soi-meme' as verdict;
