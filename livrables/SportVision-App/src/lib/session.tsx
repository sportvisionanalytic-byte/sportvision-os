// Qui est connecte, et ce que l'application a le droit de lui montrer (22/09/2026).
//
// Le site decide de l'espace a partir de ce que la base sait de la personne : une fiche joueur,
// un lien parent-enfant, une appartenance a un club. On refait ici le meme raisonnement, avec les
// memes fonctions serveur — pas une regle inventee cote application, qui finirait un jour par
// dire autre chose que le site.
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { rejouerInscription } from "./inscription";

export type Espace = "joueur" | "parent" | "aucun";

export interface Profil {
  espace: Espace;
  prenom: string;
  /** player_profiles.id du joueur connecte, quand c'en est un. */
  playerId?: string;
  clubId?: string;
  clubNom?: string;
  clubLogoUrl?: string;
  equipeNom?: string;
  equipeId?: string;
  /** La saison de l'affiliation reelle, pas celle affichee par le club. Peut manquer : les
   *  galeries la traitent alors comme « toutes saisons » (leçon de la v248). */
  saisonId?: string | null;
  /** L'affiliation est-elle validee par le club ? Sinon, il ne voit encore presque rien. */
  affilie: boolean;
}

interface Contexte {
  session: Session | null;
  profil: Profil | null;
  chargement: boolean;
  rafraichir: () => Promise<void>;
  deconnexion: () => Promise<void>;
}

const Ctx = createContext<Contexte>({
  session: null, profil: null, chargement: true,
  rafraichir: async () => {}, deconnexion: async () => {},
});

export const useSession = () => useContext(Ctx);

async function lireProfil(userId: string): Promise<Profil> {
  // Joueur : sa fiche, puis son club. Le club se lit dans `organizations` (et nulle part
  // ailleurs) : `clubs` existe mais n'est pas la table que le site interroge, et un joueur n'y a
  // pas acces — la requete revient vide sans erreur, et l'ecran affiche « rejoignez votre club »
  // a quelqu'un qui en a deja un.
  const { data: fiches } = await supabase
    .from("player_profiles")
    .select("id, prenom, nom, club_id, account_status, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const vivantes = (fiches ?? []).filter((f) => f.account_status !== "retire");
  const fiche = vivantes[0] ?? (fiches ?? [])[0];

  if (fiche) {
    const [org, demande, equipe] = await Promise.all([
      fiche.club_id
        ? supabase.from("organizations").select("id, nom, ville, logo_url").eq("id", fiche.club_id).maybeSingle()
        : Promise.resolve({ data: null }),
      // « Validee » et rien d'autre : une demande en attente ne donne acces a aucune galerie, et
      // l'ecran doit pouvoir le dire au lieu d'afficher un espace vide sans explication.
      supabase
        .from("membership_requests")
        .select("statut")
        .eq("player_id", fiche.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("team_memberships")
        .select("team_id, saison_id, club_teams(name)")
        .eq("player_id", fiche.id)
        .eq("statut", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const club = org.data as { id?: string; nom?: string; logo_url?: string } | null;
    // L'ecusson vit dans `clubs.ecusson_url` : c'est la source que la fiche du parent utilise
    // deja (v249). `organizations.logo_url` est souvent vide, et un club sans ecusson affichait
    // ses initiales alors que son ecusson existait.
    // La table `clubs` est fermee en lecture : on passe par club_identite (v252), qui ne rend
    // que le nom, la ville et l'ecusson, et seulement a quelqu'un du club.
    let ecusson: string | null = club?.logo_url ?? null;
    if (fiche.club_id) {
      const { data: ident } = await supabase.rpc("club_identite", { p_club_id: fiche.club_id });
      const ligne = (Array.isArray(ident) ? ident[0] : null) as { ecusson_url?: string | null } | null;
      ecusson = ligne?.ecusson_url || ecusson;
    }
    const eq = equipe.data as { team_id?: string; saison_id?: string | null; club_teams?: { name?: string } | null } | null;
    return {
      espace: "joueur",
      prenom: fiche.prenom ?? "",
      playerId: fiche.id,
      clubId: club?.id ?? (fiche.club_id as string | undefined),
      clubNom: club?.nom,
      clubLogoUrl: ecusson ?? undefined,
      equipeNom: (eq?.club_teams as unknown as { name?: string } | null)?.name,
      equipeId: eq?.team_id,
      saisonId: eq?.saison_id ?? null,
      affilie: (demande.data as { statut?: string } | null)?.statut === "validee",
    };
  }

  // Parent : la fonction du site fait deja tout le travail, y compris les droits accordes.
  const { data: sportifs } = await supabase.rpc("connect_list_my_athletes");
  if (Array.isArray(sportifs) && sportifs.length > 0) {
    const { data: pf } = await supabase
      .from("parent_profiles").select("prenom").eq("user_id", userId).maybeSingle();
    return { espace: "parent", prenom: pf?.prenom ?? "", affilie: true };
  }

  return { espace: "aucun", prenom: "", affilie: false };
}

export function FournisseurSession({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profil, setProfil] = useState<Profil | null>(null);
  const [chargement, setChargement] = useState(true);

  async function charger(s: Session | null) {
    setSession(s);
    if (!s?.user) { setProfil(null); setChargement(false); return; }
    // Une inscription faite dans l'application n'a rien pu ecrire avant la confirmation de
    // l'e-mail : c'est ici, a la premiere session reelle, que son club est enfin demande.
    try { await rejouerInscription(); } catch { /* retente a la prochaine ouverture */ }
    try { setProfil(await lireProfil(s.user.id)); }
    // Un profil illisible ne doit pas bloquer l'application sur un ecran gris : on montre l'espace
    // vide, qui saura dire qu'il n'y a rien, plutot qu'une roue qui tourne indefiniment.
    catch { setProfil({ espace: "aucun", prenom: "", affilie: false }); }
    finally { setChargement(false); }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => charger(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => charger(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const valeur = useMemo<Contexte>(() => ({
    session, profil, chargement,
    rafraichir: async () => {
      const { data } = await supabase.auth.getSession();
      await charger(data.session);
    },
    deconnexion: async () => { await supabase.auth.signOut(); },
  }), [session, profil, chargement]);

  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}
