// CE QU'ON A À MONTRER À QUELQU'UN QUI N'A AUCUNE MISSION (30/09/2026).
//
// == LE DÉFAUT, VU PAR FOUKA SUR SON TÉLÉPHONE ==================================================
//
// « L'accueil, il fait trop vide. » Il a raison, et ce n'est pas un cas limite : mesuré ce jour,
// AUCUN des dix opérateurs n'a de mission à venir. L'écran vide n'est pas l'exception, c'est ce
// que tout le monde voit. Un outil de travail qui n'a rien à dire le jour où on l'installe ne se
// rouvre pas.
//
// == CE QU'ON A VRAIMENT, ET CE QU'ON N'INVENTE PAS =============================================
//
// Mesuré compte par compte avant d'écrire une ligne :
//
//   XP                 6 opérateurs sur 10 en ont (Antoine 1991, Bhajneet 659, Lynkone 344…)
//   Formations         6 sur 10 sont inscrits, 5 en ont terminé
//   Certifications     4 sur 10 en ont (Bhajneet 9, Antoine 5)
//   Kit sorti          1 sur 10 (Antoine, KIT alpha 1, depuis le 12 septembre)
//   Missions à venir   0 sur 10
//
// Donc : le parcours remplit l'écran pour la majorité, et pour les quatre qui n'ont rien encore,
// on affiche une INVITATION — « commencez une formation » — et non un « Débutant, 0 XP » qui
// serait un jugement posé sur quelqu'un qui vient d'arriver.
//
// LA MÉTÉO N'EST PAS ICI, ET C'EST UN CHOIX. Une météo sans prestation à laquelle l'accrocher est
// une décoration : elle occupe la place sans rien changer à ce qu'on fait. Sur la carte d'une
// prestation à venir, en revanche, elle est utile — on ne prépare pas le même sac sous la pluie.
// C'est là qu'elle ira, le jour où il y aura des missions à venir à décorer.
import { supabase } from "./supabase";

export interface ResumeOperateur {
  /** Les missions réellement faites, telles que la base les compte. */
  missionsRealisees: number;
  /** Le kit qu'on a chez soi et qu'on n'a pas rendu. Null quand il n'y en a pas. */
  kitEnMain: { nom: string; depuis: string | null; reference: string | null } | null;
}

export async function lireResumeOperateur(moiId: string): Promise<ResumeOperateur> {
  const [rMissions, rKit] = await Promise.all([
    // `head: true` : on veut le NOMBRE, pas les lignes. Rapporter cinquante missions pour en
    // afficher le compte, c'est du réseau dépensé sur une 4G de bord de terrain.
    supabase
      .from("prestations_equipe")
      .select("id", { count: "exact", head: true })
      .eq("collaborateur_id", moiId)
      .eq("statut", "acceptée"),
    supabase
      .from("kit_reservations")
      .select("date_sortie, kits ( nom ), prestations ( reference )")
      .eq("collaborateur_id", moiId)
      .is("date_retour_effective", null)
      .is("heure_retour_reelle", null)
      .order("date_sortie", { ascending: true, nullsFirst: false })
      .limit(1),
  ]);

  // PostgREST rend un embed tantot comme un objet, tantot comme un tableau selon la cardinalite
  // qu'il deduit des cles etrangeres. On accepte les deux plutot que de parier : le pari se
  // paierait par une carte vide, sans erreur, et personne ne saurait pourquoi.
  const un = <T,>(v: T | T[] | null | undefined): T | null =>
    (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

  const k = (rKit.data ?? [])[0] as
    | { date_sortie: string | null; kits: unknown; prestations: unknown }
    | undefined;
  const kit = un(k?.kits as { nom?: string } | { nom?: string }[] | null);
  const presta = un(k?.prestations as { reference?: string } | { reference?: string }[] | null);

  return {
    missionsRealisees: rMissions.count ?? 0,
    kitEnMain: kit?.nom
      ? { nom: kit.nom, depuis: k?.date_sortie ?? null, reference: presta?.reference ?? null }
      : null,
  };
}
