import { mulberry32, type GreyImage, type Point } from "./types";

export interface StippleOptions {
  /** Fixed number of points. When omitted it scales with the amount of ink. */
  count?: number;
  minPoints?: number;
  maxPoints?: number;
  seed?: number;
  lloydIterations?: number;
  /** Darkness (summed over pixels, each 0..1) that earns one point. */
  inkPerPoint?: number;
}

/**
 * Weighted stippling: scatters points with density proportional to darkness,
 * then (when cheap enough) evens them out with a few rounds of weighted Lloyd
 * relaxation, moving each point to the darkness-weighted centre of the pixels
 * closest to it.
 */
export function stipple(image: GreyImage, options: StippleOptions = {}): Point[] {
  const { minPoints = 500, maxPoints = 2000, seed = 1, lloydIterations = 2, inkPerPoint = 3 } = options;
  const { width: w, data } = image;

  const pixels: number[] = [];
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < data.length; i++) {
    const darkness = (255 - data[i]!) / 255;
    if (darkness < 0.1) continue;
    pixels.push(i);
    weights.push(darkness);
    total += darkness;
  }
  if (pixels.length === 0) return [];

  let count = options.count ?? Math.max(minPoints, Math.min(maxPoints, Math.round(total / inkPerPoint)));
  // No point stacking several stipples on one pixel of a sparse drawing.
  count = Math.max(2, Math.min(count, pixels.length));

  const cumulative = new Float64Array(pixels.length);
  let running = 0;
  for (let i = 0; i < pixels.length; i++) {
    running += weights[i]!;
    cumulative[i] = running;
  }

  const random = mulberry32(seed);
  const points: Point[] = [];
  for (let k = 0; k < count; k++) {
    const target = random() * total;
    let lo = 0;
    let hi = pixels.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    const pixel = pixels[lo]!;
    points.push([(pixel % w) + random(), Math.floor(pixel / w) + random()]);
  }

  // Brute-force Voronoi assignment; only run it when the work is small.
  const cheap = pixels.length * count <= 4e7;
  for (let iteration = 0; cheap && iteration < lloydIterations; iteration++) {
    const sumX = new Float64Array(count);
    const sumY = new Float64Array(count);
    const sumW = new Float64Array(count);
    for (let p = 0; p < pixels.length; p++) {
      const pixel = pixels[p]!;
      const px = (pixel % w) + 0.5;
      const py = Math.floor(pixel / w) + 0.5;
      let best = 0;
      let bestDistance = Infinity;
      for (let k = 0; k < count; k++) {
        const dx = points[k]![0] - px;
        const dy = points[k]![1] - py;
        const d = dx * dx + dy * dy;
        if (d < bestDistance) {
          bestDistance = d;
          best = k;
        }
      }
      const weight = weights[p]!;
      sumX[best]! += px * weight;
      sumY[best]! += py * weight;
      sumW[best]! += weight;
    }
    for (let k = 0; k < count; k++) {
      if (sumW[k]! > 0) points[k] = [sumX[k]! / sumW[k]!, sumY[k]! / sumW[k]!];
    }
  }

  return points;
}
