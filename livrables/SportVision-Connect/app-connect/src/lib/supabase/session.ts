import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

// Contexte joueur — construit à partir des tables réelles (player_profiles, organizations,
// membership_requests), jamais de données inventées. Un utilisateur sans ligne player_profiles
// n'a simplement pas encore de club (voir edge function connect-player-onboarding, action
// "skip"/pas de player_profiles créée) — état "aucun club", pas une erreur.
//
// Multi-club (04/09/2026, décision produit Fouka — audit transversal) : un compte peut désormais
// avoir PLUSIEURS lignes player_profiles, une par club (contrainte player_user_club_unique,
// migration-multiclub-identity.sql — remplace l'ancienne player_user_unique qui limitait à une
// seule affiliation). Cette fonction reste le SEUL point de résolution du contexte joueur (déjà
// appelé par ~15 écrans) : elle sélectionne une affiliation "active" (la plus récente non
// retirée, ou celle demandée via `preferredClubId`) et expose la liste complète dans
// `otherAffiliations` pour qu'un futur sélecteur puisse basculer — chaque écran existant continue
// de fonctionner tel quel sur l'affiliation active, aucune réécriture des ~15 appelants requise
// pour cette première étape. Un vrai sélecteur multi-club dans l'UI (mirroring le sélecteur
// Moi/enfants de l'Espace particulier) reste un chantier UI à part, noté en suivi.
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
    // Équipe réelle du club (20/08/2026, retour utilisateur — voir /equipes) — team_memberships
    // (peuplée par validate_team_membership côté Club+, RLS tm_player_select : is_own_player),
    // pas membership_requests.team_id qui peut encore être en attente de validation. null tant
    // qu'aucune équipe n'a été validée pour ce joueur, jamais une équipe inventée.
    team: { id: string; name: string } | null;
  } | null;
  // Multi-club (04/09/2026) — les AUTRES affiliations actives de ce compte (hors celle
  // sélectionnée comme `club` ci-dessus), pour un futur sélecteur. Toujours [] pour l'immense
  // majorité des comptes (un seul club), jamais une liste inventée.
  otherAffiliations: { playerId: string; clubId: string; clubName: string }[];
}

export async function buildPlayerContext(
  supabase: SupabaseClient,
  userId: string,
  preferredClubId?: string,
): Promise<PlayerContext | null> {
  const { data: profiles } = await supabase
    .from("player_profiles")
    .select("id, prenom, nom, club_id, account_status, created_at, client_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (!profiles || profiles.length === 0) return null;

  const active = profiles.filter((p) => p.account_status !== "retire");
  const pool = active.length > 0 ? active : profiles;
  const profile = (preferredClubId && pool.find((p) => p.club_id === preferredClubId)) || pool[0]!;

  const otherAffiliationsRaw = pool.filter((p) => p.id !== profile.id);
  let otherAffiliations: PlayerContext["otherAffiliations"] = [];
  if (otherAffiliationsRaw.length > 0) {
    const { data: otherOrgs } = await supabase
      .from("organizations")
      .select("id, nom")
      .in(
        "id",
        otherAffiliationsRaw.map((p) => p.club_id).filter((id): id is string => Boolean(id)),
      );
    otherAffiliations = otherAffiliationsRaw
      .filter((p) => p.club_id)
      .map((p) => ({
        playerId: p.id,
        clubId: p.club_id as string,
        clubName: otherOrgs?.find((o) => o.id === p.club_id)?.nom ?? "",
      }));
  }

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

      let team: { id: string; name: string } | null = null;
      const { data: membership } = await supabase
        .from("team_memberships")
        .select("team_id, club_teams(name)")
        .eq("player_id", profile.id)
        .eq("statut", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (membership?.team_id) {
        const teamRow = membership.club_teams as unknown as { name: string } | null;
        team = { id: membership.team_id, name: teamRow?.name ?? "" };
      }

      club = {
        id: org.id,
        nom: org.nom,
        ville: org.ville,
        status,
        since: request?.created_at || profile.created_at,
        logoUrl: org.logo_url || null,
        team,
      };
    }
  }

  return {
    playerId: profile.id,
    firstName: profile.prenom,
    lastName: profile.nom,
    clientId: profile.client_id ?? null,
    club,
    otherAffiliations,
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
  // Nom d'agence (migration-connect-v69-nom-agence.sql), facultatif — pertinent uniquement pour
  // profil_particulier='agent' (migration-connect-v67), affiché aux sportifs qui ont accepté une
  // relation 'agent' avec ce compte. "" quand non renseigné (même convention que les autres
  // champs texte de cette table).
  nomAgence: string;
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
  nomAgence: "",
};

export async function getProfileSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileSettings> {
  const { data } = await supabase
    .from("connect_profile_settings")
    .select("telephone, sport, poste, categorie, ville, notif_contenus, notif_cotisations, notif_prestations, notif_messages, notif_affiliations, avatar_url, nom_agence")
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
    nomAgence: data.nom_agence || "",
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

// Variante ParticularShell.tsx (client, useEffect) : l'avatar ET profil_particulier (migration-
// connect-v67-distinction-parent-agent.sql §1, pour le vocabulaire de la sidebar "Mes sportifs"/
// "Mes enfants") dans LA MÊME requête — ParticularShell est le seul composant à afficher sur
// TOUTES les routes /particulier/** (contrairement à requireParticulierAccount, qui tourne côté
// serveur par page), donc lire profil_particulier ici plutôt qu'en le passant en prop depuis
// chaque page évite de modifier la vingtaine d'appelants de <ParticularShell>.
export async function getAvatarAndProfilParticulier(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ avatarUrl: string | null; profilParticulier: string | null }> {
  const { data } = await supabase
    .from("connect_profile_settings")
    .select("avatar_url, profil_particulier")
    .eq("user_id", userId)
    .maybeSingle();
  return { avatarUrl: data?.avatar_url || null, profilParticulier: data?.profil_particulier || null };
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
//
// Renvoie aussi `profilParticulier` (colonne connect_profile_settings.profil_particulier,
// migration-connect-v67-distinction-parent-agent.sql) : cette fonction est déjà appelée par
// TOUTE route /particulier/** pour le garde-fou account_type ci-dessus, donc lire
// profil_particulier dans la MÊME requête (plutôt qu'un second select ailleurs) couvre
// gratuitement les écrans qui en ont besoin (Mes sportifs, Accueil particulier) sans requête
// supplémentaire — les appelants qui n'utilisent pas ce champ (la majorité des routes
// /particulier/**) continuent de ne déstructurer que `{ user }`, comme avant.
export async function requireParticulierAccount(
  supabase: SupabaseClient,
): Promise<{ user: User; profilParticulier: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data } = await supabase
    .from("connect_profile_settings")
    .select("account_type, profil_particulier")
    .eq("user_id", user.id)
    .maybeSingle();

  const accountType: AccountType = data?.account_type === "particulier" ? "particulier" : "joueur";
  if (accountType === "joueur") redirect("/dashboard");

  return { user, profilParticulier: data?.profil_particulier ?? null };
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
