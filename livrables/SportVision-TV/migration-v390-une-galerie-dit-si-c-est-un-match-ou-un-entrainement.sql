-- v390 — UNE GALERIE DIT SI C'EST UN MATCH OU UN ENTRAÎNEMENT (01/10/2026)
--
-- ═══ LA DEMANDE, MOT POUR MOT ══════════════════════════════════════════════════════════════════
--
-- Fouka : « Dans les galeries, il y a des moments où ce sera des entraînements. Quand on fait une
-- galerie de club, il faut préciser match ou entraînement. Comme ça ces entraînements, il n'y a pas
-- de numéro affilié à la galerie. Donc la reconnaissance ce sera un peu plus compliqué, mais il y
-- aura une reconnaissance à faire, mais pas de numéro. »
--
-- Et : « ça propose type de galerie, match ou entraînement, et comme ça les parents voient que
-- c'est un entraînement, il n'y a pas de numéro à renseigner, avec la reconnaissance par visage
-- toujours. »
--
-- ═══ CE QUE LA BASE SAVAIT DIRE, ET CE QU'ELLE NE SAVAIT PAS ═══════════════════════════════════
--
-- `media_albums` n'a AUCUNE colonne qui dise de quoi il s'agit. Elle a `event_date`, `event_id`,
-- `match_id` et `mission_id`. On pouvait donc espérer déduire : un `match_id` rempli = un match,
-- un `event_id` rempli = un entraînement ou un événement.
--
-- Mesuré sur les 57 galeries en base, le 01/10/2026 :
--
--     galeries ............................. 57
--     avec match_id ......................... 0
--     avec event_id ......................... 0
--     avec mission_id ....................... 0
--
-- ZÉRO. Le rattachement existe dans l'écran depuis la v247, et personne ne l'utilise — parce qu'il
-- suppose que l'événement a d'abord été saisi dans le calendrier du club, ce qui n'arrive pas quand
-- on photographie un tournoi, un plateau ou l'équipe adverse. Déduire le type d'un champ toujours
-- vide, c'est fabriquer une colonne qui répond toujours la même chose.
--
-- ═══ POURQUOI PAS SEULEMENT « MATCH » ET « ENTRAÎNEMENT » ══════════════════════════════════════
--
-- Fouka n'a nommé que ces deux-là. Les titres des 57 galeries en base en nomment trois de plus, et
-- ce ne sont pas des cas de bord — c'est 40 % du parc :
--
--     match (« vs », « CDF », « coupe ») .... 32 galeries, 5 624 photos
--     tournoi (« Cup ») .................... 13 galeries,   676 photos
--     plateau .............................. 9 galeries, 1 240 photos
--     école de foot ......................... 1 galerie,    96 photos
--     ni l'un ni l'autre .................... 2 galeries,   141 photos
--
-- Les coller dans « match » ferait mentir l'écran de la famille : un plateau U6-U7 n'est pas un
-- match, et surtout — mesuré plus bas — on n'y porte pas de numéro. On pose donc les cinq, plus
-- `autre` pour ne jamais forcer quelqu'un à mentir.
--
-- ═══ CE QUE LE NUMÉRO RAPPORTE, PAR TYPE, MESURÉ ═══════════════════════════════════════════════
--
-- Le lecteur de dossards a examiné 3 618 photos réelles. Part des photos où il relève un numéro :
--
--     match ......... 198 / 2 830 ....... 7,0 %
--     tournoi .......... 7 /    31 ..... 22,6 %   (échantillon trop petit, à remesurer)
--     plateau .......... 5 /   654 ...... 0,8 %
--     école de foot .... 0 /    96 ...... 0,0 %
--
-- Un plateau rend 0,8 %. C'est U6 à U9 : on n'y porte pas de numéro officiel. Le numéro n'y sert
-- donc presque à rien — mais « presque » n'est pas « rien », et la décision de retirer la question
-- sur un plateau appartient à Fouka, pas à cette migration. Ici, seuls `entrainement` et `stage`
-- ne demandent pas de numéro : ce sont les deux types où il n'y a pas de rencontre, donc pas de
-- feuille de match, donc aucun numéro à déclarer. Voir `galerie_numero_utile()`.
--
-- ═══ CE QU'ELLE NE FAIT PAS ════════════════════════════════════════════════════════════════════
--
-- ELLE NE REMPLIT AUCUNE GALERIE EXISTANTE. On pourrait deviner le type de 54 des 57 d'après leur
-- titre, et ce serait tentant. Mais une galerie mal devinée en « entraînement » retire la question
-- du numéro à des familles qui en avaient besoin, et personne ne le verrait. La leçon du 27/09 est
-- écrite : une correction de données ne se défend pas toute seule. Les 57 galeries partent donc à
-- NULL — « non précisé » — ce qui vaut exactement le comportement d'aujourd'hui, numéro compris.
-- Le rattrapage est proposé à Fouka, à son initiative, dans le rapport.

begin;

alter table media_albums
  add column if not exists type_evenement text;

alter table media_albums
  drop constraint if exists media_albums_type_evenement_valide;

alter table media_albums
  add constraint media_albums_type_evenement_valide
  check (type_evenement is null or type_evenement in
         ('match','entrainement','plateau','tournoi','stage','autre'));

comment on column media_albums.type_evenement is
  'Ce qui a été photographié : match, entrainement, plateau, tournoi, stage, autre. '
  'NULL = non précisé, et se comporte comme avant la v390 (le numéro de maillot reste demandé). '
  'Ce que ce type change : galerie_numero_utile() et, par elle, le moteur de reconnaissance.';

-- ═══ LA RÈGLE, À UN SEUL ENDROIT ═══════════════════════════════════════════════════════════════
--
-- Trois programmes ont besoin de la même réponse : l'OS (qui l'affiche), l'application de la
-- famille (qui décide de poser la question du numéro) et le moteur de reconnaissance (qui décide
-- de chercher un numéro sur les photos). Trois copies de la règle finiraient par diverger — cinq
-- défauts d'une seule journée venaient exactement de là, et le moteur a été écrit pour ne rejouer
-- AUCUNE règle métier. Elle vit donc ici, et eux l'appellent.
create or replace function public.galerie_numero_utile(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  -- Pas de garde-fou d'accès, et c'est voulu : la réponse est « est-ce qu'on porte un numéro à ce
  -- genre d'événement ». Elle ne nomme personne, ne compte rien, et s'affiche déjà en clair sur la
  -- page publique de la galerie. Une galerie inconnue rend `true` : le comportement d'avant.
  select coalesce(
    (select a.type_evenement is null
            or a.type_evenement not in ('entrainement','stage')
       from media_albums a where a.id = p_album_id),
    true);
$$;

comment on function public.galerie_numero_utile(uuid) is
  'Faut-il demander, et chercher, un numéro de maillot sur cette galerie ? Faux pour un '
  'entraînement et un stage : pas de rencontre, donc pas de feuille de match, donc aucun numéro à '
  'déclarer. La reconnaissance s''y fait par le visage seul. Vrai partout ailleurs, NULL compris.';

-- Le libellé affiché, au même endroit lui aussi : l'OS, Club+ et Connect doivent écrire le même
-- mot, et « Entraînement » accentué, pas « entrainement ».
create or replace function public.galerie_type_libelle(p_type text)
returns text
language sql
immutable
as $$
  select case p_type
           when 'match'        then 'Match'
           when 'entrainement' then 'Entraînement'
           when 'plateau'      then 'Plateau'
           when 'tournoi'      then 'Tournoi'
           when 'stage'        then 'Stage'
           when 'autre'        then 'Autre'
           else 'Non précisé'
         end;
$$;

-- `anon` aussi : une galerie s'ouvre par un lien de partage, sans compte. 23 galeries sur 57 se
-- vendent exactement comme cela, et c'est à ces visiteurs-là qu'il faut dire « entraînement ».
grant execute on function public.galerie_numero_utile(uuid) to anon, authenticated, service_role;
grant execute on function public.galerie_type_libelle(text) to anon, authenticated, service_role;

commit;
