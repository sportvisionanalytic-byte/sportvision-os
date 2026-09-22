// Le mode démonstration (22/09/2026).
//
// À quoi ça sert : montrer l'application remplie, sans compte et sans toucher à la production —
// pour une relecture d'interface, ou pour la présenter à un club sans exposer les données d'un
// vrai joueur.
//
// Comment c'est allumé : la variable EXPO_PUBLIC_DEMO, posée uniquement au moment de fabriquer
// la version web de démonstration. Les applications iOS et Android sont construites sans elle,
// donc ce fichier n'y change strictement rien. Une seule porte, vérifiable en une ligne.
//
// Ce que ça n'est PAS : un faux succès. Rien n'est écrit, rien n'est envoyé, et aucun écran ne
// prétend qu'une action a réussi. Les données ci-dessous sont visiblement fictives.
import type { Evenement, Galerie, PhotoDuJoueur } from "./donnees";
import type { Profil } from "./session";

export const MODE_DEMO = process.env.EXPO_PUBLIC_DEMO === "1";

const PHOTO_1 = "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=900&q=70";
const PHOTO_2 = "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=900&q=70";
const PHOTO_3 = "https://images.unsplash.com/photo-1459865264687-595d652de67e?w=900&q=70";

/** Des dates relatives au jour de la visite : une démonstration figée au passé fait démonstration. */
function dans(jours: number): string {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const PROFIL_DEMO: Profil = {
  espace: "joueur",
  prenom: "Lucas",
  playerId: "demo-joueur",
  clubId: "demo-club",
  clubNom: "AS Démonstration",
  equipeNom: "U18 A",
  equipeId: "demo-equipe",
  saisonId: null,
  affilie: true,
};

export const EVENEMENTS_DEMO: Evenement[] = [
  { id: "d-1", genre: "match", titre: "U18 A vs FC Riverside", date: dans(4), heure: "14:30",
    lieu: "Stade municipal, terrain 2", equipe: "U18 A", adversaire: "FC Riverside", domicile: true,
    competition: "Championnat départemental", score: null },
  { id: "d-2", genre: "entrainement", titre: "Entraînement U18 A", date: dans(1), heure: "18:30",
    lieu: "Terrain synthétique", equipe: "U18 A" },
  { id: "d-3", genre: "entrainement", titre: "Entraînement U18 A", date: dans(6), heure: "18:30",
    lieu: "Terrain synthétique", equipe: "U18 A" },
  { id: "d-4", genre: "evenement", titre: "Photo officielle de l'équipe", date: dans(9), heure: "10:00",
    lieu: "Club house", equipe: "U18 A" },
  { id: "d-5", genre: "match", titre: "U18 A @ Olympique Nord", date: dans(-3), heure: "15:00",
    lieu: "Complexe sportif Nord", equipe: "U18 A", adversaire: "Olympique Nord", domicile: false,
    competition: "Championnat départemental", score: "2 - 3" },
  { id: "d-6", genre: "match", titre: "U18 A vs Étoile Sportive", date: dans(-10), heure: "13:00",
    lieu: "Stade municipal, terrain 1", equipe: "U18 A", adversaire: "Étoile Sportive", domicile: true,
    competition: "Championnat départemental", score: "1 - 1" },
];

export const GALERIES_DEMO: Galerie[] = [
  { id: "g-1", titre: "U18 A contre Olympique Nord", date: dans(-3), apercuUrl: PHOTO_1,
    nbPhotos: 148, ouverte: true, mesPhotos: 12, videoUrl: "https://exemple.invalid/video" },
  { id: "g-2", titre: "U18 A contre Étoile Sportive", date: dans(-10), apercuUrl: PHOTO_2,
    nbPhotos: 96, ouverte: false, mesPhotos: 7 },
  { id: "g-3", titre: "Tournoi de rentrée", date: dans(-24), apercuUrl: PHOTO_3,
    nbPhotos: 212, ouverte: false, mesPhotos: 0 },
];

export const PHOTOS_DEMO: PhotoDuJoueur[] = [
  PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_1, PHOTO_2, PHOTO_3,
].map((url, i) => ({ id: `p-${i}`, url }));
