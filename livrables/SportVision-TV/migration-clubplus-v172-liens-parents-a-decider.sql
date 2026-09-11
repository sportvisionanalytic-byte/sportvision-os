-- v172 : les demandes de rattachement parent deviennent visibles, donc décidables (12/09/2026).
--
-- decider_lien_parent() existe depuis le durcissement du 10/09 : un parent qui se rattache à un
-- enfant reste « en attente de confirmation » jusqu'à ce que le club tranche. Mais AUCUN écran ne
-- l'appelait, et aucune liste ne montrait ces demandes. Une famille pouvait donc attendre
-- indéfiniment, pendant que Connect lui promettait « vous retrouverez son statut dans Mes
-- sportifs ». C'était une impasse.
--
-- Cette fonction est la liste qui manquait. Elle rend ce qu'il faut pour décider — qui demande,
-- pour quel enfant, dans quelle équipe, depuis quand — à ceux-là seuls qui ont le droit de
-- décider : l'Owner Club+, le Président, le CM SportVision qui opère le club, et l'éducateur de
-- l'équipe de l'enfant, borné à ses équipes. Elle passe par une fonction plutôt que par la table,
-- parce que le nom du parent n'est lisible que par les dirigeants (parent_visible_to_club_admin) :
-- un coach doit voir qui demande sans pour autant obtenir l'annuaire des parents du club.
-- Test : tests/liens-parents-a-decider.test.sql

create or replace function public.liens_parents_a_decider(p_club_id uuid)
returns table (relation_id uuid, player_id uuid, enfant text, equipe text,
               parent text, parent_email text, relation text, demande_le timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select ppr.id, p.id,
         btrim(coalesce(p.prenom, '') || ' ' || coalesce(p.nom, '')),
         ct.name,
         btrim(coalesce(pf.prenom, '') || ' ' || coalesce(pf.nom, '')),
         u.email,
         ppr.relation_type,
         ppr.created_at
    from parent_player_relationships ppr
    join player_profiles p on p.id = ppr.player_id
    join parent_profiles pf on pf.id = ppr.parent_id
    left join auth.users u on u.id = pf.user_id
    left join team_memberships tm on tm.player_id = p.id and tm.statut = 'active'
    left join club_teams ct on ct.id = tm.team_id
   where p.club_id = p_club_id
     and ppr.statut = 'en_attente_confirmation'
     and (peut_operer_club(p_club_id) or is_club_admin(p_club_id)
          or (tm.team_id is not null and is_team_educateur(tm.team_id)))
   order by ppr.created_at;
$$;
revoke execute on function public.liens_parents_a_decider(uuid) from public, anon;
grant execute on function public.liens_parents_a_decider(uuid) to authenticated;
