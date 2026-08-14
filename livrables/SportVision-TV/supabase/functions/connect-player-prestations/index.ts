// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// connect-player-prestations → coller ce code → Deploy (fonction déjà déployée le 14/08,
// ce fichier la MODIFIE — redéploiement requis, ce n'est plus "jamais déployée").
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents
// par défaut sur le projet).

// Supabase Edge Function — connect-player-prestations
//
// Sert le module Prestations / Mes commandes / Factures & paiements de l'espace joueur du
// nouveau Connect personnel (livrables/SportVision-Connect/app-connect). Voir
// MASTER-CONNECT-V1.md §17-18-24-25 et design-connect-personnel-12-08/README.md.
//
// Pourquoi une Edge Function plutôt que des vues client_prestations/client_factures/
// client_devis/client_contrats + policies RLS directes (comme app-next/Espace Projet) :
// ces vues (migration-portail-v1/v2/v8, étendues par migration-clubplus-v33 et
// migration-connect-v41) ne filtrent QUE via `client_users` (compte "Espace Projet"/club) —
// aucune n'a de branche pour un joueur dont le client_id est résolu via
// `resolve_player_client_id` (player_profiles.client_id, migration-connect-v43). Étendre ces 4
// vues + la policy `prestations_client_insert` avec une branche `player_has_client_access(...)`
// (même patron que la branche déjà ajoutée à `messages_client` par v43) est possible et documenté
// en bas de ce fichier comme piste alternative, mais aurait un rayon d'action plus large (vues
// partagées avec Club+/Espace Projet) pour un bénéfice équivalent. Cette fonction reproduit le
// même filtrage explicitement, scopé au SEUL joueur authentifié, avec service_role — strictement
// le même patron déjà en place dans app-connect pour toutes les écritures (voir
// connect-player-onboarding), donc aucune nouvelle surface de risque introduite par cette
// fonction elle-même.
//
// Résolution du joueur → client_id : identique à useClientId.ts (app-next) et
// resolveClubPortailClientId — appelle resolve_player_client_id(p_player_id) via le client
// PORTANT LE JWT DE L'UTILISATEUR (jamais via service_role : la fonction SQL est
// SECURITY DEFINER et vérifie elle-même `where id = p_player_id and user_id = auth.uid()`,
// donc auth.uid() doit être résolvable — impossible avec le rôle service_role, qui n'a pas de
// JWT utilisateur).
//
// ──────────────────────────────────────────────────────────────────────────────────────────
// EXTENSION 14/08 (migration-connect-v51-espace-particulier.sql) — Espace particulier.
// Un particulier n'a JAMAIS de ligne player_profiles (voir la migration, §1) : l'appeler sans
// adaptation renvoyait donc systématiquement "Profil joueur introuvable" (resolvePlayerAndClient
// ci-dessous), y compris pour réserver pour lui-même. Deux ajouts, tous deux rétrocompatibles
// (aucun appel existant côté Espace joueur n'est modifié — testé en relisant chaque appelant
// dans app-connect : aucun n'envoie `beneficiary` ni `multi`) :
//
//  1. `beneficiary?: { kind: "self"|"linked"|"managed", refId?: string }` sur "create_request" et
//     "get_order" — remplace la résolution player_profiles-only par
//     connect_resolve_beneficiary_client_id(kind, refId) (RPC, vérifie elle-même le droit
//     "reserver" pour le cas "linked"). `kind:"self"` couvre "Réserver pour moi" côté
//     particulier (pas de player_profiles, résolution via connect_profile_settings.client_id).
//     "create_request" enregistre alors `booked_by_user_id = auth.uid()` UNIQUEMENT quand le
//     bénéficiaire n'est pas l'appelant lui-même (kind "linked"/"managed") — NULL sinon,
//     comportement strictement inchangé pour tout appelant sans `beneficiary`.
//  2. `multi?: boolean` sur "list_orders"/"list_invoices"/"list_payments" — au lieu du seul
//     client_id du joueur courant, agrège tous les client_id accessibles à l'appelant pour le
//     droit pertinent ("commandes" ou "factures") via connect_client_ids_for_caller(), pour les
//     listes multi-sportifs (README § Espace particulier → Listes multi-sportifs). Chaque ligne
//     renvoyée porte alors `forWho` (label du sportif, ou null pour l'appelant lui-même).
// ──────────────────────────────────────────────────────────────────────────────────────────
//
// Actions (`action` dans le body, toutes authentifiées) :
//  - "create_request" { offerId, dateMatch, heureDebut?, heureFin?, lieu?, adversaire?,
//                        categorie?, equipe?, notes?, optionNames?: string[],
//                        retractationRenoncee?, beneficiary? }
//      → crée la ligne `prestations` (statut initial 'demande_reçue', jamais un statut inventé).
//        Ne persiste JAMAIS de montant (montant_ht/montant_ttc restent NULL, exactement comme
//        submitClientService côté Espace Projet) : c'est create-checkout-session qui calcule le
//        montant à la volée depuis le catalogue au moment du paiement (déjà son comportement
//        existant pour une prestation tout juste créée par un client, cf. son commentaire
//        "vient d'être créée par le client et n'a pas encore été chiffrée par le staff").
//  - "list_orders" { multi? } → les prestations du joueur authentifié (Mes commandes), ou de
//        tous ses bénéficiaires accessibles si multi=true.
//  - "get_order" { id, beneficiary? } → une prestation + ses factures/paiements liés (fiche détail).
//  - "list_invoices" { multi? } → les factures du joueur authentifié / multi-sportifs.
//  - "list_payments" { multi? } → les paiements du joueur authentifié / multi-sportifs.
//
// Notification staff : automatique via le trigger trg_prestations_notify_demande (migration-
// portail-v10.sql) sur tout INSERT dans `prestations` où statut='demande_reçue' et
// created_by is null — exactement le cas ici (created_by n'est jamais renseigné par un client).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface CatalogueOfferRow {
  id: string;
  nom: string;
  categorie: string;
  tarif_type: "fixe" | "sur_devis";
  prix_ht: number | null;
  tva_pct: number | null;
  options: Array<{ nom?: string; prix_ht?: number }> | null;
  actif: boolean;
}

// Même calcul que create-checkout-session/index.ts (doit rester en phase avec cette fonction —
// aucune des deux ne doit dupliquer un tarif différent) : base HT + options sélectionnées, TTC
// arrondi au centime. Utilisé uniquement comme ESTIMATION affichée avant chiffrage staff, jamais
// écrit dans prestations.montant_ttc.
function estimateTtc(offer: Pick<CatalogueOfferRow, "tarif_type" | "prix_ht" | "tva_pct" | "options">, selected: string[]): number | null {
  if (offer.tarif_type !== "fixe" || offer.prix_ht == null) return null;
  const options = Array.isArray(offer.options) ? offer.options : [];
  const optionsHt = options
    .filter((o) => o.nom && selected.includes(o.nom))
    .reduce((sum, o) => sum + Number(o.prix_ht || 0), 0);
  const totalHt = Number(offer.prix_ht) + optionsHt;
  return Math.round(totalHt * (1 + Number(offer.tva_pct ?? 20) / 100) * 100) / 100;
}

function needsRetractationWaiver(dateIso: string): boolean {
  if (!dateIso) return false;
  const target = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((target.getTime() - today.getTime()) / 86400000);
  return diffDays >= 0 && diffDays < 14;
}

// deno-lint-ignore no-explicit-any
async function resolvePlayerAndClient(admin: any, userClient: any, userId: string) {
  const { data: profile } = await admin
    .from("player_profiles")
    .select("id, prenom, nom")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return { error: "Profil joueur introuvable. Complétez votre profil avant de réserver une prestation." as const };

  const { data: clientId, error: rpcErr } = await userClient.rpc("resolve_player_client_id", { p_player_id: profile.id });
  if (rpcErr || !clientId) {
    return { error: "Impossible d'identifier votre dossier client pour le moment. Réessayez dans un instant." as const };
  }
  return { playerId: profile.id as string, clientId: clientId as string, prenom: profile.prenom as string, nom: profile.nom as string };
}

// Bénéficiaire explicite (Espace particulier, migration-connect-v51) : { kind: "self"|"linked"|
// "managed", refId?: string }. La vérification du droit "reserver" pour "linked" est faite CÔTÉ
// SERVEUR dans connect_resolve_beneficiary_client_id (SECURITY DEFINER) — jamais ici, jamais côté
// client. bookedByUserId n'est renseigné que si le bénéficiaire n'est pas l'appelant lui-même.
// deno-lint-ignore no-explicit-any
async function resolveBeneficiaryClientId(userClient: any, callerId: string, beneficiary: { kind?: string; refId?: string }) {
  const kind = beneficiary?.kind;
  if (kind !== "self" && kind !== "linked" && kind !== "managed") {
    return { error: "Bénéficiaire invalide." as const };
  }
  const refId = kind === "self" ? null : beneficiary.refId || null;
  if (kind !== "self" && !refId) {
    return { error: "Sportif requis." as const };
  }
  const { data, error } = await userClient.rpc("connect_resolve_beneficiary_client_id", { p_kind: kind, p_ref_id: refId });
  if (error || !data) {
    return { error: error?.message || "Impossible de résoudre le bénéficiaire pour le moment." as const };
  }
  const bookedByUserId = kind === "self" || (kind === "linked" && refId === callerId) ? null : callerId;
  return { clientId: data as string, bookedByUserId };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;
    const multi = body?.multi === true;
    const beneficiary = body?.beneficiary as { kind?: string; refId?: string } | undefined;

    // "multi" (listes multi-sportifs, Espace particulier) : pas de résolution joueur unique —
    // court-circuite complètement resolvePlayerAndClient (qui échouerait pour un compte
    // particulier sans player_profiles).
    if (multi && (action === "list_orders" || action === "get_order" || action === "list_invoices" || action === "list_payments")) {
      const right = action === "list_invoices" || action === "list_payments" ? "factures" : "commandes";
      const { data: accessRows, error: accessErr } = await userClient.rpc("connect_client_ids_for_caller", { p_right: right });
      if (accessErr) return json({ error: accessErr.message }, 500);

      const callerRows = (accessRows || []) as Array<{ client_id: string; kind: string; ref_id: string; label: string | null }>;
      const clientIds = Array.from(new Set(callerRows.map((r) => r.client_id)));
      const labelByClientId = new Map(callerRows.map((r) => [r.client_id, r.kind === "self" ? null : r.label]));

      if (clientIds.length === 0) {
        if (action === "list_orders") return json({ orders: [] });
        if (action === "get_order") return json({ error: "Commande introuvable" }, 404);
        if (action === "list_invoices") return json({ invoices: [] });
        return json({ payments: [] });
      }

      // get_order + multi (Espace particulier, fiche commande) : identique à "get_order" legacy
      // ci-dessous, mais cherche l'id parmi TOUS les client_id accessibles à l'appelant (pas un
      // seul), puisqu'un particulier n'a pas de client_id unique — voir connect_client_ids_for_
      // caller (migration-connect-v51 §4).
      if (action === "get_order") {
        const orderId = String(body?.id || "").trim();
        if (!orderId) return json({ error: "Identifiant requis" }, 400);
        const { data: row, error } = await admin
          .from("prestations")
          .select(
            "id, reference, statut, type_prestation, offre_id, client_id, date_prestation, heure_debut, heure_fin, lieu, adresse_complete, equipes, description_besoin, options_selectionnees, montant_ttc, statut_financier, acompte_recu, created_at",
          )
          .eq("id", orderId)
          .in("client_id", clientIds)
          .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (!row) return json({ error: "Commande introuvable" }, 404);

        let offer: CatalogueOfferRow | undefined;
        if (row.offre_id) {
          const { data: o } = await admin
            .from("catalogue_offres")
            .select("id, nom, categorie, tarif_type, prix_ht, tva_pct, options, actif")
            .eq("id", row.offre_id)
            .maybeSingle();
          offer = o as CatalogueOfferRow | undefined;
        }
        const optionsSelectionnees = Array.isArray(row.options_selectionnees) ? (row.options_selectionnees as string[]) : [];
        const order = {
          id: row.id,
          reference: row.reference,
          statut: row.statut,
          offreNom: offer?.nom ?? null,
          categorie: (row.type_prestation as string) ?? offer?.categorie ?? null,
          datePrestation: row.date_prestation,
          heureDebut: row.heure_debut,
          heureFin: row.heure_fin,
          lieu: row.lieu,
          adresseComplete: row.adresse_complete,
          equipes: row.equipes,
          descriptionBesoin: row.description_besoin,
          optionsSelectionnees,
          montantTtc: row.montant_ttc,
          montantEstime: row.montant_ttc == null && offer ? estimateTtc(offer, optionsSelectionnees) : null,
          statutFinancier: row.statut_financier,
          acompteRecu: !!row.acompte_recu,
          createdAt: row.created_at,
          forWho: labelByClientId.get(row.client_id as string) ?? null,
        };

        const [{ data: factures }, { data: paiements }] = await Promise.all([
          admin.from("factures").select("id, numero, statut, montant_ttc, date_emission, pdf_url").eq("prestation_id", orderId).eq("client_id", row.client_id),
          admin.from("paiements").select("id, statut, montant, type_paiement, created_at").eq("prestation_id", orderId).eq("client_id", row.client_id),
        ]);
        return json({
          order,
          documents: [
            ...(factures || []).map((f: { id: string; numero: string; statut: string; montant_ttc: number; date_emission: string | null; pdf_url: string | null }) => ({
              kind: "facture", id: f.id, reference: f.numero, statut: f.statut, montant: f.montant_ttc, date: f.date_emission, pdfUrl: f.pdf_url,
            })),
            ...(paiements || []).map((p: { id: string; statut: string; montant: number; type_paiement: string; created_at: string }) => ({
              kind: "paiement", id: p.id, reference: p.type_paiement, statut: p.statut, montant: p.montant, date: p.created_at,
            })),
          ],
        });
      }

      if (action === "list_orders") {
        const { data: prowsRaw, error } = await admin
          .from("prestations")
          .select(
            "id, reference, statut, type_prestation, offre_id, client_id, date_prestation, heure_debut, heure_fin, lieu, adresse_complete, equipes, description_besoin, options_selectionnees, montant_ttc, statut_financier, acompte_recu, created_at",
          )
          .in("client_id", clientIds)
          .order("date_prestation", { ascending: false, nullsFirst: false });
        if (error) return json({ error: error.message }, 500);

        const offerIds = Array.from(new Set((prowsRaw || []).map((r: { offre_id: string | null }) => r.offre_id).filter(Boolean)));
        const offersById = new Map<string, CatalogueOfferRow>();
        if (offerIds.length) {
          const { data: offers } = await admin
            .from("catalogue_offres")
            .select("id, nom, categorie, tarif_type, prix_ht, tva_pct, options, actif")
            .in("id", offerIds);
          for (const o of offers || []) offersById.set(o.id, o as CatalogueOfferRow);
        }

        const orders = (prowsRaw || []).map((r: Record<string, unknown>) => {
          const offer = r.offre_id ? offersById.get(r.offre_id as string) : undefined;
          const optionsSelectionnees = Array.isArray(r.options_selectionnees) ? (r.options_selectionnees as string[]) : [];
          return {
            id: r.id,
            reference: r.reference,
            statut: r.statut,
            offreNom: offer?.nom ?? null,
            categorie: (r.type_prestation as string) ?? offer?.categorie ?? null,
            datePrestation: r.date_prestation,
            heureDebut: r.heure_debut,
            heureFin: r.heure_fin,
            lieu: r.lieu,
            adresseComplete: r.adresse_complete,
            equipes: r.equipes,
            descriptionBesoin: r.description_besoin,
            optionsSelectionnees,
            montantTtc: r.montant_ttc,
            montantEstime: r.montant_ttc == null && offer ? estimateTtc(offer, optionsSelectionnees) : null,
            statutFinancier: r.statut_financier,
            acompteRecu: !!r.acompte_recu,
            createdAt: r.created_at,
            forWho: labelByClientId.get(r.client_id as string) ?? null,
          };
        });
        return json({ orders });
      }

      if (action === "list_invoices") {
        const { data: rows, error } = await admin
          .from("factures")
          .select("id, numero, type_facture, statut, prestation_id, client_id, montant_ht, tva_pct, montant_ttc, date_emission, date_echeance, pdf_url")
          .in("client_id", clientIds)
          .order("date_emission", { ascending: false, nullsFirst: false });
        if (error) return json({ error: error.message }, 500);

        const prestationIds = Array.from(new Set((rows || []).map((r: { prestation_id: string | null }) => r.prestation_id).filter(Boolean)));
        const prestaById = new Map<string, { reference: string; offre_id: string | null }>();
        if (prestationIds.length) {
          const { data: prestas } = await admin.from("prestations").select("id, reference, offre_id").in("id", prestationIds);
          for (const p of prestas || []) prestaById.set(p.id, p);
        }
        const offerIds = Array.from(new Set(Array.from(prestaById.values()).map((p) => p.offre_id).filter(Boolean))) as string[];
        const offerNomById = new Map<string, string>();
        if (offerIds.length) {
          const { data: offers } = await admin.from("catalogue_offres").select("id, nom").in("id", offerIds);
          for (const o of offers || []) offerNomById.set(o.id, o.nom);
        }

        const invoices = (rows || []).map((r: Record<string, unknown>) => {
          const presta = r.prestation_id ? prestaById.get(r.prestation_id as string) : undefined;
          return {
            id: r.id,
            numero: r.numero,
            typeFacture: r.type_facture,
            statut: r.statut,
            prestationId: r.prestation_id,
            prestationRef: presta?.reference ?? null,
            offreNom: presta?.offre_id ? offerNomById.get(presta.offre_id) ?? null : null,
            montantHt: r.montant_ht,
            tvaPct: r.tva_pct,
            montantTtc: r.montant_ttc,
            dateEmission: r.date_emission,
            dateEcheance: r.date_echeance,
            pdfUrl: r.pdf_url,
            forWho: labelByClientId.get(r.client_id as string) ?? null,
          };
        });
        return json({ invoices });
      }

      // list_payments (dernière action possible ici, cf. le if d'ouverture du bloc "multi")
      if (action === "list_payments") {
        const { data: rows, error } = await admin
          .from("paiements")
          .select("id, type_paiement, montant, statut, prestation_id, client_id, created_at")
          .in("client_id", clientIds)
          .order("created_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);

        const prestationIds = Array.from(new Set((rows || []).map((r: { prestation_id: string | null }) => r.prestation_id).filter(Boolean)));
        const prestaById = new Map<string, { reference: string; offre_id: string | null }>();
        if (prestationIds.length) {
          const { data: prestas } = await admin.from("prestations").select("id, reference, offre_id").in("id", prestationIds);
          for (const p of prestas || []) prestaById.set(p.id, p);
        }
        const offerIds = Array.from(new Set(Array.from(prestaById.values()).map((p) => p.offre_id).filter(Boolean))) as string[];
        const offerNomById = new Map<string, string>();
        if (offerIds.length) {
          const { data: offers } = await admin.from("catalogue_offres").select("id, nom").in("id", offerIds);
          for (const o of offers || []) offerNomById.set(o.id, o.nom);
        }

        const payments = (rows || []).map((r: Record<string, unknown>) => {
          const presta = r.prestation_id ? prestaById.get(r.prestation_id as string) : undefined;
          return {
            id: r.id,
            typePaiement: r.type_paiement,
            montant: r.montant,
            statut: r.statut,
            prestationId: r.prestation_id,
            prestationRef: presta?.reference ?? null,
            offreNom: presta?.offre_id ? offerNomById.get(presta.offre_id) ?? null : null,
            createdAt: r.created_at,
            forWho: labelByClientId.get(r.client_id as string) ?? null,
          };
        });
        return json({ payments });
      }
    }

    // Actions nécessitant UN client_id précis (celui de l'appelant, ou celui d'un bénéficiaire
    // explicite) : résolution legacy (joueur) sauf si `beneficiary` est fourni.
    let clientId: string;
    let bookedByUserId: string | null = null;
    if (beneficiary) {
      const resolvedBenef = await resolveBeneficiaryClientId(userClient, user.id, beneficiary);
      if ("error" in resolvedBenef) return json({ error: resolvedBenef.error }, 400);
      clientId = resolvedBenef.clientId;
      bookedByUserId = resolvedBenef.bookedByUserId;
    } else {
      const resolved = await resolvePlayerAndClient(admin, userClient, user.id);
      if ("error" in resolved) return json({ error: resolved.error }, 404);
      clientId = resolved.clientId;
    }

    if (action === "create_request") {
      const offerId = String(body?.offerId || "").trim();
      const dateMatch = String(body?.dateMatch || "").trim();
      if (!offerId) return json({ error: "Prestation requise" }, 400);
      if (!dateMatch) return json({ error: "Date requise" }, 400);

      const { data: offer, error: offerErr } = await admin
        .from("catalogue_offres")
        .select("id, nom, categorie, tarif_type, prix_ht, tva_pct, options, actif")
        .eq("id", offerId)
        .eq("actif", true)
        .maybeSingle();
      if (offerErr) return json({ error: offerErr.message }, 500);
      if (!offer) return json({ error: "Prestation introuvable ou indisponible" }, 404);

      const catalogueOptionNames = new Set((Array.isArray(offer.options) ? offer.options : []).map((o: { nom?: string }) => o.nom).filter(Boolean));
      const optionNames: string[] = Array.isArray(body?.optionNames)
        ? body.optionNames.filter((n: unknown) => typeof n === "string" && catalogueOptionNames.has(n))
        : [];

      if (needsRetractationWaiver(dateMatch) && body?.retractationRenoncee !== true) {
        return json({ error: "Cette date est dans moins de 14 jours : la renonciation au délai de rétractation est requise." }, 400);
      }

      const nowIso = new Date().toISOString();
      const paiementMode = body?.paiementMode === "collectif" ? "collectif" : "seul";
      const descriptionParts = [
        `Prestation demandée (Connect — ${beneficiary && beneficiary.kind !== "self" ? "Espace particulier" : "Espace joueur"}) : ${offer.nom}`,
        body?.adversaire ? `Adversaire : ${String(body.adversaire).trim()}` : null,
        body?.categorie ? `Catégorie : ${String(body.categorie).trim()}` : null,
        body?.notes ? `Notes : ${String(body.notes).trim()}` : null,
        paiementMode === "collectif"
          ? "Paiement souhaité : à plusieurs (cotisation) — fonctionnalité de paiement collectif pas encore branchée au moment de la demande, à confirmer avec le client."
          : "Paiement souhaité : seul.",
      ].filter((p): p is string => !!p);

      const { data: inserted, error: insErr } = await admin
        .from("prestations")
        .insert({
          statut: "demande_reçue",
          client_id: clientId,
          booked_by_user_id: bookedByUserId,
          offre_id: offer.id,
          type_prestation: offer.categorie,
          date_prestation: dateMatch,
          heure_debut: body?.heureDebut || null,
          heure_fin: body?.heureFin || null,
          lieu: body?.lieu || null,
          adresse_complete: body?.lieu || null,
          equipes: body?.equipe || null,
          description_besoin: descriptionParts.join("\n"),
          options_selectionnees: optionNames,
          retractation_renoncee: body?.retractationRenoncee === true,
          retractation_renoncee_at: body?.retractationRenoncee === true ? nowIso : null,
          cgv_acceptee: true,
          cgv_acceptee_le: nowIso,
        })
        .select("id, reference")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);

      return json({ ok: true, id: inserted.id, reference: inserted.reference });
    }

    if (action === "list_orders" || action === "get_order") {
      let query = admin
        .from("prestations")
        .select(
          "id, reference, statut, type_prestation, offre_id, date_prestation, heure_debut, heure_fin, lieu, adresse_complete, equipes, description_besoin, options_selectionnees, montant_ttc, statut_financier, acompte_recu, created_at",
        )
        .eq("client_id", clientId)
        .order("date_prestation", { ascending: false, nullsFirst: false });

      if (action === "get_order") {
        const id = String(body?.id || "").trim();
        if (!id) return json({ error: "Identifiant requis" }, 400);
        query = query.eq("id", id);
      }

      const { data: rows, error } = await query;
      if (error) return json({ error: error.message }, 500);
      if (action === "get_order" && !rows?.length) return json({ error: "Commande introuvable" }, 404);

      const offerIds = Array.from(new Set((rows || []).map((r: { offre_id: string | null }) => r.offre_id).filter(Boolean)));
      const offersById = new Map<string, CatalogueOfferRow>();
      if (offerIds.length) {
        const { data: offers } = await admin
          .from("catalogue_offres")
          .select("id, nom, categorie, tarif_type, prix_ht, tva_pct, options, actif")
          .in("id", offerIds);
        for (const o of offers || []) offersById.set(o.id, o as CatalogueOfferRow);
      }

      const orders = (rows || []).map((r: Record<string, unknown>) => {
        const offer = r.offre_id ? offersById.get(r.offre_id as string) : undefined;
        const optionsSelectionnees = Array.isArray(r.options_selectionnees) ? (r.options_selectionnees as string[]) : [];
        return {
          id: r.id,
          reference: r.reference,
          statut: r.statut,
          offreNom: offer?.nom ?? null,
          categorie: (r.type_prestation as string) ?? offer?.categorie ?? null,
          datePrestation: r.date_prestation,
          heureDebut: r.heure_debut,
          heureFin: r.heure_fin,
          lieu: r.lieu,
          adresseComplete: r.adresse_complete,
          equipes: r.equipes,
          descriptionBesoin: r.description_besoin,
          optionsSelectionnees,
          montantTtc: r.montant_ttc,
          montantEstime: r.montant_ttc == null && offer ? estimateTtc(offer, optionsSelectionnees) : null,
          statutFinancier: r.statut_financier,
          acompteRecu: !!r.acompte_recu,
          createdAt: r.created_at,
        };
      });

      if (action === "get_order") {
        const orderId = orders[0].id;
        const [{ data: factures }, { data: paiements }] = await Promise.all([
          admin
            .from("factures")
            .select("id, numero, statut, montant_ttc, date_emission, pdf_url")
            .eq("prestation_id", orderId)
            .eq("client_id", clientId),
          admin
            .from("paiements")
            .select("id, statut, montant, type_paiement, created_at")
            .eq("prestation_id", orderId)
            .eq("client_id", clientId),
        ]);
        return json({
          order: orders[0],
          documents: [
            ...(factures || []).map((f: { id: string; numero: string; statut: string; montant_ttc: number; date_emission: string | null; pdf_url: string | null }) => ({
              kind: "facture",
              id: f.id,
              reference: f.numero,
              statut: f.statut,
              montant: f.montant_ttc,
              date: f.date_emission,
              pdfUrl: f.pdf_url,
            })),
            ...(paiements || []).map((p: { id: string; statut: string; montant: number; type_paiement: string; created_at: string }) => ({
              kind: "paiement",
              id: p.id,
              reference: p.type_paiement,
              statut: p.statut,
              montant: p.montant,
              date: p.created_at,
            })),
          ],
        });
      }

      return json({ orders });
    }

    if (action === "list_invoices") {
      const { data: rows, error } = await admin
        .from("factures")
        .select("id, numero, type_facture, statut, prestation_id, montant_ht, tva_pct, montant_ttc, date_emission, date_echeance, pdf_url")
        .eq("client_id", clientId)
        .order("date_emission", { ascending: false, nullsFirst: false });
      if (error) return json({ error: error.message }, 500);

      const prestationIds = Array.from(new Set((rows || []).map((r: { prestation_id: string | null }) => r.prestation_id).filter(Boolean)));
      const prestaById = new Map<string, { reference: string; offre_id: string | null }>();
      if (prestationIds.length) {
        const { data: prestas } = await admin.from("prestations").select("id, reference, offre_id").in("id", prestationIds);
        for (const p of prestas || []) prestaById.set(p.id, p);
      }
      const offerIds = Array.from(new Set(Array.from(prestaById.values()).map((p) => p.offre_id).filter(Boolean))) as string[];
      const offerNomById = new Map<string, string>();
      if (offerIds.length) {
        const { data: offers } = await admin.from("catalogue_offres").select("id, nom").in("id", offerIds);
        for (const o of offers || []) offerNomById.set(o.id, o.nom);
      }

      const invoices = (rows || []).map((r: Record<string, unknown>) => {
        const presta = r.prestation_id ? prestaById.get(r.prestation_id as string) : undefined;
        return {
          id: r.id,
          numero: r.numero,
          typeFacture: r.type_facture,
          statut: r.statut,
          prestationId: r.prestation_id,
          prestationRef: presta?.reference ?? null,
          offreNom: presta?.offre_id ? offerNomById.get(presta.offre_id) ?? null : null,
          montantHt: r.montant_ht,
          tvaPct: r.tva_pct,
          montantTtc: r.montant_ttc,
          dateEmission: r.date_emission,
          dateEcheance: r.date_echeance,
          pdfUrl: r.pdf_url,
        };
      });
      return json({ invoices });
    }

    if (action === "list_payments") {
      const { data: rows, error } = await admin
        .from("paiements")
        .select("id, type_paiement, montant, statut, prestation_id, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);

      const prestationIds = Array.from(new Set((rows || []).map((r: { prestation_id: string | null }) => r.prestation_id).filter(Boolean)));
      const prestaById = new Map<string, { reference: string; offre_id: string | null }>();
      if (prestationIds.length) {
        const { data: prestas } = await admin.from("prestations").select("id, reference, offre_id").in("id", prestationIds);
        for (const p of prestas || []) prestaById.set(p.id, p);
      }
      const offerIds = Array.from(new Set(Array.from(prestaById.values()).map((p) => p.offre_id).filter(Boolean))) as string[];
      const offerNomById = new Map<string, string>();
      if (offerIds.length) {
        const { data: offers } = await admin.from("catalogue_offres").select("id, nom").in("id", offerIds);
        for (const o of offers || []) offerNomById.set(o.id, o.nom);
      }

      const payments = (rows || []).map((r: Record<string, unknown>) => {
        const presta = r.prestation_id ? prestaById.get(r.prestation_id as string) : undefined;
        return {
          id: r.id,
          typePaiement: r.type_paiement,
          montant: r.montant,
          statut: r.statut,
          prestationId: r.prestation_id,
          prestationRef: presta?.reference ?? null,
          offreNom: presta?.offre_id ? offerNomById.get(presta.offre_id) ?? null : null,
          createdAt: r.created_at,
        };
      });
      return json({ payments });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ============================================================
// PISTE ALTERNATIVE (non retenue, documentée pour Fouka) :
// Au lieu de cette fonction, étendre les 4 vues client_prestations/client_factures/
// client_devis/client_contrats + la policy prestations_client_insert avec une branche
// `player_has_client_access(...)`, exactement comme migration-connect-v43-espace-joueur.sql
// l'a fait pour messages_client. Avantage : lecture directe côté client (comme app-next/
// projet/billing.ts), pas d'edge function à maintenir. Inconvénient : modifie des vues
// partagées avec Club+ et l'Espace Projet — rayon d'action plus large pour un gain surtout
// stylistique. À trancher avec Fouka si la maintenance de cette fonction dédiée devient lourde.
// ============================================================
