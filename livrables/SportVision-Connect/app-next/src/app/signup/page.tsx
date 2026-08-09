import { redirect } from "next/navigation";

// /signup (racine, sans sous-étape) 404ait : seules les 7 routes de STEPS (signup-context.tsx)
// existaient. Renvoie vers la première étape réelle du tunnel.
export default function SignupRootPage() {
  redirect("/signup/type");
}
