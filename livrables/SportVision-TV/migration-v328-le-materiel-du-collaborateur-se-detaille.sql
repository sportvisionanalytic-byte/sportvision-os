-- v328 — Le matériel d'un collaborateur se détaille, appareil par appareil (28/09/2026).
--
-- DEMANDE DE FOUKA : « qu'ils puissent renseigner s'ils ont déjà du matériel, et s'ils en ont,
-- quel appareil, quel modèle, quel objectif — pour que j'aie de bonnes fiches de collaborateurs et
-- que je voie bien sur leur fiche mission ».
--
-- CE QU'IL Y AVAIT. `recruitment_applications.materiel` est un texte, et les 51 candidatures
-- réelles n'y contiennent que deux mots : « oui » et « partiel ». C'est ce mot qui est recopié
-- dans `profiles.materiel_personnel` à l'embauche. La fiche d'un photographe affiche donc, au
-- mieux, « 🎒 oui » — de quoi savoir qu'il a quelque chose, jamais quoi. Impossible d'affecter une
-- mission sur cette base : un 70-200 et un téléphone répondent tous les deux « oui ».
--
-- CE QUE ÇA AJOUTE. Une ligne par équipement, avec son type, sa marque et son modèle. Le
-- collaborateur la saisit lui-même ; l'Admin et la Production la lisent, parce que c'est elle qui
-- affecte les missions.
--
-- `profiles.materiel_personnel` N'EST PAS ABANDONNÉ, IL DEVIENT CALCULÉ. Quatre écrans s'en
-- servent déjà — l'alerte « kit requis » sur une mission, le filtre matériel oui/non de l'annuaire,
-- la carte d'équipe. Les réécrire serait un refactor, et deux sources pour la même question
-- (« a-t-il son propre matériel ? ») est précisément ce qui a produit six défauts cette semaine.
-- Un déclencheur y réécrit donc le résumé lisible à chaque changement : une seule saisie humaine,
-- une seule vérité, et aucun écran existant à toucher.
--
-- UNE SEULE RÈGLE D'ACCÈS, ÉCRITE UNE FOIS. `collaborateur_logistique` portait déjà « l'intéressé,
-- ou Admin/RH, ou la Production » recopiée dans sa policy. Elle est extraite dans
-- `peut_gerer_fiche_collaborateur`, que les deux tables appellent désormais. Le jour où ce
-- périmètre changera, il changera à un endroit.

-- ── La règle d'accès, extraite ────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER parce qu'elle lit `profiles`, qui porte sa propre RLS : une policy s'évalue
-- avec les droits du lecteur, et sans cela elle verrait ce que le lecteur voit, pas la vérité.
-- On ne révoque PAS son exécution : une fonction de policy qu'on révoque casse la lecture au lieu
-- de la borner (leçon du 12/09).
create or replace function public.peut_gerer_fiche_collaborateur(p_collaborateur uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_collaborateur = auth.uid()
      or public.is_admin_or_rh()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'prod');
$$;

-- ── Le matériel ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.collaborateur_materiel (
  id uuid primary key default gen_random_uuid(),
  collaborateur_id uuid not null references public.profiles(id) on delete cascade,
  -- Le type sert à lire la fiche d'un coup d'œil, et à répondre à la seule question qui compte
  -- avant d'affecter une mission : peut-il filmer, ou seulement photographier ?
  type text not null check (type in ('boitier_photo','objectif','camera','drone','stabilisateur',
                                     'micro','eclairage','ordinateur','autre')),
  marque text,
  modele text,
  -- Ce que ni la marque ni le modèle ne disent : « f/2.8 », « avec 2 batteries », « loué au mois ».
  precision_libre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_collaborateur_materiel_personne
  on public.collaborateur_materiel (collaborateur_id);

alter table public.collaborateur_materiel enable row level security;

drop policy if exists collaborateur_materiel_acces on public.collaborateur_materiel;
create policy collaborateur_materiel_acces on public.collaborateur_materiel
  for all using (public.peut_gerer_fiche_collaborateur(collaborateur_id))
  with check (public.peut_gerer_fiche_collaborateur(collaborateur_id));

-- Un compte désactivé ne lit plus rien, comme partout ailleurs.
drop policy if exists compte_os_desactive_bloque on public.collaborateur_materiel;
create policy compte_os_desactive_bloque on public.collaborateur_materiel
  as restrictive for all using (not (select public.compte_os_desactive()));

grant select, insert, update, delete on public.collaborateur_materiel to authenticated;

-- ── Le résumé, recalculé et jamais saisi deux fois ────────────────────────────────────────────
--
-- Ce que voient les écrans existants : « Sony A7 III · Canon RF 70-200 f/2.8 · DJI Mini 4 Pro ».
-- Quand le collaborateur n'a plus rien de déclaré, on remet la colonne à NULL, et l'alerte « kit
-- requis » se rallume d'elle-même — c'est le comportement attendu, pas un effet de bord.
create or replace function public.collaborateur_materiel_resume(p_collaborateur uuid)
returns text
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select nullif(string_agg(
           trim(both ' ' from concat_ws(' ', m.marque, m.modele,
                                        case when m.precision_libre is not null
                                             then '(' || m.precision_libre || ')' end)),
           ' · ' order by m.type, m.marque, m.modele), '')
    from public.collaborateur_materiel m
   where m.collaborateur_id = p_collaborateur;
$$;

create or replace function public.collaborateur_materiel_synchro()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_qui uuid;
begin
  v_qui := coalesce(new.collaborateur_id, old.collaborateur_id);
  update public.profiles
     set materiel_personnel = public.collaborateur_materiel_resume(v_qui)
   where id = v_qui;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_collaborateur_materiel_synchro on public.collaborateur_materiel;
create trigger trg_collaborateur_materiel_synchro
  after insert or update or delete on public.collaborateur_materiel
  for each row execute function public.collaborateur_materiel_synchro();

-- ── La logistique appelle la même règle ───────────────────────────────────────────────────────
drop policy if exists collaborateur_logistique_acces on public.collaborateur_logistique;
create policy collaborateur_logistique_acces on public.collaborateur_logistique
  for all using (public.peut_gerer_fiche_collaborateur(collaborateur_id))
  with check (public.peut_gerer_fiche_collaborateur(collaborateur_id));
