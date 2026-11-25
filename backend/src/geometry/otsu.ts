import type { Bitmap, GreyImage } from "./types";

/**
 * Otsu's method: the grey level that maximises between-class variance.
 * Pixels `<= threshold` are the dark class.
 */
export function otsuThreshold(grey: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < grey.length; i++) hist[grey[i]!]!++;

  const total = grey.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]!;

  let weightDark = 0;
  let sumDark = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    weightDark += hist[t]!;
    if (weightDark === 0) continue;
    const weightLight = total - weightDark;
    if (weightLight === 0) break;
    sumDark += t * hist[t]!;
    const meanDark = sumDark / weightDark;
    const meanLight = (sumAll - sumDark) / weightLight;
    const variance = weightDark * weightLight * (meanDark - meanLight) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

/** Thresholds a greyscale image into an ink mask (dark pixels become 1). */
export function thresholdImage(image: GreyImage, threshold = otsuThreshold(image.data)): Bitmap {
  const data = new Uint8Array(image.data.length);
  // A uniform image has no dark class at all; treat it as blank paper unless it is truly dark.
  let min = 255;
  let max = 0;
  for (let i = 0; i < image.data.length; i++) {
    const v = image.data[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 8) {
    if (max < 128) data.fill(1);
    return { width: image.width, height: image.height, data };
  }
  for (let i = 0; i < image.data.length; i++) data[i] = image.data[i]! <= threshold ? 1 : 0;
  return { width: image.width, height: image.height, data };
}
