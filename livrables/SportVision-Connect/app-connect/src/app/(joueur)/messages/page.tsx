import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { MessagesThread } from "./MessagesThread";
// resolveMessageAttachments/MessageData importés depuis ce module dédié (pas depuis
// ./MessagesThread, un "use client") — voir messageAttachments.ts pour le pourquoi : ce fichier
// est un Server Component, et appeler une fonction exportée par un module "use client" pendant le
// rendu serveur échoue avec `TypeError: (0 , o.a) is not a function` (reproduit en build
// production sur cette page, audit du 30-31/08/2026 — /messages plantait pour tout joueur ayant
// déjà un client_id résolu).
import { resolveMessageAttachments, type MessageData } from "./messageAttachments";

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
//
// BUG CORRIGÉ le 15/08 : le code ne tentait resolve_player_client_id que si player?.playerId
// existait (donc un club affilié, player_profiles) — un joueur SANS club (parcours signup
// "Non / plus tard", tout à fait valide) n'avait jamais de clientId résolu, Messages restait
// vide/indisponible même après avoir déjà réservé une prestation. Même classe de bug que celui
// corrigé sur connect-player-prestations (Mes commandes/Factures) : repli sur
// connect_resolve_beneficiary_client_id(kind:"self") quand player_profiles n'existe pas.
export default async function MessagesPage() {
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);

  let clientId: string | null = null;
  let messages: MessageData[] = [];
  let unavailable = false;

  const { data: resolvedId, error } = player?.playerId
    ? await supabase.rpc("resolve_player_client_id", { p_player_id: player.playerId })
    : await supabase.rpc("connect_resolve_beneficiary_client_id", { p_kind: "self", p_ref_id: null });

  if (error || !resolvedId) {
    unavailable = true;
  } else {
    clientId = resolvedId as string;
    const { data } = await supabase
      .from("messages_client")
      .select("id, auteur_type, contenu, piece_jointe_path, lu, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });

    messages = await resolveMessageAttachments(
      supabase,
      (data ?? []) as Array<{ id: string; auteur_type: string; contenu: string; piece_jointe_path: string | null; lu: boolean; created_at: string }>,
    );
  }

  return <MessagesThread clientId={clientId} initialMessages={messages} unavailable={unavailable} />;
}
