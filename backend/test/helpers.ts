import sharp from "sharp";
import type { Providers } from "../src/config";
import type { Bitmap, Point } from "../src/geometry/types";

export function blank(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height) };
}

export function fillRect(bitmap: Bitmap, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bitmap.data[y * bitmap.width + x] = 1;
}

export function inkCount(bitmap: Bitmap): number {
  let n = 0;
  for (const v of bitmap.data) n += v;
  return n;
}

/** True when every step of the path moves at most one pixel (so the pen never jumps). */
export function isContiguous(path: readonly Point[]): boolean {
  for (let i = 1; i < path.length; i++) {
    if (Math.abs(path[i]![0] - path[i - 1]![0]) > 1 || Math.abs(path[i]![1] - path[i - 1]![1]) > 1) return false;
  }
  return true;
}

export function key(p: Point): string {
  return `${p[0]},${p[1]}`;
}

/**
 * Stand-ins for the planner and image model so the pipeline can be tested
 * without a network. The "picture" is three plain outlines side by side on a
 * 3:2 sheet, and the planner names a part around each.
 */
export function stubProviders(): Providers {
  const boxes = [
    { x: 0, y: 0, w: 0.34, h: 1 },
    { x: 0.34, y: 0, w: 0.33, h: 1 },
    { x: 0.67, y: 0, w: 0.33, h: 1 },
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#fff"/><g fill="none" stroke="#000" stroke-width="14"><rect x="80" y="300" width="360" height="420"/><circle cx="768" cy="512" r="190"/><path d="M1280 250 L1470 780 L1090 780 Z"/></g></svg>`;
  return {
    name: "openrouter",
    models: { text: "stub/planner", image: "stub/image" },
    planner: {
      plan: async (text: string) => ({
        scene: {
          title: text,
          prompt: `a picture of ${text}`,
          parts: boxes.map((bbox, i) => ({ id: `part-${i}`, name: `shape ${i}`, bbox, narration: `Narration ${i}.` })),
        },
        receipt: { provider: "stub", model: "stub/planner", system: "instructions", user: text, reply: "{}", attempts: 1, usage: { inputTokens: 10, outputTokens: 20 } },
      }),
    },
    images: {
      generate: async (scene, style) => ({
        image: new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer()),
        receipt: { provider: "stub", model: "stub/image", prompt: `${scene.prompt} / ${style}`, shape: "3:2", usage: { costUsd: 0.01 } },
      }),
    },
  };
}
