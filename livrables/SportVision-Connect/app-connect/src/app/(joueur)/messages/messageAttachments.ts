import type { SupabaseClient } from "@supabase/supabase-js";

// Extrait de MessagesThread.tsx (audit Espace joueur, 30-31/08/2026) : cette fonction et son type
// vivaient dans MessagesThread.tsx, un module "use client". messages/page.tsx (Server Component)
// l'importait et l'appelait directement — mais un export non-composant d'un fichier "use client"
// devient une référence client à la frontière RSC : l'appeler côté serveur échoue avec
// `TypeError: (0 , o.a) is not a function` (reproduit en build production, /messages plantait
// systématiquement dès qu'un joueur avait un client_id résolu, donc pour tout joueur ayant déjà
// ouvert Messages ou une Prestation). Fichier séparé, sans "use client", pour rester appelable
// aussi bien depuis un Server Component (ce module) que depuis un Client Component
// (MessagesParticulierView.tsx, qui l'appelle déjà côté client dans un useEffect — fonctionnait
// par coïncidence, jamais concerné par ce bug).

export interface MessageData {
  id: string;
  auteur: "client" | "staff";
  contenu: string;
  pieceJointeUrl: string | null;
  lu: boolean;
  createdAt: string;
}

// Bucket PRIVÉ dédié (migration-storage-v95, 20/08) — voir MessagesThread.tsx pour l'historique
// complet de ce choix (portail-media, le bucket public utilisé avant, ignorait la RLS).
const ATTACHMENT_BUCKET = "sportvision-media-prive";
const ATTACHMENT_SIGN_TTL_SECONDS = 3600;

// Résout piece_jointe_path → URL signée temporaire pour une liste de lignes messages_client déjà
// chargées (server ou client, le client Supabase passé porte la session/RLS dans les deux cas).
export async function resolveMessageAttachments(
  supabase: SupabaseClient,
  rows: Array<{ id: string; auteur_type: string; contenu: string; piece_jointe_path: string | null; lu: boolean; created_at: string }>,
): Promise<MessageData[]> {
  const paths = rows.map((r) => r.piece_jointe_path).filter((p): p is string => !!p);
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signedList } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(paths, ATTACHMENT_SIGN_TTL_SECONDS);
    for (const s of signedList || []) {
      if (s.signedUrl && !s.error) urlByPath.set(s.path ?? "", s.signedUrl);
    }
  }
  return rows.map((row) => ({
    id: row.id,
    auteur: row.auteur_type === "staff" ? "staff" : "client",
    contenu: row.contenu,
    pieceJointeUrl: row.piece_jointe_path ? (urlByPath.get(row.piece_jointe_path) ?? null) : null,
    lu: row.lu,
    createdAt: row.created_at,
  }));
}
