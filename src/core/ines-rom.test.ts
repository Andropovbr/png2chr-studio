import { describe, expect, it } from 'vitest';

import { extractNromChr, InesRomError } from './ines-rom';

const HEADER_SIZE = 16;
const TRAINER_SIZE = 512;
const PRG_BANK_SIZE = 16 * 1024;
const CHR_SIZE = 8 * 1024;

function createRom(
  options: {
    prgBanks?: number;
    chrBanks?: number;
    flags6?: number;
    flags7?: number;
    truncate?: number;
  } = {},
): Uint8Array {
  const prgBanks = options.prgBanks ?? 1;
  const chrBanks = options.chrBanks ?? 1;
  const trainerSize = ((options.flags6 ?? 0) & 0x04) === 0 ? 0 : TRAINER_SIZE;
  const size =
    HEADER_SIZE +
    trainerSize +
    prgBanks * PRG_BANK_SIZE +
    chrBanks * CHR_SIZE -
    (options.truncate ?? 0);
  const rom = new Uint8Array(Math.max(HEADER_SIZE, size));
  rom.set([0x4e, 0x45, 0x53, 0x1a, prgBanks, chrBanks]);
  rom[6] = options.flags6 ?? 0;
  rom[7] = options.flags7 ?? 0;
  const chrOffset = HEADER_SIZE + trainerSize + prgBanks * PRG_BANK_SIZE;
  if (chrOffset < rom.length) {
    rom.fill(0xa5, chrOffset);
  }
  return rom;
}

describe('iNES NROM parsing', () => {
  it('extracts one 8 KB CHR-ROM bank after a 16 KB PRG', () => {
    const parsed = extractNromChr(createRom());

    expect(parsed).toMatchObject({ prgSize: PRG_BANK_SIZE, hasTrainer: false });
    expect(parsed.chr).toHaveLength(CHR_SIZE);
    expect(parsed.chr[0]).toBe(0xa5);
  });

  it('skips a trainer and a 32 KB PRG before reading CHR', () => {
    const parsed = extractNromChr(createRom({ prgBanks: 2, flags6: 0x04 }));

    expect(parsed).toMatchObject({
      prgSize: 2 * PRG_BANK_SIZE,
      hasTrainer: true,
    });
    expect(parsed.chr[0]).toBe(0xa5);
  });

  it.each([
    ['nes2-unsupported', { flags7: 0x08 }],
    ['mapper-unsupported', { flags6: 0x10 }],
    ['prg-size-unsupported', { prgBanks: 3 }],
    ['chr-ram-unsupported', { chrBanks: 0 }],
    ['chr-size-unsupported', { chrBanks: 2 }],
    ['truncated-rom', { truncate: 1 }],
  ] as const)('rejects %s ROMs', (code, options) => {
    expect(() => extractNromChr(createRom(options))).toThrow(
      expect.objectContaining<Partial<InesRomError>>({ code }),
    );
  });

  it('rejects files without the iNES magic bytes', () => {
    expect(() => extractNromChr(new Uint8Array(16))).toThrow(
      expect.objectContaining<Partial<InesRomError>>({
        code: 'invalid-header',
      }),
    );
  });
});
