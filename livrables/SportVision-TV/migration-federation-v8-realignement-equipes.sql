-- Realignement des equipes de SF Villemomble sur les engagements officiels 2026-2027.
--
-- ── Le constat ──
-- Les equipes du club portaient les noms de leur championnat de la SAISON PASSEE. La fiche
-- federale donne les engagements reels de cette saison :
--
--   equipe 1 -> Seniors R2   (inchange)
--   equipe 2 -> Seniors D1   (elle s'appelait « Séniors D2 » en base)
--   equipe 3 -> Seniors D2   (elle s'appelait « Séniors D3 »)
--   U16 n°1  -> U16 D1       (elle s'appelait « U16 R3 »)
--   U16 n°2  -> U16 D3       (inchange)
--
-- Les deux equipes seniors ont monte d'un cran, l'equipe U16 est passee du regional au
-- departemental. Confirme par Fouka le 09/09/2026.
--
-- ── Pourquoi ce n'est pas qu'un renommage ──
-- Renommer seul aurait CASSE des rattachements corrects. L'equipe qui s'appelle « Séniors D2 »
-- aujourd'hui devient « Séniors D1 » : tous les matchs et creneaux rattaches a elle parce que le
-- planning disait « Séniors D2 » se retrouveraient sur la mauvaise equipe. Il faut donc renommer
-- ET redistribuer, dans la meme transaction.
--
-- Les identifiants sont figes en tete : apres le premier renommage, chercher une equipe par son
-- nom ne rendrait plus la bonne.
--
-- ── Ce qui reste volontairement non rattache ──
--   U14 2 et U14 3   deux equipes federales en U14 D4 (poules E et C), une seule U14 D4 en base.
--                    Fouka : « la 3e jsp met pas pour le moment garde une seul ».
--   U18 FEMININES 1 et 2   deux equipes federales, une seule U18 F en base.

begin;

do $$
declare
  v_club uuid := 'f0d3bafa-3004-4831-bd85-249aa9af5c54';
  v_seniors2 uuid;   -- « Séniors D2 » aujourd'hui, « Séniors D1 » apres
  v_seniors3 uuid;   -- « Séniors D3 » aujourd'hui, « Séniors D2 » apres
  v_u16_1    uuid;   -- « U16 R3 » aujourd'hui, « U16 D1 » apres
  v_u14_1    uuid;
  v_u15f     uuid;
begin
  select id into v_seniors2 from club_teams where club_id = v_club and name = 'Séniors D2';
  select id into v_seniors3 from club_teams where club_id = v_club and name = 'Séniors D3';
  select id into v_u16_1    from club_teams where club_id = v_club and name = 'U16 R3';
  select id into v_u14_1    from club_teams where club_id = v_club and name = 'U14 D1';
  select id into v_u15f     from club_teams where club_id = v_club and name = 'U15 F';

  -- Un nom introuvable signifie que la migration a deja tourne, ou que la base a change depuis.
  -- On s'arrete plutot que de renommer a moitie.
  if v_seniors2 is null or v_seniors3 is null or v_u16_1 is null then
    raise exception 'Realignement impossible : une des equipes attendues est introuvable (deja realigne ?).';
  end if;

  -- 1. Les renommages. Aucune contrainte d'unicite sur le nom : l'ordre n'a pas d'importance,
  --    mais on renomme d'abord celle qui libere le nom convoite, par hygiene.
  update club_teams set name = 'Séniors D1' where id = v_seniors2;
  update club_teams set name = 'Séniors D2' where id = v_seniors3;
  update club_teams set name = 'U16 D1'     where id = v_u16_1;

  -- 2. Les creneaux d'entrainement mal attribues, consequence du renommage.
  --    Le planning municipal parle en championnats : « Séniors D1 » y designe l'equipe 2,
  --    « Séniors D2 » l'equipe 3. Deux creneaux etaient donc a l'envers.
  --    Le creneau du mardi 20h30 porte les DEUX equipes et reste correct tel quel.
  update club_team_training_slots
     set team_id = v_seniors3
   where team_id = v_seniors2 and notes like '%: Séniors D2 (%';       -- jeudi 20h30

  update club_team_training_slots
     set team_id = v_seniors2
   where team_id = v_seniors3 and notes like '%: Séniors D1 (%';       -- vendredi 20h30

  -- 3. Les matchs federaux. `team` porte le libelle de la federation, c'est lui qui fait foi.
  update club_matches set team_id = v_seniors2
   where club_id = v_club and provider = 'SPORTCORICO' and team = 'SENIORS 2';
  update club_matches set team_id = v_seniors3
   where club_id = v_club and provider = 'SPORTCORICO' and team = 'SENIORS 3';
  update club_matches set team_id = v_u16_1
   where club_id = v_club and provider = 'SPORTCORICO' and team = 'U16 1';
  -- U14 1 joue le championnat U15 D1 en surclassement, plus U14 D2 : c'est bien « U14 D1 » en
  -- base, etabli par migration-federation-v7.
  update club_matches set team_id = v_u14_1
   where club_id = v_club and provider = 'SPORTCORICO' and team = 'U14 1';
  -- Une seule equipe U15 feminine engagee, une seule en base : la correspondance est univoque.
  update club_matches set team_id = v_u15f
   where club_id = v_club and provider = 'SPORTCORICO' and team = 'U15 FÉMININES 2';

  -- 4. Les matchs du fichier Excel du club, qui utilisait deja les libelles de cette saison.
  update club_matches set team_id = v_seniors2
   where club_id = v_club and provider = 'OTHER' and team ilike 'S%niors D1';
  update club_matches set team_id = v_seniors3
   where club_id = v_club and provider = 'OTHER' and team ilike 'S%niors D2';
  update club_matches set team_id = v_u16_1
   where club_id = v_club and provider = 'OTHER' and team ilike 'U16%D1';

  -- 5. Les rattachements de source, pour que la synchro quotidienne s'appuie dessus.
  update club_team_source_mappings
     set team_id = case external_team_name
                     when 'SENIORS 2' then v_seniors2
                     when 'SENIORS 3' then v_seniors3
                     when 'U16 1' then v_u16_1
                     when 'U14 1' then v_u14_1
                     when 'U15 FÉMININES 2' then v_u15f
                     else team_id
                   end,
         status = 'confirmed',
         confidence = 1.00,
         confirmed_at = now()
   where club_id = v_club
     and provider = 'SPORTCORICO'
     and external_team_name in ('SENIORS 2', 'SENIORS 3', 'U16 1', 'U14 1', 'U15 FÉMININES 2');
end $$;

commit;
