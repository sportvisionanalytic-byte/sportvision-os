"use client";

import { Aperture, Bot, Camera, Clock, Layers, Lock, Plane, Sparkles, Tent, Trophy, Video, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { isOfferLocked, offerAdvantageLabel, offerPriceLabel } from "@/lib/data/club/bookings";
import { OFFER_CATEGORIE_LABEL, type ClubCatalogueOffre, type ClubPlan, type OfferCategorie } from "@/lib/types/club-bookings";
import { cn } from "@/lib/cn";

// 19/08/2026 (audit pré-lancement) : la carte n'avait aucune identité visuelle par type de
// prestation (13 offres toutes identiques dans une grille plate) — icône + couleur par catégorie
// réelle (catalogue_offres.categorie), même principe de regroupement que la vitrine publique
// (prestations.html), pour rendre le catalogue scannable d'un coup d'œil.
const CATEGORIE_ICON: Record<OfferCategorie, LucideIcon> = {
  photo: Camera,
  video: Video,
  pack: Layers,
  drone: Plane,
  veo: Bot,
  shooting: Aperture,
  tournoi: Trophy,
  stage: Tent,
  contenu: Sparkles,
};

const CATEGORIE_STYLE: Record<OfferCategorie, { icon: string; iconBg: string; tag: string }> = {
  photo: { icon: "text-brand-cyan", iconBg: "bg-brand-cyan/12", tag: "text-brand-cyan" },
  video: { icon: "text-brand-blue-electric", iconBg: "bg-brand-blue-electric/12", tag: "text-brand-blue-electric" },
  pack: { icon: "text-brand-violet", iconBg: "bg-brand-violet/12", tag: "text-brand-violet" },
  drone: { icon: "text-warning-fg", iconBg: "bg-warning-bg", tag: "text-warning-fg" },
  veo: { icon: "text-warning-fg", iconBg: "bg-warning-bg", tag: "text-warning-fg" },
  shooting: { icon: "text-brand-cyan", iconBg: "bg-brand-cyan/12", tag: "text-brand-cyan" },
  tournoi: { icon: "text-success-fg", iconBg: "bg-success-bg", tag: "text-success-fg" },
  stage: { icon: "text-success-fg", iconBg: "bg-success-bg", tag: "text-success-fg" },
  contenu: { icon: "text-brand-violet", iconBg: "bg-brand-violet/12", tag: "text-brand-violet" },
};

// Carte catalogue — port de offerCard() (référence vanille, club-services-documents-rapports.js),
// redessinée le 19/08/2026 (identité par catégorie, prix TTC mis en avant, distinction visuelle
// claire pour les offres "sur devis").
export function ClubOfferCard({
  offer,
  plan,
  onReserve,
}: {
  offer: ClubCatalogueOffre;
  plan: ClubPlan;
  onReserve: () => void;
}) {
  const locked = isOfferLocked(offer, plan);
  const advantage = offerAdvantageLabel(offer, plan);
  const surDevis = offer.tarifType === "sur_devis";
  const Icon = CATEGORIE_ICON[offer.categorie];
  const style = CATEGORIE_STYLE[offer.categorie];

  return (
    <Card
      className={cn(
        "group flex flex-col gap-4 p-5 transition-[transform,box-shadow] duration-sv hover:-translate-y-0.5 hover:shadow-sv-card-hover",
        locked && "opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex h-10 w-10 flex-none items-center justify-center rounded-xl", style.iconBg)}>
          <Icon className={cn("h-5 w-5", style.icon)} aria-hidden />
        </span>
        <span className={cn("mt-1 text-[10.5px] font-extrabold uppercase tracking-[.06em]", style.tag)}>
          {OFFER_CATEGORIE_LABEL[offer.categorie]}
        </span>
      </div>

      <div className="flex-1">
        <div className="flex items-center gap-1.5 text-[15px] font-extrabold leading-snug tracking-tight text-text">
          {offer.nom}
          {locked && <Lock className="h-3.5 w-3.5 flex-none text-text-faint" aria-hidden />}
        </div>
        {offer.description && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-soft">{offer.description}</p>
        )}
        {offer.dureeEstimee && (
          <div className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-text-faint">
            <Clock className="h-3 w-3" aria-hidden />
            Délai : {offer.dureeEstimee}
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-border pt-4">
        <div>
          <div className={cn("text-[17px] font-extrabold tracking-tight", surDevis ? "text-text-soft" : "text-text")}>
            {offerPriceLabel(offer)}
          </div>
          {advantage && <div className="text-[10.5px] font-bold text-brand-blue-electric">{advantage}</div>}
        </div>
        <Button variant={surDevis ? "secondary" : "primary"} className="h-9 px-3.5 text-[12.5px]" onClick={onReserve}>
          Réserver
        </Button>
      </div>
    </Card>
  );
}
