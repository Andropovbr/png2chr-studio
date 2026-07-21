import { describe, expect, it } from 'vitest';

import {
  toAttributeTableFileName,
  toChrFileName,
  toNametableFileName,
} from './file-name';

describe('CHR file names', () => {
  it('replaces a PNG extension case-insensitively', () => {
    expect(toChrFileName('player.PNG')).toBe('player.chr');
  });

  it('preserves dots within the base name', () => {
    expect(toChrFileName('player.walk.png')).toBe('player.walk.chr');
  });

  it('creates playfield data file names from the PNG name', () => {
    expect(toNametableFileName('level-1.png')).toBe('level-1.nam');
    expect(toAttributeTableFileName('level-1.png')).toBe('level-1.atr');
  });
});
