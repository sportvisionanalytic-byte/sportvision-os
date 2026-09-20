-- v238 — Le verrou de la v237 empêchait de modifier un match. Correction.
--
-- TROUVÉ PAR LA BATTERIE, le 21/09/2026, à la veille d'une mise en service massive.
--
-- LE DÉFAUT, ET IL EST À MOI. La v237 pose un verrou sur les champs corrigés à la main pour que
-- la synchronisation fédérale ne les écrase plus. Le trigger construisait la liste ainsi :
--
--     v_champs := v_champs || 'opponent';
--
-- `v_champs` est un text[], et `'opponent'` un littéral SANS TYPE. PostgreSQL ne le traite alors
-- pas comme un élément à ajouter : il tente de le lire comme un TABLEAU, et refuse —
-- « malformed array literal: "opponent" ».
--
-- Conséquence : depuis hier, TOUTE modification d'un match par un humain échouait. Reprogrammer
-- une rencontre, corriger un adversaire, déplacer un match : refusé, avec un message que
-- personne ne pouvait comprendre. Un verrou censé protéger les corrections interdisait de
-- corriger. C'est exactement ce que Fouka voulait éviter avant d'ouvrir les accès à ses clubs.
--
-- Chaque valeur ajoutée est désormais typée. La règle ne change pas d'un iota.
--
-- Idempotent.

create or replace function match_retouche_humaine()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_champs text[] := coalesce(new.champs_verrouilles, '{}'::text[]);
begin
  if auth.uid() is null then
    return new;  -- synchronisation fédérale ou tâche serveur : aucun verrou posé
  end if;
  -- Le `::text` n'est pas une précaution de style : sans lui, Postgres lit la chaîne comme un
  -- littéral de tableau et refuse la mise à jour entière.
  if new.kickoff_time is distinct from old.kickoff_time then v_champs := v_champs || 'kickoff_time'::text; end if;
  if new.lieu is distinct from old.lieu then v_champs := v_champs || 'lieu'::text; end if;
  if new.opponent is distinct from old.opponent then v_champs := v_champs || 'opponent'::text; end if;
  if new.match_date is distinct from old.match_date then v_champs := v_champs || 'match_date'::text; end if;
  new.champs_verrouilles := (select array(select distinct unnest(v_champs)));
  return new;
end $$;
