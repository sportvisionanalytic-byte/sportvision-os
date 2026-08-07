-- Migration : ferme un relais de phishing ouvert sur enqueue_notification().
--
-- ─── Découverte ──────────────────────────────────────────────────────────
-- enqueue_notification() (migration-communication-hub-part2.sql) n'a aucune
-- vérification d'autorisation interne — elle fait juste un
-- `insert ... on conflict do nothing` dans notification_outbox, en
-- supposant être appelée uniquement depuis une autre fonction SECURITY
-- DEFINER de confiance (check_factures_en_retard, check_devis_sans_reponse,
-- check_echeances_depenses, send_prestation_reminders — toutes cron-only,
-- jamais appelées depuis l'UI OS/Connect, confirmé par recherche : aucune
-- référence à ces noms de fonction dans SportVision-OS-Full.html ni
-- livrables/SportVision-Connect/). Aucune de ces 5 fonctions n'a de
-- `revoke execute`, et PostgREST expose par défaut TOUTE fonction du schéma
-- public en RPC à tout rôle authentifié.
--
-- Conséquence concrète : n'importe quel compte authentifié (y compris un
-- simple compte client Connect) pouvait appeler rpc/enqueue_notification
-- directement avec un destinataire (p_recipient_email), un template
-- (p_template_key — n'importe lequel, y compris auth.password_reset/
-- auth.invitation) et des variables (p_payload) entièrement arbitraires —
-- un relais de phishing utilisant le domaine d'envoi vérifié SportVision/
-- Brevo, vers n'importe quelle adresse, avec un contenu quasi arbitraire.
--
-- Correctif : revoke execute pour public/anon/authenticated sur ces 5
-- fonctions. Les appels internes (une autre fonction SECURITY DEFINER qui
-- les invoque via `perform`) continuent de fonctionner : ils s'exécutent
-- avec les droits du propriétaire de la fonction appelante, pas du rôle
-- HTTP d'origine — même principe déjà établi pour toutes les RPC SECURITY
-- DEFINER de cette session.
--
-- Idempotente : REVOKE ne lève pas d'erreur si le privilège n'existe déjà
-- plus. À exécuter dès que possible, indépendante de tout autre chantier.

revoke execute on function enqueue_notification(text,text,text,text,text,text,uuid,uuid,text,uuid,jsonb,timestamptz) from public, anon, authenticated;
revoke execute on function check_factures_en_retard() from public, anon, authenticated;
revoke execute on function check_devis_sans_reponse() from public, anon, authenticated;
revoke execute on function check_echeances_depenses() from public, anon, authenticated;
revoke execute on function send_prestation_reminders() from public, anon, authenticated;
