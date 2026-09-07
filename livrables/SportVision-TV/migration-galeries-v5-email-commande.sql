-- Migration : Galeries SportVision — e-mail de confirmation de commande (Lot 3, suite)
-- À exécuter APRÈS migration-galeries-v4-checkout.sql.
--
-- Aucune ligne de code n'est nécessaire côté dispatcher : `dispatch-notifications` résout ses
-- gabarits par `communication_templates.template_key` puis prend la version active. Ajouter un
-- e-mail transactionnel se fait donc en base, ce qui est exactement l'intérêt de cette
-- architecture — et la raison pour laquelle on ne code pas un envoi d'e-mail à part.
--
-- `mandatory = true` : c'est le seul moyen pour l'acheteur de retrouver ses photos s'il ferme
-- l'onglet. Un e-mail de livraison n'est pas une communication marketing, il ne doit pas pouvoir
-- être filtré par les préférences de notification.

begin;

insert into communication_templates (template_key, category, channel, mandatory, active, description)
values ('galerie.commande_prete', 'BILLING', 'EMAIL', true, true,
        'Confirmation d''achat de photos depuis une galerie publique : lien de téléchargement valable 30 jours.')
on conflict (template_key) do update
  set mandatory = true, active = true, channel = 'EMAIL';

insert into communication_template_versions (
  template_id, version, locale, subject_template, body_html_template, required_variables, active_from
)
select t.id, 1, 'fr',
  'Vos photos {{album}} sont prêtes',
  $html$<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#09081a;color:#f7f7fb;padding:32px 20px">
  <div style="max-width:520px;margin:0 auto">
    <div style="font-size:15px;font-weight:700;letter-spacing:-.01em;margin-bottom:26px">SportVision</div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 12px">Merci {{prenom}} !</h1>
    <p style="font-size:14px;line-height:1.6;color:#c7c7de;margin:0 0 6px">
      Vos {{nb_photos}} photo(s) de <strong style="color:#f7f7fb">{{album}}</strong> sont disponibles.
    </p>
    <p style="font-size:14px;line-height:1.6;color:#c7c7de;margin:0 0 24px">
      Téléchargez-les en pleine qualité, sans filigrane.
    </p>
    <a href="{{lien}}" style="display:inline-block;background:linear-gradient(120deg,#a855f7,#4f7dff 55%,#22d3ee);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px">Télécharger mes photos</a>
    <p style="font-size:12.5px;line-height:1.6;color:#7a7a9c;margin:24px 0 0">
      Ce lien reste valable jusqu'au {{expiration}}. Créez votre compte SportVision Connect depuis
      cette page pour conserver vos photos sans limite de durée.
    </p>
    <p style="font-size:12px;color:#6c6c90;margin:20px 0 0">Commande {{numero}} — {{montant}}</p>
  </div>
</div>$html$,
  -- text[] et non jsonb : c'est le type reel de la colonne, verifie en base.
  array['prenom','album','nb_photos','lien','expiration','numero','montant'],
  now()
from communication_templates t
where t.template_key = 'galerie.commande_prete'
  and not exists (
    select 1 from communication_template_versions v
    where v.template_id = t.id and v.locale = 'fr' and v.version = 1
  );

commit;
