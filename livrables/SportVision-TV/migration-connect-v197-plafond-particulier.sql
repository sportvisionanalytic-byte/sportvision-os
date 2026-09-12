-- v197 — Le plafond de sportifs ne se contourne plus en sautant une question (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. `connect_particulier_limit` et `connect_respond_profile_access_request`
-- rendaient toutes deux 999 dès que `profil_particulier` était vide, avec ce commentaire :
-- « profil jamais choisi (compte pré-v67) : pas de plafond rétroactif ».
--
-- Le raisonnement était juste pour les comptes qui existaient au moment de la v67. Il s'est
-- appliqué à tous les comptes créés DEPUIS, parce que le tunnel d'inscription ne persiste rien
-- quand on répond « Particulier » : `resolveProfilParticulier` ne renvoie une valeur que pour
-- agent, parent, tuteur et autre. La colonne reste donc vide, et le plafond ne s'applique jamais.
--
-- Un agent qui clique « Particulier » plutôt que « Agent / représentant » — le libellé affiché est
-- « Je souhaite réserver ou suivre une prestation SportVision », rien n'indique que c'est un choix
-- tarifaire — suit 30 sportifs sans payer un centime, et l'entrée « Mon abonnement » ne lui est
-- même pas proposée.
--
-- CE QUE FAIT CETTE MIGRATION. L'exemption redevient ce qu'elle devait être : une clause de
-- droits acquis, bornée aux comptes antérieurs à la v67. Tout compte créé depuis est plafonné
-- comme un parent (3), le temps qu'il choisisse son profil. Le tunnel d'inscription est corrigé
-- en parallèle pour écrire 'autre' sur le choix « Particulier ».
--
-- La date de bascule : 16/08/2026, lendemain de la décision du 15/08 qui a créé la colonne.
-- Idempotente.

create or replace function public.connect_particulier_limit(p_user_id uuid)
returns integer language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_profil text;
  v_cree timestamptz;
begin
  if auth.uid() is null or (auth.uid() <> p_user_id and not is_staff()) then
    raise exception 'Accès refusé.';
  end if;

  select profil_particulier, created_at into v_profil, v_cree
    from connect_profile_settings where user_id = p_user_id;

  if v_profil = 'agent' then
    return connect_agent_tier_limit(connect_agent_effective_tier(p_user_id));
  elsif v_profil in ('parent', 'tuteur', 'autre') then
    return 3;
  elsif v_cree is not null and v_cree < timestamptz '2026-08-16 00:00:00+00' then
    return 999; -- droits acquis : compte antérieur à la v67, jamais interrogé sur son profil
  else
    return 3;   -- profil non renseigné sur un compte récent : plafond de parent, pas d'exemption
  end if;
end;
$function$;

-- Même correction dans la fonction qui applique réellement le paywall.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc
   where proname = 'connect_respond_profile_access_request' and pronamespace = 'public'::regnamespace;
  if v_src is null then raise exception 'connect_respond_profile_access_request introuvable'; end if;
  if position('compte pré-v67' in v_src) = 0 then
    raise notice 'Déjà corrigée, rien à faire.';
    return;
  end if;
  v_src := replace(v_src,
    'v_limit := 999; -- profil jamais choisi (compte pré-v67) : pas de plafond rétroactif',
    'v_limit := case when (select cps.created_at from connect_profile_settings cps
                           where cps.user_id = v_proprietaire) < timestamptz ''2026-08-16 00:00:00+00''
                     then 999 else 3 end; -- droits acquis pré-v67 seulement (v197)');
  execute v_src;
end $$;
