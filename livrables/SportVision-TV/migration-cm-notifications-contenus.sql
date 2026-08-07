-- Migration : notifications e-mail sur le cycle de validation des contenus CM.
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- Le Communication Hub existe déjà en entier (notification_outbox,
-- templates versionnés, préférences/heures calmes, worker dispatch-
-- notifications sur Brevo) — rien à construire côté infra. Le seul gap :
-- rien n'enqueue de notification pour contenus (migration-contenus.sql).
-- Réutilise enqueue_notification() telle quelle (même pattern que
-- migration-finance-relances-auto.sql / migration-finance-alertes-
-- echeances.sql), depuis un TRIGGER plutôt qu'un appel ajouté à chaque
-- site d'écriture (avancerContenu() côté OS, client_valider_contenu()) :
-- un seul endroit à maintenir, capte tout chemin actuel et futur.
--
-- Attribution volontairement neutre dans les templates CM ("le contenu a
-- été validé" / "des corrections ont été demandées", jamais "le client
-- a...") : CONTENU_NEXT (SportVision-OS-Full.html) permet à un CM/Lead de
-- faire passer un contenu de a_valider_client à valide/corrections
-- directement depuis l'OS (review interne) — le trigger ne peut pas
-- distinguer "le client a décidé via Connect" de "un collègue a tranché
-- depuis l'OS". Le détail (qui, commentaire) reste dans messages_client et
-- le panneau Historique déjà en place ; l'e-mail n'est qu'une alerte.
--
-- Prérequis : migration-securite-enqueue-notification.sql n'est PAS un
-- prérequis technique (le trigger appelle enqueue_notification en interne,
-- ce qui reste autorisé après le revoke), mais doit être exécutée par
-- ailleurs pour fermer le relais de phishing trouvé sur cette même fonction.
--
-- Idempotente : DROP/INSERT ... ON CONFLICT avant chaque écriture.

-- ─── 1. Templates ─────────────────────────────────────────────────────────
insert into communication_templates (template_key, category, channel, mandatory, description) values
  ('cm.contenu_a_valider', 'OPERATIONS', 'EMAIL', false, 'Un contenu attend la validation du client'),
  ('cm.contenu_valide', 'OPERATIONS', 'EMAIL', false, 'Un contenu a été validé'),
  ('cm.contenu_corrections', 'OPERATIONS', 'EMAIL', false, 'Des corrections ont été demandées sur un contenu')
on conflict (template_key) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Un contenu attend votre validation — {{titre}}',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Un nouveau contenu est prêt à être relu : <strong>{{titre}}</strong>.</p>
         <p style="font-size:13px;color:#9DAEC3">Connectez-vous à votre espace pour le valider ou demander des corrections.</p>
         <a href="{{app_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Voir le contenu</a>
       </div>
     </div>
   </body></html>',
  array['first_name','titre','app_url']
from communication_templates where template_key = 'cm.contenu_a_valider'
on conflict (template_id, version) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  '{{titre}} — contenu validé',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Le contenu <strong>{{titre}}</strong> a été validé — vous pouvez le programmer.</p>
       </div>
     </div>
   </body></html>',
  array['first_name','titre']
from communication_templates where template_key = 'cm.contenu_valide'
on conflict (template_id, version) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  '{{titre}} — corrections demandées',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Des corrections ont été demandées sur <strong>{{titre}}</strong>.</p>
         <p style="font-size:13px;color:#9DAEC3">Le détail est disponible dans Messages clients et l''historique du contenu, dans SportVision OS.</p>
       </div>
     </div>
   </body></html>',
  array['first_name','titre']
from communication_templates where template_key = 'cm.contenu_corrections'
on conflict (template_id, version) do nothing;

-- ─── 2. Trigger ───────────────────────────────────────────────────────────
create or replace function notify_contenu_statut_change()
returns trigger language plpgsql security definer as $$
declare
  v_client record;
  v_cm record;
begin
  if NEW.statut is not distinct from OLD.statut then
    return NEW;
  end if;

  if NEW.statut = 'a_valider_client' and NEW.client_id is not null then
    select id, email, prenom_contact into v_client from clients where id = NEW.client_id;
    if v_client.email is not null then
      perform enqueue_notification(
        p_event_type := 'cm.contenu_a_valider',
        p_template_key := 'cm.contenu_a_valider',
        p_channel := 'EMAIL',
        p_idempotency_key := 'cm.contenu_a_valider:v1:'||NEW.id||':'||extract(epoch from NEW.updated_at),
        p_recipient_email := v_client.email,
        p_recipient_client_id := v_client.id,
        p_entity_type := 'contenu', p_entity_id := NEW.id,
        p_payload := jsonb_build_object(
          'first_name', coalesce(v_client.prenom_contact,''),
          'titre', NEW.titre,
          'app_url', 'https://connect.sportvision.fr'
        )
      );
    end if;
  elsif NEW.statut in ('valide','corrections') and OLD.statut = 'a_valider_client' then
    select id, email, prenom into v_cm from profiles where id = NEW.cm_id;
    if v_cm.email is not null then
      perform enqueue_notification(
        p_event_type := case when NEW.statut = 'valide' then 'cm.contenu_valide' else 'cm.contenu_corrections' end,
        p_template_key := case when NEW.statut = 'valide' then 'cm.contenu_valide' else 'cm.contenu_corrections' end,
        p_channel := 'EMAIL',
        p_idempotency_key := (case when NEW.statut = 'valide' then 'cm.contenu_valide' else 'cm.contenu_corrections' end)||':v1:'||NEW.id||':'||extract(epoch from NEW.updated_at),
        p_recipient_email := v_cm.email,
        p_recipient_user_id := v_cm.id,
        p_entity_type := 'contenu', p_entity_id := NEW.id,
        p_payload := jsonb_build_object(
          'first_name', coalesce(v_cm.prenom,''),
          'titre', NEW.titre
        )
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_contenu_statut_change on contenus;
create trigger trg_notify_contenu_statut_change
  after update on contenus
  for each row execute function notify_contenu_statut_change();
