import sharp from "sharp";
import { thresholdImage } from "../geometry/otsu";
import type { Bitmap, GreyImage } from "../geometry/types";

export interface Raster {
  grey: GreyImage;
  /** Which pixels are ink. */
  mask: Bitmap;
}

/** Working resolution, on the longer side. The whole picture is one image now, so it needs the room. */
export const RASTER_SIZE = 1024;
/** Working resolution for a pencil sketch, whose strokes are thin and close together. */
export const SKETCH_SIZE = 1536;

/**
 * The ink mask for a pencil sketch. A single cut-off for the whole picture
 * keeps the firm lines and throws the faint ones away, and the faint ones are
 * most of a sketch. So each pixel is compared with the paper around it
 * instead: it is ink if it is clearly darker than the average of its
 * neighbourhood, however pale the stroke.
 */
export function sketchMask(grey: GreyImage, radius = 10, margin = 14): Bitmap {
  const { width: w, height: h, data } = grey;
  // Summed-area table, so every neighbourhood average is four look-ups.
  const sums = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x]!;
      sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1]! + row;
    }
  }
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const mean = (sums[y1 * (w + 1) + x1]! - sums[y0 * (w + 1) + x1]! - sums[y1 * (w + 1) + x0]! + sums[y0 * (w + 1) + x0]!) / ((x1 - x0) * (y1 - y0));
      if (data[y * w + x]! < mean - margin) mask[y * w + x] = 1;
    }
  }
  return { width: w, height: h, data: mask };
}

/**
 * Stage 4a: decode, flatten onto white, greyscale, resize so the longer side
 * is the working size (aspect ratio kept) and threshold. `sharp` does the decoding; everything after this point
 * is plain TypeScript. With `sketch` the mask keeps faint pencil strokes (see `sketchMask`).
 */
export async function loadRaster(image: Uint8Array, size = RASTER_SIZE, sketch = false): Promise<Raster> {
  const { data, info } = await sharp(image)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(size, size, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Keep one channel in case the decoder hands back more.
  const grey = new Uint8Array(info.width * info.height);
  for (let i = 0; i < grey.length; i++) grey[i] = data[i * info.channels]!;

  const greyImage: GreyImage = { width: info.width, height: info.height, data: grey };
  return { grey: greyImage, mask: sketch ? sketchMask(greyImage) : thresholdImage(greyImage) };
}
