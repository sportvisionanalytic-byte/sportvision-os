import { PageSkeleton } from "@/components/ui/Skeleton";

// Squelette instantané pendant que ParticulierHomePage résout ses requêtes Supabase (voir
// rapport fluidité perçue 15/08). Point d'entrée après connexion pour un compte particulier,
// même priorité que /dashboard côté joueur.
export default function Loading() {
  return <PageSkeleton cards={4} />;
}
