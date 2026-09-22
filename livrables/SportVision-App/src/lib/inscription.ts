// Créer son compte depuis l'application (22/09/2026).
//
// Le site fait ça en quatre pages ; ici, une seule, en trois temps. Mais le mécanisme est
// exactement le même, et c'est volontaire : la confirmation d'e-mail est active sur ce projet,
// donc `signUp()` ne rend aucune session. Impossible d'écrire quoi que ce soit dans la base à cet
// instant. On range donc l'intention dans les métadonnées du compte, et on la rejoue à la
// première connexion réelle. Un compte créé dans l'application et confirmé sur un autre appareil
// retrouve quand même son club.
import { supabase } from "./supabase";

/** La clé que le site utilise déjà. Ne pas la renommer : les deux mondes doivent se relire. */
const CLE_META_INSCRIPTION = "sv_inscription";
const CLE_META_REJOUEE = "sv_inscription_rejouee";

export type Profil = "joueur" | "parent";

export interface ClubTrouve {
  id: string;
  nom: string;
  ville: string | null;
}

export interface Intention {
  action: "join" | "declare" | "skip";
  orgId?: string;
  orgName?: string;
  name?: string;
  city?: string;
  team?: string;
  prenom?: string;
  nom?: string;
  dateNaissance?: string;
  accountType?: "joueur" | "particulier";
  profilParticulier?: "parent";
  email?: string;
}

/** Recherche d'un club par son nom. La fonction serveur cherche dans l'annuaire fédéral. */
export async function chercherClubs(recherche: string): Promise<ClubTrouve[]> {
  const q = recherche.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.functions.invoke("connect-player-onboarding", {
    body: { action: "search", query: q },
  });
  if (error || data?.error) return [];
  return (data?.results ?? []) as ClubTrouve[];
}

export interface DemandeCompte {
  profil: Profil;
  prenom: string;
  nom: string;
  email: string;
  motDePasse: string;
  /** Obligatoire pour un joueur : la fiche joueur ne peut pas exister sans date de naissance. */
  dateNaissance?: string;
  clubChoisi?: ClubTrouve | null;
  clubDeclare?: { nom: string; ville: string; equipe: string } | null;
}

export type ResultatInscription =
  | { ok: true }
  | { ok: false; dejaInscrit?: boolean; message: string };

export async function creerCompte(d: DemandeCompte): Promise<ResultatInscription> {
  const email = d.email.trim().toLowerCase();
  const prenom = d.prenom.trim();
  const nom = d.nom.trim();
  const joueur = d.profil === "joueur";

  let intention: Intention;
  if (joueur && d.clubChoisi) {
    intention = {
      action: "join", orgId: d.clubChoisi.id, orgName: d.clubChoisi.nom,
      prenom, nom, dateNaissance: d.dateNaissance, accountType: "joueur",
    };
  } else if (joueur && d.clubDeclare) {
    intention = {
      action: "declare", name: d.clubDeclare.nom, city: d.clubDeclare.ville,
      team: d.clubDeclare.equipe, prenom, nom, dateNaissance: d.dateNaissance,
      accountType: "joueur",
    };
  } else if (joueur) {
    intention = { action: "skip", accountType: "joueur", prenom, nom, dateNaissance: d.dateNaissance };
  } else {
    intention = { action: "skip", accountType: "particulier", profilParticulier: "parent" };
  }
  intention = { ...intention, email };

  const { data, error } = await supabase.auth.signUp({
    email,
    password: d.motDePasse,
    options: {
      data: { first_name: prenom, last_name: nom, [CLE_META_INSCRIPTION]: intention },
      emailRedirectTo: "https://connect.sportvision-an.fr/auth/callback",
    },
  });

  if (error) {
    const deja = error.code === "user_already_exists" || /already/i.test(error.message);
    return {
      ok: false,
      dejaInscrit: deja,
      message: deja
        ? "Un compte SportVision utilise déjà cette adresse."
        : /password/i.test(error.message)
          ? "Mot de passe trop court : huit caractères au minimum."
          : "La création du compte a échoué. Réessayez dans un instant.",
    };
  }

  // Adresse déjà inscrite ET confirmée : Supabase répond 200 avec une liste d'identités vide,
  // pour ne pas révéler qu'un compte existe. Sans cette vérification, l'écran annoncerait un
  // e-mail qui ne partira jamais, et la personne attendrait indéfiniment.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { ok: false, dejaInscrit: true, message: "Un compte SportVision utilise déjà cette adresse." };
  }

  return { ok: true };
}

/**
 * Rejoue l'intention rangée à l'inscription, à la première connexion réelle. Idempotent : une
 * marque est posée sur le compte une fois l'intention consommée, sinon une seconde connexion
 * créerait une deuxième demande d'adhésion au même club.
 */
export async function rejouerInscription(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  if (meta[CLE_META_REJOUEE] === true) return;
  const brut = meta[CLE_META_INSCRIPTION];
  if (!brut || typeof brut !== "object") return;
  const intention = brut as Intention;

  // L'espace (joueur ou particulier) d'abord : un échec de rattachement au club ne doit pas
  // laisser un parent dans l'espace joueur.
  if (intention.accountType) {
    const charge: Record<string, unknown> = { user_id: user.id, account_type: intention.accountType };
    if (intention.profilParticulier) charge.profil_particulier = intention.profilParticulier;
    const { error } = await supabase
      .from("connect_profile_settings").upsert(charge, { onConflict: "user_id" });
    if (error) return; // on retentera à la prochaine connexion, rien n'est perdu
  }

  const { data, error } = await supabase.functions.invoke("connect-player-onboarding", {
    body: {
      action: intention.action,
      orgId: intention.orgId,
      name: intention.name,
      city: intention.city,
      team: intention.team,
      prenom: intention.prenom,
      nom: intention.nom,
      dateNaissance: intention.dateNaissance,
    },
  });
  if (error || data?.error) return;

  await supabase.auth
    .updateUser({ data: { [CLE_META_INSCRIPTION]: null, [CLE_META_REJOUEE]: true } })
    .catch(() => null);
}
