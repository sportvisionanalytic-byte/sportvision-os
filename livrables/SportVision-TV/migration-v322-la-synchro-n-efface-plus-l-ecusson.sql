-- v322 — 28/09/2026 : la synchronisation effaçait chaque matin les écussons de la veille
--
-- DÉFAUT INTRODUIT PAR MA PROPRE v316, HIER SOIR, ET ATTRAPÉ PAR SON PROPRE TEST CE MATIN.
--
-- La v316 branche le résolveur à l'écriture d'un match, avec une précaution qui paraissait sage :
-- à la modification, ne chercher que si l'ADVERSAIRE a changé, « sinon un écusson effacé
-- volontairement serait repoussé au prochain enregistrement ». L'intention était de ne pas défaire
-- une décision humaine.
--
-- Sauf que la synchronisation fédérale de 6 h 10 réécrit chaque match avec
-- `opponent_club_slug = m.outside_club_slug ?? null` : quand la fédération ne fournit pas
-- d'identifiant, elle écrit NULL. L'adversaire, lui, n'a pas changé. Le trigger ne rattrapait donc
-- rien, et le null l'emportait.
--
-- CE QUE ÇA DONNAIT EN VRAI, mesuré ce matin. Hier soir : 21 matchs à venir sans écusson sur 552.
-- Ce matin après la synchro : 31 sur 536. Et parmi eux, des noms qui se résolvent parfaitement —
-- « Amicale Montereau AS U14 2 » → `amicale-montereau-as`, « Evry FC U13 1 » → `evry-fc` — tous
-- portant `updated_at = 28/09 06:10`. Le travail de la nuit était effacé au réveil, et il l'aurait
-- été chaque matin.
--
-- LA CORRECTION TIENT EN UNE DISTINCTION, celle que le reste du code fait déjà : `auth.uid()` est
-- nul quand personne n'est derrière l'écriture — c'est le test qu'utilise `match_retouche_humaine`
-- pour reconnaître « synchronisation fédérale ou tâche serveur ».
--
--   un humain efface l'écusson         c'est une décision, on la respecte
--   une machine écrit null par-dessus  c'est un écrasement, on cherche à nouveau
--
-- ET ON NE CHERCHE PAS POUR RIEN : si ni l'adversaire ni l'écusson n'ont bougé, le trigger ressort
-- immédiatement. Sans cette sortie, chaque synchro relancerait le résolveur sur 536 matchs pour
-- rien. Elle a un second effet, assumé : un nom durablement irrésolu n'est pas réessayé chaque
-- nuit. Le jour où l'annuaire s'enrichit, c'est le `update` final de cette migration qu'on rejoue.
--
-- Idempotent.

create or replace function public.ecusson_adverse_a_l_ecriture()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if tg_op = 'UPDATE' then
    -- Ni l'adversaire ni l'écusson n'ont bougé : il n'y a rien à faire, et surtout rien à chercher.
    if new.opponent is not distinct from old.opponent
       and new.opponent_club_slug is not distinct from old.opponent_club_slug then
      return new;
    end if;

    -- L'écusson est effacé alors que l'adversaire n'a pas changé. Qui l'a effacé décide de la suite :
    -- un humain fait un choix qu'on respecte, une tâche serveur écrase une valeur qu'elle ne
    -- connaissait pas.
    if new.opponent is not distinct from old.opponent
       and new.opponent_club_slug is null
       and old.opponent_club_slug is not null
       and auth.uid() is not null then
      return new;
    end if;
  end if;

  if new.opponent_club_slug is null and new.opponent is not null then
    new.opponent_club_slug := public.resoudre_club_adverse(new.opponent);
  end if;
  return new;
end $f$;

-- Rendre aux matchs ce que la synchro de ce matin leur a pris.
update club_matches m
   set opponent_club_slug = resoudre_club_adverse(m.opponent), updated_at = now()
 where m.opponent_club_slug is null
   and resoudre_club_adverse(m.opponent) is not null;
