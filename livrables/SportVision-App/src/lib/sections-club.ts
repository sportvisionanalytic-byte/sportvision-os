/**
 * LES SECTIONS DE CLUB+, TELLES QUE L'APPLICATION LES PRÉSENTE (29/09/2026).
 *
 * POURQUOI CETTE LISTE EXISTE ICI. Fouka : « j'ai l'impression que tu as juste foutu la page web
 * dans l'app, alors que je veux une vraie refonte comme Connect. » Il a raison : Club+ arrivait
 * dans un cadre, sans rien de natif autour. Une barre d'onglets et un menu natifs changent
 * l'impression du tout au tout, et ils ont besoin de savoir quelles sections existent.
 *
 * CE QU'ON DUPLIQUE, ET CE QU'ON NE DUPLIQUE PAS. Ici, seulement des LIBELLÉS et des CHEMINS. Les
 * règles — qui a le droit de voir quoi, selon le plan, le type d'organisation et le rôle — restent
 * dans Club+ et nulle part ailleurs. Une section ouverte sans droit affiche son propre cadenas,
 * servi par le site : l'application ne décide rien, elle propose.
 *
 * C'est le compromis assumé. Refaire la résolution des droits ici, ce serait entretenir deux
 * versions de la même règle, et le jour où elles divergent personne ne sait laquelle fait foi.
 */
export type SectionClub = { cle: string; libelle: string; chemin: string; icone: string };

/** Les quatre que l'on ouvre tous les jours : elles méritent un onglet. */
export const ONGLETS_CLUB: SectionClub[] = [
  { cle: "dashboard", libelle: "Accueil", chemin: "/dashboard", icone: "home" },
  { cle: "calendar", libelle: "Calendrier", chemin: "/calendar", icone: "calendar" },
  { cle: "teams", libelle: "Équipes", chemin: "/teams", icone: "people" },
];

/** Tout le reste, rangé comme dans Club+ : les mêmes titres, dans le même ordre. */
export const MENU_CLUB: { titre: string; entrees: SectionClub[] }[] = [
  {
    titre: "Communication",
    entrees: [
      { cle: "communication", libelle: "Communication", chemin: "/communication", icone: "megaphone-outline" },
      { cle: "requests", libelle: "Demandes", chemin: "/requests", icone: "create-outline" },
      { cle: "content", libelle: "Contenus", chemin: "/content", icone: "images-outline" },
      { cle: "galeries", libelle: "Galeries", chemin: "/galeries", icone: "albums-outline" },
      { cle: "studio", libelle: "Studio", chemin: "/studio", icone: "color-wand-outline" },
      { cle: "newsroom", libelle: "Newsroom", chemin: "/newsroom", icone: "newspaper-outline" },
      { cle: "matchcenter", libelle: "Match Center", chemin: "/matchcenter", icone: "football-outline" },
    ],
  },
  {
    titre: "Club",
    entrees: [
      { cle: "team-requests", libelle: "Affiliations", chemin: "/team-requests", icone: "person-add-outline" },
      { cle: "invitations", libelle: "Invitations", chemin: "/invitations", icone: "mail-outline" },
      { cle: "users", libelle: "Coachs & dirigeants", chemin: "/users", icone: "id-card-outline" },
      { cle: "sponsors", libelle: "Sponsors", chemin: "/sponsors", icone: "ribbon-outline" },
    ],
  },
  {
    titre: "SportVision",
    entrees: [
      { cle: "services", libelle: "Prestations", chemin: "/services", icone: "camera-outline" },
      { cle: "accompagnement", libelle: "Accompagnement", chemin: "/accompagnement", icone: "compass-outline" },
    ],
  },
  {
    titre: "Gestion",
    entrees: [
      { cle: "contracts", libelle: "Contrats", chemin: "/contracts", icone: "document-text-outline" },
      { cle: "billing", libelle: "Factures", chemin: "/billing", icone: "card-outline" },
      { cle: "documents", libelle: "Documents", chemin: "/documents", icone: "folder-outline" },
      { cle: "messages", libelle: "Messages", chemin: "/messages", icone: "chatbubbles-outline" },
      { cle: "settings", libelle: "Paramètres", chemin: "/settings", icone: "settings-outline" },
      { cle: "support", libelle: "Aide", chemin: "/support", icone: "help-circle-outline" },
    ],
  },
];

/** Le libellé d'un chemin, pour le titre de la barre. On cherche le plus long qui corresponde :
 *  « /teams/12 » doit dire « Équipes », pas retomber sur « Accueil ». */
export function libelleDuChemin(chemin: string): string {
  const tout = [...ONGLETS_CLUB, ...MENU_CLUB.flatMap((g) => g.entrees)];
  let meilleur: SectionClub | null = null;
  for (const s of tout) {
    if (!chemin.startsWith(s.chemin)) continue;
    if (!meilleur || s.chemin.length > meilleur.chemin.length) meilleur = s;
  }
  return meilleur?.libelle ?? "Espace club";
}
