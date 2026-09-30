// LES MISSIONS, VUES DE L'APPLICATION (30/09/2026).
//
// DEUX LECTURES, PARCE QU'IL Y A DEUX MÉTIERS, et pas une lecture unique qu'on filtrerait ensuite :
//
//   · L'OPÉRATEUR lit `prestations_equipe` — SES affectations, avec son heure de rendez-vous, sa
//     rémunération, sa réponse. La RLS le borne à lui-même ; l'écran ne filtre rien.
//   · LA PRODUCTION lit `v_production_missions` — la vue du cockpit, bornée par `is_staff()` et
//     `pole_scope_ok()`. C'est la même source que l'OS, à l'octet près : « tous les chiffres
//     viennent de v_production_missions, la source unique », dit son propre code.
//
// ON NE REFAIT AUCUN CLASSEMENT ICI. Le groupe d'une mission est calculé par la vue, et par elle
// seule. Le 30/09, un groupe absent de l'écran a rendu invisibles toutes les prestations vendues
// et pas encore planifiées : la leçon n'est pas d'ajouter un classement de plus côté téléphone,
// c'est qu'il ne doit y en avoir qu'un.
import { supabase } from "./supabase";

export type GroupeMission =
  | "a_planifier" | "attente_acceptation" | "a_venir" | "terrain"
  | "post_production" | "a_verifier" | "corrections" | "terminees" | "annulees" | "autres";

export interface MissionProduction {
  id: string;
  reference: string;
  statut: string;
  groupe: GroupeMission;
  date: string | null;
  heureDebut: string | null;
  heureRdv: string | null;
  lieu: string | null;
  client: string | null;
  couverture: string | null;
  operateurs: string | null;
  /** Vrai quand tout est prêt côté terrain : opérateur confirmé, brief rempli, kit, pas d'incident. */
  prete: boolean;
  enRetard: boolean;
  echeanceManquante: boolean;
}

export async function lireCockpit(): Promise<MissionProduction[]> {
  const { data, error } = await supabase
    .from("v_production_missions")
    .select("prestation_id, reference, statut, groupe, date_prestation, heure_debut, heure_rdv, lieu, client_nom, couverture, operateurs, mission_prete, livraison_en_retard, echeance_manquante")
    .neq("groupe", "annulees")
    .order("date_prestation", { ascending: true, nullsFirst: false });
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: String(r.prestation_id),
    reference: r.reference ?? "",
    statut: String(r.statut ?? ""),
    groupe: (r.groupe ?? "autres") as GroupeMission,
    date: r.date_prestation ?? null,
    heureDebut: r.heure_debut ?? null,
    heureRdv: r.heure_rdv ?? null,
    lieu: r.lieu ?? null,
    client: r.client_nom ?? null,
    couverture: r.couverture ?? null,
    operateurs: r.operateurs ?? null,
    prete: r.mission_prete === true,
    enRetard: r.livraison_en_retard === true,
    echeanceManquante: r.echeance_manquante === true,
  }));
}

export type ReponseOperateur = "invitation_envoyée" | "en_attente" | "acceptée" | "refusée";

export interface MaMission {
  /** L'identifiant de l'AFFECTATION, pas de la prestation : c'est lui qu'on répond. */
  affectationId: string;
  prestationId: string;
  reference: string;
  statut: string;
  date: string | null;
  heureRdv: string | null;
  heureDebut: string | null;
  lieu: string | null;
  adresse: string | null;
  client: string | null;
  couverture: string | null;
  fonction: string | null;
  responsable: boolean;
  /** Ce que la personne a répondu à l'invitation. */
  reponse: string;
  remuneration: number | null;
  brief: string | null;
  /** Ce que le club a demandé en propre, quand il l'a écrit. */
  besoin: string | null;
}

/**
 * Mes missions à moi.
 *
 * ON NE FILTRE PAS SUR SON PROPRE IDENTIFIANT : la RLS de `prestations_equipe` borne déjà chaque
 * collaborateur à ses lignes. Ajouter un `eq("collaborateur_id", moi)` ne protégerait de rien de
 * plus et donnerait l'illusion que c'est l'écran qui tient la frontière — la leçon des galeries,
 * le matin même.
 */
export async function lireMesMissions(): Promise<MaMission[]> {
  const { data, error } = await supabase
    .from("prestations_equipe")
    .select(`id, prestation_id, statut, fonction, est_responsable, heure_rdv, remuneration,
             prestations ( reference, statut, date_prestation, heure_debut, lieu, adresse_complete,
                           couverture, brief_cm, description_besoin, clients ( nom ) )`)
    .order("created_at", { ascending: false });
  if (error) throw error;

  type Ligne = {
    id: string; prestation_id: string; statut: string | null; fonction: string | null;
    est_responsable: boolean | null; heure_rdv: string | null; remuneration: number | null;
    prestations: {
      reference: string | null; statut: string | null; date_prestation: string | null;
      heure_debut: string | null; lieu: string | null; adresse_complete: string | null;
      couverture: string | null; brief_cm: string | null; description_besoin: string | null;
      clients: { nom: string | null } | null;
    } | null;
  };

  return ((data ?? []) as unknown as Ligne[])
    .filter((r) => r.prestations)
    .map((r) => ({
      affectationId: String(r.id),
      prestationId: String(r.prestation_id),
      reference: r.prestations!.reference ?? "",
      statut: String(r.prestations!.statut ?? ""),
      date: r.prestations!.date_prestation ?? null,
      heureRdv: r.heure_rdv ?? null,
      heureDebut: r.prestations!.heure_debut ?? null,
      lieu: r.prestations!.lieu ?? null,
      adresse: r.prestations!.adresse_complete ?? null,
      client: r.prestations!.clients?.nom ?? null,
      couverture: r.prestations!.couverture ?? null,
      fonction: r.fonction ?? null,
      responsable: r.est_responsable === true,
      reponse: String(r.statut ?? ""),
      remuneration: typeof r.remuneration === "number" ? r.remuneration : null,
      brief: r.prestations!.brief_cm ?? null,
      besoin: r.prestations!.description_besoin ?? null,
    }))
    // À venir d'abord, du plus proche au plus lointain ; le passé derrière, du plus récent au plus
    // ancien. C'est l'ordre dans lequel on se pose les questions au bord d'un terrain.
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

/**
 * Répondre à une invitation : accepter ou refuser.
 *
 * `.select("id")` : sans lui, un refus de la RLS rend zéro ligne ET zéro erreur, et l'écran
 * annoncerait « accepté » alors que rien n'a bougé.
 */
export async function repondre(affectationId: string, accepte: boolean, motif?: string): Promise<void> {
  const maj: Record<string, unknown> = {
    statut: accepte ? "acceptée" : "refusée",
    date_reponse: new Date().toISOString(),
  };
  if (!accepte && motif?.trim()) maj.notes_refus = motif.trim();

  const { data, error } = await supabase
    .from("prestations_equipe")
    .update(maj)
    .eq("id", affectationId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error("Réponse refusée : cette mission n'est pas la vôtre.");
}
