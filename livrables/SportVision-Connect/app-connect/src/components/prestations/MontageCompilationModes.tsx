import type { CatalogueOffer } from "@/lib/prestations/catalogue";
import { baseHtForDuration, prixHtLienMatch, tarifLienMatchMax } from "@/lib/prestations/catalogue";
import { formatEUR } from "@/lib/prestations/format";

// Présentation informative des 2 modes de livraison de "Montage Compilation" (migration-connect-
// v63/v64) — affichée EN AMONT du wizard de réservation (fiche offre Espace joueur :
// prestations/[id]/page.tsx, carte catalogue Espace particulier : PrestationsParticulierView.tsx)
// pour que le client comprenne l'offre avant de s'engager, à la demande de Fouka. Le choix réel du
// mode reste fait et enregistré à l'étape 1 du wizard (ReservationWizard.tsx /
// ReservationWizardParticulier.tsx, tous deux INCHANGÉS) — ce composant est purement informatif,
// n'écrit rien, ne s'affiche que là où l'appelant vérifie `offer.slug === MONTAGE_COMPILATION_SLUG`.
//
// Aucun prix n'est recalculé ici en dur : les montants HT viennent exclusivement des helpers
// exportés par catalogue.ts (baseHtForDuration, prixHtLienMatch, tarifLienMatchMax) — seule la
// conversion HT → TTC (même formule que le reste du fichier appelant, ex. les options cochables de
// prestations/[id]/page.tsx) est faite ici pour l'affichage. La source de vérité du montant
// réellement facturé reste, comme partout ailleurs, create-checkout-session côté serveur.
export function MontageCompilationModes({
  offer,
}: {
  offer: Pick<CatalogueOffer, "prixHt" | "tvaPct" | "tarifPalier" | "tarifLienMatch">;
}) {
  const seuilMinutes = offer.tarifPalier?.seuilMinutes ?? 6;
  const baseHt = baseHtForDuration({ prixHt: offer.prixHt, tarifPalier: offer.tarifPalier }, null);
  const baseTtc = baseHt != null ? toTtc(baseHt, offer.tvaPct) : null;
  const auDelaHt = offer.tarifPalier?.prixHtAuDela ?? null;
  const auDelaTtc = auDelaHt != null ? toTtc(auDelaHt, offer.tvaPct) : null;

  const tiers = offer.tarifLienMatch;
  const minNbMatchs = tiers?.[0]?.nbMatchs ?? null;
  const maxNbMatchs = tarifLienMatchMax(tiers);
  const minTtc = toTtcOrNull(prixHtLienMatch(tiers, minNbMatchs), offer.tvaPct);
  const maxTtc = toTtcOrNull(prixHtLienMatch(tiers, maxNbMatchs), offer.tvaPct);

  if (baseTtc == null && minTtc == null) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-2 rounded-sv border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-sv bg-prestations-bg">
            <span className="material-symbols-rounded !text-[17px] text-prestations">content_cut</span>
          </span>
          <span className="font-sora text-[14px] font-semibold">Rushs déjà découpés</span>
        </div>
        <p className="text-[12.5px] leading-relaxed text-text-tertiary">
          Vous avez déjà vos meilleures actions, prêtes à l&apos;envoi.
        </p>
        <div className="mt-1 flex flex-col gap-0.5">
          <span className="font-sora text-[16px] font-semibold">
            {baseTtc != null ? `à partir de ${formatEUR(baseTtc)} TTC` : "Sur devis"}
          </span>
          <span className="text-[12px] leading-relaxed text-text-faint">
            Jusqu&apos;à {seuilMinutes} min de rush incluses — au-delà,{" "}
            {auDelaTtc != null ? `${formatEUR(auDelaTtc)} TTC` : "sur devis"}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-sv border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-sv bg-prestations-bg">
            <span className="material-symbols-rounded !text-[17px] text-prestations">link</span>
          </span>
          <span className="font-sora text-[14px] font-semibold">Lien du match complet</span>
        </div>
        <p className="text-[12.5px] leading-relaxed text-text-tertiary">
          SportVision repère et découpe les temps forts pour vous.
        </p>
        <div className="mt-1 flex flex-col gap-0.5">
          <span className="font-sora text-[16px] font-semibold">
            {minTtc != null ? `à partir de ${formatEUR(minTtc)} TTC` : "Sur devis"}
            {minNbMatchs != null ? ` (${minNbMatchs} match${minNbMatchs > 1 ? "s" : ""})` : ""}
          </span>
          <span className="text-[12px] leading-relaxed text-text-faint">
            {maxTtc != null && maxNbMatchs != null
              ? `Jusqu'à ${formatEUR(maxTtc)} TTC (${maxNbMatchs} matchs) — au-delà, sur devis`
              : "Tarif selon le nombre de matchs — au-delà, sur devis"}
          </span>
        </div>
      </div>
    </div>
  );
}

function toTtc(prixHt: number, tvaPct: number): number {
  return Math.round(prixHt * (1 + tvaPct / 100) * 100) / 100;
}

function toTtcOrNull(prixHt: number | null, tvaPct: number): number | null {
  return prixHt != null ? toTtc(prixHt, tvaPct) : null;
}
