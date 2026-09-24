// Où vit une photo, et comment on en obtient une adresse de téléchargement (24/09/2026).
//
// Une seule fonction décide, pour tout l'écosystème. C'est la seule façon d'avoir un jour des
// photos rangées à deux endroits sans que ça devienne un champ de mines : la question « celle-ci
// est où ? » ne doit se poser qu'ici.
//
// LA RÈGLE : la colonne `media_assets.storage_bucket` fait foi, et elle seule.
//
//   "r2"                      → Cloudflare R2, les photos déposées à partir du 24/09/2026
//   "sportvision-media-prive" → Supabase, les 2 085 photos d'avant, qui ne bougent pas
//   vide                      → Supabase, par prudence : c'était la valeur par défaut historique
//
// Aucune date, aucun seuil, aucune heuristique : une colonne. Une bascule qui se devine est une
// bascule qui se trompe, et se tromper ici veut dire servir une photo qui n'existe pas à une
// famille qui vient de payer.
import { estSurR2, reglagesR2, urlSigneeR2 } from "./r2.ts";

export interface PhotoRangee {
  storage_bucket?: string | null;
  original_path?: string | null;
  original_filename?: string | null;
}

/** Ce que sait un client Supabase à droits complets, réduit à ce qu'on utilise ici. */
interface ClientStockage {
  storage: {
    from(seau: string): {
      createSignedUrl(
        chemin: string, secondes: number, options?: { download?: string },
      ): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
}

/**
 * L'adresse de téléchargement d'un original, quel que soit l'endroit où il est rangé.
 *
 * Rend `null` en cas d'échec plutôt que de lever : les appelants savent déjà répondre « le
 * téléchargement est momentanément indisponible », ce qui est la bonne phrase pour une famille.
 *
 * La durée courte est volontaire et vaut des deux côtés : un droit permanent n'est PAS une
 * adresse permanente, c'est le droit d'en redemander une. Une adresse qui traîne dans un
 * historique de navigateur ou dans une conversation WhatsApp ne doit rien ouvrir le lendemain.
 */
export async function urlOriginal(
  admin: ClientStockage,
  photo: PhotoRangee,
  secondes: number,
): Promise<string | null> {
  const chemin = photo.original_path ?? "";
  if (!chemin) return null;
  const nom = photo.original_filename || "photo.jpg";

  if (estSurR2(photo.storage_bucket)) {
    const r = reglagesR2();
    if (!r) {
      // Une photo dit « je suis sur R2 » mais le projet n'a pas ses clés : c'est une panne de
      // configuration, pas une photo manquante. On le dit fort dans les journaux, parce que le
      // symptôme visible — « téléchargement indisponible » — n'a rien à voir avec la cause.
      console.error("[medias] photo sur R2 mais les clés R2 ne sont pas configurées :", chemin);
      return null;
    }
    try {
      return await urlSigneeR2(r, chemin, secondes, nom);
    } catch (e) {
      console.error("[medias] signature R2 impossible :", e);
      return null;
    }
  }

  const { data, error } = await admin.storage
    .from(photo.storage_bucket || "sportvision-media-prive")
    .createSignedUrl(chemin, secondes, { download: nom });
  if (error || !data?.signedUrl) {
    console.error("[medias] signature Supabase impossible :", error);
    return null;
  }
  return data.signedUrl;
}
