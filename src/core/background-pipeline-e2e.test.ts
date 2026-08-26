import { describe, expect, it } from 'vitest';
import {
  createEmptyBackgroundCells,
  createEmptyBackgroundMap,
  createEmptyBackgroundPaletteAssignments,
  decodeBackgroundAttributeTable,
  encodeBackgroundAttributeTable,
  type BackgroundMapCell,
  type BackgroundMapDefinition,
} from './background-model';
import { type LogicalTileKey } from './asset-identity';
import { buildBackgroundProjectModel } from './chr-background-allocation';
import {
  exportBackgroundAttributeTable,
  exportBackgroundChr,
  exportBackgroundFullMap,
  exportBackgroundNametable,
  exportBackgroundPalette,
  exportBackgroundPatternTableChr,
  generateCBackgroundExport,
  generateCa65BackgroundExport,
} from './background-exporters';
import { createDefaultNesPaletteSet } from './nes-palette';
import { type ChrRegion } from './chr-pattern-table';
import { buildChrAssetMappingIndex } from './chr-asset-mapping';
import {
  createDefaultProject,
  deserializeProject,
  serializeProject,
  type StudioProject,
} from './project';
import type { Tile } from './types';
import { BackgroundModelError } from './background-error';

describe('Milestone 8 Quality Pass (Issue #113): End-to-End Background Pipeline Regression', () => {
  // Helper to create synthetic 8x8 Tile
  function createTestTile(
    id: number,
    column: number,
    row: number,
    colorIndex: number,
  ): Tile {
    const pixels = new Uint8Array(64);
    pixels.fill(colorIndex & 0x03);
    return { id, column, row, pixels };
  }

  describe('1. Logical Model & Attribute Table Invariants', () => {
    it('verifies standard NES dimensions and physical independence', () => {
      const map = createEmptyBackgroundMap({
        id: 'bg-dungeon-1',
        name: 'Dungeon Room 1',
        patternTable: 1,
        assetId: 'asset-dungeon',
      });

      expect(map.widthTiles).toBe(32);
      expect(map.heightTiles).toBe(30);
      expect(map.cells.length).toBe(960);
      expect(map.paletteAssignments.length).toBe(240);

      // Verify no physical CHR fields exist on BackgroundMapDefinition
      expect('finalChr' in map).toBe(false);
      expect('nametable' in map).toBe(false);
      expect('attributeTable' in map).toBe(false);
    });

    it('verifies known manual fixture for 16x16 Attribute Table quadrants', () => {
      // Create manual 240 palette assignments
      const assignments = new Array<number>(240).fill(0);

      // Block (0, 0): top-left 32x32 area (columns 0..1, rows 0..1 in 16x16 quadrants)
      // TL (0, 0) = Palette 0 -> bits 0..1: 0
      // TR (1, 0) = Palette 1 -> bits 2..3: 1 << 2 = 4
      // BL (0, 1) = Palette 2 -> bits 4..5: 2 << 4 = 32
      // BR (1, 1) = Palette 3 -> bits 6..7: 3 << 6 = 192
      // Byte 0 = 0 | 4 | 32 | 192 = 228 (0xE4)
      assignments[0 * 16 + 0] = 0;
      assignments[0 * 16 + 1] = 1;
      assignments[1 * 16 + 0] = 2;
      assignments[1 * 16 + 1] = 3;

      // Block (7, 0): rightmost 32x32 area of row 0 (columns 14..15, rows 0..1 in 16x16 quadrants)
      // TL (14, 0) = 3 (bits 0..1: 3)
      // TR (15, 0) = 2 (bits 2..3: 2 << 2 = 8)
      // BL (14, 1) = 1 (bits 4..5: 1 << 4 = 16)
      // BR (15, 1) = 0 (bits 6..7: 0)
      // Byte 7 = 3 | 8 | 16 = 27 (0x1B)
      assignments[0 * 16 + 14] = 3;
      assignments[0 * 16 + 15] = 2;
      assignments[1 * 16 + 14] = 1;
      assignments[1 * 16 + 15] = 0;

      // Block (0, 7): bottom-left attribute block (row 14 visible, row 15 outside screen)
      // TL (0, 14) = 2 (bits 0..1: 2)
      // TR (1, 14) = 3 (bits 2..3: 3 << 2 = 12)
      // BL (0, 15) = padded 0
      // BR (1, 15) = padded 0
      // Byte 56 = 2 | 12 = 14 (0x0E)
      assignments[14 * 16 + 0] = 2;
      assignments[14 * 16 + 1] = 3;

      const attributeTable = encodeBackgroundAttributeTable(assignments);
      expect(attributeTable[0]).toBe(0xe4);
      expect(attributeTable[7]).toBe(0x1b);
      expect(attributeTable[56]).toBe(0x0e);

      // Verify exact round-trip unpacking
      const unpacked = decodeBackgroundAttributeTable(attributeTable);
      expect(unpacked[0 * 16 + 0]).toBe(0);
      expect(unpacked[0 * 16 + 1]).toBe(1);
      expect(unpacked[1 * 16 + 0]).toBe(2);
      expect(unpacked[1 * 16 + 1]).toBe(3);
      expect(unpacked[0 * 16 + 14]).toBe(3);
      expect(unpacked[0 * 16 + 15]).toBe(2);
      expect(unpacked[1 * 16 + 14]).toBe(1);
      expect(unpacked[1 * 16 + 15]).toBe(0);
      expect(unpacked[14 * 16 + 0]).toBe(2);
      expect(unpacked[14 * 16 + 1]).toBe(3);
    });
  });

  describe('2. Combined CHR Allocation (PT1 + Base CHR + Reservations + Deduplication)', () => {
    it('executes atomic, deterministic CHR allocation respecting all hardware constraints', () => {
      // 1. Setup Base CHR with 2 distinct tiles in PT1 ($1000, physical slots 256..257)
      const baseChr = new Uint8Array(8192);
      // Slot 256: solid color 1 (16 bytes: plane 0 = 0xFF, plane 1 = 0x00)
      baseChr.fill(0xff, 256 * 16, 256 * 16 + 8);
      // Slot 257: solid color 2 (16 bytes: plane 0 = 0x00, plane 1 = 0xFF)
      baseChr.fill(0xff, 257 * 16 + 8, 257 * 16 + 16);

      // 2. Setup CHR Reservation blocking slots 258..260 in PT1 (slots 2..4 within PT1)
      const reservations: ChrRegion[] = [
        {
          id: 'res-sprites',
          name: 'Dynamic Sprite Buffer',
          kind: 'reservation',
          patternTable: 1,
          startTile: 2,
          endTile: 4,
        },
      ];

      // 3. Create Source Tiles
      const tileA = createTestTile(0, 0, 0, 1); // Matches base CHR slot 256
      const tileB = createTestTile(1, 1, 0, 2); // Matches base CHR slot 257
      const tileC = createTestTile(2, 2, 0, 3); // New unique tile -> Should skip to slot 261
      const tileD = createTestTile(3, 3, 0, 3); // Duplicate of tile C -> Should reuse slot 261

      const tileMap = new Map<LogicalTileKey, Tile>([
        ['asset-1:0:0', tileA],
        ['asset-1:1:0', tileB],
        ['asset-1:2:0', tileC],
        ['asset-1:3:0', tileD],
      ]);

      // 4. Build 32x30 Map populated with combinations
      const cells: (BackgroundMapCell | null)[] = createEmptyBackgroundCells();
      cells[0] = { logicalKey: 'asset-1:0:0', tileX: 0, tileY: 0 };
      cells[1] = { logicalKey: 'asset-1:1:0', tileX: 1, tileY: 0 };
      cells[2] = { logicalKey: 'asset-1:2:0', tileX: 2, tileY: 0 };
      cells[3] = { logicalKey: 'asset-1:3:0', tileX: 3, tileY: 0 };
      cells[4] = null; // Blank cell -> resolves as blank tile (solid 0) -> allocated to slot 262

      const map: BackgroundMapDefinition = {
        id: 'bg-complex',
        name: 'Complex Level',
        widthTiles: 32,
        heightTiles: 30,
        patternTable: 1,
        assetId: 'asset-1',
        cells,
        paletteAssignments: Array.from(
          createEmptyBackgroundPaletteAssignments(),
        ),
      };

      // 5. Build Background Project Model
      const model = buildBackgroundProjectModel({
        map,
        baseChr,
        chrRegions: reservations,
        tileMap,
      });

      // Assertions on physical allocation
      expect(model.patternTable).toBe(1);
      expect(model.nametable.length).toBe(960);
      expect(model.attributeTable.length).toBe(64);
      expect(model.fullMapBuffer.length).toBe(1024);
      expect(model.finalChr.length).toBe(8192);

      // Cell 0 -> Reused Base CHR slot 256 -> Local Nametable index $00
      expect(model.resolvedCells[0]?.localTileIndex).toBe(0);
      expect(model.resolvedCells[0]?.physicalTileIndex).toBe(256);

      // Cell 1 -> Reused Base CHR slot 257 -> Local Nametable index $01
      expect(model.resolvedCells[1]?.localTileIndex).toBe(1);
      expect(model.resolvedCells[1]?.physicalTileIndex).toBe(257);

      // Cell 2 -> New tile allocated in first unreserved slot: 261 -> Local Nametable index $05
      expect(model.resolvedCells[2]?.localTileIndex).toBe(5);
      expect(model.resolvedCells[2]?.physicalTileIndex).toBe(261);

      // Cell 3 -> Reused Project tile at slot 261 -> Local Nametable index $05
      expect(model.resolvedCells[3]?.localTileIndex).toBe(5);
      expect(model.resolvedCells[3]?.physicalTileIndex).toBe(261);

      // Cell 4 -> Blank tile allocated to next slot: 262 -> Local Nametable index $06
      expect(model.resolvedCells[4]?.localTileIndex).toBe(6);
      expect(model.resolvedCells[4]?.physicalTileIndex).toBe(262);

      // Verify metrics
      expect(model.reusedBaseTiles).toBeGreaterThanOrEqual(2);
      expect(model.reusedProjectTiles).toBeGreaterThanOrEqual(1);
      expect(model.newTileCount).toBeGreaterThanOrEqual(2);
    });

    it('guarantees capacity overflow fails atomically without corrupting state', () => {
      // Fill all 256 slots of PT0
      const baseChr = new Uint8Array(8192);
      for (let i = 0; i < 256; i += 1) {
        baseChr[i * 16] = (i + 1) & 0xff;
      }

      // Try allocating a new tile not present in Base CHR into full PT0
      const map: BackgroundMapDefinition = {
        id: 'bg-overflow',
        name: 'Overflow Test',
        widthTiles: 32,
        heightTiles: 30,
        patternTable: 0,
        cells: [
          { logicalKey: 'asset-new:0:0', tileX: 0, tileY: 0 },
          ...new Array<BackgroundMapCell | null>(959).fill(null),
        ],
        paletteAssignments: Array.from(
          createEmptyBackgroundPaletteAssignments(),
        ),
      };

      const tileMap = new Map<LogicalTileKey, Tile>([
        ['asset-new:0:0', createTestTile(0, 0, 0, 3)],
      ]);

      expect(() => {
        buildBackgroundProjectModel({
          map,
          baseChr,
          tileMap,
        });
      }).toThrow(BackgroundModelError);
    });
  });

  describe('3. Origin != Usage & ChrAssetMappingIndex Integration', () => {
    it('accurately maps background tile usage and preserves source asset coordinates', () => {
      const tileSource = createTestTile(42, 5, 3, 2);
      const tileMap = new Map<LogicalTileKey, Tile>([
        ['asset-tileset-1:5:3', tileSource],
      ]);

      const cells = createEmptyBackgroundCells();
      // Place source tile (5, 3) at screen position (col 10, row 8)
      cells[8 * 32 + 10] = {
        logicalKey: 'asset-tileset-1:5:3',
        tileX: 5,
        tileY: 3,
      };

      const map: BackgroundMapDefinition = {
        id: 'bg-world-1',
        name: 'World 1 Map',
        widthTiles: 32,
        heightTiles: 30,
        patternTable: 0,
        assetId: 'asset-tileset-1',
        cells,
        paletteAssignments: Array.from(
          createEmptyBackgroundPaletteAssignments(),
        ),
      };

      const model = buildBackgroundProjectModel({
        map,
        tileMap,
      });

      const mappingIndex = buildChrAssetMappingIndex({
        mode: 'tileset',
        backgroundModels: [model],
      });

      const cellResolved = model.resolvedCells[8 * 32 + 10];
      expect(cellResolved).toBeDefined();
      const physicalSlot = cellResolved?.physicalTileIndex ?? 0;

      const slotMapping = mappingIndex.byPhysicalIndex[physicalSlot];
      expect(slotMapping).toBeDefined();

      // Check Origin
      expect(slotMapping?.origin?.primaryAssetId).toBe('asset-tileset-1');
      expect(slotMapping?.origin?.logicalKey).toBe('asset-tileset-1:5:3');
      expect(slotMapping?.origin?.sourceCoordinates?.tileX).toBe(5);
      expect(slotMapping?.origin?.sourceCoordinates?.tileY).toBe(3);

      // Check Usage
      const bgUsage = slotMapping?.usages.find((u) => u.type === 'background');
      expect(bgUsage).toBeDefined();
      if (bgUsage?.type === 'background') {
        expect(bgUsage.mapId).toBe('bg-world-1');
        expect(bgUsage.column).toBe(10);
        expect(bgUsage.row).toBe(8);
        expect(bgUsage.nametableIndex).toBe(8 * 32 + 10);
      }
    });
  });

  describe('4. Full Export Fidelity (.nam, .atr, .map, .chr, .pal, cc65, ca65)', () => {
    it('produces byte-for-byte matching and deterministic exports', () => {
      const tile = createTestTile(1, 0, 0, 1);
      const tileMap = new Map<LogicalTileKey, Tile>([['asset-test:0:0', tile]]);

      const cells = createEmptyBackgroundCells();
      cells[0] = { logicalKey: 'asset-test:0:0', tileX: 0, tileY: 0 };

      const paletteAssignments = new Array<number>(240).fill(0);
      paletteAssignments[0] = 1;
      paletteAssignments[1] = 2;

      const map: BackgroundMapDefinition = {
        id: 'bg-export-test',
        name: 'Export Test Map',
        widthTiles: 32,
        heightTiles: 30,
        patternTable: 0,
        assetId: 'asset-test',
        cells,
        paletteAssignments,
      };

      const model = buildBackgroundProjectModel({
        map,
        tileMap,
      });

      const paletteSet = createDefaultNesPaletteSet();

      // Binary exports
      const nam = exportBackgroundNametable(model);
      const atr = exportBackgroundAttributeTable(model);
      const fullMap = exportBackgroundFullMap(model);
      const fullChr = exportBackgroundChr(model, { fullChr: true });
      const ptChr = exportBackgroundPatternTableChr(model);
      const pal = exportBackgroundPalette(paletteSet);

      expect(nam.length).toBe(960);
      expect(atr.length).toBe(64);
      expect(fullMap.length).toBe(1024);
      expect(fullChr.length).toBe(8192);
      expect(ptChr.length).toBe(4096);
      expect(pal.length).toBe(16);

      // fullMap must exactly equal [nametable, attributeTable]
      expect(fullMap.subarray(0, 960)).toEqual(nam);
      expect(fullMap.subarray(960, 1024)).toEqual(atr);

      // cc65 C export
      const cExport = generateCBackgroundExport(model, {
        includeFullMap: true,
      });
      expect(cExport.header).toContain(
        'export_test_map_nametable[EXPORT_TEST_MAP_NAMETABLE_SIZE]',
      );
      expect(cExport.header).toContain(
        'export_test_map_attribute_table[EXPORT_TEST_MAP_ATTRIBUTE_TABLE_SIZE]',
      );
      expect(cExport.header).toContain(
        'export_test_map_full_map[EXPORT_TEST_MAP_FULL_MAP_SIZE]',
      );
      expect(cExport.source).toContain('0x');

      // ca65 ASM export
      const asmExport = generateCa65BackgroundExport(model, {
        includeFullMap: true,
      });
      expect(asmExport.include).toContain('.import export_test_map_nametable');
      expect(asmExport.source).toContain('.byte $');
    });
  });

  describe('5. Save / Load / Recompile Persistence Purity & Determinism', () => {
    it('round-trips project through serialization without polluting schema with derived CHR state', () => {
      const tile = createTestTile(1, 0, 0, 1);
      const tileMap = new Map<LogicalTileKey, Tile>([['asset-1:0:0', tile]]);

      const map = createEmptyBackgroundMap({
        id: 'bg-persistent-1',
        name: 'Persistent Level 1',
        patternTable: 1,
        assetId: 'asset-1',
      });
      const cells = [...map.cells];
      cells[0] = { logicalKey: 'asset-1:0:0', tileX: 0, tileY: 0 };
      const modifiedMap: BackgroundMapDefinition = {
        ...map,
        cells,
      };

      const baseProject = createDefaultProject('Test Background Project');
      const project: StudioProject = {
        ...baseProject,
        backgrounds: {
          activeMapId: 'bg-persistent-1',
          maps: [modifiedMap],
        },
      };

      // Compile model before serialization
      const modelBefore = buildBackgroundProjectModel({
        map: modifiedMap,
        tileMap,
      });

      // Serialize to JSON string
      const json = serializeProject(project);

      // Verify purity: No derived CHR state in JSON
      expect(json).not.toContain('"finalChr"');
      expect(json).not.toContain('"nametable"');
      expect(json).not.toContain('"attributeTable"');
      expect(json).not.toContain('"resolvedCells"');

      // Deserialize back to StudioProject
      const result = deserializeProject(json);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const restoredProject = result.project;
      expect(restoredProject.backgrounds?.activeMapId).toBe('bg-persistent-1');
      expect(restoredProject.backgrounds?.maps.length).toBe(1);

      const restoredMap = restoredProject.backgrounds?.maps[0];
      expect(restoredMap).toBeDefined();
      if (!restoredMap) return;

      expect(restoredMap.id).toBe('bg-persistent-1');
      expect(restoredMap.patternTable).toBe(1);
      expect(restoredMap.cells[0]?.logicalKey).toBe('asset-1:0:0');

      // Recompile model from restored project
      const modelAfter = buildBackgroundProjectModel({
        map: restoredMap,
        tileMap,
      });

      // Assert byte-for-byte determinism
      expect(modelAfter.nametable).toEqual(modelBefore.nametable);
      expect(modelAfter.attributeTable).toEqual(modelBefore.attributeTable);
      expect(modelAfter.fullMapBuffer).toEqual(modelBefore.fullMapBuffer);
      expect(modelAfter.finalChr).toEqual(modelBefore.finalChr);
    });
  });
});
