"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DEFAULT_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
  clamp,
  clientToCanvas,
  distance,
  midpoint,
} from "../geometry";
import { useFloorEditor } from "../store/floor-editor-store";
import type { RoomMeta } from "../types";

/**
 * Everything about *looking at* the floor plan, shared by layout mode and
 * service mode: scale measurement, zoom, pan, pinch, and pointer capture.
 *
 * It knows nothing about what a gesture means. Both modes need identical
 * multi-touch behaviour — and that behaviour was the expensive part to get
 * right on an iPad — so it lives here once rather than being reimplemented,
 * or worse, branched on a mode flag.
 *
 * The single-pointer protocol is "did the view layer consume this?": each
 * handler returns true when the event was a pinch and the caller should do
 * nothing further with it.
 */

export type Point = { x: number; y: number };

type PinchState = {
  startDistance: number;
  startZoom: number;
  startMidViewBox: Point;
  startPan: Point;
} | null;

export type CanvasViewport = {
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  contentRef: React.MutableRefObject<SVGGElement | null>;
  viewport: { zoom: number; panX: number; panY: number };
  /** Canvas units per CSS pixel — keeps touch targets 44px at any zoom. */
  unitsPerPx: number;
  toCanvas: (clientX: number, clientY: number) => Point | null;
  toViewBox: (clientX: number, clientY: number) => Point | null;
  setZoom: (zoom: number, anchorClient?: Point) => void;
  resetView: () => void;
  pointerCount: () => number;
  /** Track a pointer that started on a child control (a resize handle). */
  trackPointer: (e: ReactPointerEvent<SVGElement>) => number;
  capturePointer: (pointerId: number) => void;
  releasePointer: (pointerId: number) => void;
  onPointerDown: (e: ReactPointerEvent<SVGElement>) => boolean;
  onPointerMove: (e: ReactPointerEvent<SVGElement>) => boolean;
  onPointerUp: (e: ReactPointerEvent<SVGElement>) => boolean;
  onPointerCancel: (e: ReactPointerEvent<SVGElement>) => void;
};

export function useCanvasViewport({
  room,
  onMultiTouchStart,
}: {
  room: RoomMeta;
  /**
   * Fires when a second finger lands. The rule is the same in both modes —
   * a pinch is not a drag, so whatever single-pointer gesture was in flight
   * must be abandoned without a trace — but only the mode knows what it was
   * doing.
   */
  onMultiTouchStart: () => void;
}): CanvasViewport {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const contentRef = useRef<SVGGElement | null>(null);
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const pinchRef = useRef<PinchState>(null);

  const [pxPerUnit, setPxPerUnit] = useState(1);

  // Must return a stable reference — a fresh fallback object every call
  // trips useSyncExternalStore into an infinite loop (Zustand v5).
  const viewport = useFloorEditor(
    (s) => s.viewports[room.id] ?? DEFAULT_VIEWPORT
  );
  const setViewport = useFloorEditor((s) => s.setViewport);

  // Track the rendered scale so touch targets and hairlines stay constant in
  // CSS pixels regardless of zoom or how the viewBox is fitted.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const fit = Math.min(
        rect.width / room.canvasWidth,
        rect.height / room.canvasHeight
      );
      setPxPerUnit(fit * viewport.zoom);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [room.canvasWidth, room.canvasHeight, viewport.zoom]);

  /**
   * Route every subsequent event for this pointer to the canvas.
   *
   * Without it a drag that crosses the edge of the plan stops receiving moves
   * and its pointerup lands on some other element, so the interaction never
   * commits and the transient edit is stranded. Dragging a table against a
   * wall is exactly how a room gets built, so this is the common path.
   */
  const capturePointer = useCallback((pointerId: number) => {
    try {
      svgRef.current?.setPointerCapture(pointerId);
    } catch {
      // Pointer already gone; nothing to capture.
    }
  }, []);

  const releasePointer = useCallback((pointerId: number) => {
    try {
      if (svgRef.current?.hasPointerCapture(pointerId)) {
        svgRef.current.releasePointerCapture(pointerId);
      }
    } catch {
      // Already released.
    }
  }, []);

  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const el = contentRef.current;
    return el ? clientToCanvas(el, clientX, clientY) : null;
  }, []);

  const toViewBox = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    return el ? clientToCanvas(el, clientX, clientY) : null;
  }, []);

  const setZoom = useCallback(
    (nextZoom: number, anchorClient?: Point) => {
      const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      if (!anchorClient) {
        setViewport(room.id, { ...viewport, zoom });
        return;
      }
      const anchor = toViewBox(anchorClient.x, anchorClient.y);
      if (!anchor) return;
      // Keep the canvas point under the anchor fixed on screen.
      const canvasX = (anchor.x - viewport.panX) / viewport.zoom;
      const canvasY = (anchor.y - viewport.panY) / viewport.zoom;
      setViewport(room.id, {
        zoom,
        panX: anchor.x - zoom * canvasX,
        panY: anchor.y - zoom * canvasY,
      });
    },
    [room.id, setViewport, toViewBox, viewport]
  );

  const resetView = useCallback(() => {
    setViewport(room.id, { zoom: 1, panX: 0, panY: 0 });
  }, [room.id, setViewport]);

  const pointerCount = useCallback(() => pointersRef.current.size, []);

  const trackPointer = useCallback((e: ReactPointerEvent<SVGElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    return pointersRef.current.size;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGElement>) => {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capturePointer(e.pointerId);

      // Second finger down: this is a pinch, so anything single-pointer that
      // had started is abandoned rather than continued.
      if (pointersRef.current.size === 2) {
        onMultiTouchStart();
        const [a, b] = [...pointersRef.current.values()];
        const midViewBoxPoint = midpoint(a, b);
        const midViewBox = toViewBox(midViewBoxPoint.x, midViewBoxPoint.y);
        if (midViewBox) {
          pinchRef.current = {
            startDistance: Math.max(distance(a, b), 1),
            startZoom: viewport.zoom,
            startMidViewBox: midViewBox,
            startPan: { x: viewport.panX, y: viewport.panY },
          };
        }
        return true;
      }

      // A third finger is neither a pinch nor a drag; ignore it entirely.
      if (pointersRef.current.size > 2) return true;

      return false;
    },
    [capturePointer, onMultiTouchStart, toViewBox, viewport]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGElement>) => {
      if (!pointersRef.current.has(e.pointerId)) return true;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const pinch = pinchRef.current;
      if (!pinch) return false;
      if (pointersRef.current.size < 2) return true;

      const [a, b] = [...pointersRef.current.values()];
      const nextDistance = Math.max(distance(a, b), 1);
      const mid = midpoint(a, b);
      const midViewBox = toViewBox(mid.x, mid.y);
      if (!midViewBox) return true;

      const zoom = clamp(
        (pinch.startZoom * nextDistance) / pinch.startDistance,
        MIN_ZOOM,
        MAX_ZOOM
      );
      // Two-finger pan falls out of tracking the midpoint: the canvas point
      // that started under the fingers stays under them.
      const canvasX =
        (pinch.startMidViewBox.x - pinch.startPan.x) / pinch.startZoom;
      const canvasY =
        (pinch.startMidViewBox.y - pinch.startPan.y) / pinch.startZoom;
      setViewport(room.id, {
        zoom,
        panX: midViewBox.x - zoom * canvasX,
        panY: midViewBox.y - zoom * canvasY,
      });
      return true;
    },
    [room.id, setViewport, toViewBox]
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<SVGElement>) => {
      const wasPinching = pinchRef.current !== null;
      pointersRef.current.delete(e.pointerId);
      releasePointer(e.pointerId);

      if (wasPinching) {
        // Lifting one finger ends the pinch outright. It does not fall back
        // into a drag — that is the bug where a table jumps when a finger
        // leaves. A new drag needs a fresh press.
        if (pointersRef.current.size < 2) pinchRef.current = null;
        return true;
      }
      return false;
    },
    [releasePointer]
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<SVGElement>) => {
      pointersRef.current.delete(e.pointerId);
      releasePointer(e.pointerId);
      pinchRef.current = null;
    },
    [releasePointer]
  );

  // Wheel zoom on desktop. Non-passive so the page does not scroll instead.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && Math.abs(event.deltaY) < 2) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY / 400);
      setZoom(viewport.zoom * factor, { x: event.clientX, y: event.clientY });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [setZoom, viewport.zoom]);

  return {
    svgRef,
    contentRef,
    viewport,
    unitsPerPx: 1 / Math.max(pxPerUnit, 0.0001),
    toCanvas,
    toViewBox,
    setZoom,
    resetView,
    pointerCount,
    trackPointer,
    capturePointer,
    releasePointer,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
