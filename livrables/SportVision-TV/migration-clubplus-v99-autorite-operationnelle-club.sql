-- Une seule autorité pour « qui administre opérationnellement ce club », et elle n'est pas
-- l'annuaire des gens qui ont le droit de le LIRE.
--
-- ── Ce que la v98 a corrigé, et ce qu'elle a accordé de trop ──
-- La v98 a débloqué les liens d'invitation pour le CM, en s'appuyant sur `cm_clubs_autorises()`.
-- C'était le bon périmètre — il connaît les affectations nominatives et les délégations d'agence,
-- avec leurs dates — mais c'est aussi une fonction de LECTURE : elle ouvre la vue globale à
-- `admin, com, sec, prod, compta, rh`. Un profil comptabilité pouvait donc, depuis la v98, créer
-- un lien d'inscription pour n'importe quel club. Ça n'a jamais été demandé, et une comptable n'a
-- rien à faire dans les invitations d'un club de football.
--
-- ── La règle, dite une fois ──
-- Opérer un club, c'est y agir au nom du club : préparer des personnes, créer des invitations,
-- importer un effectif, modifier un créneau. Deux conditions, toutes les deux nécessaires :
--
--   1. le club est dans mon périmètre (`cm_clubs_autorises()`, qui porte déjà les dates et les
--      délégations — on ne réécrit pas cette logique) ;
--   2. mon métier est celui-là : direction, communication, secrétariat, ou CM affilié.
--
-- Production, comptabilité et RH gardent leur vue de lecture inchangée. Ils ne gagnent rien ici,
-- et ne perdent rien non plus.
--
-- Un administrateur du club lui-même passe évidemment, sans condition de métier.
--
-- ── Ce que ça débloque en plus des invitations ──
-- `peut_preparer_club()` avait exactement le même angle mort : elle testait `est_cm_cloisonne()`,
-- vrai seulement pour `profiles.role = 'cm'`. Le CM affilié de SF Villemomble, dont le profil est
-- `com`, ne pouvait donc NI importer un effectif (`import_club_players`,
-- `preview_club_players_import`), NI lire ou modifier une exception de créneau
-- (`club_training_exceptions`), sur un club qu'il administre pourtant au quotidien. Vérifié en
-- base avant écriture : `peut_preparer_club` renvoyait `false` pour lui.
--
-- Les deux fonctions se rangent derrière la même définition. Une divergence entre « préparer » et
-- « inviter » n'aurait aucun sens métier, et c'est précisément ce genre d'écart qui a créé le bug
-- que la v98 a corrigé.

begin;

create or replace function public.peut_operer_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  -- `coalesce` : sur un `p_club_id` nul, l'expression rendrait NULL, et un NULL dans un
  -- `if not (...)` ne déclenche pas la branche de refus — le garde-fou s'ouvrirait au lieu de se
  -- fermer. C'est le défaut déjà trouvé sur `peut_preparer_club(null)`.
  select p_club_id is not null
     and coalesce(
           is_club_admin(p_club_id)
             or (
               exists (
                 select 1 from profiles p
                  where p.id = auth.uid()
                    and p.role in ('admin', 'com', 'sec', 'cm')
               )
               and p_club_id in (select public.cm_clubs_autorises())
             ),
           false);
$$;

comment on function public.peut_operer_club(uuid) is
  'Qui peut agir au nom d''un club : ses administrateurs, et les métiers SportVision d''exploitation (direction, communication, secrétariat, CM affilié) dont le périmètre couvre ce club. Production, comptabilité et RH gardent leur lecture, sans droit d''écriture. Autorité unique de « préparer » et « inviter ».';

-- `peut_gerer_invitations_club` (v98) devient un alias : les policies posées par la v98 la
-- nomment, et la renommer d'un bloc obligerait à les recréer pour rien. Un seul corps de règle,
-- deux noms d'appel — pas deux règles.
create or replace function public.peut_gerer_invitations_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.peut_operer_club(p_club_id);
$$;

-- Et l'angle mort historique, comblé par la même définition.
create or replace function public.peut_preparer_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.peut_operer_club(p_club_id);
$$;

commit;
