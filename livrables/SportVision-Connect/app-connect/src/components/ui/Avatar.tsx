// Avatar réutilisable — photo (connect_profile_settings.avatar_url, migration-connect-v55) si
// présente, sinon repli sur le monogramme dégradé déjà utilisé partout dans l'app (AppShell,
// ParticularShell, Topbar). Un seul point de vérité pour ce repli, plutôt que de dupliquer la
// logique "url ? <img> : <span monogramme>" dans chaque composant.
export function Avatar({
  url,
  label,
  size = 40,
  className = "",
}: {
  url?: string | null;
  label: string;
  size?: number;
  className?: string;
}) {
  const monogram = (label[0] || "?").toUpperCase();

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- taille dynamique par prop, image
      // hébergée sur un bucket Storage public (portail-media), pas un asset local optimisable.
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className={`flex-none rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`flex flex-none items-center justify-center rounded-full bg-sv-gradient font-sora font-semibold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.34)) }}
    >
      {monogram}
    </span>
  );
}
