-- ============================================================================
-- migration-audit-qa-finance-fix-profiles-self-select-expert-comptable.sql
-- ============================================================================
-- Campagne de QA boutons/interactions nocturne (29-30/08/2026), périmètre
-- Finance/Comptabilité. Bug CRITIQUE trouvé en testant une vraie connexion
-- avec un compte role='expert_comptable' (et role='auditeur') : le login
-- échoue systématiquement avec "Profil introuvable. Contactez
-- l'administrateur." — ces deux rôles ne peuvent PAS se connecter du tout,
-- alors qu'ils sont pleinement implémentés côté app (ROLES, NAV, dashboard
-- dédié tplExpertComptableDash, écrans Finance en lecture seule...).
--
-- Cause : `profiles` n'a qu'une seule policy SELECT, "Staff lecture
-- annuaire", gardée par is_staff() — et is_staff() (définie dans une
-- migration antérieure, hors périmètre Finance) ne liste que
-- ('admin','sec','prod','photo','cm','compta','com'), sans 'expert_comptable'
-- ni 'auditeur'. Résultat : après une connexion réussie côté Supabase Auth,
-- l'appel `profiles?id=eq.<uid>&select=role,prenom,actif` (doLogin(), ligne
-- ~3251 de SportVision-OS-Full.html) revient avec un tableau VIDE (RLS
-- bloque la lecture, HTTP 200 mais 0 ligne) — pas une erreur réseau — donc
-- l'app conclut à tort "profil introuvable" et bloque la connexion, pour
-- CHAQUE compte de ces deux rôles, sans exception.
--
-- Plutôt que d'ajouter ces deux rôles à is_staff() (fonction réutilisée par
-- de nombreuses autres policies dans tout le schéma, avec une logique
-- spécifique de distinction "staff pur" vs "staff ayant aussi un compte
-- personnel Connect/Club+/joueur" — un rôle qui n'a par construction jamais
-- ce genre de double-compte n'a aucune raison d'hériter du reste du
-- périmètre is_staff() juste pour pouvoir se lire lui-même), on ajoute une
-- policy SELECT strictement équivalente à la policy UPDATE "Mise à jour
-- profil personnel" déjà en prod (qual: auth.uid() = id) : n'importe quel
-- utilisateur authentifié peut lire SA PROPRE ligne profiles, quel que soit
-- son rôle — c'est un prérequis de base du flux de connexion, pas un
-- privilège "staff". Additive (RLS permissive : les policies SELECT se
-- combinent en OR), n'entraîne aucune régression sur "Staff lecture
-- annuaire" ni aucune autre policy existante, aucune donnée touchée.
-- ============================================================================

create policy "Lecture profil personnel"
on public.profiles
for select
to public
using (auth.uid() = id);
