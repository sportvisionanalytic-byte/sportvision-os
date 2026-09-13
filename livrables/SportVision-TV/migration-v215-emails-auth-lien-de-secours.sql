-- v215 — Les e-mails d'authentification : un lien de secours et une identité d'expéditeur
-- (13/09/2026).
--
-- CE QUI N'ALLAIT PAS, trouvé en relisant les cinq gabarits d'authentification réellement envoyés :
--
--   1. AUCUN lien en clair dans la version HTML. Le seul chemin était le bouton. Quand il ne
--      fonctionne pas — client de messagerie qui neutralise les liens, antivirus qui les réécrit,
--      copie d'écran transmise — la personne est dans une impasse. C'est exactement ce qui s'est
--      passé ce soir avec une recrue. La version texte, elle, portait déjà le lien : seul
--      l'affichage HTML, que lisent presque tous les destinataires, ne l'avait pas.
--      (`clubplus.invitation` le faisait déjà, et sert de modèle ici.)
--
--   2. AUCUNE identité d'expéditeur en pied de page. Un message transactionnel sans raison sociale
--      ni adresse postale est moins bien noté par les filtres, et n'inspire rien à qui le reçoit.
--
--   3. L'invitation OS ne disait pas que le lien est lié à l'adresse qui l'a reçu — un lien
--      transféré à un collègue ne fonctionne pas, autant l'écrire.
--
-- CE QUE FAIT CETTE MIGRATION. Une NOUVELLE version de chaque gabarit, jamais une modification de
-- l'existante : le dispatcher prend la version active la plus haute, l'historique reste lisible, et
-- un retour en arrière consiste à désactiver la dernière.
--
-- Le capital social n'est pas affiché : décision de Fouka, valable sur tous les documents.
--
-- Idempotente : rejouer ne crée une version que si le contenu a changé.

create or replace function public.publier_version_email(p_cle text, p_sujet text, p_corps text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_template uuid;
  v_actuelle record;
  v_version int;
begin
  select id into v_template from communication_templates where template_key = p_cle;
  if v_template is null then
    return p_cle || ' : gabarit inconnu, ignoré';
  end if;

  select * into v_actuelle from communication_template_versions
   where template_id = v_template order by version desc limit 1;

  if v_actuelle.id is not null
     and v_actuelle.subject_template = p_sujet
     and v_actuelle.body_html_template = p_corps then
    return p_cle || ' : déjà à jour (v' || v_actuelle.version || ')';
  end if;

  v_version := coalesce(v_actuelle.version, 0) + 1;
  insert into communication_template_versions
    (template_id, version, locale, subject_template, body_html_template, required_variables, active_from)
  values
    (v_template, v_version, coalesce(v_actuelle.locale, 'fr'), p_sujet, p_corps,
     coalesce(v_actuelle.required_variables, '{}'::text[]), now());

  return p_cle || ' : publié en v' || v_version;
end $fn$;

comment on function public.publier_version_email(text, text, text) is
  'v215 — Publie une nouvelle version d''un gabarit d''e-mail. Ne fait rien si le contenu est identique.';

select public.publier_version_email(
  'auth.invitation',
  'Votre accès à SportVision OS',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">{{inviter_name}} vous invite à rejoindre l''équipe {{organization_name}} sur SportVision OS, l''outil interne de l''équipe, avec le rôle «&nbsp;{{role_label}}&nbsp;». Le bouton ci-dessous vous permet de choisir votre mot de passe.</p>
         <p style="font-size:13px;color:#9DAEC3">Ce lien est personnel : il ne fonctionne qu''avec l''adresse à laquelle il a été envoyé. Il est valable jusqu''au {{expires_at_local}} et ne sert qu''une seule fois. S''il a expiré, demandez-en un nouveau à la personne qui vous a invité(e).</p>
         <a href="{{invitation_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Accepter l''invitation</a>
         <p style="font-size:12.5px;line-height:1.7;color:#7E8FA6;margin-top:20px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="color:#9DAEC3;word-break:break-all">{{invitation_url}}</span></p>
       </div>
       <div style="padding:18px 32px;border-top:1px solid #1D3555;background:#0B1B33">
         <p style="font-size:11.5px;line-height:1.6;color:#6F819A;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message vous est envoyé parce qu''une action a été demandée sur votre compte SportVision. Il ne contient aucune publicité.</p>
       </div>
     </div>
   </body></html>'
);
select public.publier_version_email(
  'auth.password_reset',
  'Réinitialisez votre mot de passe SportVision',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Une demande de réinitialisation a été effectuée pour votre compte SportVision.</p>
         <p style="font-size:13px;color:#9DAEC3">Utilisez le bouton ci-dessous avant {{expires_at_local}}. Ce lien est personnel, à usage unique et ne doit pas être transféré. Demander un nouveau lien annule le précédent.</p>
         <a href="{{reset_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Réinitialiser mon mot de passe</a>
         <p style="font-size:13px;color:#9DAEC3;margin-top:18px">Si vous n''avez rien demandé, vous pouvez ignorer ce message. Votre mot de passe actuel reste inchangé.</p>
         <p style="font-size:12.5px;line-height:1.7;color:#7E8FA6;margin-top:20px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="color:#9DAEC3;word-break:break-all">{{reset_url}}</span></p>
       </div>
       <div style="padding:18px 32px;border-top:1px solid #1D3555;background:#0B1B33">
         <p style="font-size:11.5px;line-height:1.6;color:#6F819A;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message vous est envoyé parce qu''une action a été demandée sur votre compte SportVision. Il ne contient aucune publicité.</p>
       </div>
     </div>
   </body></html>'
);
select public.publier_version_email(
  'auth.email_verification',
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
         <p style="font-size:12.5px;line-height:1.7;color:#7E8FA6;margin-top:20px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="color:#9DAEC3;word-break:break-all">{{verification_url}}</span></p>
       </div>
       <div style="padding:18px 32px;border-top:1px solid #1D3555;background:#0B1B33">
         <p style="font-size:11.5px;line-height:1.6;color:#6F819A;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message vous est envoyé parce qu''une action a été demandée sur votre compte SportVision. Il ne contient aucune publicité.</p>
       </div>
     </div>
   </body></html>'
);
select public.publier_version_email(
  'auth.welcome',
  'Bienvenue sur SportVision Connect',
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Votre compte est maintenant actif. Vous pouvez accéder à vos demandes, documents, rendez-vous et prestations depuis votre espace sécurisé.</p>
         <a href="{{app_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Accéder à mon espace</a>
         <p style="font-size:13px;color:#9DAEC3;margin-top:18px">Besoin d''aide ? Répondez à cet e-mail ou écrivez à {{support_email}}.</p>
         <p style="font-size:12.5px;line-height:1.7;color:#7E8FA6;margin-top:20px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="color:#9DAEC3;word-break:break-all">{{app_url}}</span></p>
       </div>
       <div style="padding:18px 32px;border-top:1px solid #1D3555;background:#0B1B33">
         <p style="font-size:11.5px;line-height:1.6;color:#6F819A;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message vous est envoyé parce qu''une action a été demandée sur votre compte SportVision. Il ne contient aucune publicité.</p>
       </div>
     </div>
   </body></html>'
);

select public.publier_version_email('auth.password_changed', 'Votre mot de passe SportVision a été modifié', '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Le mot de passe de votre compte a été modifié le {{changed_at_local}}.</p>
         <p style="font-size:13px;color:#9DAEC3">Si vous êtes à l''origine de cette action, aucune démarche n''est nécessaire. Sinon, sécurisez immédiatement votre compte et contactez le support.</p>
         <a href="{{security_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Sécuriser mon compte</a>
         <p style="font-size:12.5px;line-height:1.7;color:#7E8FA6;margin-top:20px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="color:#9DAEC3;word-break:break-all">{{security_url}}</span></p>
       </div>
       <div style="padding:18px 32px;border-top:1px solid #1D3555;background:#0B1B33">
         <p style="font-size:11.5px;line-height:1.6;color:#6F819A;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message vous est envoyé parce qu''une action a été demandée sur votre compte SportVision. Il ne contient aucune publicité.</p>
       </div>
     </div>
   </body></html>');

select public.publier_version_email('auth.email_changed', 'L''adresse e-mail de votre compte SportVision a changé', '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">L''adresse de connexion de votre compte a été remplacée par {{masked_new_email}} le {{changed_at_local}}.</p>
         <p style="font-size:13px;color:#9DAEC3">Si vous n''avez pas demandé ce changement, utilisez immédiatement le lien sécurisé de contestation ou contactez le support.</p>
         <a href="{{dispute_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Signaler ce changement</a>
         <p style="font-size:12.5px;line-height:1.7;color:#7E8FA6;margin-top:20px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="color:#9DAEC3;word-break:break-all">{{dispute_url}}</span></p>
       </div>
       <div style="padding:18px 32px;border-top:1px solid #1D3555;background:#0B1B33">
         <p style="font-size:11.5px;line-height:1.6;color:#6F819A;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message vous est envoyé parce qu''une action a été demandée sur votre compte SportVision. Il ne contient aucune publicité.</p>
       </div>
     </div>
   </body></html>');
