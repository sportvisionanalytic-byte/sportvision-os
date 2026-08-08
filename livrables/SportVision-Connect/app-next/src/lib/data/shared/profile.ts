import type { SupabaseClient } from "@supabase/supabase-js";

// Profil utilisateur — stocké dans auth.users.user_metadata (prenom/nom/telephone/locale), lu par
// buildUserFromAuth() (session.ts). Pas de table `profiles` dédiée dans ce backend : mêmes clés
// que l'app vanilla, écrites via l'API Auth elle-même (l'utilisateur ne peut modifier que son
// propre user_metadata, aucune policy RLS à prévoir).
export async function updateUserProfile(
  supabase: SupabaseClient,
  input: { firstName: string; lastName: string; phone: string; locale: "fr" | "en" },
): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    data: { prenom: input.firstName, nom: input.lastName, telephone: input.phone, locale: input.locale },
  });
  if (error) throw error;
}
