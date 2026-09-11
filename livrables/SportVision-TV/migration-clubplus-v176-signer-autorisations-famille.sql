-- v176 : la famille peut enfin signer les autorisations (12/09/2026).
--
-- Tout l'accès aux médias d'un club dépend du droit à l'image : media_has_unauthorized_tagged_player
-- masque un média dès qu'un joueur identifié dessus n'a pas d'autorisation « droit_image » valide.
-- Or PERSONNE ne pouvait en signer une : parental_authorizations n'a que des policies de LECTURE,
-- l'espace Famille a été retiré de Club+ le 19/08, et Connect n'a jamais eu l'écran. Douze types
-- d'autorisation existent en base, zéro ligne signée. Le circuit était donc fermé des deux bouts.
--
-- Trois fonctions, et rien d'autre : lire ce qu'il y a à signer, signer, retirer. Écrire dans la
-- table reste impossible autrement : ce sont ces fonctions qui posent l'auteur, la date, la
-- version du texte acceptée et la méthode, jamais l'écran.
--
-- Qui signe : le titulaire de l'autorité parentale confirmé, ou le joueur majeur pour lui-même.
-- Un mineur ne signe pas ses propres autorisations, même s'il a un compte (même règle que v163).
-- Test : tests/signer-autorisations-famille.test.sql

create or replace function public.mes_autorisations(p_player_id uuid)
returns table (code text, label text, obligatoire boolean, texte text, version_id uuid,
               statut text, date_signature timestamptz, date_expiration date)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.code, t.label, t.obligatoire, v.texte, v.id,
         coalesce(pa.statut, 'non_transmise'), pa.date_signature, pa.date_expiration
    from authorization_types t
    left join lateral (
      select av.* from authorization_versions av
       where av.authorization_type_id = t.id and av.actif
         and (av.club_id is null or av.club_id = (select club_id from player_profiles where id = p_player_id))
       order by av.club_id nulls last, av.created_at desc
       limit 1
    ) v on true
    left join parental_authorizations pa
      on pa.player_id = p_player_id and pa.authorization_type_id = t.id
     and (pa.version_id is not distinct from v.id or v.id is null)
   where is_confirmed_parent_of(p_player_id)
      or (is_own_player(p_player_id) and joueur_majeur(p_player_id))
   order by t.obligatoire desc, t.label;
$$;
revoke execute on function public.mes_autorisations(uuid) from public, anon;
grant execute on function public.mes_autorisations(uuid) to authenticated;

create or replace function public.signer_autorisation(p_player_id uuid, p_code text, p_accepte boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_type uuid; v_version uuid; v_parent uuid; v_statut text; v_id uuid; v_club uuid;
begin
  if not (is_confirmed_parent_of(p_player_id)
          or (is_own_player(p_player_id) and joueur_majeur(p_player_id))) then
    raise exception 'Seul le titulaire de l''autorité parentale, ou le joueur majeur, peut signer.' using errcode = '42501';
  end if;
  select id into v_type from authorization_types where code = p_code;
  if v_type is null then
    raise exception 'Autorisation inconnue : %.', p_code using errcode = '22023';
  end if;
  select club_id into v_club from player_profiles where id = p_player_id;
  select id into v_version from authorization_versions
   where authorization_type_id = v_type and actif and (club_id is null or club_id = v_club)
   order by club_id nulls last, created_at desc limit 1;
  select id into v_parent from parent_profiles where user_id = auth.uid();

  v_statut := case when p_accepte then 'valide' else 'refusee' end;

  insert into parental_authorizations (player_id, parent_id, authorization_type_id, version_id,
                                       statut, methode, date_signature, date_debut)
  values (p_player_id, v_parent, v_type, v_version, v_statut, 'signature_numerique', now(), current_date)
  on conflict (player_id, authorization_type_id, version_id) do update
     set statut = excluded.statut,
         parent_id = coalesce(excluded.parent_id, parental_authorizations.parent_id),
         methode = 'signature_numerique',
         date_signature = now(),
         date_debut = current_date,
         retrait_at = null, retrait_motif = null,
         updated_at = now()
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'statut', v_statut, 'code', p_code);
end $$;
revoke execute on function public.signer_autorisation(uuid, text, boolean) from public, anon;
grant execute on function public.signer_autorisation(uuid, text, boolean) to authenticated;

-- Retirer une autorisation : c'est un droit, il s'exerce sans justification et sans délai.
create or replace function public.retirer_autorisation(p_player_id uuid, p_code text, p_motif text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if not (is_confirmed_parent_of(p_player_id)
          or (is_own_player(p_player_id) and joueur_majeur(p_player_id))) then
    raise exception 'Seul le titulaire de l''autorité parentale, ou le joueur majeur, peut retirer cette autorisation.' using errcode = '42501';
  end if;
  update parental_authorizations pa
     set statut = 'retiree', retrait_at = now(), retrait_motif = nullif(btrim(coalesce(p_motif, '')), ''), updated_at = now()
    from authorization_types t
   where t.id = pa.authorization_type_id and t.code = p_code
     and pa.player_id = p_player_id and pa.statut <> 'retiree';
  get diagnostics v_n = row_count;
  return jsonb_build_object('retirees', v_n, 'code', p_code);
end $$;
revoke execute on function public.retirer_autorisation(uuid, text, text) from public, anon;
grant execute on function public.retirer_autorisation(uuid, text, text) to authenticated;
