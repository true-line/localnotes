// Minimal JSON Schema validator for tool arguments. Supports the subset the
// tier-0 tools declare: type, properties, required, enum, items, minimum,
// maximum, minLength, maxLength. Deliberately dependency-free; swap in a
// full library behind this interface if M4 providers need richer schemas.

interface SchemaIssues {
  ok: boolean;
  errors: string[];
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function checkValue(
  path: string,
  value: unknown,
  schema: Record<string, unknown>,
  errors: string[]
): void {
  const expected = schema.type;
  if (typeof expected === 'string') {
    const actual = typeOf(value);
    const matches =
      actual === expected ||
      (expected === 'integer' && actual === 'number' && Number.isInteger(value));
    if (!matches) {
      errors.push(`${path || 'args'}: expected ${expected}, got ${actual}`);
      return;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path || 'args'}: must be one of ${schema.enum.map(String).join(', ')}`);
  }

  if (expected === 'string' || typeOf(value) === 'string') {
    const s = value as string;
    if (typeof schema.minLength === 'number' && s.length < schema.minLength) {
      errors.push(`${path || 'args'}: shorter than minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && s.length > schema.maxLength) {
      errors.push(`${path || 'args'}: longer than maxLength ${schema.maxLength}`);
    }
  }

  if (expected === 'number' || expected === 'integer') {
    const n = value as number;
    if (typeof schema.minimum === 'number' && n < schema.minimum) {
      errors.push(`${path || 'args'}: below minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && n > schema.maximum) {
      errors.push(`${path || 'args'}: above maximum ${schema.maximum}`);
    }
  }

  if (expected === 'array' && Array.isArray(value)) {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      value.forEach((item, i) => checkValue(`${path}[${i}]`, item, items, errors));
    }
  }

  if (expected === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    checkObject(path, value as Record<string, unknown>, schema, errors);
  }
}

function checkObject(
  path: string,
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  errors: string[]
): void {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const key of (schema.required as string[] | undefined) ?? []) {
    if (!(key in value)) {
      errors.push(`${path ? path + '.' : ''}${key}: required but missing`);
    }
  }
  for (const [key, item] of Object.entries(value)) {
    const propSchema = properties[key];
    if (propSchema) {
      checkValue(path ? `${path}.${key}` : key, item, propSchema, errors);
    } else if (schema.additionalProperties === false) {
      errors.push(`${path ? path + '.' : ''}${key}: unknown field`);
    }
  }
}

export function validateArgs(
  args: unknown,
  schema: Record<string, unknown>
): SchemaIssues {
  const errors: string[] = [];
  checkValue('', args, schema, errors);
  return { ok: errors.length === 0, errors };
}
