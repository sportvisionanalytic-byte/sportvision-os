-- v252 — Le joueur voit l'écusson de son club (22/09/2026)
--
-- CE QU'ON VOYAIT. Sur la fiche du parent, l'écusson de SF Villemomble s'affiche (v249, qui le
-- lit dans une fonction SECURITY DEFINER). Sur l'espace du joueur, le même club apparaissait
-- sous ses initiales dans un carré gris : la table `clubs` est fermée en lecture, volontairement
-- (décision du 11/09 : Stripe, SIRET, annuaire, sponsors ne sortent que par rôle). Le joueur n'a
-- donc aucun chemin pour lire l'écusson de son propre club.
--
-- CE QU'ON NE FAIT PAS. Ouvrir une policy de lecture sur `clubs` pour les joueurs : ce serait
-- rouvrir la table entière pour un logo, et exactement ce que la décision du 11/09 interdit.
--
-- CE QU'ON FAIT. Une fonction qui ne rend que l'identité publique du club — nom, ville, écusson,
-- couleurs — et seulement à quelqu'un qui appartient déjà à ce club : un joueur affilié, un
-- parent confirmé d'un de ses joueurs, ou un membre du club. Rien d'autre ne sort par là.
--
-- Vérification : tests/identite-du-club.test.sql

begin;

create or replace function public.club_identite(p_club_id uuid)
returns table (nom text, ville text, ecusson_url text, couleur_primaire text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_club_id is null then
    return;
  end if;

  -- Trois portes, et aucune autre : on appartient au club, ou on n'apprend rien.
  if not (
    exists (
      select 1 from player_profiles pp
      where pp.club_id = p_club_id
        and pp.account_status <> 'retire'
        and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
    )
    or is_club_member(p_club_id)
    or peut_travailler_club(p_club_id)
  ) then
    return;
  end if;

  return query
    select c.nom, c.ville, coalesce(c.ecusson_url, c.logo_url), c.couleur_primaire
    from clubs c
    where c.id = p_club_id;
end $$;

revoke all on function public.club_identite(uuid) from public;
grant execute on function public.club_identite(uuid) to authenticated;

comment on function public.club_identite(uuid) is
  'Identité publique d''un club (nom, ville, écusson, couleur) pour quelqu''un qui en fait partie. '
  'Existe parce que la table clubs est fermée en lecture : ne jamais y ajouter une colonne sensible.';

commit;
