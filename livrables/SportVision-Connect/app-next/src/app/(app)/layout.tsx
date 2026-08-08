import { SessionProvider } from "@/lib/session-context";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

// Coque de l'application authentifiée — barre latérale sticky 264 px + barre supérieure 66 px
// + zone centrale. Voir README.md § Architecture d'interface. Toutes les routes applicatives
// (dashboard, services, content, ...) vivent sous ce groupe de routes sans préfixe d'URL.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex min-h-screen bg-bg text-text">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="min-w-0 flex-1 px-7 py-6">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
