import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

// Contexte joueur — construit à partir des tables réelles (player_profiles, organizations,
// membership_requests), jamais de données inventées. Un utilisateur sans ligne player_profiles
// n'a simplement pas encore de club (voir edge function connect-player-onboarding, action
// "skip"/pas de player_profiles créée) — état "aucun club", pas une erreur.
//
// Une seule affiliation à la fois : `player_profiles.club_id` est un champ unique (pas une
// table de relation many-to-many). Le vrai modèle "plusieurs affiliations" du nouveau design
// (master doc Partie VI, table conceptuelle `player_affiliations`) n'existe pas encore côté
// backend — construire cette table maintenant dupliquerait la source de vérité utilisée par
// app-next/Club+ (qui lit exclusivement player_profiles/membership_requests) sans les
// synchroniser, exactement ce que le master doc interdit ("un seul objet métier"). Cette page
// gère donc la SEULE affiliation réelle possible aujourd'hui — l'extension multi-club est un
// chantier de schéma à part entière, à trancher explicitement avec Fouka avant de coder.
//
// "Quitter" une affiliation : `player_profiles.club_id` est NOT NULL, donc impossible de le
// vider. On réutilise `account_status = 'retire'` (déjà dans la contrainte CHECK réelle,
// confirmé en direct) — vérifié que app-next traite déjà tout account_status ≠ 'actif' comme
// non-actif (lib/supabase/session.ts:304 : `account_status === "actif" ? "active" : "disabled"`),
// donc un joueur qui quitte disparaît bien des rosters actifs côté club sans code à modifier
// ailleurs.

export interface PlayerContext {
  playerId: string | null;
  firstName: string;
  lastName: string;
  // Résolu par resolve_player_client_id() (migration-connect-v43), lazy — null tant que le
  // joueur n'a jamais ouvert un module qui en a besoin (Messages, Prestations). Ne JAMAIS
  // appeler resolve_player_client_id() depuis une simple lecture (Accueil) : ça créerait une
  // ligne `clients` fantôme à chaque visite d'un joueur qui n'a encore rien demandé.
  clientId: string | null;
  club: {
    id: string;
    nom: string;
    ville: string | null;
    since: string;
    // "affilie" = demande validée · "attente" = demande pas encore traitée · "refuse" = refusée
    status: "affilie" | "attente" | "refuse";
    // URL publique du logo club (colonne organizations.logo_url, migration-connect-v66),
    // synchronisée depuis clubs.logo_url à chaque upload côté Club+. null tant qu'aucun logo
    // n'a jamais été uploadé — jamais une erreur, juste un club sans logo pour l'instant.
    logoUrl: string | null;
  } | null;
}

export async function buildPlayerContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<PlayerContext | null> {
  const { data: profile } = await supabase
    .from("player_profiles")
    .select("id, prenom, nom, club_id, account_status, created_at, client_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) return null;

  let club: PlayerContext["club"] = null;
  if (profile.club_id && profile.account_status !== "retire") {
    const { data: org } = await supabase
      .from("organizations")
      .select("id, nom, ville, logo_url")
      .eq("id", profile.club_id)
      .maybeSingle();

    if (org) {
      const { data: request } = await supabase
        .from("membership_requests")
        .select("statut, created_at")
        .eq("player_id", profile.id)
        .eq("club_id", profile.club_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const statut = request?.statut;
      const status: "affilie" | "attente" | "refuse" =
        statut === "validee" ? "affilie" : statut === "refusee" ? "refuse" : "attente";

      club = {
        id: org.id,
        nom: org.nom,
        ville: org.ville,
        status,
        since: request?.created_at || profile.created_at,
        logoUrl: org.logo_url || null,
      };
    }
  }

  return {
    playerId: profile.id,
    firstName: profile.prenom,
    lastName: profile.nom,
    clientId: profile.client_id ?? null,
    club,
  };
}

// Identité affichée/éditable dans Mon profil. Prénom/Nom/E-mail viennent de auth.users (source
// de vérité pour TOUT compte Connect, avec ou sans club — voir migration-connect-personnel-
// accueil-profil-acces.sql §1) ; player_profiles, quand il existe, ne fait que les recopier
// depuis l'inscription et n'est jamais la seule source (sinon un utilisateur sans club n'aurait
// aucune identité éditable).
export interface DisplayIdentity {
  firstName: string;
  lastName: string;
  email: string;
}

export function resolveDisplayIdentity(
  user: { email?: string | null; user_metadata?: Record<string, unknown> },
  player: PlayerContext | null,
): DisplayIdentity {
  const meta = user.user_metadata || {};
  const firstName = player?.firstName || (typeof meta.first_name === "string" ? meta.first_name : "") || user.email?.split("@")[0] || "";
  const lastName = player?.lastName || (typeof meta.last_name === "string" ? meta.last_name : "") || "";
  return { firstName, lastName, email: user.email || "" };
}

// Profil sportif + notifications — table connect_profile_settings (migration ci-dessus §1).
// Toujours une valeur par défaut : l'absence de ligne n'est pas un état d'erreur, juste un
// utilisateur qui n'a encore rien personnalisé (mêmes valeurs par défaut que le design de
// référence : contenus/cotisations/prestations/messages activés, affiliations désactivé).
export interface ProfileSettings {
  telephone: string;
  sport: string;
  poste: string;
  categorie: string;
  ville: string;
  notifContenus: boolean;
  notifCotisations: boolean;
  notifPrestations: boolean;
  notifMessages: boolean;
  notifAffiliations: boolean;
  // Photo de profil (migration-connect-v55-photo-profil.sql) — URL publique du bucket
  // portail-media (chemin avatars/<user_id>/...), null tant que rien n'est uploadé.
  avatarUrl: string | null;
}

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  telephone: "",
  sport: "",
  poste: "",
  categorie: "",
  ville: "",
  notifContenus: true,
  notifCotisations: true,
  notifPrestations: true,
  notifMessages: true,
  notifAffiliations: false,
  avatarUrl: null,
};

export async function getProfileSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileSettings> {
  const { data } = await supabase
    .from("connect_profile_settings")
    .select("telephone, sport, poste, categorie, ville, notif_contenus, notif_cotisations, notif_prestations, notif_messages, notif_affiliations, avatar_url")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return DEFAULT_PROFILE_SETTINGS;

  return {
    telephone: data.telephone || "",
    sport: data.sport || "",
    poste: data.poste || "",
    categorie: data.categorie || "",
    ville: data.ville || "",
    notifContenus: data.notif_contenus,
    notifCotisations: data.notif_cotisations,
    notifPrestations: data.notif_prestations,
    notifMessages: data.notif_messages,
    notifAffiliations: data.notif_affiliations,
    avatarUrl: data.avatar_url || null,
  };
}

// Lecture légère (une seule colonne) pour l'avatar affiché dans les shells (AppShell/
// ParticularShell/Topbar) — évite de dupliquer tout getProfileSettings() juste pour une URL.
export async function getAvatarUrl(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("connect_profile_settings")
    .select("avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.avatar_url || null;
}

// Type de compte (Espace joueur vs. Espace particulier) — colonne connect_profile_settings.
// account_type (migration-connect-v51-espace-particulier.sql §1). Défaut 'joueur' si aucune
// ligne n'existe encore (comportement inchangé pour tout compte créé avant cette migration —
// aucune régression) ou si le rejeu du pending onboarding (lib/signup/pending-onboarding.ts)
// n'a jamais pu s'exécuter (localStorage vidé avant le premier login, par exemple) : dans ce
// cas de bord documenté au rapport final, l'utilisateur atterrit sur l'Espace joueur par défaut
// plutôt que sur une page blanche.
export type AccountType = "joueur" | "particulier";

export async function getAccountType(supabase: SupabaseClient, userId: string): Promise<AccountType> {
  const { data } = await supabase
    .from("connect_profile_settings")
    .select("account_type")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.account_type === "particulier" ? "particulier" : "joueur";
}

// Garde-fou centralisé Espace joueur — voir dashboard/page.tsx (seule route qui vérifiait déjà
// account_type avant ce chantier). Toutes les routes sous l'Espace joueur (AppShell) doivent
// appeler ce helper au lieu de répéter `if (!user) redirect(...)` : un compte 'particulier' qui
// ouvre une URL de l'Espace joueur directement/via favori (le bouton Aide de la Topbar, partagé
// entre les deux shells, en est un exemple réel) était jusqu'ici scotché dans toute la navigation
// Joueur sans jamais être redirigé, puisque seule /dashboard revérifiait account_type. Bug
// corrigé le 15/08 — voir rapport final pour la liste complète des routes protégées.
//
// `loginRedirectTo`, optionnel, préserve le comportement existant de
// /equipes/rejoindre/[id] (`redirect("/auth/login?next=/equipes/rejoindre/" + id)`), seule route
// à avoir un besoin de "next" réel — toutes les autres redirigent vers "/auth/login" nu.
export async function requireJoueurAccount(
  supabase: SupabaseClient,
  loginRedirectTo?: string,
): Promise<{ user: User }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(loginRedirectTo ? `/auth/login?next=${encodeURIComponent(loginRedirectTo)}` : "/auth/login");
  }

  const accountType = await getAccountType(supabase, user.id);
  if (accountType === "particulier") redirect("/particulier");

  return { user };
}

// Symétrique de requireJoueurAccount() pour l'Espace particulier (ParticularShell) — même trou
// trouvé en miroir en creusant ce chantier : chaque route /particulier/** ne vérifiait que
// l'authentification, jamais account_type, donc un compte 'joueur' pouvait ouvrir n'importe
// quelle URL /particulier/* directement/via favori sans être redirigé vers son propre espace.
export async function requireParticulierAccount(supabase: SupabaseClient): Promise<{ user: User }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const accountType = await getAccountType(supabase, user.id);
  if (accountType === "joueur") redirect("/dashboard");

  return { user };
}

// "Mes espaces" (Mon profil) ne doit apparaître QUE si un accès Club+ existe réellement — jamais
// un cadenas décoratif (principe déjà établi dans ce projet). club_members est le roster
// staff/dirigeants de Club+ (rôle admin/president/... — voir migration-clubplus-v1.sql), donc sa
// présence est le seul signal fiable d'un accès Club+ réel pour cet utilisateur.
export interface ClubPlusAccess {
  clubId: string;
  clubNom: string;
  role: string;
}

export async function getClubPlusAccess(
  supabase: SupabaseClient,
  userId: string,
): Promise<ClubPlusAccess | null> {
  const { data } = await supabase
    .from("club_members")
    .select("role, club_id, clubs(nom)")
    .eq("user_id", userId)
    .eq("status", "actif")
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const clubs = data.clubs as unknown as { nom: string } | { nom: string }[] | null;
  const clubNom = Array.isArray(clubs) ? clubs[0]?.nom : clubs?.nom;
  if (!clubNom) return null;

  return { clubId: data.club_id, clubNom, role: data.role };
}
