-- Migration : Finance — alertes automatiques sur les dépenses récurrentes
-- à échéance proche.
--
-- S'appuie sur le Communication Hub déjà en prod (notification_outbox,
-- enqueue_notification, dispatch-notifications déclenché chaque minute par
-- pg_cron — voir migration-communication-hub.sql / part2.sql) et sur la
-- colonne expenses.date_prochaine_echeance, calculée côté frontend dans
-- sauvegarderNouvelleDepense() à chaque création d'une dépense récurrente.
--
-- Idempotente : create table/policy/fonction if not exists, cron.unschedule
-- avant cron.schedule. À exécuter dans Supabase → SQL Editor.

-- ─── 1. Nouveau template — alerte échéance dépense récurrente ──────────────
insert into communication_templates (template_key, category, channel, mandatory, description) values
  ('finance.expense_due_soon', 'OPERATIONS', 'EMAIL', false, 'Dépense récurrente arrivant à échéance sous 7 jours')
on conflict (template_key) do nothing;

insert into communication_template_versions (template_id, version, locale, subject_template, body_html_template, required_variables)
select id, 1, 'fr-FR',
  'Échéance à venir : {{libelle}}',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Une dépense récurrente arrive à échéance :</p>
         <div style="background:#0B1B33;border-radius:10px;padding:16px 20px;margin:14px 0">
           <p style="font-size:14px;margin:0 0 6px;color:#F7F9FC"><strong>{{libelle}}</strong> ({{categorie}})</p>
           <p style="font-size:14px;margin:0 0 6px;color:#F7F9FC">Montant TTC : <strong>{{montant_ttc}}</strong></p>
           <p style="font-size:14px;margin:0;color:#F7F9FC">Échéance : <strong>{{date_echeance_local}}</strong></p>
         </div>
         <p style="font-size:13px;color:#9DAEC3">Pensez à vérifier le règlement ou le renouvellement de cet engagement dans SportVision OS, rubrique Dépenses & fournisseurs.</p>
       </div>
     </div>
   </body></html>',
  array['first_name','libelle','categorie','montant_ttc','date_echeance_local']
from communication_templates where template_key = 'finance.expense_due_soon'
on conflict (template_id, version) do nothing;

-- ─── 2. Fonction de vérification des échéances ──────────────────────────────
-- Parcourt les dépenses dont l'échéance tombe dans les 7 prochains jours et
-- notifie chaque profil admin/compta par e-mail.
--
-- Note idempotence : la clé fournie dans le cahier des charges
-- ('finance.expense_due_soon:v1:'||expense_id||':'||date_prochaine_echeance)
-- suffit à empêcher qu'UNE MÊME échéance soit renvoyée plusieurs fois au
-- MÊME destinataire (le cron tourne tous les jours pendant 7 jours tant que
-- l'échéance reste dans la fenêtre). Comme on notifie ici plusieurs
-- destinataires (tous les admin/compta) pour une même dépense, l'id du
-- profil est ajouté en suffixe de la clé : sans ça, notification_outbox
-- (idempotency_key unique globalement) n'accepterait que le premier
-- destinataire et les autres profils ne recevraient jamais rien.
create or replace function check_echeances_depenses()
returns void language plpgsql security definer as $$
declare
  v_expense record;
  v_profile record;
begin
  for v_expense in
    select id, libelle, montant_ttc, categorie, date_prochaine_echeance
    from expenses
    where date_prochaine_echeance is not null
      and date_prochaine_echeance between current_date and current_date + 7
  loop
    for v_profile in
      select id, email, prenom
      from profiles
      where role in ('admin','compta') and email is not null
    loop
      perform enqueue_notification(
        p_event_type := 'finance.expense_due_soon',
        p_template_key := 'finance.expense_due_soon',
        p_channel := 'EMAIL',
        p_idempotency_key := 'finance.expense_due_soon:v1:'||v_expense.id||':'||v_expense.date_prochaine_echeance||':'||v_profile.id,
        p_recipient_email := v_profile.email,
        p_recipient_user_id := v_profile.id,
        p_entity_type := 'expense',
        p_entity_id := v_expense.id,
        p_payload := jsonb_build_object(
          'first_name', coalesce(v_profile.prenom, ''),
          'libelle', v_expense.libelle,
          'categorie', coalesce(v_expense.categorie, '—'),
          'montant_ttc', to_char(coalesce(v_expense.montant_ttc,0), 'FM999G999G990D00')||' €',
          'date_echeance_local', to_char(v_expense.date_prochaine_echeance, 'DD/MM/YYYY')
        )
      );
    end loop;
  end loop;
end;
$$;

-- ─── 3. Planification quotidienne (7h) ──────────────────────────────────────
-- Tout se fait en SQL pur (enqueue_notification est déjà une RPC Postgres),
-- pas besoin d'appel HTTP/Edge Function ici : le dispatch réel des e-mails
-- est ensuite pris en charge par le job "sportvision-dispatch-notifications"
-- déjà existant (chaque minute).
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'sportvision-check-echeances-depenses';
select cron.schedule(
  'sportvision-check-echeances-depenses',
  '0 7 * * *', -- tous les jours à 7h
  $$select check_echeances_depenses();$$
);
