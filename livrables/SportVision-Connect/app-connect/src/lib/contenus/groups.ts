// Regroupement des contenus club_media par équipe — extrait de ContentGallery.tsx (module Mes
// contenus, migration-connect-v43-espace-joueur.sql pour la source) pour être réutilisable côté
// serveur (dashboard/page.tsx, carte "Nouveaux contenus") SANS dupliquer la logique de groupement
// ni les couleurs de couverture : un seul point de vérité, comme le reste du catalogue/format.
// Pur JS (aucune API navigateur) : safe à importer aussi bien depuis un composant serveur que
// client.

export interface ContentMediaRow {
  id: string;
  title: string;
  type: string;
  team: string | null;
  createdAt: string;
}

export interface ContentGroup<T extends ContentMediaRow = ContentMediaRow> {
  key: string;
  title: string;
  items: T[];
  photoCount: number;
  videoCount: number;
  hasNew: boolean;
  lastDate: string;
}

const COVER_GRADIENTS = [
  "linear-gradient(135deg,#3B1E6E,#22307A 55%,#0F4C63)",
  "linear-gradient(135deg,#4C1D95,#3A2A86 50%,#155E75)",
  "linear-gradient(135deg,#5B1E5B,#3F2280 55%,#1E3A8A)",
];

export function coverFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_GRADIENTS[hash % COVER_GRADIENTS.length] ?? COVER_GRADIENTS[0]!;
}

export function isNewContent(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < 7 * 24 * 60 * 60 * 1000;
}

export function groupContentsByTeam<T extends ContentMediaRow>(items: T[]): ContentGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = item.team?.trim() || "Général";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  const groups: ContentGroup<T>[] = Array.from(map.entries()).map(([key, groupItems]) => {
    const sorted = [...groupItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      key,
      title: key,
      items: sorted,
      photoCount: sorted.filter((i) => i.type === "photo").length,
      videoCount: sorted.filter((i) => i.type === "video").length,
      hasNew: sorted.some((i) => isNewContent(i.createdAt)),
      lastDate: sorted[0]?.createdAt ?? "",
    };
  });
  return groups.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}
