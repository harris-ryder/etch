import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { dist, type Point } from "../src/geometry/types";
import { applyPlacement, assignPixels, canvasPlacement, splitIntoParts } from "../src/pipeline/compose";
import { HOUSE_STYLE } from "../src/pipeline/style";
import { Linker } from "../src/pipeline/link";
import { normaliseScene } from "../src/pipeline/planner";
import { providersFromEnv } from "../src/config";
import { extractJson } from "../src/providers/openai";
import { OpenRouterImageGenerator, OpenRouterScenePlanner } from "../src/providers/openrouter";
import { CANVAS, type DrawEvent } from "../src/types";
import { blank, fillRect, inkCount, stubProviders } from "./helpers";

describe("Linker", () => {
  test("the first layer has no connector", () => {
    const linker = new Linker();
    const { points, connector } = linker.add([
      [0, 0],
      [100, 0],
    ]);
    expect(connector).toEqual([]);
    expect(points.length).toBe(2);
  });

  test("starts the next layer from whichever end is nearer", () => {
    const linker = new Linker();
    linker.add([
      [0, 0],
      [100, 0],
    ]);
    const { points, connector } = linker.add([
      [300, 50],
      [110, 10],
    ]);
    expect(points[0]).toEqual([110, 10]);
    expect(connector[0]).toEqual([100, 0]);
    expect(connector[connector.length - 1]).toEqual([110, 10]);
  });

  test("retraces existing lines rather than cutting straight across", () => {
    const linker = new Linker();
    // A long horizontal line, drawn left to right and back, so the stylus is at the left end.
    linker.add([
      [0, 0],
      [500, 0],
      [0, 0],
    ]);
    // The new layer hangs just under the right end.
    const { connector } = linker.add([
      [500, 20],
      [500, 120],
    ]);
    // Route: back along the old line to (500, 0), then a 20-unit hop.
    expect(connector).toEqual([
      [0, 0],
      [500, 0],
      [500, 20],
    ]);
  });

  test("rotates a closed layer to start at its nearest vertex", () => {
    const linker = new Linker();
    linker.add([
      [0, 0],
      [100, 0],
    ]);
    const square: Point[] = [
      [300, 0],
      [300, 100],
      [120, 100],
      [120, 0],
      [300, 0],
    ];
    const { points, connector } = linker.add(square);
    expect(points[0]).toEqual([120, 0]);
    expect(points[points.length - 1]).toEqual([120, 0]);
    expect(points.length).toBe(5);
    expect(connector).toEqual([
      [100, 0],
      [120, 0],
    ]);
  });
});

describe("provider selection", () => {
  test("auto prefers OpenRouter, then OpenAI, and there is no fallback without a key", () => {
    expect(providersFromEnv({})).toBeNull();
    expect(providersFromEnv({ OPENAI_API_KEY: "k" })!.name).toBe("openai");
    const both = providersFromEnv({ OPENAI_API_KEY: "k", OPENROUTER_API_KEY: "k" })!;
    expect(both.name).toBe("openrouter");
    expect(both.models).toEqual({ text: "anthropic/claude-sonnet-5.5", image: "openai/gpt-image-2" });
    expect(providersFromEnv({ OPENAI_API_KEY: "k", OPENROUTER_API_KEY: "k", ETCH_PROVIDER: "openai" })!.name).toBe("openai");
    expect(() => providersFromEnv({ ETCH_PROVIDER: "openrouter" })).toThrow();
  });

  test("extractJson tolerates code fences and preamble", () => {
    expect(extractJson('Here you go:\n```json\n{"title":"t","layers":[]}\n```')).toEqual({ title: "t", layers: [] });
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("OpenRouter providers (stubbed network)", () => {
  const config = { apiKey: "test-key", baseUrl: "https://openrouter.test/api/v1", textModel: "some/chat", imageModel: "some/image", imageQuality: "medium" };
  const realFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const stub = (reply: unknown): void => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as typeof fetch;
  };

  test("the planner posts to chat/completions without JSON mode and parses the scene", async () => {
    calls.length = 0;
    const scene = { title: "Mars", prompt: "a castle of sand", parts: [{ id: "a", name: "dunes", bbox: { x: 0, y: 0.5, w: 1, h: 0.5 }, narration: "n" }] };
    stub({ choices: [{ message: { content: "```json\n" + JSON.stringify(scene) + "\n```" } }], usage: { prompt_tokens: 900, completion_tokens: 300, cost: 0.004 } });
    try {
      const planned = await new OpenRouterScenePlanner(config).plan("sand castles on mars");
      expect(planned.scene.parts[0]!.name).toBe("dunes");
      expect(planned.scene.prompt).toBe("a castle of sand");
      expect(planned.receipt).toMatchObject({ provider: "openrouter", model: "some/chat", attempts: 1, usage: { inputTokens: 900, outputTokens: 300, costUsd: 0.004 } });
      expect(planned.receipt.user).toContain("sand castles on mars");
      expect(planned.receipt.system.length).toBeGreaterThan(200);
      expect(planned.receipt.reply).toContain("dunes");
      expect(calls[0]!.url).toBe("https://openrouter.test/api/v1/chat/completions");
      expect(calls[0]!.headers.Authorization).toBe("Bearer test-key");
      expect(calls[0]!.body.model).toBe("some/chat");
      expect(calls[0]!.body.response_format).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("the image generator posts to /images and decodes base64", async () => {
    calls.length = 0;
    stub({ data: [{ b64_json: Buffer.from("png-bytes").toString("base64"), media_type: "image/png" }], usage: { completion_tokens: 4000, cost: 0.04 } });
    try {
      const scene = { title: "t", prompt: "rolling dunes", parts: [{ id: "a", name: "dunes", bbox: { x: 0, y: 0, w: 1, h: 1 }, narration: "" }] };
      const { image: bytes, receipt } = await new OpenRouterImageGenerator(config).generate(scene, "line");
      expect(Buffer.from(bytes).toString()).toBe("png-bytes");
      expect(receipt).toMatchObject({ provider: "openrouter", model: "some/image", shape: "3:2", quality: "medium", usage: { outputTokens: 4000, costUsd: 0.04 } });
      expect(receipt.prompt).toContain("rolling dunes");
      // The house style is added to whatever the planner described.
      expect(receipt.prompt).toContain(HOUSE_STYLE);
      expect(calls[0]!.url).toBe("https://openrouter.test/api/v1/images");
      expect(calls[0]!.body).toMatchObject({ model: "some/image", aspect_ratio: "3:2", quality: "medium" });
      expect(String(calls[0]!.body.prompt)).toContain("rolling dunes");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("composition", () => {
  const part = (id: string, x: number, y: number, w: number, h: number) => ({ id, name: id, bbox: { x, y, w, h }, narration: "" });

  test("the whole picture is fitted inside the canvas and centred", () => {
    const mask = blank(300, 200);
    const placement = canvasPlacement({ grey: { width: 300, height: 200, data: new Uint8Array(60000) }, mask });
    // 3:2 into 10:7: the width fills the canvas and the height is centred.
    expect(placement.scaleX).toBeCloseTo(CANVAS.width / 300, 5);
    expect(placement.scaleY).toBe(placement.scaleX);
    expect(placement.offsetX).toBeCloseTo(0, 5);
    expect(placement.offsetY).toBeCloseTo((CANVAS.height - 200 * placement.scaleX) / 2, 5);
    expect(applyPlacement([[0, 0], [300, 200]], placement)).toEqual([[0, 16.7], [1000, 683.3]]);
  });

  test("a pixel goes to the smallest box holding it, or the nearest box if none does", () => {
    const parts = [part("setting", 0, 0, 1, 1), part("subject", 0.4, 0.4, 0.2, 0.2)];
    const owner = assignPixels(100, 100, parts);
    expect(owner[50 * 100 + 50]).toBe(1);
    expect(owner[10 * 100 + 10]).toBe(0);

    const gap = assignPixels(100, 100, [part("left", 0, 0, 0.3, 1), part("right", 0.7, 0, 0.3, 1)]);
    expect(gap[50 * 100 + 40]).toBe(0);
    expect(gap[50 * 100 + 60]).toBe(1);
  });

  test("splitting loses no ink and shares none", () => {
    const mask = blank(100, 100);
    fillRect(mask, 10, 45, 89, 55);
    const grey = new Uint8Array(10000).fill(255);
    mask.data.forEach((v, i) => {
      if (v) grey[i] = 0;
    });
    const pieces = splitIntoParts({ grey: { width: 100, height: 100, data: grey }, mask }, [part("setting", 0, 0, 1, 1), part("subject", 0.4, 0.4, 0.2, 0.2)]);
    expect(inkCount(pieces[0]!.mask) + inkCount(pieces[1]!.mask)).toBe(inkCount(mask));
    expect(inkCount(pieces[1]!.mask)).toBeGreaterThan(0);
    for (let i = 0; i < 10000; i++) expect(pieces[0]!.mask.data[i]! + pieces[1]!.mask.data[i]!).toBeLessThanOrEqual(1);
  });
});

describe("normaliseScene", () => {
  test("clamps boxes, caps parts and de-duplicates ids", () => {
    const one = { id: "a", name: "a", bbox: { x: 0.9, y: -1, w: 0.5, h: 3 }, narration: "" };
    const scene = normaliseScene({ title: "t", prompt: "p", parts: Array.from({ length: 9 }, () => one) });
    expect(scene.parts.length).toBe(6);
    expect(new Set(scene.parts.map((p) => p.id)).size).toBe(6);
    for (const p of scene.parts) {
      expect(p.bbox.x + p.bbox.w).toBeLessThanOrEqual(1);
      expect(p.bbox.y).toBe(0);
      expect(p.bbox.h).toBe(1);
    }
  });

  test("rejects malformed scenes", () => {
    expect(() => normaliseScene({ title: "t", prompt: "p", parts: [] })).toThrow();
    expect(() => normaliseScene({ title: "t", parts: [{ id: "a", name: "a", bbox: { x: 0, y: 0, w: 1, h: 1 }, narration: "" }] })).toThrow();
    expect(() => normaliseScene({ title: "t", prompt: "p", parts: [{ id: "a" }] })).toThrow();
  });
});

describe("POST /draw (stubbed providers)", () => {
  const app = createApp({ providers: stubProviders() });

  async function draw(body: unknown, target = app): Promise<{ status: number; events: DrawEvent[]; error?: string }> {
    const response = await target.request("/draw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (response.status !== 200) return { status: response.status, events: [], error: (JSON.parse(text) as { error: string }).error };
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as DrawEvent);
    return { status: response.status, events };
  }

  test("streams plan, scene, one image, then the parts in order, then done, as one unbroken line", async () => {
    const { status, events } = await draw({ text: "three shapes" });
    expect(status).toBe(200);
    expect(events.map((e) => e.type)).toEqual(["plan", "scene", "image", "part", "part", "part", "done"]);

    const scene = events[1]!.type === "scene" ? events[1]!.scene : null;
    const parts = events.flatMap((e) => (e.type === "part" ? [e] : []));
    expect(scene!.parts.map((p) => p.id)).toEqual(parts.map((p) => p.partId));

    let pen: Point | null = null;
    for (const part of parts) {
      expect(part.points.length).toBeGreaterThan(2);
      for (const [x, y] of [...part.points, ...part.connector]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(CANVAS.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(CANVAS.height);
      }
      if (pen) {
        // The pen never lifts: the connector starts where the last part ended and ends where this one starts.
        expect(part.connector.length).toBeGreaterThanOrEqual(2);
        expect(dist(part.connector[0]!, pen)).toBeLessThan(1.5);
        expect(part.connector[part.connector.length - 1]).toEqual(part.points[0]!);
      } else {
        expect(part.connector).toEqual([]);
      }
      pen = part.points[part.points.length - 1]!;
    }
    // Each part is drawn where the picture has it: left, middle, right.
    const centreX = parts.map((p) => p.points.reduce((sum, [x]) => sum + x, 0) / p.points.length);
    expect(centreX[0]!).toBeLessThan(340);
    expect(centreX[1]!).toBeGreaterThan(340);
    expect(centreX[1]!).toBeLessThan(670);
    expect(centreX[2]!).toBeGreaterThan(670);
  });

  test("every step leaves a receipt", async () => {
    const { events } = await draw({ text: "three shapes" });
    const plan = events.find((e) => e.type === "plan");
    expect(plan).toMatchObject({ model: "stub/planner", system: "instructions", user: "three shapes", attempts: 1, usage: { inputTokens: 10, outputTokens: 20 } });
    expect(plan?.type === "plan" && plan.durationMs).toBeGreaterThanOrEqual(0);

    const images = events.flatMap((e) => (e.type === "image" ? [e] : []));
    expect(images.length).toBe(1);
    expect(images[0]).toMatchObject({ model: "stub/image", shape: "3:2", width: 1536, height: 1024, prompt: "a picture of three shapes / line", usage: { costUsd: 0.01 } });
    expect(images[0]!.image).toStartWith("data:image/webp;base64,");

    const parts = events.flatMap((e) => (e.type === "part" ? [e] : []));
    for (const part of parts) {
      const { trace } = part;
      expect(trace.style).toBe("line");
      expect(trace.raster).toEqual([1024, 683]);
      expect(trace.points).toBe(part.points.length);
      expect(trace.length).toBeGreaterThan(100);
      expect(trace.ink).toBeGreaterThan(0);
      expect(trace.seen).toStartWith("data:image/png;base64,");
      expect(trace.link.points).toBe(part.connector.length);
    }
    expect(parts[0]!.trace.link).toEqual({ points: 0, retraced: 0, hop: 0 });

    const done = events[events.length - 1]!;
    expect(done.type === "done" && done.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("styleOverride changes how the picture is traced and what is asked of the image model", async () => {
    const { events } = await draw({ text: "shapes", styleOverride: "hatch" });
    expect(events.flatMap((e) => (e.type === "part" ? [e.trace.style] : []))).toEqual(["hatch", "hatch", "hatch"]);
    expect(events.flatMap((e) => (e.type === "image" ? [e.prompt] : []))).toEqual(["a picture of shapes / hatch"]);
  });

  test("rejects an empty dream and an unknown style", async () => {
    expect((await draw({ text: "   " })).status).toBe(400);
    expect((await draw({ text: "a cat", styleOverride: "crayon" })).status).toBe(400);
  });

  test("with no provider configured, drawing fails with a clear message and health says so", async () => {
    const bare = createApp({ providers: null });
    const result = await draw({ text: "a cat" }, bare);
    expect(result.status).toBe(503);
    expect(result.error).toContain("OPENROUTER_API_KEY");
    expect(await (await bare.request("/health")).json()).toEqual({ ok: true, provider: null, models: null });
  });

  test("GET /health", async () => {
    const response = await app.request("/health");
    expect(await response.json()).toEqual({ ok: true, provider: "openrouter", models: { text: "stub/planner", image: "stub/image" } });
  });

  test("allows the frontend origin", async () => {
    const response = await app.request("/health", { headers: { Origin: "http://localhost:3000" } });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });
});
