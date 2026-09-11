import type { SupabaseClient } from "@supabase/supabase-js";

// 19/08/2026 (audit pré-lancement) : settings/organization/page.tsx était intégralement en
// lecture seule faute de colonnes réelles (clubs.adresse/instagram_handle/siret/couleur_primaire/
// couleur_secondaire, migration-clubplus-v46-organisation-editable.sql) et de bucket Storage pour
// le logo (clubs.logo_url existait déjà depuis migration-clubplus-v10.sql mais n'était utilisé
// nulle part — migration-clubplus-v47-club-logo-storage.sql crée le bucket `club-logos`). Le droit
// d'écriture existait déjà côté RLS (clubs_admin_update, USING is_club_admin(id)) : c'est
// uniquement l'absence de colonnes/bucket qui bloquait, pas un manque de policy.

// 11/09/2026 — Décisions de Fouka : le SIRET et les identifiants Stripe d'un club ne se lisent
// plus dans `clubs` (colonnes fermées à `authenticated`, migration club-donnees-restreintes-2 :
// les demander fait échouer TOUTE la requête, 42501). Seul chemin : club_donnees_restreintes(),
// qui les rend masqués personne par personne — SIRET : Owner Club+, Président, Secrétaire,
// Trésorier ; Stripe : Owner Club+ et Président (plus Admin SportVision et Compta côté OS).
// Aucune ligne = rien de lisible pour cette personne, ce qui n'est pas une erreur.
export interface ClubDonneesRestreintes {
  siret: string | null;
  siretLisible: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  paiementLisible: boolean;
}

export const AUCUNE_DONNEE_RESTREINTE: ClubDonneesRestreintes = {
  siret: null,
  siretLisible: false,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  paiementLisible: false,
};

export async function fetchClubDonneesRestreintes(supabase: SupabaseClient, clubId: string): Promise<ClubDonneesRestreintes> {
  const { data, error } = await supabase.rpc("club_donnees_restreintes", { p_club_id: clubId });
  // Une erreur (réseau, fonction pas encore déployée) ne doit pas empêcher d'entrer dans le club :
  // on se replie sur « rien de lisible », qui masque les champs au lieu d'afficher un faux vide.
  const ligne = !error && Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!ligne) return AUCUNE_DONNEE_RESTREINTE;
  return {
    siret: (ligne.siret as string | null) ?? null,
    siretLisible: ligne.siret_lisible === true,
    stripeCustomerId: (ligne.stripe_customer_id as string | null) ?? null,
    stripeSubscriptionId: (ligne.stripe_subscription_id as string | null) ?? null,
    paiementLisible: ligne.paiement_lisible === true,
  };
}

export interface UpdateClubOrganizationInput {
  ville?: string;
  adresse?: string;
  instagramHandle?: string;
  siret?: string;
  couleurPrimaire?: string;
  couleurSecondaire?: string;
}

/**
 * N'écrit QUE les champs réellement présents dans `input` — un appelant qui ne passe que
 * `{ adresse, siret }` (ex. l'onboarding Identité) ne doit jamais écraser couleur_primaire/
 * couleur_secondaire à null (bug trouvé en QA le 02/09 : chaque section de l'onboarding qui
 * appelait cette fonction avec un sous-ensemble de champs effaçait silencieusement les autres).
 *
 * 11/09/2026 — Même règle pour le SIRET, et elle compte davantage : une personne qui ne peut pas
 * LIRE le SIRET (CM SportVision, Administratif) le voit vide. Si l'écran le renvoyait quand même,
 * il l'effacerait (Owner, Président) ou ferait refuser tout l'enregistrement (CM, déclencheur
 * proteger_identite_legale_club). Les écrans ne passent donc `siret` que s'ils l'ont lu.
 */
export async function updateClubOrganization(
  supabase: SupabaseClient,
  clubId: string,
  input: UpdateClubOrganizationInput,
): Promise<void> {
  const patch: Record<string, string | null> = {};
  if ("adresse" in input) patch.adresse = input.adresse?.trim() || null;
  if ("ville" in input) patch.ville = input.ville?.trim() || null;
  if ("instagramHandle" in input) patch.instagram_handle = input.instagramHandle?.trim() || null;
  if ("siret" in input) patch.siret = input.siret?.trim() || null;
  if ("couleurPrimaire" in input) patch.couleur_primaire = input.couleurPrimaire || null;
  if ("couleurSecondaire" in input) patch.couleur_secondaire = input.couleurSecondaire || null;
  if (Object.keys(patch).length === 0) return;

  // `.select()` est indispensable : sur un update que la RLS filtre, Supabase renvoie
  // `{ error: null }` et l'écran annonce « Enregistré » alors que rien n'a bougé. Seul un
  // tableau vide révèle le refus. Même piège que setClubMemberStatus (data/club/users.ts).
  const { data, error } = await supabase.from("clubs").update(patch).eq("id", clubId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Enregistrement refusé : droits insuffisants sur ce club.");
  }
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/**
 * Chemin fixe `{clubId}/logo.{ext}` (voir migration-clubplus-v47) : un seul logo par club,
 * écrasé à chaque nouvel upload — jamais accumulé, jamais à nettoyer séparément.
 */
export async function uploadClubLogo(supabase: SupabaseClient, clubId: string, file: File): Promise<string> {
  if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
    throw new Error("Format non accepté (PNG, JPEG, WebP ou SVG uniquement).");
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error("Fichier trop volumineux (2 Mo maximum).");
  }

  const ext = file.type === "image/svg+xml" ? "svg" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${clubId}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage.from("club-logos").upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("club-logos").getPublicUrl(path);
  // Cache-bust : le chemin est fixe (toujours logo.<ext>), sans ce paramètre le navigateur
  // continuerait d'afficher l'ancien logo en cache après un remplacement.
  const publicUrl = `${data.publicUrl}?v=${Date.now()}`;

  // Meme piege que updateClubOrganization ci-dessus, et il etait ouvert ici : sans `.select()`,
  // un update que la RLS filtre revient avec `{ error: null }`. L'ecran affichait alors le
  // nouveau logo (etat local) alors que `clubs.logo_url` n'avait pas bouge, et le logo
  // disparaissait au rechargement suivant.
  const { data: updated, error: updateError } = await supabase
    .from("clubs")
    .update({ logo_url: publicUrl })
    .eq("id", clubId)
    .select("id");
  if (updateError) throw updateError;
  if (!updated || updated.length === 0) {
    throw new Error("Logo envoyé mais non rattaché au club : droits insuffisants.");
  }

  return publicUrl;
}
