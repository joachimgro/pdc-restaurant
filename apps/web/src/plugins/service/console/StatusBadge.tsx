import type { TableStatus } from "./status";

/**
 * A distinct shape per state (spec §7).
 *
 * Service mode is the one place in the product where colour carries meaning,
 * so every state that has a fill also has a silhouette: a clock outline for
 * booked, a filled clock for arriving, a figure for seated, a ringed figure
 * for over time, an exclamation for overdue, a slash for blocked. Someone who
 * cannot separate amber from green can still read the floor.
 */
export function StatusBadge({
  status,
  x,
  y,
  size,
}: {
  status: TableStatus;
  x: number;
  y: number;
  size: number;
}) {
  if (status === "free") return null;

  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: size * 0.18,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <g className={`sc-badge sc-badge-${status}`} transform={`translate(${x} ${y})`}>
      <circle
        className="sc-badge-disc"
        cx={0}
        cy={0}
        r={size}
        strokeWidth={size * 0.14}
      />
      {status === "upcoming" && (
        <>
          <circle {...stroke} cx={0} cy={0} r={size * 0.52} />
          <path {...stroke} d={`M 0 ${-size * 0.3} L 0 0 L ${size * 0.28} 0`} />
        </>
      )}
      {status === "due" && (
        <>
          <circle
            cx={0}
            cy={0}
            r={size * 0.52}
            fill="currentColor"
            stroke="none"
          />
          <path
            fill="none"
            stroke="var(--panel)"
            strokeWidth={size * 0.18}
            strokeLinecap="round"
            d={`M 0 ${-size * 0.3} L 0 0 L ${size * 0.28} 0`}
          />
        </>
      )}
      {(status === "seated" || status === "over") && (
        <>
          <circle
            cx={0}
            cy={-size * 0.28}
            r={size * 0.24}
            fill="currentColor"
            stroke="none"
          />
          <path
            d={`M ${-size * 0.4} ${size * 0.42}
                a ${size * 0.4} ${size * 0.4} 0 0 1 ${size * 0.8} 0 Z`}
            fill="currentColor"
            stroke="none"
          />
          {status === "over" && (
            <circle {...stroke} cx={0} cy={0} r={size * 0.78} />
          )}
        </>
      )}
      {status === "late" && (
        <>
          <path {...stroke} d={`M 0 ${-size * 0.45} L 0 ${size * 0.12}`} />
          <circle
            cx={0}
            cy={size * 0.42}
            r={size * 0.12}
            fill="currentColor"
            stroke="none"
          />
        </>
      )}
      {status === "blocked" && (
        <path
          {...stroke}
          d={`M ${-size * 0.42} ${size * 0.42} L ${size * 0.42} ${-size * 0.42}`}
        />
      )}
    </g>
  );
}
