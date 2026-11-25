import type { Point } from "./types";

export interface GcodeOptions {
  /** Width of the virtual canvas the points live in. */
  canvasWidth?: number;
  canvasHeight?: number;
  /** Physical drawable width of the screen in millimetres. */
  screenWidthMm?: number;
  screenHeightMm?: number;
  /** Feed rate in mm/min. */
  feedRate?: number;
  /**
   * Backlash take-up in millimetres. Whenever an axis reverses direction the
   * knob has to turn this much further before the stylus actually moves, so a
   * take-up move is emitted and later targets on that axis are shifted.
   */
  reversalCompensation?: number;
  /** Decimal places in the output. */
  precision?: number;
  /** Emit the `G21`/`G90` preamble. */
  header?: boolean;
}

/**
 * Converts canvas points into G-code for a two-axis machine (X = left knob,
 * Y = right knob). Output is absolute millimetres with the origin at the
 * bottom-left of the screen, so canvas Y (which grows downwards) is flipped.
 * Every move is a `G1`: an Etch A Sketch cannot lift its pen, so there are no
 * rapid moves.
 */
export function toGcode(points: readonly Point[], opts: GcodeOptions = {}): string {
  const {
    canvasWidth = 1000,
    canvasHeight = 700,
    screenWidthMm = 160,
    screenHeightMm = 112,
    feedRate = 1200,
    reversalCompensation = 0,
    precision = 3,
    header = true,
  } = opts;

  const lines: string[] = [];
  if (header) lines.push("G21 ; millimetres", "G90 ; absolute positioning");

  const fmt = (value: number): string => {
    const text = value.toFixed(precision);
    // Avoid "-0.000".
    return Number(text) === 0 ? (0).toFixed(precision) : text;
  };
  const emit = (x: number, y: number): void => {
    lines.push(`G1 X${fmt(x)} Y${fmt(y)} F${feedRate}`);
  };

  // Direction each axis last moved in. Both start "positive", matching a
  // machine that was homed by moving towards +X/+Y.
  let directionX = 1;
  let directionY = 1;
  // Offset currently applied to commanded positions to hold the slack taken up.
  let offsetX = 0;
  let offsetY = 0;
  let previous: Point | null = null;

  for (const [cx, cy] of points) {
    const x = (cx / canvasWidth) * screenWidthMm;
    const y = (1 - cy / canvasHeight) * screenHeightMm;
    if (previous) {
      const dx = x - previous[0];
      const dy = y - previous[1];
      if (dx === 0 && dy === 0) continue;

      if (reversalCompensation !== 0) {
        let reversed = false;
        if (dx !== 0 && Math.sign(dx) !== directionX) {
          directionX = Math.sign(dx);
          offsetX = directionX > 0 ? 0 : -reversalCompensation;
          reversed = true;
        }
        if (dy !== 0 && Math.sign(dy) !== directionY) {
          directionY = Math.sign(dy);
          offsetY = directionY > 0 ? 0 : -reversalCompensation;
          reversed = true;
        }
        // Take up the slack in place before drawing the next segment.
        if (reversed) emit(previous[0] + offsetX, previous[1] + offsetY);
      }
    }
    emit(x + offsetX, y + offsetY);
    previous = [x, y];
  }

  return lines.join("\n") + "\n";
}
