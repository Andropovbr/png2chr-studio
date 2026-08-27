import { normalizeCIdentifier } from './c-identifier';
import { encodeNesBackgroundPalettes } from './nes-palette';
import {
  resolveActiveBackgroundPaletteSet,
  resolveActiveSpritePaletteSet,
  type DualBankPaletteState,
} from './palette-manager';

export const PALETTE_BANK_BYTE_COUNT = 16;
export const PPU_PALETTE_BYTE_COUNT = 32;

export interface CPaletteExport {
  readonly headerFileName: string;
  readonly sourceFileName: string;
  readonly header: string;
  readonly source: string;
  readonly estimatedRomBytes: number;
}

export interface Ca65PaletteExport {
  readonly includeFileName: string;
  readonly sourceFileName: string;
  readonly include: string;
  readonly source: string;
  readonly estimatedRomBytes: number;
}

export interface GenerateCPaletteExportOptions {
  /** Final symbol and file base. Defaults to "palette". */
  readonly symbolBase?: string;
}

export interface GenerateCa65PaletteExportOptions {
  /** Final symbol and file base. Defaults to "palette". */
  readonly symbolBase?: string;
  /** Assembly segment name. Defaults to "RODATA". */
  readonly segment?: string;
}

export function sanitizePaletteIdentifier(name: string): string {
  return normalizeCIdentifier(name) || 'palette';
}

function resolveBackgroundBytes(state: DualBankPaletteState): Uint8Array {
  return encodeNesBackgroundPalettes(
    resolveActiveBackgroundPaletteSet(
      state.palettes,
      state.activeBackgroundSlots,
      state.universalBackgroundColor,
    ),
  );
}

function resolveSpriteBytes(state: DualBankPaletteState): Uint8Array {
  return encodeNesBackgroundPalettes(
    resolveActiveSpritePaletteSet(
      state.palettes,
      state.activeSpriteSlots,
      undefined,
      state.universalBackgroundColor,
    ),
  );
}

/** Serializes Palette RAM $3F00..$3F0F from the canonical Background bank. */
export function exportBackgroundPaletteBinary(
  state: DualBankPaletteState,
): Uint8Array {
  return resolveBackgroundBytes(state);
}

/** Serializes Palette RAM $3F10..$3F1F from the canonical Sprite bank. */
export function exportSpritePaletteBinary(
  state: DualBankPaletteState,
): Uint8Array {
  return resolveSpriteBytes(state);
}

/** Serializes Palette RAM $3F00..$3F1F as 16 Background + 16 Sprite bytes. */
export function exportFullPpuPaletteBinary(
  state: DualBankPaletteState,
): Uint8Array {
  const bytes = new Uint8Array(PPU_PALETTE_BYTE_COUNT);
  bytes.set(resolveBackgroundBytes(state), 0);
  bytes.set(resolveSpriteBytes(state), PALETTE_BANK_BYTE_COUNT);
  return bytes;
}

function cHex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function asmHex(value: number): string {
  return `$${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function cPaletteRows(
  bytes: Uint8Array,
  bank: 'BG' | 'SPR',
  addressBase: number,
): string {
  return Array.from({ length: 4 }, (_, slotIndex) => {
    const offset = slotIndex * 4;
    const values = Array.from(bytes.subarray(offset, offset + 4)).map(cHex);
    const addressStart = addressBase + offset;
    const addressEnd = addressStart + 3;
    return `    /* ${bank} ${String(slotIndex)} ($${addressStart.toString(16).toUpperCase()}-$${addressEnd.toString(16).toUpperCase()}) */ ${values.join(', ')}${slotIndex === 3 ? '' : ','}`;
  }).join('\n');
}

function asmPaletteRows(
  bytes: Uint8Array,
  bank: 'BG' | 'SPR',
  addressBase: number,
): string {
  return Array.from({ length: 4 }, (_, slotIndex) => {
    const offset = slotIndex * 4;
    const values = Array.from(bytes.subarray(offset, offset + 4)).map(asmHex);
    const addressStart = addressBase + offset;
    const addressEnd = addressStart + 3;
    return `    .byte ${values.join(', ')} ; ${bank} ${String(slotIndex)} ($${addressStart.toString(16).toUpperCase()}-$${addressEnd.toString(16).toUpperCase()})`;
  }).join('\n');
}

/** Generates deterministic cc65-compatible palette declarations and tables. */
export function generateCPaletteExport(
  state: DualBankPaletteState,
  options: GenerateCPaletteExportOptions = {},
): CPaletteExport {
  const symbolBase = sanitizePaletteIdentifier(options.symbolBase ?? 'palette');
  const idUpper = symbolBase.toUpperCase();
  const headerFileName = `${symbolBase}.h`;
  const sourceFileName = `${symbolBase}.c`;
  const background = exportBackgroundPaletteBinary(state);
  const sprites = exportSpritePaletteBinary(state);

  const header = `#ifndef ${idUpper}_H
#define ${idUpper}_H

#define ${idUpper}_BANK_SIZE ${String(PALETTE_BANK_BYTE_COUNT)}
#define ${idUpper}_PPU_SIZE ${String(PPU_PALETTE_BYTE_COUNT)}
#define ${idUpper}_BG_OFFSET 0
#define ${idUpper}_SPR_OFFSET ${String(PALETTE_BANK_BYTE_COUNT)}
#define ${idUpper}_BG_SLOT_0_INDEX 0
#define ${idUpper}_BG_SLOT_1_INDEX 4
#define ${idUpper}_BG_SLOT_2_INDEX 8
#define ${idUpper}_BG_SLOT_3_INDEX 12
#define ${idUpper}_SPR_SLOT_0_INDEX 16
#define ${idUpper}_SPR_SLOT_1_INDEX 20
#define ${idUpper}_SPR_SLOT_2_INDEX 24
#define ${idUpper}_SPR_SLOT_3_INDEX 28

extern const unsigned char ${symbolBase}_bg[${idUpper}_BANK_SIZE];
extern const unsigned char ${symbolBase}_spr[${idUpper}_BANK_SIZE];

#endif
`;

  const source = `#include "${headerFileName}"

/* Background Palette RAM ($3F00-$3F0F). */
const unsigned char ${symbolBase}_bg[${idUpper}_BANK_SIZE] = {
${cPaletteRows(background, 'BG', 0x3f00)}
};

/* Sprite Palette RAM ($3F10-$3F1F). Color 0 entries mirror $3F00. */
const unsigned char ${symbolBase}_spr[${idUpper}_BANK_SIZE] = {
${cPaletteRows(sprites, 'SPR', 0x3f10)}
};
`;

  return {
    headerFileName,
    sourceFileName,
    header,
    source,
    estimatedRomBytes: PPU_PALETTE_BYTE_COUNT,
  };
}

/** Generates deterministic ca65-compatible palette symbols and data tables. */
export function generateCa65PaletteExport(
  state: DualBankPaletteState,
  options: GenerateCa65PaletteExportOptions = {},
): Ca65PaletteExport {
  const symbolBase = sanitizePaletteIdentifier(options.symbolBase ?? 'palette');
  const idUpper = symbolBase.toUpperCase();
  const includeFileName = `${symbolBase}.inc`;
  const sourceFileName = `${symbolBase}.s`;
  const requestedSegment = options.segment?.trim();
  const segment =
    requestedSegment === undefined || requestedSegment === ''
      ? 'RODATA'
      : requestedSegment;
  const background = exportBackgroundPaletteBinary(state);
  const sprites = exportSpritePaletteBinary(state);

  const include = `; Generated by PNG2CHR Studio palette export.
${idUpper}_BANK_SIZE = ${String(PALETTE_BANK_BYTE_COUNT)}
${idUpper}_PPU_SIZE = ${String(PPU_PALETTE_BYTE_COUNT)}
${idUpper}_BG_OFFSET = 0
${idUpper}_SPR_OFFSET = ${String(PALETTE_BANK_BYTE_COUNT)}
${idUpper}_BG_SLOT_0_INDEX = 0
${idUpper}_BG_SLOT_1_INDEX = 4
${idUpper}_BG_SLOT_2_INDEX = 8
${idUpper}_BG_SLOT_3_INDEX = 12
${idUpper}_SPR_SLOT_0_INDEX = 16
${idUpper}_SPR_SLOT_1_INDEX = 20
${idUpper}_SPR_SLOT_2_INDEX = 24
${idUpper}_SPR_SLOT_3_INDEX = 28

.import ${symbolBase}_bg
.import ${symbolBase}_spr
`;

  const source = `; Generated by PNG2CHR Studio palette export.
.export ${symbolBase}_bg
.export ${symbolBase}_spr

.segment "${segment}"

; Background Palette RAM ($3F00-$3F0F).
${symbolBase}_bg:
${asmPaletteRows(background, 'BG', 0x3f00)}

; Sprite Palette RAM ($3F10-$3F1F). Color 0 entries mirror $3F00.
${symbolBase}_spr:
${asmPaletteRows(sprites, 'SPR', 0x3f10)}
`;

  return {
    includeFileName,
    sourceFileName,
    include,
    source,
    estimatedRomBytes: PPU_PALETTE_BYTE_COUNT,
  };
}
