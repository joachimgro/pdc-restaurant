const AVATAR_COLORS = [
  "#FF6B6B",
  "#5B8DEF",
  "#9B7EDE",
  "#2DB6A3",
  "#E8915B",
  "#D9648B",
  "#4CAF8F",
  "#6C8AE4",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  size = 40,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const color = AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
  return (
    <div
      className={`avatar ${className}`.trim()}
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.round(size * 0.38),
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}
