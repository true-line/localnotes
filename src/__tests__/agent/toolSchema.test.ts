import { describe, it, expect } from 'vitest';
import { validateArgs } from '../../agent/toolSchema';

describe('validateArgs', () => {
  const schema = {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
    required: ['query'],
    additionalProperties: false,
  };

  it('accepts valid args', () => {
    expect(validateArgs({ query: 'x', limit: 5 }, schema).ok).toBe(true);
    expect(validateArgs({ query: 'x' }, schema).ok).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { ok, errors } = validateArgs({ limit: 3 }, schema);
    expect(ok).toBe(false);
    expect(errors.join(' ')).toContain('query: required but missing');
  });

  it('rejects wrong types and out-of-range integers', () => {
    const { errors } = validateArgs({ query: 42 }, schema);
    expect(errors.join(' ')).toContain('expected string, got number');
    expect(validateArgs({ query: 'x', limit: 0 }, schema).errors.join(' ')).toContain('below minimum');
    expect(validateArgs({ query: 'x', limit: 21 }, schema).errors.join(' ')).toContain('above maximum');
    expect(validateArgs({ query: 'x', limit: 1.5 }, schema).errors.join(' ')).toContain('expected integer');
  });

  it('rejects unknown fields when additionalProperties is false', () => {
    const { errors } = validateArgs({ query: 'x', evil: true }, schema);
    expect(errors.join(' ')).toContain('evil: unknown field');
  });

  it('supports enum and array items', () => {
    const s = {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['fast', 'deep'] },
        ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['mode'],
    };
    expect(validateArgs({ mode: 'fast', ids: ['a', 'b'] }, s).ok).toBe(true);
    expect(validateArgs({ mode: 'slow' }, s).errors.join(' ')).toContain('must be one of');
    expect(validateArgs({ mode: 'fast', ids: ['a', 1] }, s).errors.join(' ')).toContain('[1]: expected string');
  });
});
