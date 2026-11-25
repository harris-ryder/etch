import { dist, type Point } from "../geometry/types";

/**
 * Stage 5: layer linking.
 *
 * Keeps a graph of everything drawn so far (vertices snapped to a 1-unit grid
 * so lines that meet share a vertex) and works out how to get the stylus from
 * where it is to the next layer without lifting it.
 */
export class Linker {
  private readonly vertices: Point[] = [];
  private readonly lookup = new Map<number, number>();
  private readonly neighbours: Array<Map<number, number>> = [];
  private current: number | null = null;

  /**
   * Retracing an existing line costs this fraction of drawing a fresh one.
   * Below 1 the router prefers a longer trip over old lines to a short new
   * scratch across the picture.
   */
  constructor(private readonly retraceCost = 0.3) {}

  /** Where the stylus is now, or null before anything has been drawn. */
  get position(): Point | null {
    return this.current === null ? null : this.vertices[this.current]!;
  }

  private vertex(p: Point): number {
    const key = Math.round(p[0]) * 4096 + Math.round(p[1]);
    let id = this.lookup.get(key);
    if (id === undefined) {
      id = this.vertices.length;
      this.vertices.push(p);
      this.neighbours.push(new Map());
      this.lookup.set(key, id);
    }
    return id;
  }

  private record(points: readonly Point[]): void {
    let previous: number | null = null;
    for (const p of points) {
      const id = this.vertex(p);
      if (previous !== null && previous !== id) {
        const length = dist(this.vertices[previous]!, this.vertices[id]!);
        this.neighbours[previous]!.set(id, length);
        this.neighbours[id]!.set(previous, length);
      }
      previous = id;
    }
    if (previous !== null) this.current = previous;
  }

  /**
   * Adds a layer. Picks where on the layer to start (either end of an open
   * path, or any vertex of a closed one), routes there over existing lines
   * plus one straight hop, and returns the re-ordered layer and the connector.
   */
  add(path: readonly Point[]): { points: Point[]; connector: Point[] } {
    if (path.length === 0) return { points: [], connector: [] };
    if (this.current === null) {
      const points = path.map((p) => [p[0], p[1]] as Point);
      this.record(points);
      return { points, connector: [] };
    }

    const closed = path.length > 3 && dist(path[0]!, path[path.length - 1]!) < 1.5;
    let candidates: number[];
    if (closed) {
      // Fine enough to land on a point that is already drawn, when the loop passes through one.
      const stride = Math.max(1, Math.ceil(path.length / 4096));
      candidates = [];
      for (let i = 0; i < path.length - 1; i += stride) candidates.push(i);
    } else {
      candidates = [0, path.length - 1];
    }

    const { distance, previous } = this.shortestFromCurrent();
    let bestCost = Infinity;
    let bestVertex = this.current;
    let bestCandidate = candidates[0]!;
    for (let v = 0; v < this.vertices.length; v++) {
      const along = distance[v]!;
      if (!Number.isFinite(along)) continue;
      const base = along * this.retraceCost;
      if (base >= bestCost) continue;
      for (const c of candidates) {
        const cost = base + dist(this.vertices[v]!, path[c]!);
        if (cost < bestCost) {
          bestCost = cost;
          bestVertex = v;
          bestCandidate = c;
        }
      }
    }

    const route: Point[] = [];
    for (let v = bestVertex; v !== -1; v = previous[v]!) route.push(this.vertices[v]!);
    route.reverse();

    let points: Point[];
    if (closed) {
      const loop = path.slice(0, -1);
      points = [...loop.slice(bestCandidate), ...loop.slice(0, bestCandidate), loop[bestCandidate]!];
    } else {
      points = bestCandidate === 0 ? [...path] : [...path].reverse();
    }
    points = points.map((p) => [p[0], p[1]] as Point);

    const connector: Point[] = [];
    for (const p of [...route, points[0]!]) {
      const last = connector[connector.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) connector.push([p[0], p[1]]);
    }

    this.record(connector);
    this.record(points);
    return { points, connector: connector.length > 1 ? connector : [] };
  }

  /** Dijkstra from the stylus over everything drawn so far. */
  private shortestFromCurrent(): { distance: Float64Array; previous: Int32Array } {
    const n = this.vertices.length;
    const distance = new Float64Array(n).fill(Infinity);
    const previous = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    // Binary heap of [distance, vertex], stored flat.
    const heap: Array<[number, number]> = [];
    const push = (item: [number, number]): void => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent]![0] <= heap[i]![0]) break;
        [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
        i = parent;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let smallest = i;
          if (l < heap.length && heap[l]![0] < heap[smallest]![0]) smallest = l;
          if (r < heap.length && heap[r]![0] < heap[smallest]![0]) smallest = r;
          if (smallest === i) break;
          [heap[smallest], heap[i]] = [heap[i]!, heap[smallest]!];
          i = smallest;
        }
      }
      return top;
    };

    const source = this.current!;
    distance[source] = 0;
    push([0, source]);
    while (heap.length > 0) {
      const [d, u] = pop();
      if (done[u]) continue;
      done[u] = 1;
      for (const [v, length] of this.neighbours[u]!) {
        const nd = d + length;
        if (nd < distance[v]!) {
          distance[v] = nd;
          previous[v] = u;
          push([nd, v]);
        }
      }
    }
    return { distance, previous };
  }
}
