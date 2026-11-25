import type { ImageReceipt, Scene, Style } from "../types";

/** Stage 3: produces ONE picture (PNG/JPEG/WebP bytes) of the whole scene, in the house style. */
export interface SceneImageGenerator {
  generate(scene: Scene, style: Style): Promise<ImageResult>;
}

export interface ImageResult {
  /** The image bytes exactly as the model returned them. */
  image: Uint8Array;
  receipt: Pick<ImageReceipt, "provider" | "model" | "prompt" | "shape" | "quality" | "usage">;
}
