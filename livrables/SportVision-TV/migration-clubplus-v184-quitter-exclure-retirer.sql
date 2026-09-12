-- v184 : on peut enfin sortir (12/09/2026).
--
-- Trois portes ne s'ouvraient que dans un sens, toutes trouvées par l'audit du cloisonnement.
--
--   1. UN GROUPE, on y entre, on n'en sort pas. user_group_members n'a ni policy de modification
--      ni policy de suppression : ni le membre ne peut quitter, ni le créateur ne peut exclure.
--      Une personne ajoutée par erreur, ou partie du club, reste dans le groupe pour toujours, et
--      voit passer les cotisations.
--   2. UN LIEN PARENT CONFIRMÉ est irrévocable côté club. decider_lien_parent() sort sans rien
--      faire sur un lien déjà confirmé, et aucune policy ne donne la main au club ni au joueur
--      majeur. Seul le parent peut se retirer lui-même. Un lien confirmé par erreur, ou une
--      situation familiale qui change, n'avaient aucune issue.
--   3. UN JOUEUR NE SE RETIRE PAS D'UNE ÉQUIPE. Aucune fonction, aucun écran : l'effectif affiche
--      « Retiré » sur une ligne team_memberships toujours active, et toutes les fonctions
--      continuent de compter le joueur dans l'équipe.
--
-- Chaque geste est réservé à qui de droit, et laisse une trace lisible.
-- Test : tests/quitter-exclure-retirer.test.sql

-- ── 1. Quitter un groupe, ou en exclure quelqu'un ──
create or replace function public.quitter_groupe(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_createur uuid; v_reste integer;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;
  select created_by into v_createur from user_groups where id = p_group_id;
  if v_createur is null then
    raise exception 'Ce groupe n''existe plus.' using errcode = '22023';
  end if;
  if v_createur = auth.uid() then
    raise exception 'Vous avez créé ce groupe : vous ne pouvez pas le quitter, mais vous pouvez en retirer les membres.'
      using errcode = '42501';
  end if;
  delete from user_group_members where group_id = p_group_id and user_id = auth.uid();
  get diagnostics v_reste = row_count;
  return jsonb_build_object('sorti', v_reste > 0);
end $$;
revoke execute on function public.quitter_groupe(uuid) from public, anon;
grant execute on function public.quitter_groupe(uuid) to authenticated;

create or replace function public.exclure_du_groupe(p_group_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_createur uuid; v_n integer;
begin
  select created_by into v_createur from user_groups where id = p_group_id;
  if v_createur is null then
    raise exception 'Ce groupe n''existe plus.' using errcode = '22023';
  end if;
  if v_createur is distinct from auth.uid() then
    raise exception 'Seule la personne qui a créé ce groupe peut en retirer un membre.' using errcode = '42501';
  end if;
  if p_user_id = v_createur then
    raise exception 'Vous ne pouvez pas vous retirer du groupe que vous avez créé.' using errcode = '42501';
  end if;
  delete from user_group_members where group_id = p_group_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('retires', v_n);
end $$;
revoke execute on function public.exclure_du_groupe(uuid, uuid) from public, anon;
grant execute on function public.exclure_du_groupe(uuid, uuid) to authenticated;

-- ── 2. Retirer un lien parent confirmé ──
-- Qui décide : le club (celui qui l'opère ou l'administre), l'éducateur de l'équipe de l'enfant,
-- le joueur majeur pour lui-même, et le parent concerné. C'est la même liste que pour confirmer,
-- plus le parent lui-même : on ne retient personne dans un lien familial.
create or replace function public.retirer_lien_parent(p_relation_id uuid, p_motif text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rel parent_player_relationships; v_club uuid;
begin
  select * into v_rel from parent_player_relationships where id = p_relation_id;
  if not found then
    raise exception 'Ce rattachement n''existe plus.' using errcode = '22023';
  end if;
  select club_id into v_club from player_profiles where id = v_rel.player_id;

  if not (
    (v_club is not null and (peut_operer_club(v_club) or is_club_admin(v_club)))
    or exists (select 1 from team_memberships tm
                where tm.player_id = v_rel.player_id and tm.statut = 'active' and is_team_educateur(tm.team_id))
    or (is_own_player(v_rel.player_id) and joueur_majeur(v_rel.player_id))
    or exists (select 1 from parent_profiles pf where pf.id = v_rel.parent_id and pf.user_id = auth.uid())
  ) then
    raise exception 'Vous n''êtes pas autorisé à retirer ce rattachement.' using errcode = '42501';
  end if;

  update parent_player_relationships
     set statut = 'retire', confirmed_at = null
   where id = p_relation_id and statut <> 'retire';
  return jsonb_build_object('retire', true, 'motif', nullif(btrim(coalesce(p_motif, '')), ''));
end $$;
revoke execute on function public.retirer_lien_parent(uuid, text) from public, anon;
grant execute on function public.retirer_lien_parent(uuid, text) to authenticated;

-- ── 3. Retirer un joueur d'une équipe ──
create or replace function public.retirer_joueur_equipe(p_player_id uuid, p_team_id uuid, p_motif text default 'quittee_equipe')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_club uuid; v_n integer;
begin
  select club_id into v_club from club_teams where id = p_team_id;
  if v_club is null then
    raise exception 'Cette équipe n''existe plus.' using errcode = '22023';
  end if;
  if not (peut_operer_club(v_club) or is_club_admin(v_club) or is_team_educateur(p_team_id)) then
    raise exception 'Seul un dirigeant du club, son opérateur SportVision ou l''éducateur de cette équipe peut retirer un joueur.'
      using errcode = '42501';
  end if;
  update team_memberships
     set statut = case when p_motif = 'quittee_club' then 'quittee_club' else 'quittee_equipe' end
   where player_id = p_player_id and team_id = p_team_id and statut = 'active';
  get diagnostics v_n = row_count;
  return jsonb_build_object('retires', v_n);
end $$;
revoke execute on function public.retirer_joueur_equipe(uuid, uuid, text) from public, anon;
grant execute on function public.retirer_joueur_equipe(uuid, uuid, text) to authenticated;
