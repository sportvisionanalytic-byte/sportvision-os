-- SportVision OS — Schema Supabase
-- À exécuter dans Supabase Dashboard > SQL Editor

-- Table des profils utilisateurs (liée à auth.users)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  role text not null check (role in ('admin','sec','prod','photo','cm','compta','com')),
  prenom text,
  nom text,
  telephone text,
  created_at timestamptz default now()
);

-- Sécurité : chaque utilisateur ne voit que son propre profil
alter table profiles enable row level security;

create policy "Lecture profil personnel" on profiles
  for select using (auth.uid() = id);

create policy "Mise à jour profil personnel" on profiles
  for update using (auth.uid() = id);

-- L'admin peut voir tous les profils
create policy "Admin lecture tous profils" on profiles
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Trigger : créer automatiquement un profil à l'inscription
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, role, prenom, nom)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'photo'),
    coalesce(new.raw_user_meta_data->>'prenom', ''),
    coalesce(new.raw_user_meta_data->>'nom', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
