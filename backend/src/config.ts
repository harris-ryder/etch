import type { PipelineDeps } from "./pipeline/run";
import { OpenAIImageGenerator, OpenAIScenePlanner, type OpenAIConfig } from "./providers/openai";
import { OpenRouterImageGenerator, OpenRouterScenePlanner, type OpenRouterConfig } from "./providers/openrouter";

export type ProviderName = "openrouter" | "openai";

export interface Providers extends PipelineDeps {
  name: ProviderName;
  /** The models in use, for display. */
  models: { text: string; image: string };
}

/**
 * Picks the planner and image generator from the environment. This is the one
 * place to register a new provider.
 *
 * `ETCH_PROVIDER=auto` (the default) uses OpenRouter if `OPENROUTER_API_KEY`
 * is set, then OpenAI if `OPENAI_API_KEY` is set. With no key there is nothing
 * to draw with, and this returns null.
 */
export function providersFromEnv(env: Record<string, string | undefined> = process.env): Providers | null {
  const requested = (env.ETCH_PROVIDER ?? "auto").toLowerCase();
  const value = (name: string): string | undefined => env[name]?.trim() || undefined;
  const openRouterKey = value("OPENROUTER_API_KEY");
  const openAiKey = value("OPENAI_API_KEY");

  if (requested === "openrouter" && !openRouterKey) {
    throw new Error("ETCH_PROVIDER=openrouter needs OPENROUTER_API_KEY to be set (see backend/.env.example).");
  }
  if (requested === "openai" && !openAiKey) {
    throw new Error("ETCH_PROVIDER=openai needs OPENAI_API_KEY to be set (see backend/.env.example).");
  }

  if (requested === "openrouter" || (requested === "auto" && openRouterKey)) {
    const imageModel = value("OPENROUTER_IMAGE_MODEL") ?? "krea/krea-2-medium-turbo";
    const config: OpenRouterConfig = {
      apiKey: openRouterKey!,
      baseUrl: value("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
      textModel: value("OPENROUTER_TEXT_MODEL") ?? "openai/gpt-6-luna",
      imageModel,
      // Only the OpenAI image models are known to take `quality`; set the variable to force it elsewhere.
      imageQuality: value("OPENROUTER_IMAGE_QUALITY") ?? (imageModel.startsWith("openai/") ? "medium" : undefined),
    };
    return {
      name: "openrouter",
      models: { text: config.textModel, image: config.imageModel },
      planner: new OpenRouterScenePlanner(config),
      images: new OpenRouterImageGenerator(config),
    };
  }

  if (requested === "openai" || (requested === "auto" && openAiKey)) {
    const config: OpenAIConfig = {
      apiKey: openAiKey!,
      baseUrl: value("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
      textModel: value("OPENAI_TEXT_MODEL") ?? "gpt-4.1-mini",
      imageModel: value("OPENAI_IMAGE_MODEL") ?? "gpt-image-1",
      imageQuality: value("OPENAI_IMAGE_QUALITY") ?? "medium",
    };
    return {
      name: "openai",
      models: { text: config.textModel, image: config.imageModel },
      planner: new OpenAIScenePlanner(config),
      images: new OpenAIImageGenerator(config),
    };
  }

  return null;
}
