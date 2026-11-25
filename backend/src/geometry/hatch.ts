import { dist, type Bitmap, type Point } from "./types";

export interface HatchOptions {
  /** Distance between hatch lines, in pixels. */
  spacing?: number;
  angleDeg?: number;
  /** Runs of ink shorter than this (in pixels) are skipped. */
  minRun?: number;
}

/**
 * Parallel hatch lines clipped to the ink mask and joined into one
 * serpentine path, always continuing with whichever remaining line starts
 * closest to where the pen is, so the joins stay short.
 */
export function hatchPath(mask: Bitmap, options: HatchOptions = {}): Point[] {
  const { spacing = 4, angleDeg = 45, minRun = 2 } = options;
  const { width: w, height: h, data } = mask;
  const angle = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const nx = -uy;
  const ny = ux;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const half = Math.ceil(Math.hypot(w, h) / 2);

  const inked = (t: number, r: number): boolean => {
    const x = Math.round(cx + t * ux + r * nx);
    const y = Math.round(cy + t * uy + r * ny);
    return x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
  };
  const at = (t: number, r: number): Point => [cx + t * ux + r * nx, cy + t * uy + r * ny];

  // Collect every run of ink along every scanline.
  const runs: Array<[Point, Point]> = [];
  for (let r = -half; r <= half; r += spacing) {
    let runStart: number | null = null;
    for (let t = -half; t <= half + 1; t++) {
      const ink = t <= half && inked(t, r);
      if (ink && runStart === null) runStart = t;
      if (!ink && runStart !== null) {
        const runEnd = t - 1;
        if (runEnd - runStart + 1 >= minRun) runs.push([at(runStart, r), at(runEnd, r)]);
        runStart = null;
      }
    }
  }
  if (runs.length === 0) return [];

  // Chain them nearest-end-first. Within one patch of ink that gives the usual
  // back-and-forth serpentine; where the mask has a hole (another layer in
  // front), the pen finishes one side before crossing to the other, instead of
  // striking across the hole on every scanline.
  const used = new Uint8Array(runs.length);
  const out: Point[] = [runs[0]![0], runs[0]![1]];
  used[0] = 1;
  for (let placed = 1; placed < runs.length; placed++) {
    const tail = out[out.length - 1]!;
    let best = -1;
    let bestFlipped = false;
    let bestDistance = Infinity;
    for (let i = 0; i < runs.length; i++) {
      if (used[i]) continue;
      const toStart = dist(tail, runs[i]![0]);
      const toEnd = dist(tail, runs[i]![1]);
      if (toStart < bestDistance) {
        bestDistance = toStart;
        best = i;
        bestFlipped = false;
      }
      if (toEnd < bestDistance) {
        bestDistance = toEnd;
        best = i;
        bestFlipped = true;
      }
    }
    used[best] = 1;
    const [a, b] = runs[best]!;
    if (bestFlipped) out.push(b, a);
    else out.push(a, b);
  }
  return out;
}
