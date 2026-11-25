import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { providersFromEnv, type Providers } from "./config";
import { textInput } from "./pipeline/input";
import { runPipeline } from "./pipeline/run";
import { DrawRequestSchema } from "./types";

export type {
  CanvasPoint,
  DrawEvent,
  DrawRequest,
  ImageReceipt,
  Part,
  PartTrace,
  PlanReceipt,
  Scene,
  Style,
  Usage,
} from "./types";

export const NO_PROVIDER =
  "No model provider is configured. Set OPENROUTER_API_KEY (or OPENAI_API_KEY) in backend/.env and restart.";

export interface AppOptions {
  /** Pass null to run with no model provider (every draw then fails with a clear message). */
  providers?: Providers | null;
  corsOrigins?: string[];
}

/**
 * Builds the HTTP app. The routes are chained so that `AppType` carries every
 * path, input and output type across to the frontend's `hc<AppType>()` client.
 */
export function createApp(options: AppOptions = {}) {
  const providers = options.providers === undefined ? providersFromEnv() : options.providers;
  const origins = options.corsOrigins ?? ["http://localhost:3000", "http://127.0.0.1:3000"];

  return new Hono()
    .use("*", cors({ origin: origins }))
    .get("/health", (c) => c.json({ ok: true as const, provider: providers?.name ?? null, models: providers?.models ?? null }))
    .post(
      "/draw",
      zValidator("json", DrawRequestSchema, (result, c) => {
        if (!result.success) {
          return c.json({ error: result.error.issues[0]?.message ?? "Invalid request." }, 400);
        }
      }),
      (c) => {
        const body = c.req.valid("json");
        if (!providers) return c.json({ error: NO_PROVIDER }, 503);

        c.header("Content-Type", "application/x-ndjson; charset=utf-8");
        c.header("Cache-Control", "no-store");
        c.header("X-Accel-Buffering", "no");

        // One JSON event per line, flushed as soon as each is ready.
        return stream(c, async (out) => {
          let aborted = false;
          out.onAbort(() => {
            aborted = true;
          });
          const text = await textInput(body.text).toText();
          const events = runPipeline({ text, styleOverride: body.styleOverride }, providers);
          for await (const event of events) {
            if (aborted) break;
            await out.write(`${JSON.stringify(event)}\n`);
          }
        });
      },
    );
}

export type AppType = ReturnType<typeof createApp>;
