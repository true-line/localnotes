#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function readContextFile(filename) {
  try {
    return readFileSync(join(ROOT, filename), 'utf8').replaceAll('\r\n', '\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${filename} could not be read: ${message}`);
    return '';
  }
}

const agents = readContextFile('AGENTS.md');

const START = '<!-- governed:shared-agent-discovery:start -->';
const END = '<!-- governed:shared-agent-discovery:end -->';
const REQUIRED_POINTERS = [
  'https://github.com/qwts/agent-sop/blob/main/docs/reference/agent-conventions.md',
  'https://github.com/qwts/agent-sop/blob/main/docs/sop/README.md',
  'https://github.com/qwts/agent-sop/blob/main/docs/decisions/README.md',
];
// The canonical baseline pins the shared-skills index to a reviewed commit, and
// the pin moves whenever agent-sop re-projects the block. Match the
// shape rather than one sha so a routine re-pin does not fail this check.
const PINNED_SKILLS_POINTER =
  /https:\/\/github\.com\/qwts\/agent-sop\/blob\/[0-9a-f]{40}\/skills\/README\.md/g;
function occurrences(source, value) {
  return source.split(value).length - 1;
}

const start = agents.indexOf(START);
const end = agents.indexOf(END);
if (occurrences(agents, START) !== 1 || occurrences(agents, END) !== 1) {
  errors.push('AGENTS.md must contain exactly one marked shared discovery block');
}
if (start !== -1 && end !== -1 && start > end) {
  errors.push('AGENTS.md discovery markers are out of order');
}
const discovery = start !== -1 && end > start
  ? agents.slice(start, end + END.length)
  : '';
for (const pointer of REQUIRED_POINTERS) {
  if (occurrences(discovery, pointer) !== 1) {
    errors.push(`the marked discovery block must contain exactly one ${pointer}`);
  }
}
if ((discovery.match(PINNED_SKILLS_POINTER) ?? []).length !== 1) {
  errors.push('the marked discovery block must contain exactly one commit-pinned link to skills/README.md');
}
if (existsSync(join(ROOT, 'CLAUDE.md'))) {
  errors.push('CLAUDE.md must not exist: AGENTS.md is the only agent context (harness adapters removed)');
}

if (errors.length > 0) {
  process.stderr.write(`agent-context check failed:\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}

process.stdout.write('agent-context check passed\n');
