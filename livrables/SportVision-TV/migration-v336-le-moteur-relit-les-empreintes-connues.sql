-- v336 — Le moteur relit les empreintes déjà connues d'un sportif (29/09/2026).
--
-- POURQUOI. Le moteur apprend : chaque photo qu'une personne confirme devient une référence
-- supplémentaire (v334). Pour choisir LE BON VISAGE sur une photo de groupe, il doit partir de ce
-- qu'il connaît déjà du sportif — sinon il ne sait pas lequel des trois visages est le sien, et
-- mesuré, ajouter les trois fait attribuer la galerie entière : 3 photos confirmées produisaient
-- 31 références et 73 photos sur 92 marquées, les autres enfants compris.
--
-- `visages_reference` n'est lisible de personne par RLS, et c'est voulu : une empreinte de visage
-- ne se consulte pas. Cette fonction ne l'ouvre pas davantage — elle répond au service et au staff
-- qui peut déjà marquer, et rend l'empreinte seule, sans dire d'où elle vient.

create or replace function public.visage_empreintes_du_sportif(
  p_player_id uuid, p_modele text)
returns table(empreinte vector)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select vr.empreinte
    from visages_reference vr
   where vr.player_id = p_player_id
     and vr.modele = p_modele
     and (auth.role() = 'service_role' or public.media_upload_staff())
     -- L'accord d'abord, toujours : une empreinte ne sort pas d'un sportif qui a retiré le sien.
     and public.consentement_biometrie_actif(p_player_id)
   order by vr.created_at;
$$;

grant execute on function public.visage_empreintes_du_sportif(uuid, text) to authenticated;
