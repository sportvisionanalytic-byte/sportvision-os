-- ============================================================
-- SPORTVISION CONNECT — Migration v35 : corrige une régression introduite
-- par migration-connect-v31-fix-is-staff-cross-tenant-leak.sql, qui casse
-- le circuit légitime d'invitation du staff (invite-collaborateur).
--
-- ── Découverte (11/08/2026, en testant le chantier "réservations club") ──
--
-- v31 a changé handle_new_user() pour ne faire confiance à
-- raw_user_meta_data.role que quand new.invited_at IS NOT NULL (signal
-- censé distinguer une vraie invitation admin d'un signup public — voir
-- v31 pour le contexte complet, ce correctif reste nécessaire et actif).
--
-- Constat empirique (compte jetable réel, généré via
-- POST /auth/v1/admin/generate_link {"type":"invite", data:{role:"admin"}} —
-- exactement ce que fait l'edge function invite-collaborateur) :
-- la réponse de l'API montre bien invited_at renseigné, MAIS la ligne
-- `profiles` créée a quand même role='photo'. Reproduit deux fois,
-- nettoyé après chaque test.
--
-- Cause : Supabase Auth crée la ligne auth.users en DEUX temps — un INSERT
-- initial (où invited_at est encore NULL au moment où le trigger
-- on_auth_user_created se déclenche), puis une UPDATE séparée qui pose
-- invited_at. Le trigger INSERT ne voit donc JAMAIS invited_at renseigné,
-- même pour une vraie invitation — v31 retombe donc TOUJOURS sur 'photo',
-- y compris pour un vrai admin qui invite un collaborateur. Régression
-- silencieuse : v31 a été vérifiée uniquement contre le cas "signup public
-- avec role:admin usurpé" (qui doit rester bloqué, et l'est toujours) sans
-- retester le cas légitime symétrique.
--
-- ── Correctif ──────────────────────────────────────────────────────────
-- Garde handle_new_user() strictement identique (le blocage du signup
-- public reste correct et nécessaire). Ajoute un second trigger, sur
-- UPDATE cette fois, qui se déclenche uniquement au moment précis où
-- invited_at passe de NULL à une vraie valeur — transition qui ne peut
-- SURVENIR que via les endpoints admin de Supabase Auth (generateLink/
-- inviteUserByEmail), jamais via un signup public standard (qui ne pose
-- jamais ce champ, à aucun moment de son cycle de vie). Rôle appliqué
-- uniquement s'il fait partie des 7 valeurs réellement autorisées par le
-- check constraint de profiles.role — une valeur invalide dans les
-- métadonnées est silencieusement ignorée plutôt que de faire échouer
-- la mise à jour de invited_at elle-même (qui est un appel interne
-- Supabase Auth, pas quelque chose qu'on veut faire planter).
--
-- Idempotente. PRÉPARÉE, PAS EXÉCUTÉE — à relire et exécuter manuellement
-- par Fouka dans Supabase → SQL Editor, en PRIORITÉ (toute invitation
-- envoyée entre l'exécution de v31 et celle de ce correctif a créé un
-- compte role='photo' au lieu du rôle prévu — vérifier après coup si des
-- invitations ont été envoyées dans cette fenêtre et corriger le rôle à
-- la main si besoin).
-- ============================================================

create or replace function handle_user_invited()
returns trigger language plpgsql security definer as $$
begin
  if old.invited_at is null and new.invited_at is not null then
    update public.profiles
    set
      role = case
        when new.raw_user_meta_data->>'role' in ('admin','sec','prod','photo','cm','compta','com')
          then new.raw_user_meta_data->>'role'
        else role
      end,
      prenom = coalesce(nullif(new.raw_user_meta_data->>'prenom', ''), prenom),
      nom = coalesce(nullif(new.raw_user_meta_data->>'nom', ''), nom)
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_invited on auth.users;
create trigger on_auth_user_invited
  after update on auth.users
  for each row execute procedure handle_user_invited();

-- ─── Vérification recommandée après exécution ─────────────────────────
-- Rejouer le test qui a révélé le bug : générer un lien d'invitation
-- réel avec un rôle non-photo (ex. "sec"), vérifier que profiles.role
-- vaut bien "sec" et non "photo" après coup. Rejouer aussi le test de
-- v31 (signup public avec role:"admin" usurpé) pour confirmer qu'il reste
-- bien bloqué à "photo" — les deux comportements doivent coexister.
