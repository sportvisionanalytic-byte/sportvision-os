// Coque des écrans d'accès (connexion, inscription, mot de passe oublié...) — pas de barre
// latérale ni de barre supérieure. Chaque page gère sa propre mise en page en deux panneaux.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-bg text-text">{children}</div>;
}
