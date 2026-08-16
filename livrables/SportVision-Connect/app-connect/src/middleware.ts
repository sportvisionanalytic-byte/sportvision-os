import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // manifest.json (public/) et opengraph-image (route générée, next/og) doivent rester
  // accessibles sans session : un crawler WhatsApp/iMessage/Slack qui déplie un lien partagé
  // (ex. ShareFundingButtons.tsx) n'est jamais authentifié — sans cette exclusion, ces deux
  // requêtes étaient silencieusement redirigées vers /auth/login (307) au lieu de servir le
  // contenu attendu, cassant la prévisualisation de tout lien Connect partagé (trouvé le 16/08
  // en testant l'image OG ajoutée dans le même chantier).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
