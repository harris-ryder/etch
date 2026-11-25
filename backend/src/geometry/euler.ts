import type { Graph } from "./graph";
import { dist, type Point } from "./types";

interface Half {
  /** Index into the multigraph's edge-instance list. */
  instance: number;
  to: number;
}

/** A minimal binary min-heap of `[priority, value]` pairs. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent]! <= keys[i]!) break;
      [keys[parent], keys[i]] = [keys[i]!, keys[parent]!];
      [values[parent], values[i]] = [values[i]!, values[parent]!];
      i = parent;
    }
  }

  pop(): [number, number] {
    const { keys, values } = this;
    const top: [number, number] = [keys[0]!, values[0]!];
    const lastKey = keys.pop()!;
    const lastValue = values.pop()!;
    if (keys.length > 0) {
      keys[0] = lastKey;
      values[0] = lastValue;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < keys.length && keys[l]! < keys[smallest]!) smallest = l;
        if (r < keys.length && keys[r]! < keys[smallest]!) smallest = r;
        if (smallest === i) break;
        [keys[smallest], keys[i]] = [keys[i]!, keys[smallest]!];
        [values[smallest], values[i]] = [values[i]!, values[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

export interface ShortestPaths {
  distance: Float64Array;
  /** The edge used to reach each node (-1 for the source or unreachable nodes). */
  viaEdge: Int32Array;
}

/** Dijkstra over the graph's edges, weighted by edge length. */
export function shortestPaths(graph: Graph, source: number): ShortestPaths {
  const n = graph.nodes.length;
  const incident: number[][] = Array.from({ length: n }, () => []);
  graph.edges.forEach((e, i) => {
    incident[e.a]!.push(i);
    if (e.b !== e.a) incident[e.b]!.push(i);
  });

  const distance = new Float64Array(n).fill(Infinity);
  const viaEdge = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  distance[source] = 0;
  heap.push(0, source);
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (d > distance[u]!) continue;
    for (const ei of incident[u]!) {
      const e = graph.edges[ei]!;
      const v = e.a === u ? e.b : e.a;
      const nd = d + e.length;
      if (nd < distance[v]!) {
        distance[v] = nd;
        viaEdge[v] = ei;
        heap.push(nd, v);
      }
    }
  }
  return { distance, viaEdge };
}

/**
 * Chooses which edges to draw twice so that the graph has an Euler path.
 *
 * Odd-degree nodes are paired greedily, closest pair first (distance measured
 * along the graph, since the pen cannot leave the lines), and the edges on
 * each pair's shortest route are duplicated. The single most expensive pair is
 * left unmatched: an Euler *path* is allowed two odd nodes, which become its
 * start and end. This is a cheap approximation of the Chinese postman problem.
 *
 * To stay fast on dense drawings with thousands of junctions, each odd node
 * only searches outwards until it has found a handful of other unmatched odd
 * nodes; anything still unmatched after a round searches again.
 *
 * Returns the indices of the edges to duplicate (an edge may appear more than once).
 */
export function chooseDuplicateEdges(graph: Graph, neighboursPerNode = 6, circuit = false): number[] {
  const n = graph.nodes.length;
  const incident: number[][] = Array.from({ length: n }, () => []);
  graph.edges.forEach((e, i) => {
    incident[e.a]!.push(i);
    if (e.b !== e.a) incident[e.b]!.push(i);
  });
  const isOdd = new Uint8Array(n);
  let oddCount = 0;
  for (let i = 0; i < n; i++) {
    // A self-loop appears once in `incident` but adds two to the degree, so it never changes parity.
    let degree = 0;
    for (const ei of incident[i]!) degree += graph.edges[ei]!.a === graph.edges[ei]!.b ? 2 : 1;
    if (degree % 2 === 1) {
      isOdd[i] = 1;
      oddCount++;
    }
  }
  if (oddCount === 0 || (!circuit && oddCount <= 2)) return [];

  // Scratch space shared by every search; `stamp` says which search a value belongs to.
  const distance = new Float64Array(n);
  const viaEdge = new Int32Array(n);
  const stamp = new Int32Array(n);
  const settled = new Int32Array(n);
  let generation = 0;

  /** Dijkstra from `source` that stops once `accept` has said yes `limit` times. */
  const search = (source: number, limit: number, accept: (node: number) => boolean): Array<{ node: number; cost: number }> => {
    generation++;
    const found: Array<{ node: number; cost: number }> = [];
    const heap = new MinHeap();
    distance[source] = 0;
    viaEdge[source] = -1;
    stamp[source] = generation;
    heap.push(0, source);
    while (heap.size > 0) {
      const [d, u] = heap.pop();
      if (settled[u] === generation || d > distance[u]!) continue;
      settled[u] = generation;
      if (u !== source && accept(u)) {
        found.push({ node: u, cost: d });
        if (found.length >= limit) break;
      }
      for (const ei of incident[u]!) {
        const e = graph.edges[ei]!;
        const v = e.a === u ? e.b : e.a;
        const nd = d + e.length;
        if (stamp[v] !== generation || nd < distance[v]!) {
          stamp[v] = generation;
          distance[v] = nd;
          viaEdge[v] = ei;
          heap.push(nd, v);
        }
      }
    }
    return found;
  };

  const unmatched = new Uint8Array(isOdd);
  const pairs: Array<{ a: number; b: number; cost: number }> = [];
  let remaining = oddCount;
  while (remaining > 0) {
    const candidates: Array<{ a: number; b: number; cost: number }> = [];
    for (let a = 0; a < n; a++) {
      if (!unmatched[a]) continue;
      for (const { node, cost } of search(a, neighboursPerNode, (v) => unmatched[v] === 1)) {
        if (a < node || !unmatched[node]) candidates.push({ a, b: node, cost });
        else candidates.push({ a: node, b: a, cost });
      }
    }
    if (candidates.length === 0) break;
    candidates.sort((p, q) => p.cost - q.cost);
    for (const c of candidates) {
      if (!unmatched[c.a] || !unmatched[c.b]) continue;
      unmatched[c.a] = 0;
      unmatched[c.b] = 0;
      remaining -= 2;
      pairs.push(c);
    }
  }

  // Leave the dearest pair unmatched: those two nodes become the ends of the path.
  // A circuit has no ends, so there every pair is matched.
  pairs.sort((p, q) => p.cost - q.cost);
  if (!circuit) pairs.pop();

  const duplicates: number[] = [];
  for (const { a, b } of pairs) {
    search(a, 1, (v) => v === b);
    let node = b;
    while (node !== a) {
      const ei = viaEdge[node]!;
      const e = graph.edges[ei]!;
      duplicates.push(ei);
      node = e.a === node ? e.b : e.a;
    }
  }
  return duplicates;
}

/** Splits the graph's edges into connected groups (isolated nodes are ignored). */
function edgeComponents(graph: Graph): number[][] {
  const parent = graph.nodes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (const e of graph.edges) parent[find(e.a)] = find(e.b);
  const groups = new Map<number, number[]>();
  graph.edges.forEach((e, i) => {
    const root = find(e.a);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  });
  return [...groups.values()];
}

/** Hierholzer's algorithm on one connected multigraph. Returns the walk as points. */
function walkComponent(graph: Graph, circuit: boolean): Point[] {
  const duplicates = chooseDuplicateEdges(graph, 6, circuit);
  const instances: number[] = [...graph.edges.keys(), ...duplicates];

  const incident: Half[][] = Array.from({ length: graph.nodes.length }, () => []);
  instances.forEach((ei, instance) => {
    const e = graph.edges[ei]!;
    incident[e.a]!.push({ instance, to: e.b });
    incident[e.b]!.push({ instance, to: e.a });
  });

  let start = graph.edges[0]!.a;
  for (let i = 0; i < incident.length; i++) {
    if (incident[i]!.length % 2 === 1) {
      start = i;
      break;
    }
  }

  const used = new Uint8Array(instances.length);
  const cursor = new Int32Array(graph.nodes.length);
  const stack: Array<{ node: number; from: number; instance: number }> = [{ node: start, from: -1, instance: -1 }];
  const finished: Array<{ node: number; from: number; instance: number }> = [];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const list = incident[top.node]!;
    let advanced = false;
    while (cursor[top.node]! < list.length) {
      const half = list[cursor[top.node]!++]!;
      if (used[half.instance]) continue;
      used[half.instance] = 1;
      stack.push({ node: half.to, from: top.node, instance: half.instance });
      advanced = true;
      break;
    }
    if (!advanced) finished.push(stack.pop()!);
  }
  finished.reverse();

  const out: Point[] = [graph.nodes[start]!];
  for (const step of finished) {
    if (step.instance < 0) continue;
    const e = graph.edges[instances[step.instance]!]!;
    const forward = e.a === step.from && e.b === step.node;
    const points = forward ? e.points : [...e.points].reverse();
    for (let i = 1; i < points.length; i++) out.push(points[i]!);
  }
  return out;
}

/**
 * One continuous walk that covers every edge of the graph at least once.
 *
 * Each connected piece is walked with Hierholzer's algorithm after duplicating
 * the fewest edges needed for an Euler path to exist. If the graph is not
 * connected the pieces are chained nearest-first with straight joins, so the
 * result is always a single polyline.
 *
 * With `circuit`, each piece is walked as a closed loop that ends where it
 * began (at the cost of drawing a little more twice). A loop can be entered at
 * any of its points, which is what lets one part of a drawing be joined to the
 * last without a jump.
 */
export function eulerWalk(graph: Graph, options: { circuit?: boolean } = {}): Point[] {
  if (graph.edges.length === 0) return [];
  const walks = edgeComponents(graph).map((edgeIndices) =>
    walkComponent({ nodes: graph.nodes, edges: edgeIndices.map((i) => graph.edges[i]!) }, options.circuit ?? false),
  );
  walks.sort((p, q) => q.length - p.length);

  const out = walks.shift()!;
  while (walks.length > 0) {
    const tail = out[out.length - 1]!;
    let best = 0;
    let bestReversed = false;
    let bestDistance = Infinity;
    walks.forEach((walk, i) => {
      const toStart = dist(tail, walk[0]!);
      const toEnd = dist(tail, walk[walk.length - 1]!);
      if (toStart < bestDistance) {
        bestDistance = toStart;
        best = i;
        bestReversed = false;
      }
      if (toEnd < bestDistance) {
        bestDistance = toEnd;
        best = i;
        bestReversed = true;
      }
    });
    const [next] = walks.splice(best, 1);
    out.push(...(bestReversed ? next!.reverse() : next!));
  }
  return out;
}
