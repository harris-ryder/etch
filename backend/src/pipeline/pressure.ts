import type { GreyImage, Point } from "../geometry/types";
import { CANVAS } from "../types";
import type { Placement } from "./compose";

/**
 * How many times the pen goes over a stretch of line, by how dark the pencil
 * was there (0..1). An Etch A Sketch has one line: it cannot press harder or
 * draw paler. So a firm stroke is drawn several times, side by side, and a
 * faint one once. Always an odd number, so the pen ends up at the far end.
 */
const LEVELS: ReadonlyArray<{ above: number; passes: number }> = [
  { above: 0.86, passes: 5 },
  { above: 0.58, passes: 3 },
  { above: -1, passes: 1 },
];
/** How far apart, in canvas units, the passes over a firm stroke lie. Just under the width of the line. */
const SPREAD = 0.8;
/** Pressure is averaged over this many points either side, so it changes in strokes, not in flickers. */
const SMOOTH = 6;
/** A run shorter than this joins the run before it. */
const MIN_RUN = 8;

/**
 * Redraws a traced path so that it shows how hard the pencil pressed. A
 * pencil sketch is mostly faint searching lines with a few firm ones; tracing
 * flattens them all to one line. This puts the difference back the only way
 * the machine can: where the picture is dark under the line, the pen goes
 * back and forth over that stretch, each pass a hair to one side of the
 * last, so it reads as a heavier stroke.
 *
 * `path` is in canvas units and `placement` is how it got there from the
 * picture's pixels. The result starts and ends where `path` does and is
 * still one unbroken line.
 */
export function pressPath(path: readonly Point[], grey: GreyImage, placement: Placement): Point[] {
  if (path.length < 2) return [...path];
  const { width, height, data } = grey;

  // The darkest pixel right under each point: the centre of a pencil line, not the paper beside it.
  const dark = path.map(([cx, cy]) => {
    const px = Math.round((cx - placement.offsetX) / placement.scaleX);
    const py = Math.round((cy - placement.offsetY) / placement.scaleY);
    let lowest = 255;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const x = Math.max(0, Math.min(width - 1, px + i));
        const y = Math.max(0, Math.min(height - 1, py + j));
        const v = data[y * width + x]!;
        if (v < lowest) lowest = v;
      }
    }
    return 1 - lowest / 255;
  });

  // A running sum gives the average over the window around each point.
  const sums = new Float64Array(dark.length + 1);
  for (let i = 0; i < dark.length; i++) sums[i + 1] = sums[i]! + dark[i]!;
  const passesAt = (i: number): number => {
    const from = Math.max(0, i - SMOOTH);
    const to = Math.min(dark.length, i + SMOOTH + 1);
    const mean = (sums[to]! - sums[from]!) / (to - from);
    return LEVELS.find((level) => mean > level.above)!.passes;
  };

  // Cut the path into runs of one pressure. Neighbouring runs share their end point.
  const runs: Array<{ from: number; to: number; passes: number }> = [];
  let start = 0;
  let passes = passesAt(0);
  for (let i = 1; i < path.length; i++) {
    const here = passesAt(i);
    if (here !== passes && i - start >= MIN_RUN) {
      runs.push({ from: start, to: i - 1, passes });
      start = i - 1;
      passes = here;
    }
  }
  runs.push({ from: start, to: path.length - 1, passes });

  const out: Point[] = [path[0]!];
  const round = (v: number, max: number): number => Math.round(Math.max(0, Math.min(max, v)) * 10) / 10;
  for (const run of runs) {
    for (let pass = 0; pass < run.passes; pass++) {
      // Passes alternate to either side of the true line, a little further out each time: 0, +1, -1, +2, -2.
      const offset = Math.ceil(pass / 2) * (pass % 2 === 1 ? 1 : -1) * SPREAD;
      const forward = pass % 2 === 0;
      for (let step = 1; step <= run.to - run.from; step++) {
        const i = forward ? run.from + step : run.to - step;
        const [x, y] = path[i]!;
        // Every pass meets the true line at both ends of the run, so the passes join up.
        if (offset === 0 || i === run.from || i === run.to) {
          out.push([x, y]);
          continue;
        }
        const [ax, ay] = path[i - 1]!;
        const [bx, by] = path[i + 1]!;
        const length = Math.hypot(bx - ax, by - ay) || 1;
        out.push([round(x - ((by - ay) / length) * offset, CANVAS.width), round(y + ((bx - ax) / length) * offset, CANVAS.height)]);
      }
    }
  }
  return out;
}
