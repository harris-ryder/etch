import { dist, type Point } from "./types";

/** Length of the open tour that visits `points` in the given order. */
export function tourLength(points: readonly Point[], order: readonly number[]): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) total += dist(points[order[i - 1]!]!, points[order[i]!]!);
  return total;
}

/** Greedy nearest-neighbour tour starting from `start`. Returns point indices. */
export function nearestNeighbourTour(points: readonly Point[], start = 0): number[] {
  const n = points.length;
  if (n === 0) return [];
  const visited = new Uint8Array(n);
  const order = [start];
  visited[start] = 1;
  let current = start;
  for (let step = 1; step < n; step++) {
    const [cx, cy] = points[current]!;
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const dx = points[i]![0] - cx;
      const dy = points[i]![1] - cy;
      const d = dx * dx + dy * dy;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    visited[best] = 1;
    order.push(best);
    current = best;
  }
  return order;
}

export interface TwoOptOptions {
  maxPasses?: number;
  /** Stop improving after this many milliseconds. */
  timeBudgetMs?: number;
}

/**
 * 2-opt for an open tour: repeatedly reverses a stretch of the tour whenever
 * that removes a crossing (shortens the path). Returns a new order.
 */
export function twoOpt(points: readonly Point[], initial: readonly number[], options: TwoOptOptions = {}): number[] {
  const { maxPasses = 40, timeBudgetMs = 1500 } = options;
  const order = [...initial];
  const n = order.length;
  if (n < 4) return order;
  const deadline = Date.now() + timeBudgetMs;
  const d = (i: number, j: number): number => dist(points[order[i]!]!, points[order[j]!]!);

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 0; i < n - 2; i++) {
      for (let j = i + 2; j < n; j++) {
        // Replace links (i, i+1) and (j, j+1) with (i, j) and (i+1, j+1).
        // When j is the last stop there is no second link to replace.
        const delta = j + 1 < n ? d(i, j) + d(i + 1, j + 1) - d(i, i + 1) - d(j, j + 1) : d(i, j) - d(i, i + 1);
        if (delta < -1e-9) {
          for (let a = i + 1, b = j; a < b; a++, b--) [order[a], order[b]] = [order[b]!, order[a]!];
          improved = true;
        }
      }
      if (Date.now() > deadline) return order;
    }
    if (!improved) break;
  }
  return order;
}

/** Nearest-neighbour tour polished with 2-opt, returned as ordered points. */
export function tspPath(points: readonly Point[], options: TwoOptOptions = {}): Point[] {
  if (points.length === 0) return [];
  // Start from the left-most point so the route does not begin mid-drawing.
  let start = 0;
  for (let i = 1; i < points.length; i++) if (points[i]![0] < points[start]![0]) start = i;
  const order = twoOpt(points, nearestNeighbourTour(points, start), options);
  return order.map((i) => [points[i]![0], points[i]![1]] as Point);
}
