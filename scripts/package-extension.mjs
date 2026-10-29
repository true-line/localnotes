#!/usr/bin/env node

// Packages dist/ into the release zip with adm-zip so packaging does not
// depend on a `zip` binary being installed on the runner.

import AdmZip from 'adm-zip';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const version = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8')
).version;

if (!existsSync(path.join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json missing — run npm run build first');
  process.exit(1);
}

const zip = new AdmZip();
zip.addLocalFolder(dist);
const out = path.join(root, `localnotes-v${version}.zip`);
zip.writeZip(out);

const entries = readdirSync(dist);
console.log(
  `localnotes-v${version}.zip (${entries.length} entries from dist/)`
);
