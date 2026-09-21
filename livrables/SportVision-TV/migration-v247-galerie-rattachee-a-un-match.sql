-- Rattacher une galerie à ce qu'elle photographie (21/09/2026)
--
-- DEMANDE DE FOUKA : « dans galerie photo, il faut que je puisse ajouter des galeries. Par exemple
-- si je fais un entraînement, ou à la fin d'un match, que je puisse mettre les photos liées à la
-- prestation ou liées à un entraînement particulier. Donc des clubs que j'ai en Full
-- Communication. »
--
-- CE QUI EXISTAIT. Une galerie pouvait déjà pointer vers une prestation (`mission_id`) et vers un
-- événement du calendrier (`event_id`). Mais il fallait taper la référence de la prestation à la
-- main, et surtout : LE MATCH MANQUAIT. Les matchs ne vivent pas dans club_calendar_events, ils ont
-- leur propre table depuis toujours — 670 lignes aujourd'hui, contre zéro événement de calendrier.
-- Autrement dit, la seule chose qu'on photographie vraiment n'était rattachable à rien.
--
-- CE QUE ÇA CHANGE CONCRÈTEMENT. Une galerie rattachée à un match hérite de son équipe, donc elle
-- apparaît dans l'espace Connect des joueurs de cette équipe. Sans rattachement, il faut choisir
-- l'équipe à la main, et c'est l'oubli qui explique les 20 galeries actuellement rattachées à
-- aucun club : personne ne les voit depuis son espace, on n'y accède que par le lien.

begin;

alter table media_albums add column if not exists match_id uuid references club_matches(id) on delete set null;
create index if not exists media_albums_match_idx on media_albums (match_id) where match_id is not null;

comment on column media_albums.match_id is
  'Le match photographié, quand la galerie en couvre un. Distinct de event_id (entraînement ou '
  'événement du calendrier) et de mission_id (la prestation facturée) : les trois peuvent coexister.';

-- ══ CE À QUOI ON PEUT RATTACHER UNE GALERIE ══════════════════════════════════
-- Une seule liste, ordonnée du plus récent au plus ancien, pour un seul choix à l'écran. Trois
-- sources : les matchs, les entraînements et événements du calendrier, et les prestations.
-- Chaque ligne rapporte l'équipe et la date, ce qui permet de pré-remplir la galerie plutôt que
-- de faire retaper ce qu'on vient de choisir.
create or replace function public.galerie_rattachements(p_club_id uuid, p_jours int default 60)
returns table (
  genre text, ref_id uuid, libelle text, date_evenement date,
  team_id uuid, equipe text, detail text
)
language sql
stable security definer
set search_path to 'public'
as $$
  with fenetre as (
    select (now() at time zone 'Europe/Paris')::date - greatest(coalesce(p_jours, 60), 1) as depuis,
           (now() at time zone 'Europe/Paris')::date + 7 as jusqua
  )
  select 'match'::text, m.id,
         coalesce(t.name, m.team, 'Équipe') || ' — ' || coalesce(m.opponent, 'adversaire'),
         m.match_date, m.team_id, coalesce(t.name, m.team),
         nullif(btrim(coalesce(m.competition, '')), '')
    from club_matches m
    left join club_teams t on t.id = m.team_id
   cross join fenetre f
   where m.club_id = p_club_id and m.match_date between f.depuis and f.jusqua

  union all

  select case when lower(coalesce(e.type, '')) like '%entra%' then 'entrainement' else 'evenement' end,
         e.id, e.title, e.event_date, e.team_id, e.team,
         nullif(btrim(coalesce(e.location, '')), '')
    from club_calendar_events e
   cross join fenetre f
   where e.club_id = p_club_id and e.event_date between f.depuis and f.jusqua

  union all

  select 'prestation'::text, p.id,
         coalesce(p.reference, 'Prestation') || ' — ' || coalesce(p.type_prestation, 'prestation'),
         p.date_prestation, null::uuid, null::text,
         nullif(btrim(coalesce(p.lieu, '')), '')
    from prestations p
    join clubs c on c.portail_client_id = p.client_id
   cross join fenetre f
   where c.id = p_club_id and p.date_prestation between f.depuis and f.jusqua

  order by 4 desc nulls last, 3;
$$;

revoke all on function public.galerie_rattachements(uuid, int) from public;
grant execute on function public.galerie_rattachements(uuid, int) to authenticated;

comment on function public.galerie_rattachements(uuid, int) is
  'Matchs, entraînements et prestations récents d''un club, en une liste, pour rattacher une '
  'galerie à ce qu''elle photographie.';

commit;
