const C_RESERVED_WORDS = new Set([
  'auto',
  'break',
  'case',
  'char',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extern',
  'float',
  'for',
  'goto',
  'if',
  'int',
  'long',
  'register',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'struct',
  'switch',
  'typedef',
  'union',
  'unsigned',
  'void',
  'volatile',
  'while',
]);

export function normalizeCIdentifier(value: string): string {
  const ascii = value
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!ascii) return '';
  const withSafeStart = /^\d/.test(ascii) ? `_${ascii}` : ascii;
  return C_RESERVED_WORDS.has(withSafeStart)
    ? `${withSafeStart}_animation`
    : withSafeStart;
}

export function combineCIdentifiers(...values: readonly string[]): string {
  const normalized = values.map(normalizeCIdentifier);
  return normalized.some((value) => value.length === 0)
    ? ''
    : normalized.join('_').replace(/_+/g, '_');
}

export function isValidCIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
