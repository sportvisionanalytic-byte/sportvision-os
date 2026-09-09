-- ═══════════════════════════════════════════════════════════════════════════════
-- Un CM peut changer le logo de SES clients, et rien d'autre
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- La fiche client de l'OS s'ouvre desormais pour le CM, mais tout y est en lecture seule : les
-- policies d'ecriture sur `clients` sont reservees a l'admin, la secretaire et la comptabilite.
--
-- Le logo est du materiel de communication, c'est le metier du CM. Le reste de la fiche — nom,
-- SIRET, pipeline commercial, montants — ne l'est pas.
--
-- Meme methode que cm_club_infos_maj() cote Club+ : une fonction a liste blanche plutot qu'une
-- policy d'ecriture ouverte. Un seul champ peut bouger, il n'y a rien a oublier de proteger.

create or replace function public.cm_client_logo_maj(p_client_id uuid, p_logo_url text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- PAS is_staff() : le role `cm` en fait encore partie (dette P1), donc n'IMPORTE quel CM aurait
  -- pu changer le logo de n'importe quel client. Constate en le testant, 09/09/2026. On nomme
  -- explicitement les roles qui ont autorite sur la fiche client.
  if not (
    contenus_visible_par_cm(p_client_id, auth.uid())
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','sec'))
  ) then
    raise exception 'Ce client ne vous est pas confié.' using errcode = '42501';
  end if;
  update clients set logo_url = nullif(btrim(coalesce(p_logo_url,'')), '') where id = p_client_id;
  return found;
end $function$;

grant execute on function public.cm_client_logo_maj(uuid, text) to authenticated;

select 'OK' as verdict;
