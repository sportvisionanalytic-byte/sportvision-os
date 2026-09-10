-- ═══════════════════════════════════════════════════════════════════════════════
-- L'adresse du domicile d'un collaborateur sort de profiles
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- CONSTAT DE L'AUDIT DU 10/09/2026, reproduit par le chemin reel (jeton d'un vrai compte
-- photographe, appel PostgREST, pas une deduction de lecture de policy) :
--
--   GET /rest/v1/profiles?select=prenom,nom,telephone,adresse,code_postal,ville
--   -> 17 lignes, dont deux adresses postales completes et quatre numeros de telephone.
--
-- Autrement dit, n'importe quel photographe pouvait lire l'adresse du DOMICILE de chacun de
-- ses collegues, y compris de personnes arrivees la veille. Ce n'est pas un ecran mal cache :
-- la policy « Staff lecture annuaire » (is_staff() and profile_shares_pole_with_caller(id))
-- autorise reellement la lecture de la LIGNE entiere, et la RLS de PostgreSQL ne sait pas
-- restreindre une COLONNE. Aucun ecran de l'OS n'affichait ces champs a un photographe, mais
-- l'API est publique : l'ecran ne protege rien.
--
-- POURQUOI CETTE FORME DE CORRECTIF. Le depot applique deja ce principe ailleurs. Commentaire
-- present dans l'OS au-dessus de modalModifierCollaborateur :
--
--     « La paie (salaire, charges) vit dans employee_costs (RLS admin/compta uniquement)
--       — pas sur profiles, lisible par tout collaborateur connecte. »
--
-- La regle est donc deja posee : ce qui doit etre restreint a quelques roles ne vit pas sur
-- profiles. L'adresse du domicile relevait de la meme regle et y avait echappe. On applique la
-- meme solution plutot que d'en inventer une autre.
--
-- CE QUI N'EST PAS TOUCHE, ET POURQUOI. `ville`, `telephone`, `vehicule` et `permis` restent
-- sur profiles : l'annuaire interne les affiche deliberement (joindre un collegue sur le
-- terrain, savoir qui est motorise et sur quelle zone). Ce sont des choix metier, pas des
-- oublis ; ils sont signales dans le rapport pour arbitrage, pas modifies ici.
--
-- REVERSIBILITE. Les colonnes profiles.adresse / profiles.code_postal sont VIDEES, pas
-- supprimees. Revenir en arriere se fait en une requete, donnee a la fin de ce fichier.

begin;

create table if not exists public.collaborateur_coordonnees (
  collaborateur_id uuid primary key references public.profiles(id) on delete cascade,
  adresse          text,
  code_postal      text,
  updated_at       timestamptz not null default now()
);

comment on table public.collaborateur_coordonnees is
  'Adresse du domicile d''un collaborateur. Hors de profiles, qui est lisible par tout '
  'collaborateur partageant le meme pole (policy « Staff lecture annuaire »). Meme principe '
  'que employee_costs pour la paie. Audit du 10/09/2026.';

alter table public.collaborateur_coordonnees enable row level security;

-- Lecture et ecriture : l'interesse lui-meme, ou l'administration.
-- `sec` et `prod` sont volontairement exclus : ils gerent le planning et les missions, pas les
-- dossiers du personnel. Cote OS, seul l'ecran Collaborateurs (admin/rh) affiche ce champ.
drop policy if exists collaborateur_coordonnees_acces on public.collaborateur_coordonnees;
create policy collaborateur_coordonnees_acces on public.collaborateur_coordonnees
  for all using (collaborateur_id = auth.uid() or is_admin_or_rh())
  with check (collaborateur_id = auth.uid() or is_admin_or_rh());

grant select, insert, update on public.collaborateur_coordonnees to authenticated;
revoke all on public.collaborateur_coordonnees from anon;

-- Reprise des donnees existantes, puis effacement de la source.
insert into public.collaborateur_coordonnees (collaborateur_id, adresse, code_postal)
select p.id, nullif(trim(p.adresse),''), nullif(trim(p.code_postal),'')
  from public.profiles p
 where nullif(trim(coalesce(p.adresse,'')),'') is not null
    or nullif(trim(coalesce(p.code_postal,'')),'') is not null
on conflict (collaborateur_id) do update
  set adresse = coalesce(excluded.adresse, public.collaborateur_coordonnees.adresse),
      code_postal = coalesce(excluded.code_postal, public.collaborateur_coordonnees.code_postal),
      updated_at = now();

update public.profiles set adresse = null, code_postal = null
 where adresse is not null or code_postal is not null;

-- Un declencheur empeche que le champ revienne s'installer sur profiles par un futur
-- formulaire distrait : ecrire une adresse ici est desormais sans effet et le dit.
create or replace function public.refuser_adresse_sur_profiles()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if nullif(trim(coalesce(new.adresse,'')),'') is not null
     or nullif(trim(coalesce(new.code_postal,'')),'') is not null then
    raise exception 'L''adresse d''un collaborateur se stocke dans collaborateur_coordonnees, '
                    'pas sur profiles (lisible par tout l''annuaire). Audit du 10/09/2026.';
  end if;
  return new;
end $$;
revoke all on function public.refuser_adresse_sur_profiles() from public, anon, authenticated;

drop trigger if exists trg_refuser_adresse_sur_profiles on public.profiles;
create trigger trg_refuser_adresse_sur_profiles
  before insert or update of adresse, code_postal on public.profiles
  for each row execute function public.refuser_adresse_sur_profiles();

commit;

-- ── Verification ─────────────────────────────────────────────────────────────
select 'adresses restantes sur profiles' as controle,
       count(*) filter (where nullif(trim(coalesce(adresse,'')),'') is not null
                          or nullif(trim(coalesce(code_postal,'')),'') is not null)::text as valeur
  from profiles
union all
select 'adresses deplacees', count(*)::text from collaborateur_coordonnees;

-- ── Retour en arriere, si jamais ─────────────────────────────────────────────
-- drop trigger if exists trg_refuser_adresse_sur_profiles on public.profiles;
-- update public.profiles p set adresse = c.adresse, code_postal = c.code_postal
--   from public.collaborateur_coordonnees c where c.collaborateur_id = p.id;
