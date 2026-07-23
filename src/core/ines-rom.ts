const INES_HEADER_SIZE = 16;
const TRAINER_SIZE = 512;
const PRG_BANK_SIZE = 16 * 1024;
const CHR_BANK_SIZE = 8 * 1024;

export type InesRomErrorCode =
  | 'invalid-header'
  | 'nes2-unsupported'
  | 'mapper-unsupported'
  | 'prg-size-unsupported'
  | 'chr-ram-unsupported'
  | 'chr-size-unsupported'
  | 'truncated-rom';

export class InesRomError extends Error {
  public constructor(
    public readonly code: InesRomErrorCode,
    public readonly mapper?: number,
  ) {
    super(code);
    this.name = 'InesRomError';
  }
}

export interface ParsedNrom {
  readonly chr: Uint8Array;
  readonly prgSize: number;
  readonly hasTrainer: boolean;
}

export function extractNromChr(rom: Uint8Array): ParsedNrom {
  if (
    rom.length < INES_HEADER_SIZE ||
    rom[0] !== 0x4e ||
    rom[1] !== 0x45 ||
    rom[2] !== 0x53 ||
    rom[3] !== 0x1a
  ) {
    throw new InesRomError('invalid-header');
  }

  const prgBanks = rom[4] ?? 0;
  const chrBanks = rom[5] ?? 0;
  const flags6 = rom[6] ?? 0;
  const flags7 = rom[7] ?? 0;
  if ((flags7 & 0x0c) === 0x08) {
    throw new InesRomError('nes2-unsupported');
  }

  const mapper = (flags6 >> 4) | (flags7 & 0xf0);
  if (mapper !== 0) {
    throw new InesRomError('mapper-unsupported', mapper);
  }
  if (prgBanks !== 1 && prgBanks !== 2) {
    throw new InesRomError('prg-size-unsupported');
  }
  if (chrBanks === 0) {
    throw new InesRomError('chr-ram-unsupported');
  }
  if (chrBanks !== 1) {
    throw new InesRomError('chr-size-unsupported');
  }

  const hasTrainer = (flags6 & 0x04) !== 0;
  const prgSize = prgBanks * PRG_BANK_SIZE;
  const chrOffset =
    INES_HEADER_SIZE + (hasTrainer ? TRAINER_SIZE : 0) + prgSize;
  const chrEnd = chrOffset + CHR_BANK_SIZE;
  if (rom.length < chrEnd) {
    throw new InesRomError('truncated-rom');
  }

  return {
    chr: rom.slice(chrOffset, chrEnd),
    prgSize,
    hasTrainer,
  };
}
