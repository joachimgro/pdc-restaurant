const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconStats() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M4 19V5" />
      <path {...stroke} d="M4 19h16" />
      <path {...stroke} d="M8 16v-5" />
      <path {...stroke} d="M12 16V8" />
      <path {...stroke} d="M16 16v-3" />
      <path {...stroke} d="M20 16V6" />
    </svg>
  );
}
