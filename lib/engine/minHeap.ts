/**
 * Binary min-heap keyed by a number. Enough for Dijkstra: push, pop the
 * smallest, O(log n) each. Stale entries are left in place and skipped by the
 * caller ("lazy deletion"), which is simpler than decrease-key and just as fast
 * at this scale.
 */
export class MinHeap<T> {
  private readonly items: { key: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, value: T): void {
    const items = this.items;
    items.push({ key, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = items[parent];
      const c = items[i];
      if (!p || !c || p.key <= c.key) break;
      items[parent] = c;
      items[i] = p;
      i = parent;
    }
  }

  pop(): { key: number; value: T } | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (!top || !last) return top;
    if (items.length === 0) return top;
    items[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < items.length && (items[left]?.key ?? Infinity) < (items[smallest]?.key ?? Infinity)) smallest = left;
      if (right < items.length && (items[right]?.key ?? Infinity) < (items[smallest]?.key ?? Infinity)) smallest = right;
      if (smallest === i) break;
      const a = items[i];
      const b = items[smallest];
      if (!a || !b) break;
      items[i] = b;
      items[smallest] = a;
      i = smallest;
    }
    return top;
  }
}
