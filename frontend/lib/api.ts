import { hc } from "hono/client";
import type { AppType, DrawEvent, Style } from "@etch/backend";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/**
 * Hono RPC client. `AppType` comes straight from the backend's route
 * definitions, so paths, request bodies and query params are checked at
 * compile time on both sides.
 */
export const api = hc<AppType>(API_URL);

export interface DrawInput {
  text: string;
  styleOverride?: Style;
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return fallback;
}

/** Calls `POST /draw` and yields each NDJSON event as it arrives. */
export async function* streamDraw(input: DrawInput, signal: AbortSignal): AsyncGenerator<DrawEvent> {
  const response = await api.draw.$post(
    { json: { text: input.text, styleOverride: input.styleOverride } },
    { init: { signal } },
  );

  if (!response.ok || !response.body) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(errorMessage(body, `The backend answered ${response.status}.`));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as DrawEvent;
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest) as DrawEvent;
}

export async function fetchHealth(signal?: AbortSignal) {
  const response = await api.health.$get({}, { init: { signal } });
  return response.json();
}
