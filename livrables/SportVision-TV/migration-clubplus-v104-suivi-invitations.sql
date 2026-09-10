-- Le club envoie des invitations et n'a aucun moyen de les suivre.
--
-- ── Ce qui manque, constaté en lisant les policies ──
-- `player_invitations` et `parent_invitations` n'ont que des policies de LECTURE. Une fois
-- l'invitation partie, le club ne peut donc ni l'annuler, ni corriger une adresse mal saisie : la
-- ligne reste « envoyee » pour toujours, et la personne qui ne viendra jamais y figure
-- indéfiniment. La seule issue était une intervention en base.
--
-- On ajoute donc les deux gestes qui manquaient, et une lecture unifiée pour l'écran de suivi.
-- Comme partout depuis la v99, l'autorité est `peut_operer_club` — jamais une règle réécrite.

begin;

-- ── 1. Annuler ──
-- Pas de suppression : une invitation annulée reste visible dans le suivi, sinon le club ne sait
-- plus qu'il a écrit à quelqu'un. Même choix que pour les invitations d'encadrants.
create or replace function public.annuler_invitation_famille(p_id uuid, p_genre text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_club uuid;
  v_statut text;
begin
  if p_genre not in ('joueur', 'parent') then
    raise exception 'Type d''invitation inconnu.';
  end if;

  if p_genre = 'joueur' then
    select club_id, statut into v_club, v_statut from player_invitations where id = p_id;
  else
    select club_id, statut into v_club, v_statut from parent_invitations where id = p_id;
  end if;

  if v_club is null then raise exception 'Cette invitation n''existe plus.'; end if;
  if not peut_operer_club(v_club) then
    raise exception 'Vous n''êtes pas autorisé à gérer les invitations de ce club.';
  end if;
  if v_statut = 'acceptee' then
    raise exception 'Cette invitation a déjà été acceptée. La personne fait partie du club.';
  end if;

  if p_genre = 'joueur' then
    update player_invitations set statut = 'annulee' where id = p_id;
  else
    update parent_invitations set statut = 'annulee' where id = p_id;
  end if;
  return 'annulee';
end;
$$;

-- ── 2. Le suivi, en une seule liste ──
-- Trois tables (`club_invitations`, `player_invitations`, `parent_invitations`), trois publics,
-- mais un seul écran : le club veut savoir qui a rejoint et qui n'a pas répondu, pas naviguer
-- entre trois tableaux. La fonction les réunit, avec les noms d'équipe et d'enfant que les tables
-- ne portent pas.
--
-- L'expiration se CALCULE, elle ne se stocke pas : un statut « expiree » écrit en base par un
-- automate serait une écriture de masse à défaire le jour où l'on allonge le délai. Même principe
-- que les files du Match Center.
create or replace function public.suivi_invitations_club(p_club_id uuid)
returns table (
  id uuid,
  genre text,
  email text,
  personne text,
  role_ou_equipe text,
  statut text,
  envoyee_le timestamptz,
  creee_le timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  -- L'union est enveloppee et ses colonnes sont nommees : dans un UNION, `order by` ne voit pas
  -- les noms declares par RETURNS TABLE, et une sous-requete sans alias n'en expose aucun. Les
  -- nommer ici evite aussi un `order by 8` qui se decalerait a la premiere colonne ajoutee.
  select x.id, x.genre, x.email, x.personne, x.role_ou_equipe, x.statut, x.envoyee_le, x.creee_le
    from (
      select ci.id as id,
             'encadrant'::text as genre,
             ci.email as email,
             nullif(btrim(coalesce(ci.prenom, '') || ' ' || coalesce(ci.nom, '')), '') as personne,
             coalesce(nullif(array_to_string(array(select jsonb_array_elements_text(ci.teams)), ', '), ''), 'Sans équipe') as role_ou_equipe,
             (case when ci.statut in ('preparee', 'envoyee') and ci.expire_at <= now()
                   then 'expiree' else ci.statut end)::text as statut,
             ci.sent_at as envoyee_le,
             ci.created_at as creee_le
        from club_invitations ci
       where ci.club_id = p_club_id

      union all

      select pi.id, 'joueur'::text, pi.email,
             nullif(btrim(coalesce(pi.prenom, '') || ' ' || coalesce(pi.nom, '')), ''),
             coalesce(t.name, 'Sans équipe'),
             pi.statut::text, null::timestamptz, pi.created_at
        from player_invitations pi
        left join club_teams t on t.id = pi.team_id
       where pi.club_id = p_club_id

      union all

      select pa.id, 'parent'::text, pa.email,
             nullif(btrim(coalesce(pa.prenom, '') || ' ' || coalesce(pa.nom, '')), ''),
             coalesce(nullif(btrim(coalesce(pp.prenom, '') || ' ' || coalesce(pp.nom, '')), ''), 'Enfant à rattacher'),
             pa.statut::text, null::timestamptz, pa.created_at
        from parent_invitations pa
        left join player_profiles pp on pp.id = pa.player_id
       where pa.club_id = p_club_id
    ) x
   -- Le controle d'acces est ici, une seule fois : la fonction est SECURITY DEFINER, elle voit
   -- tout, donc elle ne rend rien tant que l'appelant n'opere pas ce club.
   where peut_operer_club(p_club_id)
   order by x.creee_le desc;
$$;

comment on function public.suivi_invitations_club(uuid) is
  'Les invitations d''un club, encadrants, joueurs et parents réunis, avec l''équipe ou l''enfant concerné. Réservé à qui opère le club. L''expiration est calculée, jamais stockée.';

commit;

-- ── 3. La lecture directe, pour ne pas laisser une sixième incohérence ──
-- Constaté en testant : le CM ne peut pas lire `player_invitations` ni `parent_invitations`.
-- `pinv_manager_select` ne connaît que `is_club_admin` et l'éducateur de l'équipe ;
-- `pinv_cm_affecte_select` exige `est_cm_cloisonne()`, vrai seulement pour un profil `cm` — pas
-- pour le staff communication qui exploite le club.
--
-- L'écran de suivi passe par `suivi_invitations_club`, qui est SECURITY DEFINER : il fonctionne
-- sans ça. On l'ajoute quand même, parce qu'une table dont la lecture ne s'accorde pas avec
-- l'écriture est précisément ce qui a produit les cinq bugs de la journée. Le prochain qui lira
-- ces tables directement n'aura pas à le redécouvrir.
drop policy if exists pinv_operateur_select on public.player_invitations;
create policy pinv_operateur_select on public.player_invitations
  for select using (peut_operer_club(club_id));

drop policy if exists parinv_operateur_select on public.parent_invitations;
create policy parinv_operateur_select on public.parent_invitations
  for select using (peut_operer_club(club_id));
