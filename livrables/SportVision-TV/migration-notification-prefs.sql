-- Migration : préférences de notification par collaborateur + rappels
-- automatiques avant une prestation.
--
-- Contexte : Fouka veut que chaque collaborateur puisse activer/désactiver
-- lui-même certaines catégories de notifications (nouvelles missions,
-- messages, matériel, tâches) et recevoir un rappel automatique avant ses
-- prestations à venir — fonctionnalité qui n'existait pas du tout jusqu'ici.
--
-- Prérequis : migration-notifications-fix.sql doit déjà avoir été exécutée
-- (colonnes lien_prestation_id, priorite, source_type, source_id sur
-- notifications) — normalement déjà fait puisque tout le moteur de
-- notifications du reste de l'app en dépend déjà.
--
-- ─── 1. Colonne de préférences sur profiles ──────────────────────────────────
-- jsonb à plat {catégorie: true/false}. Absence d'une clé = activé par défaut
-- (voir _notifEnabled() côté client, même logique de "opt-out" que côté
-- serveur ci-dessous).
alter table profiles
  add column if not exists notification_prefs jsonb not null default '{
    "invitations": true,
    "rappels": true,
    "messages": true,
    "materiel": true,
    "taches": true
  }'::jsonb;

-- ─── 1bis. Lecture du profil des collègues (annuaire / vérif. des préférences) ──
-- Découverte en construisant cette fonctionnalité : la seule policy de lecture
-- sur profiles en dehors de l'admin est "chacun voit SON PROPRE profil". Or de
-- nombreux écrans dépendent d'une lecture de profils d'AUTRES collaborateurs
-- par un non-admin — l'Annuaire équipe, la liste de contacts de la Messagerie,
-- le sélecteur de destinataire d'une invitation de mission, et maintenant la
-- vérification des préférences de notification avant d'envoyer une alerte à
-- quelqu'un d'autre. Sans cette policy, ces lectures sont silencieusement
-- filtrées à zéro ligne par RLS (PostgREST renvoie un tableau vide, pas une
-- erreur), donc potentiellement déjà cassées en production pour tout rôle
-- non-admin. Politique cohérente avec le reste de l'app (équipe unique, pas de
-- séparation stricte entre collaborateurs) : tout profil connecté peut lire
-- les profils des autres — mais ne peut PAS les modifier (policy d'update
-- inchangée, toujours limitée à soi-même + admin).
drop policy if exists "Staff lecture annuaire" on profiles;
create policy "Staff lecture annuaire" on profiles
  for select using (
    exists (select 1 from profiles where id = auth.uid())
  );

-- ─── 2. Fonction d'envoi des rappels de prestation ──────────────────────────
-- Cherche les prestations du lendemain (statut actif) et notifie chaque
-- collaborateur ayant accepté sa mission, sauf s'il a désactivé "rappels" ou
-- si un rappel a déjà été envoyé pour cette prestation (idempotent — peut être
-- rejouée/re-planifiée sans doublons).
create or replace function send_prestation_reminders()
returns void language plpgsql security definer as $$
begin
  insert into notifications (destinataire_id, type, titre, message, lien_prestation_id, lue, priorite, source_type, source_id)
  select
    pe.collaborateur_id,
    'rappel_prestation',
    'Rappel — prestation demain',
    'Vous intervenez demain sur '||coalesce(p.reference,'une prestation')||
      coalesce(' à '||to_char(p.heure_debut,'HH24:MI'),'')||
      coalesce(' — '||p.lieu,'')||'.',
    p.id,
    false,
    'medium',
    'prestations',
    p.id
  from prestations p
  join prestations_equipe pe on pe.prestation_id = p.id and pe.statut = 'acceptée'
  join profiles prof on prof.id = pe.collaborateur_id
  where p.date_prestation = (current_date + interval '1 day')::date
    and p.statut not in ('annulée','refusée','clôturée','livrée')
    and coalesce(prof.notification_prefs->>'rappels','true') != 'false'
    and not exists (
      select 1 from notifications n
      where n.destinataire_id = pe.collaborateur_id
        and n.lien_prestation_id = p.id
        and n.type = 'rappel_prestation'
    );
end;
$$;

-- ─── 3. Planification quotidienne (pg_cron) ─────────────────────────────────
-- Nécessite l'extension pg_cron (Supabase → Database → Extensions → l'activer
-- si ce n'est pas déjà fait ; disponible par défaut sur la plupart des
-- projets). 17h UTC ≈ 18h-19h en France selon l'heure d'été/hiver — un rappel
-- la veille au soir pour une prestation le lendemain.
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'sportvision-rappels-prestation';
select cron.schedule('sportvision-rappels-prestation', '0 17 * * *', $$select send_prestation_reminders()$$);
