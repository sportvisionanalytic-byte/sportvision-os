import type { SupabaseClient } from "@supabase/supabase-js";

// rendez_vous (migration-portail-v1.sql § 8) — demandes de créneau (découverte, audit...) prises
// depuis Connect, confirmées par le staff dans l'OS (SportVision-OS-Full.html,
// confirmerRdvClient/annulerRdvClient/marquerRealiseRdvClient). RLS déjà en place, rien de
// nouveau à migrer :
//   - "rdv_client_own" (select) et "rdv_client_insert" (insert) : exists (select 1 from
//     client_users cu where cu.id = auth.uid() and cu.client_id = rendez_vous.client_id) —
//     un client authentifié ne voit/n'écrit que ses propres rendez-vous.
//   - "rdv_staff_all" : staff (admin/sec/com) accès complet, gestion du cycle de vie côté OS.
// Périmètre volontairement identique au module vanilla ProjetModules.rdv (espace: 'projet'
// uniquement, voir app/modules/projet-demandes-livrables-messagerie-compte.js lignes 297-389) :
// aucune policy équivalente n'existe pour un club/coach/académie aujourd'hui (client_id vient
// directement de organization.id pour l'Espace Projet, voir use-client-id.ts) — pas de bascule
// club ici tant que ce périmètre n'est pas décidé côté produit.

export type RdvType = "appel" | "physique";
export type RdvStatut = "a_confirmer" | "confirme" | "annule" | "realise";

export interface Rdv {
  id: string;
  typeRdv: RdvType;
  objet: string | null;
  dateDemandee: string | null;
  heureDemandee: string | null;
  statut: RdvStatut;
  prestationId: string | null;
  createdAt: string;
}

interface RdvRow {
  id: string;
  type_rdv: RdvType;
  objet: string | null;
  date_demandee: string | null;
  heure_demandee: string | null;
  statut: RdvStatut;
  prestation_id: string | null;
  created_at: string;
}

const SELECT = "id, type_rdv, objet, date_demandee, heure_demandee, statut, prestation_id, created_at";

function toRdv(row: RdvRow): Rdv {
  return {
    id: row.id,
    typeRdv: row.type_rdv,
    objet: row.objet,
    dateDemandee: row.date_demandee,
    heureDemandee: row.heure_demandee,
    statut: row.statut,
    prestationId: row.prestation_id,
    createdAt: row.created_at,
  };
}

export async function fetchRdv(supabase: SupabaseClient, clientId: string): Promise<Rdv[]> {
  const { data, error } = await supabase
    .from("rendez_vous")
    .select(SELECT)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as RdvRow[]).map(toRdv);
}

export interface CreateRdvInput {
  typeRdv: RdvType;
  /** yyyy-mm-dd */
  date: string;
  /** HH:MM, borné 07:00-22:00 côté formulaire (même contrainte que le vanilla, pas de CHECK DB) */
  heure: string;
  objet?: string;
  /** Rattachement optionnel à une prestation existante — colonne prestation_id, nullable */
  prestationId?: string | null;
}

export async function createRdv(supabase: SupabaseClient, clientId: string, input: CreateRdvInput): Promise<Rdv> {
  const { data, error } = await supabase
    .from("rendez_vous")
    .insert({
      client_id: clientId,
      prestation_id: input.prestationId || null,
      type_rdv: input.typeRdv,
      objet: input.objet || null,
      date_demandee: input.date,
      heure_demandee: input.heure,
    })
    .select(SELECT)
    .single();
  if (error || !data) throw error ?? new Error("Envoi de la demande de rendez-vous impossible.");
  return toRdv(data as RdvRow);
}
