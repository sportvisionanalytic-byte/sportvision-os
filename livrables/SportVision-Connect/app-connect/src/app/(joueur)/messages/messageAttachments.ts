import type { SupabaseClient } from "@supabase/supabase-js";

// Extrait de MessagesThread.tsx (bug trouvé indépendamment le 31/08/2026 par deux audits, QA
// transversal et Espace joueur) : cette fonction doit être appelable aussi bien depuis un Server
// Component (messages/page.tsx : "server or client, le client Supabase passé porte la session/RLS
// dans les deux cas") que depuis un client component (MessagesParticulierView.tsx). Elle vivait
// dans MessagesThread.tsx, qui porte "use client" en tête de fichier — sous React Server
// Components, TOUS les exports d'un module "use client" (pas seulement le composant React par
// défaut) deviennent des références client opaques du point de vue d'un Server Component qui les
// importe : messages/page.tsx plantait donc systématiquement à l'exécution avec
// "resolveMessageAttachments is not a function" / "TypeError: (0, o.a) is not a function" en build
// production (reproduit à 100% en Playwright, sur chaque chargement de /messages dès qu'un joueur
// avait un client_id résolu — jamais un flake) — la page tombait dans error.tsx à chaque visite,
// Messages entièrement indisponible côté Espace joueur. Extraite ici, dans un module SANS
// "use client", elle reste un simple export appelable des deux côtés (MessagesParticulierView.tsx
// l'appelait déjà côté client dans un useEffect — fonctionnait par coïncidence, jamais concerné
// par ce bug).
export interface MessageData {
  id: string;
  auteur: "client" | "staff";
  contenu: string;
  pieceJointeUrl: string | null;
  lu: boolean;
  createdAt: string;
}

// Bucket PRIVÉ dédié (migration-storage-v95, 20/08) — portail-media (utilisé avant) est un bucket
// PUBLIC : /object/public/... (ce que génère getPublicUrl()) ignore complètement la RLS dès que
// bucket.public=true, donc une pièce jointe de message y était lisible par n'importe qui malgré
// une policy d'écriture correctement scopée. Ce bucket est privé : la lecture passe uniquement par
// une URL signée (temporaire, générée à l'affichage — voir loadSignedAttachmentUrl), jamais un lien
// permanent stocké en base.
const ATTACHMENT_BUCKET = "sportvision-media-prive";
const ATTACHMENT_SIGN_TTL_SECONDS = 3600;

// Résout piece_jointe_path → URL signée temporaire pour une liste de lignes messages_client déjà
// chargées (server ou client, le client Supabase passé porte la session/RLS dans les deux cas).
// Un seul appel Storage groupé (createSignedUrls) plutôt qu'un par pièce jointe. Une ligne sans
// accès RLS au chemin (ne devrait jamais arriver ici puisque la ligne messages_client elle-même
// est déjà scopée par client_id, mais defensive) n'obtient simplement pas d'URL — pieceJointeUrl
// reste null, pas d'erreur bloquante pour le reste du fil.
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
