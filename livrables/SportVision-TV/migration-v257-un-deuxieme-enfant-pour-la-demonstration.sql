-- v257 — Le parent de démonstration a deux enfants (25/09/2026)
--
-- POURQUOI. Le compte parent remis à Apple et à Google pour la relecture n'avait qu'un seul
-- enfant, Lucas. Or c'est le nombre d'enfants qui fait apparaître le sélecteur : avec un seul,
-- la barre de choix se masque, et un relecteur ne voit jamais la fonction. Pire, signalé par
-- Fouka en testant : « j'ai l'impression que je suis un joueur, alors que je dois sentir que je
-- suis un parent ». L'écran d'un parent d'un seul enfant était indiscernable de celui d'un
-- joueur.
--
-- Le bandeau « Espace parent · vous consultez X » a été corrigé côté application pour s'afficher
-- même avec un enfant. Mais le passage d'un enfant à l'autre, lui, ne se démontre qu'à deux.
--
-- CE QUI EST CRÉÉ : une fiche joueuse fictive, rattachée au même club que Lucas et à une équipe
-- qui joue vraiment (U14 D1, 43 matchs), plus le lien parent-enfant confirmé. Le suffixe
-- « (DEMO) » suit la convention des quatre fiches de démonstration déjà en base.
--
-- L'ÉQUIPE A ÉTÉ CHOISIE POUR SES MATCHS, pas au hasard : le calendrier se remplit par
-- `club_matches.team_id = team_memberships.team_id`. Une équipe sans match donnerait un écran
-- vide au relecteur, c'est-à-dire exactement le contraire du but. U14 D1 a aussi l'avantage
-- d'être une catégorie différente de celle de Lucas (U18) : en basculant d'un enfant à l'autre,
-- on voit deux calendriers réellement différents, et non deux fois le même.
--
-- AUCUN COMPTE D'AUTHENTIFICATION n'est créé pour elle : une enfant de U14 n'a pas de compte,
-- c'est son parent qui consulte. C'est le modèle réel, et c'est celui qu'Apple doit voir.

do $$
declare
  v_club        uuid := 'f0d3bafa-3004-4831-bd85-249aa9af5c54';  -- SF Villemomble
  v_equipe      uuid := '05cbc532-4ad0-4afd-9845-1ca4e47a6e09';  -- U14 D1, 43 matchs
  v_saison      uuid;
  v_saison_txt  text;
  v_parent      uuid;
  v_enfant      uuid;
begin
  -- La saison de l'affiliation de Lucas, pour que les deux enfants soient sur la même. On copie
  -- aussi `saison` en texte et `club_id` : les deux sont obligatoires sur team_memberships, et la
  -- première tentative a echoue dessus. On ne devine pas la forme d'une ligne, on lit celle qui
  -- existe deja.
  select tm.saison_id, tm.saison into v_saison, v_saison_txt
  from team_memberships tm
  where tm.player_id = '48954b83-6b5e-4785-a128-3e026c65330d' and tm.statut = 'active'
  limit 1;

  select pf.id into v_parent
  from parent_profiles pf
  join auth.users u on u.id = pf.user_id
  where u.email = 'demo.parent.villemomble@example.invalid';

  if v_parent is null then
    raise exception 'Le parent de démonstration est introuvable : rien n''a été créé.';
  end if;

  -- Idempotent : relancer cette migration ne crée pas une troisième enfant.
  select p.id into v_enfant
  from player_profiles p
  where p.prenom = 'Emma' and p.nom = 'Moreau (DEMO)' and p.club_id = v_club;

  if v_enfant is null then
    insert into player_profiles (prenom, nom, date_naissance, club_id, account_status)
    values ('Emma', 'Moreau (DEMO)', '2012-06-18', v_club, 'actif')
    returning id into v_enfant;
  end if;

  insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
  select v_enfant, v_equipe, v_club, v_saison_txt, v_saison, 'active'
  where not exists (
    select 1 from team_memberships
    where player_id = v_enfant and team_id = v_equipe and statut = 'active');

  insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
  select v_parent, v_enfant, 'parent', 'confirme', now()
  where not exists (
    select 1 from parent_player_relationships
    where parent_id = v_parent and player_id = v_enfant);
end $$;

-- Ce que le parent de démonstration voit désormais.
select p.prenom, p.nom, ct.name as equipe, ct.categorie,
       (select count(*) from club_matches m where m.team_id = tm.team_id) as matchs
from parent_player_relationships r
join parent_profiles pf on pf.id = r.parent_id
join auth.users u on u.id = pf.user_id and u.email = 'demo.parent.villemomble@example.invalid'
join player_profiles p on p.id = r.player_id
left join team_memberships tm on tm.player_id = p.id and tm.statut = 'active'
left join club_teams ct on ct.id = tm.team_id
order by p.prenom;
