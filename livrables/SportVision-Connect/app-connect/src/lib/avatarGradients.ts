// 5 dégradés d'avatars/monogrammes — design-connect-personnel-12-08/README.md
// § Direction artistique > Couleurs. Angle 140° partout.
const AVATAR_GRADIENTS = [
  "linear-gradient(140deg,#A855F7,#4F7DFF)",
  "linear-gradient(140deg,#4F7DFF,#22D3EE)",
  "linear-gradient(140deg,#22D3EE,#A855F7)",
  "linear-gradient(140deg,#F472B6,#A855F7)",
  "linear-gradient(140deg,#8CA9FF,#22D3EE)",
];

// Choix déterministe à partir d'un identifiant (id de groupe/utilisateur) —
// la même entité garde toujours le même dégradé d'une page à l'autre.
export function gradientFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length] ?? "linear-gradient(140deg,#A855F7,#4F7DFF)";
}
