// Routing rules for the runner fleet probe (scripts/runner-route.ts), which
// the Version cut outage of 2026-10-30 showed must hold exactly: the probe
// once masked a broken queue read as an empty queue and routed a stalled
// fleet's run onto that same fleet. Each rule below pins one observable
// decision, including the degraded paths (unreadable census, failed mint,
// unreadable queue).

import { describe, expect, it } from 'vitest';

import { FLEET, HOSTED, decideRoute } from '../../scripts/runner-route.ts';
import type { CensusInput, QueueInput, RouteInput } from '../../scripts/runner-route.ts';

const NOW = Date.parse('2026-10-30T16:00:00Z');

function census(overrides: Partial<CensusInput> = {}): CensusInput {
  return { attempted: true, mintFailed: false, readable: true, online: 5, ...overrides };
}

function queue(overrides: Partial<QueueInput> = {}): QueueInput {
  return { readable: true, oldestQueuedAt: null, ...overrides };
}

function route(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    event: 'push',
    isFork: false,
    fallbackMinutes: '10',
    now: NOW,
    census: census(),
    queue: queue(),
    ...overrides,
  };
}

function warnings(input: RouteInput): string[] {
  return decideRoute(input).messages.filter((message) => message.warning).map((message) => message.text);
}

describe('decideRoute', () => {
  it('routes untrusted events onto hosted runners', () => {
    expect(decideRoute(route({ event: 'merge_group' })).runner).toBe(HOSTED);
    expect(decideRoute(route({ isFork: true })).runner).toBe(HOSTED);
    expect(warnings(route({ isFork: true }))).toEqual([]);
  });

  it('routes hosted when the census finds no online fleet runner', () => {
    const input = route({ census: census({ online: 0 }) });
    expect(decideRoute(input).runner).toBe(HOSTED);
    expect(warnings(input)).toEqual(['No online self-hosted runner; routing onto hosted runners.']);
  });

  it('routes hosted when the census is empty even with a fresh queue', () => {
    // Census precedence: an empty fleet routes hosted regardless of queue
    // age, because the queue evidence cannot exist before dispatch.
    const input = route({ census: census({ online: 0 }), queue: queue({ oldestQueuedAt: '2026-10-30T15:59:00Z' }) });
    expect(decideRoute(input).runner).toBe(HOSTED);
  });

  it('degrades to the queue signal when the census API is unreadable', () => {
    const input = route({ census: census({ readable: false, error: 'HTTP 502' }) });
    expect(decideRoute(input).runner).toBe(FLEET);
    expect(warnings(input)).toEqual(['Fleet census unreadable (HTTP 502); relying on the queue signal.']);
  });

  it('still routes hosted on a stalled queue when the census is unreadable', () => {
    const input = route({
      census: census({ readable: false, error: 'HTTP 502' }),
      queue: queue({ oldestQueuedAt: '2026-10-30T15:00:00Z' }),
    });
    expect(decideRoute(input).runner).toBe(HOSTED);
  });

  it('distinguishes a failed mint from absent credentials', () => {
    const mintFailed = route({ census: census({ attempted: false, mintFailed: true }) });
    expect(decideRoute(mintFailed).runner).toBe(FLEET);
    expect(warnings(mintFailed)).toEqual(['Census token mint failed; relying on the queue signal.']);

    const absent = route({ census: census({ attempted: false, mintFailed: false }) });
    expect(decideRoute(absent).runner).toBe(FLEET);
    expect(warnings(absent)).toEqual([]);
  });

  it('routes hosted when the queue read fails, even with a healthy census', () => {
    const input = route({ queue: queue({ readable: false, error: 'rate limit' }) });
    expect(decideRoute(input).runner).toBe(HOSTED);
    expect(warnings(input)).toEqual(['Actions queue unreadable (rate limit); routing onto hosted runners.']);
  });

  it('routes hosted on an unparsable oldest-queued timestamp', () => {
    const input = route({ queue: queue({ oldestQueuedAt: 'not-a-date' }) });
    expect(decideRoute(input).runner).toBe(HOSTED);
  });

  it('routes onto the fleet for an empty queue and a healthy census', () => {
    const result = decideRoute(route());
    expect(result.runner).toBe(FLEET);
    expect(result.messages.map((message) => message.text)).toContain(
      'Queue empty and the fleet census is healthy; organisation runners take this run.',
    );
  });

  it('keeps the fleet while the oldest queued run is under the fallback', () => {
    const input = route({ queue: queue({ oldestQueuedAt: '2026-10-30T15:55:00Z' }) });
    const result = decideRoute(input);
    expect(result.runner).toBe(FLEET);
    expect(result.messages.map((message) => message.text)).toContain(
      'Oldest queued run is 5m old (fallback after 10m).',
    );
  });

  it('routes hosted once the oldest queued run reaches the fallback', () => {
    const input = route({ queue: queue({ oldestQueuedAt: '2026-10-30T15:30:00Z' }) });
    expect(decideRoute(input).runner).toBe(HOSTED);
    expect(warnings(input)).toEqual(['Self-hosted queue stalled for 30m; routing onto hosted runners.']);
  });

  it('honours the configured fallback threshold', () => {
    const input = route({
      fallbackMinutes: '2',
      queue: queue({ oldestQueuedAt: '2026-10-30T15:57:30Z' }),
    });
    expect(decideRoute(input).runner).toBe(HOSTED);
  });

  it('falls back to a 10 minute threshold for unusable variables', () => {
    for (const fallbackMinutes of ['', '  ', 'ten', '-5']) {
      const fleet = route({
        fallbackMinutes,
        queue: queue({ oldestQueuedAt: '2026-10-30T15:55:00Z' }),
      });
      expect(decideRoute(fleet).runner).toBe(FLEET);
      const hosted = route({
        fallbackMinutes,
        queue: queue({ oldestQueuedAt: '2026-10-30T15:45:00Z' }),
      });
      expect(decideRoute(hosted).runner).toBe(HOSTED);
    }
  });
});
