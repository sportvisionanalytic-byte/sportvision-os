-- L'e-mail « grade validé » d'un collaborateur mène à l'OS, plus à Connect (10/09/2026).
--
-- Mikael (photographe) : « il n'arrive plus à se connecter à l'OS, ça le redirige vers Connect ».
-- Son dernier e-mail SportVision (08/09, « grade validé ») portait un lien écrit en dur vers
-- https://connect.sportvision-an.fr/ : un collaborateur qui clique dessus arrive sur Connect,
-- l'espace des joueurs et des familles, pas sur son outil de travail. Seule fonction en cause :
-- les modèles d'e-mail ne contiennent aucune adresse, et l'autre lien Connect trouvé
-- (notify_media_livraison_envoyee) s'adresse à un client, pour qui Connect est la bonne adresse.

begin;

CREATE OR REPLACE FUNCTION public.notifier_grade_valide(p_collaborateur_id uuid, p_grade integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'lien', 'https://bc6m3cgdz.sportvision-an.fr/sportvision-os-full'
    )
  );
  return true;
end;
$function$;

commit;
