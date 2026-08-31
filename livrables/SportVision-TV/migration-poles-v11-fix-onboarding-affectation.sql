-- migration-poles-v11-fix-onboarding-affectation.sql
--
-- Migration multi-pôles (Football + Basket), Lot 9 — QA/cohérence transversale, correctif
-- CRITIQUE trouvé en testant en réel (31/08/2026, campagne de vérification post-Lots 1-8).
--
-- CONSTAT (reproduit en réel avec un compte jetable 'prod' invité via le flux normal
-- invite-collaborateur / recrutCreerCollaborateur, cf. rapport de QA) : AUCUN des 8 lots de la
-- migration multi-pôles n'a touché au flux d'onboarding d'un nouveau collaborateur
-- (handle_new_user(), déclenché par auth.users.invited_at). Un nouveau profil créé après
-- cette nuit se retrouve avec ZÉRO ligne dans pole_affectations. Or clients_write_acces /
-- prestations_acces / contrats_write_acces / devis_acces / factures_staff (migration-poles-v3)
-- exigent tous pole_scope_ok(pole_id), qui retourne FAUX pour un profil sans aucune
-- affectation (get_my_pole_ids() renvoie '{}', et p_pole_id = any('{}') est toujours faux) —
-- un nouveau collaborateur invité (n'importe quel rôle fonctionnel, y compris admin) se
-- retrouve donc verrouillé hors de TOUT client/prestation/contrat/devis/facture tant que
-- Fouka ne l'affecte pas manuellement en SQL. Zone morte : chaque lot a supposé que le staff
-- existant seul comptait (backfill v1/v2), aucun n'a couvert le flux de recrutement futur.
--
-- Correctif : handle_new_user() affecte désormais automatiquement tout nouveau profil invité
-- à un pôle, dans la même transaction que la création du profil (jamais de fenêtre où un
-- profil existe sans aucune affectation) :
--   - si l'invitation transporte un pole_id explicite (new.raw_user_meta_data->>'pole_id' —
--     voir migration du edge function invite-collaborateur qui le pose désormais en option),
--     affecte à CE pôle ;
--   - sinon, retombe sur pole_football_id() (comportement implicite historique : avant
--     Basket, 100% du staff est Football — c'est exactement le même choix que le backfill de
--     migration-poles-v2-backfill-football.sql pour les clients/prestations).
-- Toujours role_pole='membre' (jamais 'responsable' automatiquement — Fouka nomme les
-- responsables lui-même, choix déjà acté en migration-poles-v5-creation-basket.sql).
--
-- Un pole_id de metadata invalide (uuid malformé, ou pôle inexistant) ne doit JAMAIS faire
-- échouer la création du compte lui-même (l'onboarding est plus critique que le choix du
-- pôle, rattrapable ensuite en SQL) : cast protégé + fallback Football si la ligne pole_id
-- fournie ne référence in fine aucun pôle existant.
--
-- Idempotente (create or replace function ; l'insert pole_affectations est protégé par
-- l'unique (pole_id, user_id) existante, on conflict do nothing).
--
-- ROLLBACK : réexécuter la définition d'origine de handle_new_user() (verbatim, vérifiée en
-- direct le 31/08/2026 avant d'écrire ce fichier) :
--   create or replace function public.handle_new_user()
--    returns trigger
--    language plpgsql
--    security definer
--    set search_path to 'public'
--   as $$
--   begin
--     if new.invited_at is not null then
--       insert into public.profiles (id, role, prenom, nom, email)
--       values (
--         new.id,
--         coalesce(new.raw_user_meta_data->>'role', 'photo'),
--         coalesce(new.raw_user_meta_data->>'prenom', ''),
--         coalesce(new.raw_user_meta_data->>'nom', ''),
--         new.email
--       );
--     end if;
--     return new;
--   end;
--   $$;

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pole_id uuid;
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

    -- Multi-pôles (migration-poles-v11, 31/08/2026, correctif QA Lot 9) : voir constat en tête
    -- de fichier. Cast protégé (un pole_id malformé ne doit jamais casser la création du
    -- compte) + vérification que le pôle référencé existe réellement, sinon fallback Football.
    v_pole_id := null;
    begin
      v_pole_id := nullif(new.raw_user_meta_data->>'pole_id', '')::uuid;
    exception when others then
      v_pole_id := null;
    end;
    if v_pole_id is not null and not exists (select 1 from public.poles where id = v_pole_id) then
      v_pole_id := null;
    end if;
    v_pole_id := coalesce(v_pole_id, pole_football_id());

    if v_pole_id is not null then
      insert into public.pole_affectations (pole_id, user_id, role_pole)
      values (v_pole_id, new.id, 'membre')
      on conflict (pole_id, user_id) do nothing;
    end if;
  end if;
  return new;
end;
$function$;

comment on function public.handle_new_user() is 'Trigger auth.users AFTER INSERT/invited_at (on_auth_user_created) : crée la ligne profiles pour tout compte invité, puis (migration-poles-v11, 31/08/2026) affecte automatiquement ce nouveau profil à un pôle sportif (pole_affectations, role_pole=''membre'') — pole_id explicite via raw_user_meta_data->>''pole_id'' si fourni par l''appelant (invite-collaborateur), sinon Football par défaut. Sans cet affectation automatique, un nouveau collaborateur ne peut lire ni écrire aucun client/prestation/contrat/devis/facture (RLS pole_scope_ok, migration-poles-v3-rls.sql) tant qu''il n''est affecté à aucun pôle.';

-- ── Vérification (à exécuter manuellement après migration) ─────────────
-- 1. Inviter un compte jetable réel (flux normal, sans pole_id dans la requête) et vérifier :
--    select pa.pole_id, po.slug, pa.role_pole from pole_affectations pa join poles po on po.id=pa.pole_id
--      where pa.user_id = '<id du compte jetable>';
--    -> doit retourner UNE ligne, slug='football', role_pole='membre'.
-- 2. Nettoyer le compte jetable (auth.users cascade vers profiles/pole_affectations).
