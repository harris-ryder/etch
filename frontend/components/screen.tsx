"use client";

import type { ReactNode, RefObject } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/engine";

export interface ScreenRefs {
  canvas: RefObject<HTMLCanvasElement | null>;
  stylus: RefObject<HTMLDivElement | null>;
}

/**
 * The screen: an unframed area in the canvas's 10:7 proportions with the line
 * drawn inside it. Its edges are a soft, slowly drifting blur rather than a border. `children` are laid over the drawing (the prompt).
 * `dimmed` fades the drawing back so text typed over it stays readable.
 */
export function Screen({ refs, shaking, dimmed, children }: { refs: ScreenRefs; shaking: boolean; dimmed: boolean; children?: ReactNode }) {
  return (
    <div
      className={`relative w-full ${shaking ? "screen-shaking" : ""}`}
      style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
    >
      <canvas
        ref={refs.canvas}
        role="img"
        aria-label="Drawing screen"
        className={`screen-canvas absolute inset-0 h-full w-full ${shaking ? "is-clearing" : dimmed ? "is-dimmed" : ""}`}
      />
      <div ref={refs.stylus} className={`screen-stylus pointer-events-none absolute opacity-0 ${dimmed ? "invisible" : ""}`} />
      {/* No drawn frame: the picture dissolves at its edges. Two soft layers, drifting
          slightly out of step, blur the outer band and then fade it into the page. */}
      <div aria-hidden className="screen-haze" />
      <div aria-hidden className="screen-mist" />
      {children}
    </div>
  );
}
