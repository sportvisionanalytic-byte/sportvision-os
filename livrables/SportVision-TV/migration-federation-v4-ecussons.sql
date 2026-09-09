-- Ecussons des clubs : on garde une copie, et on garde d'ou elle vient.
--
-- Fouka, 09/09/2026 : « recupere meme les logos des club adverse ca peut faire bien ». Les visuels
-- matchday ont besoin de l'ecusson de l'adversaire, et 74 clubs adverses apparaissent rien que
-- dans la saison de SF Villemomble.
--
-- Pourquoi une copie plutot qu'un lien direct vers la source : un visuel publie doit continuer de
-- s'afficher dans six mois. Pointer chaque affiche vers le stockage d'un tiers, c'est accepter
-- qu'elle se casse le jour ou il reorganise ses fichiers, et charger ses serveurs a chaque
-- affichage. On copie donc l'image chez nous, et `logo_source_url` garde la trace de l'origine
-- pour pouvoir rafraichir ou verifier plus tard.

alter table public.federation_clubs add column if not exists logo_source_url text;

comment on column public.federation_clubs.logo_url is
  'URL de NOTRE copie de l''écusson (bucket federation-logos). C''est celle à afficher : elle ne dépend pas de la disponibilité du site source.';

comment on column public.federation_clubs.logo_source_url is
  'URL d''origine de l''écusson chez la source. Sert à rafraîchir la copie, jamais à l''affichage.';
