-- Migration : Communication Hub — partie 2
-- Fonction d'enqueue idempotente, planification du worker, et contenu réel
-- des 6 templates AUTH (copie exacte du cahier des charges, section 6.1/6.2).
--
-- Prérequis : migration-communication-hub.sql déjà exécutée.
-- À exécuter dans Supabase → SQL Editor.

-- ─── 1. Fonction d'enqueue (résout l'idempotence, jamais de doublon) ────────
-- p_idempotency_key doit être unique par événement + destinataire + canal +
-- version (ex: 'auth.invitation:v1:' || nouveau_user_id). Si un envoi avec la
-- même clé existe déjà, ne fait rien (ON CONFLICT DO NOTHING) — c'est ce qui
-- garantit qu'un événement rejoué (webhook dupliqué, retry applicatif) ne
-- crée jamais un second envoi.
create or replace function enqueue_notification(
  p_event_type text,
  p_template_key text,
  p_channel text,
  p_idempotency_key text,
  p_recipient_email text default null,
  p_recipient_phone text default null,
  p_recipient_user_id uuid default null,
  p_recipient_client_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_scheduled_at timestamptz default now()
) returns uuid language plpgsql security definer as $$
declare
  v_id uuid;
begin
  insert into notification_outbox (
    event_type, template_key, channel, idempotency_key,
    recipient_email, recipient_phone_e164, recipient_user_id, recipient_client_id,
    entity_type, entity_id, payload_json, scheduled_at, next_attempt_at
  ) values (
    p_event_type, p_template_key, p_channel, p_idempotency_key,
    p_recipient_email, p_recipient_phone, p_recipient_user_id, p_recipient_client_id,
    p_entity_type, p_entity_id, p_payload, p_scheduled_at, p_scheduled_at
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id; -- null si déjà existant (comportement voulu, pas une erreur)
end;
$$;

-- ─── 2. Planification du worker via pg_net + Vault ──────────────────────────
-- Le project URL et une clé d'appel restent HORS du fichier de migration
-- (jamais de secret en clair dans un fichier versionné) : ils sont stockés
-- via Vault, à faire une fois manuellement avant de lancer ce bloc :
--
--   select vault.create_secret('https://VOTRE-PROJET.supabase.co', 'project_url');
--   select vault.create_secret('VOTRE_CLE_SERVICE_ROLE_OU_ANON', 'dispatch_notifications_key');
--
-- (remplacer les deux valeurs par les vraies, visibles dans Supabase →
-- Project Settings → API — utiliser la clé anon suffit puisque la fonction
-- ne fait rien d'autre que déclencher le worker, qui lui utilise sa propre
-- clé service_role interne, jamais celle-ci).
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'sportvision-dispatch-notifications';
select cron.schedule(
  'sportvision-dispatch-notifications',
  '* * * * *', -- chaque minute
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-notifications',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_notifications_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ─── 3. Contenu réel des 6 templates AUTH-01 à AUTH-06 ──────────────────────
-- Copie fidèle du cahier des charges (section 6.1/6.2), mise en HTML simple
-- cohérent avec le style déjà utilisé dans send-devis-email/send-facture-email
-- (fond sombre, encart SportVision — voir ces fichiers pour le gabarit visuel
-- complet si tu veux l'enrichir plus tard).
insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Vous êtes invité(e) à rejoindre SportVision Connect',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">{{inviter_name}} vous invite à rejoindre l''espace {{organization_name}} sur SportVision Connect avec le rôle « {{role_label}} ».</p>
         <p style="font-size:13px;color:#9DAEC3">Cette invitation expire le {{expires_at_local}}. Pour des raisons de sécurité, elle ne peut être utilisée qu''une seule fois.</p>
         <a href="{{invitation_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Accepter l''invitation</a>
       </div>
     </div>
   </body></html>',
  array['first_name','inviter_name','organization_name','role_label','expires_at_local','invitation_url']
from communication_templates where template_key = 'auth.invitation'
on conflict (template_id, version) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Confirmez votre adresse e-mail SportVision',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Confirmez cette adresse afin d''activer votre compte et de sécuriser vos échanges avec SportVision.</p>
         <p style="font-size:13px;color:#9DAEC3">Le lien expire le {{expires_at_local}}. Si vous n''êtes pas à l''origine de cette demande, ignorez cet e-mail.</p>
         <a href="{{verification_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Confirmer mon adresse</a>
       </div>
     </div>
   </body></html>',
  array['first_name','expires_at_local','verification_url']
from communication_templates where template_key = 'auth.email_verification'
on conflict (template_id, version) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Bienvenue sur SportVision Connect',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Votre compte est maintenant actif. Vous pouvez accéder à vos demandes, documents, rendez-vous et prestations depuis votre espace sécurisé.</p>
         <p style="font-size:13px;color:#9DAEC3">Besoin d''aide ? Répondez à cet e-mail ou contactez {{support_email}}.</p>
         <a href="{{app_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Accéder à mon espace</a>
       </div>
     </div>
   </body></html>',
  array['first_name','support_email','app_url']
from communication_templates where template_key = 'auth.welcome'
on conflict (template_id, version) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Réinitialisez votre mot de passe SportVision',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Une demande de réinitialisation a été effectuée pour votre compte SportVision.</p>
         <p style="font-size:13px;color:#9DAEC3">Utilisez le bouton ci-dessous avant {{expires_at_local}}. Ce lien est personnel, à usage unique et ne doit pas être transféré.</p>
         <p style="font-size:13px;color:#9DAEC3">Si vous n''avez rien demandé, vous pouvez ignorer ce message. Votre mot de passe actuel reste inchangé.</p>
         <a href="{{reset_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Réinitialiser mon mot de passe</a>
       </div>
     </div>
   </body></html>',
  array['first_name','expires_at_local','reset_url']
from communication_templates where template_key = 'auth.password_reset'
on conflict (template_id, version) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Votre mot de passe SportVision a été modifié',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Le mot de passe de votre compte a été modifié le {{changed_at_local}}.</p>
         <p style="font-size:13px;color:#9DAEC3">Si vous êtes à l''origine de cette action, aucune démarche n''est nécessaire. Sinon, sécurisez immédiatement votre compte et contactez le support.</p>
         <a href="{{security_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Sécuriser mon compte</a>
       </div>
     </div>
   </body></html>',
  array['first_name','changed_at_local','security_url']
from communication_templates where template_key = 'auth.password_changed'
on conflict (template_id, version) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'L''adresse e-mail de votre compte SportVision a changé',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">L''adresse de connexion de votre compte a été remplacée par {{masked_new_email}} le {{changed_at_local}}.</p>
         <p style="font-size:13px;color:#9DAEC3">Si vous n''avez pas demandé ce changement, utilisez immédiatement le lien sécurisé de contestation ou contactez le support.</p>
         <a href="{{dispute_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Signaler ce changement</a>
       </div>
     </div>
   </body></html>',
  array['masked_new_email','changed_at_local','dispute_url']
from communication_templates where template_key = 'auth.email_changed'
on conflict (template_id, version) do nothing;
