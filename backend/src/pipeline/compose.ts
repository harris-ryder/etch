import type { Point } from "../geometry/types";
import { CANVAS, type Part } from "../types";
import type { Raster } from "./raster";

/**
 * Stage 4b: composition.
 *
 * There is one finished picture. This places it on the canvas and divides it
 * into the parts the planner named, so the drawing can be made (and narrated)
 * one part at a time. Because every part is cut from the same image, the parts
 * always fit together: the split only decides the ORDER things are drawn in,
 * never what the picture looks like.
 */

/** Maps raster pixels to canvas units: `canvas = pixel * scale + offset`. */
export interface Placement {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

/** Fits the whole picture inside the canvas, centred, with its proportions kept. */
export function canvasPlacement(raster: Raster): Placement {
  const { width: w, height: h } = raster.mask;
  const scale = Math.min(CANVAS.width / w, CANVAS.height / h);
  return { scaleX: scale, scaleY: scale, offsetX: (CANVAS.width - w * scale) / 2, offsetY: (CANVAS.height - h * scale) / 2 };
}

/**
 * Which part each pixel belongs to, as an index into `parts`.
 *
 * A pixel goes to the smallest box that contains it, so a subject's box wins
 * over the setting's box behind it. A pixel inside no box goes to the nearest
 * one, so nothing in the picture is ever left undrawn.
 */
export function assignPixels(width: number, height: number, parts: readonly Part[]): Uint8Array {
  const boxes = parts.map((part) => {
    const x0 = part.bbox.x * width;
    const y0 = part.bbox.y * height;
    const x1 = x0 + part.bbox.w * width;
    const y1 = y0 + part.bbox.h * height;
    return { x0, y0, x1, y1, area: (x1 - x0) * (y1 - y0) };
  });
  const owner = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = 0;
      let bestArea = Infinity;
      let nearest = 0;
      let nearestDistance = Infinity;
      for (let p = 0; p < boxes.length; p++) {
        const box = boxes[p]!;
        const dx = Math.max(box.x0 - x, 0, x - box.x1);
        const dy = Math.max(box.y0 - y, 0, y - box.y1);
        if (dx === 0 && dy === 0) {
          if (box.area < bestArea) {
            bestArea = box.area;
            best = p;
          }
        } else if (bestArea === Infinity) {
          const distance = dx * dx + dy * dy;
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = p;
          }
        }
      }
      owner[y * width + x] = bestArea === Infinity ? nearest : best;
    }
  }
  return owner;
}

/** One raster per part, each the size of the whole picture with everything outside the part left as blank paper. */
export function splitIntoParts(raster: Raster, parts: readonly Part[]): Raster[] {
  const { width: w, height: h } = raster.mask;
  const owner = assignPixels(w, h, parts);
  return parts.map((_, p) => {
    const grey = new Uint8Array(w * h).fill(255);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== p) continue;
      grey[i] = raster.grey.data[i]!;
      mask[i] = raster.mask.data[i]!;
    }
    return { grey: { width: w, height: h, data: grey }, mask: { width: w, height: h, data: mask } };
  });
}

/** Moves a pixel-space path onto the canvas, rounded to 0.1 and clamped to the screen. */
export function applyPlacement(path: readonly Point[], placement: Placement): Point[] {
  const out: Point[] = [];
  const round = (v: number, max: number): number => Math.round(Math.max(0, Math.min(max, v)) * 10) / 10;
  for (const [px, py] of path) {
    const x = round(px * placement.scaleX + placement.offsetX, CANVAS.width);
    const y = round(py * placement.scaleY + placement.offsetY, CANVAS.height);
    const last = out[out.length - 1];
    if (!last || last[0] !== x || last[1] !== y) out.push([x, y]);
  }
  return out;
}
