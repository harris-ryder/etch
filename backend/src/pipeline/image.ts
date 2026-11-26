import type { ImageReceipt, Scene, Style } from "../types";

/** Stage 3: produces ONE picture (PNG/JPEG/WebP bytes) of the whole scene, in the house style. */
export interface SceneImageGenerator {
  generate(scene: Scene, style: Style): Promise<ImageResult>;
}

/**
 * The image model's safety filter refused the description. Unlike any other
 * failure this is worth a second try with a gentler description.
 */
export class ImageRejectedError extends Error {
  constructor() {
    super("The image model would not draw this one. Try telling the dream a different way.");
    this.name = "ImageRejectedError";
  }
}

/** Runs an image call, turning a safety refusal into an `ImageRejectedError`. */
export async function withRejection<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof Error && /safety|moderation|content.?policy|content.?filter/i.test(error.message)) throw new ImageRejectedError();
    throw error;
  }
}

export interface ImageResult {
  /** The image bytes exactly as the model returned them. */
  image: Uint8Array;
  receipt: Pick<ImageReceipt, "provider" | "model" | "prompt" | "shape" | "quality" | "usage">;
}
