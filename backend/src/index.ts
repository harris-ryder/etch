import { createApp, NO_PROVIDER } from "./app";
import { providersFromEnv } from "./config";

const providers = providersFromEnv();
const port = Number(process.env.PORT ?? 8787);
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = createApp({ providers, corsOrigins });

console.log(`etch backend on http://localhost:${port}`);
if (providers) console.log(`provider: ${providers.name}, planner: ${providers.models.text}, images: ${providers.models.image}`);
else console.warn(NO_PROVIDER);

export default {
  port,
  fetch: app.fetch,
  // Image generation can leave the stream silent for a while; do not let Bun cut it off.
  idleTimeout: 255,
};
