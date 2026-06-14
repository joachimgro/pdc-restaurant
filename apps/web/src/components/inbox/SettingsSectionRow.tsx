"use client";

export function SettingsSectionRow({
  title,
  meta,
  abbrev,
  active,
  nested,
  onSelect,
}: {
  title: string;
  meta: string;
  abbrev: string;
  active?: boolean;
  /** Indented sub-item (e.g. a location under Locations) */
  nested?: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`lead-row settings-section-row${active ? " active" : ""}${nested ? " settings-section-row--nested" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <div className="settings-section-icon" aria-hidden>
        {abbrev}
      </div>
      <div className="lead-row-main">
        <div className="lead-row-top">
          <div className="lead-name">{title}</div>
        </div>
        <div className="lead-row-bottom">
          <div className="lead-preview">{meta}</div>
        </div>
      </div>
    </div>
  );
}
