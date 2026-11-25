import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The API runs inside Next (app/api/[...route]). Locally its settings, the model
// API key among them, still live in backend/.env, the one place the standalone
// backend and the preview script read too. On Vercel that file does not exist and
// the same variables come from the project's settings.
const backendEnv = path.join(__dirname, "..", "backend", ".env");
if (existsSync(backendEnv)) process.loadEnvFile(backendEnv);

const root = path.join(__dirname, "..");

const config: NextConfig = {
  // Dependencies are hoisted to the monorepo root by Bun workspaces.
  turbopack: { root },
  outputFileTracingRoot: root,
  // The backend package is TypeScript source, compiled as part of this app.
  transpilePackages: ["@etch/backend"],
  agentRules: false,
};

export default config;
