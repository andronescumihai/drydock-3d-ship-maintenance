import { readdirSync, statSync } from 'node:fs';
import { join, parse } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Module files in one folder must not differ only by letter case: on macOS and
 * Windows (case-insensitive file systems) `import './coast'` next to Coast.tsx
 * resolves to Coast.tsx, even though Linux and the CI pick coast.ts.
 */
const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

function clashes(dir: string): string[] {
  const found: string[] = [];
  const seen = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...clashes(path));
      continue;
    }
    const { name: base, ext } = parse(name);
    if (!CODE.has(ext)) continue;
    const key = base.toLowerCase();
    const other = seen.get(key);
    if (other && other !== base) found.push(`${join(dir, other)} vs ${path}`);
    seen.set(key, base);
  }
  return found;
}

describe('file names', () => {
  it('never differ only by case within a folder', () => {
    const root = join(__dirname, '..');
    expect([...clashes(join(root, 'components')), ...clashes(join(root, 'lib')), ...clashes(join(root, 'app'))]).toEqual([]);
  });
});
