-- ═══════════════════════════════════════════════════════════════════════════════
-- Ville, vehicule et permis sortent de l'annuaire ouvert
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- DECISION DE FOUKA, 10/09/2026, apres l'audit de pre-lancement :
--
--   « telephone : visible collaborateurs internes ; ville, vehicule, permis : Admin +
--     Production uniquement ; adresse domicile : privee comme desormais implemente. »
--
-- Le raisonnement est le sien et il tient : ces trois champs servent a ORGANISER LES
-- DEPLACEMENTS. C'est le metier de la Production, pas une information d'annuaire. Le telephone,
-- lui, reste ouvert : joindre un collegue sur le terrain est une urgence reelle.
--
-- CE QUE CA FERME CONCRETEMENT. L'ecran « Annuaire equipe » est accessible a compta et com par
-- leur menu, et a photo et cm par le bouton depuis leur messagerie. Il demandait
-- `ville,vehicule,permis` pour tout le monde. La RLS de PostgreSQL ne restreignant pas les
-- COLONNES, masquer les badges cote ecran n'aurait rien protege : l'API repond a qui la
-- questionne directement.
--
-- Meme forme que collaborateur_coordonnees (migration-audit-v3), qui suivait elle-meme le
-- precedent d'employee_costs : ce qui doit etre restreint ne vit pas sur profiles.
--
-- REVERSIBILITE. Les colonnes de profiles sont VIDEES, pas supprimees. Le retour arriere tient
-- en une requete, donnee en fin de fichier.

begin;

create table if not exists public.collaborateur_logistique (
  collaborateur_id uuid primary key references public.profiles(id) on delete cascade,
  ville            text,
  vehicule         boolean,
  permis           boolean,
  updated_at       timestamptz not null default now()
);

comment on table public.collaborateur_logistique is
  'Ville, vehicule et permis d''un collaborateur. Hors de profiles, dont l''annuaire est ouvert '
  'a tout collaborateur du meme pole. Lisible par l''interesse, l''administration et la '
  'Production, qui organise les deplacements. Decision de Fouka du 10/09/2026.';

alter table public.collaborateur_logistique enable row level security;

drop policy if exists collaborateur_logistique_acces on public.collaborateur_logistique;
create policy collaborateur_logistique_acces on public.collaborateur_logistique
  for all using (
    collaborateur_id = auth.uid()
    or is_admin_or_rh()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'prod')
  )
  with check (
    collaborateur_id = auth.uid()
    or is_admin_or_rh()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'prod')
  );

grant select, insert, update on public.collaborateur_logistique to authenticated;
revoke all on public.collaborateur_logistique from anon;

-- Reprise des donnees existantes, puis effacement de la source.
insert into public.collaborateur_logistique (collaborateur_id, ville, vehicule, permis)
select p.id, nullif(trim(coalesce(p.ville,'')),''), p.vehicule, p.permis
  from public.profiles p
 where nullif(trim(coalesce(p.ville,'')),'') is not null
    or coalesce(p.vehicule,false) or coalesce(p.permis,false)
on conflict (collaborateur_id) do update
  set ville = coalesce(excluded.ville, public.collaborateur_logistique.ville),
      vehicule = coalesce(excluded.vehicule, public.collaborateur_logistique.vehicule),
      permis = coalesce(excluded.permis, public.collaborateur_logistique.permis),
      updated_at = now();

update public.profiles set ville = null, vehicule = null, permis = null
 where ville is not null or vehicule is not null or permis is not null;

-- Meme principe que pour l'adresse : on REDIRIGE l'ecriture au lieu de la refuser, pour que la
-- version de l'OS deja en ligne continue de fonctionner pendant l'ecart entre la migration et le
-- deploiement, et pour qu'un futur formulaire distrait ne reintroduise pas la fuite en silence.
--
-- A l'INSERT, la ligne profiles n'existe pas encore : la cle etrangere interdit d'ecrire tout de
-- suite, donc les champs sont simplement vides. Aucun chemin de creation de compte ne transmet
-- ces valeurs (verifie sur invite-collaborateur et les deux declencheurs de auth.users).
create or replace function public.rediriger_logistique_hors_profiles()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if nullif(trim(coalesce(new.ville,'')),'') is null
     and new.vehicule is null and new.permis is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    insert into public.collaborateur_logistique (collaborateur_id, ville, vehicule, permis, updated_at)
    values (new.id, nullif(trim(coalesce(new.ville,'')),''), new.vehicule, new.permis, now())
    on conflict (collaborateur_id) do update
      set ville = coalesce(excluded.ville, public.collaborateur_logistique.ville),
          vehicule = coalesce(excluded.vehicule, public.collaborateur_logistique.vehicule),
          permis = coalesce(excluded.permis, public.collaborateur_logistique.permis),
          updated_at = now();
  end if;

  new.ville := null; new.vehicule := null; new.permis := null;
  return new;
end $$;
revoke all on function public.rediriger_logistique_hors_profiles() from public, anon, authenticated;

drop trigger if exists trg_rediriger_logistique_hors_profiles on public.profiles;
create trigger trg_rediriger_logistique_hors_profiles
  before insert or update of ville, vehicule, permis on public.profiles
  for each row execute function public.rediriger_logistique_hors_profiles();

commit;

-- Verification
select 'restant sur profiles' as controle,
       count(*) filter (where ville is not null or vehicule is not null or permis is not null)::text as valeur
  from profiles
union all
select 'deplaces', count(*)::text from collaborateur_logistique;

-- Retour en arriere, si jamais :
-- drop trigger if exists trg_rediriger_logistique_hors_profiles on public.profiles;
-- update public.profiles p set ville = l.ville, vehicule = l.vehicule, permis = l.permis
--   from public.collaborateur_logistique l where l.collaborateur_id = p.id;
