import { describe, expect, it } from 'vitest';

import { NES_CHR_ROM_MINIMUM_SIZE } from '../core/chr-rom';
import { prepareBinaryDownload } from './download';

describe('binary download preparation', () => {
  it('pads CHR file names case-insensitively', () => {
    expect(prepareBinaryDownload(Uint8Array.of(1), 'player.CHR')).toHaveLength(
      NES_CHR_ROM_MINIMUM_SIZE,
    );
  });

  it('leaves other binary formats unchanged', () => {
    const palette = Uint8Array.of(1, 2, 3, 4);
    expect(prepareBinaryDownload(palette, 'player.pal')).toBe(palette);
  });
});
