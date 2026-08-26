/**
 * Pure exporters for Background Maps (Milestone 8: Background Pipeline, Issue #112).
 *
 * Implements pure, deterministic serialization of compiled BackgroundProjectModel into:
 * 1. .nam (960 bytes Nametable binary);
 * 2. .atr (64 bytes Attribute Table binary);
 * 3. .map (1024 bytes combined Nametable + Attribute Table binary);
 * 4. .chr (8192 bytes full CHR or 4096 bytes Pattern Table slice);
 * 5. .pal (16 bytes NES background palette);
 * 6. cc65 C header and source (.h / .c);
 * 7. ca65 Assembly include and source (.inc / .s).
 */

import {
  ATTRIBUTE_TABLE_BYTE_COUNT,
  BACKGROUND_HEIGHT_TILES,
  BACKGROUND_WIDTH_TILES,
  BackgroundModelError,
  FULL_MAP_BUFFER_BYTE_COUNT,
  NAMETABLE_BYTE_COUNT,
  type BackgroundProjectModel,
} from './background-model';
import { normalizeCIdentifier } from './c-identifier';
import { encodeNesBackgroundPalettes, type NesPaletteSet } from './nes-palette';

export interface CBackgroundExport {
  readonly headerFileName: string;
  readonly sourceFileName: string;
  readonly header: string;
  readonly source: string;
  readonly estimatedRomBytes: number;
}

export interface Ca65BackgroundExport {
  readonly includeFileName: string;
  readonly sourceFileName: string;
  readonly include: string;
  readonly source: string;
  readonly estimatedRomBytes: number;
}

export interface GenerateCBackgroundExportOptions {
  /** Custom symbol base identifier. Defaults to sanitized map name or map id. */
  readonly symbolBase?: string;
  /** Whether to include the combined 1024-byte full map array in the export. Defaults to false. */
  readonly includeFullMap?: boolean;
}

export interface GenerateCa65BackgroundExportOptions {
  /** Custom symbol base identifier. Defaults to sanitized map name or map id. */
  readonly symbolBase?: string;
  /** Assembly segment name. Defaults to "RODATA". */
  readonly segment?: string;
  /** Whether to include the combined 1024-byte full map in the export. Defaults to false. */
  readonly includeFullMap?: boolean;
}

export interface ExportBackgroundChrOptions {
  /**
   * If true (default), returns the full 8192-byte (8 KiB) CHR-ROM buffer.
   * If false, returns the 4096-byte (4 KiB) slice corresponding to the background's Pattern Table.
   */
  readonly fullChr?: boolean;
}

/**
 * Sanitizes a string into a valid C/ASM identifier for background symbols.
 */
export function sanitizeBackgroundIdentifier(name: string): string {
  return normalizeCIdentifier(name) || 'background_map';
}

function hex2(val: number): string {
  return `0x${(val & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
}

function asmHex2(val: number): string {
  return `$${(val & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
}

/**
 * Validates basic buffer integrity of a BackgroundProjectModel before export.
 */
export function validateBackgroundProjectModelForExport(
  model: BackgroundProjectModel,
): void {
  if (model.nametable.length !== NAMETABLE_BYTE_COUNT) {
    throw new BackgroundModelError('invalid-dimensions', {
      nametableLength: model.nametable.length,
      expected: NAMETABLE_BYTE_COUNT,
    });
  }
  if (model.attributeTable.length !== ATTRIBUTE_TABLE_BYTE_COUNT) {
    throw new BackgroundModelError('invalid-dimensions', {
      attributeTableLength: model.attributeTable.length,
      expected: ATTRIBUTE_TABLE_BYTE_COUNT,
    });
  }
  const pt = model.patternTable as unknown;
  if (pt !== 0 && pt !== 1) {
    throw new BackgroundModelError('invalid-pattern-table', {
      patternTable: model.patternTable,
    });
  }
}

/**
 * Exports the compiled 960-byte Nametable binary (.nam).
 * Pure serializer: returns an exact byte-for-byte copy of model.nametable.
 */
export function exportBackgroundNametable(
  model: BackgroundProjectModel,
): Uint8Array {
  validateBackgroundProjectModelForExport(model);
  return new Uint8Array(model.nametable);
}

/**
 * Exports the compiled 64-byte Attribute Table binary (.atr).
 * Pure serializer: returns an exact byte-for-byte copy of model.attributeTable.
 */
export function exportBackgroundAttributeTable(
  model: BackgroundProjectModel,
): Uint8Array {
  validateBackgroundProjectModelForExport(model);
  return new Uint8Array(model.attributeTable);
}

/**
 * Exports the combined 1024-byte map binary (.map = 960B Nametable + 64B Attribute Table).
 * Pure serializer: returns an exact byte-for-byte copy of model.fullMapBuffer.
 */
export function exportBackgroundFullMap(
  model: BackgroundProjectModel,
): Uint8Array {
  validateBackgroundProjectModelForExport(model);
  if (model.fullMapBuffer.length === FULL_MAP_BUFFER_BYTE_COUNT) {
    return new Uint8Array(model.fullMapBuffer);
  }
  const buffer = new Uint8Array(FULL_MAP_BUFFER_BYTE_COUNT);
  buffer.set(model.nametable, 0);
  buffer.set(model.attributeTable, NAMETABLE_BYTE_COUNT);
  return buffer;
}

/**
 * Exports the CHR binary for the background model.
 * If options.fullChr is false, exports only the 4096 bytes of the Pattern Table used by this map.
 * Otherwise (default), exports the entire 8192-byte CHR-ROM buffer.
 */
export function exportBackgroundChr(
  model: BackgroundProjectModel,
  options: ExportBackgroundChrOptions = {},
): Uint8Array {
  validateBackgroundProjectModelForExport(model);
  const full = options.fullChr !== false;
  if (full) {
    if (model.finalChr.length !== 8192) {
      throw new BackgroundModelError('invalid-dimensions', {
        chrLength: model.finalChr.length,
        expected: 8192,
      });
    }
    return new Uint8Array(model.finalChr);
  }

  // 4096 bytes Pattern Table slice
  const start = model.patternTable * 4096;
  const end = start + 4096;
  if (model.finalChr.length < end) {
    throw new BackgroundModelError('invalid-dimensions', {
      chrLength: model.finalChr.length,
      expected: end,
    });
  }
  return new Uint8Array(model.finalChr.subarray(start, end));
}

/**
 * Explicitly exports only the 4096 bytes (4 KiB) of the Pattern Table used by this background.
 */
export function exportBackgroundPatternTableChr(
  model: BackgroundProjectModel,
): Uint8Array {
  return exportBackgroundChr(model, { fullChr: false });
}

/**
 * Exports the 16-byte NES background palette binary (.pal) for the given palette set.
 */
export function exportBackgroundPalette(paletteSet: NesPaletteSet): Uint8Array {
  return encodeNesBackgroundPalettes(paletteSet);
}

/**
 * Generates cc65-compatible C header (.h) and source (.c) files for the background map.
 */
export function generateCBackgroundExport(
  model: BackgroundProjectModel,
  options: GenerateCBackgroundExportOptions = {},
): CBackgroundExport {
  validateBackgroundProjectModelForExport(model);

  const rawName =
    typeof model.map.name === 'string' && model.map.name.trim() !== ''
      ? model.map.name
      : model.map.id;
  const symbolBase = sanitizeBackgroundIdentifier(
    options.symbolBase ?? rawName,
  );
  const idUpper = symbolBase.toUpperCase();
  const guard = `${idUpper}_H`;
  const headerFileName = `${symbolBase}.h`;
  const sourceFileName = `${symbolBase}.c`;
  const includeFullMap = options.includeFullMap === true;

  // Format Nametable (30 rows of 32 tiles)
  const nametableRowStrings: string[] = [];
  for (let row = 0; row < BACKGROUND_HEIGHT_TILES; row += 1) {
    const start = row * BACKGROUND_WIDTH_TILES;
    const end = start + BACKGROUND_WIDTH_TILES;
    const tiles = Array.from(model.nametable.subarray(start, end)).map(hex2);
    const isLast = row === BACKGROUND_HEIGHT_TILES - 1;
    nametableRowStrings.push(
      `    /* Row ${String(row).padStart(2, '0')} (Y: ${(row * 8).toString().padStart(3, ' ')}px) */\n    ${tiles.join(', ')}${isLast ? '' : ','}`,
    );
  }

  // Format Attribute Table (8 rows of 8 bytes)
  const attributeRowStrings: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    const start = row * 8;
    const end = start + 8;
    const bytes = Array.from(model.attributeTable.subarray(start, end)).map(
      hex2,
    );
    const isLast = row === 7;
    attributeRowStrings.push(
      `    /* Attr Row ${String(row)} (Y: ${(row * 32).toString().padStart(3, ' ')}px) */\n    ${bytes.join(', ')}${isLast ? '' : ','}`,
    );
  }

  // Optional combined full map buffer (32 rows of 32 bytes)
  let fullMapHeaderDecl = '';
  let fullMapSourceDef = '';
  if (includeFullMap) {
    const fullMap = exportBackgroundFullMap(model);
    const fullMapRowStrings: string[] = [];
    for (let row = 0; row < 32; row += 1) {
      const start = row * 32;
      const end = start + 32;
      const bytes = Array.from(fullMap.subarray(start, end)).map(hex2);
      const isLast = row === 31;
      const label =
        row < 30
          ? `Nametable Row ${String(row)}`
          : `Attribute Row ${String((row - 30) * 4)}-${String((row - 30) * 4 + 3)}`;
      fullMapRowStrings.push(
        `    /* ${label} */\n    ${bytes.join(', ')}${isLast ? '' : ','}`,
      );
    }
    fullMapHeaderDecl = `\nextern const unsigned char ${symbolBase}_full_map[${idUpper}_FULL_MAP_SIZE];`;
    fullMapSourceDef = `\n/* Combined Nametable + Attribute Table (1024 bytes) */\nconst unsigned char ${symbolBase}_full_map[${idUpper}_FULL_MAP_SIZE] = {\n${fullMapRowStrings.join('\n')}\n};\n`;
  }

  const header = `#ifndef ${guard}
#define ${guard}

#include <stdint.h>

/* Target Pattern Table: ${String(model.patternTable)} (${model.patternTable === 0 ? '$0000' : '$1000'}) */
#define ${idUpper}_BACKGROUND_PATTERN_TABLE ${String(model.patternTable)}
#define ${idUpper}_NAMETABLE_WIDTH_TILES ${String(BACKGROUND_WIDTH_TILES)}
#define ${idUpper}_NAMETABLE_HEIGHT_TILES ${String(BACKGROUND_HEIGHT_TILES)}
#define ${idUpper}_NAMETABLE_SIZE ${String(NAMETABLE_BYTE_COUNT)}
#define ${idUpper}_ATTRIBUTE_TABLE_SIZE ${String(ATTRIBUTE_TABLE_BYTE_COUNT)}
#define ${idUpper}_FULL_MAP_SIZE ${String(FULL_MAP_BUFFER_BYTE_COUNT)}

extern const unsigned char ${symbolBase}_nametable[${idUpper}_NAMETABLE_SIZE];
extern const unsigned char ${symbolBase}_attribute_table[${idUpper}_ATTRIBUTE_TABLE_SIZE];
extern const uint8_t ${symbolBase}_background_pattern_table;${fullMapHeaderDecl}

#endif
`;

  const source = `#include "${headerFileName}"

/* Nametable (32x30 tiles, 960 bytes, Pattern Table ${String(model.patternTable)}) */
const unsigned char ${symbolBase}_nametable[${idUpper}_NAMETABLE_SIZE] = {
${nametableRowStrings.join('\n')}
};

/* Attribute Table (8x8 bytes, 64 bytes) */
const unsigned char ${symbolBase}_attribute_table[${idUpper}_ATTRIBUTE_TABLE_SIZE] = {
${attributeRowStrings.join('\n')}
};

const uint8_t ${symbolBase}_background_pattern_table = ${String(model.patternTable)};
${fullMapSourceDef}`;

  const estimatedRomBytes =
    NAMETABLE_BYTE_COUNT +
    ATTRIBUTE_TABLE_BYTE_COUNT +
    (includeFullMap ? FULL_MAP_BUFFER_BYTE_COUNT : 0) +
    1;

  return {
    headerFileName,
    sourceFileName,
    header,
    source,
    estimatedRomBytes,
  };
}

/**
 * Generates ca65-compatible Assembly include (.inc) and source (.s) files for the background map.
 */
export function generateCa65BackgroundExport(
  model: BackgroundProjectModel,
  options: GenerateCa65BackgroundExportOptions = {},
): Ca65BackgroundExport {
  validateBackgroundProjectModelForExport(model);

  const rawName =
    typeof model.map.name === 'string' && model.map.name.trim() !== ''
      ? model.map.name
      : model.map.id;
  const symbolBase = sanitizeBackgroundIdentifier(
    options.symbolBase ?? rawName,
  );
  const idUpper = symbolBase.toUpperCase();
  const includeFileName = `${symbolBase}.inc`;
  const sourceFileName = `${symbolBase}.s`;
  const segment =
    options.segment && options.segment.trim() !== ''
      ? options.segment.trim()
      : 'RODATA';
  const includeFullMap = options.includeFullMap === true;

  // Format Nametable (30 rows of 32 tiles)
  const nametableRowStrings: string[] = [];
  for (let row = 0; row < BACKGROUND_HEIGHT_TILES; row += 1) {
    const start = row * BACKGROUND_WIDTH_TILES;
    const end = start + BACKGROUND_WIDTH_TILES;
    const tiles = Array.from(model.nametable.subarray(start, end)).map(asmHex2);
    nametableRowStrings.push(
      `    .byte ${tiles.join(', ')} ; Row ${String(row).padStart(2, '0')} (Y: ${(row * 8).toString().padStart(3, ' ')}px)`,
    );
  }

  // Format Attribute Table (8 rows of 8 bytes)
  const attributeRowStrings: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    const start = row * 8;
    const end = start + 8;
    const bytes = Array.from(model.attributeTable.subarray(start, end)).map(
      asmHex2,
    );
    attributeRowStrings.push(
      `    .byte ${bytes.join(', ')} ; Attr Row ${String(row)} (Y: ${(row * 32).toString().padStart(3, ' ')}px)`,
    );
  }

  // Optional combined full map buffer (32 rows of 32 bytes)
  let fullMapIncDecl = '';
  let fullMapExportDecl = '';
  let fullMapSourceDef = '';
  if (includeFullMap) {
    const fullMap = exportBackgroundFullMap(model);
    const fullMapRowStrings: string[] = [];
    for (let row = 0; row < 32; row += 1) {
      const start = row * 32;
      const end = start + 32;
      const bytes = Array.from(fullMap.subarray(start, end)).map(asmHex2);
      const label =
        row < 30
          ? `Nametable Row ${String(row)}`
          : `Attribute Row ${String((row - 30) * 4)}-${String((row - 30) * 4 + 3)}`;
      fullMapRowStrings.push(`    .byte ${bytes.join(', ')} ; ${label}`);
    }
    fullMapIncDecl = `\n.import ${symbolBase}_full_map`;
    fullMapExportDecl = `\n.export ${symbolBase}_full_map`;
    fullMapSourceDef = `\n; Combined Nametable + Attribute Table (1024 bytes)\n${symbolBase}_full_map:\n${fullMapRowStrings.join('\n')}\n`;
  }

  const include = `; Generated by PNG2CHR Studio background export.
; Target Pattern Table: ${String(model.patternTable)} (${model.patternTable === 0 ? '$0000' : '$1000'}).
${idUpper}_BACKGROUND_PATTERN_TABLE = ${String(model.patternTable)}
${idUpper}_NAMETABLE_WIDTH_TILES = ${String(BACKGROUND_WIDTH_TILES)}
${idUpper}_NAMETABLE_HEIGHT_TILES = ${String(BACKGROUND_HEIGHT_TILES)}
${idUpper}_NAMETABLE_SIZE = ${String(NAMETABLE_BYTE_COUNT)}
${idUpper}_ATTRIBUTE_TABLE_SIZE = ${String(ATTRIBUTE_TABLE_BYTE_COUNT)}
${idUpper}_FULL_MAP_SIZE = ${String(FULL_MAP_BUFFER_BYTE_COUNT)}

.import ${symbolBase}_nametable
.import ${symbolBase}_attribute_table
.import ${symbolBase}_background_pattern_table${fullMapIncDecl}
`;

  const source = `; Generated by PNG2CHR Studio background export.
.export ${symbolBase}_nametable
.export ${symbolBase}_attribute_table
.export ${symbolBase}_background_pattern_table${fullMapExportDecl}

.segment "${segment}"

; Nametable (32 columns x 30 rows = 960 bytes, Pattern Table ${String(model.patternTable)})
${symbolBase}_nametable:
${nametableRowStrings.join('\n')}

; Attribute Table (8x8 bytes = 64 bytes)
${symbolBase}_attribute_table:
${attributeRowStrings.join('\n')}

${symbolBase}_background_pattern_table:
    .byte ${String(model.patternTable)}
${fullMapSourceDef}`;

  const estimatedRomBytes =
    NAMETABLE_BYTE_COUNT +
    ATTRIBUTE_TABLE_BYTE_COUNT +
    (includeFullMap ? FULL_MAP_BUFFER_BYTE_COUNT : 0) +
    1;

  return {
    includeFileName,
    sourceFileName,
    include,
    source,
    estimatedRomBytes,
  };
}
