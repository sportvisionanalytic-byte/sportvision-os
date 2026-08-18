import { DemoShell } from "@/components/layout/DemoShell";
import { DEMO_FIRST_NAME } from "@/lib/demo/mock-data";

// Layout /demo — voir DemoShell.tsx et lib/demo/mock-data.ts pour le contexte complet.
// Temporaire (demandé par Fouka le 19/08).
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell firstName={DEMO_FIRST_NAME}>{children}</DemoShell>;
}
