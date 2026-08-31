-- ============================================================================
-- migration-poles-v14-separation-collaborateurs.sql
-- Sépare les COLLABORATEURS par pôle (jusqu'ici seules les données métier —
-- clients/prestations/contrats/devis/factures/kits/frais — l'étaient, cf.
-- migration-poles-v3/v6/v10). Demandé par Fouka le 31/08/2026 : "ceux du foot
-- ne sont pas les mêmes que le basket, il faut tout séparer" — précisé
-- ensuite : séparation stricte par défaut, mais un collaborateur peut être
-- explicitement flexible multi-sport, et un nouveau rôle "Secrétaire
-- générale / RH" doit voir tous les pôles.
--
-- CONSTAT VÉRIFIÉ EN DIRECT AVANT CETTE MIGRATION :
--   - policy "Staff lecture annuaire" sur profiles = `using (is_staff())`,
--     un booléen UNIQUE sans granularité par ligne : tout membre du staff lit
--     l'intégralité de la table profiles, quel que soit son pôle.
--   - is_staff() (SECURITY DEFINER, sans argument) est réutilisée TELLE QUELLE
--     dans ~70 autres policies (messages, disponibilites, materiels,
--     kit_controles, formations, media_*...) — signature volontairement
--     INCHANGÉE ici, seule sa liste de rôles autorisés est étendue (+'rh'),
--     changement additif sans risque pour les ~70 autres usages.
--   - Aucun collaborateur n'est aujourd'hui affecté à plus d'un pôle (vérifié :
--     select user_id, count(*) from pole_affectations group by user_id having
--     count(*)>1 -> vide) : rien à corriger rétroactivement.
--   - notify_staff_by_role() reçoit déjà p_prestation_id/p_client_id sur la
--     quasi-totalité de ses ~10 points d'appel : le pôle concerné se dérive
--     DEDANS la fonction, signature inchangée, zéro appelant à modifier.
--
-- pole_affectations reste many-to-many (AUCUNE contrainte d'unicité ajoutée) :
-- c'est ce qui permet nativement les 3 cas demandés — 1 ligne = collaborateur
-- mono-pôle (le défaut), 2+ lignes = collaborateur flexible multi-sport, et
-- le rôle 'rh' obtient un accès global PAR SON RÔLE (zéro ligne
-- pole_affectations nécessaire) plutôt que par affectation à chaque pôle —
-- généralise automatiquement à un futur pôle (Handball...) sans geste manuel.
-- ============================================================================

-- 1) Nouveau rôle 'rh' (Secrétaire générale / RH, accès staff transversal à
--    tous les pôles, mais PAS aux données client/prestation/finance — celles-
--    ci restent scopées comme avant, admin seul bypass).
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin','sec','prod','photo','cm','compta','com','expert_comptable','auditeur','rh']));

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('admin','sec','prod','photo','cm','compta','com','rh')
      and not exists (
        select 1 from memberships m
        join organizations o on o.id = m.organization_id
        where m.user_id = p.id and o.organization_type <> 'cm_agency'
      )
      and not exists (select 1 from player_profiles pp where pp.user_id = p.id)
      and not exists (select 1 from connect_profile_settings cps where cps.user_id = p.id)
  );
$function$;

-- 2) Deux nouveaux helpers SECURITY DEFINER (même garantie anti-récursion que
--    pole_scope_ok()/is_pole_responsable() cette nuit : bypassent RLS, donc
--    aucun risque même utilisés DANS une policy sur profiles elle-même).
create or replace function public.is_admin_or_rh()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','rh'));
$function$;

comment on function public.is_admin_or_rh() is 'Vrai si le compte appelant est admin ou rh (Secrétaire générale) -- les deux seuls rôles avec visibilité collaborateurs transversale à tous les pôles. Ne donne AUCUN accès aux données client/prestation/finance (pole_scope_ok/pole_finance_access_ok restent admin-only, inchangées).';

create or replace function public.profile_shares_pole_with_caller(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from pole_affectations pa
    where pa.user_id = p_profile_id and pa.pole_id = any (get_my_pole_ids())
  );
$function$;

comment on function public.profile_shares_pole_with_caller(uuid) is 'Vrai si le profil ciblé partage au moins un pôle avec l''appelant (via pole_affectations) -- un collaborateur flexible (2+ pôles) est visible par les deux côtés.';

-- 3) RLS profiles : le correctif racine. La visibilité de sa propre fiche
--    reste couverte par la policy "Lecture profil personnel" déjà existante
--    (auth.uid() = id), inchangée -- pas besoin de la redupliquer ici.
drop policy if exists "Staff lecture annuaire" on public.profiles;
create policy "Staff lecture annuaire" on public.profiles
  for select using (
    is_staff() and (is_admin_or_rh() or profile_shares_pole_with_caller(id))
  );

-- 4) notify_staff_by_role : dérive le pôle depuis p_prestation_id/p_client_id
--    (déjà transmis par la quasi-totalité des appelants) -- signature
--    inchangée, zéro modification dans les ~10 fichiers appelants.
create or replace function public.notify_staff_by_role(
  p_roles text[], p_titre text, p_message text, p_priorite text,
  p_prestation_id uuid, p_client_id uuid, p_clubplus_signup_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pole_id uuid;
begin
  if p_prestation_id is not null then
    select pole_id into v_pole_id from prestations where id = p_prestation_id;
  elsif p_client_id is not null then
    select pole_id into v_pole_id from clients where id = p_client_id;
  end if;

  insert into notifications (
    type, titre, message, destinataire_id, lue, priorite,
    lien_prestation_id, lien_client_id, lien_clubplus_signup_request_id, created_at
  )
  select 'systeme', p_titre, p_message, pr.id, false, p_priorite,
    p_prestation_id, p_client_id, p_clubplus_signup_request_id, now()
  from profiles pr
  where pr.role = any (p_roles)
    and (
      v_pole_id is null                          -- événement sans pôle identifiable (ex. club_signup_request) : comportement inchangé, notifie tout le rôle
      or pr.role in ('admin','rh')                -- accès transversal par rôle
      or exists (select 1 from pole_affectations pa where pa.user_id = pr.id and pa.pole_id = v_pole_id)
    );
end;
$function$;

-- 5) ensure_default_pole_affectation : accepte désormais p_meta->'pole_ids'
--    (tableau, collaborateur flexible multi-sport si 2+ éléments), garde la
--    compat avec l'ancien p_meta->>'pole_id' singulier, et ne crée AUCUNE
--    ligne pole_affectations pour le rôle 'rh' (accès global par rôle, pas
--    par affectation -- généralise à un futur pôle sans geste manuel).
create or replace function public.ensure_default_pole_affectation(p_user_id uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_pole_ids uuid[];
  v_single uuid;
  v_id uuid;
begin
  v_role := p_meta->>'role';
  if v_role = 'rh' then
    return; -- accès global par rôle (is_admin_or_rh()), pas par pole_affectations
  end if;

  v_pole_ids := null;
  if jsonb_typeof(p_meta->'pole_ids') = 'array' then
    begin
      select array_agg((elem)::uuid) into v_pole_ids
        from jsonb_array_elements_text(p_meta->'pole_ids') as elem
        where elem is not null and elem <> '';
    exception when others then
      v_pole_ids := null;
    end;
  end if;

  if v_pole_ids is null or array_length(v_pole_ids, 1) is null then
    -- Compat ascendante : ancien format à pôle unique (migration-poles-v11/v12).
    begin
      v_single := nullif(p_meta->>'pole_id', '')::uuid;
    exception when others then
      v_single := null;
    end;
    if v_single is not null then
      v_pole_ids := array[v_single];
    end if;
  end if;

  -- Filtre les ids invalides (pôle inexistant) plutôt que d'échouer.
  if v_pole_ids is not null then
    select array_agg(x) into v_pole_ids
      from unnest(v_pole_ids) x
      where exists (select 1 from public.poles where id = x);
  end if;

  if v_pole_ids is null or array_length(v_pole_ids, 1) is null then
    v_pole_ids := array[pole_football_id()];
  end if;

  foreach v_id in array v_pole_ids loop
    insert into public.pole_affectations (pole_id, user_id, role_pole)
    values (v_id, p_user_id, 'membre')
    on conflict (pole_id, user_id) do nothing;
  end loop;
end;
$function$;

comment on function public.ensure_default_pole_affectation(uuid, jsonb) is 'Affecte un profil nouvellement créé à un ou plusieurs pôles sportifs (role_pole=''membre''), via p_meta->''pole_ids'' (tableau, posé par invite-collaborateur -- 2+ éléments = collaborateur flexible multi-sport) ou p_meta->>''pole_id'' (compat ascendante, singulier), sinon Football par défaut. AUCUNE affectation pour le rôle ''rh'' (accès global par rôle, migration-poles-v14). Appelée par handle_new_user() ET handle_user_invited().';

-- ============================================================================
-- ROLLBACK (documenté, non exécuté) :
--   - alter table profiles drop constraint profiles_role_check; alter table
--     profiles add constraint profiles_role_check check (role = any (array[
--     'admin','sec','prod','photo','cm','compta','com','expert_comptable',
--     'auditeur'])); -- ⚠ échouera si un compte 'rh' existe déjà, le
--     réaffecter d'abord.
--   - restaurer is_staff() sans 'rh' dans sa liste (voir corps ci-dessus).
--   - drop policy "Staff lecture annuaire" on profiles; recréer `using
--     (is_staff())` (voir historique migration-notification-prefs.sql).
--   - drop function is_admin_or_rh(); drop function
--     profile_shares_pole_with_caller(uuid);
--   - restaurer notify_staff_by_role() sans dérivation de pôle (voir
--     migration-connect-v78-signup-unifie-clubplus.sql pour le corps exact).
--   - restaurer ensure_default_pole_affectation() à pôle singulier (voir
--     migration-poles-v12-fix-onboarding-affectation-vrai-chemin.sql).
-- Aucune donnée existante modifiée par cette migration (elle n'ajoute que du
-- code + une valeur de CHECK) : aucun rollback de données nécessaire.
-- ============================================================================
