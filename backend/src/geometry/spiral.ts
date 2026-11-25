import type { Bitmap, GreyImage, Point } from "./types";

export interface SpiralOptions {
  /** Distance between spiral turns, in pixels. */
  spacing?: number;
  /** Maximum wobble as a fraction of `spacing` (keep below 0.5 so turns do not collide). */
  amplitude?: number;
  /** Length of one wobble along the spiral, in pixels. */
  wavelength?: number;
  /** Sampling step along the spiral, in pixels. */
  step?: number;
}

/** Bilinear darkness sample in 0..1 (0 outside the image). */
function darknessAt(image: GreyImage, x: number, y: number): number {
  const { width: w, height: h, data } = image;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = data[y0 * w + x0]! * (1 - fx) + data[y0 * w + x1]! * fx;
  const bottom = data[y1 * w + x0]! * (1 - fx) + data[y1 * w + x1]! * fx;
  return 1 - (top * (1 - fy) + bottom * fy) / 255;
}

/**
 * "Spiral art": an Archimedean spiral from the centre of the ink mask whose
 * radius wobbles with the darkness underneath it. Light areas stay a calm
 * spiral, dark areas become a dense zig-zag.
 */
export function spiralPath(image: GreyImage, mask: Bitmap, options: SpiralOptions = {}): Point[] {
  const { spacing = 5, amplitude = 0.45, wavelength = 3.2, step = 0.6 } = options;
  const { width: w, height: h } = mask;

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask.data[y * w + x]) continue;
      sumX += x;
      sumY += y;
      count++;
    }
  }
  if (count === 0) return [];
  const cx = sumX / count;
  const cy = sumY / count;

  let maxRadius = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask.data[y * w + x]) maxRadius = Math.max(maxRadius, Math.hypot(x - cx, y - cy));
    }
  }
  maxRadius += spacing;

  const out: Point[] = [];
  let theta = 0;
  let travelled = 0;
  for (;;) {
    const radius = (spacing * theta) / (2 * Math.PI);
    if (radius > maxRadius) break;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const darkness = darknessAt(image, cx + radius * cos, cy + radius * sin);
    const wobble = amplitude * spacing * darkness * Math.sin((2 * Math.PI * travelled) / wavelength);
    out.push([cx + (radius + wobble) * cos, cy + (radius + wobble) * sin]);
    // Keep the arc-length step roughly constant as the radius grows.
    theta += step / Math.max(radius, 1);
    travelled += step;
  }
  return out;
}
