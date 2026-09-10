-- La checklist dit ce qui manque à l'identité du club.
--
-- Trouvé à la passe navigateur du 10/09/2026 : sur SF Villemomble, « Identité » restait
-- « incomplet » sans un mot, et bloquait le lancement. Il manquait la ville — que la carte
-- Identité ne permettait d'ailleurs pas de saisir (champ ajouté côté écran le même jour).
-- Corps de club_onboarding_sections() inchangé, sauf le détail de la ligne « identite ».

begin;

CREATE OR REPLACE FUNCTION public.club_onboarding_sections(p_club_id uuid)
 RETURNS TABLE(cle text, libelle text, obligatoire boolean, etat text, detail text, derniere_at timestamp with time zone, derniere_par text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_c jsonb;
  v_sans_coach int; v_sans_creneau int; v_sans_calendrier int; v_nb_equipes int;
  v_joueurs int; v_image_ok int;
  v_president_actif boolean;
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  v_c := club_onboarding_completion(p_club_id);

  select count(*), count(*) filter (where e.encadrant_statut = 'aucun'),
         count(*) filter (where e.creneaux = 0), count(*) filter (where e.evenements = 0),
         coalesce(sum(e.joueurs), 0), coalesce(sum(e.image_valides), 0)
    into v_nb_equipes, v_sans_coach, v_sans_creneau, v_sans_calendrier, v_joueurs, v_image_ok
    from club_equipes_etat(p_club_id) e;

  select exists (select 1 from club_members where club_id = p_club_id and role = 'president' and status = 'actif')
    into v_president_actif;

  return query
  with s(cle, libelle, ordre) as (values
    ('identite', 'Identité', 1), ('responsables', 'Responsables', 2), ('equipes', 'Équipes', 3),
    ('entrainements', 'Entraînements', 4), ('calendrier', 'Calendrier', 5), ('branding', 'Branding', 6),
    ('sponsors', 'Sponsors', 7), ('communication', 'Communication', 8), ('droit_image', 'Droit à l''image', 9)
  ),
  modif as (
    select distinct on (ev.section) ev.section, ev.derniere_at,
           coalesce(nullif(btrim(concat_ws(' ', p.prenom, p.nom)), ''),
                    case when ev.auteur_id is null then 'SportVision' end, 'Un membre') as par
      from club_onboarding_events ev
      left join profiles p on p.id = ev.auteur_id
     where ev.club_id = p_club_id and ev.section is not null
     order by ev.section, ev.derniere_at desc
  )
  select s.cle, s.libelle, s.cle = any (club_sections_obligatoires()),
         case
           when not coalesce((v_c->>s.cle)::boolean, false) then 'incomplet'
           when s.cle = 'equipes' and v_sans_coach > 0 then 'attention'
           when s.cle = 'entrainements' and v_sans_creneau > 0 then 'attention'
           when s.cle = 'calendrier' and v_sans_calendrier > 0 then 'attention'
           when s.cle = 'responsables' and not v_president_actif then 'attention'
           when s.cle = 'droit_image' and v_joueurs > 0 and v_image_ok < v_joueurs then 'attention'
           else 'termine'
         end,
         case s.cle
           when 'identite' then (select case when nullif(concat_ws(', ',
                                          case when c.nom is null then 'nom' end,
                                          case when c.ville is null then 'ville' end,
                                          case when c.adresse is null then 'adresse' end), '') is not null
                                        then 'À renseigner : ' || concat_ws(', ',
                                          case when c.nom is null then 'nom' end,
                                          case when c.ville is null then 'ville' end,
                                          case when c.adresse is null then 'adresse' end) end
                                   from clubs c where c.id = p_club_id)
           when 'equipes' then case when v_nb_equipes = 0 then 'Aucune équipe'
                                    when v_sans_coach > 0 then v_sans_coach || ' équipe' || case when v_sans_coach > 1 then 's' else '' end || ' sans coach'
                                    else v_nb_equipes || ' équipes' end
           when 'entrainements' then case when v_sans_creneau > 0 and v_nb_equipes > 0
                                          then v_sans_creneau || ' équipe' || case when v_sans_creneau > 1 then 's' else '' end || ' sans créneau' end
           when 'calendrier' then case when v_sans_calendrier > 0 and v_nb_equipes > 0
                                       then v_sans_calendrier || ' équipe' || case when v_sans_calendrier > 1 then 's' else '' end || ' sans aucun événement' end
           when 'responsables' then case when not coalesce((v_c->>'responsables')::boolean, false) then 'Président à renseigner'
                                         when not v_president_actif then 'Président connu, pas encore connecté' end
           when 'droit_image' then case when v_joueurs > 0 then v_image_ok || ' / ' || v_joueurs || ' autorisations validées' end
         end,
         m.derniere_at, m.par
    from s
    left join modif m on m.section = s.cle
   order by s.ordre;
end;
$function$;

commit;
