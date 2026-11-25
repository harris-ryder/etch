import { describe, expect, test } from "bun:test";
import { toGcode } from "../src/geometry/gcode";
import type { Point } from "../src/geometry/types";

const body = (text: string): string[] => text.trim().split("\n").filter((line) => line.startsWith("G1"));

describe("toGcode", () => {
  test("emits a millimetre/absolute header and only G1 moves", () => {
    const out = toGcode([
      [0, 700],
      [1000, 0],
    ]);
    const lines = out.trim().split("\n");
    expect(lines[0]).toStartWith("G21");
    expect(lines[1]).toStartWith("G90");
    expect(lines.slice(2).every((line) => /^G1 X-?\d+\.\d{3} Y-?\d+\.\d{3} F\d+$/.test(line))).toBe(true);
    expect(out).not.toContain("G0");
    expect(out.endsWith("\n")).toBe(true);
  });

  test("maps canvas corners to the screen in mm with Y flipped", () => {
    const corners: Point[] = [
      [0, 700],
      [1000, 700],
      [1000, 0],
      [0, 0],
    ];
    expect(body(toGcode(corners, { screenWidthMm: 160, screenHeightMm: 112, feedRate: 900 }))).toEqual([
      "G1 X0.000 Y0.000 F900",
      "G1 X160.000 Y0.000 F900",
      "G1 X160.000 Y112.000 F900",
      "G1 X0.000 Y112.000 F900",
    ]);
  });

  test("honours a custom canvas size, precision and no header", () => {
    const out = toGcode(
      [
        [50, 50],
        [100, 0],
      ],
      { canvasWidth: 100, canvasHeight: 100, screenWidthMm: 200, screenHeightMm: 100, precision: 1, header: false, feedRate: 500 },
    );
    expect(out).toBe("G1 X100.0 Y50.0 F500\nG1 X200.0 Y100.0 F500\n");
  });

  test("skips repeated points", () => {
    const out = toGcode([
      [10, 10],
      [10, 10],
      [20, 10],
    ]);
    expect(body(out).length).toBe(2);
  });

  test("reversalCompensation defaults to 0 and adds nothing", () => {
    const zigzag: Point[] = [
      [0, 700],
      [500, 700],
      [250, 700],
      [750, 700],
    ];
    expect(toGcode(zigzag)).toBe(toGcode(zigzag, { reversalCompensation: 0 }));
    expect(body(toGcode(zigzag)).length).toBe(4);
  });

  test("reversalCompensation takes up slack when an axis reverses", () => {
    // 1 canvas unit = 1 mm to keep the numbers readable.
    const opts = { canvasWidth: 100, canvasHeight: 100, screenWidthMm: 100, screenHeightMm: 100, feedRate: 600, header: false, reversalCompensation: 0.5 };
    const out = body(
      toGcode(
        [
          [0, 100], // (0, 0) mm
          [50, 100], // +X
          [20, 100], // -X: reversal
          [60, 100], // +X: reversal back
        ],
        opts,
      ),
    );
    expect(out).toEqual([
      "G1 X0.000 Y0.000 F600",
      "G1 X50.000 Y0.000 F600",
      "G1 X49.500 Y0.000 F600", // take up 0.5 mm of slack in place
      "G1 X19.500 Y0.000 F600", // shifted target
      "G1 X20.000 Y0.000 F600", // slack back the other way
      "G1 X60.000 Y0.000 F600",
    ]);
  });

  test("compensates each axis independently", () => {
    const opts = { canvasWidth: 100, canvasHeight: 100, screenWidthMm: 100, screenHeightMm: 100, feedRate: 600, header: false, reversalCompensation: 1 };
    const out = body(
      toGcode(
        [
          [0, 100], // (0, 0)
          [10, 90], // (10, 10): +X +Y
          [20, 100], // (20, 0): +X, -Y reversal
        ],
        opts,
      ),
    );
    expect(out).toEqual([
      "G1 X0.000 Y0.000 F600",
      "G1 X10.000 Y10.000 F600",
      "G1 X10.000 Y9.000 F600",
      "G1 X20.000 Y-1.000 F600",
    ]);
  });

  test("an empty path is just the header", () => {
    expect(body(toGcode([]))).toEqual([]);
  });
});
