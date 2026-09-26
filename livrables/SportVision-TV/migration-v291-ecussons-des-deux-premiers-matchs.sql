-- v291 — 26/09/2026 : les deux premiers matchs de l'écran n'avaient pas d'écusson
--
-- Fouka : « sur l'app je ne vois toujours pas les logos des clubs adverses ». Tout était pourtant
-- vérifié — image servie en 200, droits de lecture testés en rôle `authenticated`, code de l'app
-- correct, mise à jour publiée. Le défaut était ailleurs, et il fallait regarder SON écran :
--
--     27/09  vs Val D'europe FC U16 1   aucun club identifié
--     04/10  vs US Vaires 77 U16 2      aucun club identifié
--     11/10  vs Claye Souilly U16 1     écusson ✓  ... et tous les suivants
--
-- Les DEUX PREMIERS matchs à venir de son équipe, ceux en haut du calendrier, ceux qu'on regarde.
-- Sur 216 matchs avec écusson, il est tombé sur les deux qui n'en avaient pas. Une statistique
-- globale rassurante ne dit rien de ce qu'une personne voit.
--
-- POURQUOI LE RÉSOLVEUR DE LA v289 LES A RATÉS, deux causes différentes :
--
--   « Val D'europe FC »  l'annuaire écrit « val d europe football club ». Le sigle FC n'y figure
--                        pas tel quel, et j'exigeais TOUS les mots.
--   « US Vaires 77 »     le 77 est le département, il n'apparaît dans aucun nom de club.
--
-- Deux passages supplémentaires, chacun exigeant toujours UN SEUL candidat : d'abord sans les
-- nombres, puis sans les sigles de type de club (FC, US, AS…). Six clubs retrouvés, tous avec leur
-- écusson, tous vérifiés un par un avant écriture.
--
-- Idempotent.

create or replace function public.resoudre_club_adverse(p_nom text)
returns text language plpgsql stable set search_path to 'public','pg_temp' as $f$
declare
  v text; mots text[]; sans_nb text[]; noyau text[]; n int; s text;
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

  mots := string_to_array(v,' ');
  -- Les nombres ne figurent pas dans l'annuaire : « US Vaires 77 » n'y est pas ecrit avec son 77.
  sans_nb := array(select m from unnest(mots) m where m !~ '^\d+$');
  if array_length(sans_nb,1) < 2 then return null; end if;

  select count(*), min(slug) into n, s from federation_clubs f
   where (select bool_and(' '||f.recherche||' ' like '% '||m||' %') from unnest(sans_nb) m)
     and f.recherche !~ '(basket|volley|hand ?ball|rugby|natation|tennis|judo|athletisme|gymnastique|petanque|cyclisme|escrime|karate|boxe|danse|twirling|padel)'
     and f.recherche !~ '^bc '
     and array_length(string_to_array(f.recherche,' '),1) <= array_length(sans_nb,1) + 3;
  if n = 1 then return s; end if;

  -- Deuxieme chance SANS les sigles de type de club : l'annuaire ecrit souvent « football club »
  -- la ou le calendrier ecrit « FC ». On n'y vient que si le passage precedent a echoue.
  noyau := array(select m from unnest(sans_nb) m where not (m = any(abrev)));
  if array_length(noyau,1) < 2 then return null; end if;
  select count(*), min(slug) into n, s from federation_clubs f
   where (select bool_and(' '||f.recherche||' ' like '% '||m||' %') from unnest(noyau) m)
     and f.recherche !~ '(basket|volley|hand ?ball|rugby|natation|tennis|judo|athletisme|gymnastique|petanque|cyclisme|escrime|karate|boxe|danse|twirling|padel)'
     and f.recherche !~ '^bc '
     and array_length(string_to_array(f.recherche,' '),1) <= array_length(noyau,1) + 3;
  return case when n = 1 then s else null end;
end $f$;


update club_matches m
   set opponent_club_slug = resoudre_club_adverse(m.opponent), updated_at = now()
 where m.opponent_club_slug is null
   and resoudre_club_adverse(m.opponent) is not null;

drop function if exists public.resoudre_club_adverse_essai(text);
