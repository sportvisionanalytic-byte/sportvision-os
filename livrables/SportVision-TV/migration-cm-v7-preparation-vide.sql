-- club_preparation() repondait pour un club hors perimetre.
--
-- La fonction filtrait bien le club dans une CTE `autorise`, mais les branches du UNION ALL qui
-- comptent des lignes (equipes, coachs) renvoyaient quand meme une ligne — un count() sur un
-- ensemble vide vaut 0, pas « rien ». Un CM interrogeant le club d'un confrere obtenait donc une
-- reponse structuree, avec des zeros.
--
-- Aucune donnee ne fuyait : tout etait vide. Mais une fonction qui repond pour un club auquel on
-- n'a pas droit est une porte entrouverte, et le test de fuite l'a vue.
--
-- Correction : chaque branche est adossee a la CTE `autorise`. Hors perimetre, elle est vide, et
-- la fonction ne renvoie aucune ligne.

create or replace function public.club_preparation(p_club_id uuid)
returns table(section text, etat text, detail text, calcule boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with autorise as (select p_club_id as id where p_club_id in (select cm_clubs_autorises())),
  c as (select cl.* from clubs cl join autorise a on a.id = cl.id),
  eq as (select count(*)::int n from club_teams t join autorise a on a.id = t.club_id where not t.archivee),
  co as (select count(*)::int n from club_members m join autorise a on a.id = m.club_id where m.role = 'coach'),
  pr as (select count(*)::int n from client_organigramme o
         join clubs cl on cl.portail_client_id = o.client_id
         join autorise a on a.id = cl.id
         where o.role ilike '%pr%sident%')
  select 'Informations du club',
         case when c.nom is not null and c.ville is not null then 'complet' else 'a_completer' end,
         concat_ws(' · ', c.nom, c.ville), true
  from c
  union all
  select 'Logo',
         case when coalesce(c.logo_url, c.ecusson_url) is not null then 'complet' else 'manquant' end,
         null, true from c
  union all
  -- Adossee a `c` : hors perimetre, c est vide et cette ligne n'existe pas non plus.
  select 'Équipes',
         case when eq.n > 0 then 'complet' else 'manquant' end,
         eq.n||' équipe'||case when eq.n>1 then 's' else '' end, true
  from c cross join eq
  union all
  select 'Coachs',
         case when co.n > 0 then 'complet' else 'manquant' end,
         co.n||' coach'||case when co.n>1 then 's' else '' end, true
  from c cross join co
  union all
  select 'Contact président',
         case when pr.n > 0 then 'complet' else 'manquant' end,
         null, true
  from c cross join pr
  union all
  select s.step_key, case when s.fait then 'complet' else 'a_faire' end, s.note, false
  from club_onboarding_steps s join autorise a on a.id = s.club_id;
$function$;
