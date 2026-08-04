/** Nav rail + toolbar icons. Stroke-based to match the existing rail set. */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconService() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M3 20h18" />
      <path {...stroke} d="M5 20v-7.5A6.5 6.5 0 0 1 11.5 6h1A6.5 6.5 0 0 1 19 12.5V20" />
      <path {...stroke} d="M12 6V3.5" />
    </svg>
  );
}

export function IconUndo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M4 9h11a5 5 0 0 1 0 10h-3" />
      <path {...stroke} d="M8 5 4 9l4 4" />
    </svg>
  );
}

export function IconRedo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M20 9H9a5 5 0 0 0 0 10h3" />
      <path {...stroke} d="m16 5 4 4-4 4" />
    </svg>
  );
}

export function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

export function IconDuplicate() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect {...stroke} x="9" y="9" width="11" height="11" rx="2" />
      <path {...stroke} d="M15 5H6a2 2 0 0 0-2 2v9" />
    </svg>
  );
}

export function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconRotate() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path {...stroke} d="M20 4v4h-4" />
    </svg>
  );
}

export function IconLink() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M10 13a4 4 0 0 0 5.7.4l2.6-2.6a4 4 0 0 0-5.7-5.7L11 6.7" />
      <path {...stroke} d="M14 11a4 4 0 0 0-5.7-.4L5.7 13.2a4 4 0 0 0 5.7 5.7l1.6-1.6" />
    </svg>
  );
}

export function IconWarning() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M12 4 2.5 20h19L12 4Z" />
      <path {...stroke} d="M12 10v4.5M12 17.5v.01" />
    </svg>
  );
}

export function IconZoomIn() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle {...stroke} cx="11" cy="11" r="6.5" />
      <path {...stroke} d="M16 16l4 4M11 8.5v5M8.5 11h5" />
    </svg>
  );
}

export function IconZoomOut() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle {...stroke} cx="11" cy="11" r="6.5" />
      <path {...stroke} d="M16 16l4 4M8.5 11h5" />
    </svg>
  );
}

export function IconFit() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

/** Align icons — a bar plus three blocks pushed against it. */
export function IconAlign({ mode }: { mode: string }) {
  const vertical = mode === "left" || mode === "right" || mode === "centre-x";
  const transform = {
    left: "",
    right: "rotate(180 12 12)",
    top: "rotate(90 12 12)",
    bottom: "rotate(270 12 12)",
    "centre-x": "",
    "centre-y": "rotate(90 12 12)",
  }[mode];
  const centred = mode === "centre-x" || mode === "centre-y";

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={transform}>
        <path {...stroke} d={centred ? "M12 3v18" : "M4 3v18"} />
        <rect
          {...stroke}
          x={centred ? 6 : 6}
          y="6"
          width={centred ? 12 : 13}
          height="4"
          rx="1"
        />
        <rect
          {...stroke}
          x={centred ? 8.5 : 6}
          y="14"
          width={centred ? 7 : 8}
          height="4"
          rx="1"
        />
      </g>
      {vertical ? null : null}
    </svg>
  );
}

export function IconDistribute({ axis }: { axis: "x" | "y" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={axis === "y" ? "rotate(90 12 12)" : ""}>
        <path {...stroke} d="M3 4v16M21 4v16" />
        <rect {...stroke} x="10" y="8" width="4" height="8" rx="1" />
      </g>
    </svg>
  );
}
