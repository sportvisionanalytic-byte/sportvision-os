-- Le nom d'équipe affiché sur un match est celui que le club emploie, jamais celui de la source.
--
-- Le défaut attrapé ici (v292) ne vidait aucun écran : il rendait le calendrier illisible. Trois
-- équipes de Villemomble s'affichaient toutes « Seniors 1 », et aucune des équipes cherchées par
-- un coach ne portait son nom. Un calendrier illisible se raconte comme un calendrier vide.
--
-- Le verrou compte autant que la correction : sans `team` dans champs_verrouilles, la synchro
-- fédérale de 6 h remet son propre libellé et le défaut revient pendant la nuit.

do $$
declare v_ecarts int; v_sans_verrou int; v_libelles_perdus int;
begin
  select count(*) into v_ecarts
    from club_matches m join club_teams t on t.id = m.team_id
   where t.name <> m.team;
  if v_ecarts > 0 then
    raise exception 'ROUGE : % matchs affichent un nom d''equipe que leur club ne connait pas', v_ecarts;
  end if;

  -- Un match rattache a une equipe ne laisse plus la federation ecrire son nom (v293) : la
  -- synchro reecrit `team` a chaque mise a jour, et le renommage cote club est deja propage par
  -- trg_propager_renommage_equipe. Sans ce verrou, la correction ne tenait qu'une nuit.
  select count(*) into v_sans_verrou
    from club_matches m
   where m.team_id is not null
     and not coalesce(m.champs_verrouilles,'{}') @> array['team'];
  if v_sans_verrou > 0 then
    raise exception 'ROUGE : % matchs rattaches a une equipe ne verrouillent pas `team`, la synchro les reecrira', v_sans_verrou;
  end if;

  -- Le libelle de la source n'est pas perdu : il vit dans les correspondances.
  select count(*) into v_libelles_perdus
    from club_teams t join club_matches m on m.team_id = t.id
   where m.provider is not null
     and not exists (select 1 from club_team_source_mappings x
                      where x.club_id = m.club_id and x.team_id = t.id);
  raise notice 'VERT : aucun ecart de nom, % rattachements sans correspondance de source (informatif)', v_libelles_perdus;
end $$;

-- ── ET POUR LES MATCHS QUI N'EXISTENT PAS ENCORE (v300) ────────────────────────────────────────
--
-- Les deux verifications ci-dessus ne regardent que l'existant. Elles etaient vertes le 26/09 au
-- soir, et rouges le 27 au matin : la synchro federale de 6 h 10 avait cree quatre matchs, qui
-- n'avaient pas le verrou. Une correction de DONNEES ne se defend pas toute seule.
--
-- On simule donc ici ce que fait federation-sync-matchs : ecrire le libelle federal, sans auth.uid().
-- Tout est annule.
do $$
declare v_club uuid; v_nom_du_club text; v_affiche text; v_verrou boolean; e text[] := '{}';
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_club from clubs where nom = 'SF Villemomble';
  if v_club is null then
    raise notice 'IGNORE : pas de club temoin en base';
    return;
  end if;

  insert into club_matches (club_id, team, opponent, match_date, kickoff_time, competition, is_home,
                            provider, external_event_id, saison_id, status, sport_status)
  select v_club, 'U14 2', 'ZZ Adversaire Verrou', current_date + 14, '15:00', 'Championnat', true,
         'SPORTCORICO', 'zz-verrou-v300', s.id, 'a_venir', 'scheduled'
    from saisons s where current_date between s.date_debut and s.date_fin;

  select t.name, m.team, coalesce(m.champs_verrouilles,'{}') @> array['team']
    into v_nom_du_club, v_affiche, v_verrou
    from club_matches m join club_teams t on t.id = m.team_id
   where m.external_event_id = 'zz-verrou-v300';

  if v_affiche is null then
    e := e || 'le match cree n a pas ete rattache a une equipe, le cas n est pas mesure'::text;
  else
    if v_affiche <> v_nom_du_club then
      e := e || format('un match CREE par la synchro affiche « %s » au lieu de « %s »', v_affiche, v_nom_du_club);
    end if;
    if not v_verrou then
      e := e || 'un match cree par la synchro n a pas le verrou sur `team` : il redeviendra federal demain'::text;
    end if;
    -- Et le passage suivant de la synchro ne doit plus rien rabaisser.
    update club_matches set team = 'U14 2' where external_event_id = 'zz-verrou-v300';
    select m.team into v_affiche from club_matches m where m.external_event_id = 'zz-verrou-v300';
    if v_affiche <> v_nom_du_club then
      e := e || format('apres un second passage de la synchro, le match affiche « %s »', v_affiche);
    end if;
  end if;

  delete from club_matches where external_event_id = 'zz-verrou-v300';
  if cardinality(e) > 0 then
    raise exception 'ROUGE : %', array_to_string(e, ' | ');
  end if;
  raise notice 'VERT : un match cree par la synchro porte deja le nom du club, et le garde';
end $$;
