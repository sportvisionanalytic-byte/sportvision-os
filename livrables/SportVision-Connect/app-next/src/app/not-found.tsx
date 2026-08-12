import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Page 404 globale — Next.js l'affiche pour toute route qui ne correspond à aucun segment
// (ex. URL directe vers une ressource interdite/inexistante). Voir MASTER-CONNECT-V1.md §54 :
// message humain, aucune trace technique exposée.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center text-text">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-sunken text-text-faint">
        <SearchX className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-bold uppercase tracking-wide text-text-faint">Erreur 404</p>
        <h1 className="text-[22px] font-extrabold tracking-tight">Cette page n&apos;existe pas</h1>
        <p className="max-w-[420px] text-[14px] leading-relaxed text-text-soft">
          La page que vous cherchez n&apos;est pas disponible, ou vous n&apos;avez pas accès à cette
          ressource. Vérifiez le lien ou retournez à votre espace SportVision Connect.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/dashboard">
          <Button variant="primary">Retour à mon espace</Button>
        </Link>
        <Link href="/support">
          <Button variant="secondary">Contacter SportVision</Button>
        </Link>
      </div>
    </div>
  );
}
