import { describe, expect, test } from "bun:test";
import { hatchPath } from "../src/geometry/hatch";
import { spiralPath } from "../src/geometry/spiral";
import { stipple } from "../src/geometry/stipple";
import { nearestNeighbourTour, tourLength, tspPath, twoOpt } from "../src/geometry/tsp";
import { mulberry32, type GreyImage, type Point } from "../src/geometry/types";
import { blank, fillRect } from "./helpers";

function randomPoints(n: number, seed: number): Point[] {
  const random = mulberry32(seed);
  return Array.from({ length: n }, () => [random() * 100, random() * 100] as Point);
}

function isPermutation(order: readonly number[], n: number): boolean {
  return order.length === n && new Set(order).size === n && order.every((i) => i >= 0 && i < n);
}

describe("nearestNeighbourTour", () => {
  test("visits every point exactly once", () => {
    const points = randomPoints(200, 7);
    expect(isPermutation(nearestNeighbourTour(points, 3), 200)).toBe(true);
  });

  test("walks points on a line in order", () => {
    const points: Point[] = [
      [0, 0],
      [3, 0],
      [1, 0],
      [2, 0],
    ];
    expect(nearestNeighbourTour(points, 0)).toEqual([0, 2, 3, 1]);
  });
});

describe("twoOpt", () => {
  test("uncrosses a crossed tour", () => {
    const square: Point[] = [
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 10],
    ];
    // 0 -> 1 -> 2 -> 3 zig-zags across the square.
    const before = tourLength(square, [0, 1, 2, 3]);
    const order = twoOpt(square, [0, 1, 2, 3]);
    expect(isPermutation(order, 4)).toBe(true);
    expect(tourLength(square, order)).toBeCloseTo(30);
    expect(tourLength(square, order)).toBeLessThan(before);
  });

  test("never makes a tour longer and keeps it a permutation", () => {
    const points = randomPoints(300, 42);
    const greedy = nearestNeighbourTour(points);
    const improved = twoOpt(points, greedy);
    expect(isPermutation(improved, 300)).toBe(true);
    expect(tourLength(points, improved)).toBeLessThanOrEqual(tourLength(points, greedy));
    // And clearly better than visiting in random order.
    const identity = points.map((_, i) => i);
    expect(tourLength(points, improved)).toBeLessThan(tourLength(points, identity) / 3);
  });

  test("tspPath returns all the points", () => {
    const points = randomPoints(50, 3);
    const path = tspPath(points);
    expect(path.length).toBe(50);
    expect(new Set(path.map((p) => p.join(","))).size).toBe(50);
  });
});

describe("stipple", () => {
  const half: GreyImage = { width: 40, height: 40, data: new Uint8Array(1600).fill(255) };
  for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) half.data[y * 40 + x] = 0;

  test("puts points only where the image is dark", () => {
    const points = stipple(half, { count: 150 });
    expect(points.length).toBe(150);
    for (const [x, y] of points) {
      expect(x).toBeLessThanOrEqual(20);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(40);
    }
  });

  test("is deterministic for a seed and empty for a white image", () => {
    expect(stipple(half, { count: 40, seed: 5 })).toEqual(stipple(half, { count: 40, seed: 5 }));
    expect(stipple({ width: 8, height: 8, data: new Uint8Array(64).fill(255) })).toEqual([]);
  });
});

describe("hatchPath", () => {
  test("horizontal hatching stays inside the mask and snakes back and forth", () => {
    const mask = blank(40, 40);
    fillRect(mask, 10, 10, 29, 29);
    const path = hatchPath(mask, { spacing: 4, angleDeg: 0 });
    expect(path.length).toBeGreaterThanOrEqual(8);
    for (const [x, y] of path) {
      expect(x).toBeGreaterThanOrEqual(9.5);
      expect(x).toBeLessThanOrEqual(29.5);
      expect(y).toBeGreaterThanOrEqual(9.5);
      expect(y).toBeLessThanOrEqual(29.5);
    }
    // Serpentine: the join between rows is short (straight down the same side).
    for (let i = 2; i < path.length; i += 2) {
      expect(Math.abs(path[i]![0] - path[i - 1]![0])).toBeLessThan(1);
    }
  });
});

describe("spiralPath", () => {
  test("winds outwards from the centre of the mask and wobbles over dark areas", () => {
    const mask = blank(64, 64);
    fillRect(mask, 16, 16, 47, 47);
    const dark: GreyImage = { width: 64, height: 64, data: new Uint8Array(64 * 64).fill(255) };
    for (let y = 16; y <= 47; y++) for (let x = 16; x <= 47; x++) dark.data[y * 64 + x] = 0;
    const white: GreyImage = { width: 64, height: 64, data: new Uint8Array(64 * 64).fill(255) };

    const calm = spiralPath(white, mask);
    const wobbly = spiralPath(dark, mask);
    expect(calm.length).toBe(wobbly.length);
    expect(calm[0]![0]).toBeCloseTo(31.5);
    expect(calm[0]![1]).toBeCloseTo(31.5);

    // Radius only ever grows on the calm spiral...
    let previous = 0;
    for (const [x, y] of calm) {
      const r = Math.hypot(x - 31.5, y - 31.5);
      expect(r).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = r;
    }
    // ...and the dark one deviates from it.
    let deviation = 0;
    for (let i = 0; i < calm.length; i++) deviation += Math.hypot(calm[i]![0] - wobbly[i]![0], calm[i]![1] - wobbly[i]![1]);
    expect(deviation / calm.length).toBeGreaterThan(0.5);
  });
});
