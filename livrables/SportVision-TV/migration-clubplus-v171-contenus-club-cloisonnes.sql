-- v171 : « Mes contenus » suit enfin le périmètre du coach (12/09/2026).
--
-- Le cloisonnement du coach a été posé le 11/09 sur le calendrier (v158), les galeries (v155) et
-- les matchs (v170). Deux tables étaient restées à `is_club_member` : club_media et
-- club_creations, c'est-à-dire l'écran « Mes contenus ». Un coach d'U11 y voyait donc les photos
-- et les créations de toutes les équipes du club.
--
-- Même règle que partout : un membre borné à ses équipes ne voit que les contenus de ses équipes,
-- plus ceux qui ne visent aucune équipe (ils concernent tout le club). Les dirigeants, la
-- communication, le secrétariat, la lecture seule et le staff SportVision ne sont pas bornés :
-- rien ne change pour eux.
-- Test : tests/contenus-club-cloisonnes.test.sql

-- Les contenus portent le NOM de l'équipe, pas son identifiant : ce prédicat fait le pont, en
-- lisant le même périmètre (club_members.teams) que is_team_educateur.
create or replace function public.membre_couvre_equipe_nommee(p_club_id uuid, p_equipe text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_equipe is null or exists (
    select 1 from club_members cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.teams @> to_jsonb(p_equipe)
  );
$$;
revoke execute on function public.membre_couvre_equipe_nommee(uuid, text) from public, anon;
grant execute on function public.membre_couvre_equipe_nommee(uuid, text) to authenticated;

drop policy if exists cmed_perimetre_equipe on public.club_media;
create policy cmed_perimetre_equipe on public.club_media as restrictive for all to public
  using (not membre_borne_a_ses_equipes(club_id)
         or nullif(btrim(coalesce(team, '')), '') is null
         or membre_couvre_equipe_nommee(club_id, team));

drop policy if exists ccre_perimetre_equipe on public.club_creations;
create policy ccre_perimetre_equipe on public.club_creations as restrictive for all to public
  using (not membre_borne_a_ses_equipes(club_id)
         or nullif(btrim(coalesce(team, '')), '') is null
         or membre_couvre_equipe_nommee(club_id, team));
