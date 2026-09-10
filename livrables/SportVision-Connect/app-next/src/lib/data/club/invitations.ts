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

/**
 * Le droit d'agir au nom de ce club, tel que la BASE le calcule (fonction `peut_operer_club`,
 * migration v99). Un aller-retour, et aucune règle d'autorisation dupliquée côté écran.
 *
 * C'est la leçon du bug des liens joueurs : l'écran affichait les 43 équipes d'un club et
 * proposait un bouton que la base refusait, parce que deux endroits décidaient séparément de qui
 * a le droit de quoi. Ici, un seul décide, et l'écran se contente de lui demander.
 */
export async function peutOpererClub(supabase: SupabaseClient, clubId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("peut_operer_club", { p_club_id: clubId });
  if (error) return false;
  return data === true;
}

/** La question que pose le trigger `protect_sensitive_club_member_fields` (v114) avant de laisser
 *  toucher à la ligne d'un administrateur, d'un président ou d'un CM externe : l'utilisateur
 *  est-il l'administrateur du club AU SENS STRICT (`club_members.role = 'admin'`) ? Ni le
 *  président, ni le CM délégué ne le sont, par décision du 10/09/2026. */
export async function administreStrictementLeClub(supabase: SupabaseClient, clubId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_real_club_admin", { target_club_id: clubId });
  if (error) return false;
  return data === true;
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

/**
 * Envoie l'invitation par e-mail (edge function `clubplus-envoyer-invitation`).
 *
 * Le canal ne change pas l'invitation : c'est le MÊME jeton que celui du bouton « Copier le
 * lien », la même expiration, la même révocation. Cliquer sur les deux boutons n'émet pas deux
 * invitations.
 *
 * La fonction marque elle-même l'invitation comme envoyée, et seulement si l'e-mail est
 * réellement parti : une invitation affichée comme envoyée alors que rien n'est parti est pire
 * que pas d'invitation du tout, puisque personne ne pense à relancer.
 */
export async function envoyerInvitationParEmail(supabase: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("clubplus-envoyer-invitation", {
    body: { invitation_id: id },
  });
  if (error) {
    // `functions.invoke` réduit toute réponse non-2xx au message générique « non-2xx status
    // code » : le vrai message reste dans la Response brute. Même garde que dans users.ts.
    const contexte = (error as { context?: unknown }).context;
    if (contexte instanceof Response) {
      try {
        const corps = await contexte.clone().json();
        if (corps?.error) throw new Error(corps.error);
      } catch (e) {
        if (e instanceof Error && e.message && !/JSON/i.test(e.message)) throw e;
      }
    }
    throw new Error("Envoi impossible pour le moment.");
  }
  if (data?.error) throw new Error(data.error);
  return (data?.email as string) ?? "";
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
/** La personne a ouvert son lien (v121). Sert au suivi « envoyée » / « ouverte » côté club ;
 *  un échec ne doit jamais gêner la page d'invitation, d'où l'absence d'erreur remontée. */
export async function marquerInvitationOuverte(supabase: SupabaseClient, token: string): Promise<void> {
  await supabase.rpc("marquer_invitation_ouverte", { p_token: token }).then(
    () => undefined,
    () => undefined,
  );
}

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

// ── Le suivi, tous publics confondus ──
// Trois tables, trois destinataires, un seul écran : le club veut savoir qui a rejoint et qui n'a
// pas répondu, pas naviguer entre trois tableaux. La jointure et le contrôle d'accès vivent dans
// `suivi_invitations_club` (migration v104), pas ici.

export type GenreInvitation = "encadrant" | "joueur" | "parent";

export interface LigneSuivi {
  id: string;
  genre: GenreInvitation;
  email: string;
  personne: string | null;
  roleOuEquipe: string;
  statut: string;
  envoyeeLe: string | null;
  creeeLe: string;
}

export const GENRE_LABEL: Record<GenreInvitation, string> = {
  encadrant: "Coach ou dirigeant",
  joueur: "Joueur",
  parent: "Parent",
};

/** Les statuts des trois tables ne se ressemblent pas — « preparee/envoyee/acceptee/revoquee »
 *  pour un encadrant, « envoyee/acceptee/expiree/annulee » pour une famille. On les ramène à un
 *  vocabulaire unique, celui du club : ce qu'il a à faire, pas comment c'est stocké. */
export function statutLisibleSuivi(statut: string): { label: string; ton: "neutral" | "info" | "success" | "warning" | "danger" } {
  switch (statut) {
    case "preparee":
      return { label: "À envoyer", ton: "neutral" };
    case "envoyee":
      return { label: "Envoyée", ton: "info" };
    case "acceptee":
      return { label: "A rejoint", ton: "success" };
    case "expiree":
      return { label: "Expirée", ton: "warning" };
    case "revoquee":
    case "annulee":
      return { label: "Annulée", ton: "danger" };
    default:
      return { label: statut, ton: "neutral" };
  }
}

export async function fetchSuiviInvitations(supabase: SupabaseClient, clubId: string): Promise<LigneSuivi[]> {
  const { data, error } = await supabase.rpc("suivi_invitations_club", { p_club_id: clubId });
  if (error) throw error;
  return ((data ?? []) as {
    id: string; genre: string; email: string; personne: string | null;
    role_ou_equipe: string; statut: string; envoyee_le: string | null; creee_le: string;
  }[]).map((r) => ({
    id: r.id,
    genre: r.genre as GenreInvitation,
    email: r.email,
    personne: r.personne,
    roleOuEquipe: r.role_ou_equipe,
    statut: r.statut,
    envoyeeLe: r.envoyee_le,
    creeeLe: r.creee_le,
  }));
}

/** Annule une invitation de joueur ou de parent. Une invitation annulée reste visible dans le
 *  suivi : la supprimer ferait oublier au club qu'il a écrit à quelqu'un. */
export async function annulerInvitationFamille(
  supabase: SupabaseClient,
  id: string,
  genre: "joueur" | "parent",
): Promise<void> {
  const { error } = await supabase.rpc("annuler_invitation_famille", { p_id: id, p_genre: genre });
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

/** Coach principal ou adjoint (v124) : un libellé posé sur l'invitation, recopié sur le membre à
 *  l'acceptation. Il ne change aucun droit. */
export async function definirFonctionInvitation(
  supabase: SupabaseClient,
  invitationId: string,
  fonction: "principal" | "adjoint" | null,
): Promise<void> {
  const { data, error } = await supabase.from("club_invitations").update({ fonction }).eq("id", invitationId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Modification refusée : droits insuffisants sur cette invitation.");
}
