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
    const source = readFileSync(changelogPath, 'utf8');
    const header = `## ${version}`;
    const start = source.indexOf(header);
    if (start >= 0) {
      const contentStart = start + header.length;
      const next = source.slice(contentStart).search(/^## /mu);
      const section = source
        .slice(contentStart, next < 0 ? undefined : contentStart + next)
        .trim();
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
