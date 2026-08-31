-- migration-poles-v12-fix-onboarding-affectation-vrai-chemin.sql
--
-- Migration multi-pôles, Lot 9 — QA/cohérence transversale, correctif du VRAI chemin
-- d'exécution manqué par migration-poles-v11 (trouvé en testant en réel, 31/08/2026,
-- juste après avoir vérifié v11 avec un 2e compte jetable — la vérification a échoué :
-- toujours zéro ligne pole_affectations pour le nouveau collaborateur).
--
-- CONSTAT : ce repo a DEUX triggers distincts sur auth.users qui créent chacun une ligne
-- `profiles`, pas un seul :
--   - on_auth_user_created (AFTER INSERT) -> handle_new_user() -- celle patchée par v11.
--   - on_auth_user_invited (AFTER UPDATE, quand invited_at passe de null à non-null)
--     -> handle_user_invited() -- PAS touchée par v11, doublon pré-existant (avant la
--     tranche multi-pôles, lié au correctif v58 "comptes Connect n'apparaissent plus en
--     staff" : handle_user_invited() exclut explicitement les invitations Connect
--     club/famille, qui n'ont pas de `role` dans raw_user_meta_data).
-- En vérifiant en réel (POST /auth/v1/invite, exactement le flux qu'utilise
-- invite-collaborateur), l'API Auth insère la ligne auth.users avec invited_at déjà NULL
-- puis la met à jour dans la foulée -- c'est donc TOUJOURS handle_user_invited() (trigger
-- UPDATE) qui crée la ligne profiles pour un compte staff invité, jamais handle_new_user()
-- (trigger INSERT, dont la condition `new.invited_at is not null` est fausse à l'insertion).
-- Le correctif de migration-poles-v11 était donc sans effet sur le chemin réellement
-- emprunté par invite-collaborateur / recrutCreerCollaborateur -- confirmé en reproduisant
-- le bug une 2e fois après v11, compte jetable svqa-onboard2-*, pole_affectations toujours
-- vide après l'invitation.
--
-- Correctif : extrait la logique d'affectation par défaut (déjà écrite dans v11) dans une
-- fonction partagée `ensure_default_pole_affectation(uuid, jsonb)`, SECURITY DEFINER,
-- appelée par les DEUX triggers désormais -- pour ne plus jamais avoir à corriger cette
-- règle à deux endroits séparément si elle doit encore évoluer (même philosophie que
-- pole_scope_ok()/client_pole_scope_ok() : un seul point d'entrée réutilisé partout).
-- handle_new_user() reste patché (defense in depth, si le chemin INSERT-avec-invited_at
-- déjà posé est un jour emprunté par un autre appelant que le flux actuel) ; il utilise
-- maintenant la même fonction partagée plutôt que sa propre copie du correctif v11.
--
-- Idempotente (create or replace function ; l'insert pole_affectations reste protégé par
-- l'unique (pole_id, user_id), on conflict do nothing).
--
-- ROLLBACK :
--   -- revenir à la version handle_user_invited() d'avant cette migration (vérifiée en
--   -- direct le 31/08/2026, inchangée depuis le correctif v58) :
--   create or replace function public.handle_user_invited()
--    returns trigger
--    language plpgsql
--    security definer
--    set search_path to 'public'
--   as $$
--   declare
--     v_role text;
--   begin
--     if old.invited_at is null and new.invited_at is not null then
--       v_role := new.raw_user_meta_data->>'role';
--       if v_role in ('admin','sec','prod','photo','cm','compta','com','expert_comptable','auditeur') then
--         insert into public.profiles (id, role, prenom, nom, email)
--         values (
--           new.id, v_role,
--           coalesce(new.raw_user_meta_data->>'prenom', ''),
--           coalesce(new.raw_user_meta_data->>'nom', ''),
--           new.email
--         )
--         on conflict (id) do update set
--           role = excluded.role,
--           prenom = coalesce(nullif(excluded.prenom, ''), profiles.prenom),
--           nom = coalesce(nullif(excluded.nom, ''), profiles.nom),
--           email = coalesce(excluded.email, profiles.email);
--       end if;
--     end if;
--     return new;
--   end;
--   $$;
--   -- redonner à handle_new_user() sa définition de migration-poles-v11 (verbatim, voir ce
--   -- fichier) si un rollback complet jusqu'avant v11 aussi est nécessaire.
--   drop function if exists public.ensure_default_pole_affectation(uuid, jsonb);

-- ── Fonction partagée ────────────────────────────────────────────────────
create or replace function public.ensure_default_pole_affectation(p_user_id uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pole_id uuid;
begin
  v_pole_id := null;
  begin
    v_pole_id := nullif(p_meta->>'pole_id', '')::uuid;
  exception when others then
    v_pole_id := null;
  end;
  if v_pole_id is not null and not exists (select 1 from public.poles where id = v_pole_id) then
    v_pole_id := null;
  end if;
  v_pole_id := coalesce(v_pole_id, pole_football_id());

  if v_pole_id is not null then
    insert into public.pole_affectations (pole_id, user_id, role_pole)
    values (v_pole_id, p_user_id, 'membre')
    on conflict (pole_id, user_id) do nothing;
  end if;
end;
$$;

comment on function public.ensure_default_pole_affectation(uuid, jsonb) is 'Affecte un profil nouvellement créé à un pôle sportif (role_pole=''membre''), pole_id explicite via p_meta->>''pole_id'' (posé par invite-collaborateur si fourni) sinon Football par défaut. Appelée par handle_new_user() ET handle_user_invited() (migration-poles-v12, 31/08/2026) -- point d''entrée unique pour ne plus dupliquer ce correctif si les deux triggers venaient à nouveau à diverger. Sans elle, un nouveau collaborateur n''a accès à AUCUN client/prestation/contrat/devis/facture (RLS pole_scope_ok, migration-poles-v3-rls.sql).';

-- ── handle_user_invited() — LE vrai chemin emprunté par invite-collaborateur ────────────
create or replace function public.handle_user_invited()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role text;
begin
  if old.invited_at is null and new.invited_at is not null then
    v_role := new.raw_user_meta_data->>'role';

    if v_role in ('admin','sec','prod','photo','cm','compta','com','expert_comptable','auditeur') then
      insert into public.profiles (id, role, prenom, nom, email)
      values (
        new.id,
        v_role,
        coalesce(new.raw_user_meta_data->>'prenom', ''),
        coalesce(new.raw_user_meta_data->>'nom', ''),
        new.email
      )
      on conflict (id) do update set
        role = excluded.role,
        prenom = coalesce(nullif(excluded.prenom, ''), profiles.prenom),
        nom = coalesce(nullif(excluded.nom, ''), profiles.nom),
        email = coalesce(excluded.email, profiles.email);

      perform public.ensure_default_pole_affectation(new.id, new.raw_user_meta_data);
    end if;
    -- Si v_role est NULL ou n'est pas un rôle staff valide (cas normal des
    -- invitations Connect club/famille, qui ne fournissent jamais `role`),
    -- on ne fait STRICTEMENT rien : pas de ligne `profiles` créée, donc pas
    -- d'affectation pôle non plus (v58, inchangé).
  end if;
  return new;
end;
$function$;

comment on function public.handle_user_invited() is 'Trigger auth.users AFTER UPDATE (on_auth_user_invited, invited_at null -> non-null) : crée/met à jour la ligne profiles pour tout compte staff invité avec un rôle valide (exclut les invitations Connect club/famille sans `role`, cf. correctif v58), puis affecte automatiquement ce profil à un pôle sportif (migration-poles-v12, 31/08/2026, via ensure_default_pole_affectation()) -- CHEMIN RÉELLEMENT EMPRUNTÉ par invite-collaborateur (vérifié en direct : l''API Auth insère auth.users avec invited_at NULL puis le met à jour, donc ce trigger UPDATE, pas le trigger INSERT handle_new_user(), qui crée la ligne profiles pour ce flux).';

-- ── handle_new_user() — défense en profondeur, réutilise la même fonction partagée ──────
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.invited_at is not null then
    insert into public.profiles (id, role, prenom, nom, email)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'role', 'photo'),
      coalesce(new.raw_user_meta_data->>'prenom', ''),
      coalesce(new.raw_user_meta_data->>'nom', ''),
      new.email
    );
    perform public.ensure_default_pole_affectation(new.id, new.raw_user_meta_data);
  end if;
  return new;
end;
$function$;

comment on function public.handle_new_user() is 'Trigger auth.users AFTER INSERT (on_auth_user_created) : crée la ligne profiles si invited_at est déjà posé À L''INSERTION (chemin peu emprunté en pratique par invite-collaborateur, cf. handle_user_invited() pour le vrai chemin -- gardé par prudence si un autre appelant crée un compte avec invited_at déjà posé). Affecte aussi au pôle par défaut via ensure_default_pole_affectation() (migration-poles-v12, 31/08/2026), même fonction partagée que handle_user_invited().';

-- ── Vérification (à exécuter manuellement après migration) ─────────────
-- 1. Inviter un compte jetable réel via le flux normal (POST /auth/v1/invite ou
--    invite-collaborateur) et vérifier :
--    select pa.pole_id, po.slug, pa.role_pole from pole_affectations pa join poles po on po.id=pa.pole_id
--      where pa.user_id = '<id du compte jetable>';
--    -> doit retourner UNE ligne, slug='football', role_pole='membre'.
-- 2. Nettoyer le compte jetable (auth.users cascade vers profiles/pole_affectations).
