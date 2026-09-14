-- v216 — Identité de l'expéditeur et lien de secours sur les dix e-mails qui ne les avaient pas
-- (14/09/2026).
--
-- Suite de la v215, qui n'avait traité que les six e-mails d'authentification. Les dix autres —
-- invitation Club+, commande de photos, contenus disponibles, abonnement, facture, devis — étaient
-- dans le même état : aucune raison sociale en pied de page, et pour la plupart aucun lien en clair
-- si le bouton ne fonctionne pas.
--
-- Le plus coûteux était `galerie.commande_prete` : c'est l'e-mail qui livre les photos payées, et
-- son unique chemin était un bouton. Un client dont la messagerie neutralise les liens n'avait
-- aucun recours après avoir payé.
--
-- Une nouvelle version par gabarit, comme en v215 : le dispatcher prend la plus haute active,
-- l'historique reste lisible. Idempotente (rejouer ne publie rien si le contenu est identique).

select public.publier_version_email('clubplus.abonnement_active', 'Votre abonnement Club+ est activé', '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
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
       <div style="margin-top:26px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)"><p style="font-size:11.5px;line-height:1.6;color:#7a7a9c;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message accompagne un service que vous utilisez. Il ne contient aucune publicité.</p></div></div>
     </div>
   </body></html>');
select public.publier_version_email('clubplus.abonnement_resilie', 'Votre abonnement Club+ a été résilié', '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div><div style="font-size:10px;color:#32D8E6;letter-spacing:.1em;margin-top:2px">CLUB+</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Votre abonnement Club+ a été résilié, avec effet au <strong>{{date_effet}}</strong>. Vous ne serez plus prélevé.</p>
         <p style="font-size:13px;color:#9DAEC3">Si cette résiliation ne correspond pas à votre demande, contactez-nous dès que possible — répondez directement à cet e-mail.</p>
       <div style="margin-top:26px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)"><p style="font-size:11.5px;line-height:1.6;color:#7a7a9c;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message accompagne un service que vous utilisez. Il ne contient aucune publicité.</p></div></div>
     </div>
   </body></html>');
select public.publier_version_email('clubplus.invitation', '{{club_nom}} vous invite sur SportVision Club+', '<div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden;font-family:Arial,sans-serif;color:#F7F9FC">
  <div style="background:#0B1B33;padding:26px 32px">
    <div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div>
  </div>
  <div style="padding:28px 32px">
    <p style="font-size:15px;line-height:1.6">{{salutation}}</p>
    <p style="font-size:14px;line-height:1.7;color:#9DAEC3">
      <strong>{{club_nom}}</strong> vous invite sur SportVision Club+.<br>
      Vous y êtes ajouté comme <strong>{{role_label}}</strong>{{equipes_texte}}.
    </p>
    <p style="font-size:14px;line-height:1.7;color:#9DAEC3">
      Activez votre espace pour retrouver votre équipe, son calendrier et ses outils.
    </p>
    <div style="text-align:center;margin:26px 0">
      <a href="{{invitation_url}}" style="display:inline-block;background:#32D8E6;color:#06111F;font-weight:800;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px">Activer mon espace</a>
    </div>
    <p style="font-size:12.5px;line-height:1.6;color:#6C7E93">
      Ce lien est personnel : il ne fonctionne qu''avec l''adresse à laquelle il a été envoyé.
      Il expire le {{expire_le}}.<br>
      Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
      <span style="word-break:break-all">{{invitation_url}}</span>
    </p>
  <div style="margin-top:26px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)"><p style="font-size:11.5px;line-height:1.6;color:#7a7a9c;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message accompagne un service que vous utilisez. Il ne contient aucune publicité.</p></div></div>
</div>');
select public.publier_version_email('clubplus.paiement_echoue', 'Le prélèvement de votre abonnement Club+ a échoué', '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div><div style="font-size:10px;color:#32D8E6;letter-spacing:.1em;margin-top:2px">CLUB+</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Le prélèvement de votre abonnement Club+ d''un montant de <strong>{{montant}}</strong> n''a pas pu être effectué.</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Pour continuer à profiter de votre abonnement sans interruption, merci de mettre à jour votre moyen de paiement dès que possible.</p>
         <a href="{{lien_gestion}}" style="display:inline-block;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700;margin-top:8px">Mettre à jour mon moyen de paiement</a>
         <p style="font-size:12px;color:#9DAEC3;margin-top:18px">Sans régularisation, votre abonnement sera considéré comme impayé et pourra être suspendu.</p>
       <p style="font-size:12.5px;line-height:1.7;color:#7a7a9c;margin-top:18px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="word-break:break-all">{{lien_gestion}}</span></p><div style="margin-top:26px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)"><p style="font-size:11.5px;line-height:1.6;color:#7a7a9c;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message accompagne un service que vous utilisez. Il ne contient aucune publicité.</p></div></div>
     </div>
   </body></html>');
select public.publier_version_email('connect.contenu_disponible', 'Vos contenus SportVision sont disponibles', '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Vos photos et vidéos concernant <strong>{{titre}}</strong> sont désormais disponibles dans votre espace SportVision Connect, rubrique « Mes contenus ».</p>
         <p style="font-size:13px;color:#9DAEC3">Connectez-vous pour les consulter, les télécharger et les partager.</p>
         <a href="{{app_url}}" style="display:inline-block;margin-top:16px;background:#168BFF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700">Voir mes contenus</a>
       <p style="font-size:12.5px;line-height:1.7;color:#7a7a9c;margin-top:18px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="word-break:break-all">{{app_url}}</span></p><div style="margin-top:26px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)"><p style="font-size:11.5px;line-height:1.6;color:#7a7a9c;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message accompagne un service que vous utilisez. Il ne contient aucune publicité.</p></div></div>
     </div>
   </body></html>');
select public.publier_version_email('equipe.grade_valide', 'Félicitations {{prenom}} — vous passez {{grade}}', '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#09081a;color:#f7f7fb;padding:32px 20px">
  <div style="max-width:520px;margin:0 auto">
    <div style="font-size:15px;font-weight:700;letter-spacing:-.01em;margin-bottom:26px">SportVision</div>
    <div style="font-size:30px;line-height:1;margin-bottom:10px">{{etoiles}}</div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 12px">Felicitations {{prenom}}, vous passez {{grade}}.</h1>
    <p style="font-size:14px;line-height:1.6;color:#c7c7de;margin:0 0 6px">
      Votre progression a ete examinee et votre nouveau grade est valide. Il prend effet des maintenant sur votre espace SportVision.
    </p>
    <p style="font-size:14px;line-height:1.6;color:#c7c7de;margin:0 0 18px">{{description}}</p>
    <p style="font-size:14px;line-height:1.6;color:#c7c7de;margin:0 0 24px">
      <strong style="color:#f7f7fb">Une certification et une recompense vous seront remises.</strong>
      Nous revenons vers vous tres vite pour vous les transmettre.
    </p>
    <a href="{{lien}}" style="display:inline-block;background-color:#4f7dff;background:linear-gradient(120deg,#a855f7,#4f7dff 55%,#22d3ee);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px">Voir mon espace</a>
    <p style="font-size:12.5px;line-height:1.6;color:#7a7a9c;margin:24px 0 0">
      Merci pour le travail accompli. Continuez comme cela.
    </p>
  <p style="font-size:12.5px;line-height:1.7;color:#7a7a9c;margin-top:18px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="word-break:break-all">{{lien}}</span></p><div style="margin-top:26px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)"><p style="font-size:11.5px;line-height:1.6;color:#7a7a9c;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message accompagne un service que vous utilisez. Il ne contient aucune publicité.</p></div></div>
</div>');
select public.publier_version_email('finance.expense_due_soon', 'Échéance à venir : {{libelle}}', '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
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
       <div style="margin-top:26px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)"><p style="font-size:11.5px;line-height:1.6;color:#7a7a9c;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message accompagne un service que vous utilisez. Il ne contient aucune publicité.</p></div></div>
     </div>
   </body></html>');
select public.publier_version_email('finance.facture_en_retard', 'Rappel de paiement — {{reference}}', '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
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
       <div style="margin-top:26px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)"><p style="font-size:11.5px;line-height:1.6;color:#7a7a9c;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message accompagne un service que vous utilisez. Il ne contient aucune publicité.</p></div></div>
     </div>
   </body></html>');
select public.publier_version_email('galerie.commande_prete', 'Votre commande {{album}} est confirmée', '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#09081a;color:#f7f7fb;padding:32px 20px">
  <div style="max-width:520px;margin:0 auto">
    <div style="font-size:15px;font-weight:700;letter-spacing:-.01em;margin-bottom:26px">SportVision</div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 12px">Merci {{prenom}} !</h1>
    <p style="font-size:14px;line-height:1.6;color:#c7c7de;margin:0 0 6px">
      Votre commande <strong style="color:#f7f7fb">{{album}}</strong> est confirmée.
    </p>
    <p style="font-size:14px;line-height:1.6;color:#c7c7de;margin:0 0 24px">
      {{consigne}}
    </p>
    <a href="{{lien}}" style="display:inline-block;background-color:#4f7dff;background:linear-gradient(120deg,#a855f7,#4f7dff 55%,#22d3ee);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px">{{cta}}</a>
    <p style="font-size:12.5px;line-height:1.6;color:#7a7a9c;margin:24px 0 0">
      Ce lien reste valable jusqu''au {{expiration}}. Créez votre compte SportVision Connect depuis
      cette page pour conserver vos photos sans limite de durée.
    </p>
    <p style="font-size:12px;color:#6c6c90;margin:20px 0 0">Commande {{numero}} — {{montant}}</p>
  <p style="font-size:12.5px;line-height:1.7;color:#7a7a9c;margin-top:18px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="word-break:break-all">{{lien}}</span></p><div style="margin-top:26px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)"><p style="font-size:11.5px;line-height:1.6;color:#7a7a9c;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message accompagne un service que vous utilisez. Il ne contient aucune publicité.</p></div></div>
</div>');
select public.publier_version_email('sales.devis_sans_reponse', 'Votre devis {{numero}} — toujours d''actualité ?', '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
   <body style="margin:0;padding:0;background:#0B1B33;font-family:Arial,sans-serif;color:#F7F9FC">
     <div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden">
       <div style="background:#0B1B33;padding:26px 32px"><div style="font-size:20px;font-weight:800;color:#fff">SPORTVISION</div></div>
       <div style="padding:28px 32px">
         <p style="font-size:15px;line-height:1.6">Bonjour {{first_name}},</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Nous vous avons envoyé le devis <strong>{{numero}}</strong> d''un montant de {{montant_ttc}} TTC il y a quelques jours, et n''avons pas encore de retour de votre part.</p>
         <p style="font-size:14px;line-height:1.7;color:#9DAEC3">Ce devis reste valable — n''hésitez pas à répondre à cet e-mail avec la mention "Bon pour accord", ou à nous contacter pour toute question ou ajustement.</p>
       <div style="margin-top:26px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)"><p style="font-size:11.5px;line-height:1.6;color:#7a7a9c;margin:0">SportVision — Elkana Group, 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne.<br>Ce message accompagne un service que vous utilisez. Il ne contient aucune publicité.</p></div></div>
     </div>
   </body></html>');
