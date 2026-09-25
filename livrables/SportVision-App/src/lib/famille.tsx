// L'espace du parent : ses enfants, et celui qu'il regarde (22/09/2026).
//
// Un parent peut suivre plusieurs enfants, parfois dans deux clubs. Les trois onglets doivent
// parler du meme enfant au meme moment : la selection vit donc ici, une fois, et pas dans chaque
// ecran. Les droits accordes par le club (voir, telecharger, payer...) viennent de la base et ne
// sont jamais recalcules ici.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { useSession } from "./session";
import type { Evenement } from "./donnees";
import { ErreurChargement, refermerSiPerdue } from "./donnees";
import { EVENEMENTS_DEMO, MODE_DEMO } from "./demonstration";

export interface Sportif {
  kind: "linked" | "managed" | "club";
  refId: string;
  prenom: string;
  nom: string;
  categorie: string | null;
  clubNom: string | null;
  relation: string;
  /** Le club n'a pas encore valide le rattachement : on le dit, on ne masque pas l'enfant. */
  enAttente: boolean;
  peutVoir: boolean;
  peutCalendrier: boolean;
}

export interface DetailSportif {
  clubId: string | null;
  clubNom: string | null;
  clubLogoUrl: string | null;
  equipeId: string | null;
  saisonId: string | null;
  categorie: string | null;
}

interface Contexte {
  sportifs: Sportif[];
  choisi: Sportif | null;
  detail: DetailSportif | null;
  chargement: boolean;
  choisir: (s: Sportif) => void;
  recharger: () => Promise<void>;
}

const Ctx = createContext<Contexte>({
  sportifs: [], choisi: null, detail: null, chargement: true,
  choisir: () => {}, recharger: async () => {},
});

export const useFamille = () => useContext(Ctx);

const CLE = "sportvision.sportif";

export async function lireCalendrierFamille(): Promise<(Evenement & { sportif: string; sportifRef: string })[]> {
  if (MODE_DEMO) {
    return EVENEMENTS_DEMO.map((e) => ({ ...e, sportif: "Lucas", sportifRef: "demo-joueur" }));
  }
  const { data, error } = await supabase.rpc("connect_list_calendar_for_athletes");
  if (error) { await refermerSiPerdue(error); throw new ErreurChargement(error); }
  if (!Array.isArray(data)) return [];
  return data
    .filter((r: Record<string, unknown>) => !!r.event_date)
    .map((r: Record<string, unknown>) => {
      const type = String(r.type ?? "");
      // La base compose le titre : « Déplacement à X » quand l'équipe se déplace, « Match contre
      // X » quand elle reçoit, avec « (reporté) » ou « (annulé) » en fin. On en ressort
      // l'adversaire et le lieu de la rencontre, pour que la carte du parent dise la même chose
      // que celle du joueur au lieu de recopier une phrase entière dans la case « adversaire ».
      const titreBrut = String(r.title ?? "Événement du club");
      const titre = titreBrut.replace(/ \((?:reporté|annulé)\)$/, "");
      const exterieur = titre.startsWith("Déplacement à ");
      const recoit = titre.startsWith("Match contre ");
      const adversaire = exterieur ? titre.slice("Déplacement à ".length)
        : recoit ? titre.slice("Match contre ".length) : null;
      const match = type === "match" || type === "match_reporte" || type === "match_annule";
      return {
        id: `${String(r.source ?? "ev")}-${String(r.id)}-${String(r.athlete_ref_id)}`,
        genre: match ? "match" : type === "entrainement" ? "entrainement"
          : type === "rendez_vous" ? "rendez_vous" : "evenement",
        titre,
        adversaire,
        domicile: exterieur ? false : recoit ? true : undefined,
        statut: type === "match_reporte" ? "reporte" : type === "match_annule" ? "annule" : undefined,
        date: String(r.event_date),
        heure: (r.event_time as string | null) ?? null,
        lieu: (r.location as string | null) ?? null,
        equipe: (r.team as string | null) ?? null,
        score: (r.score as string | null) ?? null,
        sportif: String(r.athlete_label ?? ""),
        sportifRef: String(r.athlete_ref_id ?? ""),
      } as Evenement & { sportif: string; sportifRef: string };
    })
    .sort((a, b) => (a.date === b.date ? (a.heure ?? "").localeCompare(b.heure ?? "") : a.date.localeCompare(b.date)));
}

export function FournisseurFamille({ children }: { children: React.ReactNode }) {
  const { profil, session } = useSession();
  const parent = profil?.espace === "parent";
  const [sportifs, setSportifs] = useState<Sportif[]>([]);
  const [choisi, setChoisi] = useState<Sportif | null>(null);
  const [detail, setDetail] = useState<DetailSportif | null>(null);
  const [chargement, setChargement] = useState(true);

  const recharger = useCallback(async () => {
    if (!parent || !session) { setSportifs([]); setChoisi(null); setChargement(false); return; }
    setChargement(true);
    const { data } = await supabase.rpc("connect_list_my_athletes");
    const liste: Sportif[] = (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
      kind: (r.kind as Sportif["kind"]) ?? "club",
      refId: String(r.ref_id),
      prenom: String(r.first_name ?? ""),
      nom: String(r.last_name ?? ""),
      categorie: (r.categorie as string | null) ?? null,
      clubNom: (r.club_nom as string | null) ?? null,
      relation: String(r.relation_label ?? "Parent"),
      enAttente: r.club_status === "attente",
      peutVoir: r.right_voir !== false,
      peutCalendrier: r.right_calendrier !== false,
    }));
    setSportifs(liste);

    // On rouvre sur le dernier enfant consulte : un parent qui suit deux enfants ne veut pas
    // refaire le choix a chaque ouverture.
    let garde: string | null = null;
    try { garde = await AsyncStorage.getItem(CLE); } catch { /* sans consequence */ }
    setChoisi(liste.find((s) => `${s.kind}:${s.refId}` === garde) ?? liste[0] ?? null);
    setChargement(false);
  }, [parent, session]);

  useEffect(() => { recharger(); }, [recharger]);

  // Le detail porte l'equipe et la saison reelles de l'enfant : sans elles, aucune galerie ne
  // peut lui etre proposee.
  useEffect(() => {
    let vivant = true;
    if (!choisi) { setDetail(null); return; }
    supabase
      .rpc("connect_get_athlete_detail", { p_kind: choisi.kind, p_ref_id: choisi.refId })
      .then(({ data }) => {
        if (!vivant) return;
        const d = data as Record<string, unknown> | null;
        setDetail(d ? {
          clubId: (d.club_id as string | null) ?? null,
          clubNom: (d.club_nom as string | null) ?? null,
          clubLogoUrl: (d.club_logo_url as string | null) ?? null,
          equipeId: (d.team_id as string | null) ?? null,
          saisonId: (d.saison_id as string | null) ?? null,
          categorie: (d.categorie as string | null) ?? null,
        } : null);
      });
    return () => { vivant = false; };
  }, [choisi]);

  const valeur = useMemo<Contexte>(() => ({
    sportifs, choisi, detail, chargement,
    choisir: (s) => {
      setChoisi(s);
      AsyncStorage.setItem(CLE, `${s.kind}:${s.refId}`).catch(() => {});
    },
    recharger,
  }), [sportifs, choisi, detail, chargement, recharger]);

  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}
