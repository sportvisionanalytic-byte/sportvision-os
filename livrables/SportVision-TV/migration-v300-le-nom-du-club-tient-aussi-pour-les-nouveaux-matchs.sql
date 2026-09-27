-- v300 — 27/09/2026 : le verrou de la v293 ne protégeait que le passé
--
-- MON PROPRE TEST L'A ATTRAPÉ, moins de vingt-quatre heures après. `le-match-porte-le-nom-du-club`
-- est passé au rouge à la première exécution du lendemain :
--
--     ROUGE : 4 matchs affichent un nom d'équipe que leur club ne connaît pas
--
--     Séniors D2  affiché « Seniors 3 »   créé 27/09 06:10   verrou=false
--     U14 D4      affiché « U14 2 »       créé 27/09 06:10   verrou=false
--
-- 06 h 10 : la synchronisation fédérale du matin. La v293 avait verrouillé `team` sur les 683 matchs
-- EXISTANTS, et rien pour les suivants. Chaque match créé revenait donc au libellé fédéral, et le
-- calendrier se dégradait un peu chaque jour — exactement le défaut que la v292 avait corrigé, qui
-- serait revenu en silence si le test ne l'avait pas dit.
--
-- LA LEÇON, et c'est elle qui vaut d'être écrite : une correction de DONNÉES ne se défend pas
-- toute seule. Corriger 362 lignes puis verrouiller 683 lignes règle le présent ; seule une règle
-- POSÉE À L'ÉCRITURE règle l'avenir.
--
-- OÙ LA POSER. `resolve_team_id_from_name` est déjà le trigger BEFORE INSERT/UPDATE qui déduit
-- `team_id` du libellé reçu. La règle va dans cette fonction, et pas dans un trigger de plus : deux
-- triggers sur le même champ posent aussitôt une question d'ordre d'exécution, dont la réponse
-- (l'ordre alphabétique des noms) est un détail qu'on n'a pas envie d'avoir à connaître.
--
-- CE QU'ELLE FAIT : dès que `team_id` est connu — qu'il vienne d'être déduit ou qu'il ait été fourni
-- — le nom affiché devient celui que le club donne à cette équipe, et `team` est verrouillé. Les
-- matchs sans `team_id` ne sont pas touchés : leur libellé texte est la seule chose qu'on a.
--
-- La résolution elle-même n'est pas modifiée : mêmes trois tentatives, même ordre, mêmes
-- conditions. Les `return new` intermédiaires deviennent une structure imbriquée pour que la
-- normalisation finale s'applique dans tous les cas, y compris quand `team_id` était déjà là.
--
-- Idempotent.

create or replace function public.resolve_team_id_from_name()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $function$
declare
  v_match_id uuid;
  v_match_count int;
  v_norm text;
  v_nom_du_club text;
  v_provider text;
begin
  -- `provider` N'EXISTE QUE SUR club_matches, et cette fonction est posee sur DEUX tables. La
  -- version d'avant lisait `new.provider` directement : tout ajout d'evenement au calendrier d'un
  -- club SANS team_id echouait en 42703, et le defaut dormait depuis parce que les ecrans
  -- fournissent presque toujours team_id. `to_jsonb(new)` rend NULL au lieu de lever, sur les deux
  -- tables.
  v_provider := to_jsonb(new) ->> 'provider';
  -- ── La résolution, inchangée ────────────────────────────────────────────────────────────────
  if new.team_id is null and new.team is not null and btrim(new.team) <> '' then
    -- 1. Le rapprochement confirmé par le club fait foi.
    select m.team_id into v_match_id
      from club_team_source_mappings m
     where m.club_id = new.club_id
       and m.status = 'confirmed'
       and m.team_id is not null
       and (v_provider is null or m.provider is null or upper(m.provider) = upper(v_provider))
       and lower(btrim(m.external_team_name)) = lower(btrim(new.team))
     order by m.confirmed_at desc nulls last
     limit 1;

    if v_match_id is not null then
      new.team_id := v_match_id;
    else
      -- 2. Le nom exact.
      select ct.id, count(*) over () into v_match_id, v_match_count
      from club_teams ct
      where ct.club_id = new.club_id and ct.name = new.team
      limit 2;

      if v_match_count = 1 then
        new.team_id := v_match_id;
      else
        -- 3. Le nom normalisé, et seulement s'il ne désigne qu'une équipe : entre deux, on ne
        -- devine pas.
        v_norm := regexp_replace(lower(unaccent(btrim(new.team))), '[^a-z0-9]', '', 'g');
        select ct.id, count(*) over () into v_match_id, v_match_count
        from club_teams ct
        where ct.club_id = new.club_id
          and regexp_replace(lower(unaccent(btrim(ct.name))), '[^a-z0-9]', '', 'g') = v_norm
        limit 2;

        if v_match_count = 1 then
          new.team_id := v_match_id;
        end if;
      end if;
    end if;
  end if;

  -- ── v300 : le nom affiché est celui que le club emploie ─────────────────────────────────────
  --
  -- La fédération numérote (« U14 2 »), le club nomme (« U14 D4 »). Les deux décrivent la même
  -- équipe, et c'est le nom du club qui doit s'afficher : c'est celui que le coach, le président et
  -- les familles emploient. `team_id` fait foi, il n'y a rien à deviner.
  --
  -- Le verrou empêche la synchronisation de réécrire ce champ au passage suivant
  -- (federation-sync-matchs retire les champs verrouillés de son patch, v237). Il ne fige aucun nom :
  -- `trg_propager_renommage_equipe` recopie tout renommage côté club en suivant `team_id`.
  if new.team_id is not null then
    select ct.name into v_nom_du_club from club_teams ct where ct.id = new.team_id;
    if v_nom_du_club is not null and new.team is distinct from v_nom_du_club then
      new.team := v_nom_du_club;
    end if;

    -- LE VERROU NE CONCERNE QUE club_matches, et ce `if` n'est pas une precaution de style. CE
    -- TRIGGER EST POSE SUR DEUX TABLES : club_matches et club_calendar_events. La seconde n'a pas de
    -- colonne champs_verrouilles, et y toucher sans condition faisait echouer TOUT ajout
    -- d'evenement au calendrier d'un club :
    --
    --     ERROR 42703 : record « new » has no field « champs_verrouilles »
    --
    -- Trouve par la suite de tests dans la minute, sur cinq tests d'un coup. Une fonction de trigger
    -- partagee par deux tables doit tester TG_TABLE_NAME avant de toucher a ce qui n'existe que
    -- d'un cote.
    -- DEUX `if` IMBRIQUES, ET PAS UN `and` : PL/pgSQL compile toute la condition en UNE expression
    -- SQL et resout donc `new.champs_verrouilles` meme quand tg_table_name ne vaut pas
    -- 'club_matches'. Le court-circuit n'existe pas ici. Mesure : la version avec `and` echouait
    -- toujours en 42703 sur club_calendar_events.
    if tg_table_name = 'club_matches' then
      if not (coalesce(new.champs_verrouilles, '{}'::text[]) @> array['team']) then
        new.champs_verrouilles :=
          (select array(select distinct unnest(coalesce(new.champs_verrouilles, '{}'::text[]) || array['team'])));
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- Rattraper les matchs créés depuis la v293 : 4 ce matin à 6 h 10.
update club_matches m
   set team = t.name,
       champs_verrouilles = array(select distinct unnest(coalesce(m.champs_verrouilles,'{}') || array['team'])),
       updated_at = now()
  from club_teams t
 where t.id = m.team_id
   and (t.name <> m.team or not coalesce(m.champs_verrouilles,'{}') @> array['team']);
