import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

// Abonnement Supabase Realtime générique — synchronisation live Connect↔OS (chantier du
// 11/08/2026, voir migration-connect-v42-enable-realtime-sync.sql). Ne fait QUE déclencher un
// rechargement via la fonction de fetch déjà existante de l'écran appelant (`onChange`) : ce
// fichier ne duplique jamais de logique de requête/mapping, seul le branchement au canal Realtime
// est factorisé ici pour éviter de répéter le même boilerplate .channel()/.on()/.subscribe() dans
// chaque composant.
//
// Dégradation silencieuse : la migration v42 ajoute les tables à la publication
// `supabase_realtime`, mais tant qu'elle n'a pas été exécutée par Fouka (ou si le WebSocket
// échoue pour toute autre raison — réseau, quota Realtime, etc.), aucun événement n'arrive
// jamais. `channel.subscribe()` est appelé volontairement SANS callback de statut : le SDK
// réaltime-js n'invoque alors jamais de gestionnaire d'erreur (voir RealtimeChannel.subscribe,
// tous les appels à `callback?.(...)`), donc aucune exception JS, aucun throw, aucun message
// d'erreur visible pour l'utilisateur — l'écran reste pleinement fonctionnel au fetch initial +
// actions manuelles déjà en place, exactement comme avant ce chantier.
export function subscribeTable(
  supabase: SupabaseClient,
  channelName: string,
  table: string,
  filter: string | undefined,
  onChange: () => void,
): RealtimeChannel {
  const channel = supabase.channel(channelName).on(
    "postgres_changes",
    filter
      ? { event: "*", schema: "public", table, filter }
      : { event: "*", schema: "public", table },
    () => onChange(),
  );
  channel.subscribe();
  return channel;
}
