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
