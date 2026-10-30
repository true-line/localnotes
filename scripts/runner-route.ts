// Fleet-health routing decision for .github/workflows/runner-route.yml.
// The probe answers one question before any job lands on the organisation's
// hardware: are the self-hosted runners taking work right now? A dead fleet
// must not stop the reviewed lifecycle. Two independent signals feed the
// decision:
//
//   1. Fleet census. Online runners carrying the fleet's labels, read
//      through the org runner API with a chores-dumb token. Covers a fleet
//      that died before dispatch even when the queue is empty, because the
//      probe cannot observe this run's own jobs, which have not queued yet.
//      A failed census only removes this check; it never poisons the queue
//      evidence.
//   2. Queue age. A healthy fleet drains the shared queue in seconds to a
//      few minutes, so the oldest still-queued workflow run exposes a
//      wedged-but-online fleet that the census cannot see. Once that run
//      has waited longer than CI_RUNNER_FALLBACK_MINUTES (repository
//      variable, default 10), the run routes hosted.
//
// An unreadable queue also routes hosted: unknown fleet health must not
// hang the run. decideRoute is pure so the routing rules are unit-tested in
// src/__tests__/runner-route.test.ts; main() wires the decision to the
// Actions environment.

export const HOSTED = '["ubuntu-latest"]';
export const FLEET = '["self-hosted", "Linux", "X64"]';

export interface RouteMessage {
  warning: boolean;
  text: string;
}

export interface CensusInput {
  /** A census token was available, so the org runner API was queried. */
  attempted: boolean;
  /** The mint step ran and failed (as opposed to running with no secrets). */
  mintFailed: boolean;
  /** The org runner API answered. */
  readable: boolean;
  /** Online runners carrying the fleet's labels (meaningful when readable). */
  online: number;
  /** Why the census failed, when unreadable. */
  error?: string;
}

export interface QueueInput {
  /** The Actions queue list endpoint answered. */
  readable: boolean;
  /** created_at of the oldest queued run, or null when the queue is empty. */
  oldestQueuedAt: string | null;
  /** Why the queue read failed, when unreadable. */
  error?: string;
}

export interface RouteInput {
  event: string;
  isFork: boolean;
  /** CI_RUNNER_FALLBACK_MINUTES repository variable (default 10). */
  fallbackMinutes?: string;
  now: number;
  census: CensusInput;
  queue: QueueInput;
}

export interface Route {
  runner: string;
  messages: RouteMessage[];
}

const EMPTY_CENSUS: CensusInput = { attempted: false, mintFailed: false, readable: true, online: 0 };

export function decideRoute(input: RouteInput): Route {
  const messages: RouteMessage[] = [];
  const done = (runner: string): Route => ({ runner, messages });
  const notice = (text: string) => messages.push({ warning: false, text });
  const warn = (text: string) => messages.push({ warning: true, text });

  if (input.event === 'merge_group' || input.isFork) {
    // Untrusted events never run on organisation hardware.
    notice('Untrusted event; hosted runners.');
    return done(HOSTED);
  }

  // The whole normalized value must be digits, matching the shell version
  // this replaced: parseInt alone would accept "2minutes" as 2 and route
  // hosted far earlier than configured.
  let fallback = 10;
  const normalized = (input.fallbackMinutes ?? '').replace(/\s/g, '');
  if (/^[0-9]+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    if (Number.isInteger(parsed) && parsed >= 0) fallback = parsed;
  }

  const census = input.census ?? EMPTY_CENSUS;
  if (census.attempted) {
    if (census.readable) {
      notice(`Fleet census: ${census.online} online runner(s) with the fleet labels.`);
      if (census.online === 0) {
        warn('No online self-hosted runner; routing onto hosted runners.');
        return done(HOSTED);
      }
    } else {
      warn(`Fleet census unreadable (${census.error ?? 'unknown error'}); relying on the queue signal.`);
    }
  } else if (census.mintFailed) {
    warn('Census token mint failed; relying on the queue signal.');
  } else {
    notice('No census credentials; relying on the queue signal.');
  }

  const queue = input.queue;
  if (!queue.readable) {
    warn(`Actions queue unreadable (${queue.error ?? 'unknown error'}); routing onto hosted runners.`);
    return done(HOSTED);
  }
  if (queue.oldestQueuedAt === null) {
    notice('Queue empty and the fleet census is healthy; organisation runners take this run.');
    return done(FLEET);
  }

  const oldest = Date.parse(queue.oldestQueuedAt);
  if (Number.isNaN(oldest)) {
    warn('Actions queue unreadable (unparsable oldest queued timestamp); routing onto hosted runners.');
    return done(HOSTED);
  }
  const ageMinutes = Math.floor((input.now - oldest) / 60000);
  if (ageMinutes >= fallback) {
    warn(`Self-hosted queue stalled for ${ageMinutes}m; routing onto hosted runners.`);
    return done(HOSTED);
  }
  notice(`Oldest queued run is ${ageMinutes}m old (fallback after ${fallback}m).`);
  return done(FLEET);
}

function describeError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/\s+/g, ' ').slice(0, 160);
}

interface GhResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

async function ghJson(token: string, url: string): Promise<GhResult> {
  const { execFile } = await import('node:child_process');
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('gh', ['api', url], { env: { ...process.env, GH_TOKEN: token }, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });
    return { ok: true, data: JSON.parse(stdout) };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

interface RunnerApiLabels {
  name?: string;
}

interface RunnerApiEntry {
  status?: string;
  labels?: RunnerApiLabels[];
}

interface RunnerApiResponse {
  runners?: RunnerApiEntry[];
}

interface WorkflowRunResponse {
  workflow_runs?: Array<{ created_at?: string }>;
}

function countOnlineFleetRunners(payload: unknown): number {
  const response = payload as RunnerApiResponse;
  return (response.runners ?? []).filter(
    (runner) =>
      runner.status === 'online' &&
      (runner.labels ?? []).some((label) => label.name === 'self-hosted') &&
      (runner.labels ?? []).some((label) => label.name === 'Linux') &&
      (runner.labels ?? []).some((label) => label.name === 'X64'),
  ).length;
}

function oldestQueuedRun(payload: unknown): string | null {
  const response = payload as WorkflowRunResponse;
  const times = (response.workflow_runs ?? [])
    .map((run) => run.created_at)
    .filter((created): created is string => typeof created === 'string');
  if (times.length === 0) return null;
  return times.reduce((oldest, created) => (Date.parse(created) < Date.parse(oldest) ? created : oldest));
}

function flag(name: string): boolean {
  return process.env[name] === 'true';
}

export async function main(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const org = repository.split('/')[0] ?? '';

  const census: CensusInput = { attempted: false, mintFailed: false, readable: true, online: 0 };
  if (flag('HAS_CENSUS_TOKEN')) {
    census.attempted = true;
    const result = await ghJson(process.env.CENSUS_TOKEN ?? '', `/orgs/${org}/actions/runners?per_page=100`);
    census.readable = result.ok;
    if (result.ok) {
      census.online = countOnlineFleetRunners(result.data);
    } else {
      census.error = result.error;
    }
  }
  census.mintFailed = flag('MINT_FAILED');

  const queueResult = await ghJson(
    process.env.GH_TOKEN ?? '',
    `/repos/${repository}/actions/runs?status=queued&per_page=100`,
  );
  const queue: QueueInput = { readable: queueResult.ok, oldestQueuedAt: null };
  if (queueResult.ok) {
    queue.oldestQueuedAt = oldestQueuedRun(queueResult.data);
  } else {
    queue.error = queueResult.error;
  }

  const route = decideRoute({
    event: process.env.EVENT_NAME ?? '',
    isFork: flag('IS_FORK'),
    fallbackMinutes: process.env.FALLBACK_MINUTES,
    now: Date.now(),
    census,
    queue,
  });

  for (const message of route.messages) {
    if (message.warning) {
      console.log(`::warning::${message.text}`);
    } else {
      console.log(message.text);
    }
  }

  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(output, `runner=${route.runner}\n`);
  } else {
    console.log(`runner=${route.runner}`);
  }
}

// Run directly by the route job; imported by tests, which must not execute.
if (process.env.VITEST !== 'true') {
  await main();
}
