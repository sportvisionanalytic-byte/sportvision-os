-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v53
-- Topbar : notifications réelles + recherche globale (Espace joueur ET
-- Espace particulier). Voir design-connect-personnel-12-08/README.md §
-- "Shell et navigation" / "Notifications" / MASTER-CONNECT-V1.md §29-30.
--
-- Idempotente (create or replace function, drop trigger if
-- exists avant chaque create trigger, ALTER ... DROP CONSTRAINT IF EXISTS
-- avant chaque ADD CONSTRAINT) : peut être rejouée sans effet de bord.
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- fonctions connect_notify_by_client_id, trg_notify_message_staff,
-- connect_prestation_stage, trg_notify_prestation_stage, join_user_group
-- et connect_global_search existent déjà en base. Cet en-tête disait à
-- tort "NON EXÉCUTÉE".
--
-- ────────────────────────────────────────────────────────────────────────
-- 0. DÉCISION DE SCHÉMA — table réutilisée, pas de nouvelle table
-- ────────────────────────────────────────────────────────────────────────
--
-- `member_notifications` (migration-connect-v16-member-notifications.sql,
-- déjà exécutée — vérifié en lisant le schéma réel via l'API service role
-- le 14/08 : table vide mais bien présente, colonnes conformes à v16)
-- convient telle quelle : générique à tout type de compte Connect
-- (id, user_id keyed sur auth.uid() direct, category, title, body,
-- target_href, is_pinned, read_at, created_at), RLS déjà correcte
-- (mn_owner_select/mn_owner_update scopés user_id = auth.uid(), aucune
-- policy INSERT authenticated — seuls les triggers SECURITY DEFINER
-- écrivent). C'est déjà la table utilisée par connect_request_profile_access
-- (migration-connect-personnel-accueil-profil-acces.sql) pour la notification
-- "nouvelle demande d'accès" et par app-next (lib/data/shared/notifications.ts)
-- pour Club+. Aucune raison de fragmenter les notifications personnelles
-- dans une deuxième table : même lecture (topbar joueur/particulier),
-- mêmes garanties de sécurité.
--
-- Seul ajustement nécessaire : la catégorie 'messages' n'existe pas dans le
-- CHECK constraint d'origine (content/requests/payments/contracts/services/
-- calendar/users/system) alors que "Message" est un type de notification
-- explicite du design (README § Notifications). Étendu ci-dessous, additif,
-- aucune ligne existante affectée.
--
-- Catégories utilisées par CE chantier (mapping avec le tableau README) :
--   Demande     -> 'requests'  (déjà câblé par connect_request_profile_access)
--   Prestation  -> 'services'  (câblé ici, §2)
--   Message     -> 'messages'  (câblé ici, §1 — catégorie ajoutée au CHECK)
--   (Invitation de groupe acceptée, absente du tableau README à 8 types
--    mais explicitement demandée par le brief) -> 'users' (câblé ici, §3)
-- Contenu/Contrat/Rendez-vous/Facture : catégories déjà présentes dans le
-- CHECK (content/contracts/calendar/payments) mais AUCUN trigger n'est
-- câblé ici — aucune table personnelle "contenu à valider"/"contrat à
-- signer"/"rendez-vous"/"facture" n'a d'équivalent réel côté Connect
-- personnel aujourd'hui sans un chantier de migration disproportionné pour
-- cette tâche (le trigger contenu de v16 cible `contenus.statut =
-- 'a_valider_client'`, qui est le planning éditorial CM/Club+, pas les
-- contenus personnels `club_media` — voir le commentaire de tête de
-- src/app/contenus/page.tsx, déjà vérifié le 14/08 par l'agent précédent).
-- Documenté ici comme extension future, pas simulé.
--
-- Préférences de notification (connect_profile_settings.notif_prestations /
-- notif_messages, migration-connect-personnel-accueil-profil-acces.sql §1) :
-- volontairement PAS vérifiées avant insertion, par cohérence avec les deux
-- triggers déjà en production sur ce modèle (trg_notify_facture_statut,
-- trg_notify_contenu_a_valider, migration-connect-v16) et avec
-- connect_request_profile_access (aucun des trois ne consulte de
-- préférence avant d'écrire). Ajouter ce filtre supposerait une résolution
-- dynamique de colonne par catégorie (SQL dynamique) pour un gain non
-- demandé par le brief — laissé en extension future documentée plutôt que
-- bricolé ici.
-- ============================================================


-- ────────────────────────────────────────────────────────────────────────
-- 1. CATÉGORIE 'messages' + notification sur nouveau message staff
-- ────────────────────────────────────────────────────────────────────────

alter table member_notifications drop constraint if exists member_notifications_category_check;
alter table member_notifications add constraint member_notifications_category_check
  check (category in ('content','requests','payments','contracts','services','calendar','users','system','messages'));

-- Résout, pour un client_id donné, tous les comptes Connect PERSONNELS
-- (joueur ou particulier — jamais un fanout club/staff, contrairement à
-- notify_client_members de v16 qui sert Club+) qui doivent recevoir une
-- notification, et l'insère avec le bon target_href SELON LE TYPE DE
-- COMPTE : les deux espaces ont des routes distinctes pour les mêmes
-- modules (AppShell = `/messages`, `/commandes/:id`… ; ParticularShell =
-- `/particulier/messages`, `/particulier/commandes/:id`… — voir
-- ParticularShell.tsx, commentaire de tête). Un joueur (player_profiles),
-- un particulier "propre" (connect_profile_settings) et le propriétaire
-- d'un profil géré (managed_athlete_profiles — le sportif lui-même n'a pas
-- de compte) peuvent tous être rattachés au même client_id ; UNION dédoublonne
-- naturellement (un client_id n'a normalement qu'UN de ces trois chemins).
create or replace function connect_notify_by_client_id(
  p_client_id uuid,
  p_category text,
  p_title text,
  p_body text,
  p_player_href text,
  p_particulier_href text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_client_id is null then
    return;
  end if;

  insert into member_notifications (user_id, category, title, body, target_href)
  select distinct r.uid, p_category, p_title, p_body,
    case when r.kind = 'player' then p_player_href else p_particulier_href end
  from (
    select user_id as uid, 'player'::text as kind
    from player_profiles where client_id = p_client_id and user_id is not null
    union
    select user_id, 'particulier'::text
    from connect_profile_settings where client_id = p_client_id
    union
    select owner_user_id, 'particulier'::text
    from managed_athlete_profiles where client_id = p_client_id
  ) r;
end;
$$;

-- Nouveau message reçu — auteur_type = 'staff' uniquement (un message
-- envoyé PAR le joueur/particulier ne se notifie pas lui-même). Titre/corps
-- volontairement génériques (jamais le nom du membre du staff — pas une
-- donnée que Connect personnel a besoin d'exposer). Contenu tronqué à 140
-- caractères pour rester un aperçu, jamais l'intégralité d'un message privé
-- dans une notification qui peut apparaître dans un panneau partagé d'écran.
create or replace function trg_notify_message_staff()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auteur_type = 'staff' then
    perform connect_notify_by_client_id(
      new.client_id,
      'messages',
      'Nouveau message de SportVision',
      left(coalesce(new.contenu, ''), 140),
      '/messages',
      '/particulier/messages'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_message_staff on messages_client;
create trigger trg_notify_message_staff after insert on messages_client
  for each row execute function trg_notify_message_staff();


-- ────────────────────────────────────────────────────────────────────────
-- 2. NOTIFICATION SUR CHANGEMENT DE STATUT D'UNE PRESTATION
-- ────────────────────────────────────────────────────────────────────────
--
-- `prestations.statut` a ~30 valeurs internes destinées au staff (voir
-- src/lib/prestations/status.ts, déjà en place côté frontend : RAW_TO_STAGE
-- compresse en 6 étapes client "en_validation / confirmee / planifiee /
-- en_production / livree / terminee" + "annulee"). Notifier sur CHAQUE
-- changement de statut brut spammerait (jusqu'à ~30 notifications pour une
-- seule prestation) — cette fonction reproduit EXACTEMENT le même mapping
-- SQL côté serveur, pour ne notifier que sur un changement d'ÉTAPE visible
-- côté client, une seule fois par étape franchie, quel que soit le statut
-- brut précis qui l'a déclenchée.
create or replace function connect_prestation_stage(p_statut text)
returns text language sql immutable as $$
  select case p_statut
    when 'demande_reçue' then 'en_validation'
    when 'à_qualifier' then 'en_validation'

    when 'offre_en_préparation' then 'confirmee'
    when 'devis_envoyé' then 'confirmee'
    when 'en_attente_réponse' then 'confirmee'
    when 'devis_accepté' then 'confirmee'
    when 'en_attente_signature' then 'confirmee'
    when 'en_attente_acompte' then 'confirmee'
    when 'documents_complets' then 'confirmee'

    when 'à_valider_production' then 'planifiee'
    when 'confirmée' then 'planifiee'
    when 'à_planifier' then 'planifiee'
    when 'planifiée' then 'planifiee'
    when 'équipe_affectée' then 'planifiee'
    when 'prête' then 'planifiee'
    when 'équipe_en_route' then 'planifiee'
    when 'arrivée_sur_place' then 'planifiee'

    when 'production_démarrée' then 'en_production'
    when 'production_terminée' then 'en_production'
    when 'médias_à_transférer' then 'en_production'
    when 'médias_complets' then 'en_production'
    when 'à_monter' then 'en_production'
    when 'montage_en_cours' then 'en_production'
    when 'prêt_validation' then 'en_production'
    when 'à_valider_client' then 'en_production'

    when 'prête_à_livrer' then 'livree'
    when 'livrée' then 'livree'

    when 'facturée' then 'terminee'
    when 'partiellement_payée' then 'terminee'
    when 'payée' then 'terminee'
    when 'clôturée' then 'terminee'

    when 'annulée' then 'annulee'
    when 'refusée' then 'annulee'
    else 'en_validation'
  end;
$$;

create or replace function trg_notify_prestation_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_stage text;
  v_new_stage text;
  v_title text;
  v_body text;
  v_label text;
begin
  v_old_stage := connect_prestation_stage(old.statut);
  v_new_stage := connect_prestation_stage(new.statut);

  if v_new_stage = v_old_stage or v_new_stage = 'en_validation' then
    return new;
  end if;

  v_label := coalesce(nullif(new.reference, ''), 'Votre prestation');

  case v_new_stage
    when 'confirmee' then
      v_title := 'Prestation confirmée';
      v_body := v_label || ' a été confirmée par SportVision.';
    when 'planifiee' then
      v_title := 'Prestation planifiée';
      v_body := v_label || ' est planifiée' ||
        case when new.date_prestation is not null then ' le ' || to_char(new.date_prestation, 'DD/MM/YYYY') else '' end || '.';
    when 'en_production' then
      v_title := 'Contenus en cours de production';
      v_body := 'L''équipe SportVision travaille sur les contenus de ' || v_label || '.';
    when 'livree' then
      v_title := 'Vos contenus sont livrés';
      v_body := 'Les contenus de ' || v_label || ' sont disponibles.';
    when 'terminee' then
      v_title := 'Prestation terminée';
      v_body := v_label || ' est maintenant terminée.';
    when 'annulee' then
      v_title := 'Prestation annulée';
      v_body := v_label || ' a été annulée.';
    else
      return new;
  end case;

  perform connect_notify_by_client_id(new.client_id, 'services', v_title, v_body, '/commandes/' || new.id, '/particulier/commandes/' || new.id);

  return new;
end;
$$;

drop trigger if exists trg_notify_prestation_stage on prestations;
create trigger trg_notify_prestation_stage after update of statut on prestations
  for each row execute function trg_notify_prestation_stage();


-- ────────────────────────────────────────────────────────────────────────
-- 3. NOTIFICATION "NOUVELLE DEMANDE D'ACCÈS" — DÉJÀ CÂBLÉE, VÉRIFIÉE SEULEMENT
-- ────────────────────────────────────────────────────────────────────────
--
-- connect_request_profile_access() (migration-connect-personnel-accueil-
-- profil-acces.sql, lignes 220-229) insère déjà une ligne member_notifications
-- (category 'requests', target_href '/acces') pour le propriétaire du
-- profil dès qu'une demande d'accès est créée ou relancée. Vérifié en
-- relisant le corps de la fonction le 14/08 — AUCUN changement nécessaire
-- ici. Seule nuance : cette notification pointe toujours vers '/acces', qui
-- n'existe QUE côté Espace joueur (README § Écrans : "Accès à mon profil…
-- (joueur uniquement)") — cohérent, un particulier n'est jamais le
-- PROPRIÉTAIRE d'un profil qu'on demande à consulter dans ce modèle.


-- ────────────────────────────────────────────────────────────────────────
-- 4. NOTIFICATION "INVITATION DE GROUPE ACCEPTÉE"
-- ────────────────────────────────────────────────────────────────────────
--
-- join_user_group() (migration-connect-v50) rejoint un groupe depuis un
-- lien d'invitation mais ne notifiait personne. Ajout : le créateur du
-- groupe (celui qui a partagé le lien, README § Mes équipes → modale
-- d'invitation) reçoit une notification quand quelqu'un le rejoint — pas
-- réémise si l'appelant est déjà membre (idempotent, comme le reste de la
-- fonction), pas émise si le créateur rejoint son propre groupe (impossible
-- en pratique, déjà membre dès la création). "Mes équipes" n'existe QUE côté
-- Espace joueur (absent de la nav ParticularShell) : target_href fixe
-- `/equipes/:id`, pas de variante particulier nécessaire.
-- CREATE OR REPLACE avec la MÊME signature que v50 (aucun DROP nécessaire,
-- pas de changement de type de retour) : aucune régression pour l'appelant
-- existant (CreateGroupWizard/JoinGroupPage, inchangés).
create or replace function join_user_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_creator uuid;
  v_already boolean;
  v_joiner_label text;
begin
  select name, created_by into v_name, v_creator from user_groups where id = p_group_id;
  if not found then
    raise exception 'Ce lien de groupe n''est plus valide.';
  end if;

  select exists(select 1 from user_group_members where group_id = p_group_id and user_id = auth.uid()) into v_already;

  if not v_already then
    insert into user_group_members (group_id, user_id, role) values (p_group_id, auth.uid(), 'membre');

    if v_creator is not null and v_creator <> auth.uid() then
      select coalesce(nullif(trim(pp.prenom), ''), split_part(u.email, '@', 1), 'Un membre')
        into v_joiner_label
        from auth.users u
        left join player_profiles pp on pp.user_id = u.id
        where u.id = auth.uid();

      insert into member_notifications (user_id, category, title, body, target_href)
      values (
        v_creator, 'users', 'Nouveau membre dans votre équipe',
        coalesce(v_joiner_label, 'Un membre') || ' a rejoint « ' || v_name || ' ».',
        '/equipes/' || p_group_id
      );
    end if;
  end if;

  return jsonb_build_object('ok', true, 'group_name', v_name, 'already_member', v_already);
end;
$$;

grant execute on function join_user_group(uuid) to authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- 5. RECHERCHE GLOBALE — connect_global_search()
-- ────────────────────────────────────────────────────────────────────────
--
-- Même niveau de rigueur que les RPC de lecture v50/v51 (list_my_groups,
-- list_my_fundings, connect_list_my_athletes…) : SECURITY DEFINER,
-- vérification explicite de l'appelant, jamais un select brut ouvert.
-- Portée EXACTE du README § Recherche : contenus / prestations / cotisations
-- / équipes / affiliations — jamais de donnée Club+ (aucune table
-- staff/organisation interrogée ici, uniquement des tables déjà scopées à
-- l'appelant par construction).
--
-- p_space ('joueur' | 'particulier', fourni par le frontend qui sait déjà
-- dans quel espace il tourne) : équipes et affiliations n'ont aucune route
-- de destination côté Espace particulier (absentes de ParticularShell) —
-- inutile de les renvoyer dans ce cas plutôt que de les cacher côté client
-- (le README §30 est explicite : la sécurité/portée ne repose jamais sur un
-- masquage d'interface, mais ici il ne s'agit pas de sécurité, seulement
-- d'éviter de renvoyer un résultat sans destination cliquable réelle).
--
-- Prestations/cotisations utilisent les MÊMES primitives déjà en production
-- (connect_client_ids_for_caller, list_my_fundings) : un particulier ET un
-- joueur y ont chacun un chemin ('self' via connect_owner_client_id, qui
-- coalesce player_profiles.client_id puis connect_profile_settings.client_id
-- — couvre les deux comptes sans branche spécifique), donc AUCUNE branche
-- "si joueur / si particulier" n'est nécessaire pour ces deux catégories.
--
-- Contenus n'a pas d'équivalent RPC "self" existant (connect_list_contents_
-- for_athletes ne couvre que les sportifs LIÉS d'un particulier, jamais son
-- propre club_media s'il est joueur) : complété ici avec la même fonction
-- de sécurité is_media_visible_to_family() déjà utilisée par la policy RLS
-- cmd_family_select (migration-clubplus-v18/v30) — pas une nouvelle règle
-- d'autorisation, la même, appelée explicitement.
--
-- Aucune route "item précis" n'existe pour un contenu individuel
-- (ContentGallery n'a pas de deep-link par id, vérifié le 14/08) : le lien
-- renvoyé pointe vers la page de la galerie, pas un article introuvable —
-- pas de fausse promesse de destination.
create or replace function connect_global_search(p_query text, p_space text default 'joueur')
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_q text := trim(coalesce(p_query, ''));
  v_pattern text;
  v_contenus jsonb;
  v_prestations jsonb;
  v_cotisations jsonb;
  v_equipes jsonb := '[]'::jsonb;
  v_affiliations jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if p_space not in ('joueur', 'particulier') then
    p_space := 'joueur';
  end if;

  -- Requête trop courte : retour vide plutôt qu'un scan large peu utile.
  if length(v_q) < 2 then
    return jsonb_build_object('contenus', '[]'::jsonb, 'prestations', '[]'::jsonb, 'cotisations', '[]'::jsonb, 'equipes', '[]'::jsonb, 'affiliations', '[]'::jsonb);
  end if;
  v_pattern := '%' || left(v_q, 100) || '%';

  -- ── Contenus (club_media) — soi-même (joueur) UNION sportifs liés (particulier) ──
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'subtitle', subtitle)), '[]'::jsonb)
  into v_contenus
  from (
    select cm.id, cm.title, coalesce(cm.team, 'Vos contenus') as subtitle
    from player_profiles pp
    join club_media cm on cm.club_id = pp.club_id and cm.expired = false
    where pp.user_id = auth.uid()
      and is_media_visible_to_family('club_media', cm.id)
      and cm.title ilike v_pattern

    union all

    select c.id, c.title, coalesce(c.athlete_label, 'Vos contenus') as subtitle
    from connect_list_contents_for_athletes() c
    where c.title ilike v_pattern

    limit 8
  ) x;

  -- ── Prestations (mes commandes) — connect_client_ids_for_caller('commandes')
  --    couvre déjà soi-même + sportifs liés (droit "commandes") + profils gérés,
  --    pour joueur ET particulier (voir commentaire de tête ci-dessus).
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'subtitle', subtitle)), '[]'::jsonb)
  into v_prestations
  from (
    select p.id,
      coalesce(co.nom, initcap(replace(p.type_prestation, '_', ' '))) as title,
      coalesce(nullif(p.reference, ''), to_char(p.created_at, 'DD/MM/YYYY')) as subtitle
    from prestations p
    left join catalogue_offres co on co.id = p.offre_id
    where p.client_id in (select client_id from connect_client_ids_for_caller('commandes'))
      and (
        p.reference ilike v_pattern
        or co.nom ilike v_pattern
        or p.type_prestation ilike v_pattern
        or p.lieu ilike v_pattern
        or p.equipes ilike v_pattern
      )
    order by p.created_at desc
    limit 8
  ) x;

  -- ── Cotisations — list_my_fundings() couvre déjà créateur + membre de
  --    groupe + contributeur, pour joueur ET particulier.
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'subtitle', subtitle)), '[]'::jsonb)
  into v_cotisations
  from (
    select f.id, f.titre as title, coalesce(f.beneficiary_label, f.group_name, f.catalogue_offre_nom, '') as subtitle
    from list_my_fundings() f
    where f.titre ilike v_pattern or f.contexte ilike v_pattern or f.group_name ilike v_pattern
    limit 8
  ) x;

  if p_space = 'joueur' then
    -- ── Équipes (groupes personnels) ──
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'subtitle', subtitle)), '[]'::jsonb)
    into v_equipes
    from (
      select g.id, g.name as title, coalesce(g.description, '') as subtitle
      from list_my_groups() g
      where g.name ilike v_pattern or g.description ilike v_pattern
      limit 8
    ) x;

    -- ── Affiliations — une seule affiliation possible aujourd'hui (voir
    --    session.ts buildPlayerContext), donc au plus un résultat.
    select coalesce(jsonb_agg(jsonb_build_object('id', pp.club_id, 'title', org.nom, 'subtitle', coalesce(org.ville, ''))), '[]'::jsonb)
    into v_affiliations
    from player_profiles pp
    join organizations org on org.id = pp.club_id
    where pp.user_id = auth.uid() and pp.account_status <> 'retire' and org.nom ilike v_pattern
    limit 1;
  end if;

  return jsonb_build_object(
    'contenus', v_contenus,
    'prestations', v_prestations,
    'cotisations', v_cotisations,
    'equipes', v_equipes,
    'affiliations', v_affiliations
  );
end;
$$;

grant execute on function connect_global_search(text, text) to authenticated;

-- ============================================================
-- FIN. Résumé des actions manuelles requises après relecture :
--   1. Exécuter ce fichier entier dans Supabase → SQL Editor (idempotent).
--   2. Aucun redéploiement d'Edge Function nécessaire : tout passe par des
--      triggers/RPC Postgres, actifs dès l'exécution du script.
--   3. member_notifications est déjà dans la publication supabase_realtime
--      (migration-connect-v42-enable-realtime-sync.sql, déjà exécutée) —
--      le frontend peut s'abonner en direct sans migration supplémentaire.
-- ============================================================
