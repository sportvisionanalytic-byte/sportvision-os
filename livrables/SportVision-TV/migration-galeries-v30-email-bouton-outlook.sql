-- Le bouton de telechargement de l'e-mail de commande n'a pas de couleur de repli.
--
-- Son fond est un degrade (linear-gradient). Les clients bases sur le moteur de rendu de Word,
-- Outlook pour Windows en premier lieu, ignorent purement et simplement cette valeur : le bouton
-- perd alors tout fond et il reste un texte blanc en gras sur ce qui se trouve derriere. Selon
-- ce que le client a conserve du fond sombre, cela va du bouton qui ne ressemble plus a un bouton
-- au texte blanc sur blanc, illisible.
--
-- C'est l'e-mail qui porte le lien de telechargement d'un client qui vient de payer : c'est le
-- seul endroit de tout le parcours ou il ne faut pas que l'appel a l'action disparaisse.
--
-- Correction minimale et sans risque : declarer background-color AVANT le degrade. Les clients
-- qui comprennent le degrade l'appliquent par-dessus et l'apparence ne change pas ; les autres
-- gardent un aplat bleu, et le bouton reste un bouton.
--
-- Nouvelle version (v3) plutot qu'une modification sur place : les versions sont datees, et une
-- commande deja envoyee doit rester rattachee au gabarit qui a servi a l'envoyer.

do $$
declare v_template_id uuid; v_html text; v_sujet text; v_vars text[]; v_locale text; v_prov text;
begin
  select id into v_template_id from communication_templates where template_key='galerie.commande_prete';
  if v_template_id is null then raise exception 'Gabarit galerie.commande_prete introuvable.'; end if;

  select body_html_template, subject_template, required_variables, locale, provider_template_id
    into v_html, v_sujet, v_vars, v_locale, v_prov
  from communication_template_versions
  where template_id=v_template_id and active_to is null;

  if v_html is null then raise exception 'Aucune version active pour galerie.commande_prete.'; end if;

  if position('background:linear-gradient' in v_html)=0 then
    raise notice 'Le degrade n''est plus ecrit comme attendu : rien n''a ete modifie.';
    return;
  end if;

  v_html := replace(v_html,'background:linear-gradient','background-color:#4f7dff;background:linear-gradient');

  update communication_template_versions
     set active_to=now()
   where template_id=v_template_id and active_to is null;

  insert into communication_template_versions
    (template_id, version, locale, provider_template_id, subject_template, body_html_template,
     required_variables, active_from, active_to)
  values
    (v_template_id,
     (select coalesce(max(version),0)+1 from communication_template_versions where template_id=v_template_id),
     v_locale, v_prov, v_sujet, v_html, v_vars, now(), null);
end $$;

-- Verification : la version active porte bien la couleur de repli, et elle est placee AVANT le
-- degrade (l'ordre est ce qui fait la cascade).
select version,
       body_html_template like '%background-color:#4f7dff;background:linear-gradient%' as repli_avant_degrade
from communication_template_versions v
join communication_templates t on t.id=v.template_id
where t.template_key='galerie.commande_prete' and v.active_to is null;
