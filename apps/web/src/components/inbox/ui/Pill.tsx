import type { ReactNode } from "react";

export function Pill({
  children,
  color,
}: {
  children: ReactNode;
  color?: "green" | "amber" | "red" | "blue";
}) {
  return (
    <span className={`pill ${color ?? ""}`}>
      <span className="pill-dot" />
      {children}
    </span>
  );
}
