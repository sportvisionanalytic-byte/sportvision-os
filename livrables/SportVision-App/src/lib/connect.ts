// Les pages de Connect ouvertes dans l'application, avec la session déjà faite (24/09/2026).
//
// CE QUI EST ICI, ET POURQUOI CE N'EST PAS DU NATIF
//
// Les commandes, les factures, les cotisations de groupe, les affiliations, l'aide et la
// reconnaissance existent déjà dans Connect, écrites, testées, corrigées pendant des semaines.
// Les réécrire en natif reviendrait à entretenir deux versions de la même règle métier — et la
// règle de consentement de la reconnaissance, avec ses seuils d'âge, est exactement le genre de
// chose qu'on ne veut pas voir exister en double. Le jour où les deux divergent, plus personne
// ne sait laquelle fait foi.
//
// Ce qui est natif, c'est ce qu'on regarde tous les jours : l'accueil, le calendrier, les photos,
// le profil, et la réservation d'une prestation, parce que c'est ce qui se vend.
//
// LE PASSAGE DE SESSION
//
// La session native vit dans le stockage de l'application, celle du site dans les cookies. Sans
// rien faire, une personne déjà connectée retombe sur l'écran de connexion de Connect. Se
// connecter deux fois pour voir son propre reçu, personne ne le fait : elle referme.
//
// On remet donc les deux jetons à /auth/app, qui les valide auprès de Supabase et pose les
// cookies. En POST, jamais dans l'adresse : un jeton dans une URL finit dans l'historique, dans
// les journaux du serveur et dans l'en-tête Referer envoyé au site suivant.
import { supabase } from "./supabase";

const CONNECT = "https://connect.sportvision-an.fr";

export type PageConnect =
  | "commandes" | "factures" | "cotisations" | "affiliations" | "reconnaissance" | "aide";

/** Le chemin réel dans Connect, et le titre affiché dans la barre de l'application. */
export const PAGES: Record<PageConnect, { chemin: string; titre: string }> = {
  commandes:      { chemin: "/commandes",      titre: "Mes commandes" },
  factures:       { chemin: "/factures",       titre: "Mes factures" },
  cotisations:    { chemin: "/cotisations",    titre: "Cotisations" },
  affiliations:   { chemin: "/affiliations",   titre: "Mes rattachements" },
  reconnaissance: { chemin: "/reconnaissance", titre: "Me reconnaître" },
  aide:           { chemin: "/aide",           titre: "Aide" },
};

export interface SourceConnect {
  uri: string;
  method: "POST";
  body: string;
}

/**
 * De quoi charger une page de Connect déjà connectée.
 *
 * Rend `null` quand il n'y a pas de session : l'écran affiche alors une explication au lieu
 * d'ouvrir une page qui renverrait vers un formulaire de connexion. Une fenêtre web qui demande
 * un mot de passe à quelqu'un qui vient de le saisir, c'est ce qui fait fermer l'application.
 */
export async function sourceConnect(page: PageConnect): Promise<SourceConnect | null> {
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s?.access_token || !s?.refresh_token) return null;

  const corps = new URLSearchParams({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    next: PAGES[page].chemin,
  }).toString();

  return { uri: `${CONNECT}/auth/app`, method: "POST", body: corps };
}

/** L'adresse simple d'une page, pour les cas où il n'y a rien à transporter (l'aide est publique). */
export function adresseConnect(page: PageConnect): string {
  return CONNECT + PAGES[page].chemin;
}
