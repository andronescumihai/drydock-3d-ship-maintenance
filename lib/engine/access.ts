/**
 * Access path: the quickest way from the gangway to a component's work face,
 * and everything that has to be opened or taken apart on the way.
 *
 * The ship is an undirected graph of places and obstacles. Walking an edge
 * costs its length at walking pace (or an explicit time, for ladders and the
 * like); ENTERING a node costs that node's own minutes — undogging a door,
 * lifting floor plates, removing a spool piece, isolating at the work face.
 * Dijkstra with a binary heap finds the cheapest route.
 *
 * Dijkstra rather than breadth-first search because the weights are wildly
 * uneven: a four-minute walk round the deck can beat a shortcut through a tank
 * that needs four hours of gas-freeing, and hop counts would pick the tank.
 */

import type { AccessNetwork, AccessNode, AccessNodeId, ComponentId } from './types';
import { MinHeap } from './minHeap';

export interface AccessStep {
  readonly node: AccessNode;
  /** Minutes walked (or climbed) to arrive here from the previous step. */
  readonly transitMinutes: number;
  /** Metres covered to arrive here from the previous step (climbs count their length). */
  readonly transitMetres: number;
  /** Minutes spent at this node: opening, climbing, dismantling, isolating. */
  readonly workMinutes: number;
  /** Elapsed minutes when this step is finished. */
  readonly elapsedMinutes: number;
}

export interface AccessPlan {
  readonly targetNodeId: AccessNodeId;
  readonly steps: readonly AccessStep[];
  readonly totalMinutes: number;
  readonly transitMinutes: number;
  /** Time spent on obstacles and preparation, i.e. everything but walking. */
  readonly workMinutes: number;
  /** Time to put back everything marked `reinstall` along the route. */
  readonly reinstallMinutes: number;
  readonly distanceMetres: number;
  /** Steps that are real obstacles (doors, hatches, removals, the work face). */
  readonly obstacles: readonly AccessStep[];
  /** Other components that have to be partly dismantled on the way. */
  readonly blockingComponents: readonly ComponentId[];
}

/** Putting things back is quicker than taking them apart: nothing is seized. */
export const REINSTALL_FACTOR = 0.8;

const OBSTACLE_KINDS = new Set(['door', 'hatch', 'ladder', 'stair', 'removal', 'workface']);

interface Adjacent {
  readonly to: AccessNodeId;
  readonly minutes: number;
  readonly metres: number;
}

interface Graph {
  readonly nodes: ReadonlyMap<AccessNodeId, AccessNode>;
  readonly adjacency: ReadonlyMap<AccessNodeId, readonly Adjacent[]>;
}

const graphCache = new WeakMap<AccessNetwork, Graph>();

function distance(a: AccessNode, b: AccessNode): number {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const dz = a.position.z - b.position.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function graphFor(network: AccessNetwork): Graph {
  const cached = graphCache.get(network);
  if (cached) return cached;

  const nodes = new Map(network.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<AccessNodeId, Adjacent[]>();
  for (const edge of network.edges) {
    const a = nodes.get(edge.from);
    const b = nodes.get(edge.to);
    if (!a || !b) continue;
    const metres = distance(a, b);
    const minutes = edge.minutes ?? metres / network.walkingSpeed / 60;
    adjacency.set(a.id, [...(adjacency.get(a.id) ?? []), { to: b.id, minutes, metres }]);
    adjacency.set(b.id, [...(adjacency.get(b.id) ?? []), { to: a.id, minutes, metres }]);
  }
  const graph = { nodes, adjacency };
  graphCache.set(network, graph);
  return graph;
}

/**
 * Cheapest route from the network's entry to `targetNodeId`, or null if the
 * target does not exist or cannot be reached.
 */
export function planAccess(network: AccessNetwork, targetNodeId: AccessNodeId): AccessPlan | null {
  const { nodes, adjacency } = graphFor(network);
  const start = nodes.get(network.entryNodeId);
  if (!start || !nodes.has(targetNodeId)) return null;

  const best = new Map<AccessNodeId, number>([[start.id, 0]]);
  const previous = new Map<AccessNodeId, { from: AccessNodeId; via: Adjacent }>();
  const heap = new MinHeap<AccessNodeId>();
  heap.push(0, start.id);

  while (heap.size > 0) {
    const item = heap.pop();
    if (!item) break;
    const { key: cost, value: id } = item;
    if (cost > (best.get(id) ?? Infinity)) continue; // stale heap entry
    if (id === targetNodeId) break;

    for (const next of adjacency.get(id) ?? []) {
      const node = nodes.get(next.to);
      if (!node) continue;
      const candidate = cost + next.minutes + node.minutes;
      if (candidate < (best.get(next.to) ?? Infinity)) {
        best.set(next.to, candidate);
        previous.set(next.to, { from: id, via: next });
        heap.push(candidate, next.to);
      }
    }
  }

  if (!best.has(targetNodeId)) return null;

  // Walk the predecessor chain back to the entry.
  const chain: { node: AccessNode; via: Adjacent | null }[] = [];
  let cursor: AccessNodeId | undefined = targetNodeId;
  while (cursor) {
    const node = nodes.get(cursor);
    if (!node) break;
    const link = previous.get(cursor);
    chain.push({ node, via: link?.via ?? null });
    cursor = link?.from;
  }
  chain.reverse();

  let elapsed = 0;
  let transit = 0;
  let work = 0;
  let metres = 0;
  let reinstall = 0;
  const steps: AccessStep[] = chain.map(({ node, via }) => {
    const transitMinutes = via?.minutes ?? 0;
    const workMinutes = node.id === start.id ? 0 : node.minutes;
    elapsed += transitMinutes + workMinutes;
    transit += transitMinutes;
    work += workMinutes;
    metres += via?.metres ?? 0;
    if (node.reinstall) reinstall += node.minutes * REINSTALL_FACTOR;
    return { node, transitMinutes, transitMetres: via?.metres ?? 0, workMinutes, elapsedMinutes: elapsed };
  });

  const obstacles = steps.filter((step) => OBSTACLE_KINDS.has(step.node.kind));
  const blockingComponents = [
    ...new Set(steps.map((step) => step.node.componentId).filter((id): id is ComponentId => Boolean(id))),
  ];

  return {
    targetNodeId,
    steps,
    totalMinutes: elapsed,
    transitMinutes: transit,
    workMinutes: work,
    reinstallMinutes: reinstall,
    distanceMetres: metres,
    obstacles,
    blockingComponents,
  };
}
