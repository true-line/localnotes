#!/usr/bin/env node

// Prints the CHANGELOG.md section for one version (changesets format:
// `## <version>` headers). Falls back to a stub so a release can never be
// blocked by a formatting surprise in the changelog.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

export function releaseNotes(version, root = DEFAULT_ROOT) {
  const changelogPath = path.join(root, 'CHANGELOG.md');
  if (existsSync(changelogPath)) {
    // Exact header-line equality: `## 0.1.1` must not match `## 0.1.10`
    const lines = readFileSync(changelogPath, 'utf8').split('\n');
    const startIdx = lines.findIndex((line) => line.trim() === `## ${version}`);
    if (startIdx >= 0) {
      let endIdx = lines.length;
      for (let i = startIdx + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) {
          endIdx = i;
          break;
        }
      }
      const section = lines.slice(startIdx + 1, endIdx).join('\n').trim();
      if (section) return section;
    }
  }
  return `See CHANGELOG.md for the full history. LocalNotes ${version} ships the changes accumulated since the previous tag.`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const [version] = process.argv.slice(2);
  try {
    if (!version) throw new Error('Usage: node scripts/release-notes.mjs <version>');
    console.log(releaseNotes(version));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
