import type { SupabaseClient } from "@supabase/supabase-js";
import type { Match, MatchScorer, MatchStatus } from "@/lib/types/studio";

// club_matches (migration-clubplus-v3.sql) — 5 statuts réels depuis migration-clubplus-v37.sql
// (a_venir/a_transmettre/recu/reportee/annulee), contrainte check en base : "content_created" (6e
// statut du design, purement un marqueur Connect "visuel généré") n'a PAS d'équivalent réel et ne
// doit JAMAIS être écrit dans `status` (violerait la contrainte). Voir fetchClubMatches/
// saveClubMatchResult. RLS : is_club_member(club_id) + is_team_educateur(team_id) (fonction
// existante depuis migration-clubplus-v13.sql, déjà utilisée par team_memberships/membership_
// requests) pour select/insert/update (migration-clubplus-v37.sql).
//
// competition/is_home/attendance/assists/cards/comment : colonnes ajoutées par
// migration-clubplus-v34-match-champs-complementaires.sql (exécutée par Fouka le 09/08/2026) —
// réintègre les champs du formulaire complet retirés lors de l'audit du même jour, désormais
// réellement persistés.
//
// verified_by/verified_at (migration-clubplus-v37.sql) : colonnes du workflow de vérification
// Directeur sportif (§8) — voir verifyClubMatchResult ci-dessous. Désormais sélectionnées par
// fetchClubMatches/fetchClubMatchById et exposées sur Match (types/studio.ts), consommées par
// matchcenter/page.tsx (bouton "Vérifier le résultat", chantier "Autres rôles Club+" du
// 17/08/2026).
//
// team_id (migration-clubplus-v37.sql, référence club_teams) : gap corrigé le 17/08/2026 —
// jusque-là aucune UI de ce repo ne le lisait ni ne l'écrivait (toMatch hardcodait `teamId: ""`),
// ce qui rendait la RLS équipe-level (cma_member_select/update, is_team_educateur(team_id))
// inopérante en pratique : tout match restait team_id=NULL, donc visible/modifiable par tout
// membre du club. Désormais réellement sélectionné ; voir assignClubMatchTeam ci-dessous pour
// l'action d'assignation (réservée Admin/Directeur sportif côté UI dans matchcenter/page.tsx — la
// vraie frontière reste la RLS, voir son docstring).
//
// 16/08/2026 : saveClubMatchResult accepte désormais un statut cible explicite ("completed" /
// "postponed" / "cancelled") — auparavant la fonction forçait toujours status="recu", il n'existait
// aucun moyen d'écrire "reportee"/"annulee" bien que la contrainte check et le mapping de lecture
// les supportent déjà (migration-clubplus-v37.sql). Voir MatchResultModal.tsx pour l'UI.

export const STATUS_MAP: Record<string, MatchStatus> = {
  a_venir: "upcoming",
  a_transmettre: "result_pending",
  recu: "result_received",
  reportee: "postponed",
  annulee: "cancelled",
};

/** Statut cible d'une action de saisie — distinct de MatchStatus (design, 6 valeurs) : ne couvre
 * que les 3 issues qu'une action de ce module peut réellement déclencher. */
export type MatchOutcome = "completed" | "postponed" | "cancelled";

const WRITE_STATUS_MAP: Record<MatchOutcome, string> = {
  completed: "recu",
  postponed: "reportee",
  cancelled: "annulee",
};

interface ClubMatchRow {
  id: string;
  team: string;
  opponent: string;
  match_date: string | null;
  lieu: string | null;
  status: string;
  score: string | null;
  scorers: string | null;
  man_of_match: string | null;
  competition: string | null;
  is_home: boolean | null;
  attendance: number | null;
  assists: string | null;
  cards: string | null;
  comment: string | null;
  team_id: string | null;
  verified_by: string | null;
  verified_at: string | null;
}

function parseScorers(raw: string | null): MatchScorer[] | undefined {
  if (!raw) return undefined;
  const names = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return names.length ? names.map((playerName) => ({ playerName })) : undefined;
}

function parseScore(raw: string | null): { scoreFor?: number; scoreAgainst?: number } {
  const match = raw?.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return {};
  return { scoreFor: Number(match[1]), scoreAgainst: Number(match[2]) };
}

function toMatch(row: ClubMatchRow, organizationId: string): Match {
  const hasExtended = row.attendance !== null || row.assists !== null || row.cards !== null || row.comment !== null;
  return {
    id: row.id,
    organizationId,
    teamId: row.team_id ?? "",
    teamName: row.team,
    opponent: row.opponent,
    competition: row.competition ?? "",
    kickoffAt: row.match_date ?? "",
    venue: row.lieu ?? "",
    isHome: row.is_home ?? true,
    ...parseScore(row.score),
    scorers: parseScorers(row.scorers),
    manOfTheMatch: row.man_of_match ?? undefined,
    status: STATUS_MAP[row.status] ?? "upcoming",
    extendedReport: hasExtended
      ? {
          attendance: row.attendance ?? undefined,
          assists: row.assists ?? undefined,
          cards: row.cards ?? undefined,
          comment: row.comment ?? undefined,
        }
      : undefined,
    verifiedBy: row.verified_by ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
  };
}

const SELECT =
  "id, team, opponent, match_date, lieu, status, score, scorers, man_of_match, competition, is_home, attendance, assists, cards, comment, team_id, verified_by, verified_at";

export async function fetchClubMatches(supabase: SupabaseClient, organizationId: string): Promise<Match[]> {
  const { data } = await supabase
    .from("club_matches")
    .select(SELECT)
    .eq("club_id", organizationId)
    .order("match_date", { ascending: false });

  return ((data ?? []) as ClubMatchRow[]).map((row) => toMatch(row, organizationId));
}

export interface ImportedMatchInput {
  teamId: string;
  teamName: string;
  opponent: string;
  matchDate: string;
  lieu: string | null;
}

/** Import calendrier (FFF/ICS/CSV, prompt #6 backlog Club+ V2) — premier chemin d'écriture
 * self-service sur club_matches (cma_member_insert, RLS déjà permissive à tout membre du club,
 * jamais exposé côté UI jusqu'ici). Statut toujours 'a_venir' à la création, comme toute nouvelle
 * ligne côté staff. Séquentiel (pas Promise.all) : un lot compte rarement plus d'une saison de
 * matchs, mieux vaut un rapport précis par ligne qu'un tout-ou-rien sur un import volumineux. */
export async function importClubMatches(
  supabase: SupabaseClient,
  clubId: string,
  rows: ImportedMatchInput[],
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    const { error } = await supabase.from("club_matches").insert({
      club_id: clubId,
      team: row.teamName,
      team_id: row.teamId,
      opponent: row.opponent,
      match_date: row.matchDate,
      lieu: row.lieu,
      status: "a_venir",
    });
    if (error) failed++;
    else succeeded++;
  }
  return { succeeded, failed };
}

/** Utilisé par le Studio pour préremplir un formulaire depuis un match réel (?matchId=uuid),
 * voir studio/[template]/page.tsx. */
export async function fetchClubMatchById(
  supabase: SupabaseClient,
  organizationId: string,
  matchId: string,
): Promise<Match | null> {
  const { data } = await supabase
    .from("club_matches")
    .select(SELECT)
    .eq("club_id", organizationId)
    .eq("id", matchId)
    .maybeSingle();

  return data ? toMatch(data as ClubMatchRow, organizationId) : null;
}

export async function saveClubMatchResult(
  supabase: SupabaseClient,
  matchId: string,
  matchStatus: MatchOutcome,
  patch: {
    scoreFor?: number;
    scoreAgainst?: number;
    scorers?: MatchScorer[];
    manOfTheMatch?: string;
    competition?: string;
    venue?: string;
    isHome?: boolean;
    attendance?: number;
    assists?: string;
    cards?: string;
    comment?: string;
  },
): Promise<void> {
  const update: Record<string, unknown> = { status: WRITE_STATUS_MAP[matchStatus] };
  if (patch.scoreFor !== undefined && patch.scoreAgainst !== undefined) {
    update.score = `${patch.scoreFor}-${patch.scoreAgainst}`;
  }
  if (patch.scorers) {
    update.scorers = patch.scorers.map((s) => s.playerName).join(", ");
  }
  if (patch.manOfTheMatch !== undefined) update.man_of_match = patch.manOfTheMatch;
  if (patch.competition !== undefined) update.competition = patch.competition || null;
  if (patch.venue !== undefined) update.lieu = patch.venue || null;
  if (patch.isHome !== undefined) update.is_home = patch.isHome;
  if (patch.attendance !== undefined) update.attendance = patch.attendance;
  if (patch.assists !== undefined) update.assists = patch.assists || null;
  if (patch.cards !== undefined) update.cards = patch.cards || null;
  if (patch.comment !== undefined) update.comment = patch.comment || null;
  // .select("id") : sans ça, une RLS qui bloque silencieusement (0 ligne affectée, hors scope
  // is_team_educateur par ex.) renvoie quand même {error: null} et l'appelant marquerait le match
  // comme mis à jour à tort (faux succès) — même garde-fou que updateClubNewsroomItemStatus.
  const { data, error } = await supabase.from("club_matches").update(update).eq("id", matchId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Mise à jour refusée : match introuvable ou accès refusé.");
}

/**
 * Workflow de vérification Directeur sportif (Bible §8) — pose verified_by/verified_at
 * (colonnes migration-clubplus-v37.sql, déjà exécutée, jamais consommées avant ce chantier).
 * "Le coach saisit une seule fois ; le Directeur confirme/corrige si nécessaire" : cette fonction
 * ne touche à aucun champ de résultat (score/statut/buteurs...), seulement à la trace de
 * vérification — un Directeur sportif qui corrige le score le fait via saveClubMatchResult
 * (ci-dessus), puis marque la vérification via cette fonction, deux actions distinctes.
 *
 * RLS : cma_member_update (migration-clubplus-v37.sql) autorise déjà l'update pour
 * is_club_member(club_id) + (team_id is null or is_team_educateur(team_id)) — is_team_educateur
 * inclut désormais 'directeur_sportif' dans son scope équipe (migration-clubplus-v40.sql, NON
 * EXÉCUTÉE) : aucune nouvelle policy n'est nécessaire pour que ce rôle puisse écrire ici.
 *
 * `verified_by`/`verified_at` sont posés côté client (auth.uid() n'est pas directement lisible
 * depuis un update JS) — la session Supabase déjà utilisée par ce fichier porte l'identité de
 * l'utilisateur courant ; à défaut d'un id explicite, appelez avec l'id de l'utilisateur en
 * session (ctx.user.id côté appelant).
 *
 * UI construite dans matchcenter/page.tsx (bouton "Vérifier le résultat", visible seulement si
 * `fetchClubRequiresResultVerification` renvoie true et pour Admin/Directeur sportif), qui rouvre
 * MatchResultModal en mode vérification (permet de corriger le score avant de confirmer) puis
 * appelle cette fonction juste après saveClubMatchResult — deux appels, un seul geste utilisateur.
 */
export async function verifyClubMatchResult(supabase: SupabaseClient, matchId: string, verifiedByUserId: string): Promise<void> {
  const { data, error } = await supabase
    .from("club_matches")
    .update({ verified_by: verifiedByUserId, verified_at: new Date().toISOString() })
    .eq("id", matchId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Vérification refusée : match introuvable ou accès refusé.");
}

/**
 * Lit `clubs.requires_result_verification` (colonne posée par migration-clubplus-v40.sql, NON
 * ENCORE EXÉCUTÉE par Fouka au moment où cette fonction est écrite, default false) pour le club
 * courant — même pattern que `fetchClubTeams` (data/club/teams.ts), qui lit déjà `clubs.saison`
 * de la même façon (un .select ciblé sur `clubs`, `.eq("id", organizationId).maybeSingle()`).
 * Bible §8 : "Optionnelle selon requires_result_verification" — c'est ce booléen qui décide,
 * côté appelant (matchcenter/page.tsx), si l'action "Vérifier le résultat" est proposée du tout.
 *
 * Tant que la migration v40 n'est pas exécutée, la colonne n'existe pas encore côté base :
 * PostgREST renvoie alors une erreur (colonne inconnue), avalée ici en `false` — même
 * comportement que la valeur par défaut de la colonne une fois créée — plutôt que de faire
 * planter l'écran en attendant l'exécution.
 */
export async function fetchClubRequiresResultVerification(supabase: SupabaseClient, organizationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("clubs")
    .select("requires_result_verification")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) return false;
  return (data as { requires_result_verification: boolean } | null)?.requires_result_verification ?? false;
}

/**
 * Assigne/change l'équipe (`team_id`, référence `club_teams`) d'un match existant — corrige le
 * gap identifié le 17/08/2026 : migration-clubplus-v37.sql pose `team_id` et la RLS équipe-level
 * dessus, mais aucune UI de ce repo ne l'écrivait (voir le commentaire en tête de fichier). Sans
 * cette fonction, la RLS team-scoping ne sert à rien : tout match reste team_id=NULL, visible et
 * modifiable par tout membre du club quel que soit son scope d'équipe.
 *
 * Réservée côté UI à Admin/Directeur sportif (matchcenter/page.tsx § canAssignTeam) — pas au
 * Coach, qui ne doit pas pouvoir se réassigner un match hors de son scope. Mais la vraie
 * frontière reste la RLS, pas ce masquage frontend (Bible §24) : `cma_member_update` n'a pas de
 * clause WITH CHECK dédiée, donc Postgres applique sa clause USING ("team_id is null or
 * is_team_educateur(team_id)") à la fois à l'ancienne ET à la nouvelle valeur de la ligne — un
 * coach qui appellerait cette fonction directement sur un `team_id` hors de son propre scope
 * échouerait donc de toute façon côté serveur (0 ligne affectée, voir la garde ci-dessous).
 */
export async function assignClubMatchTeam(supabase: SupabaseClient, matchId: string, teamId: string | null): Promise<void> {
  const { data, error } = await supabase.from("club_matches").update({ team_id: teamId }).eq("id", matchId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Assignation refusée : match introuvable ou accès refusé.");
}

/**
 * Prise en charge "Prendre en charge" / "Pris en compte" (Bible §9/§18) — anti-doublon entre
 * plusieurs CM d'un même club sur le Centre communication (communication/page.tsx). Colonne
 * `taken_by` posée par migration-clubplus-v41-centre-communication-prise-en-charge.sql (NON
 * EXÉCUTÉE) — voir ce fichier pour la vérification de schéma (curl) et le raisonnement RLS
 * (aucune nouvelle policy nécessaire, "cma_member_update" est déjà column-agnostic).
 *
 * Volontairement une fonction à part de `Match`/`fetchClubMatches` ci-dessus plutôt qu'un champ
 * ajouté à l'interface `Match` (src/lib/types/studio.ts, hors périmètre de ce chantier, fichier
 * partagé avec d'autres agents) : le Centre communication réconcilie les deux listes par id.
 */
export interface ClubMatchClaim {
  id: string;
  takenBy: string | null;
}

export async function fetchClubMatchClaims(supabase: SupabaseClient, organizationId: string): Promise<ClubMatchClaim[]> {
  const { data } = await supabase.from("club_matches").select("id, taken_by").eq("club_id", organizationId);
  return ((data ?? []) as { id: string; taken_by: string | null }[]).map((row) => ({ id: row.id, takenBy: row.taken_by }));
}

/** `null` pour relâcher (repasse `taken_by` à NULL) — voir bouton "Relâcher" du Centre
 * communication. Même garde-fou `.select("id")` + vérification de longueur que
 * saveClubMatchResult/verifyClubMatchResult ci-dessus (une RLS qui bloque silencieusement
 * renverrait sinon un faux succès). */
export async function setClubMatchClaim(supabase: SupabaseClient, matchId: string, userId: string | null): Promise<void> {
  const { data, error } = await supabase.from("club_matches").update({ taken_by: userId }).eq("id", matchId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Action refusée : match introuvable ou accès refusé.");
}

/**
 * "Résultat -> Visuel" (Bible §9/§18) : brief pré-rempli équipe/adversaire/score/buteurs/MVP/
 * commentaire pour une demande de visuel depuis un résultat de match. Utilisé par matchcenter/
 * page.tsx (CTA "Demander un visuel" sur une ligne de match reçu) et communication/page.tsx
 * (Centre communication, carte "Résultat disponible") — centralisé ici plutôt que dupliqué dans
 * les deux pages, et gardé dans ce fichier (périmètre autorisé) plutôt que dans
 * src/lib/types/studio.ts (hors périmètre, partagé avec d'autres agents).
 *
 * Pointe vers /requests/new (club_requests, réellement accessible — canAccess "visual_requests"
 * est dans READY_MODULES) plutôt que /studio/[template] (canAccess "studio" : "studio" est
 * ABSENT de READY_MODULES, src/lib/supabase/entitlements.ts — verrouillé pour 100% des comptes
 * réels aujourd'hui, vérifié en lisant ce fichier avant d'écrire cette fonction). Le prefill de
 * studio/[template]/page.tsx (fetchClubMatchById + ?matchId=) reste correct et inchangé pour
 * quand ce module sera un jour déverrouillé, mais n'est aujourd'hui atteignable par aucun compte
 * réel — un CTA qui y mènerait serait un lien mort en pratique.
 */
export function composeMatchVisualBrief(match: Match): { teamName?: string; bodyText: string } {
  const parts: string[] = [];
  if (match.scoreFor !== undefined && match.scoreAgainst !== undefined) {
    parts.push(`${match.teamName} ${match.scoreFor} - ${match.scoreAgainst} ${match.opponent}`);
  } else {
    parts.push(`${match.teamName} ${match.isHome ? "vs" : "@"} ${match.opponent}`);
  }
  if (match.scorers?.length) parts.push(`Buteurs : ${match.scorers.map((s) => s.playerName).join(", ")}`);
  if (match.manOfTheMatch) parts.push(`Joueur du match : ${match.manOfTheMatch}`);
  if (match.extendedReport?.comment) parts.push(match.extendedReport.comment);
  return { teamName: match.teamName || undefined, bodyText: parts.join("\n") };
}

/** /requests/new?teamName=...&prefillBody=... — mêmes paramètres que ceux déjà lus par cette
 * page (voir requests/new/page.tsx, useEffect ligne ~79). Vit ici (pas dans matchcenter/page.tsx)
 * parce qu'un fichier `page.tsx` de l'App Router ne peut exporter QUE les champs reconnus par
 * Next.js (default, metadata, generateStaticParams...) — un export nommé arbitraire y fait
 * échouer `next build` ("is not a valid Page export field"), trouvé en buildant ce chantier.
 * Utilisée par matchcenter/page.tsx (CTA "Demander un visuel" sur une ligne de match reçu) et
 * communication/page.tsx (Centre communication, carte "Résultat disponible"). */
export function requestVisualHref(match: Match): string {
  const { teamName, bodyText } = composeMatchVisualBrief(match);
  const params = new URLSearchParams();
  if (teamName) params.set("teamName", teamName);
  if (bodyText) params.set("prefillBody", bodyText);
  return `/requests/new?${params.toString()}`;
}
