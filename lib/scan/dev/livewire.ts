/**
 * Livewire / intelligent-scissors path snapping for the labeler (0a-ii, addendum A6).
 *
 * Dijkstra over a valley-cost image on an 8-connected grid: the labeler clicks a seed, the full
 * shortest-path tree from that seed is computed once, and every cursor move is a cheap parent
 * walk. Cost comes from `valley.ts` (1 − valley response + a floor), NEVER from detector modules —
 * decision D1, enforced by test/import-boundary.test.ts. The floor matters: with zero-cost pixels
 * available, Dijkstra happily wanders through noise because detours are free.
 */

/** Additive cost floor — the price of *any* step, even along a perfect crease. */
export const COST_FLOOR = 0.04;

/**
 * Optional bound on the Dijkstra region, in pixels around the seed. The full 512² grid is ~262k
 * nodes; if `setSeed` measures slow on the dev machine, the client passes this radius and re-seeds
 * when the cursor exits the window.
 */
export const LIVEWIRE_RADIUS_PX = 192;

/** Douglas-Peucker tolerance for committed paths, in crop pixels at label resolution. */
export const LIVEWIRE_SIMPLIFY_EPSILON_PX = 1.6;

const SQRT2 = Math.SQRT2;

/** cost = COST_FLOOR + (1 − valley): crease centres are cheap, flat skin is expensive. */
export function buildCostMap(valley: Float32Array, size: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i += 1) out[i] = COST_FLOOR + (1 - valley[i]);
  return out;
}

/* ------------------------------- Binary heap ------------------------------- */

/** Indexed min-heap over node ids keyed by an external distance array. */
class MinHeap {
  private readonly heap: Int32Array;
  private size = 0;
  constructor(capacity: number, private readonly key: Float64Array) {
    this.heap = new Int32Array(capacity);
  }
  get length(): number {
    return this.size;
  }
  push(node: number): void {
    let i = this.size;
    this.heap[this.size] = node;
    this.size += 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.key[this.heap[parent]] <= this.key[this.heap[i]]) break;
      const tmp = this.heap[parent];
      this.heap[parent] = this.heap[i];
      this.heap[i] = tmp;
      i = parent;
    }
  }
  pop(): number {
    const top = this.heap[0];
    this.size -= 1;
    if (this.size > 0) {
      this.heap[0] = this.heap[this.size];
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.size && this.key[this.heap[left]] < this.key[this.heap[smallest]]) smallest = left;
        if (right < this.size && this.key[this.heap[right]] < this.key[this.heap[smallest]]) smallest = right;
        if (smallest === i) break;
        const tmp = this.heap[smallest];
        this.heap[smallest] = this.heap[i];
        this.heap[i] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

/* --------------------------------- Livewire --------------------------------- */

export class Livewire {
  private readonly dist: Float64Array;
  private readonly parent: Int32Array;
  /** Window the last `setSeed` actually solved, so `pathTo` can refuse points outside it. */
  private x0 = 0;
  private y0 = 0;
  private x1 = 0;
  private y1 = 0;
  private seeded = false;
  /** Duration of the last `setSeed`, for the labeler HUD. */
  seedCostMs = 0;

  constructor(
    private readonly cost: Float32Array,
    private readonly size: number,
  ) {
    this.dist = new Float64Array(size * size);
    this.parent = new Int32Array(size * size);
  }

  /**
   * Full Dijkstra from the seed. Lazy-deletion variant: nodes may enter the heap more than once
   * and stale entries are skipped on pop — simpler than decrease-key and fast enough here. Edge
   * weight is the cost of *entering* the neighbour, ×√2 on diagonals so path length is metric.
   *
   * `radius` bounds the solved window around the seed ({@link LIVEWIRE_RADIUS_PX}); `Infinity`
   * solves the whole grid.
   */
  setSeed(x: number, y: number, radius: number = Number.POSITIVE_INFINITY): void {
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    const size = this.size;
    const sx = Math.min(size - 1, Math.max(0, Math.round(x)));
    const sy = Math.min(size - 1, Math.max(0, Math.round(y)));
    this.x0 = Math.max(0, Math.floor(sx - radius));
    this.y0 = Math.max(0, Math.floor(sy - radius));
    this.x1 = Math.min(size - 1, Math.ceil(sx + radius));
    this.y1 = Math.min(size - 1, Math.ceil(sy + radius));

    this.dist.fill(Number.POSITIVE_INFINITY);
    this.parent.fill(-1);
    const seedAt = sy * size + sx;
    this.dist[seedAt] = 0;

    const heap = new MinHeap(this.dist.length * 2, this.dist);
    heap.push(seedAt);
    const visited = new Uint8Array(this.dist.length);

    while (heap.length > 0) {
      const node = heap.pop();
      if (visited[node] === 1) continue;
      visited[node] = 1;
      const nodeX = node % size;
      const nodeY = (node / size) | 0;
      const base = this.dist[node];
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = nodeY + dy;
        if (ny < this.y0 || ny > this.y1) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = nodeX + dx;
          if (nx < this.x0 || nx > this.x1) continue;
          const neighbour = ny * size + nx;
          if (visited[neighbour] === 1) continue;
          const step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
          const candidate = base + this.cost[neighbour] * step;
          if (candidate < this.dist[neighbour]) {
            this.dist[neighbour] = candidate;
            this.parent[neighbour] = node;
            heap.push(neighbour);
          }
        }
      }
    }

    this.seeded = true;
    this.seedCostMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
  }

  /** True when (x, y) lies inside the window the last seed solved. */
  covers(x: number, y: number): boolean {
    const px = Math.round(x);
    const py = Math.round(y);
    return this.seeded && px >= this.x0 && px <= this.x1 && py >= this.y0 && py <= this.y1;
  }

  /**
   * Walk the parent tree from the cursor back to the seed, filling `out` with flat x,y pairs in
   * seed→cursor order. Returns the number of POINTS written (out holds 2× that many values), or 0
   * when un-seeded, outside the solved window, or unreachable.
   */
  pathTo(x: number, y: number, out: number[]): number {
    out.length = 0;
    if (!this.covers(x, y)) return 0;
    const size = this.size;
    let node = Math.round(y) * size + Math.round(x);
    if (!Number.isFinite(this.dist[node])) return 0;
    while (node >= 0) {
      out.push(node % size, (node / size) | 0);
      node = this.parent[node];
    }
    // Collected cursor→seed; flip pairs in place to seed→cursor.
    for (let i = 0, j = out.length - 2; i < j; i += 2, j -= 2) {
      const px = out[i];
      const py = out[i + 1];
      out[i] = out[j];
      out[i + 1] = out[j + 1];
      out[j] = px;
      out[j + 1] = py;
    }
    return out.length / 2;
  }
}

/* ----------------------------- Douglas-Peucker ----------------------------- */

function perpendicularDistance(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Own Douglas-Peucker — lines.ts has one, and lines.ts is banned for the labeler (D1).
 * Guarantees every dropped point lies within `epsilon` of the simplified polyline.
 */
export function simplifyPolyline(
  points: readonly (readonly number[])[],
  epsilon: number = LIVEWIRE_SIMPLIFY_EPSILON_PX,
): number[][] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<readonly [number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as readonly [number, number];
    let worst = 0;
    let worstAt = -1;
    for (let i = from + 1; i < to; i += 1) {
      const d = perpendicularDistance(points[i], points[from], points[to]);
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > epsilon && worstAt > 0) {
      keep[worstAt] = 1;
      stack.push([from, worstAt], [worstAt, to]);
    }
  }
  const out: number[][] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i] === 1) out.push([points[i][0], points[i][1]]);
  }
  return out;
}
