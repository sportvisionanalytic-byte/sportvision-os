import { CalendarClock, Flame, Heart, PartyPopper, Sparkles, Trophy, Users, type LucideIcon } from "lucide-react";
import type { StudioCategory } from "@/lib/types/studio";

// Identité visuelle par catégorie de modèle Studio (19/08/2026, retour utilisateur : la grille
// striée "aperçu · nom" identique sur les 47 modèles ne donnait pas envie / prêtait à confusion).
// Pas de vrai visuel généré à afficher (aucun outil de génération d'image disponible ici) : icône
// + dégradé propres à chaque catégorie plutôt qu'un unique motif générique répété — même principe
// que CATEGORIE_STYLE (ClubOfferCard.tsx) pour le catalogue de prestations. Fichier partagé entre
// studio/page.tsx (grille) et studio/[template]/page.tsx (fiche modèle) pour ne jamais diverger.
export const CATEGORY_ICON: Record<StudioCategory, LucideIcon> = {
  pre_match: CalendarClock,
  match_day: Flame,
  post_match: Trophy,
  players: Users,
  club_life: Heart,
  sponsors: Sparkles,
  events: PartyPopper,
};

export const CATEGORY_GRADIENT: Record<StudioCategory, string> = {
  pre_match: "from-[#1E3A8A] to-[#2563EB]",
  match_day: "from-[#B91C1C] to-[#EA580C]",
  post_match: "from-[#92400E] to-[#D97706]",
  players: "from-[#4338CA] to-[#7C3AED]",
  club_life: "from-[#BE185D] to-[#DB2777]",
  sponsors: "from-[#0F766E] to-[#0891B2]",
  events: "from-[#6D28D9] to-[#C026D3]",
};
