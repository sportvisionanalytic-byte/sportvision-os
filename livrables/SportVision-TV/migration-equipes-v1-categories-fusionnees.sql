-- ═══════════════════════════════════════════════════════════════════════════════
-- Une equipe peut couvrir PLUSIEURS categories
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Demande de Fouka (09/09/2026) : beaucoup de clubs font jouer les U8 avec les U9. Une seule
-- equipe, deux categories. Avec une colonne unique, il fallait choisir, et l'import ne
-- rapprochait alors qu'une categorie sur deux.
--
-- `categorie` (singulier) est CONSERVEE : elle reste la categorie principale, celle qu'affichent
-- les ecrans et les exports existants. `categories` la complete pour dire ce que l'equipe couvre
-- REELLEMENT. Rien ne casse pour les equipes deja creees.

alter table club_teams add column if not exists categories text[];

comment on column club_teams.categories is
  'Toutes les categories couvertes par cette equipe (ex. {U8,U9} quand les deux jouent ensemble). La premiere est aussi dans `categorie`, conservee pour les ecrans et exports existants.';

-- Rattrapage : une equipe deja renseignee couvre au moins sa propre categorie.
update club_teams
set categories = array[categorie]
where categories is null and nullif(btrim(coalesce(categorie,'')),'') is not null;

select name, categorie, categories from club_teams order by name;
