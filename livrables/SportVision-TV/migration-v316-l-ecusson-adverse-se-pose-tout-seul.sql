-- v316 — 28/09/2026 : l'écusson de l'adversaire se posait à la main, et le résolveur coûtait une seconde
--
-- DEUX DÉFAUTS, un visible et un qui le rendait inévitable.
--
-- 1. RIEN N'APPELAIT LE RÉSOLVEUR. `resoudre_club_adverse` n'était appelée par aucune fonction et
--    aucun trigger : seul le `UPDATE` unique de la v291 l'avait jouée, une fois. La synchronisation
--    fédérale, elle, ne pose l'écusson que si la fédération fournit elle-même le slug
--    (`outside_club_slug` / `home_club_slug`). Quand elle n'en fournit pas, le match reste sans
--    écusson pour toujours. Mesure du jour, avant correction : 692 matchs, 96 sans écusson, dont
--    22 À VENIR. C'est exactement ce que Fouka a signalé deux fois, et la v291 l'avait réparé pour
--    les matchs d'alors sans empêcher les suivants de repartir nus.
--
-- 2. LE RÉSOLVEUR COÛTAIT UNE SECONDE PAR PASSAGE, ce qui interdisait précisément de le brancher à
--    l'écriture. Mesuré : `Execution Time: 1060 ms` pour UN passage, jusqu'à trois par nom. Le plan
--    montrait un balayage complet des 34 586 lignes de l'annuaire, 25 623 d'entre elles évaluant le
--    sous-plan, pour retenir 3 lignes.
--
--    La cause : `' '||f.recherche||' ' like '% '||m||' %'` concatène avant de comparer, donc aucun
--    index ne s'applique — alors que la table porte déjà un index trigramme sur `recherche`.
--
--    Le correctif tient en une ligne par passage : exiger d'abord que `recherche` CONTIENNE le mot
--    le plus long, sur la colonne nue. Cette condition est strictement IMPLIQUÉE par celle qui
--    suit (demander « ␣mot␣ » à l'intérieur de `' '||recherche||' '` impose que `recherche`
--    contienne `mot`), donc elle ne peut écarter aucun club que l'ancienne version trouvait. Elle
--    est redondante pour la logique, décisive pour le plan.
--
--    Vérifié, pas supposé : les 367 noms d'adversaires distincts réellement présents en base
--    donnent 367 résultats IDENTIQUES entre l'ancienne et la nouvelle version, 0 différence.
--    Durée sur 30 noms non résolus (le pire cas, les trois passages) : 2 115 ms → 39 ms.
--
-- POURQUOI UN TRIGGER PLUTÔT QU'UN APPEL DANS LA SYNCHRONISATION. Les matchs n'arrivent pas que
-- par la fédération : ils sont aussi créés à la main dans Club+ et par import. Corriger la seule
-- fonction de synchronisation aurait laissé les autres chemins nus, et c'est la répétition de ce
-- genre d'oubli qui a produit le défaut d'origine. Le trigger tient la règle à un seul endroit.
--
-- IL NE REMPLIT QUE LE VIDE, ET NE DÉFAIT PAS UNE DÉCISION HUMAINE : il n'agit que si
-- `opponent_club_slug` est nul, et à la modification seulement si l'adversaire a changé. Effacer
-- un écusson faux à la main reste donc possible, il ne repousse pas derrière.
--
-- Idempotent.

-- ── 1. Le résolveur, même logique, préfiltre trigramme ──────────────────────────────────────────
create or replace function public.resoudre_club_adverse(p_nom text)
returns text language plpgsql stable set search_path to 'public','pg_temp' as $f$
declare
  v text; mots text[]; sans_nb text[]; noyau text[]; n int; s text; pivot text;
  abrev constant text[] := array['fc','us','as','sc','rc','cs','ac','ol','esc','asc','ca','co','js','ss','es','usm','fcm','sf','sa'];
begin
  if p_nom is null then return null; end if;
  v := lower(unaccent(btrim(p_nom)));
  for i in 1..4 loop
    v := btrim(regexp_replace(v,'\s+(u\s?\d{1,2}|seniors?|senior|veterans?|loisirs?|f|d\d|r\d|\d{1,2})$','','i'));
  end loop;
  v := btrim(regexp_replace(regexp_replace(v,'[^a-z0-9 ]',' ','g'),'\s+',' ','g'));
  if v in ('a definir','interne','exempt','exempte','my events','my elevent','my event','fc','equipe','adversaire','inconnu','')
     or length(v) < 5 or v ~ '^\d+$' then return null; end if;

  select count(*), min(slug) into n, s from federation_clubs where recherche = v;
  if n = 1 then return s; end if;
  if n > 1 then return null; end if;

  -- Les nombres ne figurent pas dans l'annuaire (« US Vaires 77 » n'y porte pas son 77) et les
  -- sigles de type de club s'y ecrivent en clair (« football club » pour « FC »). Les deux
  -- reductions sont calculees ICI, avant toute sortie : le cas « un seul mot » doit etre traite
  -- avant les gardes qui exigent deux mots, sinon son code n'est jamais atteint.
  mots := string_to_array(v,' ');
  sans_nb := array(select m from unnest(mots) m where m !~ '^\d+$');
  noyau := array(select m from unnest(sans_nb) m where not (m = any(abrev)));

  -- Une exigence de plus ICI, et seulement ici : le club retenu doit porter un ecusson. C'est le
  -- passage ou la preuve est la plus mince (un mot), et une resolution qui ne peut RIEN afficher
  -- n'est pas une resolution — elle grave juste un slug qui pourra se tromper plus tard. Elle a
  -- ecarte « FCM Auber », que ce passage envoyait sur « Etoiles d'Auber », une ligne sans nom et
  -- sans logo : un autre club d'Aubervilliers.
  if array_length(noyau,1) = 1 and length(noyau[1]) >= 5 then
    select count(*), min(slug) into n, s from federation_clubs f
     where f.recherche like '%'||noyau[1]||'%'          -- préfiltre : implique la ligne suivante
       and not f.est_autre_sport
       and f.logo_url is not null
       and ' '||f.recherche||' ' like '% '||noyau[1]||' %';
    if n = 1 then return s; end if;
  end if;

  if array_length(sans_nb,1) < 2 then return null; end if;
  select m into pivot from unnest(sans_nb) m order by length(m) desc, m limit 1;
  select count(*), min(slug) into n, s from federation_clubs f
   where f.recherche like '%'||pivot||'%'               -- préfiltre : implique la ligne du bool_and
     and not f.est_autre_sport
     and f.nb_mots <= array_length(sans_nb,1) + 3
     and (select bool_and(' '||f.recherche||' ' like '% '||m||' %') from unnest(sans_nb) m);
  if n = 1 then return s; end if;

  -- Deuxieme chance SANS les sigles de type de club. On n'y vient que si le passage precedent a
  -- echoue.
  if array_length(noyau,1) < 2 then return null; end if;
  select m into pivot from unnest(noyau) m order by length(m) desc, m limit 1;
  select count(*), min(slug) into n, s from federation_clubs f
   where f.recherche like '%'||pivot||'%'               -- préfiltre : implique la ligne du bool_and
     and not f.est_autre_sport
     and f.nb_mots <= array_length(noyau,1) + 3
     and (select bool_and(' '||f.recherche||' ' like '% '||m||' %') from unnest(noyau) m);
  return case when n = 1 then s else null end;
end $f$;

-- ── 2. Le branchement à l'écriture ─────────────────────────────────────────────────────────────
create or replace function public.ecusson_adverse_a_l_ecriture()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  -- À la modification, on ne cherche que si l'adversaire lui-même a changé : sinon un écusson
  -- effacé volontairement serait repoussé au prochain enregistrement.
  if tg_op = 'UPDATE' and new.opponent is not distinct from old.opponent then
    return new;
  end if;
  if new.opponent_club_slug is null and new.opponent is not null then
    new.opponent_club_slug := public.resoudre_club_adverse(new.opponent);
  end if;
  return new;
end $f$;

revoke all on function public.ecusson_adverse_a_l_ecriture() from public, anon, authenticated;

drop trigger if exists trg_club_matches_ecusson_adverse on public.club_matches;
create trigger trg_club_matches_ecusson_adverse
  before insert or update on public.club_matches
  for each row execute function public.ecusson_adverse_a_l_ecriture();

-- ── 3. Les matchs déjà en base, que personne ne réécrira ────────────────────────────────────────
update club_matches m
   set opponent_club_slug = resoudre_club_adverse(m.opponent), updated_at = now()
 where m.opponent_club_slug is null
   and resoudre_club_adverse(m.opponent) is not null;

drop function if exists public.resoudre_club_adverse_essai(text);
