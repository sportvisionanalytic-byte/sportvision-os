-- v261 — La démonstration de Fontainebleau : un parent, deux enfants, deux catégories (25/09/2026)
--
-- DEMANDE DE FOUKA, qui va présenter SportVision au RCP Fontainebleau : « je pourrais avoir un
-- compte démo des parents et joueurs de Fontainebleau, avec des petits, U12 ou un truc du
-- genre ».
--
-- CE QUI EXISTAIT DÉJÀ : Nathan Girard (DEMO) en U16A, avec son propre compte, et sa mère Céline
-- Girard (DEMO) qui ne suivait que lui. Un parent d'un seul enfant, c'est exactement le cas qui
-- ne montre pas le sélecteur — et c'est la fonction qu'un club veut voir.
--
-- CE QUI EST AJOUTÉ : une petite sœur en U13A. Deux catégories très différentes, U16 et U13,
-- pour qu'en basculant d'un enfant à l'autre on voie deux calendriers qui n'ont rien à voir.
--
-- U13A A ÉTÉ CHOISIE POUR SES 23 MATCHS, pas au hasard : le calendrier se remplit par
-- club_matches.team_id = team_memberships.team_id, et une équipe sans match donnerait un écran
-- vide à un président de club en pleine démonstration. C'est le contraire de ce qu'on veut lui
-- montrer. « U12 » n'existe pas au RCP Fontainebleau ; U13 est la catégorie des petits qui joue
-- vraiment.
--
-- AUCUN COMPTE D'AUTHENTIFICATION pour elle : une enfant de U13 n'en a pas, c'est son parent qui
-- consulte. C'est le modèle réel, et c'est celui qu'un club doit voir.
--
-- La date de naissance correspond à la catégorie : U13 de la saison 2026-2027, ce sont les
-- enfants nés en 2014 et 2015.

do $$
declare
  v_club    uuid;
  v_equipe  uuid := '26079516-a49c-4248-ad4d-b60857c68994';  -- U13A, 23 matchs
  v_saison  uuid;
  v_txt     text;
  v_parent  uuid;
  v_enfant  uuid;
begin
  select id into v_club from clubs where nom = 'RCP Fontainebleau';
  if v_club is null then
    raise exception 'Le club RCP Fontainebleau est introuvable : rien n''a été créé.';
  end if;

  -- On copie la saison depuis l'affiliation de Nathan, plutôt que de la deviner. Les colonnes
  -- club_id et saison de team_memberships sont obligatoires, et c'est sur elles que la première
  -- version de la migration de Villemomble avait échoué.
  select tm.saison_id, tm.saison into v_saison, v_txt
  from team_memberships tm
  join player_profiles p on p.id = tm.player_id
  where p.nom = 'Girard (DEMO)' and tm.statut = 'active'
  limit 1;

  select pf.id into v_parent
  from parent_profiles pf
  join auth.users u on u.id = pf.user_id
  where u.email = 'demo.parent.fontainebleau@example.invalid';
  if v_parent is null then
    raise exception 'Le parent de démonstration de Fontainebleau est introuvable.';
  end if;

  -- Idempotent : relancer ne crée pas une troisième enfant.
  select p.id into v_enfant
  from player_profiles p
  where p.prenom = 'Jade' and p.nom = 'Girard (DEMO)' and p.club_id = v_club;

  if v_enfant is null then
    insert into player_profiles (prenom, nom, date_naissance, club_id, account_status)
    values ('Jade', 'Girard (DEMO)', '2014-03-22', v_club, 'actif')
    returning id into v_enfant;
  end if;

  insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
  select v_enfant, v_equipe, v_club, v_txt, v_saison, 'active'
  where not exists (
    select 1 from team_memberships
    where player_id = v_enfant and team_id = v_equipe and statut = 'active');

  insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
  select v_parent, v_enfant, 'parent', 'confirme', now()
  where not exists (
    select 1 from parent_player_relationships
    where parent_id = v_parent and player_id = v_enfant);
end $$;

-- Ce que le parent de Fontainebleau voit désormais.
select p.prenom, p.nom, ct.name as equipe, ct.categorie,
       (select count(*) from club_matches m where m.team_id = tm.team_id) as matchs
from parent_player_relationships r
join parent_profiles pf on pf.id = r.parent_id
join auth.users u on u.id = pf.user_id and u.email = 'demo.parent.fontainebleau@example.invalid'
join player_profiles p on p.id = r.player_id
left join team_memberships tm on tm.player_id = p.id and tm.statut = 'active'
left join club_teams ct on ct.id = tm.team_id
order by p.prenom;
