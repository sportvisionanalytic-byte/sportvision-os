-- ============================================================================
-- migration-poles-v16-fix-trigger-role-rh.sql
-- Corrige un oubli de migration-poles-v14 : profiles.role et is_staff()
-- acceptent désormais 'rh', mais handle_user_invited()/handle_new_user()
-- gardaient leur propre liste de rôles valides (héritée de migration-poles-
-- v12), sans 'rh' — un compte invité avec role='rh' ne recevait donc AUCUNE
-- ligne profiles (traité comme une invitation Connect club/famille sans rôle
-- valide), confirmé en reproduisant le bug en réel avant ce correctif
-- (invite-collaborateur avec role:'rh' -> profiles introuvable pour ce user_id).
-- ============================================================================

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

    if v_role in ('admin','sec','prod','photo','cm','compta','com','expert_comptable','auditeur','rh') then
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
  end if;
  return new;
end;
$function$;

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

-- ROLLBACK : restaurer les deux fonctions ci-dessus sans 'rh' dans la liste
-- (voir migration-poles-v12-fix-onboarding-affectation-vrai-chemin.sql pour
-- le corps exact pré-v16).
