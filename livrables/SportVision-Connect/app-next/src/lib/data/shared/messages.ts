import type { SupabaseClient } from "@supabase/supabase-js";

// messages_client (migration-portail-v1.sql) — fil unique par client Portail, pas de notion de
// thread multiple ni de sujet : chaque ligne est un message, triée par date. Accès club étendu
// par migration-clubplus-v34-club-messages-contenus-access.sql. `auteur_staff_id`/nom du membre
// de staff ne sont pas exposés (profiles est staff-only) — un message staff s'affiche juste
// "SportVision", sans identifier la personne précise, volontairement.

export interface ClientMessage {
  id: string;
  auteur: "client" | "staff";
  contenu: string;
  pieceJointeUrl: string | null;
  createdAt: string;
}

interface MessageRow {
  id: string;
  auteur_type: string;
  contenu: string;
  piece_jointe_url: string | null;
  created_at: string;
}

export async function fetchClientMessages(supabase: SupabaseClient, clientId: string): Promise<ClientMessage[]> {
  const { data, error } = await supabase
    .from("messages_client")
    .select("id, auteur_type, contenu, piece_jointe_url, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as MessageRow[]).map((row) => ({
    id: row.id,
    auteur: row.auteur_type === "staff" ? "staff" : "client",
    contenu: row.contenu,
    pieceJointeUrl: row.piece_jointe_url,
    createdAt: row.created_at,
  }));
}

/** auteur_client_id référence client_users(id) (FK stricte, migration-portail-v1.sql) — seul le
 * fondateur du compte Portail y a une ligne. Un autre membre de club (accès étendu par v34) n'en
 * a pas : poser user.id violerait la FK. On tente avec l'id réel d'abord (cas nominal, le plus
 * fréquent), et on retombe sur `null` (colonne nullable) uniquement si Postgres rejette la FK —
 * évite une requête de vérification séparée avant chaque envoi. */
export async function sendClientMessage(supabase: SupabaseClient, clientId: string, contenu: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Session invalide.");

  const attempt = await supabase
    .from("messages_client")
    .insert({ client_id: clientId, auteur_type: "client", auteur_client_id: user.id, contenu });
  if (!attempt.error) return;
  if (attempt.error.code !== "23503") throw attempt.error;

  const retry = await supabase
    .from("messages_client")
    .insert({ client_id: clientId, auteur_type: "client", auteur_client_id: null, contenu });
  if (retry.error) throw retry.error;
}
