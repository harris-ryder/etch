"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export type View = "drawing" | "thinking";

/** Sizes in em, so the control scales with the text. */
const UP = 3.59;
const DOWN = 2.84;
/** Radius of the two outer top corners, and the most the curves of the middle step may have. */
const CORNER = 0.62;
const SEAM = 0.42;
/** Outline thickness in px. */
const STROKE = 1.5;

/**
 * Drawing / Thinking, as two joined push-buttons standing on the bottom edge
 * of the window. Press one and it goes down while the other pops up; the one
 * that is down is the view you are in.
 *
 * The two buttons share ONE outline, drawn as a single SVG path: up the left
 * side, across the left top, through an S-shaped step in the middle, across
 * the right top and down. The step's two curves are sized from the height
 * difference at every frame, so as the buttons pass each other mid-movement
 * the step flattens to nothing and then grows back the other way round,
 * instead of ever showing a kink. That is why this is drawn and animated in
 * code rather than with borders.
 */
export function ViewSwitch({ view, onChange }: { view: View; onChange: (next: View) => void }) {
  const root = useRef<HTMLDivElement | null>(null);
  const left = useRef<HTMLButtonElement | null>(null);
  const right = useRef<HTMLButtonElement | null>(null);
  const fill = useRef<SVGPathElement | null>(null);
  const line = useRef<SVGPathElement | null>(null);
  /** `p` runs from 0 (Drawing pressed) to 1 (Thinking pressed); `v` is its speed. */
  const motion = useRef({ p: view === "thinking" ? 1 : 0, v: 0, frame: 0 });

  const paint = useCallback(() => {
    const el = root.current;
    if (!el || !left.current || !right.current || !fill.current || !line.current) return;
    const em = parseFloat(getComputedStyle(el).fontSize);
    const width = el.clientWidth;
    const height = el.clientHeight;
    const { p } = motion.current;
    const leftHeight = (DOWN + (UP - DOWN) * p) * em;
    const rightHeight = (UP - (UP - DOWN) * p) * em;
    left.current.style.height = `${leftHeight}px`;
    right.current.style.height = `${rightHeight}px`;

    const half = STROKE / 2;
    const x0 = half;
    const x1 = width - half;
    const mid = width / 2;
    const yLeft = height - leftHeight + half;
    const yRight = height - rightHeight + half;
    const corner = CORNER * em;
    // Each curve of the step can be at most half the drop, so the two always meet cleanly.
    const r = Math.min(SEAM * em, Math.abs(yLeft - yRight) / 2);
    const leftIsTaller = yLeft < yRight;
    const step = leftIsTaller
      ? `A ${r} ${r} 0 0 1 ${mid} ${yLeft + r} L ${mid} ${yRight - r} A ${r} ${r} 0 0 0 ${mid + r} ${yRight}`
      : `A ${r} ${r} 0 0 0 ${mid} ${yLeft - r} L ${mid} ${yRight + r} A ${r} ${r} 0 0 1 ${mid + r} ${yRight}`;
    const d = [
      `M ${x0} ${height}`,
      `L ${x0} ${yLeft + corner}`,
      `A ${corner} ${corner} 0 0 1 ${x0 + corner} ${yLeft}`,
      `L ${mid - r} ${yLeft}`,
      step,
      `L ${x1 - corner} ${yRight}`,
      `A ${corner} ${corner} 0 0 1 ${x1} ${yRight + corner}`,
      `L ${x1} ${height}`,
    ].join(" ");
    line.current.setAttribute("d", d);
    fill.current.setAttribute("d", `${d} Z`);
  }, []);

  // Draw before the first paint, and again whenever the control changes size (a font arriving, a zoom).
  useLayoutEffect(() => {
    paint();
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(paint);
    observer.observe(el);
    return () => observer.disconnect();
  }, [paint]);

  // A light spring carries the buttons to their new heights, with a small bounce on landing.
  useEffect(() => {
    const state = motion.current;
    const target = view === "thinking" ? 1 : 0;
    cancelAnimationFrame(state.frame);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      state.p = target;
      state.v = 0;
      paint();
      return;
    }
    let last = performance.now();
    const tick = (now: number): void => {
      // Small fixed steps keep the spring stable if a frame arrives late.
      let dt = Math.min(0.064, (now - last) / 1000);
      last = now;
      while (dt > 0) {
        const h = Math.min(dt, 0.004);
        state.v += (320 * (target - state.p) - 22 * state.v) * h;
        state.p += state.v * h;
        dt -= h;
      }
      if (Math.abs(target - state.p) < 0.001 && Math.abs(state.v) < 0.01) {
        state.p = target;
        state.v = 0;
        paint();
        return;
      }
      paint();
      state.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(state.frame);
  }, [view, paint]);

  return (
    <div ref={root} role="tablist" aria-label="View" className="view-switch fixed bottom-0 left-1/2 z-10">
      <svg aria-hidden className="view-switch-outline">
        <path ref={fill} fill="var(--color-page)" />
        <path ref={line} fill="none" stroke="var(--color-body)" strokeWidth={STROKE} strokeLinecap="butt" strokeLinejoin="round" />
      </svg>
      <button ref={left} type="button" role="tab" aria-selected={view === "drawing"} onClick={() => onChange("drawing")}>
        Drawing
      </button>
      <button ref={right} type="button" role="tab" aria-selected={view === "thinking"} onClick={() => onChange("thinking")}>
        Thinking
      </button>
    </div>
  );
}
