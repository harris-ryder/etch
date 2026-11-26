import sharp from "sharp";
import { pathLength } from "../geometry/types";
import type { DrawEvent, PartTrace, Style } from "../types";
import { applyPlacement, canvasPlacement, splitIntoParts } from "./compose";
import { ImageRejectedError, type ImageResult, type SceneImageGenerator } from "./image";
import { Linker } from "./link";
import type { ScenePlanner } from "./planner";
import { pressPath } from "./pressure";
import { loadRaster, RASTER_SIZE, SKETCH_SIZE, type Raster } from "./raster";
import { rasterToPath, traceLineParts } from "./vectorise";

export interface PipelineDeps {
  planner: ScenePlanner;
  images: SceneImageGenerator;
}

export interface PipelineRequest {
  text: string;
  /** How the picture is turned into line. `line` unless asked otherwise. */
  styleOverride?: Style;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A reduced copy of the generated image for the receipt, so events stay small. */
async function thumbnail(image: Uint8Array): Promise<{ url: string; width: number; height: number }> {
  const source = sharp(image);
  const { width = 0, height = 0 } = await source.metadata();
  const webp = await source.resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return { url: `data:image/webp;base64,${webp.toString("base64")}`, width, height };
}

/** The greyscale image the tracer worked from, as a PNG data URL. */
async function seenImage(raster: Raster): Promise<string> {
  const { width, height, data } = raster.grey;
  const png = await sharp(Buffer.from(data), { raw: { width, height, channels: 1 } })
    .resize(640, 640, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function inkCount(raster: Raster): number {
  let total = 0;
  for (const v of raster.mask.data) total += v;
  return total;
}

/**
 * Runs the whole pipeline and yields events as they become ready.
 *
 * The planner describes ONE picture and names its parts. The image model draws
 * that picture once, finished, in the house style. The picture is then divided
 * into the planner's parts, and each part is traced, linked to the last and
 * emitted in order, so the drawing still unfolds a part at a time.
 *
 * Every step also reports a receipt of what it did: the planner call (`plan`),
 * the image call (`image`), and what splitting, tracing and linking did for
 * each part (`part.trace`). Nothing is stored: the only output is the stream.
 */
export async function* runPipeline(request: PipelineRequest, deps: PipelineDeps): AsyncGenerator<DrawEvent> {
  const started = performance.now();
  try {
    const style: Style = request.styleOverride ?? "line";

    const planStarted = performance.now();
    let { scene, receipt: planReceipt } = await deps.planner.plan(request.text);
    yield { type: "plan", ...planReceipt, durationMs: Math.round(performance.now() - planStarted) };
    yield { type: "scene", scene };

    let imageStarted = performance.now();
    let result: ImageResult;
    try {
      result = await deps.images.generate(scene, style);
    } catch (error) {
      if (!(error instanceof ImageRejectedError)) throw error;
      // The image model's safety filter refused the description. Plan the dream once
      // more, gently, and try again; the new plan replaces the first on the receipt.
      const replanStarted = performance.now();
      ({ scene, receipt: planReceipt } = await deps.planner.plan(request.text, { gentler: true }));
      yield { type: "plan", ...planReceipt, durationMs: Math.round(performance.now() - replanStarted) };
      yield { type: "scene", scene };
      imageStarted = performance.now();
      result = await deps.images.generate(scene, style);
    }
    const { image, receipt } = result;
    const imageMs = Math.round(performance.now() - imageStarted);
    // A line drawing is a pencil sketch: it needs a finer raster and a mask that keeps its faint strokes.
    const [raster, thumb] = await Promise.all([loadRaster(image, style === "line" ? SKETCH_SIZE : RASTER_SIZE, style === "line"), thumbnail(image)]);
    yield { type: "image", ...receipt, durationMs: imageMs, width: thumb.width, height: thumb.height, image: thumb.url };

    const placement = canvasPlacement(raster);
    const pieces = splitIntoParts(raster, scene.parts);
    // Line drawings are traced whole and then shared out, so no stroke is cut at a boundary.
    const traceStarted = performance.now();
    const linePaths = style === "line" ? traceLineParts(raster.mask, scene.parts) : null;
    const lineMs = Math.round(performance.now() - traceStarted);

    const linker = new Linker();
    let drawn = 0;
    for (let i = 0; i < scene.parts.length; i++) {
      const part = scene.parts[i]!;
      const piece = pieces[i]!;
      const ink = inkCount(piece);
      // The image model may have left a region empty; there is then nothing to draw for it.
      if (ink === 0 && !linePaths) continue;
      const partStarted = performance.now();
      const path = applyPlacement(linePaths ? linePaths[i]! : rasterToPath(piece, style), placement);
      // The one whole-picture trace is counted against the first part.
      const traceMs = Math.round(performance.now() - partStarted) + (linePaths && drawn === 0 ? lineMs : 0);
      if (path.length < 2) continue;
      const linked = linker.add(path);
      const { connector } = linked;
      // The pencil pressed harder in some places than others. The pen cannot, so it goes over those places several times.
      const points = style === "line" ? pressPath(linked.points, raster.grey, placement) : linked.points;
      drawn++;

      const connectorLength = pathLength(connector);
      const hop = connector.length >= 2 ? pathLength(connector.slice(-2)) : 0;
      const trace: PartTrace = {
        style,
        raster: [raster.mask.width, raster.mask.height],
        ink,
        seen: await seenImage(piece),
        points: points.length,
        length: Math.round(pathLength(points)),
        traceMs,
        link: { points: connector.length, retraced: Math.round(connectorLength - hop), hop: Math.round(hop) },
      };
      yield { type: "part", partId: part.id, name: part.name, narration: part.narration, points, connector, trace };
    }
    if (drawn === 0) throw new Error("The picture came out blank, so there is nothing to draw.");
    yield { type: "done", durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    yield { type: "error", message: describe(error) };
  }
}
