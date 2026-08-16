-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v77
-- Ajoute la notification e-mail "vos contenus sont disponibles", manquante depuis la création de
-- media_livraisons (migration-medias.sql, Centre Médias & Postproduction de l'OS).
--
-- Contexte (audit externe du 16/08/2026) : media_livraisons existe déjà en base — colonnes
-- moyen_envoi ('email'/'portail'/'messagerie'/'manuel') et statut ('en_preparation'/'envoyee'/
-- 'confirmee'/'en_attente'/'echec') — et l'OS l'utilise pour tracer l'envoi d'une livraison de
-- photos/vidéos à un client. Mais AUCUN trigger, Edge Function ni template ne s'en sert pour
-- prévenir réellement le client : quand une ligne passe (ou est créée) en statut 'envoyee', rien
-- n'est enqueue dans le Communication Hub. Le client découvre ses contenus uniquement s'il pense à
-- se reconnecter à SportVision Connect.
--
-- IMPORTANT — media_livraisons (OS, table d'orchestration prestation/livrable) est un objet
-- DIFFÉRENT de club_media (Club+/Connect, migration-clubplus-v7.sql), qui est la table qui
-- alimente réellement "Mes contenus" côté joueur/particulier (voir ContenusPage /
-- ContenusParticulierPage). Cette migration ne touche pas au lien entre les deux — elle comble
-- uniquement le trou de notification identifié par l'audit sur media_livraisons, côté OS : à
-- chaque fois qu'un membre de l'équipe SportVision marque une livraison 'envoyee' par e-mail, le
-- client visé reçoit désormais un vrai e-mail (au lieu de rien).
--
-- Architecture : suit EXACTEMENT le patron déjà utilisé par migration-cm-notifications-contenus.sql
-- et migration-finance-relances-auto.sql — le Communication Hub (notification_outbox,
-- communication_templates/_versions, worker dispatch-notifications sur Brevo) existe déjà en
-- entier, rien à construire côté infra. Un seul trigger AFTER INSERT OR UPDATE sur media_livraisons
-- appelle enqueue_notification() (défini dans migration-communication-hub-part2.sql) : un seul
-- endroit à maintenir, capte aussi bien une livraison créée directement en statut 'envoyee' qu'une
-- livraison qui transite depuis 'en_preparation'.
--
-- Prérequis : migration-communication-hub.sql + migration-communication-hub-part2.sql +
-- migration-medias.sql doivent déjà être exécutées (elles le sont). migration-securite-enqueue-
-- notification.sql (révocation EXECUTE sur enqueue_notification pour public/anon/authenticated)
-- N'EST PAS un prérequis technique : le trigger est SECURITY DEFINER et appelle enqueue_notification
-- en interne, ce qui reste autorisé après la révocation (même raisonnement que
-- migration-cm-notifications-contenus.sql, tête de fichier §Prérequis).
--
-- Idempotente : DROP TRIGGER/FUNCTION IF EXISTS avant chaque CREATE, INSERT ... ON CONFLICT DO
-- NOTHING pour les templates. À exécuter dans Supabase → SQL Editor (non exécutée par cet agent —
-- pas d'accès DB depuis ce worktree).
-- ============================================================

-- ─── 1. Template Communication Hub ──────────────────────────────────────────
insert into communication_templates (template_key, category, channel, mandatory, description) values
  ('connect.contenu_disponible', 'OPERATIONS', 'EMAIL', false, 'Des photos/vidéos SportVision ont été livrées au client')
on conflict (template_key) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Vos contenus SportVision sont disponibles',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Vos photos et vidéos concernant <strong>{{titre}}</strong> sont désormais disponibles dans votre espace SportVision Connect, rubrique « Mes contenus ».</p>
         <p style="font-size:13px;color:#9DAEC3">Connectez-vous pour les consulter, les télécharger et les partager.</p>
         <a href="{{app_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Voir mes contenus</a>
       </div>
     </div>
   </body></html>',
  array['first_name','titre','app_url']
from communication_templates where template_key = 'connect.contenu_disponible'
on conflict (template_id, version) do nothing;

-- ─── 2. Trigger sur media_livraisons ─────────────────────────────────────────
-- Se déclenche :
--   - à l'INSERT si la ligne est créée directement en statut 'envoyee' (livraison enregistrée après
--     coup, envoi déjà effectué manuellement) ;
--   - à l'UPDATE si le statut CHANGE et devient 'envoyee' (le cas nominal : en_preparation →
--     envoyee, quand l'équipe marque la livraison comme partie).
-- Ne notifie que moyen_envoi = 'email' (portail/messagerie/manuel ont leur propre canal, pas
-- celui du Communication Hub) et seulement si un destinataire_email est renseigné.
create or replace function notify_media_livraison_envoyee()
returns trigger language plpgsql security definer as $$
declare
  v_prestation record;
  v_titre text;
  v_should_check boolean := false;
begin
  if TG_OP = 'INSERT' then
    v_should_check := true;
  elsif TG_OP = 'UPDATE' and NEW.statut is distinct from OLD.statut then
    v_should_check := true;
  end if;

  if not v_should_check or NEW.statut is distinct from 'envoyee' then
    return NEW;
  end if;

  if NEW.moyen_envoi is distinct from 'email' or NEW.destinataire_email is null then
    return NEW;
  end if;

  select reference, sport, equipes, client_id
    into v_prestation
    from prestations where id = NEW.prestation_id;

  -- Titre affiché dans l'e-mail : équipe, sinon sport, sinon référence de la prestation, sinon un
  -- libellé générique — jamais vide (prestation_id peut théoriquement être null vu le
  -- "on delete cascade" côté FK, mais pas le message envoyé au client).
  v_titre := coalesce(
    nullif(trim(v_prestation.equipes), ''),
    nullif(trim(v_prestation.sport), ''),
    v_prestation.reference,
    'votre prestation SportVision'
  );

  perform enqueue_notification(
    p_event_type := 'connect.contenu_disponible',
    p_template_key := 'connect.contenu_disponible',
    p_channel := 'EMAIL',
    p_idempotency_key := 'connect.contenu_disponible:v1:'||NEW.id||':'||extract(epoch from NEW.updated_at),
    p_recipient_email := NEW.destinataire_email,
    p_recipient_client_id := v_prestation.client_id,
    p_entity_type := 'media_livraison',
    p_entity_id := NEW.id,
    p_payload := jsonb_build_object(
      'first_name', coalesce(nullif(trim(NEW.destinataire_nom), ''), ''),
      'titre', v_titre,
      'app_url', 'https://connect.sportvision-an.fr/contenus'
    )
  );

  return NEW;
end;
$$;

drop trigger if exists trg_notify_media_livraison_envoyee on media_livraisons;
create trigger trg_notify_media_livraison_envoyee
  after insert or update on media_livraisons
  for each row execute function notify_media_livraison_envoyee();
