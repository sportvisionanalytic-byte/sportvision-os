-- v224 — Ce dont le moteur a besoin pour tourner dans le navigateur (14/09/2026).
--
-- OÙ LE CALCUL SE FAIT, ET POURQUOI LÀ. Le responsable production télécharge les liens de
-- l'opérateur et verse les vraies photos dans l'OS (méthode décidée par Fouka). C'est donc SON
-- poste qui a, au même moment : les photos de la galerie, et le droit de lire les photos de
-- référence des joueurs de l'équipe. Le calcul des empreintes s'y fait, dans le navigateur, comme
-- le filigrane. Aucun serveur à louer, et aucune photo d'enfant ne transite ailleurs.
--
-- CE QUE CETTE MIGRATION AJOUTE, et rien de plus :
--   1. De quoi savoir quels joueurs sont prêts à être reconnus — accord donné, photo de référence
--      déposée, empreinte déjà calculée ou non.
--   2. De quoi enregistrer un visage détecté sur une photo.
--   3. De quoi poser le marquage issu du rapprochement, avec sa trace : quel modèle, quelle
--      distance. Sans cette trace, on ne peut ni régler le seuil, ni expliquer une erreur à un
--      parent.
--
-- CE QUI RESTE INTERDIT : écrire dans les tables d'empreintes en direct. Tout passe par ces
-- fonctions, qui vérifient l'accord et le périmètre.
--
-- Idempotente.

-- ── Qui peut être reconnu dans cette galerie ────────────────────────────────
create or replace function public.reconnaissance_joueurs_prets(p_album_id uuid)
returns table(player_id uuid, joueur text, chemin_photo text, a_une_empreinte boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_team uuid;
begin
  if not peut_marquer_galerie(p_album_id) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  select al.team_id into v_team from media_albums al where al.id = p_album_id;

  return query
  select p.id,
         coalesce(nullif(btrim(p.prenom || ' ' || p.nom), ''), 'Sportif'),
         r.storage_path,
         exists (select 1 from visages_reference vr where vr.player_id = p.id)
    from player_profiles p
    join team_memberships tm on tm.player_id = p.id and tm.statut = 'active'
    left join lateral (
      select fr.storage_path from player_face_refs fr
       where fr.player_id = p.id order by fr.created_at desc limit 1
    ) r on true
   where v_team is not null and tm.team_id = v_team
     -- L'accord d'abord : un joueur sans consentement n'entre jamais dans le rapprochement.
     and consentement_biometrie_actif(p.id)
   order by 2;
end $$;

comment on function public.reconnaissance_joueurs_prets(uuid) is
  'v224 — Les joueurs de l''équipe qui ont donné leur accord : leur photo de référence, et s''il reste une empreinte à calculer.';

-- ── Enregistrer un visage trouvé sur une photo ──────────────────────────────
create or replace function public.visage_detecte_ajouter(
  p_asset_id uuid, p_empreinte extensions.vector, p_modele text,
  p_boite jsonb default null, p_qualite numeric default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare v_id uuid;
begin
  if not peut_marquer_galerie((select album_id from media_assets where id = p_asset_id)) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_modele), '') = '' then
    raise exception 'Le modèle est obligatoire.' using errcode = '22023';
  end if;
  insert into visages_detectes (asset_id, empreinte, modele, boite, qualite)
  values (p_asset_id, p_empreinte, p_modele, p_boite, p_qualite)
  returning id into v_id;
  return v_id;
end $$;

-- ── Poser le marquage issu du rapprochement ─────────────────────────────────
-- On garde le modèle et la distance : sans eux, impossible de régler le seuil après coup, ni
-- d'expliquer à un parent pourquoi son enfant a été reconnu — ou ne l'a pas été.
create or replace function public.marquer_par_reconnaissance(
  p_asset_id uuid, p_player_id uuid, p_distance numeric, p_modele text, p_certain boolean)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_album uuid; v_team uuid; v_id uuid;
begin
  select a.album_id, al.team_id into v_album, v_team
    from media_assets a join media_albums al on al.id = a.album_id where a.id = p_asset_id;
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;
  if not peut_marquer_galerie(v_album) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  if not consentement_biometrie_actif(p_player_id) then
    raise exception 'Ce sportif n''a pas autorisé la reconnaissance.' using errcode = '42501';
  end if;
  if v_team is not null and not exists (
    select 1 from team_memberships tm
     where tm.team_id = v_team and tm.player_id = p_player_id and tm.statut = 'active') then
    raise exception 'Ce sportif ne fait pas partie de l''équipe de cette galerie.' using errcode = '42501';
  end if;

  -- Un marquage posé par un humain fait foi : la machine ne le contredit pas.
  select id into v_id from media_player_tags
   where media_ref_type = 'media_asset' and media_ref_id = p_asset_id and player_id = p_player_id;
  if found then
    return v_id;
  end if;

  insert into media_player_tags (media_ref_type, media_ref_id, player_id, tagged_by, source, statut,
                                 score, moteur, valide_par, valide_le)
  values ('media_asset', p_asset_id, p_player_id, auth.uid(), 'suggestion',
          -- Au-dessus du seuil de certitude, le marquage vaut ; en dessous, il attend un humain.
          case when p_certain then 'valide' else 'propose' end,
          p_distance, p_modele,
          case when p_certain then auth.uid() end,
          case when p_certain then now() end)
  returning id into v_id;
  return v_id;
end $$;

comment on function public.marquer_par_reconnaissance(uuid, uuid, numeric, text, boolean) is
  'v224 — Pose le marquage issu du rapprochement, avec son modèle et sa distance. Ne contredit jamais un marquage humain.';

revoke all on function public.reconnaissance_joueurs_prets(uuid) from public;
revoke all on function public.visage_detecte_ajouter(uuid, extensions.vector, text, jsonb, numeric) from public;
revoke all on function public.marquer_par_reconnaissance(uuid, uuid, numeric, text, boolean) from public;
grant execute on function public.reconnaissance_joueurs_prets(uuid) to authenticated;
grant execute on function public.visage_detecte_ajouter(uuid, extensions.vector, text, jsonb, numeric) to authenticated;
grant execute on function public.marquer_par_reconnaissance(uuid, uuid, numeric, text, boolean) to authenticated;
