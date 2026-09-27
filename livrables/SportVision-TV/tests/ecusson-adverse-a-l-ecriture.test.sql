-- L'écusson de l'adversaire doit se poser SEUL à l'écriture d'un match.
--
-- Défaut mesuré le 28/09/2026 : `resoudre_club_adverse` n'était appelée par rien. Un match créé
-- sans slug fourni par la fédération restait sans écusson pour toujours — 96 matchs dans ce cas,
-- dont 22 à venir. Ce test échoue si le branchement disparaît, et il échoue aussi si le résolveur
-- se met à rattacher au hasard un nom qu'il ne connaît pas.
--
-- Tout se joue dans une transaction annulée par le `raise` final : aucune trace laissée.

do $$
declare
  v_club uuid; v_id uuid; v_slug text; v_rapport text := '';
  v_total int; v_sans int;
begin
  select id into v_club from clubs order by created_at limit 1;
  if v_club is null then raise exception 'ROUGE : aucun club en base, le test ne peut rien mesurer'; end if;

  -- 1. Un adversaire que l'annuaire connaît, aucun slug fourni : le trigger doit le retrouver.
  insert into club_matches (club_id, team, opponent, match_date, is_home)
  values (v_club, 'ZZ Test', 'Val D''europe FC U16 1', current_date + 30, true)
  returning id, opponent_club_slug into v_id, v_slug;
  if v_slug is distinct from 'val-d-europe-football-club' then
    v_rapport := v_rapport || E'\n  ROUGE  creation : « Val D''europe FC U16 1 » -> ' || coalesce(v_slug,'NULL');
  else
    v_rapport := v_rapport || E'\n  vert   creation : l''ecusson est pose seul, ' || v_slug;
  end if;

  -- 2. Un slug déjà posé n'est jamais écrasé par un enregistrement ultérieur.
  update club_matches set opponent_club_slug = 'zz-slug-pose-a-la-main' where id = v_id;
  update club_matches set match_date = current_date + 31 where id = v_id;
  select opponent_club_slug into v_slug from club_matches where id = v_id;
  if v_slug is distinct from 'zz-slug-pose-a-la-main' then
    v_rapport := v_rapport || E'\n  ROUGE  un ecusson pose a la main a ete ecrase : ' || coalesce(v_slug,'NULL');
  else
    v_rapport := v_rapport || E'\n  vert   un ecusson pose a la main n''est pas ecrase';
  end if;

  -- 3. Un écusson effacé volontairement ne repousse pas derrière.
  update club_matches set opponent_club_slug = null where id = v_id;
  update club_matches set match_date = current_date + 32 where id = v_id;
  select opponent_club_slug into v_slug from club_matches where id = v_id;
  if v_slug is not null then
    v_rapport := v_rapport || E'\n  ROUGE  un ecusson efface volontairement est revenu : ' || v_slug;
  else
    v_rapport := v_rapport || E'\n  vert   un ecusson efface volontairement ne revient pas';
  end if;

  -- 4. Changer d'adversaire relance la recherche.
  update club_matches set opponent = 'Red Star FC U14 2' where id = v_id;
  select opponent_club_slug into v_slug from club_matches where id = v_id;
  if v_slug is distinct from 'red-star-fc' then
    v_rapport := v_rapport || E'\n  ROUGE  changer d''adversaire ne relance pas la recherche : ' || coalesce(v_slug,'NULL');
  else
    v_rapport := v_rapport || E'\n  vert   changer d''adversaire relance la recherche, ' || v_slug;
  end if;

  -- 5. Un nom que l'annuaire ne connaît pas ne doit surtout pas être rattaché au hasard : un
  --    mauvais écusson est pire que pas d'écusson, il affirme quelque chose de faux.
  insert into club_matches (club_id, team, opponent, match_date, is_home)
  values (v_club, 'ZZ Test', 'Zzz Club Qui N Existe Pas Ailleurs', current_date + 33, true)
  returning opponent_club_slug into v_slug;
  if v_slug is not null then
    v_rapport := v_rapport || E'\n  ROUGE  un nom inconnu a ete rattache a « ' || v_slug || ' »';
  else
    v_rapport := v_rapport || E'\n  vert   un nom inconnu reste sans ecusson';
  end if;

  -- 6. Combien de matchs à venir restent sans écusson. Au-delà de 5 %, il y a un défaut à
  --    regarder : soit l'annuaire, soit le résolveur.
  select count(*), count(*) filter (where opponent_club_slug is null)
    into v_total, v_sans
    from club_matches where match_date >= current_date and opponent is not null;
  if v_total > 50 and v_sans::numeric / v_total > 0.05 then
    v_rapport := v_rapport || format(E'\n  ROUGE  %s matchs a venir sur %s sans ecusson (plus de 5 %%)', v_sans, v_total);
  else
    v_rapport := v_rapport || format(E'\n  vert   %s matchs a venir sur %s sans ecusson', v_sans, v_total);
  end if;

  raise exception E'%\n', v_rapport using errcode = 'P0001';
end $$;
