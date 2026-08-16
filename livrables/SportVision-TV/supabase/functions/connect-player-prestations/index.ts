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
// Un particulier n'a JAMAIS de ligne player_profiles (voir la migration, §1) : la résolution
// legacy (player_profiles obligatoire) renvoyait donc systématiquement "Profil joueur
// introuvable", y compris pour réserver pour lui-même — même bug qui touchait un joueur SANS
// club côté Espace joueur, corrigé le 15/08 en remplaçant cette résolution par
// resolveBeneficiaryClientId(kind:"self") partout (voir plus bas). Deux ajouts, tous deux
// rétrocompatibles
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
//                        retractationRenoncee?, beneficiary?, paiementMode?: "seul"|"collectif",
//                        modePaiementChoisi?: "carte"|"especes",
//                        tailleCm?, poidsKg?, poste?, numeroMaillot?, couleurMaillot? }
//        modePaiementChoisi (migration-prestations-choix-paiement-guest.sql, colonne déjà utilisée
//        par le tunnel guest historique create-guest-request/index.ts) : UNIQUEMENT pertinent si
//        paiementMode==="seul" — ignoré silencieusement (jamais écrit) pour "collectif", pour ne
//        créer aucune ambiguïté avec le paiement collectif (cotisation, chantier séparé). Dans les
//        deux cas la demande est créée et confirmée immédiatement, sans aucune condition
//        bloquante — c'est un CHOIX exprimé par le client, jamais un paiement réellement encaissé
//        (ça reste le rôle de prestations.mode_paiement, colonne distincte, jamais touchée ici).
//      → crée la ligne `prestations` (statut initial 'demande_reçue', jamais un statut inventé).
//        Ne persiste JAMAIS de montant (montant_ht/montant_ttc restent NULL, exactement comme
//        submitClientService côté Espace Projet) : c'est create-checkout-session qui calcule le
//        montant à la volée depuis le catalogue au moment du paiement (déjà son comportement
//        existant pour une prestation tout juste créée par un client, cf. son commentaire
//        "vient d'être créée par le client et n'a pas encore été chiffrée par le staff").
//        tailleCm/poidsKg/poste/numeroMaillot/couleurMaillot (migration-connect-v68) : UNIQUEMENT
//        pertinents si offer.slug === MONTAGE_COMPILATION_SLUG (ignorés silencieusement sinon,
//        même garde que modeLivraisonMontage/dureeRushMinutes/nombreMatchsLien/lienMatchUrl déjà
//        en place, v63/v64). numeroMaillot/couleurMaillot sont persistés sur CETTE prestation
//        (prestations.numero_maillot/couleur_maillot) ; les 4 valeurs sont EN PLUS réécrites sur
//        le profil du bénéficiaire (player_profiles ou managed_athlete_profiles) via
//        connect_athlete_profile_coalesce_update (migration-connect-v69) — jamais un écrasement
//        d'une valeur déjà connue du profil, coalesce atomique côté SQL (voir son en-tête).
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
  slug: string;
  nom: string;
  categorie: string;
  tarif_type: "fixe" | "sur_devis";
  prix_ht: number | null;
  tva_pct: number | null;
  options: Array<{ nom?: string; prix_ht?: number }> | null;
  actif: boolean;
}

// Slug de la prestation "Montage Compilation" (migration-connect-v63) — seule offre du catalogue
// à demander une durée de rush déclarée au moment de la commande. Constante partagée avec
// create-checkout-session/index.ts (doit rester en phase — aucune des deux ne doit gater sur un
// slug différent).
const MONTAGE_COMPILATION_SLUG = "montage-compilation";

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
    // court-circuite entièrement la résolution self/beneficiary ci-dessous.
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
            "id, reference, statut, type_prestation, offre_id, client_id, date_prestation, heure_debut, heure_fin, lieu, adresse_complete, equipes, description_besoin, options_selectionnees, montant_ttc, statut_financier, acompte_recu, mode_paiement_choisi, created_at",
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
          modePaiementChoisi: row.mode_paiement_choisi ?? null,
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
            "id, reference, statut, type_prestation, offre_id, client_id, date_prestation, heure_debut, heure_fin, lieu, adresse_complete, equipes, description_besoin, options_selectionnees, montant_ttc, statut_financier, acompte_recu, mode_paiement_choisi, created_at",
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
            modePaiementChoisi: r.mode_paiement_choisi ?? null,
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
      // Bug corrigé le 15/08 : appelait auparavant resolvePlayerAndClient, qui exigeait sans
      // exception une ligne player_profiles (donc un club affilié) — un joueur SANS club
      // (parcours signup "Non / plus tard", tout à fait valide, voir MASTER-CONNECT-V1.md §4)
      // recevait systématiquement "Profil joueur introuvable" sur Mes commandes/Factures/
      // Prestations, alors que ces pages n'exigent aucun club. resolveBeneficiaryClientId avec
      // kind:"self" couvre déjà ce cas (retombe sur connect_profile_settings.client_id quand
      // player_profiles n'existe pas — même RPC déjà utilisée pour l'Espace particulier).
      const resolved = await resolveBeneficiaryClientId(userClient, user.id, { kind: "self" });
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
        .select("id, slug, nom, categorie, tarif_type, prix_ht, tva_pct, options, actif")
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

      // Montage Compilation (migration-connect-v63/v64) propose 2 modes de livraison, choisis par
      // le client, mutuellement exclusifs — requis UNIQUEMENT pour cette offre (ignorés
      // silencieusement pour toute autre). Déclaratif dans les deux cas, jamais recalculé depuis
      // un fichier vidéo (hors scope). create-checkout-session relit CES valeurs en base au
      // moment du paiement — jamais une valeur renvoyée par le client à l'instant du paiement.
      //   - 'rushs_decoupes' (v63, par défaut si modeLivraisonMontage absent, rétrocompatible) :
      //     durée totale de rush en minutes.
      //   - 'lien_match' (v64) : nombre de matchs fournis en lien (1 à 4, au-delà sur devis) + le
      //     ou les lien(s) lui/eux-même(s), texte libre non vide.
      let dureeRushMinutes: number | null = null;
      let modeLivraisonMontage: "rushs_decoupes" | "lien_match" | null = null;
      let nombreMatchsLien: number | null = null;
      let lienMatchUrl: string | null = null;
      if (offer.slug === MONTAGE_COMPILATION_SLUG) {
        modeLivraisonMontage = body?.modeLivraisonMontage === "lien_match" ? "lien_match" : "rushs_decoupes";
        if (modeLivraisonMontage === "lien_match") {
          const n = Number(body?.nombreMatchsLien);
          if (!Number.isFinite(n) || n <= 0) {
            return json({ error: "Nombre de matchs requis (supérieur à 0)." }, 400);
          }
          nombreMatchsLien = Math.round(n);
          const url = typeof body?.lienMatchUrl === "string" ? body.lienMatchUrl.trim() : "";
          if (!url) {
            return json({ error: "Lien(s) vers votre/vos match(s) requis." }, 400);
          }
          lienMatchUrl = url;
        } else {
          const n = Number(body?.dureeRushMinutes);
          if (!Number.isFinite(n) || n <= 0) {
            return json({ error: "Durée totale de vos rushs requise (en minutes, supérieure à 0)." }, 400);
          }
          dureeRushMinutes = Math.round(n);
        }
      }

      // "Informations pour le montage" (migration-connect-v68-fiche-joueur-montage-compilation) —
      // requis UNIQUEMENT pour Montage Compilation (même garde que modeLivraisonMontage/
      // dureeRushMinutes ci-dessus, ignorés silencieusement pour toute autre offre). Tous
      // facultatifs (aucune de ces valeurs ne bloque la création de la demande) : numeroMaillot/
      // couleurMaillot sont propres à CETTE réservation (prestations.numero_maillot/
      // couleur_maillot, migration-connect-v68 §3, jamais relues depuis le profil), tandis que
      // taille/poids/poste/numeroMaillot sont réécrites en retour sur le profil du bénéficiaire
      // plus bas — voir connect_athlete_profile_coalesce_update (migration-connect-v69) — mais
      // UNIQUEMENT sur les colonnes actuellement NULL, jamais un écrasement.
      let tailleCm: number | null = null;
      let poidsKg: number | null = null;
      let poste: string | null = null;
      let numeroMaillot: string | null = null;
      let couleurMaillot: string | null = null;
      if (offer.slug === MONTAGE_COMPILATION_SLUG) {
        const t = Number(body?.tailleCm);
        tailleCm = Number.isFinite(t) && t > 0 ? Math.round(t) : null;
        const p = Number(body?.poidsKg);
        poidsKg = Number.isFinite(p) && p > 0 ? Math.round(p * 100) / 100 : null;
        poste = typeof body?.poste === "string" && body.poste.trim() !== "" ? body.poste.trim() : null;
        numeroMaillot = typeof body?.numeroMaillot === "string" && body.numeroMaillot.trim() !== "" ? body.numeroMaillot.trim() : null;
        couleurMaillot = typeof body?.couleurMaillot === "string" && body.couleurMaillot.trim() !== "" ? body.couleurMaillot.trim() : null;
      }

      const nowIso = new Date().toISOString();
      const paiementMode = body?.paiementMode === "collectif" ? "collectif" : "seul";
      // Choix carte/espèces (paiement solo uniquement, migration-prestations-choix-paiement-guest.sql
      // — colonne déjà utilisée par le tunnel guest historique, create-guest-request/index.ts,
      // reproduite ici à l'identique). N'a de sens QUE pour paiementMode==="seul" : jamais écrit
      // pour "collectif" (cotisation), pour ne créer aucune ambiguïté avec le paiement collectif.
      // Dans les deux cas ("carte" ou "especes") la demande est créée et confirmée immédiatement —
      // aucune condition bloquante, exactement comme le tunnel guest. "especes" signifie
      // uniquement que le client a choisi de régler sur place ; l'encaissement réel restera
      // enregistré par le staff dans prestations.mode_paiement (colonne distincte, jamais touchée
      // ici).
      const modePaiementChoisiRaw = typeof body?.modePaiementChoisi === "string" ? body.modePaiementChoisi : null;
      const modePaiementChoisi =
        paiementMode === "seul" && (modePaiementChoisiRaw === "carte" || modePaiementChoisiRaw === "especes")
          ? modePaiementChoisiRaw
          : null;
      const descriptionParts = [
        `Prestation demandée (Connect — ${beneficiary && beneficiary.kind !== "self" ? "Espace particulier" : "Espace joueur"}) : ${offer.nom}`,
        body?.adversaire ? `Adversaire : ${String(body.adversaire).trim()}` : null,
        body?.categorie ? `Catégorie : ${String(body.categorie).trim()}` : null,
        dureeRushMinutes != null ? `Durée totale des rushs déclarée : ${dureeRushMinutes} min` : null,
        nombreMatchsLien != null ? `Montage depuis lien(s) — nombre de matchs : ${nombreMatchsLien}${nombreMatchsLien > 4 ? " (sur devis, livraison expresse à prévoir)" : ""}` : null,
        lienMatchUrl ? `Lien(s) fourni(s) : ${lienMatchUrl}` : null,
        tailleCm != null ? `Taille du sportif : ${tailleCm} cm` : null,
        poidsKg != null ? `Poids du sportif : ${poidsKg} kg` : null,
        poste ? `Poste : ${poste}` : null,
        numeroMaillot ? `N° de maillot (ce match) : ${numeroMaillot}` : null,
        couleurMaillot ? `Couleur de maillot (ce match) : ${couleurMaillot}` : null,
        body?.notes ? `Notes : ${String(body.notes).trim()}` : null,
        paiementMode === "collectif"
          ? "Paiement souhaité : à plusieurs (cotisation) — fonctionnalité de paiement collectif pas encore branchée au moment de la demande, à confirmer avec le client."
          : modePaiementChoisi === "especes"
            ? "Paiement souhaité : seul, en espèces sur place."
            : "Paiement souhaité : seul, carte bancaire.",
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
          duree_rush_minutes: dureeRushMinutes,
          mode_livraison_montage: modeLivraisonMontage,
          nombre_matchs_lien: nombreMatchsLien,
          lien_match_url: lienMatchUrl,
          // Valeurs propres à CETTE réservation (migration-connect-v68 §3) — peuvent différer du
          // profil (sélection nationale, maillot extérieur...), jamais relues depuis le profil.
          numero_maillot: numeroMaillot,
          couleur_maillot: couleurMaillot,
          retractation_renoncee: body?.retractationRenoncee === true,
          retractation_renoncee_at: body?.retractationRenoncee === true ? nowIso : null,
          cgv_acceptee: true,
          cgv_acceptee_le: nowIso,
          mode_paiement_choisi: modePaiementChoisi,
        })
        .select("id, reference")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);

      // Écriture retour sur le profil du bénéficiaire (migration-connect-v69) — UNIQUEMENT pour
      // Montage Compilation, UNIQUEMENT si au moins une des 4 valeurs a été fournie, jamais
      // bloquant : un échec ici (ex. profil introuvable) ne doit jamais faire échouer une demande
      // déjà enregistrée avec succès. `beneficiary` (kind/refId bruts du body, distincts du
      // résultat déjà consommé de resolveBeneficiaryClientId ci-dessus) porte l'identité du
      // bénéficiaire ; kind "self" implicite quand `beneficiary` est absent (Espace joueur legacy,
      // voir le commentaire de resolveBeneficiaryClientId plus haut).
      if (offer.slug === MONTAGE_COMPILATION_SLUG && (tailleCm != null || poidsKg != null || poste != null || numeroMaillot != null)) {
        const writebackKind = beneficiary?.kind === "linked" || beneficiary?.kind === "managed" ? beneficiary.kind : "self";
        const writebackRefId = writebackKind !== "self" ? beneficiary?.refId || null : null;
        const { error: writebackErr } = await admin.rpc("connect_athlete_profile_coalesce_update", {
          p_kind: writebackKind,
          p_target_user_id: writebackKind === "managed" ? null : writebackKind === "self" ? user.id : writebackRefId,
          p_managed_id: writebackKind === "managed" ? writebackRefId : null,
          p_taille_cm: tailleCm,
          p_poids_kg: poidsKg,
          p_poste: poste,
          p_numero_maillot: numeroMaillot,
        });
        if (writebackErr) {
          console.error("connect_athlete_profile_coalesce_update a échoué (non bloquant) :", writebackErr.message);
        }
      }

      return json({ ok: true, id: inserted.id, reference: inserted.reference });
    }

    if (action === "list_orders" || action === "get_order") {
      let query = admin
        .from("prestations")
        .select(
          "id, reference, statut, type_prestation, offre_id, date_prestation, heure_debut, heure_fin, lieu, adresse_complete, equipes, description_besoin, options_selectionnees, montant_ttc, statut_financier, acompte_recu, mode_paiement_choisi, created_at",
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
          modePaiementChoisi: r.mode_paiement_choisi ?? null,
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
