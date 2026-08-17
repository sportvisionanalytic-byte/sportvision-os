import { redirect } from "next/navigation";

// /signup (racine, sans sous-étape) 404ait : seules les routes de REQUEST_STEPS
// (signup-context.tsx) existent. Renvoie vers la première étape réelle du tunnel unifié — voir
// SIGNUP-UNIFIE-MASTER-PROMPT.md.
export default function SignupRootPage() {
  redirect("/signup/request");
}
