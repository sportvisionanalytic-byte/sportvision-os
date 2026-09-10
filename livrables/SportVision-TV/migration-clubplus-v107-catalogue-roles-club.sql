-- Personne ne pouvait changer le rôle d'un membre de club. Pas même l'administrateur.
--
-- ── Trouvé en testant la révocation par le CM, le 10/09/2026 ──
-- Un changement `coach` → `resp_equipe` était refusé :
--
--   ERROR: Rôle invalide pour ce type d'organisation.
--
-- Le refus vient de `protect_sensitive_membership_fields`, qui valide le rôle contre
-- `organization_role_catalog`. Ce catalogue couvre sept types d'organisation — academie,
-- cm_agency, coach, sponsor, stage, structure_coaching, tournoi — et PAS `club`. Zéro ligne.
--
-- Vérifié : l'administrateur du club se heurte au même refus. Ce n'est donc pas une conséquence
-- de l'ouverture faite au CM, c'est un défaut qui existait avant, et qui rendait
-- `setClubMemberStatus`/le changement de rôle inopérants pour tout le monde sur un club.
--
-- ── Ce qu'on écrit, et d'où ça vient ──
-- Rien d'inventé : les treize rôles sont RECOPIÉS de la contrainte `club_members_role_check`,
-- qui est la source de vérité pour un club. La synchronisation `sync_club_member_to_membership`
-- copie d'ailleurs `club_members.role` tel quel dans `memberships.role` — les deux listes doivent
-- donc coïncider, faute de quoi le catalogue rejette ce que la contrainte accepte.
--
-- `is_admin` marque les rôles qui administrent le club. Il vaut `true` pour `admin` seulement :
-- `president` est un rôle de représentation, et le lui donner ici lui ouvrirait `is_org_admin`
-- sur d'autres chemins que ceux vérifiés aujourd'hui. On ne change pas la portée d'un rôle au
-- détour d'un correctif de catalogue.

begin;

insert into public.organization_role_catalog (organization_type, role_key, label, is_admin, is_default)
values
  ('club', 'admin',             'Administrateur',            true,  false),
  ('club', 'president',         'Président',                 false, false),
  ('club', 'secretaire',        'Secrétaire',                false, false),
  ('club', 'comm',              'Responsable communication', false, false),
  ('club', 'cm_externe',        'Community manager externe', false, false),
  ('club', 'coach',             'Coach',                     false, true),
  ('club', 'resp_equipe',       'Responsable d''équipe',      false, false),
  ('club', 'sponsor_mgr',       'Responsable sponsors',      false, false),
  ('club', 'tresorier',         'Trésorier',                 false, false),
  ('club', 'membre_bureau',     'Membre du bureau',          false, false),
  ('club', 'lecture_seule',     'Lecture seule',             false, false),
  ('club', 'directeur_sportif', 'Directeur sportif',         false, false),
  ('club', 'administratif',     'Administratif',             false, false)
on conflict do nothing;

commit;
