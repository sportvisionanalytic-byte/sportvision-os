-- Migration : email sur profiles
-- L'Annuaire (répertoire équipe) sélectionne explicitement la colonne
-- email sur profiles, qui n'a jamais existé (l'email vit dans auth.users).
-- Comme PostgREST rejette tout le select si une colonne est inconnue,
-- l'Annuaire renvoyait 0 collaborateur, pour tous les rôles, systématiquement.
-- Idempotente : peut être rejouée sans erreur.
-- À exécuter dans Supabase → SQL Editor

alter table profiles add column if not exists email text;

-- Backfill des comptes existants depuis auth.users
update profiles p set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- Renseigner l'email automatiquement à la création de compte
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, role, prenom, nom, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'photo'),
    coalesce(new.raw_user_meta_data->>'prenom', ''),
    coalesce(new.raw_user_meta_data->>'nom', ''),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
