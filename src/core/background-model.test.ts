import { describe, expect, it } from 'vitest';
import { BackgroundModelError } from './background-error';
import {
  ATTRIBUTE_TABLE_BYTE_COUNT,
  BACKGROUND_HEIGHT_TILES,
  BACKGROUND_PALETTE_ASSIGNMENT_COUNT,
  BACKGROUND_TILE_COUNT,
  BACKGROUND_WIDTH_TILES,
  FULL_MAP_BUFFER_BYTE_COUNT,
  NAMETABLE_BYTE_COUNT,
  createEmptyBackgroundCells,
  createEmptyBackgroundMap,
  createEmptyBackgroundPaletteAssignments,
  decodeBackgroundAttributeTable,
  encodeBackgroundAttributeTable,
  encodeFullBackgroundMap,
  resolveLogicalNametable,
  validateBackgroundDimensions,
  validateBackgroundMapDefinition,
  validateBackgroundPaletteAssignments,
  type BackgroundMapCell,
  type BackgroundMapDefinition,
} from './background-model';

describe('Milestone 8 (Issue #108): Background Domain Model & Attribute Table Packing', () => {
  describe('Constants & Default Creation', () => {
    it('defines standard NES single-screen specifications', () => {
      expect(BACKGROUND_WIDTH_TILES).toBe(32);
      expect(BACKGROUND_HEIGHT_TILES).toBe(30);
      expect(BACKGROUND_TILE_COUNT).toBe(960);
      expect(BACKGROUND_PALETTE_ASSIGNMENT_COUNT).toBe(240);
      expect(NAMETABLE_BYTE_COUNT).toBe(960);
      expect(ATTRIBUTE_TABLE_BYTE_COUNT).toBe(64);
      expect(FULL_MAP_BUFFER_BYTE_COUNT).toBe(1024);
    });

    it('creates empty default palette assignments with 240 zeros', () => {
      const assignments = createEmptyBackgroundPaletteAssignments();
      expect(assignments).toBeInstanceOf(Uint8Array);
      expect(assignments.length).toBe(240);
      expect(assignments.every((v) => v === 0)).toBe(true);
    });

    it('creates empty default cell grid with 960 nulls', () => {
      const cells = createEmptyBackgroundCells();
      expect(Array.isArray(cells)).toBe(true);
      expect(cells.length).toBe(960);
      expect(cells.every((c) => c === null)).toBe(true);
    });

    it('creates a valid empty BackgroundMapDefinition with defaults', () => {
      const map = createEmptyBackgroundMap({
        id: 'bg_level_1',
        name: 'Level 1 Overworld',
        patternTable: 0,
        assetId: 'asset-bg-tileset',
      });

      expect(map.id).toBe('bg_level_1');
      expect(map.name).toBe('Level 1 Overworld');
      expect(map.widthTiles).toBe(32);
      expect(map.heightTiles).toBe(30);
      expect(map.patternTable).toBe(0);
      expect(map.assetId).toBe('asset-bg-tileset');
      expect(map.cells.length).toBe(960);
      expect(map.cells.every((c) => c === null)).toBe(true);
      expect(map.paletteAssignments.length).toBe(240);
      expect(map.paletteAssignments.every((v) => v === 0)).toBe(true);

      expect(() => {
        validateBackgroundMapDefinition(map);
      }).not.toThrow();
    });
  });

  describe('Dimension & Structural Validations', () => {
    it('accepts exact 32x30 dimensions', () => {
      expect(() => {
        validateBackgroundDimensions(32, 30);
      }).not.toThrow();
    });

    it('rejects dimensions differing from 32x30', () => {
      expect(() => {
        validateBackgroundDimensions(16, 15);
      }).toThrow(BackgroundModelError);
      expect(() => {
        validateBackgroundDimensions(64, 30);
      }).toThrow(BackgroundModelError);
      expect(() => {
        validateBackgroundDimensions(32, 60);
      }).toThrow(BackgroundModelError);
      expect(() => {
        validateBackgroundDimensions(0, 0);
      }).toThrow(BackgroundModelError);
      expect(() => {
        validateBackgroundDimensions(-32, 30);
      }).toThrow(BackgroundModelError);
      expect(() => {
        validateBackgroundDimensions(32.5, 30);
      }).toThrow(BackgroundModelError);
    });

    it('validates palette assignments array length and ranges', () => {
      const valid: number[] = new Array<number>(240).fill(2);
      expect(() => {
        validateBackgroundPaletteAssignments(valid);
      }).not.toThrow();

      // Too short
      expect(() => {
        validateBackgroundPaletteAssignments(new Array<number>(239).fill(0));
      }).toThrow(BackgroundModelError);

      // Too long
      expect(() => {
        validateBackgroundPaletteAssignments(new Array<number>(241).fill(0));
      }).toThrow(BackgroundModelError);

      // Value > 3
      const invalidHigh: number[] = [...valid];
      invalidHigh[10] = 4;
      expect(() => {
        validateBackgroundPaletteAssignments(invalidHigh);
      }).toThrow(BackgroundModelError);

      // Value < 0
      const invalidLow: number[] = [...valid];
      invalidLow[5] = -1;
      expect(() => {
        validateBackgroundPaletteAssignments(invalidLow);
      }).toThrow(BackgroundModelError);

      // Non-integer
      const invalidFloat: number[] = [...valid];
      invalidFloat[1] = 1.5;
      expect(() => {
        validateBackgroundPaletteAssignments(invalidFloat);
      }).toThrow(BackgroundModelError);
    });

    it('validates map definition identifiers and cell references', () => {
      const base = createEmptyBackgroundMap();

      // Invalid ID
      expect(() => {
        validateBackgroundMapDefinition({ ...base, id: '   ' });
      }).toThrow(BackgroundModelError);

      // Invalid Name
      expect(() => {
        validateBackgroundMapDefinition({ ...base, name: '' });
      }).toThrow(BackgroundModelError);

      // Invalid Pattern Table
      expect(() => {
        validateBackgroundMapDefinition({
          ...base,
          // @ts-expect-error Testing invalid pattern table value
          patternTable: 2,
        });
      }).toThrow(BackgroundModelError);

      // Invalid Cell Count
      expect(() => {
        validateBackgroundMapDefinition({
          ...base,
          cells: base.cells.slice(0, 959),
        });
      }).toThrow(BackgroundModelError);

      // Invalid Cell Reference
      const cellsWithInvalid: (BackgroundMapCell | null)[] = [...base.cells];
      cellsWithInvalid[10] = {
        logicalKey: '',
        tileX: 0,
        tileY: 0,
      };
      expect(() => {
        validateBackgroundMapDefinition({
          ...base,
          cells: cellsWithInvalid,
        });
      }).toThrow(BackgroundModelError);

      // Negative tile coordinate
      const cellsWithNeg: (BackgroundMapCell | null)[] = [...base.cells];
      cellsWithNeg[10] = {
        logicalKey: 'asset:0:0',
        tileX: -1,
        tileY: 0,
      };
      expect(() => {
        validateBackgroundMapDefinition({
          ...base,
          cells: cellsWithNeg,
        });
      }).toThrow(BackgroundModelError);
    });
  });

  describe('Attribute Table Packing & Unpacking', () => {
    it('packs 240 zeroes into 64 zero bytes', () => {
      const assignments = new Array<number>(240).fill(0);
      const packed = encodeBackgroundAttributeTable(assignments);

      expect(packed).toBeInstanceOf(Uint8Array);
      expect(packed.length).toBe(64);
      expect(packed.every((b) => b === 0)).toBe(true);
    });

    it('packs 240 threes into 64 bytes with 0xFF for rows 0..6 and 0x0F for row 7', () => {
      const assignments = new Array<number>(240).fill(3);
      const packed = encodeBackgroundAttributeTable(assignments);

      expect(packed.length).toBe(64);

      // Rows 0 to 6 (bytes 0 to 55) have all 4 quadrants set to 3 -> (3<<6)|(3<<4)|(3<<2)|3 = 0xFF (255)
      for (let i = 0; i < 56; i += 1) {
        expect(packed[i]).toBe(0xff);
      }

      // Row 7 (bytes 56 to 63) has top quadrants set to 3, bottom offscreen quadrants padded with 0
      // (0<<6)|(0<<4)|(3<<2)|3 = 0x0F (15)
      for (let i = 56; i < 64; i += 1) {
        expect(packed[i]).toBe(0x0f);
      }
    });

    it('packs individual 16x16 quadrants into exact bit positions for attribute byte', () => {
      // Attribute Table byte 0 covers:
      // TL: col 0, row 0 -> Palette 0 (bits 0..1)
      // TR: col 1, row 0 -> Palette 1 (bits 2..3: 1 << 2 = 4)
      // BL: col 0, row 1 -> Palette 2 (bits 4..5: 2 << 4 = 32)
      // BR: col 1, row 1 -> Palette 3 (bits 6..7: 3 << 6 = 192)
      // Expected byte = 0 | 4 | 32 | 192 = 228 (0xE4)
      const assignments = new Array<number>(240).fill(0);
      assignments[0 * 16 + 0] = 0; // TL
      assignments[0 * 16 + 1] = 1; // TR
      assignments[1 * 16 + 0] = 2; // BL
      assignments[1 * 16 + 1] = 3; // BR

      const packed = encodeBackgroundAttributeTable(assignments);
      expect(packed[0]).toBe(0xe4);
    });

    it('verifies bottom boundary row padding behavior (Attribute row 7 / 16x16 row 14)', () => {
      // Attribute row 7, column 0:
      // TL: col 0, row 14 -> Palette 1 (1 << 0 = 1)
      // TR: col 1, row 14 -> Palette 2 (2 << 2 = 8)
      // BL: row 15 (outside visible 240px) -> Deterministic padding 0
      // BR: row 15 (outside visible 240px) -> Deterministic padding 0
      // Expected byte 56 = 1 | 8 = 9 (0x09)
      const assignments = new Array<number>(240).fill(0);
      assignments[14 * 16 + 0] = 1;
      assignments[14 * 16 + 1] = 2;

      const packed = encodeBackgroundAttributeTable(assignments);
      expect(packed[56]).toBe(0x09);
    });

    it('round-trips arbitrary palette assignments through encode and decode', () => {
      const original = new Array<number>(240);
      for (let i = 0; i < 240; i += 1) {
        original[i] = (i * 7 + 3) % 4; // Arbitrary 0..3 values
      }

      const encoded = encodeBackgroundAttributeTable(original);
      expect(encoded.length).toBe(64);

      const decoded = decodeBackgroundAttributeTable(encoded);
      expect(decoded.length).toBe(240);

      for (let i = 0; i < 240; i += 1) {
        expect(decoded[i]).toBe(original[i]);
      }
    });

    it('rejects decoding attribute tables with invalid length', () => {
      expect(() => {
        decodeBackgroundAttributeTable(new Uint8Array(63));
      }).toThrow(BackgroundModelError);
      expect(() => {
        decodeBackgroundAttributeTable(new Uint8Array(65));
      }).toThrow(BackgroundModelError);
    });

    it('ensures deterministic attribute table output across multiple calls', () => {
      const assignments = new Array<number>(240).fill(0).map((_, i) => i % 4);
      const run1 = encodeBackgroundAttributeTable(assignments);
      const run2 = encodeBackgroundAttributeTable(assignments);

      expect(run1).toEqual(run2);
    });
  });

  describe('Logical Nametable Resolution Contract', () => {
    it('resolves a 32x30 map into exactly 960 bytes of Nametable', () => {
      const cells: (BackgroundMapCell | null)[] = [];
      for (let row = 0; row < 30; row += 1) {
        for (let col = 0; col < 32; col += 1) {
          cells.push({
            logicalKey: `asset_bg:${String(col)}:${String(row)}`,
            tileX: col,
            tileY: row,
            sourceTileIndex: row * 32 + col,
          });
        }
      }

      const map: BackgroundMapDefinition = {
        id: 'bg_map_test',
        name: 'Test Map',
        widthTiles: 32,
        heightTiles: 30,
        patternTable: 0,
        cells,
        paletteAssignments: new Array<number>(240).fill(0),
      };

      const nametable = resolveLogicalNametable({
        map,
        resolver: (cell) => (cell.tileX + cell.tileY) % 256,
      });

      expect(nametable).toBeInstanceOf(Uint8Array);
      expect(nametable.length).toBe(960);
      expect(nametable[0]).toBe(0);
      expect(nametable[1]).toBe(1);
      expect(nametable[31]).toBe(31);
      expect(nametable[32]).toBe(1);
    });

    it('handles boundary local tile indices 0 and 255 cleanly', () => {
      const map = createEmptyBackgroundMap();
      const cellsWithMinMax: (BackgroundMapCell | null)[] = [...map.cells];
      cellsWithMinMax[0] = {
        logicalKey: 'asset:0:0',
        tileX: 0,
        tileY: 0,
      };
      cellsWithMinMax[959] = {
        logicalKey: 'asset:31:29',
        tileX: 31,
        tileY: 29,
      };

      const populatedMap: BackgroundMapDefinition = {
        ...map,
        cells: cellsWithMinMax,
      };

      const nametable = resolveLogicalNametable({
        map: populatedMap,
        emptyCellTileIndex: 128,
        resolver: (cell) => (cell.tileX === 0 ? 0 : 255),
      });

      expect(nametable[0]).toBe(0);
      expect(nametable[959]).toBe(255);
      expect(nametable[100]).toBe(128); // Empty cell fallback
    });

    it('throws when resolver returns local tile index out of 0..255 bounds', () => {
      const map = createEmptyBackgroundMap();
      const cells: (BackgroundMapCell | null)[] = [...map.cells];
      cells[0] = { logicalKey: 'asset:0:0', tileX: 0, tileY: 0 };

      expect(() => {
        resolveLogicalNametable({
          map: { ...map, cells },
          resolver: () => 256, // Out of bounds
        });
      }).toThrow(BackgroundModelError);

      expect(() => {
        resolveLogicalNametable({
          map: { ...map, cells },
          resolver: () => -1, // Out of bounds
        });
      }).toThrow(BackgroundModelError);
    });

    it('throws when empty cell has no fallback index', () => {
      const map = createEmptyBackgroundMap();
      expect(() => {
        resolveLogicalNametable({
          map,
          resolver: () => 0,
        });
      }).toThrow(BackgroundModelError);
    });

    it('throws when fallback index is invalid', () => {
      const map = createEmptyBackgroundMap();
      expect(() => {
        resolveLogicalNametable({
          map,
          emptyCellTileIndex: 300, // Invalid
          resolver: () => 0,
        });
      }).toThrow(BackgroundModelError);
    });
  });

  describe('Full Combined Map Buffer (1024 Bytes)', () => {
    it('concatenates 960B Nametable and 64B Attribute Table into 1024B buffer', () => {
      const nametable = new Uint8Array(960).fill(0x42);
      const attributeTable = new Uint8Array(64).fill(0x55);

      const fullMap = encodeFullBackgroundMap(nametable, attributeTable);
      expect(fullMap).toBeInstanceOf(Uint8Array);
      expect(fullMap.length).toBe(1024);

      // Verify nametable portion
      for (let i = 0; i < 960; i += 1) {
        expect(fullMap[i]).toBe(0x42);
      }

      // Verify attribute table portion
      for (let i = 960; i < 1024; i += 1) {
        expect(fullMap[i]).toBe(0x55);
      }
    });

    it('rejects invalid nametable or attribute table dimensions', () => {
      expect(() => {
        encodeFullBackgroundMap(new Uint8Array(959), new Uint8Array(64));
      }).toThrow(BackgroundModelError);

      expect(() => {
        encodeFullBackgroundMap(new Uint8Array(960), new Uint8Array(63));
      }).toThrow(BackgroundModelError);
    });
  });
});
