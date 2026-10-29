#!/usr/bin/env node

// Single source of truth for version placement: package.json is authoritative
// and public/manifest.json (Chromium requirement) plus package-lock.json must
// agree. `check` exits nonzero on drift; `sync` rewrites the followers from
// package.json. Used by the changesets version flow and the release workflow.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function assertSemver(version) {
  const match = version.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
  );
  if (!match) throw new Error(`Invalid semantic version: ${version}`);
  for (const identifier of match[4]?.split('.') ?? []) {
    if (/^\d+$/u.test(identifier) && identifier.length > 1 && identifier.startsWith('0')) {
      throw new Error(`Invalid semantic version: ${version}`);
    }
  }
}

export function packageVersion(root = DEFAULT_ROOT) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

function manifestVersion(root) {
  return JSON.parse(readFileSync(path.join(root, 'public/manifest.json'), 'utf8')).version;
}

function lockVersions(root) {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  return [lock.version, lock.packages?.['']?.version];
}

function detailsFor(root) {
  const version = packageVersion(root);
  const details = [];
  if (manifestVersion(root) !== version) {
    details.push(`public/manifest.json is ${manifestVersion(root)}, expected ${version}`);
  }
  const [lockRoot, lockPackage] = lockVersions(root);
  if (lockRoot !== version) {
    details.push(`package-lock.json root version is ${lockRoot}, expected ${version}`);
  }
  if (lockPackage !== version) {
    details.push(`package-lock.json packages[""].version is ${lockPackage}, expected ${version}`);
  }
  return { version, details };
}

export function checkVersions(root = DEFAULT_ROOT) {
  const { version, details } = detailsFor(root);
  if (details.length > 0) {
    throw new Error(`Version sources are out of sync with package.json ${version}:\n${details.join('\n')}`);
  }
  return version;
}

export function syncVersions(root = DEFAULT_ROOT) {
  const version = packageVersion(root);
  assertSemver(version);

  const manifestPath = path.join(root, 'public/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  writeFileSync(manifestPath, jsonText(manifest));

  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  writeFileSync(lockPath, jsonText(lock));

  return checkVersions(root);
}

function runCli() {
  const [command] = process.argv.slice(2);
  if (command !== 'check' && command !== 'sync') {
    throw new Error('Usage: node scripts/version.mjs <check|sync>');
  }
  if (command === 'check') {
    console.log(`all version sources agree at ${checkVersions()}`);
  } else {
    console.log(`version sources synchronized at ${syncVersions()}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
