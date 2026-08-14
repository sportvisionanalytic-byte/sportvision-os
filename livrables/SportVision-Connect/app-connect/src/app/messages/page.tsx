import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { MessagesThread, type MessageData } from "./MessagesThread";

// Messages — voir design-connect-personnel-12-08/README.md § Espace joueur → Messages et
// MASTER-CONNECT-V1 §28 : conversation unique "Équipe SportVision", aucun statut "en ligne".
//
// SOURCE DE DONNÉES : `messages_client`, scopée par `client_id`. Un compte Joueur n'a par défaut
// aucun `client_id` exploitable — `player_profiles.client_id` est résolu/creé à la demande via la
// RPC `resolve_player_client_id` (migration-connect-v43-espace-joueur.sql, déjà exécutée et
// confirmée en base via /rpc/resolve_player_client_id). Cette résolution n'a lieu QUE sur cette
// page (jamais sur /calendrier) : c'est un effet de bord volontaire et documenté par la migration
// elle-même ("provisionné à la demande, pas en masse, pour ne jamais créer de ligne clients
// fantôme pour un joueur qui n'ouvre jamais Messages").
//
// Message d'accueil du staff (visible dans la maquette dès une conversation neuve) : voir
// migration-connect-v56-messages-welcome.sql (NON EXÉCUTÉE) — insère le premier message dans
// `messages_client` au moment même où `resolve_player_client_id` crée le client, pas ici côté
// frontend (aucun message fictif affiché sans exister en base).
export default async function MessagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  let clientId: string | null = null;
  let messages: MessageData[] = [];
  let unavailable = false;

  if (player?.playerId) {
    const { data: resolvedId, error } = await supabase.rpc("resolve_player_client_id", {
      p_player_id: player.playerId,
    });
    if (error || !resolvedId) {
      unavailable = true;
    } else {
      clientId = resolvedId as string;
      const { data } = await supabase
        .from("messages_client")
        .select("id, auteur_type, contenu, piece_jointe_url, lu, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: true });

      messages = (data ?? []).map((row) => ({
        id: row.id as string,
        auteur: row.auteur_type === "staff" ? "staff" : "client",
        contenu: row.contenu as string,
        pieceJointeUrl: (row.piece_jointe_url as string | null) ?? null,
        lu: row.lu as boolean,
        createdAt: row.created_at as string,
      }));
    }
  } else {
    unavailable = true;
  }

  return (
    <AppShell firstName={firstName}>
      <MessagesThread clientId={clientId} initialMessages={messages} unavailable={unavailable} />
    </AppShell>
  );
}
