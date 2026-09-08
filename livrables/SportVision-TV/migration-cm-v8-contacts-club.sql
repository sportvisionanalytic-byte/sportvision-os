-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 3b — Preparer les personnes : president, dirigeants, coachs
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- club_members.user_id est OBLIGATOIRE : y inscrire un coach suppose qu'il a deja un compte. Or
-- le §19 demande de pouvoir preparer quelqu'un dont on n'a meme pas encore l'adresse, et le §44
-- interdit de creer un compte a la place de qui que ce soit.
--
-- client_organigramme repond exactement a ce besoin et existe deja : client_id, role, prenom,
-- nom, email, telephone. On ne construit donc rien (§117). Le lien passe par
-- clubs.portail_client_id — les deux clubs concernes en ont un.
--
-- Ce que cela veut dire, et qu'il faut assumer : une personne preparee ici n'est PAS un
-- utilisateur. C'est un contact. La phase 4 transformera ces contacts en invitations, et c'est
-- la personne elle-meme qui creera son acces.

begin;

-- Un CM lit et prepare les contacts de SES clubs, via le client rattache.
drop policy if exists corg_cm_affecte_all on client_organigramme;
create policy corg_cm_affecte_all on client_organigramme for all
  using (est_cm_cloisonne() and client_id in (
    select cl.portail_client_id from clubs cl where cl.id in (select cm_clubs_autorises())
  ))
  with check (est_cm_cloisonne() and client_id in (
    select cl.portail_client_id from clubs cl where cl.id in (select cm_clubs_autorises())
  ));

-- Et il ne sort jamais de ce perimetre, meme si une autre policy s'elargissait un jour.
drop policy if exists cm_perim_organigramme on client_organigramme;
create policy cm_perim_organigramme on client_organigramme as restrictive for all to authenticated
  using (not est_cm_cloisonne() or client_id in (
    select cl.portail_client_id from clubs cl where cl.id in (select cm_clubs_autorises())
  ))
  with check (not est_cm_cloisonne() or client_id in (
    select cl.portail_client_id from clubs cl where cl.id in (select cm_clubs_autorises())
  ));

-- ── Les personnes preparees d'un club ────────────────────────────────────────
-- Rassemble en une seule lecture ce qui vit a deux endroits : les contacts prepares
-- (client_organigramme, sans compte) et les membres deja rattaches (club_members, avec compte).
-- L'ecran n'a pas a savoir que ce sont deux tables ; il a besoin de savoir qui est pret et qui ne
-- l'est pas.
create or replace function public.club_personnes(p_club_id uuid)
returns table(
  source text, id uuid, role text, prenom text, nom text, email text, telephone text,
  a_un_compte boolean, statut text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with autorise as (select p_club_id as id where p_club_id in (select cm_clubs_autorises()))
  -- Prepares : le CM les a saisis, ils n'ont pas encore d'acces.
  select 'contact'::text, o.id, o.role, o.prenom, o.nom, o.email, o.telephone,
         exists (select 1 from auth.users u where lower(u.email) = lower(o.email)),
         case
           when o.email is null or btrim(o.email) = '' then 'coordonnees_a_completer'
           when exists (select 1 from auth.users u where lower(u.email) = lower(o.email)) then 'compte_existant'
           else 'a_inviter'
         end
  from client_organigramme o
  join clubs cl on cl.portail_client_id = o.client_id
  join autorise a on a.id = cl.id
  union all
  -- Deja rattaches : ils ont un compte et un role dans le club.
  select 'membre'::text, m.id, m.role, m.prenom, m.nom, null, m.telephone, true, coalesce(m.status,'actif')
  from club_members m
  join autorise a on a.id = m.club_id;
$function$;

comment on function public.club_personnes(uuid) is
  'Les personnes d''un club, preparees ou deja rattachees. Un contact prepare n''est PAS un utilisateur : aucun compte n''est cree a la place de quiconque, la phase 4 l''invitera.';

revoke all on function public.club_personnes(uuid) from public;
grant execute on function public.club_personnes(uuid) to authenticated;

commit;
