-- v273 — 25/09/2026 : les matchs de U17 ne sont pas ceux de U16A (RCP Fontainebleau)
--
-- Constat de Fouka : « tu as mis les U16A, non, U17, alors qu'il y a les U17, c'est pas pareil ».
-- SportCorico nomme l'equipe « U16 1 » tout en publiant la competition « U17 » : la synchro
-- federale rattachait donc les deux championnats a la meme equipe SportVision. U16A portait
-- 30 matchs, U17 zero.
--
-- On ne deplace QUE les lignes dont la competition est exactement « U17 ». L'amical du 02/09
-- (« MATCHS AMICAUX U17 N & U16 R ») nomme les deux categories a la fois : le code ne peut pas
-- trancher, il reste sur U16A en attendant la decision de Fouka.
--
-- Le verrou `team` est indispensable : federation-sync-matchs n'ecrit jamais `team_id` (le
-- rattachement humain tient), mais son patch contient `team`. Au premier match deplace ou
-- rehorodate par la federation, le libelle serait redevenu « U16 1 » face a un team_id U17 —
-- deux verites contradictoires sur la meme ligne. Le mecanisme champs_verrouilles de la v237
-- existe exactement pour ca.
--
-- Idempotent : rejouable sans effet.

do $$
declare
  v_club uuid;
  v_u16  uuid;
  v_u17  uuid;
begin
  select id into v_club from clubs where nom = 'RCP Fontainebleau';
  if v_club is null then
    raise notice 'RCP Fontainebleau absent, rien a faire.';
    return;
  end if;

  select id into v_u16 from club_teams where club_id = v_club and name = 'U16A';
  select id into v_u17 from club_teams where club_id = v_club and name = 'U17';
  if v_u16 is null or v_u17 is null then
    raise notice 'U16A ou U17 absente, rien a faire.';
    return;
  end if;

  update club_matches
     set team_id = v_u17, team = 'U17', updated_at = now()
   where team_id = v_u16
     and btrim(competition) = 'U17';

  update club_matches
     set champs_verrouilles = array(select distinct unnest(coalesce(champs_verrouilles, '{}') || array['team'])),
         updated_at = now()
   where team_id = v_u17
     and not coalesce(champs_verrouilles, '{}') @> array['team'];
end $$;
