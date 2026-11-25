import type { Bitmap, Point } from "./types";

export interface GraphEdge {
  /** Index of the node at the start of `points`. */
  a: number;
  /** Index of the node at the end of `points`. */
  b: number;
  /** The pixel chain from node `a` to node `b`, both ends included. */
  points: Point[];
  length: number;
}

export interface Graph {
  nodes: Point[];
  edges: GraphEdge[];
}

/**
 * Turns a one-pixel-wide skeleton into a graph: nodes at endpoints and
 * junctions, edges as the pixel chains between them. A closed loop with no
 * junction gets one arbitrary node and a self-loop edge.
 */
export function buildSkeletonGraph(bitmap: Bitmap): Graph {
  const { width: w, height: h, data } = bitmap;
  const has = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;

  // Pixel adjacency. A diagonal link is skipped when the two pixels are already
  // joined through an orthogonal neighbour, which removes the tiny triangles
  // that would otherwise turn every corner into a fake junction.
  const adjacency = new Map<number, number[]>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!has(x, y)) continue;
      const list: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (!has(x + dx, y + dy)) continue;
          if (dx !== 0 && dy !== 0 && (has(x + dx, y) || has(x, y + dy))) continue;
          list.push((y + dy) * w + (x + dx));
        }
      }
      adjacency.set(y * w + x, list);
    }
  }

  const toPoint = (i: number): Point => [i % w, Math.floor(i / w)];
  const nodes: Point[] = [];
  const nodeOf = new Map<number, number>();
  const addNode = (pixel: number): number => {
    const id = nodes.length;
    nodes.push(toPoint(pixel));
    nodeOf.set(pixel, id);
    return id;
  };

  for (const [pixel, list] of adjacency) {
    if (list.length !== 2 && list.length !== 0) addNode(pixel);
  }

  const size = w * h;
  const walkedSteps = new Set<number>();
  const interior = new Set<number>();
  const edges: GraphEdge[] = [];

  const trace = (start: number, first: number): void => {
    const chain: number[] = [start, first];
    let prev = start;
    let cur = first;
    while (!nodeOf.has(cur)) {
      interior.add(cur);
      const list = adjacency.get(cur)!;
      const next = list[0] === prev ? list[1]! : list[0]!;
      prev = cur;
      cur = next;
      chain.push(cur);
    }
    walkedSteps.add(start * size + first);
    walkedSteps.add(cur * size + prev);

    const points = chain.map(toPoint);
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
    }
    edges.push({ a: nodeOf.get(start)!, b: nodeOf.get(cur)!, points, length });
  };

  const traceFrom = (pixel: number): void => {
    for (const next of adjacency.get(pixel)!) {
      if (!walkedSteps.has(pixel * size + next)) trace(pixel, next);
    }
  };

  for (const pixel of [...nodeOf.keys()]) traceFrom(pixel);

  // Whatever is left is a pure loop: every pixel has exactly two neighbours.
  for (const [pixel, list] of adjacency) {
    if (list.length !== 2 || interior.has(pixel) || nodeOf.has(pixel)) continue;
    addNode(pixel);
    traceFrom(pixel);
  }

  return { nodes, edges };
}

/** Node degrees. A self-loop counts twice. */
export function nodeDegrees(graph: Graph): number[] {
  const degree = new Array<number>(graph.nodes.length).fill(0);
  for (const e of graph.edges) {
    degree[e.a]!++;
    degree[e.b]!++;
  }
  return degree;
}

/**
 * Removes short dead-end twigs (an artefact of thinning thick strokes).
 * An edge is a twig when one end is a leaf, the other is a real junction,
 * and it is shorter than `minLength`.
 */
export function pruneSpurs(graph: Graph, minLength: number): Graph {
  const degree = nodeDegrees(graph);
  const edges = graph.edges.filter((e) => {
    if (e.length >= minLength || e.a === e.b) return true;
    const leafA = degree[e.a] === 1;
    const leafB = degree[e.b] === 1;
    if (leafA === leafB) return true;
    const junction = leafA ? e.b : e.a;
    return degree[junction]! < 3;
  });
  return { nodes: graph.nodes, edges };
}

/**
 * Smooths the pixel staircase out of every edge and simplifies it, keeping
 * edge endpoints fixed so the graph stays joined up. Doing this per edge
 * (rather than on the final walk) means an edge that is drawn twice follows
 * exactly the same points both times.
 */
export function refineEdges(graph: Graph, simplify: (points: Point[]) => Point[], smoothingPasses = 2): Graph {
  const edges = graph.edges.map((edge) => {
    let points = edge.points;
    for (let pass = 0; pass < smoothingPasses && points.length > 2; pass++) {
      const next: Point[] = [points[0]!];
      for (let i = 1; i < points.length - 1; i++) {
        next.push([
          (points[i - 1]![0] + 2 * points[i]![0] + points[i + 1]![0]) / 4,
          (points[i - 1]![1] + 2 * points[i]![1] + points[i + 1]![1]) / 4,
        ]);
      }
      next.push(points[points.length - 1]!);
      points = next;
    }
    points = simplify(points);
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
    }
    return { a: edge.a, b: edge.b, points, length };
  });
  return { nodes: graph.nodes, edges };
}
