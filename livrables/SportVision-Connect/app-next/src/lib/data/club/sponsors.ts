import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Sponsor,
  SponsorCommitment,
  SponsorLevel,
  SponsorOperation,
  SponsorPublication,
  SponsorPublicationStatus,
  SponsorStatus,
} from "@/lib/types/sponsors";
import { parseSponsorCommitments } from "@/lib/data/shared/sponsor-commitments";

// club_sponsors (migration-clubplus-v5.sql) — pas de colonne `status` réelle ni de
// `paymentSchedule`/`contractId`/`signatories` : status dérivé de date_fin, le reste laissé
// honnêtement absent (`null`/`[]`/`undefined`) plutôt que comblé par une valeur par défaut
// affichée comme un fait (corrigé lors de l'audit du 09/08 — `paymentSchedule: "annual"` en dur
// était affiché comme réel dans /sponsors/:id § Contrat pour TOUT sponsor réel). RLS :
// is_club_member(club_id).
//
// SponsorDeliverable/SponsorDocument restent en mock (voir plan Phase 1, hors périmètre du
// chantier "Studio dynamique + Sponsors backend réel" du 16/08/2026 — pas de table dédiée créée
// pour ces deux entités, voir le rapport de ce chantier pour la justification détaillée).
//
// SponsorPublication (fetchSponsorPublications/fetchSponsorPublicationsForPartner ci-dessous) et
// SponsorOperation (fetchSponsorOperations/fetchSponsorOperationsForPartner, plus bas) ont
// désormais un vrai backend (migration-clubplus-v38-studio-sponsors.sql) : club_creations
// (table "Mes contenus" réelle du club — PAS `contenus`, qui appartient au planning éditorial CM
// de Connect, sans rapport avec ce module Club+, voir le commentaire de la migration) pour les
// publications, nouvelle table `sponsor_operations` pour les activations.
//
// `commitments` (jsonb, colonne réelle) : vide pour tous les sponsors en prod au 11/08/2026,
// contrairement aux champs ci-dessus il n'y a pas de table absente — juste aucune UI d'écriture
// nulle part (ni Connect legacy, ni OS, qui la garde en lecture seule). Lu et écrit ici, voir
// updateSponsorCommitments ci-dessous et l'onglet Contreparties de /sponsors/:id.

const LEVEL_MAP: Record<string, SponsorLevel> = {
  Or: "or",
  Argent: "argent",
  Bronze: "bronze",
};

interface ClubSponsorRow {
  id: string;
  name: string;
  secteur: string | null;
  niveau: string;
  date_debut: string | null;
  date_fin: string | null;
  montant: number;
  commitments: unknown;
  logo_url: string | null;
  content_type_obligations: string[] | null;
}

function deriveStatus(dateFin: string | null): SponsorStatus {
  if (!dateFin) return "active";
  const end = new Date(dateFin).getTime();
  const now = Date.now();
  if (end < now) return "expired";
  if (end - now < 60 * 24 * 60 * 60 * 1000) return "to_renew";
  return "active";
}

export async function fetchClubSponsors(supabase: SupabaseClient, organizationId: string): Promise<Sponsor[]> {
  const { data } = await supabase
    .from("club_sponsors")
    .select("id, name, secteur, niveau, date_debut, date_fin, montant, commitments, logo_url, content_type_obligations")
    .eq("club_id", organizationId)
    .order("montant", { ascending: false });

  return ((data ?? []) as ClubSponsorRow[]).map((row) => ({
    id: row.id,
    organizationId,
    name: row.name,
    level: LEVEL_MAP[row.niveau] ?? "bronze",
    startsAt: row.date_debut ?? "",
    endsAt: row.date_fin ?? "",
    annualAmount: row.montant,
    paymentSchedule: null,
    status: deriveStatus(row.date_fin),
    signatories: [],
    sector: row.secteur ?? undefined,
    commitments: parseSponsorCommitments(row.commitments),
    logoUrl: row.logo_url,
    contentTypeObligations: row.content_type_obligations ?? [],
  }));
}

/** Types de contenu où un sponsor doit obligatoirement apparaître (migration-club-sponsors-
 * content-obligations, 03/09/2026) — alimente à la fois l'onglet Contreparties de Club+ et le
 * panneau "Sponsors requis" côté OS (modalNouveauContenu). RLS : csp_member_update (même
 * politique que le reste de la fiche sponsor — admin/president/sponsor_mgr/tresorier). */
export async function updateSponsorContentTypeObligations(
  supabase: SupabaseClient,
  sponsorId: string,
  contentTypeObligations: string[],
): Promise<void> {
  const { error } = await supabase.from("club_sponsors").update({ content_type_obligations: contentTypeObligations }).eq("id", sponsorId);
  if (error) throw error;
}

/** Création de sponsor (19/08/2026, retour utilisateur : aucune UI ne le permettait). RLS
 * csp_member_insert réserve l'écriture à admin/president/sponsor_mgr/tresorier — un membre sans
 * ce rôle reçoit une erreur Postgres explicite, pas un formulaire qui semble fonctionner puis
 * échoue silencieusement. `niveau` limité à Or/Argent/Bronze (club_sponsors_niveau_check) : pas
 * de "Platine" bien que SponsorLevel (types/sponsors.ts) le prévoie, ce palier n'existe pas côté
 * base aujourd'hui. */
export async function createClubSponsor(
  supabase: SupabaseClient,
  clubId: string,
  input: { name: string; niveau: "Or" | "Argent" | "Bronze"; secteur?: string; montant?: number; dateDebut?: string; dateFin?: string },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("club_sponsors")
    .insert({
      club_id: clubId,
      name: input.name,
      niveau: input.niveau,
      secteur: input.secteur || null,
      montant: input.montant ?? 0,
      date_debut: input.dateDebut || null,
      date_fin: input.dateFin || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

const MAX_SPONSOR_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_SPONSOR_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/** Logo d'un sponsor (migration-clubplus-v53, 03/09/2026) — même bucket Storage que le logo du
 * club (`club-logos`), chemin {club_id}/sponsor-{sponsor_id}.{ext} : reste sous le dossier du
 * club, donc couvert par les policies is_club_admin() déjà en place (migration-clubplus-v47),
 * aucune nouvelle policy Storage nécessaire. Écrasé à chaque nouvel upload, comme le logo club. */
export async function uploadSponsorLogo(supabase: SupabaseClient, clubId: string, sponsorId: string, file: File): Promise<string> {
  if (!ACCEPTED_SPONSOR_LOGO_TYPES.includes(file.type)) {
    throw new Error("Format non accepté (PNG, JPEG, WebP ou SVG uniquement).");
  }
  if (file.size > MAX_SPONSOR_LOGO_BYTES) {
    throw new Error("Fichier trop volumineux (2 Mo maximum).");
  }

  const ext = file.type === "image/svg+xml" ? "svg" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${clubId}/sponsor-${sponsorId}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("club-logos").upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("club-logos").getPublicUrl(path);
  const publicUrl = `${data.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase.from("club_sponsors").update({ logo_url: publicUrl }).eq("id", sponsorId);
  if (updateError) throw updateError;

  return publicUrl;
}

/** Écrit la liste complète des contreparties (jsonb, remplacement total — pas de RPC dédiée,
 * cohérent avec la taille attendue « une liste courte », voir migration-clubplus-v5.sql
 * commentaire d'en-tête). RLS : csp_member_update (is_club_member). */
export async function updateSponsorCommitments(
  supabase: SupabaseClient,
  sponsorId: string,
  commitments: SponsorCommitment[],
): Promise<void> {
  const { error } = await supabase.from("club_sponsors").update({ commitments }).eq("id", sponsorId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------------------------
// Publications — club_creations filtré par sponsor_id (migration-clubplus-v38-studio-sponsors.sql
// § 3). club_creations.status ('brouillon'/'a_valider'/'valide'/'publie') n'a pas de valeur
// "programmé" littérale : mapping retenu ci-dessous — brouillon/a_valider restent "en_creation"
// (le contenu n'est ni prêt ni planifié), valide devient "programme" (approuvé, le plus proche
// analogue de "prêt à sortir" disponible dans ce schéma), publie reste publie. Documenté ici
// plutôt que dans le composant pour rester à côté de la requête qui le produit.
// ---------------------------------------------------------------------------------------------

const CREATION_STATUS_TO_PUBLICATION: Record<string, SponsorPublicationStatus> = {
  brouillon: "en_creation",
  a_valider: "en_creation",
  valide: "programme",
  publie: "publie",
};

interface ClubCreationRow {
  id: string;
  title: string;
  status: string;
}

function toPublication(row: ClubCreationRow, sponsorId: string): SponsorPublication {
  return {
    id: row.id,
    sponsorId,
    label: row.title,
    status: CREATION_STATUS_TO_PUBLICATION[row.status] ?? "en_creation",
    // publishedAt/reach : aucune colonne réelle de date de publication ni de portée sur
    // club_creations (seulement created_at/updated_at, qui ne représentent pas fiablement
    // l'instant de publication) — laissés absents plutôt qu'approximés par une donnée qui n'est
    // pas la vraie information, même conduite que le reste de ce fichier (paymentSchedule, etc.).
  };
}

/** Publications d'UN partenariat précis (une ligne club_sponsors) — onglet Publications de
 * /sponsors/:id (vue club). RLS : ccr_member_select (is_club_member). */
export async function fetchSponsorPublications(supabase: SupabaseClient, sponsorId: string): Promise<SponsorPublication[]> {
  const { data, error } = await supabase
    .from("club_creations")
    .select("id, title, status")
    .eq("sponsor_id", sponsorId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as ClubCreationRow[]).map((row) => toPublication(row, sponsorId));
}

/** Publications agrégées, tous clubs confondus, pour le propre espace du sponsor — via
 * club_creations.sponsor_organization_id (déjà ajoutée par migration-connect-v4-sponsor.sql).
 * `sponsor_id` peut être absent sur une ligne liée seulement via sponsor_organization_id : les
 * deux colonnes sont complémentaires (voir migration v38 § 3), on retombe alors sur la chaîne
 * vide plutôt que d'inventer un identifiant de partenariat. RLS : ccr_sponsor_org_select
 * (is_org_member). */
export async function fetchSponsorPublicationsForPartner(
  supabase: SupabaseClient,
  sponsorOrganizationId: string,
): Promise<SponsorPublication[]> {
  const { data, error } = await supabase
    .from("club_creations")
    .select("id, title, status, sponsor_id")
    .eq("sponsor_organization_id", sponsorOrganizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as (ClubCreationRow & { sponsor_id: string | null })[]).map((row) =>
    toPublication(row, row.sponsor_id ?? ""),
  );
}

// ---------------------------------------------------------------------------------------------
// Opérations (activations) — nouvelle table sponsor_operations (migration-clubplus-v38). Ce sont
// des interventions organisées PAR SportVision pour le compte du sponsor (voir le commentaire de
// SponsorOperation dans lib/types/sponsors.ts) : écriture strictement staff, pas d'écriture club
// exposée ici.
// ---------------------------------------------------------------------------------------------

interface SponsorOperationRow {
  id: string;
  sponsor_id: string;
  label: string;
  date: string;
  status: "prevue" | "realisee";
}

function toOperation(row: SponsorOperationRow): SponsorOperation {
  return { id: row.id, sponsorId: row.sponsor_id, label: row.label, date: row.date, status: row.status };
}

/** Opérations d'UN partenariat précis. RLS : sop_club_member_select (is_club_member via
 * club_sponsors) ou sop_sponsor_org_select (is_org_member). */
export async function fetchSponsorOperations(supabase: SupabaseClient, sponsorId: string): Promise<SponsorOperation[]> {
  const { data, error } = await supabase
    .from("sponsor_operations")
    .select("id, sponsor_id, label, date, status")
    .eq("sponsor_id", sponsorId)
    .order("date", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as SponsorOperationRow[]).map(toOperation);
}

/** Opérations agrégées, tous clubs confondus, pour le propre espace du sponsor — jointure vers
 * club_sponsors.sponsor_organization_id (`!inner` : exclut les lignes sponsor_operations dont le
 * partenariat n'est pas lié à CETTE organisation sponsor). RLS : sop_sponsor_org_select. */
export async function fetchSponsorOperationsForPartner(
  supabase: SupabaseClient,
  sponsorOrganizationId: string,
): Promise<SponsorOperation[]> {
  const { data, error } = await supabase
    .from("sponsor_operations")
    .select("id, sponsor_id, label, date, status, club_sponsors!inner(sponsor_organization_id)")
    .eq("club_sponsors.sponsor_organization_id", sponsorOrganizationId)
    .order("date", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as SponsorOperationRow[]).map(toOperation);
}
