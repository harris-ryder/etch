import { Hono } from "hono";
import { createApp } from "@etch/backend";

/**
 * The whole backend, served by Next. Every request under /api is handed to
 * the Hono app from the backend package, so the site and its API ship as one
 * deployment on the same origin (no CORS, no separate API address).
 */

// sharp needs Node, not the edge runtime.
export const runtime = "nodejs";
// One drawing plans a scene and generates several images; allow it the time.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Built on the first request rather than at import, so the API key is read
// from the running server's environment and not at build time.
let app: Hono | undefined;

function handler(request: Request): Response | Promise<Response> {
  // The backend's own routes are /health and /draw; this puts them under /api.
  app ??= new Hono().route("/api", createApp({ corsOrigins: [] }));
  return app.fetch(request);
}

export { handler as GET, handler as POST, handler as OPTIONS };
