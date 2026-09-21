// L'accord pour retrouver un sportif sur les photos, et sa photo de référence (21/09/2026).
//
// Fouka : « le parent donne son accord et dépose la photo. Pour un joueur majeur, ils donnent leur
// accord eux-mêmes. Choisis ce qui est le mieux, mais le plus simple. »
//
// TOUT LE CONTRÔLE EST EN BASE, et il est déjà écrit depuis le 12/09 (v159, v161, v226) : qui a le
// droit de consentir selon l'âge, ce qu'on efface quand l'accord est retiré, où la photo a le droit
// d'être rangée. Ce fichier ne redécide rien — il appelle. Reproduire ces règles ici, c'est se
// garantir qu'un jour les deux ne diront plus la même chose.
//
// Un mineur de moins de 15 ans ne peut pas consentir pour lui-même : la base refuse, avec un
// message qui explique quoi faire. On le laisse remonter tel quel plutôt que de masquer le bouton :
// l'enfant comprend alors pourquoi, au lieu de ne rien voir.

import type { SupabaseClient } from "@supabase/supabase-js";

/** La version du texte accepté. Elle part avec chaque accord et NE DOIT PAS changer sans changer
 *  de numéro : c'est ce qui permet de dire, plus tard, ce qui a réellement été accepté.
 *  Texte : livrables/juridique/consentement-reconnaissance-enfant.md */
export const VERSION_TEXTE_BIOMETRIE = "v1-2026-09-12";

const BUCKET = "sportvision-media-prive";

export interface EtatBiometrie {
  autorise: boolean;
  photoDeposee: boolean;
  accordeLe?: string;
  /** 'parent' | 'joueur_15_17' | 'joueur_majeur' */
  qualite?: string;
}

export async function fetchEtatBiometrie(supabase: SupabaseClient, playerId: string): Promise<EtatBiometrie> {
  const { data, error } = await supabase.rpc("mon_consentement_biometrie", { p_player_id: playerId });
  if (error) throw error;
  const j = (data ?? {}) as Record<string, unknown>;
  return {
    autorise: j.autorise === true,
    photoDeposee: j.photo_deposee === true,
    accordeLe: (j.accorde_le as string) ?? undefined,
    qualite: (j.qualite as string) ?? undefined,
  };
}

export async function donnerAccordBiometrie(supabase: SupabaseClient, playerId: string): Promise<void> {
  const { error } = await supabase.rpc("donner_consentement_biometrie", {
    p_player_id: playerId,
    p_texte_version: VERSION_TEXTE_BIOMETRIE,
  });
  if (error) throw error;
}

export async function retirerAccordBiometrie(supabase: SupabaseClient, playerId: string): Promise<void> {
  const { error } = await supabase.rpc("retirer_consentement_biometrie", { p_player_id: playerId });
  if (error) throw error;
}

/** Dépose la photo de référence. Le chemin est imposé par la base (`visages/<player_id>/…`) et par
 *  la policy du stockage : l'inventer autrement fait échouer les deux, ce qui est le but. */
export async function deposerPhotoReference(
  supabase: SupabaseClient,
  playerId: string,
  fichier: File,
): Promise<void> {
  const extension = (fichier.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const chemin = `visages/${playerId}/reference-${Date.now()}.${extension}`;
  const { error: erreurEnvoi } = await supabase.storage.from(BUCKET).upload(chemin, fichier, {
    upsert: false,
    contentType: fichier.type || "image/jpeg",
  });
  if (erreurEnvoi) throw erreurEnvoi;

  const { error } = await supabase.rpc("enregistrer_photo_reference", {
    p_player_id: playerId,
    p_storage_path: chemin,
  });
  // Si l'enregistrement échoue, le fichier déposé n'a plus de raison d'exister : on le retire
  // plutôt que de laisser une photo d'enfant orpheline dans le stockage.
  if (error) {
    await supabase.storage.from(BUCKET).remove([chemin]).catch(() => {});
    throw error;
  }
}
