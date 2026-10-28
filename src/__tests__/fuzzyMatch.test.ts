import { describe, it, expect } from 'vitest';
import { fuzzyScore } from '../fuzzyMatch';

describe('fuzzyScore', () => {
  it('scores an empty query as a neutral match', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('returns -1 when the query cannot match', () => {
    expect(fuzzyScore('xyz', 'kitten')).toBe(-1);
    expect(fuzzyScore('kitten', '')).toBe(-1);
  });

  it('ranks prefix matches above substring matches above subsequences', () => {
    const prefix = fuzzyScore('note', 'notes app');
    const substring = fuzzyScore('note', 'my notebook');
    const subsequence = fuzzyScore('nt', 'note');
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
  });

  it('prefers word-boundary and consecutive-character matches', () => {
    const boundary = fuzzyScore('cat', 'the cat sat');
    const scattered = fuzzyScore('cat', 'chn a t'); // c..a..t spread out
    expect(boundary).toBeGreaterThan(scattered);
  });

  it('is case-insensitive and trims the query', () => {
    expect(fuzzyScore('  NOTE ', 'Notes')).toBeGreaterThan(0);
  });
});
