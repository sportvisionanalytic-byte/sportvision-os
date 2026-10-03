-- v492 — Un gabarit pour dire « il vous reste des photos à choisir » (03/10/2026)
--
-- POURQUOI UN GABARIT DE PLUS. La v490/v491 rouvre le choix d'un pack entamé, mais rien ne le dit
-- aux familles concernées : leur lien dort dans un e-mail reçu le jour du paiement. Il faut donc
-- pouvoir leur réécrire, et ce sera vrai à chaque fois qu'un pack approchera de l'expiration sans
-- avoir été complété.
--
-- `galerie.commande_prete` a exactement les bonnes variables et le bon bouton, mais son sujet dit
-- « Votre commande est confirmée ». Les deux familles l'ont déjà reçu : le même sujet se lit comme
-- un doublon et ne se rouvre pas. Le sujet est donc le SEUL changement — le corps est copié tel
-- quel depuis la version 4, par `select`, pour que le rendu soit identique au caractère près et
-- qu'il n'y ait rien à revérifier à l'écran.
--
-- `mandatory = true` comme la source : c'est un message transactionnel sur une commande payée, pas
-- une sollicitation. Le filtrer par les préférences de notification reviendrait à garder l'argent
-- d'une famille sans lui livrer ses photos.

begin;

insert into public.communication_templates (template_key, category, channel, mandatory, active, description)
values ('galerie.pack_a_completer', 'BILLING', 'EMAIL', true, true,
        'Pack de photos payé mais pas encore entièrement choisi : renvoi du lien de sélection.')
on conflict (template_key) do nothing;

insert into public.communication_template_versions
  (template_id, version, locale, subject_template, body_html_template, required_variables, active_from)
select (select id from public.communication_templates where template_key = 'galerie.pack_a_completer'),
       1, v.locale,
       'Il vous reste des photos à choisir — {{album}}',
       v.body_html_template,
       v.required_variables,
       now()
from public.communication_templates t
join public.communication_template_versions v on v.template_id = t.id
where t.template_key = 'galerie.commande_prete' and v.version = 4
  and not exists (
    select 1 from public.communication_template_versions cv
    join public.communication_templates ct on ct.id = cv.template_id
    where ct.template_key = 'galerie.pack_a_completer' and cv.version = 1
  );

commit;
