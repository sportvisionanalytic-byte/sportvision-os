-- v237 — Une correction faite à la main ne se fait plus écraser par la fédération.
--
-- DEMANDE DE FOUKA, 15/09/2026 : « arrange le calendrier de Villemomble, il y a des erreurs sur
-- Club+ » — capture du planning officiel du club à l'appui, samedi 19 et dimanche 20 septembre.
--
-- CE QUE LA COMPARAISON MONTRE. Les matchs de Club+ viennent de SportCorico (580 des 682 matchs du
-- club). Le planning que le club diffuse à ses éducateurs, lui, porte les ajustements RÉELS :
-- un match déplacé d'un stade à l'autre, un horaire décalé, un adversaire d'amical changé. Les
-- deux ne disent pas la même chose, et c'est le club qui a raison sur ce qu'il organise.
--
-- POURQUOI LA CORRECTION SEULE NE SUFFIT PAS. federation-sync-matchs réécrit `kickoff_time` et
-- `lieu` à chaque passage, sur comparaison avec la source. Corriger un lieu à la main aurait tenu
-- jusqu'à la synchro suivante — et Fouka aurait recorrigé, en boucle, sans comprendre pourquoi.
--
-- CE QUE FAIT CETTE MIGRATION : chaque match retient la LISTE DES CHAMPS corrigés à la main. La
-- synchro continue de tout mettre à jour, sauf ces champs-là. Le reste du match (score, statut,
-- adversaire officiel) continue de suivre la fédération.
--
-- Ce n'est pas « ignorer la fédération » : c'est se souvenir qu'un humain a tranché. Un champ se
-- déverrouille en le vidant, et la fédération reprend la main dessus.
--
-- Idempotent.

alter table club_matches add column if not exists champs_verrouilles text[] not null default '{}';

comment on column club_matches.champs_verrouilles is
  'Champs corrigés à la main et que la synchronisation fédérale ne doit plus écraser (v237) : « kickoff_time », « lieu »… Vider la liste rend la main à la fédération.';

-- Poser ou lever le verrou, avec la trace de qui a tranché.
create or replace function match_verrouiller_champ(p_match_id uuid, p_champ text, p_verrouille boolean default true)
returns club_matches language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_row club_matches;
begin
  select * into v_row from club_matches where id = p_match_id;
  if v_row.id is null then raise exception 'Match introuvable.' using errcode = 'P0002'; end if;
  if not peut_travailler_club(v_row.club_id) then
    raise exception 'Vous n''êtes pas autorisé à modifier les matchs de ce club.' using errcode = '42501';
  end if;
  if p_champ not in ('kickoff_time','lieu','opponent','competition','team','is_home','match_date') then
    raise exception 'Champ « % » non verrouillable.', p_champ;
  end if;

  update club_matches
     set champs_verrouilles = case
           when p_verrouille then (select array(select distinct unnest(champs_verrouilles || p_champ)))
           else array_remove(champs_verrouilles, p_champ) end,
         updated_at = now()
   where id = p_match_id
  returning * into v_row;
  return v_row;
end $$;

-- Un humain qui modifie un match depuis un écran pose le verrou sans y penser : c'est le geste
-- qui compte, pas une case à cocher de plus. La synchro, elle, écrit en service_role et n'est
-- donc jamais prise pour un humain.
create or replace function match_retouche_humaine()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_champs text[] := new.champs_verrouilles;
begin
  if auth.uid() is null then
    return new;  -- synchronisation fédérale ou tâche serveur : aucun verrou posé
  end if;
  if new.kickoff_time is distinct from old.kickoff_time then v_champs := v_champs || 'kickoff_time'; end if;
  if new.lieu is distinct from old.lieu then v_champs := v_champs || 'lieu'; end if;
  if new.opponent is distinct from old.opponent then v_champs := v_champs || 'opponent'; end if;
  if new.match_date is distinct from old.match_date then v_champs := v_champs || 'match_date'; end if;
  new.champs_verrouilles := (select array(select distinct unnest(v_champs)));
  return new;
end $$;

drop trigger if exists trg_match_retouche_humaine on club_matches;
create trigger trg_match_retouche_humaine
  before update on club_matches
  for each row execute function match_retouche_humaine();
