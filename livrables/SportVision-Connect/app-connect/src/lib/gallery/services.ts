// Les services proposés après un achat, à UN seul endroit.
//
// SportVision n'a pas de table de catalogue de prestations réutilisable pour ça : la liste vit
// donc ici, en configuration, et non dispersée dans le HTML de plusieurs écrans. Le jour où on
// veut en ajouter un, changer un texte, réordonner ou en désactiver un, il y a un seul fichier à
// toucher — et cette liste pourra plus tard être lue depuis l'OS sans modifier les écrans.
//
// Règle : on n'annonce que ce qui existe vraiment. Un lien qui mène à une page vide coûte plus de
// confiance qu'il ne rapporte de curiosité. `actif: false` suffit à retirer une entrée sans la
// perdre.

export interface ServiceCta {
  id: string;
  titre: string;
  texte: string;
  href: string;
  actif: boolean;
}

export const SERVICES_SPORTVISION: ServiceCta[] = [
  {
    id: "prestations",
    titre: "Réserver une prestation",
    texte: "Photo ou vidéo sur un prochain match de votre équipe.",
    // Le site vitrine, PUBLIC. /services est une page interne de Connect : un parent qui vient de
    // payer sans compte y était renvoyé vers un écran de connexion, c'est-à-dire un cul-de-sac
    // juste après un achat.
    href: "https://sportvision-an.fr/prestations",
    actif: true,
  },
  {
    id: "contact",
    titre: "Parler à SportVision",
    texte: "Un besoin particulier ? Écrivons-nous.",
    href: "/aide",
    actif: true,
  },
  // Annoncés seulement quand ils auront une vraie page derrière. Gardés ici pour qu'il n'y ait
  // qu'un endroit à modifier le jour où ils existent.
  { id: "suivi-joueur", titre: "Suivi joueur", texte: "Vos photos et vidéos tout au long de la saison.", href: "https://sportvision-an.fr/prestations", actif: false },
  { id: "highlight", titre: "Montage Highlight", texte: "Une vidéo de vos meilleures actions.", href: "https://sportvision-an.fr/prestations", actif: false },
  { id: "pass-saison", titre: "Pass Saison", texte: "Retrouvez vos contenus toute la saison.", href: "https://sportvision-an.fr/prestations", actif: false },
];
