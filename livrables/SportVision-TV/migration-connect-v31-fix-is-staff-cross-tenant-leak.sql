-- ============================================================
-- SPORTVISION CONNECT — Migration v31 : DEUX correctifs liés, découverts
-- ensemble lors de l'audit bout-en-bout (flux/scénarios de permissions
-- croisées), du plus critique au moins critique.
--
-- ════════════════════════════════════════════════════════════════════
-- PARTIE A (LE PLUS CRITIQUE — PRISE DE CONTRÔLE ADMIN PUBLIQUE, NON
-- AUTHENTIFIÉE) : `handle_new_user()` fait aveuglément confiance au champ
-- `role` fourni par l'APPELANT dans `raw_user_meta_data`, pour TOUT
-- signup — y compris l'endpoint PUBLIC standard Supabase
-- `POST /auth/v1/signup` (accessible avec la seule clé anon, publique par
-- design, sans aucune authentification préalable).
--
-- PREUVE EN DIRECT (compte jetable réel, créé puis SUPPRIMÉ immédiatement
-- après ce test — voir le rapport d'audit pour le détail) :
--   POST https://lulgezzpvrlbftbykzrc.supabase.co/auth/v1/signup
--   { "email": "...", "password": "...", "data": { "role": "admin" } }
-- → HTTP 200, session valide retournée immédiatement, ligne `profiles`
-- créée avec `role='admin'`. Avec le JWT de ce compte auto-inscrit,
-- confirmé en direct : lecture de VRAIES fiches `clients` (nom/email/
-- téléphone réels, y compris le compte personnel de Fouka) et de
-- l'ANNUAIRE STAFF INTERNE COMPLET (`profiles` — noms, rôles, e-mails,
-- téléphones de plusieurs collaborateurs réels), via les policies RLS qui
-- font confiance à `profiles.role = 'admin'` (`clients_write_acces`,
-- "Staff lecture annuaire", etc. — plus d'une dizaine de policies dans
-- tout le schéma reposent sur `profiles.role`).
--
-- C'est une prise de contrôle admin complète, accessible à N'IMPORTE QUI
-- sur Internet, sans identifiants, en une seule requête HTTP. C'est de
-- loin le finding le plus grave de tout l'audit bout-en-bout de ce soir.
--
-- Pourquoi `handle_new_user()` doit lire `raw_user_meta_data.role` pour
-- CERTAINS cas légitimes : `invite-collaborateur` (edge function,
-- réservée aux admins via vérification explicite `callerProfile.role !==
-- 'admin' → 403`, ligne 62-63) appelle `admin.auth.admin.
-- inviteUserByEmail(email, { options: { data: { role, prenom, nom } } })`
-- pour créer un compte staff avec le bon rôle dès l'invitation — ce
-- chemin DOIT continuer à fonctionner.
--
-- Le signal fiable pour distinguer les deux cas : `auth.users.invited_at`
-- est renseigné par Supabase UNIQUEMENT quand le compte est créé via
-- `inviteUserByEmail` (le chemin admin ci-dessus) — il reste NULL pour
-- tout signup public standard (`/auth/v1/signup`, utilisé aussi bien par
-- l'attaquant testé ci-dessus que par les signups légitimes Connect
-- clients/clubs, qui eux n'ont de toute façon jamais besoin d'un rôle
-- `profiles` privilégié — vérifié : connect-org-signup et portal-
-- onboarding ne lisent/écrivent jamais `raw_user_meta_data`, ils opèrent
-- uniquement sur `auth.uid()` d'une session déjà ouverte via le SDK
-- standard, donc forcer `role='photo'` par défaut pour eux est neutre).
--
-- ════════════════════════════════════════════════════════════════════
-- PARTIE B : corrige `is_staff()`, qui accorde aujourd'hui un accès
-- "staff" à N'IMPORTE QUEL utilisateur authentifié possédant une ligne
-- dans `profiles` — pas seulement au vrai staff interne. Défense en
-- profondeur complémentaire à la Partie A (utile même après coup, par
-- exemple pour les lignes `profiles` déjà créées avant ce correctif, ou
-- si un futur bug réintroduit un chemin de création `profiles` non
-- maîtrisé).
--
-- ── Découverte (audit bout-en-bout Parties E+H, nuit du 11/08, VÉRIFIÉE
--    EN DIRECT avec des comptes jetables réels, pas une supposition) ──────
--
-- `is_staff()` (migration-connect-v2-organizations-entitlements.sql) :
--   select exists (select 1 from profiles where id = auth.uid());
--
-- Elle ne vérifie AUCUN rôle — juste l'existence d'une ligne `profiles`.
-- Or `handle_new_user()` (supabase-schema.sql, trigger `on_auth_user_created`
-- sur `auth.users`) crée AUTOMATIQUEMENT une ligne `profiles` pour CHAQUE
-- nouvel utilisateur Supabase Auth, sans exception, avec `role` par défaut
-- 'photo' si `raw_user_meta_data.role` est absent — ce qui est le cas pour
-- tout signup Connect (club, généraliste/projet, coach, académie, sponsor)
-- passant par connect-org-signup / portal-onboarding / etc.
--
-- Preuve en direct (comptes jetables E2E-TEST-DELETE-ME, supprimés après
-- ce test) : un admin de "Club A" (membership réelle, sans aucun droit
-- staff) authentifié avec son propre JWT a pu lire via REST direct
-- (GET /rest/v1/organizations?id=eq.<Club B>) la fiche complète
-- (nom, ville, statut, credits_balance, credits_reserved, legacy_*) de
-- "Club B", un club auquel il n'appartient pas. Cause : la policy
-- "org_member_select" sur `organizations` est `is_org_member(id) or
-- is_staff()`, et le compte de test avait — comme AURA TOUT NOUVEAU CLUB
-- QUI S'INSCRIT sur Connect à partir de maintenant — une ligne `profiles`
-- auto-créée par le trigger, donc `is_staff()` renvoyait `true`.
--
-- Portée : `is_staff()` est utilisée dans au moins 15 policies RLS
-- (grep exhaustif ci-dessous, vérifié), touchant potentiellement TOUT
-- futur club/client Connect, pas seulement ce cas de test :
--   - organizations (org_member_select)          → fuite cross-club confirmée
--   - memberships (mb_self_select)                → liste des membres d'autres orgs
--   - club_presences, requests (6 policies), event_checklist_items,
--     cm_agency_club_access, organization_credit_transactions (projet-credits)
--   - profiles ("Staff lecture annuaire")          → ANNUAIRE INTERNE COMPLET
--     (noms, téléphones, rôles de TOUT le staff SportVision) lisible par
--     n'importe quel club/client Connect une fois inscrit
--   - communication_templates, communication_template_versions,
--     notification_outbox, notification_attempts, webhook_events (!),
--     communication_suppressions, whatsapp_opt_ins, communication_audit_logs,
--     notifications (insert), centre_ressources
--   `webhook_events` en particulier peut contenir des charges utiles de
--   webhooks (Stripe et autres) — exposition potentiellement sensible.
--
-- ── Correctif ──────────────────────────────────────────────────────────
-- `is_staff()` doit distinguer un VRAI membre du staff interne SportVision
-- d'un utilisateur Connect qui possède accidentellement une ligne
-- `profiles` du seul fait du trigger de signup. Un membre du staff interne
-- n'a normalement JAMAIS de ligne `memberships` (concept propre aux
-- organisations Connect club/coach/académie/généraliste) : c'est le signal
-- le plus fiable actuellement disponible sans réarchitecturer le trigger
-- `handle_new_user`. `role` doit en plus être un rôle staff réel (le
-- check constraint sur `profiles.role` limite déjà aux 7 valeurs internes,
-- donc cette partie de la condition est däjà vraie aujourd'hui pour
-- absolument tout le monde — gardée explicite ici pour rester correcte si
-- la contrainte est élargie plus tard).
--
-- Ce correctif est DÉLIBÉRÉMENT conservateur (n'exclut que les comptes
-- ayant une ligne `memberships`) plutôt que de toucher au trigger
-- `handle_new_user` lui-même, dont la portée d'impact est plus large et
-- mériterait une décision produit séparée de Fouka (faut-il arrêter de
-- créer une ligne `profiles` pour les signups Connect ? Cela casserait
-- potentiellement d'autres suppositions du code existant à auditer avant
-- d'y toucher).
--
-- Idempotente (CREATE OR REPLACE). PRÉPARÉE, PAS EXÉCUTÉE — à relire et
-- exécuter manuellement par Fouka dans Supabase → SQL Editor. Recommandé
-- en priorité absolue avant le lancement : au moins un nouveau club
-- Connect va s'inscrire dans les 5 prochains jours.
-- ============================================================

-- ─── Partie A : le trigger ne fait plus confiance à raw_user_meta_data.role
-- que pour les comptes réellement invités par un admin (invited_at IS NOT
-- NULL). Tout signup public (invited_at NULL) reçoit systématiquement
-- role='photo' (le moins privilégié), quoi que le payload prétende.
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, role, prenom, nom)
  values (
    new.id,
    case
      when new.invited_at is not null then coalesce(new.raw_user_meta_data->>'role', 'photo')
      else 'photo'
    end,
    coalesce(new.raw_user_meta_data->>'prenom', ''),
    coalesce(new.raw_user_meta_data->>'nom', '')
  );
  return new;
end;
$$;

-- ─── Partie B ───────────────────────────────────────────────────────────
create or replace function is_staff()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('admin','sec','prod','photo','cm','compta','com')
      and not exists (select 1 from memberships m where m.user_id = p.id)
  );
$$;

-- Vérification post-exécution suggérée (à faire manuellement, ne rien
-- exécuter d'automatique ici) :
--   1. Rejouer le test ci-dessus avec un compte club jetable + JWT réel :
--      GET /rest/v1/organizations?id=eq.<autre club> doit renvoyer [].
--   2. Vérifier qu'un compte staff réel (role admin/sec/prod/cm/compta/com,
--      SANS ligne memberships) peut toujours lire organizations/profiles/etc.
--   3. Si un membre du staff a un jour aussi une ligne `memberships` (cas
--      rare, ex. test interne), cette personne perdrait alors is_staff() —
--      à surveiller, aucun cas de ce type trouvé en prod au moment de
--      l'écriture (0 recoupement staff/memberships vérifié en direct).
--   4. Rejouer le test Partie A : POST /auth/v1/signup avec
--      data:{role:"admin"} doit toujours renvoyer 200 (Supabase Auth
--      accepte toujours la création du compte), mais la ligne `profiles`
--      créée doit avoir role='photo', jamais 'admin'.
--   5. IMPORTANT — cette migration ne corrige PAS les comptes déjà créés
--      avant son exécution avec un role privilégié obtenu par cette faille
--      (le compte de test utilisé pour la preuve a déjà été supprimé).
--      Recommandé : vérifier manuellement s'il existe des profils
--      role='admin'/'sec'/'prod'/'cm'/'compta'/'com' inattendus (comptes
--      que Fouka ne reconnaît pas) parmi les profils existants, avant le
--      lancement — requête suggérée (lecture seule) :
--      select p.id, p.role, p.prenom, p.nom, u.email, u.invited_at
--      from profiles p join auth.users u on u.id = p.id
--      where p.role in ('admin','sec','prod','cm','compta','com')
--      order by u.created_at;
