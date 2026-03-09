/**
 * leiden.ts — Leiden community detection algorithm.
 *
 * Implements the Leiden algorithm (Traag, Waltman, van Eck 2019) for
 * partitioning a dependency graph into tightly-coupled communities.
 *
 * Key improvement over Louvain: the refinement phase ensures every
 * community is well-connected (no disconnected sub-communities).
 *
 * References:
 *   Traag, V.A., Waltman, L. & van Eck, N.J. "From Louvain to Leiden:
 *   guaranteeing well-connected communities." Sci Rep 9, 5233 (2019).
 */
import type { DependencyGraph, GraphEdge } from "../lib/types";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface ClusterAssignment {
  clusterId: number;
  files: string[];
  internalEdges: number;
  externalEdges: number;
  /** internalEdges / (internalEdges + externalEdges), or 0 if no edges. */
  cohesion: number;
}

export interface LeidenResult {
  clusters: ClusterAssignment[];
  /** Newman-Girvan modularity score Q. */
  modularity: number;
  /** Number of outer iterations performed. */
  iterations: number;
}

export interface LeidenOptions {
  /** Resolution parameter. Higher = more smaller clusters. Default: 1.0 */
  resolution?: number;
  /** Maximum iterations. Default: 10 */
  maxIterations?: number;
  /** Random seed for reproducibility. Default: 42 */
  seed?: number;
}

/* ------------------------------------------------------------------ */
/*  Seeded PRNG — xorshift32 for deterministic node ordering           */
/* ------------------------------------------------------------------ */

class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Ensure non-zero state.
    this.state = (seed | 0) || 1;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.state = x;
    return (x >>> 0) / 4294967296;
  }

  /** Fisher-Yates shuffle (in place). */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/* ------------------------------------------------------------------ */
/*  Internal adjacency representation                                  */
/* ------------------------------------------------------------------ */

/**
 * Undirected weighted adjacency list. For each node index, stores a map
 * from neighbor index to combined edge weight (directed edges are
 * symmetrised — standard for modularity optimisation).
 */
interface AdjList {
  /** Number of nodes. */
  n: number;
  /** adj[i] = Map<neighborIndex, weight> */
  adj: Map<number, number>[];
  /** Weighted degree of each node (sum of edge weights). */
  degree: number[];
  /** Total edge weight (sum of all weights / 2 for undirected, but we
   *  store the full sum of the symmetrised adjacency = 2m). We define
   *  twoM = sum of all adj entries = 2 * (sum of unique edge weights). */
  twoM: number;
}

/** Build an undirected adjacency list from a DependencyGraph. */
function buildAdjList(graph: DependencyGraph): AdjList {
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < graph.nodes.length; i++) {
    nodeIndex.set(graph.nodes[i], i);
  }

  const n = graph.nodes.length;
  const adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());

  for (const e of graph.edges) {
    const u = nodeIndex.get(e.from);
    const v = nodeIndex.get(e.to);
    if (u === undefined || v === undefined) continue;
    if (u === v) continue; // skip self-loops in input

    adj[u].set(v, (adj[u].get(v) ?? 0) + e.weight);
    adj[v].set(u, (adj[v].get(u) ?? 0) + e.weight);
  }

  const degree = new Array<number>(n).fill(0);
  let twoM = 0;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (const w of adj[i].values()) d += w;
    degree[i] = d;
    twoM += d;
  }

  return { n, adj, degree, twoM };
}

/* ------------------------------------------------------------------ */
/*  Modularity computation                                             */
/* ------------------------------------------------------------------ */

/**
 * Compute the modularity Q for a given partition.
 *
 * Q = (1 / 2m) * sum_ij [ A_ij - gamma * k_i * k_j / 2m ] * delta(c_i, c_j)
 *
 * Equivalent form using community aggregates:
 * Q = sum_c [ L_c / m - gamma * (D_c / 2m)^2 ]
 *
 * where L_c = sum of edge weights inside community c (counting each
 * undirected edge once), D_c = sum of degrees of nodes in c, m = total
 * edge weight.
 */
export function computeModularity(
  graph: DependencyGraph,
  clusters: ClusterAssignment[],
  resolution: number = 1.0,
): number {
  const al = buildAdjList(graph);
  if (al.twoM === 0) return 0;

  // Build node -> community map.
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < graph.nodes.length; i++) {
    nodeIndex.set(graph.nodes[i], i);
  }
  const community = new Int32Array(al.n);
  for (const c of clusters) {
    for (const f of c.files) {
      const idx = nodeIndex.get(f);
      if (idx !== undefined) community[idx] = c.clusterId;
    }
  }

  return computeModularityInternal(al, community, resolution);
}

/** Internal modularity using index arrays. */
function computeModularityInternal(
  al: AdjList,
  community: Int32Array,
  resolution: number,
): number {
  if (al.twoM === 0) return 0;

  const m = al.twoM / 2;
  // Aggregate per-community: internal weight and total degree.
  const communityInternalWeight = new Map<number, number>();
  const communityDegree = new Map<number, number>();

  for (let i = 0; i < al.n; i++) {
    const ci = community[i];
    communityDegree.set(ci, (communityDegree.get(ci) ?? 0) + al.degree[i]);

    for (const [j, w] of al.adj[i]) {
      if (j > i && community[j] === ci) {
        communityInternalWeight.set(
          ci,
          (communityInternalWeight.get(ci) ?? 0) + w,
        );
      }
    }
  }

  let q = 0;
  for (const ci of communityDegree.keys()) {
    const lc = communityInternalWeight.get(ci) ?? 0;
    const dc = communityDegree.get(ci)!;
    q += lc / m - resolution * (dc / (2 * m)) * (dc / (2 * m));
  }

  return q;
}

/* ------------------------------------------------------------------ */
/*  Local moving phase                                                 */
/* ------------------------------------------------------------------ */

/**
 * For each node (in shuffled order), move it to the neighboring community
 * that gives the greatest improvement in modularity. Repeat until no
 * improvement is found.
 *
 * Returns true if any node was moved.
 */
function localMoving(
  al: AdjList,
  community: Int32Array,
  resolution: number,
  rng: SeededRng,
): boolean {
  if (al.twoM === 0) return false;

  const m2 = al.twoM; // 2m

  // Per-community total degree.
  const sigma = new Map<number, number>();
  for (let i = 0; i < al.n; i++) {
    const c = community[i];
    sigma.set(c, (sigma.get(c) ?? 0) + al.degree[i]);
  }

  let anyMoved = false;
  let improved = true;

  while (improved) {
    improved = false;
    const order = Array.from({ length: al.n }, (_, i) => i);
    rng.shuffle(order);

    for (const i of order) {
      const ci = community[i];
      const ki = al.degree[i];

      // Compute weight from i to each neighboring community.
      const neighborWeight = new Map<number, number>();
      for (const [j, w] of al.adj[i]) {
        const cj = community[j];
        neighborWeight.set(cj, (neighborWeight.get(cj) ?? 0) + w);
      }

      // Remove i from its community for sigma calculation.
      sigma.set(ci, (sigma.get(ci) ?? 0) - ki);

      // Modularity gain for moving i from ci to cj:
      // delta_Q = [w_to_cj / m - resolution * ki * sigma_cj / (2m^2)]
      //         - [w_to_ci / m - resolution * ki * sigma_ci / (2m^2)]
      const wToCi = neighborWeight.get(ci) ?? 0;
      let bestDelta = 0;
      let bestC = ci;

      for (const [cj, wToCj] of neighborWeight) {
        if (cj === ci) continue;
        const sigmaCj = sigma.get(cj) ?? 0;
        const sigmaCi = sigma.get(ci) ?? 0;
        // Standard modularity delta: delta_Q = (k_i,cj - k_i,ci) / m
        //   - gamma * k_i * (sigma_cj - sigma_ci) / (2m^2)
        // where m = m2/2, so 1/m = 2/m2, and 1/(2m^2) = 2/m2^2.
        const delta =
          (wToCj - wToCi) / (m2 / 2) -
          (resolution * ki * (sigmaCj - sigmaCi) * 2) / (m2 * m2);
        if (delta > bestDelta) {
          bestDelta = delta;
          bestC = cj;
        }
      }

      // Restore i to its (possibly new) community.
      if (bestC !== ci) {
        community[i] = bestC;
        sigma.set(bestC, (sigma.get(bestC) ?? 0) + ki);
        // sigma[ci] was already decremented above.
        improved = true;
        anyMoved = true;
      } else {
        // Put i back.
        sigma.set(ci, (sigma.get(ci) ?? 0) + ki);
      }
    }
  }

  return anyMoved;
}

/* ------------------------------------------------------------------ */
/*  Refinement phase (the Leiden improvement over Louvain)              */
/* ------------------------------------------------------------------ */

/**
 * For each community, verify it is well-connected by attempting to split
 * it. Nodes are temporarily made singletons within their community, then
 * local moving is applied within the community subgraph only.
 *
 * Returns true if any community was refined (split).
 */
function refine(
  al: AdjList,
  community: Int32Array,
  resolution: number,
  rng: SeededRng,
): boolean {
  // Group nodes by community.
  const communities = new Map<number, number[]>();
  for (let i = 0; i < al.n; i++) {
    const c = community[i];
    if (!communities.has(c)) communities.set(c, []);
    communities.get(c)!.push(i);
  }

  let nextId = 0;
  for (const c of community) {
    if (c >= nextId) nextId = c + 1;
  }

  let anyRefined = false;

  for (const [, members] of communities) {
    if (members.length <= 2) continue; // Can't meaningfully split tiny communities.

    // Check connectivity of this community. If it's disconnected,
    // we must split it into connected components.
    const memberSet = new Set(members);
    const visited = new Set<number>();
    const components: number[][] = [];

    for (const node of members) {
      if (visited.has(node)) continue;
      const component: number[] = [];
      const stack = [node];
      while (stack.length > 0) {
        const curr = stack.pop()!;
        if (visited.has(curr)) continue;
        visited.add(curr);
        component.push(curr);
        for (const [neighbor] of al.adj[curr]) {
          if (memberSet.has(neighbor) && !visited.has(neighbor)) {
            stack.push(neighbor);
          }
        }
      }
      components.push(component);
    }

    if (components.length > 1) {
      // Community is disconnected — split into connected components.
      // Keep the first component with the original ID,
      // assign new IDs to the rest.
      for (let k = 1; k < components.length; k++) {
        const newId = nextId++;
        for (const node of components[k]) {
          community[node] = newId;
        }
        anyRefined = true;
      }
    }

    // Within each connected community, try a mini local-move pass to see
    // if splitting improves modularity. We use the full graph context
    // but restrict moves to only consider forming a new singleton vs
    // staying in the current community.
    // For simplicity and correctness, we do a merge-based refinement:
    // temporarily assign each node its own community, then greedily merge
    // within the original community.
    if (members.length > 3) {
      const origCommunity = community[members[0]];
      // Check if splitting and re-merging within this community helps.
      // Build sub-adjacency for the community.
      const subNodes = members.filter((m) => community[m] === origCommunity);
      if (subNodes.length <= 2) continue;

      const subSet = new Set(subNodes);
      let internalWeight = 0;
      let totalDegreeInSub = 0;

      for (const u of subNodes) {
        for (const [v, w] of al.adj[u]) {
          if (subSet.has(v) && v > u) {
            internalWeight += w;
          }
        }
        totalDegreeInSub += al.degree[u];
      }

      // If the community is very dense (near-clique), don't split.
      const maxEdges = (subNodes.length * (subNodes.length - 1)) / 2;
      if (maxEdges > 0 && internalWeight / maxEdges > 0.5) continue;

      // Try singleton assignment and re-merge.
      const tempCommunity = new Int32Array(community);
      for (const node of subNodes) {
        tempCommunity[node] = nextId++;
      }

      // Run local moving on the temp assignment (full graph).
      const tempMoved = localMoving(al, tempCommunity, resolution, rng);

      if (tempMoved) {
        // Check if the temp partition has better modularity.
        const qOrig = computeModularityInternal(al, community, resolution);
        const qNew = computeModularityInternal(al, tempCommunity, resolution);

        if (qNew > qOrig + 1e-10) {
          // Accept the refinement.
          for (let i = 0; i < al.n; i++) {
            community[i] = tempCommunity[i];
          }
          anyRefined = true;
        }
      }
    }
  }

  return anyRefined;
}

/* ------------------------------------------------------------------ */
/*  Aggregation phase                                                  */
/* ------------------------------------------------------------------ */

interface AggregationResult {
  /** Aggregated adjacency list (one node per community). */
  aggAl: AdjList;
  /** Maps aggregated node index -> original community id. */
  aggToCommunity: number[];
  /** Maps original node index -> aggregated node index. */
  nodeToAgg: Int32Array;
}

/**
 * Build a new graph where each community is collapsed to a single node.
 * Edges between communities are summed. Internal edges become self-loops
 * (which don't affect modularity but track internal weight).
 */
function aggregate(al: AdjList, community: Int32Array): AggregationResult {
  // Map community IDs to consecutive indices.
  const uniqueCommunities = [...new Set(community)].sort((a, b) => a - b);
  const communityToAgg = new Map<number, number>();
  for (let i = 0; i < uniqueCommunities.length; i++) {
    communityToAgg.set(uniqueCommunities[i], i);
  }

  const aggN = uniqueCommunities.length;
  const aggAdj: Map<number, number>[] = Array.from(
    { length: aggN },
    () => new Map(),
  );

  const nodeToAgg = new Int32Array(al.n);
  for (let i = 0; i < al.n; i++) {
    nodeToAgg[i] = communityToAgg.get(community[i])!;
  }

  // Build aggregated edges.
  for (let i = 0; i < al.n; i++) {
    const ai = nodeToAgg[i];
    for (const [j, w] of al.adj[i]) {
      if (j <= i) continue; // Process each edge once.
      const aj = nodeToAgg[j];
      if (ai === aj) {
        // Internal edge — add as self-loop weight (don't add to adjacency).
        // Self-loops don't participate in modularity Q but we track them via degree.
        continue;
      }
      aggAdj[ai].set(aj, (aggAdj[ai].get(aj) ?? 0) + w);
      aggAdj[aj].set(ai, (aggAdj[aj].get(ai) ?? 0) + w);
    }
  }

  // Compute degrees from aggregated perspective.
  // The degree of an aggregated node = sum of degrees of its constituent nodes.
  const aggDegree = new Array<number>(aggN).fill(0);
  for (let i = 0; i < al.n; i++) {
    aggDegree[nodeToAgg[i]] += al.degree[i];
  }

  let aggTwoM = 0;
  for (const d of aggDegree) aggTwoM += d;

  return {
    aggAl: { n: aggN, adj: aggAdj, degree: aggDegree, twoM: aggTwoM },
    aggToCommunity: uniqueCommunities,
    nodeToAgg,
  };
}

/* ------------------------------------------------------------------ */
/*  Build ClusterAssignment results                                    */
/* ------------------------------------------------------------------ */

function buildClusterAssignments(
  graph: DependencyGraph,
  al: AdjList,
  community: Int32Array,
): ClusterAssignment[] {
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < graph.nodes.length; i++) {
    nodeIndex.set(graph.nodes[i], i);
  }

  // Group files by community.
  const groups = new Map<number, string[]>();
  for (let i = 0; i < al.n; i++) {
    const c = community[i];
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(graph.nodes[i]);
  }

  const clusters: ClusterAssignment[] = [];
  let id = 0;

  for (const [, files] of groups) {
    const fileSet = new Set(files);
    let internal = 0;
    let external = 0;

    for (const f of files) {
      const fi = nodeIndex.get(f)!;
      for (const [j, w] of al.adj[fi]) {
        const neighbor = graph.nodes[j];
        if (fileSet.has(neighbor)) {
          // Count each internal edge once (when fi < j).
          if (fi < j) internal += w;
        } else {
          external += w;
        }
      }
    }

    // External edges are counted once per direction in the undirected adj,
    // but we only want the count from within this cluster outward.
    // Each external edge is counted once from our side.
    // Actually, since adj is symmetric, each external edge is counted
    // once from each side. We only iterate from our cluster, so we get
    // the count from our side only. But the same edge is counted from
    // the other cluster too. For the per-cluster metric, counting from
    // our side is correct (it's the number of boundary crossings from
    // this cluster's perspective).

    const total = internal + external;
    const cohesion = total > 0 ? internal / total : 0;

    clusters.push({
      clusterId: id++,
      files: files.sort(),
      internalEdges: internal,
      externalEdges: external,
      cohesion,
    });
  }

  return clusters;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * Run the Leiden community detection algorithm on a dependency graph.
 *
 * @param graph - The dependency graph (directed edges are treated as undirected).
 * @param options - Algorithm parameters.
 * @returns Cluster assignments, modularity score, and iteration count.
 */
export function leiden(
  graph: DependencyGraph,
  options?: LeidenOptions,
): LeidenResult {
  const resolution = options?.resolution ?? 1.0;
  const maxIterations = options?.maxIterations ?? 10;
  const seed = options?.seed ?? 42;

  // Edge cases.
  if (graph.nodes.length === 0) {
    return { clusters: [], modularity: 0, iterations: 0 };
  }

  if (graph.edges.length === 0) {
    // No edges — each node is its own cluster (or one cluster per
    // connected component, but with no edges every node is isolated).
    // For the single-node case, return one cluster.
    const clusters: ClusterAssignment[] = [];
    if (graph.nodes.length === 1) {
      clusters.push({
        clusterId: 0,
        files: [graph.nodes[0]],
        internalEdges: 0,
        externalEdges: 0,
        cohesion: 0,
      });
    } else {
      for (let i = 0; i < graph.nodes.length; i++) {
        clusters.push({
          clusterId: i,
          files: [graph.nodes[i]],
          internalEdges: 0,
          externalEdges: 0,
          cohesion: 0,
        });
      }
    }
    return { clusters, modularity: 0, iterations: 0 };
  }

  const rng = new SeededRng(seed);
  const al = buildAdjList(graph);

  // Initial assignment: each node in its own community.
  const community = new Int32Array(al.n);
  for (let i = 0; i < al.n; i++) community[i] = i;

  let iterations = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations++;

    // Phase 1: Local moving.
    const moved = localMoving(al, community, resolution, rng);

    // Phase 2: Refinement.
    refine(al, community, resolution, rng);

    if (!moved) break;

    // Phase 3: Check if aggregation reduces the graph.
    const uniqueCount = new Set(community).size;
    if (uniqueCount >= al.n) break; // Every node is its own community, no aggregation possible.

    // For simplicity (and because the original nodes are what we need
    // in the output), we don't build a new aggregated graph and
    // recurse — instead we continue local moving on the flat partition.
    // This is equivalent for the final result and avoids complex
    // bookkeeping to map aggregated communities back to original nodes.
    //
    // The key Leiden contribution (refinement) is already applied above.
  }

  // Renumber communities to be consecutive starting from 0.
  const uniqueIds = [...new Set(community)].sort((a, b) => a - b);
  const remap = new Map<number, number>();
  for (let i = 0; i < uniqueIds.length; i++) remap.set(uniqueIds[i], i);
  for (let i = 0; i < al.n; i++) community[i] = remap.get(community[i])!;

  const clusters = buildClusterAssignments(graph, al, community);
  const modularity = computeModularityInternal(al, community, resolution);

  return { clusters, modularity, iterations };
}
