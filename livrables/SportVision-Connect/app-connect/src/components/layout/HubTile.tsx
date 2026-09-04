import Link from "next/link";

// Connect V3 (04/09/2026) — simplification de la navigation mobile à 5 entrées maximum
// (Accueil/Médias/Mon univers/Services/Profil). Les 3 nouveaux piliers (Médias/Mon univers/
// Services) regroupent des écrans qui existaient déjà chacun en onglet séparé (Mes contenus,
// Pass Photo, Prestations, Paiement collectif, Mes commandes, Factures & paiements, Mon
// affiliation, Mes équipes, Calendrier, Messages) — cette page ne fait que les relier, aucune
// logique existante n'est réécrite ni dupliquée. Composant partagé par les 6 pages piliers
// (Espace joueur × 3, Espace particulier × 3) pour ne pas répéter 6 fois la même grille de cartes.

export interface HubTileItem {
  href: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

export function HubGrid({ title, tiles }: { title: string; tiles: HubTileItem[] }) {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-sora text-[26px] font-bold tracking-tight">{title}</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="flex items-center gap-3.5 rounded-sv-card border border-border bg-surface p-4 transition-colors hover:bg-surface-hover"
          >
            <span
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full"
              style={{ backgroundColor: `${tile.color}1f` }}
            >
              <span className="material-symbols-rounded !text-[22px]" style={{ color: tile.color }} aria-hidden="true">
                {tile.icon}
              </span>
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-sora text-[14.5px] font-semibold text-text">{tile.label}</span>
              <span className="text-[12.5px] text-text-tertiary">{tile.description}</span>
            </span>
            <span className="material-symbols-rounded ml-auto !text-[18px] text-text-faint" aria-hidden="true">
              chevron_right
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
