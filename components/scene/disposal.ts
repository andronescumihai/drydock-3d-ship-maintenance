import { useEffect } from 'react';

interface Disposable {
  dispose(): void;
}

const pending = new WeakMap<readonly Disposable[], ReturnType<typeof setTimeout>>();

/**
 * Disposes GPU resources when the component that owns them goes away or
 * replaces them — but not during React Strict Mode's rehearsal unmount.
 *
 * Strict Mode runs every effect's cleanup and then the effect again, with the
 * same memoised objects. Disposing in the cleanup would free buffers the second
 * mount is about to draw with. So the cleanup only *schedules* the disposal on
 * the next tick, and a re-run with the same list cancels it. A real unmount (or
 * a new list replacing this one) lets it through.
 *
 * `items` must be referentially stable for as long as it is in use (memoise it).
 */
export function useDisposeOnRelease(items: readonly Disposable[]): void {
  useEffect(() => {
    const timer = pending.get(items);
    if (timer !== undefined) {
      clearTimeout(timer);
      pending.delete(items);
    }
    return () => {
      pending.set(
        items,
        setTimeout(() => {
          pending.delete(items);
          for (const item of items) item.dispose();
        }, 0),
      );
    };
  }, [items]);
}
