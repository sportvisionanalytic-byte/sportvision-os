-- Migration : Galeries — l'e-mail de commande doit dire la vérité pour les deux modèles
-- À exécuter APRÈS migration-galeries-v8-parcours-formules.sql.
--
-- ── Le problème ──
-- La version 1 du gabarit dit « Vos {{nb_photos}} photo(s) sont disponibles. Téléchargez-les. »
-- C'est vrai pour un achat de photos ou d'une galerie complète. C'est FAUX pour un pack : au
-- moment où l'e-mail part, l'acheteur n'a encore choisi aucune photo. Il aurait reçu « Vos 0
-- photo(s) sont disponibles » avec un bouton « Télécharger mes photos » qui ne télécharge rien.
--
-- ── Le choix ──
-- Pas de logique conditionnelle dans le gabarit : le moteur de gabarits fait de la substitution
-- de variables, pas des branches, et lui en ajouter pour ce seul cas serait un moteur de plus à
-- maintenir. C'est donc l'appelant (le webhook Stripe, qui sait ce qui a été acheté) qui rédige
-- la consigne et le libellé du bouton. Le gabarit ne garde que la mise en forme.
--
-- Le titre de l'album reste une variable à lui, jamais interpolée dans une phrase construite
-- côté webhook : ce qui vient de la base ne doit pas pouvoir apporter son propre HTML dans un
-- e-mail sortant.
--
-- Version 2 : la version 1 est conservée (les e-mails déjà envoyés gardent leur trace), elle
-- cesse simplement d'être la version active.

begin;

-- On ferme la fenêtre d'activité de la v1 (`active_to`) au lieu d'effacer son `active_from` :
-- dispatch-notifications filtre sur `active_from <= now()`, donc un active_from nul l'exclurait
-- aussi, mais en laissant croire que cette version n'a jamais été active. Elle l'a été.
update communication_template_versions v
set active_to = now()
from communication_templates t
where v.template_id = t.id
  and t.template_key = 'galerie.commande_prete'
  and v.version = 1
  and v.active_to is null;

insert into communication_template_versions (
  template_id, version, locale, subject_template, body_html_template, required_variables, active_from
)
select t.id, 2, 'fr',
  'Votre commande {{album}} est confirmée',
  $html$<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#09081a;color:#f7f7fb;padding:32px 20px">
  <div style="max-width:520px;margin:0 auto">
    <div style="font-size:15px;font-weight:700;letter-spacing:-.01em;margin-bottom:26px">SportVision</div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 12px">Merci {{prenom}} !</h1>
    <p style="font-size:14px;line-height:1.6;color:#c7c7de;margin:0 0 6px">
      Votre commande <strong style="color:#f7f7fb">{{album}}</strong> est confirmée.
    </p>
    <p style="font-size:14px;line-height:1.6;color:#c7c7de;margin:0 0 24px">
      {{consigne}}
    </p>
    <a href="{{lien}}" style="display:inline-block;background:linear-gradient(120deg,#a855f7,#4f7dff 55%,#22d3ee);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px">{{cta}}</a>
    <p style="font-size:12.5px;line-height:1.6;color:#7a7a9c;margin:24px 0 0">
      Ce lien reste valable jusqu'au {{expiration}}. Créez votre compte SportVision Connect depuis
      cette page pour conserver vos photos sans limite de durée.
    </p>
    <p style="font-size:12px;color:#6c6c90;margin:20px 0 0">Commande {{numero}} — {{montant}}</p>
  </div>
</div>$html$,
  -- text[] et non jsonb : c'est le type reel de la colonne, verifie en base.
  array['prenom','album','consigne','cta','lien','expiration','numero','montant'],
  now()
from communication_templates t
where t.template_key = 'galerie.commande_prete'
  and not exists (
    select 1 from communication_template_versions v
    where v.template_id = t.id and v.locale = 'fr' and v.version = 2
  );

commit;
