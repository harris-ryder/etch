import sharp from "sharp";
import { thresholdImage } from "../geometry/otsu";
import type { Bitmap, GreyImage } from "../geometry/types";

export interface Raster {
  grey: GreyImage;
  /** Otsu-thresholded ink mask. */
  mask: Bitmap;
}

/** Working resolution, on the longer side. The whole picture is one image now, so it needs the room. */
export const RASTER_SIZE = 1024;

/**
 * Stage 4a: decode, flatten onto white, greyscale, resize so the longer side
 * is the working size (aspect ratio kept) and threshold. `sharp` does the decoding; everything after this point
 * is plain TypeScript.
 */
export async function loadRaster(image: Uint8Array, size = RASTER_SIZE): Promise<Raster> {
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
  return { grey: greyImage, mask: thresholdImage(greyImage) };
}
