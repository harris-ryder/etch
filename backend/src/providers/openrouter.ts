import type { Scene, Style } from "../types";
import { withRejection, type ImageResult, type SceneImageGenerator } from "../pipeline/image";
import { imagePromptFor } from "../pipeline/style";
import { OpenAIScenePlanner, postJson, readImage, readUsage, type ApiUsage } from "./openai";

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  /** Any chat model slug from openrouter.ai/models, e.g. "openai/gpt-6-luna". */
  textModel: string;
  /** Any slug from GET /api/v1/images/models, e.g. "openai/gpt-image-2". */
  imageModel: string;
  /** Sent as `quality` when set. Only some image models accept it. */
  imageQuality?: string;
}

/** Shown on OpenRouter's dashboard next to this app's requests. */
const HEADERS = { "X-Title": "etch" };

/** Landscape, the closest common ratio to the 10:7 screen. */
const ASPECT = "3:2";

interface ImagesResponse {
  usage?: ApiUsage;
  data?: Array<{ b64_json?: string; url?: string; media_type?: string }>;
}

/**
 * Scene planner through OpenRouter's chat-completions API. JSON mode is left
 * off because not every model behind OpenRouter supports it; the JSON object
 * is pulled out of the reply and validated instead.
 */
export class OpenRouterScenePlanner extends OpenAIScenePlanner {
  constructor(config: OpenRouterConfig) {
    super({ apiKey: config.apiKey, baseUrl: config.baseUrl, textModel: config.textModel, jsonMode: false, headers: HEADERS }, "openrouter");
  }
}

/** The finished picture through OpenRouter's Image API (`POST /api/v1/images`). */
export class OpenRouterImageGenerator implements SceneImageGenerator {
  constructor(private readonly config: OpenRouterConfig) {}

  async generate(scene: Scene, style: Style): Promise<ImageResult> {
    const prompt = imagePromptFor(scene.prompt, style);
    const payload = await withRejection(() =>
      postJson<ImagesResponse>({ ...this.config, headers: HEADERS }, "/images", {
        model: this.config.imageModel,
        prompt,
        aspect_ratio: ASPECT,
        ...(this.config.imageQuality ? { quality: this.config.imageQuality } : {}),
      }),
    );
    return {
      image: await readImage(payload.data?.[0]),
      receipt: {
        provider: "openrouter",
        model: this.config.imageModel,
        prompt,
        shape: ASPECT,
        quality: this.config.imageQuality,
        usage: readUsage(payload.usage),
      },
    };
  }
}
