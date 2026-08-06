-- Migration : e-mails CLIENT sur le cycle de vie de l'abonnement Club+
--
-- Contexte (audit du 2026-08-06) : stripe-webhook/index.ts pilote déjà
-- l'abonnement récurrent Club+ (migration-clubplus-v25-stripe-subscription.sql)
-- sur checkout.session.completed (abonnement), customer.subscription.updated,
-- invoice.payment_failed et customer.subscription.deleted — mais seul le
-- STAFF SportVision est notifié à chaque fois (notify_staff_by_role). Le club
-- lui-même (le payeur) ne recevait jusqu'ici jamais d'e-mail : un club dont le
-- prélèvement échoue doit pourtant être informé pour agir (mettre à jour son
-- moyen de paiement), pas seulement le staff en interne.
--
-- Cette migration ajoute 3 templates au Communication Hub (déjà en
-- production), sur le modèle visuel exact de migration-finance-relances-
-- auto.sql (même carte sombre SportVision, mêmes tokens de couleur). Le
-- branchement dans stripe-webhook/index.ts (appel enqueue_notification vers
-- le club, en plus de la notification staff existante — inchangée) est fait
-- séparément dans ce même commit.
--
-- Idempotente. À exécuter dans Supabase → SQL Editor, après
-- migration-clubplus-v25-stripe-subscription.sql.

insert into communication_templates (template_key, category, channel, mandatory, description) values
  ('clubplus.abonnement_active', 'BILLING', 'EMAIL', false, 'Abonnement Club+ activé — confirmation envoyée au club'),
  ('clubplus.paiement_echoue', 'BILLING', 'EMAIL', false, 'Abonnement Club+ — échec de prélèvement, à régulariser'),
  ('clubplus.abonnement_resilie', 'BILLING', 'EMAIL', false, 'Abonnement Club+ résilié — confirmation envoyée au club')
on conflict (template_key) do nothing;

-- ─── 1. Abonnement activé ────────────────────────────────────────────────
insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Votre abonnement Club+ est activé',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div><div style="font-size:10px;color:#32D8E6;letter-spacing:.1em;margin-top:2px">CLUB+</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Votre abonnement <strong>{{plan_label}}</strong> est activé. Merci pour votre confiance.</p>
         <div style="background:#0B1B33;border-radius:10px;padding:16px 20px;margin:18px 0">
           <p style="font-size:12px;margin:0;color:#9DAEC3">Montant prélevé</p>
           <p style="font-size:22px;font-weight:800;color:#32D8E6;margin:4px 0 0">{{montant}}</p>
         </div>
         <p style="font-size:13px;color:#9DAEC3">Vous pouvez gérer votre abonnement (moyen de paiement, factures, résiliation) à tout moment depuis votre espace Club+, bouton « Gérer mon abonnement ».</p>
       </div>
     </div>
   </body></html>',
  array['first_name','plan_label','montant']
from communication_templates where template_key = 'clubplus.abonnement_active'
on conflict (template_id, version) do nothing;

-- ─── 2. Échec de prélèvement ─────────────────────────────────────────────
insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Le prélèvement de votre abonnement Club+ a échoué',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div><div style="font-size:10px;color:#32D8E6;letter-spacing:.1em;margin-top:2px">CLUB+</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Le prélèvement de votre abonnement Club+ d''un montant de <strong>{{montant}}</strong> n''a pas pu être effectué.</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Pour continuer à profiter de votre abonnement sans interruption, merci de mettre à jour votre moyen de paiement dès que possible.</p>
         <a href="{{lien_gestion}}" style="display:inline-block;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700;margin-top:8px">Mettre à jour mon moyen de paiement</a>
         <p style="font-size:12px;color:#9DAEC3;margin-top:18px">Sans régularisation, votre abonnement sera considéré comme impayé et pourra être suspendu.</p>
       </div>
     </div>
   </body></html>',
  array['first_name','montant','lien_gestion']
from communication_templates where template_key = 'clubplus.paiement_echoue'
on conflict (template_id, version) do nothing;

-- ─── 3. Résiliation ──────────────────────────────────────────────────────
insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Votre abonnement Club+ a été résilié',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div><div style="font-size:10px;color:#32D8E6;letter-spacing:.1em;margin-top:2px">CLUB+</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Votre abonnement Club+ a été résilié, avec effet au <strong>{{date_effet}}</strong>. Vous ne serez plus prélevé.</p>
         <p style="font-size:13px;color:#9DAEC3">Si cette résiliation ne correspond pas à votre demande, contactez-nous dès que possible — répondez directement à cet e-mail.</p>
       </div>
     </div>
   </body></html>',
  array['first_name','date_effet']
from communication_templates where template_key = 'clubplus.abonnement_resilie'
on conflict (template_id, version) do nothing;
