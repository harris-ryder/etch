import type { CanvasPoint } from "@etch/backend";

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 700;
/** Backing-store pixels per canvas unit, so the line stays crisp when the toy is large. */
const RESOLUTION = 2;
/** Knob rotation per canvas unit travelled: one full turn every 100 units. */
const DEGREES_PER_UNIT = 3.6;

export interface Stroke {
  kind: "part" | "connector";
  points: CanvasPoint[];
  partId?: string;
  name?: string;
  narration?: string;
}

export interface EngineElements {
  canvas: HTMLCanvasElement;
  stylus: HTMLElement;
  /** Optional knobs to turn with the pen (left = X, right = Y). */
  knobX?: HTMLElement;
  knobY?: HTMLElement;
}

export interface EngineCallbacks {
  /** A queued stroke has just started drawing. */
  onStrokeStart?: (stroke: Stroke) => void;
  /** The queue has run dry. */
  onIdle?: () => void;
}

/**
 * Draws queued polylines onto the canvas at a steady speed, like a hand on
 * the knobs. It lives outside React on purpose: it mutates the canvas and the
 * stylus directly on every animation frame.
 *
 * The pen never lifts. If a stroke starts somewhere other than where the
 * stylus is (for example after "shake to clear"), the gap is drawn too.
 */
export class EtchEngine {
  private readonly context: CanvasRenderingContext2D;
  private readonly queue: Stroke[] = [];
  private current: { stroke: Stroke; next: number } | null = null;
  private position: CanvasPoint | null = null;
  private frame = 0;
  private lastTime = 0;
  private inked = false;

  /** Canvas units per second. */
  speed = 1500;
  /** Tint connectors so the joins between parts can be told apart. */
  debug = false;

  constructor(
    private readonly elements: EngineElements,
    private readonly callbacks: EngineCallbacks = {},
  ) {
    const { canvas } = elements;
    canvas.width = CANVAS_WIDTH * RESOLUTION;
    canvas.height = CANVAS_HEIGHT * RESOLUTION;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot draw on a canvas.");
    this.context = context;
    context.setTransform(RESOLUTION, 0, 0, RESOLUTION, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 1.1;
  }

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /** True once anything has been drawn since the last clear. */
  get hasInk(): boolean {
    return this.inked;
  }

  enqueue(stroke: Stroke): void {
    if (stroke.points.length === 0) return;
    this.queue.push(stroke);
    if (!this.frame) {
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  /** Stops drawing and forgets anything still queued. The stylus stays where it is. */
  stop(): void {
    this.queue.length = 0;
    this.current = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Wipes the screen. Like the real toy, the stylus keeps its position. */
  clear(): void {
    this.stop();
    this.context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    this.inked = false;
  }

  /**
   * Paints a list of strokes in one go, with no animation. Used to put the
   * picture back when the canvas element has been recreated (a hot reload in
   * development, or React remounting the screen), so a finished drawing is
   * never lost just because the DOM node changed.
   */
  replay(strokes: readonly Stroke[]): void {
    this.clear();
    const context = this.context;
    context.strokeStyle = "#323232";
    let position: CanvasPoint | null = null;
    context.beginPath();
    for (const stroke of strokes) {
      for (const point of stroke.points) {
        if (position) context.lineTo(point[0], point[1]);
        else context.moveTo(point[0], point[1]);
        position = point;
      }
    }
    context.stroke();
    if (position) {
      this.position = position;
      this.inked = true;
      this.updateHardware();
    }
  }

  dispose(): void {
    this.stop();
  }

  private readonly tick = (now: number): void => {
    // Cap the step so a background tab does not come back with one giant leap.
    const elapsed = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    let budget = this.speed * elapsed;

    while (budget > 0) {
      if (!this.current) {
        const stroke = this.queue.shift();
        if (!stroke) break;
        const first = stroke.points[0]!;
        if (!this.position) {
          this.position = first;
          this.current = { stroke, next: 1 };
        } else {
          const gap = Math.hypot(first[0] - this.position[0], first[1] - this.position[1]);
          // Draw the way to the stroke's first point unless we are already there.
          this.current = { stroke, next: gap > 0.5 ? 0 : 1 };
        }
        this.callbacks.onStrokeStart?.(stroke);
      }

      const { stroke } = this.current;
      const context = this.context;
      context.strokeStyle = this.debug && stroke.kind === "connector" ? "#0000ee" : "#323232";
      context.beginPath();
      context.moveTo(this.position![0], this.position![1]);
      while (budget > 0 && this.current.next < stroke.points.length) {
        const target = stroke.points[this.current.next]!;
        const from: CanvasPoint = this.position!;
        const distance = Math.hypot(target[0] - from[0], target[1] - from[1]);
        if (distance <= budget) {
          this.position = target;
          this.current.next++;
          budget -= distance;
        } else {
          const t = budget / distance;
          this.position = [from[0] + (target[0] - from[0]) * t, from[1] + (target[1] - from[1]) * t];
          budget = 0;
        }
        context.lineTo(this.position[0], this.position[1]);
      }
      context.stroke();
      this.inked = true;
      if (this.current.next >= stroke.points.length) this.current = null;
    }

    this.updateHardware();

    if (this.current || this.queue.length > 0) {
      this.frame = requestAnimationFrame(this.tick);
    } else {
      this.frame = 0;
      this.callbacks.onIdle?.();
    }
  };

  /** Moves the stylus dot and turns the knobs to match the pen position. */
  private updateHardware(): void {
    if (!this.position) return;
    const [x, y] = this.position;
    const { stylus, knobX, knobY } = this.elements;
    stylus.style.opacity = "1";
    stylus.style.left = `${(x / CANVAS_WIDTH) * 100}%`;
    stylus.style.top = `${(y / CANVAS_HEIGHT) * 100}%`;
    // Left knob drives X. Right knob drives Y, and turning it clockwise moves the stylus up.
    if (knobX) knobX.style.transform = `rotate(${x * DEGREES_PER_UNIT}deg)`;
    if (knobY) knobY.style.transform = `rotate(${-y * DEGREES_PER_UNIT}deg)`;
  }
}
