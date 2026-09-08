import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // pdf.worker.min.mjs est exclu : c'est un fichier statique de 1,2 Mo servi à chaque import de
  // calendrier PDF. Le faire passer par la vérification de session ajoutait un aller-retour inutile
  // et faisait dépendre le chargement du worker de la transmission du cookie à une requête de worker.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pdf\\.worker\\.min\\.mjs|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
