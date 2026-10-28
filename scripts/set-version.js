// Sets the extension manifest version (package.json is bumped by `npm version`).
// Usage: node scripts/set-version.js <semver>
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: node scripts/set-version.js <semver>');
  process.exit(1);
}

const path = new URL('../public/manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(path, 'utf8'));
manifest.version = version;
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest version -> ${version}`);
