/**
 * Runs the pipeline on a text prompt and writes an SVG to stdout.
 *
 *   bun scripts/preview.ts "a house by the sea under the moon" > out.svg
 *   bun scripts/preview.ts --style hatch --gcode "a mountain" > out.gcode
 *   bun scripts/preview.ts --image picture.webp "a mountain" > out.svg   (also saves the generated picture)
 */
import { providersFromEnv } from "../src/config";
import { toGcode } from "../src/geometry/gcode";
import type { Point } from "../src/geometry/types";
import { runPipeline } from "../src/pipeline/run";
import { CANVAS, StyleSchema, type Style } from "../src/types";

const args = process.argv.slice(2);
let styleOverride: Style | undefined;
let gcode = false;
let imageOut: string | undefined;
const words: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--style") styleOverride = StyleSchema.parse(args[++i]);
  else if (arg === "--gcode") gcode = true;
  else if (arg === "--image") imageOut = args[++i];
  else words.push(arg);
}
const text = words.join(" ").trim();
if (!text) {
  console.error('Usage: bun scripts/preview.ts [--style line|tsp|hatch|spiral] [--gcode] [--image file.webp] "dream text"');
  process.exit(1);
}

const providers = providersFromEnv();
if (!providers) {
  console.error("No model provider is configured. Set OPENROUTER_API_KEY (or OPENAI_API_KEY) in backend/.env.");
  process.exit(1);
}
const all: Point[] = [];
const layers: string[] = [];
const connectors: string[] = [];
const toPath = (points: readonly Point[]): string => points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");

for await (const event of runPipeline({ text, styleOverride }, providers)) {
  if (event.type === "plan") {
    console.error(`planner: ${event.model}, ${event.durationMs} ms`);
  } else if (event.type === "scene") {
    console.error(`scene: ${event.scene.title} (${event.scene.parts.map((p) => p.name).join(", ")})`);
    console.error(`picture: ${event.scene.prompt}`);
  } else if (event.type === "image") {
    console.error(`image: ${event.model}, ${event.width}x${event.height}, ${event.durationMs} ms${event.usage?.costUsd !== undefined ? `, $${event.usage.costUsd}` : ""}`);
    // Keep the source picture next to the tracing, to compare the two.
    if (imageOut) await Bun.write(imageOut, Buffer.from(event.image.slice(event.image.indexOf(",") + 1), "base64"));
  } else if (event.type === "part") {
    console.error(`part: ${event.name} — ${event.points.length} points, connector ${event.connector.length} points`);
    if (event.connector.length > 0) connectors.push(toPath(event.connector));
    layers.push(toPath(event.points));
    // The connector ends where the part starts, so skip the duplicate point.
    all.push(...event.connector.slice(0, -1), ...event.points);
  } else if (event.type === "error") {
    console.error(`error: ${event.message}`);
    process.exit(1);
  }
}

if (gcode) {
  process.stdout.write(toGcode(all));
} else {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" width="${CANVAS.width}" height="${CANVAS.height}">`,
    `<rect width="100%" height="100%" fill="#c9cbc8"/>`,
    ...connectors.map((d) => `<path d="${d}" fill="none" stroke="#c0392b" stroke-width="1.5" stroke-linejoin="round"/>`),
    ...layers.map((d) => `<path d="${d}" fill="none" stroke="#2b2b2e" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`),
    `</svg>`,
  ];
  process.stdout.write(svg.join("\n") + "\n");
}
