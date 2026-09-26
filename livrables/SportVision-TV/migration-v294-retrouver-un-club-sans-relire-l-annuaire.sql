-- v294 — 26/09/2026 : retrouver un club adverse sans relire l'annuaire à chaque fois
--
-- CE QUI A RÉVÉLÉ LE DÉFAUT. J'ai voulu vérifier qu'une évolution du résolveur ne changeait aucun
-- écusson déjà juste. Le test n'a jamais pu s'exécuter : 303 appels de `resoudre_club_adverse`
-- dépassent le statement_timeout, deux fois de suite. Une fonction qu'on ne peut pas mesurer sur
-- son propre jeu de données réel est une fonction qu'on ne peut pas faire évoluer sans risque.
--
-- POURQUOI ELLE EST LENTE. Chacun de ses trois passages parcourt les 34 586 lignes de l'annuaire
-- en évaluant, PAR LIGNE, une expression rationnelle de quinze sports et un découpage de chaîne :
--
--     and f.recherche !~ '(basket|volley|handball|rugby|natation|tennis|...)'
--     and array_length(string_to_array(f.recherche,' '),1) <= array_length(sans_nb,1) + 3
--
-- Ces deux prédicats ne dépendent QUE de la ligne d'annuaire. Ils ne changent pas d'un appel à
-- l'autre, et on les recalculait 34 586 fois par appel. Ils deviennent des colonnes générées,
-- calculées une fois à l'écriture, toujours d'accord avec la ligne par construction — un trigger
-- ou un backfill auraient pu dériver, une colonne générée non.
--
-- La colonne `sport` de l'annuaire aurait été le bon filtre, et c'est ce que j'ai regardé d'abord :
-- elle est vide sur 34 521 des 34 586 lignes. Le nom du club reste donc le seul signal disponible.
-- C'est une dette de l'annuaire, pas du résolveur, et elle est notée ici plutôt que contournée en
-- silence.
--
-- pg_trgm donne en plus un index utilisable par `like '%mot%'`, la forme exacte des trois passages.
--
-- CE QUE LA FONCTION GAGNE AU PASSAGE : l'adversaire nommé par sa seule commune. « Vaujours »,
-- « Torcy US », « Montreuil FC ». Le résolveur exigeait deux mots par prudence, et cette prudence
-- coûtait les derniers écussons. Le garde-fou ne bouge pas : UN SEUL candidat dans l'annuaire,
-- sinon rien, et cinq lettres au minimum parce qu'un mot court désigne trop de clubs. Ce passage
-- est placé AVANT les sorties « moins de deux mots » : mis après, il était inatteignable, et
-- c'était le cas de ma première version.
--
-- Idempotent.

create extension if not exists pg_trgm;

alter table federation_clubs
  add column if not exists est_autre_sport boolean
    generated always as (
      recherche ~ '(basket|volley|hand ?ball|rugby|natation|tennis|judo|athletisme|gymnastique|petanque|cyclisme|escrime|karate|boxe|danse|twirling|padel)'
      or recherche ~ '^bc '
    ) stored,
  add column if not exists nb_mots integer
    generated always as (array_length(string_to_array(recherche,' '),1)) stored;

comment on column federation_clubs.est_autre_sport is
  'v294 : le club porte dans son nom un sport qui n''est pas le football. Seul signal disponible, la colonne `sport` de l''annuaire etant vide sur 34 521 lignes sur 34 586.';

create index if not exists idx_federation_clubs_recherche_trgm
  on federation_clubs using gin (recherche gin_trgm_ops);
create index if not exists idx_federation_clubs_foot
  on federation_clubs (nb_mots) where not est_autre_sport;

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
  -- Les nombres ne figurent pas dans l'annuaire (« US Vaires 77 » n'y porte pas son 77) et les
  -- sigles de type de club s'y ecrivent en clair (« football club » pour « FC »). Les deux
  -- reductions sont calculees ICI, avant toute sortie : le cas « un seul mot » doit etre traite
  -- avant les gardes qui exigent deux mots, sinon son code n'est jamais atteint.
  sans_nb := array(select m from unnest(mots) m where m !~ '^\d+$');
  noyau := array(select m from unnest(sans_nb) m where not (m = any(abrev)));

  -- Une exigence de plus ICI, et seulement ici : le club retenu doit porter un ecusson. C'est le
  -- passage ou la preuve est la plus mince (un mot), et une resolution qui ne peut RIEN afficher
  -- n'est pas une resolution — elle grave juste un slug qui pourra se tromper plus tard. Elle a
  -- ecarte « FCM Auber », que ce passage envoyait sur « Etoiles d'Auber », une ligne sans nom et
  -- sans logo : un autre club d'Aubervilliers.
  if array_length(noyau,1) = 1 and length(noyau[1]) >= 5 then
    select count(*), min(slug) into n, s from federation_clubs f
     where not f.est_autre_sport
       and f.logo_url is not null
       and ' '||f.recherche||' ' like '% '||noyau[1]||' %';
    if n = 1 then return s; end if;
  end if;

  if array_length(sans_nb,1) < 2 then return null; end if;
  select count(*), min(slug) into n, s from federation_clubs f
   where not f.est_autre_sport
     and f.nb_mots <= array_length(sans_nb,1) + 3
     and (select bool_and(' '||f.recherche||' ' like '% '||m||' %') from unnest(sans_nb) m);
  if n = 1 then return s; end if;

  -- Deuxieme chance SANS les sigles de type de club. On n'y vient que si le passage precedent a
  -- echoue.
  if array_length(noyau,1) < 2 then return null; end if;
  select count(*), min(slug) into n, s from federation_clubs f
   where not f.est_autre_sport
     and f.nb_mots <= array_length(noyau,1) + 3
     and (select bool_and(' '||f.recherche||' ' like '% '||m||' %') from unnest(noyau) m);
  return case when n = 1 then s else null end;
end $f$;
