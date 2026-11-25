import { describe, expect, test } from "bun:test";
import { labelComponents } from "../src/geometry/connect";
import { otsuThreshold, thresholdImage } from "../src/geometry/otsu";
import { zhangSuen } from "../src/geometry/skeleton";
import { blank, fillRect, inkCount } from "./helpers";

describe("otsuThreshold", () => {
  test("separates a bimodal image", () => {
    const grey = new Uint8Array(200);
    grey.fill(30, 0, 60);
    grey.fill(220, 60);
    const t = otsuThreshold(grey);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
    const mask = thresholdImage({ width: 20, height: 10, data: grey });
    expect(inkCount(mask)).toBe(60);
  });

  test("a blank white image has no ink", () => {
    const grey = new Uint8Array(100).fill(255);
    expect(inkCount(thresholdImage({ width: 10, height: 10, data: grey }))).toBe(0);
  });
});

describe("zhangSuen", () => {
  test("thins a thick horizontal bar to a one-pixel line", () => {
    const bar = blank(40, 15);
    fillRect(bar, 4, 5, 35, 9);
    const skeleton = zhangSuen(bar);
    // Every column that still has ink has exactly one pixel of it.
    let columns = 0;
    for (let x = 0; x < 40; x++) {
      let n = 0;
      for (let y = 0; y < 15; y++) n += skeleton.data[y * 40 + x]!;
      expect(n).toBeLessThanOrEqual(1);
      if (n === 1) columns++;
    }
    expect(columns).toBeGreaterThan(20);
    // The line sits in the middle of the bar.
    for (let x = 10; x < 30; x++) expect(skeleton.data[7 * 40 + x]).toBe(1);
  });

  test("keeps a one-pixel line unchanged and never adds ink", () => {
    const line = blank(20, 5);
    fillRect(line, 2, 2, 17, 2);
    const skeleton = zhangSuen(line);
    expect(Array.from(skeleton.data)).toEqual(Array.from(line.data));
  });

  test("preserves connectivity and the hole of a thick ring", () => {
    const ring = blank(40, 40);
    fillRect(ring, 5, 5, 34, 34);
    for (let y = 12; y <= 27; y++) for (let x = 12; x <= 27; x++) ring.data[y * 40 + x] = 0;
    const skeleton = zhangSuen(ring);
    expect(labelComponents(skeleton).sizes.length - 1).toBe(1);
    expect(inkCount(skeleton)).toBeLessThan(inkCount(ring) / 4);
    // Still a loop: the centre is empty and is enclosed on all four sides.
    expect(skeleton.data[20 * 40 + 20]).toBe(0);
    const rowHits = (y: number): number => {
      let n = 0;
      for (let x = 0; x < 40; x++) n += skeleton.data[y * 40 + x]!;
      return n;
    };
    expect(rowHits(20)).toBe(2);
  });
});
