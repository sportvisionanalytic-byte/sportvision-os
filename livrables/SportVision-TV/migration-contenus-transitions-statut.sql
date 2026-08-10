-- Migration : contraint les transitions de statut sur `contenus` (audit
-- nocturne 09/08 → 10/08, point 2 : "aucune contrainte de transition de
-- statut sur les contenus").
--
-- ─── Constat vérifié ───────────────────────────────────────────────────────
-- Le CHECK constraint sur contenus.statut (migration-contenus.sql) valide
-- seulement l'appartenance à l'ensemble des 8 valeurs possibles, jamais la
-- transition d'une valeur à une autre. Aucun trigger BEFORE UPDATE
-- n'existe sur cette colonne à ce jour (seul trg_notify_contenu_statut_change,
-- migration-cm-notifications-contenus.sql, est un AFTER UPDATE qui se
-- contente d'envoyer un e-mail, sans jamais bloquer). Un simple PATCH REST
-- (avancerContenu() envoie `{statut}` brut, sans passer par une RPC) peut
-- donc aujourd'hui faire sauter un contenu de 'brouillon' à 'publie'
-- directement, ou de 'publie' à 'brouillon', tant que la policy RLS
-- contenus_update autorise l'update par ailleurs (portefeuille/propriétaire/
-- Lead) — RLS gouverne QUI peut modifier la ligne, pas QUELLE valeur est
-- cohérente avec l'état précédent.
--
-- ─── Séquence retenue et sa source ──────────────────────────────────────
-- Pas de séquence inventée : reprise à l'identique de deux sources qui se
-- confirment mutuellement.
--
-- 1. Le commentaire d'en-tête de migration-contenus.sql (lignes 17-23),
--    écrit AVANT ce correctif, documente déjà l'intention : « brouillon →
--    a_valider_interne → a_valider_client → valide → programme → publie,
--    avec une branche corrections (depuis a_valider_interne ou
--    a_valider_client, revient à brouillon) et archive en état terminal
--    manuel depuis publie ».
--
-- 2. L'UI réelle (SportVision-OS-Full.html) implémente exactement cette
--    séquence et RIEN d'autre :
--    - CONTENU_NEXT (~ligne 14703) est la seule source des boutons "étape
--      suivante" (avancerContenu()) : brouillon→a_valider_interne→
--      a_valider_client→valide→programme→publie→archive, et
--      corrections→brouillon pour la reprise.
--    - canCorrections (~ligne 14862, modalEditContenu) n'affiche le bouton
--      "Demander corrections" que si statut ∈ {a_valider_interne,
--      a_valider_client} — donc corrections n'est atteignable que depuis
--      ces deux états, jamais depuis brouillon/valide/programme/publie.
--    - client_valider_contenu() (migration-connect-validation-contenus.sql,
--      étendue par migration-clubplus-v34-club-messages-contenus-access.sql)
--      exige explicitement `v_row.statut = 'a_valider_client'` avant
--      d'accepter une décision, et ne produit que 'valide' ou 'corrections'.
--
--    Aucun autre chemin d'écriture sur contenus.statut n'existe dans le
--    code actuel (grep confirmé : avancerContenu, sauvegarderContenu qui
--    lui n'envoie jamais `statut`, et client_valider_contenu sont les seuls
--    points d'écriture).
--
-- Les 9 transitions autorisées, donc :
--   brouillon          → a_valider_interne
--   a_valider_interne  → a_valider_client
--   a_valider_interne  → corrections
--   a_valider_client   → valide
--   a_valider_client   → corrections
--   valide             → programme
--   programme          → publie
--   publie             → archive
--   corrections        → brouillon
--
-- ─── Cas d'usage "saut d'étape légitime" ────────────────────────────────
-- Cherché explicitement un cas où sauter une étape serait légitime (ex:
-- republier un contenu déjà publié directement) : AUCUN chemin de ce genre
-- n'existe dans l'UI actuelle. loadCmPublications() affiche les contenus
-- 'publie' avec un seul bouton "Détail" (→ modalEditContenu), qui lui-même
-- n'expose que CONTENU_NEXT['publie'] = archive. Il n'y a pas de bouton
-- "republier". Je n'invente donc pas d'exception pour un usage qui n'existe
-- pas dans le produit — si Fouka veut un jour un flux de republication
-- directe, c'est un ajout de fonctionnalité à traiter séparément (avec son
-- propre bouton UI et sa propre entrée dans la liste blanche ci-dessous),
-- pas quelque chose à deviner ici.
--
-- ─── Échappatoire admin/Lead CM ─────────────────────────────────────────
-- Reprend le pattern déjà établi sur cette table par
-- contenus_protect_cm_id_reassignment (migration-cm-contenus-edition-
-- collaborative.sql) : admin et Lead CM contournent la contrainte de
-- séquence (ex: correction manuelle d'une erreur de saisie, remise en
-- 'brouillon' exceptionnelle d'un contenu 'publie' par erreur). Ce n'est
-- pas un blanc-seing sur le reste : le CHECK constraint sur les valeurs
-- elles-mêmes s'applique toujours à tout le monde, y compris admin.
--
-- ─── Portée du trigger ───────────────────────────────────────────────────
-- BEFORE UPDATE, s'applique à TOUTE écriture sur contenus.statut quel que
-- soit l'appelant — y compris client_valider_contenu() (SECURITY DEFINER
-- sur la fonction, mais auth.uid() à l'intérieur du trigger reste bien
-- l'utilisateur appelant réel, pas changé par SECURITY DEFINER ; un
-- client_users n'a pas de ligne dans profiles donc ne bénéficie jamais du
-- bypass admin/Lead CM, il doit passer par la liste blanche comme
-- n'importe qui — ses deux seules transitions possibles,
-- a_valider_client→valide et a_valider_client→corrections, y figurent déjà).
-- Aucun changement de statut (NEW.statut is not distinct from OLD.statut,
-- ex: sauvegarderContenu() qui ne touche jamais `statut`) n'est concerné.
--
-- Additive, idempotente (create or replace function, drop trigger if
-- exists). Ne touche à rien d'autre (RLS, CHECK constraint, autres colonnes
-- inchangés). À exécuter après migration-contenus.sql.
--
-- NON EXÉCUTÉE PAR L'AGENT. À exécuter par Fouka dans Supabase → SQL Editor
-- après relecture.

create or replace function contenus_valider_transition_statut()
returns trigger language plpgsql security definer as $$
begin
  if NEW.statut is not distinct from OLD.statut then
    return NEW;
  end if;

  if exists (
    select 1 from profiles p where p.id = auth.uid()
    and (p.role = 'admin' or (p.role = 'cm' and p.niveau_cm = 'cm_lead'))
  ) then
    return NEW;
  end if;

  if (OLD.statut, NEW.statut) in (
    ('brouillon','a_valider_interne'),
    ('a_valider_interne','a_valider_client'),
    ('a_valider_interne','corrections'),
    ('a_valider_client','valide'),
    ('a_valider_client','corrections'),
    ('valide','programme'),
    ('programme','publie'),
    ('publie','archive'),
    ('corrections','brouillon')
  ) then
    return NEW;
  end if;

  raise exception 'Transition de statut non autorisée : % → % ne suit pas le workflow éditorial.', OLD.statut, NEW.statut;
end;
$$;

drop trigger if exists trg_contenus_valider_transition_statut on contenus;
create trigger trg_contenus_valider_transition_statut
before update on contenus
for each row execute function contenus_valider_transition_statut();
