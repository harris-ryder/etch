import type { Point } from "./types";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boundsOf(points: readonly Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Scales a path so its bounding box fits inside `target` (aspect ratio kept,
 * centred), rounding to one decimal place.
 */
export function fitToBox(points: readonly Point[], target: Box): Point[] {
  if (points.length === 0) return [];
  const source = boundsOf(points);
  const scaleX = source.w > 1e-9 ? target.w / source.w : Infinity;
  const scaleY = source.h > 1e-9 ? target.h / source.h : Infinity;
  let scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale)) scale = 1;
  const offsetX = target.x + (target.w - source.w * scale) / 2;
  const offsetY = target.y + (target.h - source.h * scale) / 2;
  const round = (v: number): number => Math.round(v * 10) / 10;
  return points.map(([x, y]) => [round(offsetX + (x - source.x) * scale), round(offsetY + (y - source.y) * scale)]);
}

/** Drops points that repeat the one before them. */
export function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}
