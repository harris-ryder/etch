import { z } from "zod";

/** The fixed virtual canvas every path is expressed in (Etch A Sketch screen ratio). */
export const CANVAS = { width: 1000, height: 700 } as const;

export const StyleSchema = z.enum(["line", "tsp", "hatch", "spiral"]);
export type Style = z.infer<typeof StyleSchema>;

export const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type BBox = z.infer<typeof BBoxSchema>;

/** One region of the finished picture, drawn and narrated as a unit. */
export const PartSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Where this part sits in the picture: normalised 0..1, origin top-left. */
  bbox: BBoxSchema,
  narration: z.string(),
});
export type Part = z.infer<typeof PartSchema>;

export const SceneSchema = z.object({
  title: z.string(),
  /** The planner's description of the whole picture, sent to the image model with the house style added. */
  prompt: z.string().min(1),
  /** The picture's regions, in the order they are drawn. */
  parts: z.array(PartSchema).min(1),
});
export type Scene = z.infer<typeof SceneSchema>;

export const DrawRequestSchema = z.object({
  text: z.string().trim().min(1, "Describe a dream first.").max(2000),
  styleOverride: StyleSchema.optional(),
});
export type DrawRequest = z.infer<typeof DrawRequestSchema>;

export type CanvasPoint = [number, number];

/** Token counts and cost for one model call, when the provider reports them. */
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** Receipt for the scene-planner call: exactly what was sent and what came back. */
export interface PlanReceipt {
  provider: string;
  model: string;
  /** The instructions sent as the system message. */
  system: string;
  /** The user message (the dream). */
  user: string;
  /** The model's raw reply, before validation and tidying. */
  reply: string;
  /** 1 normally; 2 if the first reply failed validation and was retried. */
  attempts: number;
  durationMs: number;
  usage?: Usage;
}

/** Receipt for the image-model call that makes the one finished picture. */
export interface ImageReceipt {
  provider: string;
  model: string;
  /** The full prompt sent to the image model. */
  prompt: string;
  /** The shape requested, e.g. "3:2" or "1536x1024". */
  shape: string;
  quality?: string;
  durationMs: number;
  /** Size of the image the model returned, in pixels. */
  width: number;
  height: number;
  /** A reduced WebP copy of the returned image, as a data URL. */
  image: string;
  usage?: Usage;
}

/** What splitting, tracing and linking did for one part of the picture. */
export interface PartTrace {
  style: Style;
  /** Working raster size in pixels (the whole picture). */
  raster: [number, number];
  /** Ink pixels of the picture that fell to this part. */
  ink: number;
  /** What the tracer saw: a PNG data URL of the picture with everything outside this part blanked. */
  seen: string;
  points: number;
  /** Length of the traced path in canvas units. */
  length: number;
  traceMs: number;
  /** The move from the previous part: distance retraced over old lines, then the straight hop. */
  link: { points: number; retraced: number; hop: number };
}

export type DrawEvent =
  | ({ type: "plan" } & PlanReceipt)
  | { type: "scene"; scene: Scene }
  | ({ type: "image" } & ImageReceipt)
  | {
      type: "part";
      partId: string;
      name: string;
      narration: string;
      /** This part of the drawing, as one continuous polyline in canvas units. Firm strokes are gone over several times. */
      points: CanvasPoint[];
      /** The move from the end of the previous part to `points[0]` (empty for the first part). */
      connector: CanvasPoint[];
      trace: PartTrace;
    }
  | { type: "done"; durationMs: number }
  | { type: "error"; message: string };
