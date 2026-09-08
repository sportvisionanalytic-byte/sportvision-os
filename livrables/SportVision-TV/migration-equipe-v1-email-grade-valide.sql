-- Un grade validé ne prévenait personne.
--
-- centreValiderGrade() met à jour la recommandation et le profil, puis affiche un message à
-- l'administrateur qui vient de cliquer. Le collaborateur promu, lui, n'était averti par rien :
-- ni e-mail, ni notification. Il découvrait son grade par hasard, en ouvrant son espace.
--
-- Deux pièces ici :
--   1. le gabarit d'e-mail « equipe.grade_valide », versionné comme les 12 autres ;
--   2. la fonction notifier_grade_valide(), que l'OS appelle après une validation réussie.
--
-- Pourquoi une fonction dédiée plutôt qu'un appel direct à enqueue_notification : celle-ci n'est
-- exécutable que par postgres et service_role, jamais par un utilisateur connecté. Et surtout,
-- l'adresse du destinataire et le libellé du grade sont résolus ICI, depuis la base, au lieu
-- d'être fournis par le navigateur : personne ne peut envoyer un e-mail de promotion à une
-- adresse de son choix en modifiant l'appel.

-- ── 1. Le gabarit ────────────────────────────────────────────────────────────
do $$
declare v_id uuid;
begin
  insert into communication_templates (template_key, category, channel, mandatory, active, description)
  values ('equipe.grade_valide','OPERATIONS','EMAIL',false,true,
          'Félicitations envoyées au collaborateur dont le grade vient d''être validé.')
  on conflict (template_key) do update set active=true
  returning id into v_id;

  if v_id is null then
    select id into v_id from communication_templates where template_key='equipe.grade_valide';
  end if;

  update communication_template_versions set active_to=now()
   where template_id=v_id and active_to is null;

  insert into communication_template_versions
    (template_id, version, locale, subject_template, body_html_template, required_variables, active_from)
  values (
    v_id,
    (select coalesce(max(version),0)+1 from communication_template_versions where template_id=v_id),
    'fr',
    'Félicitations {{prenom}} — vous passez {{grade}}',
    -- Même charte que les autres gabarits : fond posé sur le corps du message, largeur bornée,
    -- couleur pleine sous le dégradé du bouton (leçon de la migration v30 : les clients basés sur
    -- le moteur de Word ignorent linear-gradient et le bouton perdrait tout fond).
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#09081a;color:#f7f7fb;padding:32px 20px">
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
  </div>
</div>',
    array['prenom','grade','etoiles','description','lien'],
    now()
  );
end $$;

-- ── 2. La fonction appelée par l'OS ──────────────────────────────────────────
create or replace function public.notifier_grade_valide(p_collaborateur_id uuid, p_grade integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prenom text; v_email text; v_nom text; v_grade text; v_etoiles text; v_desc text;
begin
  -- Seuls admin et RH valident un grade : la meme regle que l'ecran, mais appliquee ici, ou
  -- personne ne peut la contourner.
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','rh')) then
    raise exception 'Seule la direction peut notifier une validation de grade.';
  end if;

  if p_grade is null then
    raise exception 'Aucun grade a notifier.';
  end if;

  select p.prenom, p.nom, p.email into v_prenom, v_nom, v_email
  from profiles p where p.id = p_collaborateur_id;

  if v_email is null or v_email = '' then
    -- Pas d'adresse : on le dit, plutot que de faire croire a un envoi.
    return false;
  end if;

  -- Les libelles vivent ici pour que l'e-mail dise la meme chose quel que soit l'appelant.
  select nom, etoiles, description into v_grade, v_etoiles, v_desc from (values
    (0,'Debutant','',            'Vous decouvrez SportVision et etes accompagne sur chaque prestation.'),
    (1,'Confirme','*',           'Vous connaissez les regles essentielles et participez aux prestations simples.'),
    (2,'Senior','**',            'Vous travaillez en autonomie et pouvez gerer une prestation simple en solo.'),
    (3,'Expert','***',           'Vous realisez des prestations complexes et pouvez etre responsable de prestation.'),
    (4,'Elite','****',           'Vous accompagnez les equipes, formez les nouveaux et participez aux validations.'),
    (5,'Maitre','*****',         'Vous representez les standards SportVision au plus haut niveau et encadrez plusieurs equipes.')
  ) as g(rang,nom,etoiles,description) where g.rang = p_grade;

  if v_grade is null then
    raise exception 'Grade % inconnu.', p_grade;
  end if;

  perform enqueue_notification(
    'equipe.grade_valide','equipe.grade_valide','EMAIL',
    -- Une seule felicitation par personne et par grade, meme si la validation est rejouee.
    'grade-'||p_collaborateur_id::text||'-'||p_grade::text,
    v_email, null, p_collaborateur_id, null,
    'profiles', p_collaborateur_id,
    jsonb_build_object(
      'prenom', coalesce(nullif(trim(v_prenom),''),'et bravo'),
      'grade', v_grade,
      'etoiles', repeat('⭐', p_grade),
      'description', v_desc,
      'lien', 'https://connect.sportvision-an.fr/'
    )
  );
  return true;
end;
$function$;

revoke all on function public.notifier_grade_valide(uuid, integer) from public;
grant execute on function public.notifier_grade_valide(uuid, integer) to authenticated;

-- ── Vérification ─────────────────────────────────────────────────────────────
select t.template_key, v.version, v.subject_template,
       v.body_html_template like '%background-color:#4f7dff;background:linear-gradient%' as bouton_avec_repli
from communication_templates t
join communication_template_versions v on v.template_id=t.id and v.active_to is null
where t.template_key='equipe.grade_valide';
