import { describe, expect, it } from 'vitest';
import {
  exportBackgroundAttributeTable,
  exportBackgroundChr,
  exportBackgroundFullMap,
  exportBackgroundNametable,
  exportBackgroundPalette,
  exportBackgroundPatternTableChr,
  generateCBackgroundExport,
  generateCa65BackgroundExport,
  sanitizeBackgroundIdentifier,
  type CBackgroundExport,
  type Ca65BackgroundExport,
} from './background-exporters';
import {
  BackgroundModelError,
  buildBackgroundProjectModel,
  createEmptyBackgroundMap,
  type BackgroundMapDefinition,
  type BackgroundProjectModel,
} from './background-model';
import { createDefaultNesPaletteSet } from './nes-palette';

function createMockBackgroundModel(
  patternTable: 0 | 1 = 0,
  name = 'Overworld Stage 1',
  id = 'bg-stage-1',
): BackgroundProjectModel {
  const map: BackgroundMapDefinition = {
    id,
    name,
    widthTiles: 32,
    heightTiles: 30,
    patternTable,
    cells: Array.from({ length: 960 }, (_, i) => ({
      logicalKey: `asset-1:${String(i % 32)}:${String(Math.floor(i / 32))}`,
      tileX: i % 32,
      tileY: Math.floor(i / 32),
    })),
    paletteAssignments: Array.from({ length: 240 }, (_, i) => i % 4),
  };

  const nametable = new Uint8Array(960);
  for (let i = 0; i < 960; i += 1) {
    nametable[i] = i % 256;
  }

  const attributeTable = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    attributeTable[i] = (i * 3) % 256;
  }

  const fullMapBuffer = new Uint8Array(1024);
  fullMapBuffer.set(nametable, 0);
  fullMapBuffer.set(attributeTable, 960);

  const finalChr = new Uint8Array(8192);
  for (let i = 0; i < 8192; i += 1) {
    finalChr[i] = (i ^ 0xaa) & 0xff;
  }

  return {
    map,
    patternTable,
    nametable,
    attributeTable,
    fullMapBuffer,
    resolvedCells: [],
    slots: [],
    finalChr,
    reusedBaseTiles: 0,
    reusedProjectTiles: 0,
    newTileCount: 256,
    uniqueTileCount: 256,
  };
}

describe('Milestone 8 (Issue #112): Background Exporters', () => {
  describe('Binary Exporters', () => {
    it('.nam exports exactly 960 bytes matching compiled model.nametable', () => {
      const model = createMockBackgroundModel(0);
      const nam = exportBackgroundNametable(model);

      expect(nam).toBeInstanceOf(Uint8Array);
      expect(nam.length).toBe(960);
      expect(nam[0]).toBe(model.nametable[0]);
      expect(nam[959]).toBe(model.nametable[959]);
      expect(nam).toEqual(model.nametable);

      // Verify returned buffer is a copy and does not mutate model if altered
      nam[0] = 0xff;
      expect(model.nametable[0]).toBe(0);
    });

    it('.atr exports exactly 64 bytes matching compiled model.attributeTable', () => {
      const model = createMockBackgroundModel(0);
      const atr = exportBackgroundAttributeTable(model);

      expect(atr).toBeInstanceOf(Uint8Array);
      expect(atr.length).toBe(64);
      expect(atr[0]).toBe(model.attributeTable[0]);
      expect(atr[63]).toBe(model.attributeTable[63]);
      expect(atr).toEqual(model.attributeTable);

      // Immutability check
      atr[0] = 0xff;
      expect(model.attributeTable[0]).toBe(0);
    });

    it('.map exports exactly 1024 bytes (960B Nametable + 64B Attribute Table)', () => {
      const model = createMockBackgroundModel(0);
      const fullMap = exportBackgroundFullMap(model);

      expect(fullMap).toBeInstanceOf(Uint8Array);
      expect(fullMap.length).toBe(1024);
      expect(fullMap.subarray(0, 960)).toEqual(model.nametable);
      expect(fullMap.subarray(960, 1024)).toEqual(model.attributeTable);
    });

    it('.chr exports full 8 KiB buffer by default', () => {
      const model = createMockBackgroundModel(0);
      const chr = exportBackgroundChr(model);

      expect(chr).toBeInstanceOf(Uint8Array);
      expect(chr.length).toBe(8192);
      expect(chr).toEqual(model.finalChr);
    });

    it('.chr exports 4096-byte slice for PT0 and PT1 when fullChr is false', () => {
      const modelPT0 = createMockBackgroundModel(0);
      const chrPT0 = exportBackgroundChr(modelPT0, { fullChr: false });
      expect(chrPT0.length).toBe(4096);
      expect(chrPT0).toEqual(modelPT0.finalChr.subarray(0, 4096));

      const chrPT0Helper = exportBackgroundPatternTableChr(modelPT0);
      expect(chrPT0Helper).toEqual(chrPT0);

      const modelPT1 = createMockBackgroundModel(1);
      const chrPT1 = exportBackgroundChr(modelPT1, { fullChr: false });
      expect(chrPT1.length).toBe(4096);
      expect(chrPT1).toEqual(modelPT1.finalChr.subarray(4096, 8192));

      const chrPT1Helper = exportBackgroundPatternTableChr(modelPT1);
      expect(chrPT1Helper).toEqual(chrPT1);
    });

    it('.pal exports 16-byte NES background palette using canonical palette encoding', () => {
      const paletteSet = createDefaultNesPaletteSet();
      const pal = exportBackgroundPalette(paletteSet);

      expect(pal).toBeInstanceOf(Uint8Array);
      expect(pal.length).toBe(16);
      expect(pal[0]).toBe(paletteSet[0][0]);
      expect(pal[1]).toBe(paletteSet[0][1]);
    });
  });

  describe('Identifier Sanitization', () => {
    it('sanitizes strings into valid C and ASM identifiers', () => {
      expect(sanitizeBackgroundIdentifier('Stage 1 - Overworld')).toBe(
        'stage_1_overworld',
      );
      expect(sanitizeBackgroundIdentifier('123 Room #4! (Dungeon)')).toBe(
        '_123_room_4_dungeon',
      );
      expect(sanitizeBackgroundIdentifier('Pântano Tóxico')).toBe(
        'pantano_toxico',
      );
      expect(sanitizeBackgroundIdentifier('default')).toBe('default_animation');
      expect(sanitizeBackgroundIdentifier('')).toBe('background_map');
    });
  });

  describe('cc65 C Exporter', () => {
    it('generates deterministic C header and source for Pattern Table 0', () => {
      const model = createMockBackgroundModel(
        0,
        'Castle Entrance',
        'bg-castle',
      );
      const result: CBackgroundExport = generateCBackgroundExport(model);

      expect(result.headerFileName).toBe('castle_entrance.h');
      expect(result.sourceFileName).toBe('castle_entrance.c');
      expect(result.estimatedRomBytes).toBe(1025);

      // Header contents
      expect(result.header).toContain('#ifndef CASTLE_ENTRANCE_H');
      expect(result.header).toContain('#define CASTLE_ENTRANCE_H');
      expect(result.header).toContain(
        '#define CASTLE_ENTRANCE_BACKGROUND_PATTERN_TABLE 0',
      );
      expect(result.header).toContain(
        '#define CASTLE_ENTRANCE_NAMETABLE_SIZE 960',
      );
      expect(result.header).toContain(
        '#define CASTLE_ENTRANCE_ATTRIBUTE_TABLE_SIZE 64',
      );
      expect(result.header).toContain(
        'extern const unsigned char castle_entrance_nametable[CASTLE_ENTRANCE_NAMETABLE_SIZE];',
      );
      expect(result.header).toContain(
        'extern const unsigned char castle_entrance_attribute_table[CASTLE_ENTRANCE_ATTRIBUTE_TABLE_SIZE];',
      );
      expect(result.header).toContain(
        'extern const uint8_t castle_entrance_background_pattern_table;',
      );

      // Source contents
      expect(result.source).toContain('#include "castle_entrance.h"');
      expect(result.source).toContain(
        'const unsigned char castle_entrance_nametable[CASTLE_ENTRANCE_NAMETABLE_SIZE] = {',
      );
      expect(result.source).toContain('/* Row 00 (Y:   0px) */');
      expect(result.source).toContain('/* Row 29 (Y: 232px) */');
      expect(result.source).toContain(
        'const unsigned char castle_entrance_attribute_table[CASTLE_ENTRANCE_ATTRIBUTE_TABLE_SIZE] = {',
      );
      expect(result.source).toContain('/* Attr Row 0 (Y:   0px) */');
      expect(result.source).toContain('/* Attr Row 7 (Y: 224px) */');
      expect(result.source).toContain(
        'const uint8_t castle_entrance_background_pattern_table = 0;',
      );
    });

    it('generates deterministic C export for Pattern Table 1 with custom symbol base and full map', () => {
      const model = createMockBackgroundModel(1, 'Dungeon', 'bg-dungeon');
      const result = generateCBackgroundExport(model, {
        symbolBase: 'dungeon_room_1',
        includeFullMap: true,
      });

      expect(result.headerFileName).toBe('dungeon_room_1.h');
      expect(result.sourceFileName).toBe('dungeon_room_1.c');
      expect(result.header).toContain(
        '#define DUNGEON_ROOM_1_BACKGROUND_PATTERN_TABLE 1',
      );
      expect(result.header).toContain(
        'extern const unsigned char dungeon_room_1_full_map[DUNGEON_ROOM_1_FULL_MAP_SIZE];',
      );
      expect(result.source).toContain(
        'const unsigned char dungeon_room_1_full_map[DUNGEON_ROOM_1_FULL_MAP_SIZE] = {',
      );
      expect(result.source).toContain(
        'const uint8_t dungeon_room_1_background_pattern_table = 1;',
      );
    });
  });

  describe('ca65 Assembly Exporter', () => {
    it('generates deterministic ca65 Assembly include and source for Pattern Table 0', () => {
      const model = createMockBackgroundModel(0, 'Forest Path', 'bg-forest');
      const result: Ca65BackgroundExport = generateCa65BackgroundExport(model);

      expect(result.includeFileName).toBe('forest_path.inc');
      expect(result.sourceFileName).toBe('forest_path.s');
      expect(result.estimatedRomBytes).toBe(1025);

      // Include contents
      expect(result.include).toContain(
        'FOREST_PATH_BACKGROUND_PATTERN_TABLE = 0',
      );
      expect(result.include).toContain('FOREST_PATH_NAMETABLE_SIZE = 960');
      expect(result.include).toContain('FOREST_PATH_ATTRIBUTE_TABLE_SIZE = 64');
      expect(result.include).toContain('.import forest_path_nametable');
      expect(result.include).toContain('.import forest_path_attribute_table');
      expect(result.include).toContain(
        '.import forest_path_background_pattern_table',
      );

      // Source contents
      expect(result.source).toContain('.export forest_path_nametable');
      expect(result.source).toContain('.export forest_path_attribute_table');
      expect(result.source).toContain(
        '.export forest_path_background_pattern_table',
      );
      expect(result.source).toContain('.segment "RODATA"');
      expect(result.source).toContain('forest_path_nametable:');
      expect(result.source).toContain('forest_path_attribute_table:');
      expect(result.source).toContain('forest_path_background_pattern_table:');
      expect(result.source).toContain('.byte 0');
    });

    it('generates deterministic ca65 export for Pattern Table 1 with custom segment and full map', () => {
      const model = createMockBackgroundModel(1, 'Boss Lair', 'bg-boss');
      const result = generateCa65BackgroundExport(model, {
        symbolBase: 'boss_arena',
        segment: 'MAPDATA',
        includeFullMap: true,
      });

      expect(result.includeFileName).toBe('boss_arena.inc');
      expect(result.sourceFileName).toBe('boss_arena.s');
      expect(result.include).toContain(
        'BOSS_ARENA_BACKGROUND_PATTERN_TABLE = 1',
      );
      expect(result.include).toContain('.import boss_arena_full_map');
      expect(result.source).toContain('.segment "MAPDATA"');
      expect(result.source).toContain('boss_arena_full_map:');
      expect(result.source).toContain('boss_arena_background_pattern_table:');
      expect(result.source).toContain('.byte 1');
    });
  });

  describe('Pure Exporter Contract & Immutability', () => {
    it('does not mutate the input BackgroundProjectModel during export', () => {
      const model = createMockBackgroundModel(0, 'Unmutated Map', 'bg-pure');
      const originalNametable = new Uint8Array(model.nametable);
      const originalAttributeTable = new Uint8Array(model.attributeTable);
      const originalFinalChr = new Uint8Array(model.finalChr);

      exportBackgroundNametable(model);
      exportBackgroundAttributeTable(model);
      exportBackgroundFullMap(model);
      exportBackgroundChr(model);
      exportBackgroundPatternTableChr(model);
      generateCBackgroundExport(model, { includeFullMap: true });
      generateCa65BackgroundExport(model, { includeFullMap: true });

      expect(model.nametable).toEqual(originalNametable);
      expect(model.attributeTable).toEqual(originalAttributeTable);
      expect(model.finalChr).toEqual(originalFinalChr);
    });

    it('works standalone on pre-compiled model without raw PNG or allocation dependencies', () => {
      const model = createMockBackgroundModel(0);
      expect(() => {
        exportBackgroundNametable(model);
        exportBackgroundAttributeTable(model);
        generateCBackgroundExport(model);
        generateCa65BackgroundExport(model);
      }).not.toThrow();
    });
  });

  describe('Cross-Format Semantic Equivalence', () => {
    it('produces identical data across binary, C and ca65 Assembly outputs', () => {
      const model = createMockBackgroundModel(1, 'Equivalence Test', 'bg-eq');

      const namBytes = exportBackgroundNametable(model);
      const atrBytes = exportBackgroundAttributeTable(model);
      const cExport = generateCBackgroundExport(model, {
        symbolBase: 'test_bg',
      });
      const asmExport = generateCa65BackgroundExport(model, {
        symbolBase: 'test_bg',
      });

      // 1. Check C Nametable values match binary
      const cNametableRegex =
        /const unsigned char test_bg_nametable\[TEST_BG_NAMETABLE_SIZE\] = \{([\s\S]*?)\};/;
      const cNametableMatch = cNametableRegex.exec(cExport.source);
      expect(cNametableMatch).not.toBeNull();
      if (cNametableMatch?.[1]) {
        const hexTokens = cNametableMatch[1]
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => parseInt(s, 16));
        expect(hexTokens.length).toBe(960);
        expect(new Uint8Array(hexTokens)).toEqual(namBytes);
      }

      // 2. Check C Attribute Table values match binary
      const cAtrRegex =
        /const unsigned char test_bg_attribute_table\[TEST_BG_ATTRIBUTE_TABLE_SIZE\] = \{([\s\S]*?)\};/;
      const cAtrMatch = cAtrRegex.exec(cExport.source);
      expect(cAtrMatch).not.toBeNull();
      if (cAtrMatch?.[1]) {
        const hexTokens = cAtrMatch[1]
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => parseInt(s, 16));
        expect(hexTokens.length).toBe(64);
        expect(new Uint8Array(hexTokens)).toEqual(atrBytes);
      }

      // 3. Check ASM Nametable values match binary
      const asmNametableRegex =
        /test_bg_nametable:\n([\s\S]*?)\ntest_bg_attribute_table:/;
      const asmNametableMatch = asmNametableRegex.exec(asmExport.source);
      expect(asmNametableMatch).not.toBeNull();
      if (asmNametableMatch?.[1]) {
        const lines = asmNametableMatch[1]
          .split('\n')
          .filter((l) => l.includes('.byte'));
        const tokens: number[] = [];
        for (const line of lines) {
          const bytePart = line.split(';')[0]?.replace(/\.byte/, '') ?? '';
          const parts = bytePart
            .split(',')
            .map((s) => s.trim().replace('$', ''))
            .filter((s) => s.length > 0)
            .map((s) => parseInt(s, 16));
          tokens.push(...parts);
        }
        expect(tokens.length).toBe(960);
        expect(new Uint8Array(tokens)).toEqual(namBytes);
      }

      // 4. Check Pattern Table metadata matches
      expect(cExport.header).toContain(
        '#define TEST_BG_BACKGROUND_PATTERN_TABLE 1',
      );
      expect(asmExport.include).toContain(
        'TEST_BG_BACKGROUND_PATTERN_TABLE = 1',
      );
    });
  });

  describe('Validation & Error Handling', () => {
    it('throws BackgroundModelError on corrupted nametable length', () => {
      const model = {
        ...createMockBackgroundModel(0),
        nametable: new Uint8Array(959),
      };

      expect(() => exportBackgroundNametable(model)).toThrow(
        BackgroundModelError,
      );
      expect(() => generateCBackgroundExport(model)).toThrow(
        BackgroundModelError,
      );
      expect(() => generateCa65BackgroundExport(model)).toThrow(
        BackgroundModelError,
      );
    });

    it('throws BackgroundModelError on corrupted attribute table length', () => {
      const model = {
        ...createMockBackgroundModel(0),
        attributeTable: new Uint8Array(63),
      };

      expect(() => exportBackgroundAttributeTable(model)).toThrow(
        BackgroundModelError,
      );
      expect(() => generateCBackgroundExport(model)).toThrow(
        BackgroundModelError,
      );
      expect(() => generateCa65BackgroundExport(model)).toThrow(
        BackgroundModelError,
      );
    });

    it('throws BackgroundModelError on invalid pattern table selector', () => {
      const model = {
        ...createMockBackgroundModel(0),
        patternTable: 2 as unknown as 0,
      };

      expect(() => exportBackgroundNametable(model)).toThrow(
        BackgroundModelError,
      );
      expect(() => generateCBackgroundExport(model)).toThrow(
        BackgroundModelError,
      );
    });

    it('throws BackgroundModelError on invalid CHR buffer length', () => {
      const model = {
        ...createMockBackgroundModel(0),
        finalChr: new Uint8Array(4000),
      };

      expect(() => exportBackgroundChr(model, { fullChr: true })).toThrow(
        BackgroundModelError,
      );
    });
  });

  describe('End-to-End Pipeline Integration', () => {
    it('seamlessly exports a real model compiled via buildBackgroundProjectModel', () => {
      const map = createEmptyBackgroundMap({
        id: 'bg-e2e',
        name: 'Dungeon Level 1',
        patternTable: 1,
        assetId: 'asset-dungeon',
      });

      // Build real compiled model
      const model = buildBackgroundProjectModel({
        map,
      });

      expect(model.patternTable).toBe(1);
      expect(model.nametable.length).toBe(960);
      expect(model.attributeTable.length).toBe(64);
      expect(model.fullMapBuffer.length).toBe(1024);
      expect(model.finalChr.length).toBe(8192);

      // Run all exporters
      const nam = exportBackgroundNametable(model);
      const atr = exportBackgroundAttributeTable(model);
      const mapBuf = exportBackgroundFullMap(model);
      const chr = exportBackgroundChr(model);
      const chrPT1 = exportBackgroundPatternTableChr(model);
      const cExp = generateCBackgroundExport(model);
      const asmExp = generateCa65BackgroundExport(model);

      expect(nam.length).toBe(960);
      expect(atr.length).toBe(64);
      expect(mapBuf.length).toBe(1024);
      expect(chr.length).toBe(8192);
      expect(chrPT1.length).toBe(4096);
      expect(cExp.header).toContain(
        '#define DUNGEON_LEVEL_1_BACKGROUND_PATTERN_TABLE 1',
      );
      expect(asmExp.include).toContain(
        'DUNGEON_LEVEL_1_BACKGROUND_PATTERN_TABLE = 1',
      );
    });
  });
});
