-- ============================================================
-- SPORTVISION CLUB+ — Migration v39
-- Suite de migration-clubplus-v1 à v38.sql. Idempotente.
--
-- Renumérotée v38 -> v39 le 16/08 : migration-clubplus-v38-studio-
-- sponsors.sql (autre agent, chantier "Studio dynamique + Sponsors
-- backend réel") a été mergée sur main pendant l'écriture de celle-ci —
-- v38 était déjà pris au moment de committer, v39 est le premier numéro
-- réellement libre.
--
-- Trois chantiers indépendants de CLUB-PLUS-PRODUCT-BIBLE.md, regroupés
-- dans un seul fichier pour limiter le nombre de numéros de migration
-- réservés en parallèle par d'autres agents (16/08/2026) :
--
--   1. §17 Contenus, visuels et visibilité Connect — 4 options de
--      visibilité (Privé Club+ / Affiliés du groupe / Sportifs
--      sélectionnés / Automatique pour tous). Le mécanisme existant
--      (media_access_rules, migration-clubplus-v18.sql) ne supporte que
--      le scope "toute une équipe" (team_id) — rien ne permet de cibler
--      des sportifs précis indépendamment de leur équipe. Ajoute ce
--      second mode ("players") sans toucher au mode "team" existant.
--
--      Au passage, restaure une régression trouvée en vérifiant
--      is_media_visible_to_family avant d'y toucher : migration-
--      clubplus-v19.sql avait ajouté un filtre média masqué/retiré
--      (media_reports.statut in ('media_masque','retrait_accepte')),
--      mais migration-clubplus-v30 (07/08, postérieure) a réécrit la
--      fonction en entier pour ajouter le blocage droit à l'image SANS
--      reprendre ce filtre v19 — un média masqué suite à un signalement
--      redevenait donc visible côté famille depuis le 07/08. Corrigé ici
--      en fusionnant les 3 protections (v19 + v30 + nouveau mode
--      "players") dans une seule fonction, jamais dans une nouvelle,
--      pour ne pas perdre à nouveau un filtre lors d'une future
--      réécriture. Signalé à Fouka dans le rapport de cet agent.
--
--   2. §19 Documents, factures et paiements — statut "Partiellement
--      payée" absent de factures.statut, et aucune colonne ne distingue
--      le montant déjà réglé du montant total. Ajoute uniquement la
--      donnée (statut + montant_paye, + colonne exposée dans la vue
--      client_factures) : aucune logique d'encaissement réel construite
--      ici (alimentation prévue depuis SportVision OS/Stripe séparément,
--      hors périmètre de ce chantier).
--
--   3. §21 Notifications, aide et support — club_support_tickets.status
--      ne connaît que 'ouvert'/'en_cours'/'resolu' (migration-clubplus-
--      v11.sql) : le typage frontend (SupportTicketStatus) affiche déjà
--      5 états dont 'waiting_client', mais ce statut, jamais produit par
--      aucune écriture réelle, désigne aujourd'hui "SportVision attend
--      une réponse du client" — l'inverse de ce que demande la Bible
--      ("Réponse disponible" = SportVision a répondu, au client de
--      lire). Ajoute le statut manquant plutôt que de détourner
--      'waiting_client' vers un sens contraire à son nom. 'fermé' reste
--      hors périmètre de cette migration (non demandé explicitement,
--      voir rapport de l'agent).
--
-- ─── Vérification des données réelles avant migration (16/08/2026,
--     curl REST en lecture seule, SUPABASE_SECRET_KEY) ─────────────────
--   - media_access_rules        : 0 ligne en prod.
--   - media_player_tags         : 0 ligne en prod.
--   - club_media / club_creations : 0 ligne chacune en prod.
--   - factures                  : 0 ligne en prod ; colonne montant_paye
--     inexistante (erreur PostgREST 42703 confirmée).
--   - club_support_tickets      : 2 lignes, statut 'ouvert' uniquement.
--   - club_teams / team_memberships : 0 ligne en prod (tables existent,
--     colonnes vérifiées via migration-clubplus-v5/v13.sql).
-- Aucune donnée existante à backfiller pour les 3 chantiers.
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL
-- Editor. Ne JAMAIS exécuter depuis un agent.
-- ============================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. Visibilité des contenus — mode "Sportifs sélectionnés"
-- ────────────────────────────────────────────────────────────────────────

-- 'team' = comportement historique (v18) : accès à tous les sportifs actifs
-- de l'équipe référencée par team_id. 'players' = nouveau : accès limité aux
-- sportifs listés dans media_access_selected_players ci-dessous, quelle que
-- soit leur équipe. team_id reste nullable (déjà le cas depuis v18) : NULL
-- en mode 'players'.
alter table media_access_rules add column if not exists visibility_mode text
  check (visibility_mode in ('team','players')) not null default 'team';

create table if not exists media_access_selected_players (
  id uuid default gen_random_uuid() primary key,
  media_ref_type text check (media_ref_type in ('club_media','club_creations')) not null,
  media_ref_id uuid not null,
  player_id uuid references player_profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique (media_ref_type, media_ref_id, player_id)
);

create index if not exists idx_masp_media on media_access_selected_players(media_ref_type, media_ref_id);
create index if not exists idx_masp_player on media_access_selected_players(player_id);

alter table media_access_selected_players enable row level security;

-- Même périmètre que media_player_tags (v30) : réutilise media_ref_club_id()
-- (déjà définie en v30) plutôt que de dupliquer la résolution club_id.
drop policy if exists "masp_member_select" on media_access_selected_players;
create policy "masp_member_select" on media_access_selected_players for select using (
  is_club_member(media_ref_club_id(media_ref_type, media_ref_id))
);

drop policy if exists "masp_manager_insert" on media_access_selected_players;
create policy "masp_manager_insert" on media_access_selected_players for insert with check (
  is_club_admin(media_ref_club_id(media_ref_type, media_ref_id))
  or exists (
    select 1 from team_memberships tm
    where tm.player_id = media_access_selected_players.player_id and tm.statut = 'active'
      and is_team_educateur(tm.team_id)
  )
);

drop policy if exists "masp_manager_delete" on media_access_selected_players;
create policy "masp_manager_delete" on media_access_selected_players for delete using (
  is_club_admin(media_ref_club_id(media_ref_type, media_ref_id))
  or exists (
    select 1 from team_memberships tm
    where tm.player_id = media_access_selected_players.player_id and tm.statut = 'active'
      and is_team_educateur(tm.team_id)
  )
);

-- Fonction de visibilité famille — fusionne v18 (règle team), v19 (masquage
-- suite signalement, régressé par v30) et v30 (blocage droit à l'image),
-- et ajoute la branche 'players'. Remplace entièrement la version de v30.
create or replace function is_media_visible_to_family(p_media_ref_type text, p_media_ref_id uuid)
returns boolean language sql security definer stable as $$
  select (not media_has_unauthorized_tagged_player(p_media_ref_type, p_media_ref_id))
    and not exists (
      select 1 from media_reports mr
      where mr.media_ref_type = p_media_ref_type and mr.media_ref_id = p_media_ref_id
        and mr.statut in ('media_masque', 'retrait_accepte')
    )
    and exists (
      select 1 from media_access_rules r
      where r.media_ref_type = p_media_ref_type and r.media_ref_id = p_media_ref_id
        and (r.expire_at is null or r.expire_at > now())
        and (
          (
            r.visibility_mode = 'team' and exists (
              select 1 from team_memberships tm
              join player_profiles p on p.id = tm.player_id
              where tm.team_id = r.team_id and tm.statut = 'active'
                and (
                  (p.user_id = auth.uid() and r.visible_joueur)
                  or (is_confirmed_parent_of(p.id) and r.visible_parent)
                )
            )
          )
          or
          (
            r.visibility_mode = 'players' and exists (
              select 1 from media_access_selected_players sp
              join player_profiles p on p.id = sp.player_id
              where sp.media_ref_type = r.media_ref_type and sp.media_ref_id = r.media_ref_id
                and (
                  (p.user_id = auth.uid() and r.visible_joueur)
                  or (is_confirmed_parent_of(p.id) and r.visible_parent)
                )
            )
          )
        )
    );
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 2. Facture "Partiellement payée" + reste à régler
-- ────────────────────────────────────────────────────────────────────────

alter table factures add column if not exists montant_paye numeric(10,2) not null default 0;

alter table factures drop constraint if exists factures_statut_check;
alter table factures add constraint factures_statut_check check (statut in (
  'brouillon','emise','partiellement_payee','payee','en_retard','annulee','remboursee'
));

-- client_factures est une vue à liste de colonnes explicite (dernière définition :
-- migration-connect-v41-decisions-produit-11-08.sql) : montant_paye n'apparaît pas
-- automatiquement, il faut recréer la vue pour l'exposer côté Club+/Connect. Sécurité RLS
-- inchangée (même clause where que v41, copiée à l'identique).
drop view if exists client_factures;
create view client_factures as
select
  f.id, f.numero, f.type_facture, f.statut, f.client_id, f.prestation_id, f.devis_id,
  f.lignes, f.montant_ht, f.tva_pct, f.montant_ttc, f.montant_paye, f.date_emission,
  f.date_echeance, f.pdf_url, f.created_at
from factures f
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = f.client_id
) or club_member_has_financial_access(f.client_id);

-- ────────────────────────────────────────────────────────────────────────
-- 3. Support — statut "Réponse disponible"
-- ────────────────────────────────────────────────────────────────────────

alter table club_support_tickets drop constraint if exists club_support_tickets_status_check;
alter table club_support_tickets add constraint club_support_tickets_status_check check (status in (
  'ouvert','en_cours','reponse_disponible','resolu'
));

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select column_name from information_schema.columns
-- where table_name = 'media_access_rules' and column_name = 'visibility_mode';
--
-- select count(*) from media_access_selected_players; -- 0 attendu juste après
--
-- select montant_paye from factures limit 1; -- ne doit plus lever 42703
--
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conname in ('factures_statut_check','club_support_tickets_status_check');
--
-- Avec un compte club existant (aucune donnée média/facture/ticket réelle
-- aujourd'hui) : vérifier que /content, /billing et /support continuent de
-- s'afficher sans erreur (aucune ligne existante à casser).
-- ============================================================
