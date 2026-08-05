"use client";

import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import type { CanvasViewport } from "./useCanvasViewport";
import type { RoomMeta } from "../types";

/**
 * The SVG surface itself: viewBox at the room's canvas dimensions, scaled to
 * fit and never stretched, with a transformed group both modes draw into.
 *
 * It owns no gesture meaning. Multi-touch is handled by the viewport, which
 * gets first refusal on every pointer event; anything it does not consume is
 * passed to the mode's own handlers. That ordering is the whole reason layout
 * and service can share one canvas without either growing mode branches.
 */
export function FloorCanvasShell({
  room,
  view,
  showGrid = false,
  ariaLabel,
  className,
  gestures,
  children,
}: {
  room: RoomMeta;
  view: CanvasViewport;
  showGrid?: boolean;
  ariaLabel: string;
  className?: string;
  gestures: {
    onPointerDown?: (e: ReactPointerEvent<SVGElement>) => void;
    onPointerMove?: (e: ReactPointerEvent<SVGElement>) => void;
    onPointerUp?: (e: ReactPointerEvent<SVGElement>) => void;
    onPointerCancel?: (e: ReactPointerEvent<SVGElement>) => void;
  };
  children: ReactNode;
}) {
  return (
    <svg
      ref={view.svgRef}
      className={`fp-canvas${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${room.canvasWidth} ${room.canvasHeight}`}
      preserveAspectRatio="xMidYMid meet"
      role="application"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        if (view.onPointerDown(e)) return;
        gestures.onPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        if (view.onPointerMove(e)) return;
        gestures.onPointerMove?.(e);
      }}
      onPointerUp={(e) => {
        if (view.onPointerUp(e)) return;
        gestures.onPointerUp?.(e);
      }}
      onPointerCancel={(e) => {
        view.onPointerCancel(e);
        gestures.onPointerCancel?.(e);
      }}
    >
      {showGrid && (
        <defs>
          <pattern
            id={`fp-grid-${room.id}`}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 10 0 L 0 0 0 10"
              fill="none"
              stroke="var(--floor-grid)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
      )}

      <g
        ref={view.contentRef}
        transform={`translate(${view.viewport.panX} ${view.viewport.panY}) scale(${view.viewport.zoom})`}
      >
        <rect
          className="fp-room-bg"
          x="0"
          y="0"
          width={room.canvasWidth}
          height={room.canvasHeight}
        />
        {showGrid && (
          <rect
            x="0"
            y="0"
            width={room.canvasWidth}
            height={room.canvasHeight}
            fill={`url(#fp-grid-${room.id})`}
          />
        )}
        {children}
      </g>
    </svg>
  );
}
