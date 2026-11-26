import type { Scene, Style, Usage } from "../types";
import { withRejection, type ImageResult, type SceneImageGenerator } from "../pipeline/image";
import { MAX_PARTS, normaliseScene, type PlanOptions, type PlanResult, type ScenePlanner } from "../pipeline/planner";
import { HOUSE_STYLE_BRIEF, imagePromptFor } from "../pipeline/style";

export interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  /** `low`, `medium` or `high`. Higher means finer linework, and a slower, dearer image. */
  imageQuality: string;
  /** Ask for JSON mode. Turn off for gateways or models that reject `response_format`. */
  jsonMode?: boolean;
  /** Extra request headers (for example OpenRouter's app attribution). */
  headers?: Record<string, string>;
}

const PLANNER_INSTRUCTIONS = `You are an artist planning a drawing of someone's dream for an Etch A Sketch.
The machine draws ONE continuous line and can never lift its pen. An image model will draw the whole picture once, as a single finished image, and that image is then traced. You write the description of that picture, and you say which regions of it to draw first.

Every drawing is made in the same house style, which is added to your description afterwards: ${HOUSE_STYLE_BRIEF}. Compose for that style. Do not describe style, medium, colour or line quality yourself.

Reply with JSON only, in exactly this shape:
{
  "title": string,      // an evocative short title for the dream
  "prompt": string,     // the description of the WHOLE picture (see below)
  "parts": [            // the regions of that picture, in the order they should be drawn
    {
      "id": string,     // unique kebab-case id
      "name": string,   // one to three words, e.g. "dunes", "sandcastle", "two moons"
      "bbox": { "x": number, "y": number, "w": number, "h": number }, // where it sits in the picture: normalised 0..1, origin top-left, landscape sheet
      "narration": string // one sentence in a literary storyteller's voice, shown while this part draws
    }
  ]
}

The "prompt" (5 to 8 sentences):
- Do not illustrate the dream literally. Find its one essential image and say it with as few things as possible: an abstraction, a distillation, closer to a symbol or a gesture than to a scene. Leave things out. A dream of a city on an elephant's back is a great curved back with a few towers growing out of it like hairs, not an inventory of buildings.
- Describe ONE picture, composed as a whole on a landscape sheet: what the main form is and how large (it should be large, and can run off an edge), where each other thing sits relative to it (left, right, above, behind, far off), and what is left as empty paper. Be exact about placement, because your boxes below must match it.
- Say how the forms flow into each other, since everything is one line: what the ground line becomes, what grows out of what, which shapes share an edge. Nothing should float unconnected.
- Honour the specifics of the dream. If it says Mars, there are craters and two moons. Never fall back on a generic house, tree and sun.
- No text, lettering, borders or frames.

The "parts":
- Use 3 to ${MAX_PARTS}. They are regions of the same picture, not separate images, and are only used to decide the order of drawing and what the storyteller says. Order them so the drawing unfolds like a story: the ground or setting first, then the main form, then the details.
- Together the boxes should cover everything in the picture. The setting's box can span the whole sheet; give each other thing a tighter box around where your description puts it. Where boxes overlap, the smaller box takes that area.
- Keep every box inside the sheet (x + w <= 1, y + h <= 1) and at least 0.15 wide and tall.`;

/** Added to the dream when the image model's safety filter refused the first description. */
const GENTLER_NOTE = `An image model refused to draw your last description of this dream. Describe it again so that it will be accepted: keep the feeling and the essential image, but suggest rather than show. Nothing violent, bloody, sexual or frightening in the wording; no weapons, wounds, nudity or drugs; no real people, brands or named characters. Turn anything like that into a plain object, a shape or an absence.`;

export interface ApiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
}

/** Normalises the usage block that OpenAI-style APIs return. */
export function readUsage(usage: ApiUsage | undefined): Usage | undefined {
  if (!usage) return undefined;
  const out: Usage = {};
  const input = usage.prompt_tokens ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.output_tokens;
  if (typeof input === "number") out.inputTokens = input;
  if (typeof output === "number") out.outputTokens = output;
  if (typeof usage.cost === "number") out.costUsd = usage.cost;
  return Object.keys(out).length > 0 ? out : undefined;
}

interface ChatResponse {
  usage?: ApiUsage;
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

interface ImageResponse {
  usage?: ApiUsage;
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
}

/**
 * Pulls the JSON object out of a model reply, tolerating code fences or a
 * sentence of preamble from models that are not in strict JSON mode.
 */
export function extractJson(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The planner reply contained no JSON object.");
  return JSON.parse(content.slice(start, end + 1)) as unknown;
}

type ApiConfig = Pick<OpenAIConfig, "apiKey" | "baseUrl" | "headers">;

export async function postJson<T>(config: ApiConfig, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}`, ...config.headers },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(`${new URL(config.baseUrl).hostname} ${path} failed (${response.status}): ${payload.error?.message ?? response.statusText}`);
  }
  return payload;
}

/**
 * Scene planner for any OpenAI-compatible chat-completions API (OpenAI,
 * OpenRouter, a local llama.cpp server). The reply is validated with zod.
 */
export class OpenAIScenePlanner implements ScenePlanner {
  constructor(
    private readonly config: Pick<OpenAIConfig, "apiKey" | "baseUrl" | "textModel" | "jsonMode" | "headers">,
    private readonly provider = "openai",
  ) {}

  async plan(text: string, options: PlanOptions = {}): Promise<PlanResult> {
    const user = `The dream:\n${text}${options.gentler ? `\n\n${GENTLER_NOTE}` : ""}`;
    let lastError: unknown;
    // The model occasionally returns a shape zod rejects; one retry is usually enough.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const payload = await postJson<ChatResponse>(this.config, "/chat/completions", {
        model: this.config.textModel,
        ...(this.config.jsonMode === false ? {} : { response_format: { type: "json_object" } }),
        messages: [
          { role: "system", content: PLANNER_INSTRUCTIONS },
          { role: "user", content: user },
        ],
      });
      const content = payload.choices?.[0]?.message?.content;
      try {
        if (!content) throw new Error("The planner returned an empty reply.");
        const scene = normaliseScene(extractJson(content));
        return {
          scene,
          receipt: {
            provider: this.provider,
            model: this.config.textModel,
            system: PLANNER_INSTRUCTIONS,
            user,
            reply: content,
            attempts: attempt,
            usage: readUsage(payload.usage),
          },
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`The scene planner did not return a usable scene: ${String(lastError)}`);
  }
}

/** Reads the bytes out of an images-API reply, whichever way they were returned. */
export async function readImage(first: { b64_json?: string; url?: string } | undefined): Promise<Uint8Array> {
  if (first?.b64_json) return new Uint8Array(Buffer.from(first.b64_json, "base64"));
  if (first?.url) {
    const response = await fetch(first.url);
    if (!response.ok) throw new Error("Could not download the image the model made.");
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error("The image model returned nothing.");
}

/** Landscape, the closest the Images API has to the 10:7 screen. */
const SIZE = "1536x1024";

/** The finished picture from the OpenAI Images API. */
export class OpenAIImageGenerator implements SceneImageGenerator {
  constructor(private readonly config: OpenAIConfig) {}

  async generate(scene: Scene, style: Style): Promise<ImageResult> {
    const prompt = imagePromptFor(scene.prompt, style);
    const payload = await withRejection(() =>
      postJson<ImageResponse>(this.config, "/images/generations", {
        model: this.config.imageModel,
        prompt,
        size: SIZE,
        quality: this.config.imageQuality,
        n: 1,
      }),
    );
    return {
      image: await readImage(payload.data?.[0]),
      receipt: {
        provider: "openai",
        model: this.config.imageModel,
        prompt,
        shape: SIZE,
        quality: this.config.imageQuality,
        usage: readUsage(payload.usage),
      },
    };
  }
}
