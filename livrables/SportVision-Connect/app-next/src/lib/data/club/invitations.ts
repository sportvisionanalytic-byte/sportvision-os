import type { SupabaseClient } from "@supabase/supabase-js";

// Invitations nominatives Club+ (migrations v100/v101) — préparer une personne, lui envoyer un
// lien, la laisser prendre possession de son compte.
//
// ── La règle qui gouverne tout ce fichier ──
// Le club ne crée jamais le compte de la personne. Il crée l'accès POTENTIEL. C'est ce qui permet
// au même compte SportVision d'être coach d'une équipe, parent d'un enfant et acheteur Connect
// sans fabriquer trois identités.
//
// ── Ce qui n'est pas dans l'URL ──
// Le lien ne porte qu'un jeton. Le club, les équipes et le rôle sont résolus côté serveur par
// `lire_invitation_club` / `accepter_invitation_club`. Une URL de la forme `?club=…&role=coach`
// laisserait n'importe qui se nommer coach de n'importe quoi.

export type StatutInvitation = "preparee" | "envoyee" | "acceptee" | "revoquee" | "expiree";

export interface InvitationClub {
  id: string;
  clubId: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  role: string;
  teams: string[];
  token: string;
  statut: StatutInvitation;
  expireAt: string;
  createdAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
}

interface InvitationRow {
  id: string;
  club_id: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  role: string;
  teams: string[] | null;
  token: string;
  statut: string;
  expire_at: string;
  created_at: string;
  sent_at: string | null;
  accepted_at: string | null;
}

/** Une invitation encore ouverte mais dont la date est passée est « expirée » à l'écran, alors
 *  qu'elle vaut toujours « envoyee » en base : l'expiration est une lecture du temps, pas un état
 *  qu'un automate irait réécrire chaque nuit. Même principe que les files du Match Center. */
function statutLisible(row: InvitationRow): StatutInvitation {
  if ((row.statut === "preparee" || row.statut === "envoyee") && Date.parse(row.expire_at) <= Date.now()) {
    return "expiree";
  }
  return row.statut as StatutInvitation;
}

function toInvitation(row: InvitationRow): InvitationClub {
  return {
    id: row.id,
    clubId: row.club_id,
    email: row.email,
    prenom: row.prenom,
    nom: row.nom,
    telephone: row.telephone,
    role: row.role,
    teams: Array.isArray(row.teams) ? row.teams : [],
    token: row.token,
    statut: statutLisible(row),
    expireAt: row.expire_at,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
  };
}

export const STATUT_INVITATION_LABEL: Record<StatutInvitation, string> = {
  preparee: "À inviter",
  envoyee: "Invitation envoyée",
  acceptee: "Actif",
  revoquee: "Révoquée",
  expiree: "Invitation expirée",
};

export const STATUT_INVITATION_TONE: Record<StatutInvitation, "neutral" | "info" | "success" | "warning" | "danger"> = {
  preparee: "neutral",
  envoyee: "info",
  acceptee: "success",
  revoquee: "danger",
  expiree: "warning",
};

/** L'URL à copier ou à envoyer. Club+ pour un encadrant, jamais Connect : un coach administre son
 *  équipe, il n'a rien à faire dans l'espace personnel d'un joueur (§38). */
export function buildInvitationUrl(token: string): string {
  return `https://clubplus.sportvision-an.fr/clubplus/rejoindre?token=${encodeURIComponent(token)}`;
}

export async function fetchClubInvitations(
  supabase: SupabaseClient,
  clubId: string,
): Promise<InvitationClub[]> {
  const { data, error } = await supabase
    .from("club_invitations")
    .select("id, club_id, email, prenom, nom, telephone, role, teams, token, statut, expire_at, created_at, sent_at, accepted_at")
    .eq("club_id", clubId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as InvitationRow[]).map(toInvitation);
}

/** Idempotente côté base sur (club, adresse) : recliquer met à jour la personne sans émettre un
 *  second lien. Le jeton déjà distribué reste donc valable. */
export async function preparerInvitation(
  supabase: SupabaseClient,
  input: {
    clubId: string;
    email: string;
    role: string;
    prenom?: string;
    nom?: string;
    telephone?: string;
    teams?: string[];
  },
): Promise<InvitationClub> {
  const { data, error } = await supabase.rpc("preparer_invitation_club", {
    p_club_id: input.clubId,
    p_email: input.email,
    p_role: input.role,
    p_prenom: input.prenom?.trim() || null,
    p_nom: input.nom?.trim() || null,
    p_telephone: input.telephone?.trim() || null,
    p_teams: input.teams ?? [],
  });
  if (error) throw error;
  return toInvitation(data as InvitationRow);
}

export async function marquerInvitationEnvoyee(supabase: SupabaseClient, id: string): Promise<InvitationClub> {
  const { data, error } = await supabase.rpc("marquer_invitation_envoyee", { p_id: id });
  if (error) throw error;
  return toInvitation(data as InvitationRow);
}

export async function revoquerInvitation(supabase: SupabaseClient, id: string): Promise<InvitationClub> {
  const { data, error } = await supabase.rpc("revoquer_invitation_club", { p_id: id });
  if (error) throw error;
  return toInvitation(data as InvitationRow);
}

export interface InvitationPubliee {
  clubId: string;
  clubNom: string;
  prenom: string | null;
  role: string;
  teams: string[];
  statut: StatutInvitation;
  valide: boolean;
}

/** Ce qu'un visiteur NON connecté voit du lien. Volontairement pauvre : ni adresse e-mail, ni
 *  identité complète — un jeton qui fuite ne doit pas révéler à qui il était destiné. */
export async function lireInvitation(supabase: SupabaseClient, token: string): Promise<InvitationPubliee | null> {
  const { data, error } = await supabase.rpc("lire_invitation_club", { p_token: token });
  if (error) throw error;
  const ligne = Array.isArray(data) ? data[0] : data;
  if (!ligne) return null;
  const r = ligne as {
    club_id: string;
    club_nom: string;
    prenom: string | null;
    role: string;
    teams: string[] | null;
    statut: string;
    valide: boolean;
  };
  return {
    clubId: r.club_id,
    clubNom: r.club_nom,
    prenom: r.prenom,
    role: r.role,
    teams: Array.isArray(r.teams) ? r.teams : [],
    statut: r.statut as StatutInvitation,
    valide: Boolean(r.valide),
  };
}

/** Exige d'être connecté. La base vérifie que l'adresse du compte est bien celle qui a reçu
 *  l'invitation : un lien transféré ne suffit pas à prendre l'administration d'une équipe. */
export async function accepterInvitation(supabase: SupabaseClient, token: string): Promise<void> {
  const { error } = await supabase.rpc("accepter_invitation_club", { p_token: token });
  if (error) throw error;
}

/** Le message écrit par la base, ou un repli. Voir invite-links.ts § messageErreurLien : remplacer
 *  une erreur métier par « réessayez » a coûté plusieurs jours sur les liens joueurs. */
export function messageErreurInvitation(e: unknown, repli: string): string {
  const message = (e as { message?: unknown } | null)?.message;
  if (typeof message !== "string" || !message.trim()) return repli;
  if (/^(TypeError|Failed to fetch|JSON object|column |relation )/i.test(message)) return repli;
  return message;
}

// ── Ce qui existait déjà dans ce fichier, et qui reste ──
// Accepter/refuser une invitation à rejoindre un club — voir migration-clubplus-v45 pour le
// détail des 2 RPC et pourquoi un simple update direct sur club_members ne suffit pas ici : un
// trigger de sécurité bloque volontairement l'auto-modification de role/status par quiconque
// n'est ni le staff OS ni déjà admin du club. Ces deux fonctions sont l'exception historique,
// strictement bornée à « accepter/refuser SA PROPRE invitation en attente ».
//
// Elles ne font PAS double emploi avec `accepterInvitation` ci-dessus : celle-là consomme un
// jeton nominatif reçu par lien, celles-ci répondent à une invitation déjà matérialisée par une
// ligne `club_members` en statut « invitation » (l'ancien chemin, via clubplus-invite).
// Utilisées par components/layout/NoActiveSpace.tsx.

export async function acceptClubInvitation(supabase: SupabaseClient, clubId: string): Promise<void> {
  const { error } = await supabase.rpc("accept_club_invitation", { p_club_id: clubId });
  if (error) throw error;
}

export async function declineClubInvitation(supabase: SupabaseClient, clubId: string): Promise<void> {
  const { error } = await supabase.rpc("decline_club_invitation", { p_club_id: clubId });
  if (error) throw error;
}
