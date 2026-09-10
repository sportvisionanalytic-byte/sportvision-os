-- Un compte cree par invitation Supabase ne devient plus « photographe SportVision » par defaut.
--
-- Trouve le 10/09/2026 (audit des decisions Connect). handle_new_user, declenche a l'INSERTION
-- dans auth.users, creait une ligne `profiles` pour TOUT compte invite, avec
-- `coalesce(raw_user_meta_data->>'role', 'photo')`. Or trois fonctions invitent des personnes qui
-- ne sont pas de l'equipe : create-guest-media-checkout (acheteur de photos sans compte),
-- clubplus-invite et org-invite (encadrants de club). Sans role dans les metadonnees, la personne
-- recevait role = 'photo' ; tant qu'elle n'avait ni adhesion, ni fiche joueur, ni reglages Connect,
-- is_staff() la voyait comme un collaborateur interne (annuaire, clients, missions…).
-- Latent au 10/09 (aucun compte concerne, mesure ; aucun lien d'achat invite en circulation),
-- mais ouvert des le premier achat de photos sans compte.
--
-- Correctif : meme regle que handle_user_invited, qui l'appliquait deja a la MISE A JOUR : une
-- ligne staff n'est creee que si l'invitation porte EXPLICITEMENT un role interne.
-- invite-collaborateur passe toujours ce role (verifie : metadonnees de la recrue du 10/09).

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.invited_at is not null
     and new.raw_user_meta_data->>'role' in ('admin','sec','prod','photo','cm','compta','com','expert_comptable','auditeur','rh')
  then
    insert into public.profiles (id, role, prenom, nom, email)
    values (
      new.id,
      new.raw_user_meta_data->>'role',
      coalesce(new.raw_user_meta_data->>'prenom', ''),
      coalesce(new.raw_user_meta_data->>'nom', ''),
      new.email
    );
    perform public.ensure_default_pole_affectation(new.id, new.raw_user_meta_data);
  end if;
  return new;
end;
$function$;
