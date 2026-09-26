-- v289 — 26/09/2026 : retrouver le club adverse pour afficher son écusson
--
-- Demande de Fouka : « c'est possible de trouver les logos des équipes adverses, à chaque fois tu
-- fais en sorte qu'il y ait les logos ».
--
-- CE QUI EXISTAIT DÉJÀ, ET CE QUI MANQUAIT
--
-- Les écussons ne manquaient pas : 130 clubs adverses, 130 écussons, couverture complète. Ce qui
-- manquait, c'est le RATTACHEMENT — 181 matchs sur 688 n'avaient aucun `opponent_club_slug`, donc
-- rien à résoudre. La synchro fédérale le remplit quand la source le donne ; les matchs saisis à la
-- main, importés d'un classeur, ou dont la source ne publie pas le club adverse, restaient nus.
--
-- Cette fonction retrouve le club à partir du seul nom affiché (« Amicale Montereau AS U16 1 »).
--
-- TROIS FAUSSES ASSOCIATIONS ÉVITÉES EN L'ÉCRIVANT, toutes trouvées en regardant le résultat :
--
--  1. « À définir » trouvait un slug `a-definir` : l'annuaire contient des entrées parasites. Une
--     liste de mots écartés ferme ça — afficher l'écusson d'un autre club est pire que pas
--     d'écusson.
--  2. « OL NOISY » tombait sur un club de VOLLEY : je cherchais les mots à l'intérieur des mots,
--     et « ol » correspondait à « v-ol-ley ». Les espaces autour forcent la frontière de mot.
--  3. « Gournay Sur Marne » tombait sur le club de BASKET de Gournay. L'annuaire ne renseigne le
--     sport que sur 65 entrées sur 34 586 : on écarte les autres sports par leur nom, faute de
--     mieux, « BC » compris.
--
-- LA RÈGLE : on n'écrit QUE si un seul club correspond. Deux candidats, on ne touche à rien. Un nom
-- trop court ou purement numérique, on écarte. Mieux vaut un écusson manquant qu'un écusson faux.
--
-- Idempotent : ne touche que les lignes dont le slug est nul.

create or replace function public.resoudre_club_adverse(p_nom text)
returns text
language plpgsql stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_nom text;
  v_mots int;
  v_slug text;
  n int;
begin
  if p_nom is null then return null; end if;

  -- La catégorie vit à la fin du libellé : « Amicale Montereau AS U16 1 ». On la retire jusqu'à
  -- quatre fois, parce qu'il y a souvent deux jetons (« U16 » puis « 1 »).
  v_nom := lower(unaccent(btrim(p_nom)));
  for i in 1..4 loop
    v_nom := btrim(regexp_replace(v_nom,
      '\s+(u\s?\d{1,2}|seniors?|senior|veterans?|loisirs?|f|d\d|r\d|\d{1,2})$', '', 'i'));
  end loop;
  v_nom := btrim(regexp_replace(regexp_replace(v_nom, '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'));

  -- Ce qui n'est pas un club.
  if v_nom in ('a definir','interne','exempt','exempte','my events','my elevent','my event',
               'fc','equipe','adversaire','inconnu','')
     or length(v_nom) < 5 or v_nom ~ '^\d+$' then
    return null;
  end if;
  v_mots := array_length(string_to_array(v_nom, ' '), 1);

  -- 1er passage : égalité stricte.
  select count(*), min(slug) into n, v_slug from federation_clubs where recherche = v_nom;
  if n = 1 then return v_slug; end if;
  if n > 1 then return null; end if;

  -- 2e passage : tous les mots présents, EN MOTS ENTIERS, et un seul club correspond.
  if v_mots < 2 then return null; end if;
  select count(*), min(slug) into n, v_slug
    from federation_clubs f
   where (select bool_and(' ' || f.recherche || ' ' like '% ' || mot || ' %')
            from unnest(string_to_array(v_nom, ' ')) mot)
     and f.recherche !~ '(basket|volley|hand ?ball|rugby|natation|tennis|judo|athletisme|gymnastique|petanque|cyclisme|escrime|karate|boxe|danse|twirling)'
     and f.recherche !~ '^bc '
     -- Pas beaucoup plus long que ce qu'on cherche : au-delà ce n'est plus le même club, c'est un
     -- homonyme de commune.
     and array_length(string_to_array(f.recherche, ' '), 1) <= v_mots + 2;

  return case when n = 1 then v_slug else null end;
end $function$;

update club_matches m
   set opponent_club_slug = resoudre_club_adverse(m.opponent),
       updated_at = now()
 where m.opponent_club_slug is null
   and resoudre_club_adverse(m.opponent) is not null;
