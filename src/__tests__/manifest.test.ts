import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Vitest's jsdom import.meta.url is not a file URL; resolve from cwd instead.
const manifest = JSON.parse(
  readFileSync(join(process.cwd(), 'public', 'manifest.json'), 'utf8')
) as { manifest_version: number; optional_host_permissions?: unknown[] };

describe('extension manifest', () => {
  it('declares optional host permissions as match-pattern strings', () => {
    // Manifest V3 requires direct match patterns here; objects with
    // `matches` fields make Chromium reject the whole manifest at load.
    expect(manifest.manifest_version).toBe(3);
    expect(Array.isArray(manifest.optional_host_permissions)).toBe(true);
    for (const entry of manifest.optional_host_permissions ?? []) {
      expect(typeof entry).toBe('string');
      expect(entry).toMatch(/^https?:\/\/\*\/\*$/);
    }
  });
});
