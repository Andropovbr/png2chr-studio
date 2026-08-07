import { describe, expect, it } from 'vitest';

import { NES_CHR_ROM_MINIMUM_SIZE, padChrRom } from './chr-rom';

describe('NES CHR-ROM output', () => {
  it('pads small CHR data to one 8 KiB ROM bank', () => {
    const source = Uint8Array.of(0x12, 0x34, 0x56);
    const padded = padChrRom(source);

    expect(padded).toHaveLength(NES_CHR_ROM_MINIMUM_SIZE);
    expect(Array.from(padded.slice(0, source.length))).toEqual([
      0x12, 0x34, 0x56,
    ]);
    expect(padded.slice(source.length).every((byte) => byte === 0)).toBe(true);
    expect(source).toEqual(Uint8Array.of(0x12, 0x34, 0x56));
  });

  it('does not truncate CHR data larger than 8 KiB', () => {
    const source = new Uint8Array(NES_CHR_ROM_MINIMUM_SIZE + 16).fill(0xa5);
    const result = padChrRom(source);

    expect(result).toBe(source);
    expect(result).toHaveLength(NES_CHR_ROM_MINIMUM_SIZE + 16);
    expect(result[result.length - 1]).toBe(0xa5);
  });
});
