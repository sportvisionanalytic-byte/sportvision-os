import { PageSkeleton } from "@/components/ui/Skeleton";

// Squelette instantané pendant que DashboardPage résout ses requêtes Supabase (voir rapport
// fluidité perçue 15/08). Sans ce fichier, Next.js laisse l'écran figé jusqu'à la fin du Server
// Component — /dashboard est le point d'entrée après chaque connexion, donc la route la plus
// visible sans état de chargement.
export default function Loading() {
  return <PageSkeleton cards={4} />;
}
