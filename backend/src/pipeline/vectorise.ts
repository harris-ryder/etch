import { connectComponents } from "../geometry/connect";
import { eulerWalk } from "../geometry/euler";
import { buildSkeletonGraph, pruneSpurs, refineEdges, type Graph } from "../geometry/graph";
import { hatchPath } from "../geometry/hatch";
import { rdp } from "../geometry/rdp";
import { thresholdImage } from "../geometry/otsu";
import { zhangSuen } from "../geometry/skeleton";
import { spiralPath } from "../geometry/spiral";
import { stipple } from "../geometry/stipple";
import { tspPath } from "../geometry/tsp";
import type { Bitmap, Point } from "../geometry/types";
import type { Part, Style } from "../types";
import { assignPixels } from "./compose";
import type { Raster } from "./raster";

/** `line`: skeleton -> graph -> one walk over every edge. */
export function traceLine(mask: Bitmap, epsilon = 0.5, minComponent = 3, minSpur = 4): Point[] {
  const skeleton = zhangSuen(mask);
  const { bitmap } = connectComponents(skeleton, minComponent);
  const graph = pruneSpurs(buildSkeletonGraph(bitmap), minSpur);
  return eulerWalk(refineEdges(graph, (points) => rdp(points, epsilon)));
}

/**
 * `hatch`: tonal cross-hatching. Everything darker than a light grey gets one
 * set of diagonal lines; the darkest areas get a second set across the first,
 * so shadows read darker than mid-tones. A plain black silhouette simply ends
 * up cross-hatched all over.
 */
export function crossHatch(raster: Raster, spacing: number): Point[] {
  let light = thresholdImage(raster.grey, 120);
  if (!light.data.includes(1)) light = raster.mask;
  const dark = thresholdImage(raster.grey, 55);
  const first = hatchPath(light, { spacing, angleDeg: 45 });
  const second = hatchPath(dark, { spacing, angleDeg: 135 });
  // End-to-start is drawn, like every other move, so pick the nearer end of the second pass.
  const tail = first[first.length - 1];
  if (tail && second.length > 1) {
    const head = second[0]!;
    const end = second[second.length - 1]!;
    if (Math.hypot(end[0] - tail[0], end[1] - tail[1]) < Math.hypot(head[0] - tail[0], head[1] - tail[1])) second.reverse();
  }
  return [...first, ...second];
}

/** Stage 4b: one continuous path in source-pixel coordinates for the chosen style. */
export function rasterToPath(raster: Raster, style: Style): Point[] {
  // Tunings are written for a 512 px raster and scale with it.
  const k = Math.max(raster.mask.width, raster.mask.height) / 512;
  switch (style) {
    case "line":
      // Already smoothed and simplified edge by edge.
      return traceLine(raster.mask, 0.6 * k, Math.round(6 * k), 6 * k);
    case "tsp":
      return tspPath(stipple(raster.grey, { minPoints: 800, maxPoints: 3500, inkPerPoint: 8 * k * k }), { timeBudgetMs: 2000 });
    case "hatch":
      return crossHatch(raster, 7 * k);
    case "spiral":
      return rdp(spiralPath(raster.grey, raster.mask, { spacing: 7 * k, wavelength: 4.5 * k, step: 0.9 * k }), 0.3 * k);
  }
}

/**
 * `line`, for a picture divided into parts.
 *
 * The whole picture is traced into ONE graph first, so no stroke is cut where
 * two parts meet. Each stroke is then given to the part it mostly lies in.
 * Where a part's strokes are not joined to each other, or to what has already
 * been drawn, the gap is closed by walking along other real lines of the
 * picture (they simply get drawn a little early) rather than by inventing a
 * straight line across blank paper. So the only lines on the screen are lines
 * of the picture.
 *
 * Returns one closed walk per part, in source-pixel coordinates (empty when a
 * part has nothing left to draw). Each walk after the first passes through a
 * point that is already drawn, which is where the pen enters it.
 */
export function traceLineParts(mask: Bitmap, parts: readonly Part[]): Point[][] {
  const k = Math.max(mask.width, mask.height) / 512;
  const { bitmap } = connectComponents(zhangSuen(mask), Math.round(4 * k));
  const graph: Graph = refineEdges(pruneSpurs(buildSkeletonGraph(bitmap), 2.5 * k), (points) => rdp(points, 0.2 * k));
  const { nodes, edges } = graph;

  const owner = assignPixels(mask.width, mask.height, parts);
  const clampTo = (v: number, max: number): number => Math.max(0, Math.min(max, Math.round(v)));
  const edgePart = edges.map((edge) => {
    const [x, y] = edge.points[edge.points.length >> 1]!;
    return owner[clampTo(y, mask.height - 1) * mask.width + clampTo(x, mask.width - 1)]!;
  });

  const incident: number[][] = nodes.map(() => []);
  edges.forEach((edge, i) => {
    incident[edge.a]!.push(i);
    if (edge.b !== edge.a) incident[edge.b]!.push(i);
  });

  const drawnEdge = new Uint8Array(edges.length);
  const drawnNode = new Uint8Array(nodes.length);
  let anythingDrawn = false;

  return parts.map((_, p) => {
    const mine = new Uint8Array(edges.length);
    let left = 0;
    edges.forEach((__, i) => {
      if (edgePart[i] === p && !drawnEdge[i]) {
        mine[i] = 1;
        left++;
      }
    });
    if (left === 0) return [];

    const walk = new Set<number>();
    const reached = new Uint8Array(nodes.length);

    /** Takes every one of this part's strokes that can be reached from `node` along this part's strokes. */
    const absorb = (node: number): void => {
      const stack = [node];
      reached[node] = 1;
      while (stack.length > 0) {
        const u = stack.pop()!;
        for (const ei of incident[u]!) {
          if (!mine[ei]) continue;
          mine[ei] = 0;
          left--;
          walk.add(ei);
          const edge = edges[ei]!;
          for (const v of [edge.a, edge.b]) {
            if (!reached[v]) {
              reached[v] = 1;
              stack.push(v);
            }
          }
        }
      }
    };

    /**
     * Finds the shortest way, along the picture's own lines, from any node in
     * `sources` to the nearest stroke this part still wants, and takes every
     * line on that way into the walk (drawing some of them early, or again).
     */
    const reach = (sources: Uint8Array): boolean => {
      const distance = new Float64Array(nodes.length).fill(Infinity);
      const via = new Int32Array(nodes.length).fill(-1);
      const settled = new Uint8Array(nodes.length);
      const queue: Array<[number, number]> = [];
      for (let n = 0; n < nodes.length; n++) {
        if (sources[n]) {
          distance[n] = 0;
          queue.push([0, n]);
        }
      }
      let target = -1;
      while (queue.length > 0) {
        // A plain scan for the minimum is fast enough for a few thousand nodes.
        let at = 0;
        for (let i = 1; i < queue.length; i++) if (queue[i]![0] < queue[at]![0]) at = i;
        const [d, u] = queue.splice(at, 1)[0]!;
        if (settled[u]) continue;
        settled[u] = 1;
        if (incident[u]!.some((ei) => mine[ei])) {
          target = u;
          break;
        }
        for (const ei of incident[u]!) {
          const edge = edges[ei]!;
          const v = edge.a === u ? edge.b : edge.a;
          const nd = d + edge.length;
          if (nd < distance[v]!) {
            distance[v] = nd;
            via[v] = ei;
            queue.push([nd, v]);
          }
        }
      }
      if (target < 0) return false;
      let node = target;
      while (!sources[node]) {
        const ei = via[node]!;
        walk.add(ei);
        if (mine[ei]) {
          mine[ei] = 0;
          left--;
        }
        reached[node] = 1;
        const edge = edges[ei]!;
        node = edge.a === node ? edge.b : edge.a;
      }
      reached[node] = 1;
      absorb(target);
      return true;
    };

    // Begin at the drawing so far (so the pen can walk straight in), or anywhere for the first part.
    if (!anythingDrawn || !reach(drawnNode)) absorb(edges[mine.indexOf(1)]!.a);
    // Then keep gathering until every stroke of this part is in one joined-up walk.
    while (left > 0) {
      // Cannot fail while the picture is one connected graph, but never loop for ever.
      if (!reach(reached)) absorb(edges[mine.indexOf(1)]!.a);
    }

    for (const ei of walk) {
      drawnEdge[ei] = 1;
      drawnNode[edges[ei]!.a] = 1;
      drawnNode[edges[ei]!.b] = 1;
    }
    anythingDrawn = true;
    return eulerWalk({ nodes, edges: [...walk].map((ei) => edges[ei]!) }, { circuit: true });
  });
}
