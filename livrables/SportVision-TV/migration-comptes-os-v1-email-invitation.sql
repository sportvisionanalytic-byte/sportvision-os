-- L'e-mail d'invitation d'un collaborateur parlait d'un autre produit, et d'une autre duree.
--
-- Le gabarit auth.invitation n'a qu'un seul utilisateur : invite-collaborateur, c'est-a-dire
-- l'entree d'une recrue dans SportVision OS (verifie le 10/09/2026, aucun autre appel dans le
-- depot). Or il annoncait :
--   - « Vous etes invite(e) a rejoindre SportVision Connect » : la recrue cherchait l'application
--     Connect, puis s'etonnait d'arriver sur l'ecran de connexion de l'OS ;
--   - « Cette invitation expire le <date a J+7> » : le lien meurt en realite au bout d'UNE heure
--     (Supabase Auth, mailer_otp_exp = 3600 s ; mesure : un lien clique 2 h apres son envoi revient
--     en otp_expired). La recrue qui ouvrait son e-mail le lendemain tombait sur « Ce lien n'est
--     plus valable » en ayant suivi la consigne.
--
-- invite-collaborateur envoie desormais dans expires_at_local la vraie echeance, heure comprise
-- (« 10 septembre a 18:23 »). Ce gabarit dit donc la bonne chose, et ce qu'il faut faire ensuite.
--
-- Nouvelle version (v2) plutot qu'une modification sur place : un e-mail deja envoye reste
-- rattache au gabarit qui a servi a l'envoyer.

do $$
declare v_template_id uuid; v_html text; v_sujet text; v_vars text[]; v_locale text; v_prov text;
begin
  select id into v_template_id from communication_templates where template_key='auth.invitation';
  if v_template_id is null then raise exception 'Gabarit auth.invitation introuvable.'; end if;

  select body_html_template, subject_template, required_variables, locale, provider_template_id
    into v_html, v_sujet, v_vars, v_locale, v_prov
  from communication_template_versions
  where template_id=v_template_id and active_to is null;

  if v_html is null then raise exception 'Aucune version active pour auth.invitation.'; end if;

  if position('sur SportVision Connect' in v_html)=0 then
    raise notice 'Le gabarit ne contient plus « sur SportVision Connect » : rien n''a ete modifie.';
    return;
  end if;

  v_sujet := 'Votre accès à SportVision OS';
  v_html := replace(v_html,
    'vous invite à rejoindre l''espace {{organization_name}} sur SportVision Connect avec le rôle « {{role_label}} ».',
    'vous invite à rejoindre l''équipe {{organization_name}} sur SportVision OS, l''outil interne de l''équipe, avec le rôle « {{role_label}} ». Le bouton ci-dessous vous permet de choisir votre mot de passe.');
  v_html := replace(v_html,
    'Cette invitation expire le {{expires_at_local}}. Pour des raisons de sécurité, elle ne peut être utilisée qu''une seule fois.',
    'Ce lien est valable jusqu''au {{expires_at_local}} et ne sert qu''une seule fois. S''il a expiré, demandez-en un nouveau à la personne qui vous a invité(e).');

  if position('SportVision Connect' in v_html)>0 or position('{{expires_at_local}}' in v_html)=0 then
    raise exception 'Remplacement incomplet du gabarit auth.invitation : rien n''est enregistre.';
  end if;

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

-- Verification : une seule version active, qui parle de l'OS et plus de Connect.
select v.version, v.subject_template,
       v.body_html_template like '%sur SportVision OS%' as parle_de_l_os,
       v.body_html_template not like '%SportVision Connect%' as plus_de_connect
from communication_template_versions v
join communication_templates t on t.id=v.template_id
where t.template_key='auth.invitation' and v.active_to is null;
