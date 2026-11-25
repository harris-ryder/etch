import type { Bitmap, Point } from "./types";

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/** Labels 8-connected components. Returns labels (0 = paper, 1..n = component) and sizes. */
export function labelComponents(bitmap: Bitmap): { labels: Int32Array; sizes: number[] } {
  const { width: w, height: h, data } = bitmap;
  const labels = new Int32Array(w * h);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let start = 0; start < data.length; start++) {
    if (!data[start] || labels[start]) continue;
    const label = sizes.length;
    let size = 0;
    labels[start] = label;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k]!;
        const ny = y + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (data[j] && !labels[j]) {
          labels[j] = label;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Rasterises a straight line between two pixels (Bresenham), endpoints included. */
export function bresenham(a: Point, b: Point): Point[] {
  let [x0, y0] = a;
  const [x1, y1] = b;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out: Point[] = [];
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

export interface ConnectResult {
  bitmap: Bitmap;
  /** The straight bridges that were added, as pixel pairs. */
  bridges: Array<[Point, Point]>;
}

/**
 * Makes a skeleton one connected piece. Components smaller than `minSize`
 * pixels are dropped as noise (the largest is always kept); the rest are
 * joined to the growing main piece by the shortest straight bridge, found by
 * flooding outwards from everything connected so far (Prim's algorithm on
 * components).
 */
export function connectComponents(src: Bitmap, minSize = 3): ConnectResult {
  const { width: w, height: h } = src;
  const data = Uint8Array.from(src.data);
  const { labels, sizes } = labelComponents(src);
  const bridges: Array<[Point, Point]> = [];
  if (sizes.length <= 2) return { bitmap: { width: w, height: h, data }, bridges };

  let largest = 1;
  for (let l = 2; l < sizes.length; l++) if (sizes[l]! > sizes[largest]!) largest = l;

  let remaining = 0;
  for (let i = 0; i < data.length; i++) {
    const l = labels[i]!;
    if (!l) continue;
    if (l !== largest && sizes[l]! < minSize) {
      data[i] = 0;
      labels[i] = 0;
    }
  }
  for (let l = 1; l < sizes.length; l++) if (l !== largest && sizes[l]! >= minSize) remaining++;

  // `inTree[i]` marks pixels already connected to the main piece.
  const inTree = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) if (labels[i] === largest) inTree[i] = 1;

  const origin = new Int32Array(w * h);
  const queue = new Int32Array(w * h);

  while (remaining > 0) {
    origin.fill(-1);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < inTree.length; i++) {
      if (inTree[i]) {
        origin[i] = i;
        queue[tail++] = i;
      }
    }

    let hit = -1;
    let hitOrigin = -1;
    while (head < tail && hit < 0) {
      const i = queue[head++]!;
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k]!;
        const ny = y + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (origin[j] !== -1) continue;
        origin[j] = origin[i]!;
        if (data[j] && !inTree[j]) {
          hit = j;
          hitOrigin = origin[i]!;
          break;
        }
        queue[tail++] = j;
      }
    }
    if (hit < 0) break;

    const from: Point = [hitOrigin % w, Math.floor(hitOrigin / w)];
    const to: Point = [hit % w, Math.floor(hit / w)];
    bridges.push([from, to]);
    for (const [bx, by] of bresenham(from, to)) {
      const j = by * w + bx;
      data[j] = 1;
      inTree[j] = 1;
    }
    const merged = labels[hit]!;
    for (let i = 0; i < labels.length; i++) if (labels[i] === merged) inTree[i] = 1;
    remaining--;
  }

  return { bitmap: { width: w, height: h, data }, bridges };
}
