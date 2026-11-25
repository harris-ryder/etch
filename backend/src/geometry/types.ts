/** A 2D point as an `[x, y]` tuple. */
export type Point = [number, number];

/** A binary image. `data[y * width + x]` is 1 for ink and 0 for paper. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

/** An 8-bit greyscale image. 0 is black, 255 is white. */
export interface GreyImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  return total;
}

/** Builds a bitmap from rows of text, where `#` (or any non-space, non-dot char) is ink. */
export function bitmapFromRows(rows: readonly string[]): Bitmap {
  const height = rows.length;
  const width = Math.max(0, ...rows.map((r) => r.length));
  const data = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== " " && ch !== ".") data[y * width + x] = 1;
    }
  });
  return { width, height, data };
}

/** Small deterministic PRNG (mulberry32) so stippling is repeatable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
