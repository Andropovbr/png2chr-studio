import { describe, expect, it } from 'vitest';

import { toChrFileName } from './file-name';

describe('CHR file names', () => {
  it('replaces a PNG extension case-insensitively', () => {
    expect(toChrFileName('player.PNG')).toBe('player.chr');
  });

  it('preserves dots within the base name', () => {
    expect(toChrFileName('player.walk.png')).toBe('player.walk.chr');
  });
});
