-- Migration : relances automatiques (factures impayées + devis sans réponse)
--
-- Contexte (audit du 2026-08-06) : ces deux relances existaient déjà comme
-- templates texte dans `email_templates` (relance_facture, relance_acompte —
-- migration-phase3-4-5.sql) mais cette table n'a JAMAIS été branchée à un
-- mécanisme d'envoi : elle ne sert qu'à un écran d'édition de templates
-- (SportVision-OS-Full.html, gestion des templates), aucune fonction/edge
-- function ne la lit jamais pour envoyer quoi que ce soit. Le seul geste
-- disponible pour le staff était un simple lien mailto (ouvrir son client
-- mail, écrire, envoyer manuellement) et la relance devis n'était qu'une
-- tâche interne "à faire" (creerTachesAuto), jamais un vrai envoi.
--
-- Cette migration branche les deux sur le Communication Hub, déjà en
-- production et exactement sur ce modèle (voir migration-finance-alertes-
-- echeances.sql, check_echeances_depenses — même structure, reproduite ici).
--
-- Cadence :
--   - Facture impayée (statut 'emise' ou 'en_retard', date_echeance dépassée) :
--     relance à J+7, J+14, J+30 après l'échéance — 3 rappels, jamais plus
--     (au-delà, la relance manuelle/humaine reste nécessaire).
--   - Devis envoyé sans réponse (statut 'envoyé', pas encore accepté/refusé) :
--     une relance à J+4 après l'envoi (milieu de la fenêtre "3 à 5 jours"
--     déjà suggérée par l'auto-tâche existante).
--
-- Idempotente. À exécuter dans Supabase → SQL Editor.

-- ─── 1. Templates ────────────────────────────────────────────────────────────

insert into communication_templates (template_key, category, channel, mandatory, description) values
  ('finance.facture_en_retard', 'BILLING', 'EMAIL', false, 'Relance automatique — facture impayée après échéance (J+7/J+14/J+30)'),
  ('sales.devis_sans_reponse', 'BILLING', 'EMAIL', false, 'Relance automatique — devis envoyé sans réponse après 4 jours')
on conflict (template_key) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Rappel de paiement — {{reference}}',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Sauf erreur de notre part, la facture correspondant à la prestation <strong>{{reference}}</strong> est toujours en attente de règlement.</p>
         <div style="background:#0B1B33;border-radius:10px;padding:16px 20px;margin:14px 0">
           <p style="font-size:14px;margin:0;color:#F7F9FC">Montant TTC : <strong>{{montant_ttc}}</strong></p>
           <p style="font-size:13px;margin:6px 0 0;color:#9DAEC3">Échéance dépassée depuis {{jours_retard}} jours</p>
         </div>
         <p style="font-size:13px;color:#9DAEC3">Merci de procéder au règlement dans les meilleurs délais. Pour toute question, répondez directement à cet e-mail.</p>
       </div>
     </div>
   </body></html>',
  array['first_name','reference','montant_ttc','jours_retard']
from communication_templates where template_key = 'finance.facture_en_retard'
on conflict (template_id, version) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Votre devis {{numero}} — toujours d''actualité ?',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Nous vous avons envoyé le devis <strong>{{numero}}</strong> d''un montant de {{montant_ttc}} TTC il y a quelques jours, et n''avons pas encore de retour de votre part.</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Ce devis reste valable — n''hésitez pas à répondre à cet e-mail avec la mention "Bon pour accord", ou à nous contacter pour toute question ou ajustement.</p>
       </div>
     </div>
   </body></html>',
  array['first_name','numero','montant_ttc']
from communication_templates where template_key = 'sales.devis_sans_reponse'
on conflict (template_id, version) do nothing;

-- ─── 2. Fonction : relance factures impayées (J+7/J+14/J+30) ───────────────
create or replace function check_factures_en_retard()
returns void language plpgsql security definer as $$
declare
  v_facture record;
  v_client record;
  v_jours_retard integer;
begin
  for v_facture in
    select f.id, f.montant_ttc, f.date_echeance, f.client_id, p.reference
    from factures f
    left join prestations p on p.id = f.prestation_id
    where f.statut in ('emise', 'en_retard')
      and f.date_echeance is not null
      and current_date - f.date_echeance in (7, 14, 30)
  loop
    v_jours_retard := current_date - v_facture.date_echeance;

    select id, email, prenom_contact into v_client from clients where id = v_facture.client_id;
    if v_client.email is null then continue; end if;

    perform enqueue_notification(
      p_event_type := 'finance.facture_en_retard',
      p_template_key := 'finance.facture_en_retard',
      p_channel := 'EMAIL',
      p_idempotency_key := 'finance.facture_en_retard:v1:'||v_facture.id||':j'||v_jours_retard,
      p_recipient_email := v_client.email,
      p_recipient_client_id := v_client.id,
      p_entity_type := 'facture',
      p_entity_id := v_facture.id,
      p_payload := jsonb_build_object(
        'first_name', coalesce(v_client.prenom_contact, ''),
        'reference', coalesce(v_facture.reference, ''),
        'montant_ttc', to_char(coalesce(v_facture.montant_ttc,0), 'FM999G999G990D00')||' €',
        'jours_retard', v_jours_retard
      )
    );
  end loop;

  -- Statut 'en_retard' pas toujours posé à la main : le pose ici pour toute
  -- facture 'emise' dont l'échéance est dépassée, cohérent avec le vocabulaire
  -- déjà utilisé partout ailleurs (tableaux de bord, exports).
  update factures set statut = 'en_retard' where statut = 'emise' and date_echeance < current_date;
end;
$$;

-- ─── 3. Fonction : relance devis sans réponse (J+4) ─────────────────────────
create or replace function check_devis_sans_reponse()
returns void language plpgsql security definer as $$
declare
  v_devis record;
  v_client record;
begin
  for v_devis in
    select id, numero, total_ttc, client_id
    from devis
    where statut = 'envoyé'
      and date_envoi is not null
      and date_acceptation is null
      and current_date - date_envoi = 4
  loop
    select id, email, prenom_contact into v_client from clients where id = v_devis.client_id;
    if v_client.email is null then continue; end if;

    perform enqueue_notification(
      p_event_type := 'sales.devis_sans_reponse',
      p_template_key := 'sales.devis_sans_reponse',
      p_channel := 'EMAIL',
      p_idempotency_key := 'sales.devis_sans_reponse:v1:'||v_devis.id,
      p_recipient_email := v_client.email,
      p_recipient_client_id := v_client.id,
      p_entity_type := 'devis',
      p_entity_id := v_devis.id,
      p_payload := jsonb_build_object(
        'first_name', coalesce(v_client.prenom_contact, ''),
        'numero', coalesce(v_devis.numero, ''),
        'montant_ttc', to_char(coalesce(v_devis.total_ttc,0), 'FM999G999G990D00')||' €'
      )
    );
  end loop;
end;
$$;

-- ─── 4. Planification quotidienne (7h30, juste après les échéances dépenses) ─
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'sportvision-check-factures-en-retard';
select cron.schedule(
  'sportvision-check-factures-en-retard',
  '30 7 * * *',
  $$select check_factures_en_retard();$$
);

select cron.unschedule(jobid) from cron.job where jobname = 'sportvision-check-devis-sans-reponse';
select cron.schedule(
  'sportvision-check-devis-sans-reponse',
  '35 7 * * *',
  $$select check_devis_sans_reponse();$$
);
