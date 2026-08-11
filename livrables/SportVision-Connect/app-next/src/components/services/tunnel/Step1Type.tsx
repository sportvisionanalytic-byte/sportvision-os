import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatServicePriceHTOrDevis, type CatalogueOffer } from "@/lib/types/services";

// Étape 1 — choisit une offre réelle du catalogue SportVision (catalogue_offres), même table que
// le tunnel club (ClubServicesBoard/ClubOfferCard). Décision Fouka du 11/08/2026 : plus de grille
// de prix séparée et inventée pour l'Espace Projet, un seul catalogue dans toute l'entreprise.
export function Step1Type({
  offers,
  value,
  onChange,
}: {
  offers: CatalogueOffer[];
  value: string | null;
  onChange: (offerId: string) => void;
}) {
  return (
    <div>
      <h2 className="text-[18px] font-extrabold tracking-tight">Quel type de prestation ?</h2>
      <p className="mt-1 text-[13.5px] text-text-soft">Choisissez le format le plus proche de votre besoin.</p>

      {offers.length === 0 ? (
        <p className="mt-5 py-8 text-center text-[13px] text-text-soft">
          Catalogue en cours de préparation par SportVision.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {offers.map((offer) => {
            const active = value === offer.id;
            return (
              <button
                key={offer.id}
                type="button"
                onClick={() => onChange(offer.id)}
                aria-pressed={active}
                className={cn(
                  "flex flex-col gap-2 rounded-sv-card border p-4 text-left transition-[transform,border-color,box-shadow] duration-sv hover:-translate-y-0.5",
                  active
                    ? "border-brand-blue bg-info-bg shadow-sv-card-hover"
                    : "border-border bg-surface hover:border-brand-blue-pale",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[14px] font-extrabold tracking-tight text-text">{offer.nom}</span>
                  {active && (
                    <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-blue to-brand-violet text-white">
                      <Check className="h-3 w-3" aria-hidden />
                    </span>
                  )}
                </div>
                {offer.description && (
                  <p className="text-[12.5px] leading-relaxed text-text-soft">{offer.description}</p>
                )}
                <span className="mt-auto text-[12px] font-bold text-text-faint">
                  {offer.tarifType === "sur_devis" ? "Sur devis" : formatServicePriceHTOrDevis(offer.prixHt)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
