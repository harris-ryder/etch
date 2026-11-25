import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Dependencies are hoisted to the monorepo root by Bun workspaces.
  turbopack: { root: path.join(__dirname, "..") },
  agentRules: false,
};

export default config;
