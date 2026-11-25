import type { Point } from "./types";

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Ramer–Douglas–Peucker simplification. Keeps the first and last point and
 * every point further than `epsilon` from the simplified line. Iterative, so
 * long paths cannot overflow the stack.
 */
export function rdp(points: readonly Point[], epsilon: number): Point[] {
  const n = points.length;
  if (n <= 2 || epsilon <= 0) return points.map((p) => [p[0], p[1]] as Point);

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let index = -1;
    let maxDistance = epsilon;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i]!, points[first]!, points[last]!);
      if (d > maxDistance) {
        maxDistance = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push([points[i]![0], points[i]![1]]);
  return out;
}
