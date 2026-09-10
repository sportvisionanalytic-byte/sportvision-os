-- Desactiver un collaborateur ne lui retirait pas l'acces : seul l'ecran de l'OS le mettait dehors.
--
-- La fenetre « Desactiver » promet : « L'acces a l'OS est immediatement coupe (connexion
-- refusee, session existante deconnectee) ». Mesure le 10/09/2026 sur un compte de test
-- (secretaire desactivee apres s'etre connectee) :
--   - son jeton de rafraichissement fonctionnait toujours (nouveau jeton d'acces delivre) ;
--   - avec lui, elle lisait encore les clients et les profils de l'equipe par l'API ;
--   - et elle creait encore des comptes collaborateurs en appelant invite-collaborateur.
-- La raison : profiles.actif n'est lu que par l'OS (doLogin, checkSession). Ni Supabase Auth, ni
-- is_staff(), ni les politiques d'acces ne le consultent.
--
-- Correctif ici : passer actif a false supprime les sessions du compte. Les jetons de
-- rafraichissement sont rattaches aux sessions (ON DELETE CASCADE) : plus aucun nouveau jeton ne
-- peut etre obtenu. Le jeton d'acces deja emis reste valable jusqu'a son expiration (au plus une
-- heure, jwt_exp = 3600) — le fermer immediatement demanderait de faire lire `actif` par
-- is_staff() et par chaque politique, chantier distinct laisse hors de ce correctif.
--
-- invite-collaborateur refuse aussi, de son cote, un appelant desactive (code de la fonction).
--
-- Reactiver le compte (actif = true) ne recree rien : la personne se reconnecte normalement.

create or replace function public.revoquer_sessions_compte_desactive()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.actif is false and old.actif is distinct from false then
    delete from auth.sessions where user_id = new.id;
  end if;
  return new;
end;
$$;

-- Fonction de declencheur : personne n'a a l'appeler directement. Revoquee depuis PUBLIC ET
-- depuis anon/authenticated : sur ce projet, les privileges par defaut accordent aussi EXECUTE
-- nommement a ces deux roles (mesure dans la transaction d'essai : revoquer PUBLIC seul les
-- laissait a true).
revoke all on function public.revoquer_sessions_compte_desactive() from public, anon, authenticated;

drop trigger if exists trg_revoquer_sessions_desactive on public.profiles;
create trigger trg_revoquer_sessions_desactive
  after update of actif on public.profiles
  for each row execute function public.revoquer_sessions_compte_desactive();
