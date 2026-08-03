-- Migration URGENTE : un client qui crée un compte sur le Portail se
-- retrouvait avec une fiche collaborateur dans l'OS, au rôle "photo".
--
-- ─── Cause ───────────────────────────────────────────────────────────────
-- Le trigger handle_new_user() (supabase-schema.sql) crée une ligne dans
-- `profiles` à CHAQUE inscription Supabase Auth, sans distinguer un
-- collaborateur invité depuis l'OS (creerCollaborateur() envoie bien
-- data:{role,...}) d'un client qui s'inscrit sur le Portail (le formulaire
-- d'inscription n'envoie jamais de rôle — il envoie prenom/nom/telephone/
-- profil, "profil" étant le type de structure du client, pas un rôle OS).
-- Résultat : coalesce(new.raw_user_meta_data->>'role', 'photo') retombait sur
-- 'photo' par défaut pour CHAQUE inscription client, créant une fiche
-- photographe fantôme dans l'OS (visible dans Utilisateurs & accès, Grades &
-- XP, Annuaire équipe...).
--
-- ─── Correctif du trigger ────────────────────────────────────────────────
-- Ne crée plus de ligne profiles du tout si aucun rôle n'est fourni — un
-- client Portail obtient sa ligne dans `client_users` via l'edge function
-- portal-onboarding, jamais dans `profiles`.
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  if new.raw_user_meta_data->>'role' is not null then
    insert into public.profiles (id, role, prenom, nom)
    values (
      new.id,
      new.raw_user_meta_data->>'role',
      coalesce(new.raw_user_meta_data->>'prenom', ''),
      coalesce(new.raw_user_meta_data->>'nom', '')
    );
  end if;
  return new;
end;
$$;

-- ─── Nettoyage des fiches fantômes déjà créées ───────────────────────────
-- Une fiche profiles est fantôme si son compte auth d'origine n'a JAMAIS reçu
-- de rôle à l'inscription (raw_user_meta_data->>'role' absent) — c'est
-- précisément la signature du bug : un vrai collaborateur invité depuis l'OS
-- a toujours un rôle transmis (creerCollaborateur() l'envoie systématiquement).
delete from profiles p
using auth.users u
where p.id = u.id
  and u.raw_user_meta_data->>'role' is null;
