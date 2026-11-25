import { SceneSchema, type PlanReceipt, type Scene } from "../types";

/** Stage 2: turns dream text into a description of one picture, and the parts to draw it in. */
export interface ScenePlanner {
  plan(text: string): Promise<PlanResult>;
}

export interface PlanResult {
  scene: Scene;
  /** Everything about the call except how long it took, which the pipeline measures. */
  receipt: Omit<PlanReceipt, "durationMs">;
}

export const MAX_PARTS = 6;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Validates and tidies whatever a planner produced: at most six parts,
 * unique ids, boxes clamped onto the picture.
 */
export function normaliseScene(raw: unknown): Scene {
  const scene = SceneSchema.parse(raw);
  const seen = new Set<string>();
  const parts = scene.parts.slice(0, MAX_PARTS).map((part, index) => {
    let id = part.id;
    while (seen.has(id)) id = `${part.id}-${index}`;
    seen.add(id);
    const w = clamp(part.bbox.w, 0.05, 1);
    const h = clamp(part.bbox.h, 0.05, 1);
    const x = clamp(part.bbox.x, 0, 1 - w);
    const y = clamp(part.bbox.y, 0, 1 - h);
    return { ...part, id, bbox: { x, y, w, h } };
  });
  return { title: scene.title, prompt: scene.prompt, parts };
}
