-- v370 — Un community manager fait partie de l'équipe (30/09/2026)
--
-- LE DÉFAUT, MESURÉ PAR LE CHEMIN RÉEL
--
-- Dans la peau de chaque compte (`set local role authenticated` + claims JWT, transaction annulée) :
--
--     chris (cm) ........  1 profil visible
--     Tony  (cm) ........  1 profil visible
--     les 10 photographes, les 2 prod, le secrétariat ....... 18 profils
--
-- Les deux community managers ne voient qu'eux-mêmes. Conséquence vue à l'écran : Tony a reçu deux
-- messages, il peut les lire — la messagerie ne passe pas par l'annuaire — mais la liste des
-- contacts se construit à partir des profils. La conversation qu'Antoine a ouverte avec lui lui est
-- donc invisible et injoignable. Il a des messages qu'il ne peut pas retrouver, et il ne peut
-- écrire à personne.
--
-- LA POLICY QUI FAIT ÇA, ET CE QU'ELLE PROTÈGE VRAIMENT
--
-- `cm_hors_perimetre_profiles` est RESTRICTIVE : elle s'ajoute à toutes les autres et aucune ne
-- peut la contourner. Elle dit qu'un `cm` ne voit qu'un profil qui est le sien, ou qui appartient à
-- l'un de ses clubs (`cm_profil_de_ses_clubs`).
--
-- Or `cm_profil_de_ses_clubs` cherche dans `club_members`, et MESURÉ CE JOUR : aucun des 18 profils
-- n'a de ligne dans `club_members`. La clause ne peut donc être vraie pour personne. La table
-- `profiles` ne contient que l'équipe SportVision — les gens des clubs vivent dans `club_members`,
-- `player_profiles` et `parent_profiles`, pas ici. Cette policy ne cloisonne donc rien : elle
-- n'a aucune donnée de club à cacher, et elle rend deux salariés aveugles.
--
-- Le cloisonnement d'un CM est réel et reste entier — il porte sur les CLUBS, décision du 08/09
-- (`cm_clubs_autorises()`), et sur les données de club, pas sur l'annuaire interne de SportVision.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- La restriction cesse de s'appliquer aux profils de l'ÉQUIPE SportVision, et continue de
-- s'appliquer à tout autre profil — un compte de club qui atterrirait un jour dans `profiles`
-- resterait invisible à un CM cloisonné.
--
-- EN LECTURE SEULEMENT. Le `with check` n'est pas touché : un CM ne modifie toujours aucun profil
-- que le sien. La deuxième porte non plus — la policy permissive `Staff lecture annuaire` exige
-- déjà `is_staff()` et le partage de pôle, et c'est elle qui décide vraiment de l'étendue.
--
-- Vérifié avant d'écrire : les 18 profils sont tous dans le pôle Football, donc lever la
-- restriction rend bien l'annuaire complet et pas une liste vide de plus.

begin;

-- `is_staff()` répond pour l'APPELANT. Il fallait la même question pour quelqu'un d'autre : « ce
-- profil-là est-il de l'équipe SportVision ? ». Les critères sont recopiés de `is_staff` parce
-- qu'une règle recopiée diverge : si l'un des deux bouge, l'autre doit bouger. Ils sont écrits
-- l'un sous l'autre, dans le même ordre, pour que la comparaison soit immédiate.
create or replace function public.est_profil_equipe(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from profiles p
    where p.id = p_id
      and p.actif
      and p.role in ('admin','sec','prod','photo','cm','compta','com','rh')
      and not exists (
        select 1 from memberships m
        join organizations o on o.id = m.organization_id
        where m.user_id = p.id and o.organization_type <> 'cm_agency'
      )
      and not exists (select 1 from player_profiles pp where pp.user_id = p.id)
      and not exists (select 1 from connect_profile_settings cps where cps.user_id = p.id)
  );
$function$;

-- Pas de `revoke` : une policy s'évalue avec les droits du LECTEUR, et retirer l'exécution à
-- `authenticated` casserait la lecture au lieu de la borner (leçon du 12/09).
grant execute on function public.est_profil_equipe(uuid) to authenticated;

drop policy if exists cm_hors_perimetre_profiles on public.profiles;
create policy cm_hors_perimetre_profiles on public.profiles
  as restrictive
  for all
  to public
  using (
    (not est_cm_cloisonne())
    or (id = auth.uid())
    or cm_profil_de_ses_clubs(id)
    -- L'ÉQUIPE SPORTVISION EST VISIBLE DE TOUTE L'ÉQUIPE, community managers compris. Ce sont des
    -- collègues : on leur écrit, on cherche qui appeler un samedi.
    or est_profil_equipe(id)
  )
  with check (
    -- INCHANGÉ. Un CM ne modifie toujours que son propre profil.
    (not est_cm_cloisonne())
    or (id = auth.uid())
  );

commit;
