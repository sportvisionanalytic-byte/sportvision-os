// Avatar réutilisable — photo (connect_profile_settings.avatar_url, migration-connect-v55) si
// présente, sinon repli sur le monogramme dégradé déjà utilisé partout dans l'app (AppShell,
// ParticularShell, Topbar). Un seul point de vérité pour ce repli, plutôt que de dupliquer la
// logique "url ? <img> : <span monogramme>" dans chaque composant.
//
// `ring` : anneau dégradé autour de l'avatar, vu dans la maquette (Connect Espace Joueur.dc.html
// ligne 122) UNIQUEMENT sur le déclencheur du menu profil de la topbar desktop — technique
// padding 2px + fond intérieur plus sombre (bg-elevated) qui fait "lire" le dégradé comme une
// bordure. Les autres avatars de la maquette (sidebar, header mobile, page profil, messages)
// sont des cercles pleins sans anneau — ne pas généraliser.
export function Avatar({
  url,
  label,
  size = 40,
  className = "",
  ring = false,
}: {
  url?: string | null;
  label: string;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const monogram = (label[0] || "?").toUpperCase();
  const innerSize = ring ? size - 4 : size;

  const inner = url ? (
    // eslint-disable-next-line @next/next/no-img-element -- taille dynamique par prop, image
    // hébergée sur un bucket Storage public (portail-media), pas un asset local optimisable.
    <img
      src={url}
      alt=""
      width={innerSize}
      height={innerSize}
      className={`flex-none rounded-full object-cover ${ring ? "" : className}`}
      style={{ width: innerSize, height: innerSize }}
    />
  ) : (
    <span
      className={`flex items-center justify-center rounded-full font-sora font-semibold text-white ${
        ring ? "h-full w-full bg-bg-elevated" : `flex-none bg-sv-gradient ${className}`
      }`}
      style={{
        width: ring ? undefined : size,
        height: ring ? undefined : size,
        fontSize: Math.max(11, Math.round(size * 0.34)),
      }}
    >
      {monogram}
    </span>
  );

  if (!ring) return inner;

  return (
    <span
      className={`flex flex-none items-center justify-center rounded-full bg-sv-gradient p-0.5 box-border ${className}`}
      style={{ width: size, height: size }}
    >
      {inner}
    </span>
  );
}
