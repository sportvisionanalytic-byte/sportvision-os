-- v256 — Les trois clubs récupèrent leur écusson depuis l'annuaire fédéral (25/09/2026)
--
-- SIGNALÉ PAR FOUKA : « il y a écrit SV » sur les cartes du calendrier de l'application.
--
-- Deux causes. La première était un défaut de code, corrigé à part : les initiales de
-- « SF Villemomble » donnaient S + V, c'est-à-dire le sigle de SportVision. La seconde, plus
-- profonde, est ici : AUCUN des trois clubs n'avait d'écusson en base. Ni `clubs.ecusson_url`,
-- ni `clubs.logo_url`, ni `organizations.logo_url`. L'application ne pouvait afficher que des
-- lettres, faute d'image à montrer.
--
-- Fouka : « normalement tu es connecté avec SportCorico, tu peux trouver les logos des clubs ».
-- Il avait raison. `federation_clubs` contient 34 586 clubs, et la fonction federation-club-fiche
-- sait récupérer l'écusson d'un club à partir de son identifiant.
--
-- LE RATTACHEMENT A ÉTÉ CONFIRMÉ PAR FOUKA, club par club, et n'a pas été deviné. Un écusson
-- d'un autre club sur le compte d'un client, ça se voit au premier coup d'œil :
--
--   SF Villemomble      → Villemomble Sports          (Villemomble, 93250)
--   RCP Fontainebleau   → Pays de Fontainebleau RC    (Fontainebleau)
--   Villeneuve 340 SC   → AS Villeneuve la Guyard     (Villeneuve-la-Guyard, 89340)
--
-- LES IMAGES SONT LES NÔTRES. Elles ont été recopiées dans le seau `federation-logos`, qui
-- contenait déjà 74 écussons — c'est la convention posée par federation-club-fiche, qui traite
-- un chemin contenant « /federation-logos/ » comme la copie locale et se garde de l'écraser.
-- Pointer directement sur le serveur de SportCorico aurait fait dépendre l'affichage d'un tiers,
-- et consommé sa bande passante à chaque ouverture de l'application.

update clubs set ecusson_url =
  'https://lulgezzpvrlbftbykzrc.supabase.co/storage/v1/object/public/federation-logos/villemomble-sports.jpg'
where nom = 'SF Villemomble' and ecusson_url is null;

update clubs set ecusson_url =
  'https://lulgezzpvrlbftbykzrc.supabase.co/storage/v1/object/public/federation-logos/pays-de-fontainebleau-rc.jpg'
where nom = 'RCP Fontainebleau' and ecusson_url is null;

update clubs set ecusson_url =
  'https://lulgezzpvrlbftbykzrc.supabase.co/storage/v1/object/public/federation-logos/association-sportive-villeneuve-la-guyard.jpg'
where nom = 'Villeneuve 340 SC' and ecusson_url is null;

-- `organizations.logo_url` est l'autre source que l'application consulte (elle lit le club dans
-- `organizations`, et seulement ensuite l'écusson par club_identite). Les deux doivent dire la
-- même chose, sinon l'écusson dépend de l'écran qui le demande.
update organizations o set logo_url = c.ecusson_url
from clubs c
where o.legacy_club_id = c.id and c.ecusson_url is not null and o.logo_url is null;

select c.nom, c.ecusson_url is not null as club_a_son_ecusson,
       (select count(*) from organizations o where o.legacy_club_id = c.id and o.logo_url is not null) as organisation_aussi
from clubs c order by c.nom;
