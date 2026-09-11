-- Un coach qui est aussi parent (ou joueur) dans le club garde le calendrier complet.
--
-- La v158 (12/09/2026, 00h26) borne le calendrier d'un coach, d'un responsable d'équipe et d'un
-- directeur sportif à leurs équipes, plus les rendez-vous du club — c'est la règle voulue.
-- Mesuré juste après (tests/blocages-review.test.mjs) : elle retire aussi, au même moment, ce
-- qu'un PARENT voit depuis la v120. Un coach des U15 dont l'enfant joue en U11 ne voyait plus les
-- matchs de son enfant : il n'encadre pas cette équipe, et son rôle de coach l'emportait sur son
-- lien de famille.
--
-- Correctif, au seul endroit qui décide : `membre_borne_a_ses_equipes` répond faux quand la
-- personne a, dans CE club, une fiche joueur à elle ou un enfant dont elle est parent confirmé —
-- exactement la clause « famille » de `peut_lire_calendrier_club`, qui ouvre déjà le calendrier
-- complet à tout parent. Un coach sans enfant au club reste borné à ses équipes, et rien d'autre
-- ne change : `club_calendrier` (v158) et `is_team_educateur` ne sont pas touchées.
--
-- Rejouable. Garde-fou : si la v158 a changé depuis, la migration s'arrête sans rien modifier.

begin;

do $garde$
declare
  h text := md5(pg_get_functiondef('public.membre_borne_a_ses_equipes(uuid)'::regprocedure));
begin
  if h not in ('8be8f98ff190533016ae61ba06275865',  -- v158, telle que posée le 12/09
               'f8bd3b1d1e6a3e0c2e2a5e1d9c4b7a60') then -- (place pour la version corrigée, rejeu)
    if position('pp.user_id = auth.uid()' in pg_get_functiondef('public.membre_borne_a_ses_equipes(uuid)'::regprocedure)) = 0 then
      raise exception 'blocages-review-5 : membre_borne_a_ses_equipes a changé depuis le 12/09/2026 (md5 %). Rien n''a été modifié — reporter la clause « famille » sur sa nouvelle définition.', h;
    end if;
  end if;
end $garde$;

create or replace function public.membre_borne_a_ses_equipes(p_club_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from club_members cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('coach', 'resp_equipe', 'directeur_sportif')
  )
  -- … sauf s'il est aussi joueur du club ou parent confirmé d'un joueur du club : le lien de
  -- famille ouvre le calendrier complet depuis la v120, un rôle d'encadrement ne le retire pas.
  and not exists (
    select 1 from player_profiles pp
     where pp.club_id = p_club_id
       and coalesce(pp.account_status, '') <> 'retire'
       and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
  );
$function$;

comment on function public.membre_borne_a_ses_equipes(uuid) is
  'Vrai si la personne ne voit, dans ce club, que le calendrier et les séances de SES équipes (coach, responsable d''équipe, directeur sportif) — faux si elle y est aussi joueur ou parent confirmé (v120). v158 + blocages-review-5 du 12/09/2026.';

commit;

-- Vérification : la clause famille est bien en place.
select position('pp.user_id = auth.uid()' in pg_get_functiondef('public.membre_borne_a_ses_equipes(uuid)'::regprocedure)) > 0 as clause_famille;
