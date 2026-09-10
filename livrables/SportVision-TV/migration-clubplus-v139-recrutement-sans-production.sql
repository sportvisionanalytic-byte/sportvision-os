-- Le Responsable Production ne voit plus le recrutement (10/09/2026, soir).
--
-- Décision de Fouka pendant la première mission réelle : « le responsable production doit pas voir
-- recrutement ». Elle revient sur celle de l'après-midi (v130, qui confiait à la Production les
-- candidatures d'opérateurs terrain de son pôle). Désormais :
--   Admin SportVision       toutes les candidatures
--   Responsable de pôle     candidatures d'opérateurs terrain de son pôle (écran « Mon pôle »)
--   Secrétariat (et RH)     à partir de « retenu »
--   Production, CM, photographes, commerciaux, comptabilité : aucune
-- La règle unique (peut_voir_candidature) garde la table, les CV, la vue des documents, le journal
-- et la proposition à la Direction ; le menu de l'OS ne propose plus l'écran à la Production.

begin;

create or replace function public.peut_voir_candidature(p_poste text, p_pole_id uuid, p_statut text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      or (p_poste in ('photographe', 'videaste', 'les_deux') and p_pole_id is not null
          and coalesce(is_pole_responsable(p_pole_id), false))
      or (p_statut = 'retenu'
          and exists (select 1 from profiles where id = auth.uid() and role in ('sec', 'rh')));
$$;

commit;
