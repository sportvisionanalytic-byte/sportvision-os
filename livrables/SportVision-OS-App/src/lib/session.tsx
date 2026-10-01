// QUI EST CONNECTÉ, DANS L'OS (30/09/2026).
//
// Cette application n'est pas celle des familles. Ici, tout le monde est de SportVision : un
// opérateur terrain, un responsable de production, un community manager, la comptabilité,
// l'administration. L'identité tient donc dans une seule ligne : `profiles`, et son rôle.
//
// C'EST LE RÔLE QUI DESSINE L'APPLICATION. Dix comptes sur dix-huit sont des photographes-
// opérateurs : ce sont eux qui sont dehors, au bord d'un terrain, avec un téléphone dans la poche.
// Deux sont en production. Les écrans suivent cette réalité, pas l'organigramme.
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { viderCache } from "./cache";
import { activerPush, desactiverPush } from "./push";

/** Les rôles réels de `profiles`, mesurés en base le 30/09/2026. */
export type RoleOS = "admin" | "prod" | "photo" | "cm" | "com" | "sec" | "compta";

export interface Moi {
  id: string;
  prenom: string;
  nom: string;
  role: RoleOS | null;
  /** Le libellé qu'on montre. Jamais l'identifiant technique du rôle. */
  metier: string;
  /**
   * La photo de profil, au format que l'OS écrit : `data:image/jpeg;base64,…`.
   *
   * ELLE EST ICI PARCE QUE « MON ESPACE » L'AFFICHE DÈS L'OUVERTURE (01/10/2026). La lire depuis
   * l'écran aurait montré les initiales une demi-seconde, puis la photo : un clignotement à
   * chaque passage sur l'onglet. Mesuré : entre 4,5 et 10 kilo-octets par avatar, cinq profils
   * sur dix-neuf en portent un. C'est une ligne déjà lue, pas une requête de plus.
   */
  avatarUrl: string | null;
}

const METIERS: Record<string, string> = {
  admin: "Administration",
  prod: "Responsable production",
  photo: "Opérateur terrain",
  cm: "Community manager",
  com: "Communication",
  sec: "Secrétariat",
  compta: "Comptabilité",
};

/** Qui administre : voit tout, partout. */
export function estDirection(r: RoleOS | null): boolean {
  return r === "admin" || r === "sec" || r === "com";
}
/** Qui pilote la production : le cockpit des missions est son écran. */
export function estProduction(r: RoleOS | null): boolean {
  return r === "prod" || r === "admin";
}
/** Qui va sur le terrain : ses missions à lui, et rien d'autre. */
export function estOperateur(r: RoleOS | null): boolean {
  return r === "photo";
}

interface Contexte {
  session: Session | null;
  moi: Moi | null;
  chargement: boolean;
  rafraichir: () => Promise<void>;
  deconnexion: () => Promise<void>;
}

const Ctx = createContext<Contexte>({
  session: null, moi: null, chargement: true,
  rafraichir: async () => {}, deconnexion: async () => {},
});

export const useSession = () => useContext(Ctx);

async function lireMoi(userId: string): Promise<Moi | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, prenom, nom, role, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const role = (data.role ?? null) as RoleOS | null;
  return {
    id: String(data.id),
    prenom: (data.prenom ?? "").trim(),
    nom: (data.nom ?? "").trim(),
    role,
    avatarUrl: ((data as { avatar_url?: string | null }).avatar_url ?? null) || null,
    // Un rôle absent de la table ne se traduit pas en métier inventé : on dit « SportVision », ce
    // qui est vrai de tout le monde ici, plutôt qu'un intitulé qui n'existe pas.
    metier: (role && METIERS[role]) || "SportVision",
  };
}

export function FournisseurSession({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [moi, setMoi] = useState<Moi | null>(null);
  const [chargement, setChargement] = useState(true);

  async function charger(s: Session | null) {
    setSession(s);
    if (!s?.user) { setMoi(null); setChargement(false); return; }
    try { setMoi(await lireMoi(s.user.id)); }
    // Un profil illisible ne doit pas bloquer l'application sur une roue : on montre l'écran, qui
    // saura dire qu'il n'a rien, plutôt qu'un chargement sans fin.
    catch { setMoi(null); }
    finally { setChargement(false); }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => charger(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((evenement, s) => {
      // La mémoire des écrans meurt avec la session : deux personnes de l'équipe sur le même
      // téléphone — ce qui arrive un jour de tournage — et la seconde verrait les missions de la
      // première.
      if (evenement === "SIGNED_OUT" || evenement === "SIGNED_IN" || evenement === "USER_UPDATED") {
        viderCache();
      }
      // LE PUSH S'ACTIVE UNE FOIS CONNECTE, ET PAS AVANT. Une application qui reclame les
      // notifications sur son premier ecran se fait refuser, et iOS ne redemande jamais : le refus
      // est definitif jusqu'a ce que la personne aille le changer dans les Reglages. Ici, on sait
      // qui on est et a quoi ca sert.
      //
      // On n'attend PAS le resultat : l'autorisation ouvre une boite de dialogue systeme, et faire
      // dependre l'affichage des ecrans d'un doigt sur « Autoriser » bloquerait l'application
      // derriere une roue tant que la personne n'a pas repondu.
      if (evenement === "SIGNED_IN") void activerPush();
      charger(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const valeur = useMemo<Contexte>(() => ({
    session, moi, chargement,
    rafraichir: async () => {
      const { data } = await supabase.auth.getSession();
      await charger(data.session);
    },
    deconnexion: async () => {
      // ETEINDRE L'APPAREIL AVANT DE PARTIR. Sans ca, un telephone rendu ou pret a un collegue
      // continue de recevoir les missions de son ancien proprietaire, sur son ecran verrouille.
      // On l'eteint d'abord : apres `signOut`, la RLS refuserait l'ecriture.
      await desactiverPush();
      await supabase.auth.signOut();
    },
  }), [session, moi, chargement]);

  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}
