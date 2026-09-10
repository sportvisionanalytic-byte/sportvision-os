-- Les invitations Club+ passent par la file d'envoi, comme tous les autres e-mails.
--
-- Liste V1.1 du 10/09/2026. clubplus-envoyer-invitation appelait Resend directement. L'e-mail
-- partait, mais hors de notification_outbox : pas de relance si le fournisseur tousse, pas de
-- liste de suppression, pas d'idempotence, et surtout AUCUNE TRACE — impossible de repondre a
-- « le coach dit qu'il n'a rien recu » autrement qu'en devinant.
--
-- Le gabarit reprend mot pour mot le texte de l'e-mail direct, pour qu'un club ne voie aucune
-- difference. Les variables sont du TEXTE BRUT : la file les echappe avant de les inserer (un nom de
-- club contenant « <script> » ne doit pas devenir du HTML). La mise en forme vit donc dans le
-- gabarit, pas dans les variables.
--
-- Categorie SECURITY et obligatoire : c'est un acces a un espace, il ne doit pas pouvoir etre coupe
-- par une preference de notification.

begin;

insert into public.communication_templates (template_key, category, channel, mandatory, active, description)
values ('clubplus.invitation', 'SECURITY', 'EMAIL', true, true,
        'Invitation d''un encadrant (coach, dirigeant...) a rejoindre l''espace Club+ de son club.')
on conflict (template_key) do nothing;

insert into public.communication_template_versions
  (template_id, version, locale, subject_template, body_html_template, required_variables, active_from)
select t.id, 1, 'fr',
  '{{club_nom}} vous invite sur SportVision Club+',
  $html$<div style="max-width:520px;margin:32px auto;background:#10243E;border-radius:14px;overflow:hidden;font-family:Arial,sans-serif;color:#F7F9FC">
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
      Ce lien est personnel : il ne fonctionne qu'avec l'adresse à laquelle il a été envoyé.
      Il expire le {{expire_le}}.<br>
      Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
      <span style="word-break:break-all">{{invitation_url}}</span>
    </p>
  </div>
</div>$html$,
  array['salutation','club_nom','role_label','equipes_texte','invitation_url','expire_le'],
  now() - interval '1 minute'
from public.communication_templates t
where t.template_key = 'clubplus.invitation'
  and not exists (select 1 from public.communication_template_versions v where v.template_id = t.id and v.version = 1);

commit;

select t.template_key, t.category, t.mandatory, v.version, v.subject_template
from communication_templates t join communication_template_versions v on v.template_id = t.id
where t.template_key = 'clubplus.invitation';
