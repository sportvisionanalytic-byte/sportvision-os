-- v204 — La synchro fédérale utilise enfin les rapprochements confirmés (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. `club_team_source_mappings` porte 25 rapprochements CONFIRMÉS à la main
-- dans Club+ : « Seniors 3 » chez la fédération correspond à telle équipe du club. Ces
-- rapprochements ne servaient qu'à l'assistant d'import manuel. La synchro hebdomadaire, elle,
-- écrit `team` en texte et s'en remet au trigger `resolve_team_id_from_name`, qui compare
-- `ct.name = new.team` en ÉGALITÉ STRICTE — sensible à la casse, aux accents et aux espaces.
--
-- Le code promet pourtant, en commentaire, qu'« à la synchronisation suivante, le moteur
-- court-circuite tout rapprochement de texte ». C'était faux : le travail de rapprochement fait
-- par le club n'était jamais relu, et un match dont le libellé diffère d'une majuscule restait
-- sans équipe — donc invisible du calendrier de l'équipe, et sans galerie rattachable.
--
-- CE QUE FAIT CETTE MIGRATION. La résolution regarde d'abord le rapprochement confirmé, pour le
-- fournisseur concerné ; puis le nom exact ; puis le nom normalisé (minuscules, sans accents, sans
-- ponctuation), et seulement s'il ne désigne qu'une équipe. On ne devine jamais entre deux.
-- Idempotente.

create or replace function public.resolve_team_id_from_name()
returns trigger language plpgsql set search_path to 'public', 'pg_temp'
as $$
declare
  v_match_id uuid;
  v_match_count int;
  v_norm text;
begin
  if new.team_id is not null or new.team is null or btrim(new.team) = '' then
    return new;
  end if;

  -- 1. Le rapprochement confirmé par le club fait foi.
  select m.team_id into v_match_id
    from club_team_source_mappings m
   where m.club_id = new.club_id
     and m.status = 'confirmed'
     and m.team_id is not null
     and (new.provider is null or m.provider is null or upper(m.provider) = upper(new.provider))
     and lower(btrim(m.external_team_name)) = lower(btrim(new.team))
   order by m.confirmed_at desc nulls last
   limit 1;
  if v_match_id is not null then
    new.team_id := v_match_id;
    return new;
  end if;

  -- 2. Le nom exact.
  select ct.id, count(*) over () into v_match_id, v_match_count
  from club_teams ct
  where ct.club_id = new.club_id and ct.name = new.team
  limit 2;

  if v_match_count = 1 then
    new.team_id := v_match_id;
    return new;
  end if;

  -- 3. Le nom normalisé, et seulement s'il ne désigne qu'une équipe : entre deux, on ne devine pas.
  v_norm := regexp_replace(lower(unaccent(btrim(new.team))), '[^a-z0-9]', '', 'g');
  select ct.id, count(*) over () into v_match_id, v_match_count
  from club_teams ct
  where ct.club_id = new.club_id
    and regexp_replace(lower(unaccent(btrim(ct.name))), '[^a-z0-9]', '', 'g') = v_norm
  limit 2;

  if v_match_count = 1 then
    new.team_id := v_match_id;
  end if;

  return new;
end;
$$;
