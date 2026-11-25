import { describe, expect, test } from "bun:test";
import { connectComponents, labelComponents } from "../src/geometry/connect";
import { chooseDuplicateEdges, eulerWalk } from "../src/geometry/euler";
import { buildSkeletonGraph, nodeDegrees, pruneSpurs, refineEdges, type Graph } from "../src/geometry/graph";
import { rdp } from "../src/geometry/rdp";
import { bitmapFromRows, pathLength, type Point } from "../src/geometry/types";
import { traceLine } from "../src/pipeline/vectorise";
import { blank, fillRect, inkCount, isContiguous, key } from "./helpers";

const PLUS = bitmapFromRows([
  ".........",
  "....#....",
  "....#....",
  "....#....",
  ".#######.",
  "....#....",
  "....#....",
  "....#....",
  ".........",
]);

const SQUARE = bitmapFromRows([
  ".......",
  ".#####.",
  ".#...#.",
  ".#...#.",
  ".#...#.",
  ".#####.",
  ".......",
]);

function coversAllInk(path: readonly Point[], rows: ReturnType<typeof bitmapFromRows>): boolean {
  const visited = new Set(path.map(key));
  for (let y = 0; y < rows.height; y++) {
    for (let x = 0; x < rows.width; x++) {
      if (rows.data[y * rows.width + x] && !visited.has(`${x},${y}`)) return false;
    }
  }
  return true;
}

describe("buildSkeletonGraph", () => {
  test("a straight line is two endpoints and one edge", () => {
    const graph = buildSkeletonGraph(bitmapFromRows([".......", ".#####.", "......."]));
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0]!.points.length).toBe(5);
    expect(graph.edges[0]!.length).toBe(4);
  });

  test("a plus is one junction with four arms", () => {
    const graph = buildSkeletonGraph(PLUS);
    expect(graph.nodes.length).toBe(5);
    expect(graph.edges.length).toBe(4);
    expect(nodeDegrees(graph).sort()).toEqual([1, 1, 1, 1, 4]);
  });

  test("a closed loop becomes a single self-loop edge", () => {
    const graph = buildSkeletonGraph(SQUARE);
    expect(graph.nodes.length).toBe(1);
    expect(graph.edges.length).toBe(1);
    const edge = graph.edges[0]!;
    expect(edge.a).toBe(edge.b);
    expect(edge.points.length).toBe(17);
    expect(edge.points[0]).toEqual(edge.points[16]!);
  });

  test("a diagonal corner is not mistaken for a junction", () => {
    const graph = buildSkeletonGraph(bitmapFromRows(["#....", "#....", "#....", "####."]));
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);
  });

  test("pruneSpurs removes a short twig but keeps real branches", () => {
    const rows = bitmapFromRows([
      "..............",
      ".....#........",
      ".############.",
      "..............",
    ]);
    const graph = buildSkeletonGraph(rows);
    expect(graph.edges.length).toBe(3);
    const pruned = pruneSpurs(graph, 4);
    expect(pruned.edges.length).toBe(2);
  });
});

describe("eulerWalk", () => {
  test("a path graph is walked once, end to end", () => {
    const walk = eulerWalk(buildSkeletonGraph(bitmapFromRows([".......", ".#####.", "......."])));
    expect(walk.length).toBe(5);
    expect(isContiguous(walk)).toBe(true);
  });

  test("a loop is walked once and returns to its start", () => {
    const walk = eulerWalk(buildSkeletonGraph(SQUARE));
    expect(walk.length).toBe(17);
    expect(walk[0]).toEqual(walk[16]!);
    expect(coversAllInk(walk, SQUARE)).toBe(true);
  });

  test("a plus needs exactly one arm drawn twice", () => {
    const graph = buildSkeletonGraph(PLUS);
    // Four odd nodes: one pair is matched (two arms duplicated), one pair is left as the ends.
    expect(chooseDuplicateEdges(graph).length).toBe(2);
    const walk = eulerWalk(graph);
    expect(isContiguous(walk)).toBe(true);
    expect(coversAllInk(walk, PLUS)).toBe(true);
    // 4 arms of length 3, two of them retraced.
    expect(pathLength(walk)).toBe(18);
  });

  test("every edge of a multigraph is covered and the walk never jumps", () => {
    // A square with a diagonal: nodes 0..3, two odd nodes (0 and 2).
    const nodes: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const straight = (a: number, b: number) => ({
      a,
      b,
      points: [nodes[a]!, nodes[b]!],
      length: Math.hypot(nodes[a]![0] - nodes[b]![0], nodes[a]![1] - nodes[b]![1]),
    });
    const graph: Graph = { nodes, edges: [straight(0, 1), straight(1, 2), straight(2, 3), straight(3, 0), straight(0, 2)] };
    expect(chooseDuplicateEdges(graph)).toEqual([]);
    const walk = eulerWalk(graph);
    expect(walk.length).toBe(6);
    const drawn = new Set<string>();
    for (let i = 1; i < walk.length; i++) drawn.add([key(walk[i - 1]!), key(walk[i]!)].sort().join("|"));
    expect(drawn.size).toBe(5);
    // An Euler path starts and ends on the two odd nodes.
    expect([key(walk[0]!), key(walk[5]!)].sort()).toEqual(["0,0", "10,10"]);
  });

  test("disconnected graphs still come back as one polyline", () => {
    const nodes: Point[] = [
      [0, 0],
      [5, 0],
      [20, 0],
      [25, 0],
    ];
    const graph: Graph = {
      nodes,
      edges: [
        { a: 0, b: 1, points: [nodes[0]!, nodes[1]!], length: 5 },
        { a: 2, b: 3, points: [nodes[2]!, nodes[3]!], length: 5 },
      ],
    };
    const walk = eulerWalk(graph);
    expect(walk.length).toBe(4);
    expect(pathLength(walk)).toBe(25);
  });
});

describe("connectComponents", () => {
  test("joins separate strokes with the shortest bridge", () => {
    const bitmap = blank(30, 12);
    fillRect(bitmap, 2, 3, 10, 3);
    fillRect(bitmap, 15, 8, 26, 8);
    const { bitmap: joined, bridges } = connectComponents(bitmap);
    expect(labelComponents(joined).sizes.length - 1).toBe(1);
    expect(bridges.length).toBe(1);
    const [from, to] = bridges[0]!;
    // The closest pair is the right end of the first stroke and the left end of the second.
    expect([from, to].map(key).sort()).toEqual(["10,3", "15,8"]);
  });

  test("drops specks of noise", () => {
    const bitmap = blank(30, 12);
    fillRect(bitmap, 2, 3, 20, 3);
    bitmap.data[10 * 30 + 27] = 1;
    const { bitmap: joined, bridges } = connectComponents(bitmap, 3);
    expect(bridges.length).toBe(0);
    expect(inkCount(joined)).toBe(19);
  });
});

describe("refineEdges", () => {
  test("smooths a staircase but keeps the ends, so retraces stay exact", () => {
    const stairs = bitmapFromRows(["##......", ".##.....", "..##....", "...##...", "....##..", ".....##."]);
    const graph = buildSkeletonGraph(stairs);
    const refined = refineEdges(graph, (points) => rdp(points, 0.6));
    const edge = refined.edges[0]!;
    expect(edge.points[0]).toEqual(graph.edges[0]!.points[0]!);
    expect(edge.points[edge.points.length - 1]).toEqual(graph.edges[0]!.points[graph.edges[0]!.points.length - 1]!);
    expect(edge.points.length).toBeLessThan(graph.edges[0]!.points.length / 2);
    expect(edge.length).toBeLessThan(graph.edges[0]!.length);
  });
});

describe("traceLine", () => {
  test("two thick strokes become one continuous path covering both", () => {
    const bitmap = blank(64, 64);
    fillRect(bitmap, 8, 10, 50, 14);
    fillRect(bitmap, 20, 40, 56, 44);
    const path = traceLine(bitmap);
    expect(path.length).toBeGreaterThanOrEqual(4);
    expect(pathLength(path)).toBeGreaterThan(70);
    // Smoothed and simplified, but both strokes are still there.
    expect(path.some((p) => Math.abs(p[1] - 12) < 1)).toBe(true);
    expect(path.some((p) => Math.abs(p[1] - 42) < 1)).toBe(true);
  });

  test("a blank mask gives an empty path", () => {
    expect(traceLine(blank(16, 16))).toEqual([]);
  });
});
