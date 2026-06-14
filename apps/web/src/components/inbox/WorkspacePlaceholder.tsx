"use client";

export function WorkspacePlaceholder({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="workspace-placeholder">
      <p className="workspace-placeholder-title">{title}</p>
      {hint && <p className="workspace-placeholder-hint">{hint}</p>}
    </div>
  );
}
