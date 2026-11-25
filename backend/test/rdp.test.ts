import { describe, expect, test } from "bun:test";
import { dedupe, fitToBox } from "../src/geometry/fit";
import { rdp } from "../src/geometry/rdp";
import type { Point } from "../src/geometry/types";

describe("rdp", () => {
  test("collapses collinear points to the two ends", () => {
    const line: Point[] = Array.from({ length: 50 }, (_, i) => [i, 2 * i] as Point);
    expect(rdp(line, 0.1)).toEqual([
      [0, 0],
      [49, 98],
    ]);
  });

  test("keeps a corner that sticks out further than epsilon", () => {
    const path: Point[] = [
      [0, 0],
      [5, 0.2],
      [10, 0],
      [10, 5],
      [10, 10],
    ];
    expect(rdp(path, 0.5)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  test("drops a bump smaller than epsilon and keeps one larger", () => {
    const bump = (height: number): Point[] => [
      [0, 0],
      [5, height],
      [10, 0],
    ];
    expect(rdp(bump(0.4), 0.5).length).toBe(2);
    expect(rdp(bump(0.6), 0.5).length).toBe(3);
  });

  test("handles a closed loop (first point equals last)", () => {
    const loop: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    expect(rdp(loop, 1)).toEqual(loop);
  });

  test("epsilon 0 and tiny inputs are returned as copies", () => {
    const path: Point[] = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    expect(rdp(path, 0)).toEqual(path);
    expect(rdp(path, 0)).not.toBe(path);
    expect(rdp([[1, 1]], 5)).toEqual([[1, 1]]);
    expect(rdp([], 5)).toEqual([]);
  });

  test("copes with very long paths without overflowing the stack", () => {
    const zigzag: Point[] = Array.from({ length: 5_000 }, (_, i) => [i, i % 2 === 0 ? 0 : 5] as Point);
    expect(rdp(zigzag, 1).length).toBe(5_000);
  });
});

describe("fitToBox", () => {
  test("scales to fit, keeps the aspect ratio and centres", () => {
    const square: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const placed = fitToBox(square, { x: 100, y: 100, w: 200, h: 100 });
    expect(placed).toEqual([
      [150, 100],
      [250, 100],
      [250, 200],
      [150, 200],
    ]);
  });

  test("a flat line fits the width and sits in the middle", () => {
    const placed = fitToBox(
      [
        [0, 5],
        [10, 5],
      ],
      { x: 0, y: 0, w: 100, h: 40 },
    );
    expect(placed).toEqual([
      [0, 20],
      [100, 20],
    ]);
  });

  test("dedupe removes repeated neighbours", () => {
    expect(
      dedupe([
        [1, 1],
        [1, 1],
        [2, 2],
        [1, 1],
      ]),
    ).toEqual([
      [1, 1],
      [2, 2],
      [1, 1],
    ]);
  });
});
