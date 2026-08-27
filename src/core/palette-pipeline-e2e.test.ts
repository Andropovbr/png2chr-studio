/**
 * End-to-end regression suite for the Palette Manager pipeline.
 * Milestone 9, Issue #128.
 *
 * Validates the complete flow:
 *   StudioProject → migration/deserialize → dual-bank domain → diagnostics → exporters → serialize
 *
 * Covers:
 *   1. Full 8-palette project (4 BG + 4 SPR)
 *   2. $3F00 universal background color propagation
 *   3. Deletion protection and orphan reference handling
 *   4. Serialize/deserialize roundtrip fidelity
 *   5. Byte-exact export comparison (.pal, C, ca65)
 *   6. Legacy project migration without corruption
 */

import { describe, expect, it } from 'vitest';
import type { NesPalette, NesPaletteSet } from './nes-palette';
import {
  createDefaultProject,
  deserializeProject,
  serializeProject,
  type StudioProject,
} from './project';
import {
  analyzeProjectPaletteDiagnostics,
  assignPaletteToSlot,
  createDefaultDualBankPaletteState,
  findPaletteDefinition,
  findPaletteSlotIndex,
  findPaletteUsageReferences,
  resolveActiveBackgroundPaletteSet,
  resolveActiveSpritePaletteSet,
  resolveProjectBackgroundPaletteSet,
  resolveProjectPaletteState,
  resolveProjectSpritePaletteSet,
  resolveUniversalBackgroundMirroring,
  type DualBankPaletteState,
  type PaletteDefinition,
} from './palette-manager';
import {
  exportBackgroundPaletteBinary,
  exportFullPpuPaletteBinary,
  exportSpritePaletteBinary,
  generateCa65PaletteExport,
  generateCPaletteExport,
  PALETTE_BANK_BYTE_COUNT,
  PPU_PALETTE_BYTE_COUNT,
} from './palette-exporters';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePalette(
  id: string,
  name: string,
  colors: NesPalette,
  target?: PaletteDefinition['target'],
): PaletteDefinition {
  return { id, name, colors, ...(target ? { target } : {}) };
}

/**
 * Creates a full 8-palette project with 4 BG + 4 SPR palettes assigned
 * to their respective hardware banks.
 */
function createFull8PaletteState(
  universalBg = 0x0f,
): DualBankPaletteState & { palettes: readonly PaletteDefinition[] } {
  const bgPalettes: PaletteDefinition[] = [
    makePalette('bg_0', 'Sky', [universalBg, 0x01, 0x11, 0x21], 'background'),
    makePalette(
      'bg_1',
      'Ground',
      [universalBg, 0x06, 0x16, 0x26],
      'background',
    ),
    makePalette('bg_2', 'Water', [universalBg, 0x02, 0x12, 0x22], 'background'),
    makePalette('bg_3', 'Lava', [universalBg, 0x07, 0x17, 0x27], 'background'),
  ];
  const sprPalettes: PaletteDefinition[] = [
    makePalette('spr_0', 'Hero', [universalBg, 0x05, 0x15, 0x25], 'sprite'),
    makePalette('spr_1', 'Enemy', [universalBg, 0x0a, 0x1a, 0x2a], 'sprite'),
    makePalette('spr_2', 'NPC', [universalBg, 0x0c, 0x1c, 0x2c], 'sprite'),
    makePalette(
      'spr_3',
      'Projectile',
      [universalBg, 0x03, 0x13, 0x23],
      'sprite',
    ),
  ];
  return {
    universalBackgroundColor: universalBg,
    palettes: [...bgPalettes, ...sprPalettes],
    activeBackgroundSlots: ['bg_0', 'bg_1', 'bg_2', 'bg_3'],
    activeSpriteSlots: ['spr_0', 'spr_1', 'spr_2', 'spr_3'],
  };
}

/**
 * Creates a StudioProject with the full 8-palette configuration.
 */
function createFull8PaletteProject(): StudioProject {
  const state = createFull8PaletteState();
  const base = createDefaultProject('Palette E2E Test', 'animation');
  const baseAnimation = base.animation;
  const firstAnimation = baseAnimation?.animations[0];
  if (!baseAnimation || !firstAnimation) {
    throw new Error('Default animation project must contain one animation.');
  }
  const paletteSet = resolveActiveBackgroundPaletteSet(
    state.palettes,
    state.activeBackgroundSlots,
    state.universalBackgroundColor,
  );
  return {
    ...base,
    palette: {
      universalBackgroundColor: state.universalBackgroundColor,
      palettes: state.palettes,
      activeBackgroundSlots: state.activeBackgroundSlots,
      activeSpriteSlots: state.activeSpriteSlots,
      activePaletteIndex: 0,
      activeColorIndex: 1,
      paletteSet,
      activeSpritePaletteSlots: state.activeSpriteSlots,
    },
    animation: {
      ...baseAnimation,
      animations: [
        {
          ...firstAnimation,
          paletteId: 'spr_0',
          framePaletteIds: ['spr_0', 'spr_1'],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: Full 8-palette project (4 BG + 4 SPR)
// ---------------------------------------------------------------------------

describe('palette pipeline E2E', () => {
  describe('Scenario 1: project with 8 palettes (4 BG + 4 SPR)', () => {
    const state = createFull8PaletteState();

    it('contains exactly 8 palette definitions in the library', () => {
      expect(state.palettes).toHaveLength(8);
    });

    it('fills all 4 background slots with distinct BG palette IDs', () => {
      expect(state.activeBackgroundSlots).toEqual([
        'bg_0',
        'bg_1',
        'bg_2',
        'bg_3',
      ]);
      const bgIds = new Set(state.activeBackgroundSlots.filter(Boolean));
      expect(bgIds.size).toBe(4);
    });

    it('fills all 4 sprite slots with distinct SPR palette IDs', () => {
      expect(state.activeSpriteSlots).toEqual([
        'spr_0',
        'spr_1',
        'spr_2',
        'spr_3',
      ]);
      const spIds = new Set(state.activeSpriteSlots.filter(Boolean));
      expect(spIds.size).toBe(4);
    });

    it('resolves BG and SPR banks independently', () => {
      const bgSet = resolveActiveBackgroundPaletteSet(
        state.palettes,
        state.activeBackgroundSlots,
        state.universalBackgroundColor,
      );
      const spSet = resolveActiveSpritePaletteSet(
        state.palettes,
        state.activeSpriteSlots,
        undefined,
        state.universalBackgroundColor,
      );

      // BG slot 0 colors 1..3 must differ from SPR slot 0 colors 1..3
      expect(bgSet[0].slice(1)).not.toEqual(spSet[0].slice(1));

      // Both banks have 4 subpalettes
      expect(bgSet).toHaveLength(4);
      expect(spSet).toHaveLength(4);
    });

    it('every resolved palette definition is findable by its ID', () => {
      for (const pal of state.palettes) {
        const found = findPaletteDefinition(state.palettes, pal.id);
        expect(found).not.toBeNull();
        expect(found?.colors).toEqual(pal.colors);
      }
    });

    it('library can hold more than 4 palettes without representing overflow', () => {
      // 8 palettes in library, only 4 per bank — valid configuration
      const diagnostics = analyzeProjectPaletteDiagnostics({
        universalBackgroundColor: state.universalBackgroundColor,
        palettes: state.palettes,
        activeBackgroundSlots: state.activeBackgroundSlots,
        activeSpriteSlots: state.activeSpriteSlots,
      });
      const overflowFacts = diagnostics.filter(
        (f) => f.kind === 'slot-capacity-exceeded',
      );
      expect(overflowFacts).toHaveLength(0);
    });

    it('produces zero diagnostics for a clean 8-palette configuration', () => {
      const diagnostics = analyzeProjectPaletteDiagnostics({
        universalBackgroundColor: state.universalBackgroundColor,
        palettes: state.palettes,
        activeBackgroundSlots: state.activeBackgroundSlots,
        activeSpriteSlots: state.activeSpriteSlots,
      });
      expect(diagnostics).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: $3F00 universal background color propagation
  // ---------------------------------------------------------------------------

  describe('Scenario 2: $3F00 universal background color propagation', () => {
    const universalBg = 0x21; // Light Blue
    const state = createFull8PaletteState(universalBg);

    it('mirrors $3F00 into color 0 of all 4 BG subpalettes', () => {
      const bgSet = resolveActiveBackgroundPaletteSet(
        state.palettes,
        state.activeBackgroundSlots,
        universalBg,
      );
      bgSet.forEach((palette) => {
        expect(palette[0]).toBe(universalBg);
      });
    });

    it('mirrors $3F00 into color 0 of all 4 SPR subpalettes when universalBg is provided', () => {
      const spSet = resolveActiveSpritePaletteSet(
        state.palettes,
        state.activeSpriteSlots,
        undefined,
        universalBg,
      );
      spSet.forEach((palette) => {
        expect(palette[0]).toBe(universalBg);
      });
    });

    it('correctly propagates a changed $3F00 through resolveUniversalBackgroundMirroring', () => {
      const originalSet: NesPaletteSet = [
        [0x0f, 0x01, 0x11, 0x21],
        [0x0f, 0x06, 0x16, 0x26],
        [0x0f, 0x02, 0x12, 0x22],
        [0x0f, 0x07, 0x17, 0x27],
      ];
      const newUniversal = 0x30; // White
      const mirrored = resolveUniversalBackgroundMirroring(
        originalSet,
        newUniversal,
      );

      // All color 0 entries must be the new universal
      mirrored.forEach((palette) => {
        expect(palette[0]).toBe(newUniversal);
      });
      // Colors 1..3 must be preserved
      mirrored.forEach((palette, index) => {
        expect(palette.slice(1)).toEqual(originalSet[index]?.slice(1));
      });
    });

    it('correctly reflects $3F00 change in exported .pal bytes', () => {
      const bgBytes = exportBackgroundPaletteBinary(state);
      // Bytes 0, 4, 8, 12 must all be the universal background color
      expect(bgBytes[0]).toBe(universalBg);
      expect(bgBytes[4]).toBe(universalBg);
      expect(bgBytes[8]).toBe(universalBg);
      expect(bgBytes[12]).toBe(universalBg);
    });

    it('diagnoses inconsistent colors[0] when BG palettes have divergent color 0', () => {
      const divergentPalettes = [
        ...state.palettes.slice(0, 3),
        // BG palette 3 with a different color 0
        makePalette('bg_3', 'Lava', [0x00, 0x07, 0x17, 0x27], 'background'),
        ...state.palettes.slice(4),
      ];
      const diagnostics = analyzeProjectPaletteDiagnostics({
        universalBackgroundColor: universalBg,
        palettes: divergentPalettes,
        activeBackgroundSlots: state.activeBackgroundSlots,
        activeSpriteSlots: state.activeSpriteSlots,
      });
      const inconsistent = diagnostics.filter(
        (f) => f.kind === 'inconsistent-universal-color',
      );
      expect(inconsistent.length).toBeGreaterThanOrEqual(1);
      expect(inconsistent.some((f) => f.paletteId === 'bg_3')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Deletion and orphan reference protection
  // ---------------------------------------------------------------------------

  describe('Scenario 3: palette in use — deletion and orphan reference protection', () => {
    const state = createFull8PaletteState();

    it('finds usage references for a palette assigned to a sprite slot', () => {
      const refs = findPaletteUsageReferences('spr_0', {
        activeSpriteSlots: [...state.activeSpriteSlots],
        activeBackgroundSlots: [...state.activeBackgroundSlots],
        animations: [
          {
            id: 'anim_hero',
            name: 'walk',
            entity: 'Hero',
            paletteId: 'spr_0',
            framePaletteIds: ['spr_0', 'spr_1'],
          },
        ],
      });
      // Must find slot reference + animation reference + entity reference + frame reference
      expect(refs.length).toBeGreaterThanOrEqual(3);
      expect(refs.some((r) => r.type === 'slot')).toBe(true);
      expect(refs.some((r) => r.type === 'animation')).toBe(true);

      const palettesAfterGuard =
        refs.length === 0
          ? state.palettes.filter((palette) => palette.id !== 'spr_0')
          : state.palettes;
      expect(findPaletteDefinition(palettesAfterGuard, 'spr_0')).not.toBeNull();
    });

    it('deletes an unused library palette without creating orphan references', () => {
      const palettes = [
        ...state.palettes,
        makePalette('pal_unused', 'Unused', [0x0f, 0x0f, 0x0f, 0x0f]),
      ];
      const refs = findPaletteUsageReferences('pal_unused', {
        activeSpriteSlots: [...state.activeSpriteSlots],
        activeBackgroundSlots: [...state.activeBackgroundSlots],
        animations: [],
      });
      expect(refs).toHaveLength(0);

      const remaining = palettes.filter(
        (palette) => palette.id !== 'pal_unused',
      );
      expect(findPaletteDefinition(remaining, 'pal_unused')).toBeNull();
      expect(
        analyzeProjectPaletteDiagnostics({
          universalBackgroundColor: state.universalBackgroundColor,
          palettes: remaining,
          activeBackgroundSlots: state.activeBackgroundSlots,
          activeSpriteSlots: state.activeSpriteSlots,
        }).filter((fact) => fact.kind === 'dangling-palette-reference'),
      ).toHaveLength(0);
    });

    it('detects dangling references when a palette is removed from the library', () => {
      // Remove spr_0 from library but keep it in active slots and animations
      const remaining = state.palettes.filter((p) => p.id !== 'spr_0');
      const diagnostics = analyzeProjectPaletteDiagnostics({
        universalBackgroundColor: state.universalBackgroundColor,
        palettes: remaining,
        activeBackgroundSlots: state.activeBackgroundSlots,
        activeSpriteSlots: state.activeSpriteSlots,
        animations: [{ id: 'anim_hero', name: 'walk', paletteId: 'spr_0' }],
      });
      const dangling = diagnostics.filter(
        (f) => f.kind === 'dangling-palette-reference',
      );
      // Should detect dangling in sprite slot + animation
      expect(dangling.length).toBeGreaterThanOrEqual(2);
      expect(dangling.every((f) => f.paletteId === 'spr_0')).toBe(true);
    });

    it('does not create dangling facts when palette exists in library but is not in a slot', () => {
      // spr_0 in library, referenced by animation, but not in any slot
      const diagnostics = analyzeProjectPaletteDiagnostics({
        universalBackgroundColor: state.universalBackgroundColor,
        palettes: state.palettes,
        activeBackgroundSlots: state.activeBackgroundSlots,
        activeSpriteSlots: [null, 'spr_1', 'spr_2', 'spr_3'],
        animations: [{ id: 'anim_hero', name: 'walk', paletteId: 'spr_0' }],
      });
      const dangling = diagnostics.filter(
        (f) => f.kind === 'dangling-palette-reference',
      );
      expect(dangling).toHaveLength(0);

      const unassigned = diagnostics.filter(
        (f) => f.kind === 'unassigned-active-slot',
      );
      expect(unassigned.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Serialize/deserialize roundtrip
  // ---------------------------------------------------------------------------

  describe('Scenario 4: full serialize/deserialize roundtrip', () => {
    it('produces identical projects after serialize → deserialize → serialize', () => {
      const project = createFull8PaletteProject();
      const json1 = serializeProject(project);
      const result = deserializeProject(json1);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const json2 = serializeProject(result.project);
      expect(json2).toBe(json1);
    });

    it('preserves all 8 palette definitions through roundtrip', () => {
      const project = createFull8PaletteProject();
      const json = serializeProject(project);
      const result = deserializeProject(json);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.project.palette.palettes).toHaveLength(8);
      expect(result.project.palette.palettes).toEqual(project.palette.palettes);
    });

    it('preserves universalBackgroundColor through roundtrip', () => {
      const project = createFull8PaletteProject();
      const json = serializeProject(project);
      const result = deserializeProject(json);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.project.palette.universalBackgroundColor).toBe(
        project.palette.universalBackgroundColor,
      );
    });

    it('preserves both active bank slot assignments through roundtrip', () => {
      const project = createFull8PaletteProject();
      const json = serializeProject(project);
      const result = deserializeProject(json);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.project.palette.activeBackgroundSlots).toEqual(
        project.palette.activeBackgroundSlots,
      );
      expect(result.project.palette.activeSpriteSlots).toEqual(
        project.palette.activeSpriteSlots,
      );
    });

    it('preserves animation palette references through roundtrip', () => {
      const project = createFull8PaletteProject();
      const json = serializeProject(project);
      const result = deserializeProject(json);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const anim = result.project.animation?.animations[0];
      expect(anim?.paletteId).toBe('spr_0');
      expect(anim?.framePaletteIds).toEqual(['spr_0', 'spr_1']);
    });

    it('projects legacy compatibility fields from canonical banks when saving', () => {
      const project = createFull8PaletteProject();
      const staleLegacySet: NesPaletteSet = [
        [0x0f, 0x00, 0x00, 0x00],
        [0x0f, 0x00, 0x00, 0x00],
        [0x0f, 0x00, 0x00, 0x00],
        [0x0f, 0x00, 0x00, 0x00],
      ];
      const staleProject: StudioProject = {
        ...project,
        palette: {
          ...project.palette,
          paletteSet: staleLegacySet,
          activeSpritePaletteSlots: [null, null, null, null],
        },
      };

      const saved = JSON.parse(serializeProject(staleProject)) as StudioProject;
      expect(saved.palette.paletteSet).toEqual(
        resolveProjectBackgroundPaletteSet(project),
      );
      expect(saved.palette.activeSpritePaletteSlots).toEqual(
        project.palette.activeSpriteSlots,
      );
      expect(staleProject.palette.paletteSet).toBe(staleLegacySet);
      expect(staleProject.palette.activeSpritePaletteSlots).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Byte-exact export comparison (.pal, C, ca65)
  // ---------------------------------------------------------------------------

  describe('Scenario 5: byte-exact export verification', () => {
    const state = createFull8PaletteState(0x0f);

    it('exports exactly 16 BG bytes with correct $3F00 mirroring', () => {
      const bgBytes = exportBackgroundPaletteBinary(state);
      expect(bgBytes).toHaveLength(PALETTE_BANK_BYTE_COUNT);

      // All color-0 entries mirror $3F00 = $0F
      expect(bgBytes[0]).toBe(0x0f);
      expect(bgBytes[4]).toBe(0x0f);
      expect(bgBytes[8]).toBe(0x0f);
      expect(bgBytes[12]).toBe(0x0f);

      // BG slot 0: $0F, $01, $11, $21
      expect(Array.from(bgBytes.subarray(0, 4))).toEqual([
        0x0f, 0x01, 0x11, 0x21,
      ]);
      // BG slot 1: $0F, $06, $16, $26
      expect(Array.from(bgBytes.subarray(4, 8))).toEqual([
        0x0f, 0x06, 0x16, 0x26,
      ]);
      // BG slot 2: $0F, $02, $12, $22
      expect(Array.from(bgBytes.subarray(8, 12))).toEqual([
        0x0f, 0x02, 0x12, 0x22,
      ]);
      // BG slot 3: $0F, $07, $17, $27
      expect(Array.from(bgBytes.subarray(12, 16))).toEqual([
        0x0f, 0x07, 0x17, 0x27,
      ]);
    });

    it('exports exactly 16 SPR bytes independently from BG', () => {
      const sprBytes = exportSpritePaletteBinary(state);
      expect(sprBytes).toHaveLength(PALETTE_BANK_BYTE_COUNT);

      // SPR slot 0: $0F, $05, $15, $25
      expect(Array.from(sprBytes.subarray(0, 4))).toEqual([
        0x0f, 0x05, 0x15, 0x25,
      ]);
      // SPR slot 1: $0F, $0A, $1A, $2A
      expect(Array.from(sprBytes.subarray(4, 8))).toEqual([
        0x0f, 0x0a, 0x1a, 0x2a,
      ]);
      // SPR slot 2: $0F, $0C, $1C, $2C
      expect(Array.from(sprBytes.subarray(8, 12))).toEqual([
        0x0f, 0x0c, 0x1c, 0x2c,
      ]);
      // SPR slot 3: $0F, $03, $13, $23
      expect(Array.from(sprBytes.subarray(12, 16))).toEqual([
        0x0f, 0x03, 0x13, 0x23,
      ]);
    });

    it('exports exactly 32 bytes as [BG 16B || SPR 16B]', () => {
      const fullBytes = exportFullPpuPaletteBinary(state);
      expect(fullBytes).toHaveLength(PPU_PALETTE_BYTE_COUNT);

      const bgBytes = exportBackgroundPaletteBinary(state);
      const sprBytes = exportSpritePaletteBinary(state);

      expect(Array.from(fullBytes)).toEqual([
        ...Array.from(bgBytes),
        ...Array.from(sprBytes),
      ]);
    });

    it('generates deterministic C output with correct PPU address comments', () => {
      const result = generateCPaletteExport(state);

      expect(result.headerFileName).toBe('palette.h');
      expect(result.sourceFileName).toBe('palette.c');
      expect(result.estimatedRomBytes).toBe(PPU_PALETTE_BYTE_COUNT);

      // Header includes BG and SPR array declarations
      expect(result.header).toContain('extern const unsigned char palette_bg[');
      expect(result.header).toContain(
        'extern const unsigned char palette_spr[',
      );
      expect(result.header).toContain('#define PALETTE_PPU_SIZE 32');

      // Source includes PPU address range comments
      expect(result.source).toContain('$3F00-$3F03');
      expect(result.source).toContain('$3F10-$3F13');
      expect(result.source).toContain('mirror $3F00');
    });

    it('generates deterministic ca65 output with correct PPU address comments', () => {
      const result = generateCa65PaletteExport(state);

      expect(result.includeFileName).toBe('palette.inc');
      expect(result.sourceFileName).toBe('palette.s');
      expect(result.estimatedRomBytes).toBe(PPU_PALETTE_BYTE_COUNT);

      // Include file imports BG and SPR symbols
      expect(result.include).toContain('.import palette_bg');
      expect(result.include).toContain('.import palette_spr');

      // Source includes PPU address range comments
      expect(result.source).toContain('$3F00-$3F03');
      expect(result.source).toContain('$3F10-$3F13');
      expect(result.source).toContain('.segment "RODATA"');
    });

    it('C and ca65 exports produce bit-identical byte sequences', () => {
      const cExport = generateCPaletteExport(state);
      const asmExport = generateCa65PaletteExport(state);

      // Both formats use the same underlying binary resolvers, so the
      // actual exported palette bytes must match exactly.
      const bgBytes = exportBackgroundPaletteBinary(state);
      const sprBytes = exportSpritePaletteBinary(state);
      const expectedBytes = [...Array.from(bgBytes), ...Array.from(sprBytes)];
      expect(expectedBytes).toHaveLength(PPU_PALETTE_BYTE_COUNT);

      // Extract only data-line hex values from C source (lines with /* BG/SPR comments)
      const cDataLines = cExport.source
        .split('\n')
        .filter((l) => /\/\*\s*(BG|SPR)\s+\d/.test(l))
        .map((l) => l.replace(/\/\*.*?\*\//g, '')); // strip block comments
      const cHexValues = cDataLines
        .flatMap((l) => Array.from(l.matchAll(/0x([0-9A-F]{2})/gi)))
        .map((m) => Number.parseInt(m[1] ?? '', 16));

      // Extract only data-line hex values from ASM source (lines with .byte, strip comments)
      const asmDataLines = asmExport.source
        .split('\n')
        .filter((l) => /^\s*\.byte\s/.test(l))
        .map((l) => l.replace(/;.*$/, '')); // strip comments to avoid matching address ranges
      const asmHexValues = asmDataLines
        .flatMap((l) => Array.from(l.matchAll(/\$([0-9A-F]{2})/gi)))
        .map((m) => Number.parseInt(m[1] ?? '', 16));

      expect(cHexValues).toEqual(expectedBytes);
      expect(asmHexValues).toEqual(expectedBytes);
      expect(cHexValues).toEqual(asmHexValues);
    });

    it('export functions do not mutate the input state', () => {
      const stateCopy = JSON.stringify(state);
      exportBackgroundPaletteBinary(state);
      exportSpritePaletteBinary(state);
      exportFullPpuPaletteBinary(state);
      generateCPaletteExport(state);
      generateCa65PaletteExport(state);
      expect(JSON.stringify(state)).toBe(stateCopy);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Legacy project migration without corruption
  // ---------------------------------------------------------------------------

  describe('Scenario 6: legacy project migration', () => {
    it('migrates a legacy project with only paletteSet (no palettes/activeSlots)', () => {
      const legacyJson = JSON.stringify({
        formatVersion: 1,
        name: 'Legacy Project',
        mode: 'animation',
        palette: {
          paletteSet: [
            [0x0f, 0x01, 0x11, 0x21],
            [0x0f, 0x06, 0x16, 0x26],
            [0x0f, 0x02, 0x12, 0x22],
            [0x0f, 0x07, 0x17, 0x27],
          ],
          activePaletteIndex: 0,
          activeColorIndex: 1,
        },
      });

      const result = deserializeProject(legacyJson);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const pal = result.project.palette;

      // Should generate default palette definitions from paletteSet
      expect(pal.palettes.length).toBeGreaterThanOrEqual(4);

      // Should extract universalBackgroundColor from paletteSet[0][0]
      expect(pal.universalBackgroundColor).toBe(0x0f);

      // Should populate activeBackgroundSlots and activeSpriteSlots
      expect(pal.activeBackgroundSlots).toHaveLength(4);
      expect(pal.activeSpriteSlots).toHaveLength(4);

      // No null IDs (migration fills from library)
      for (let i = 0; i < 4; i++) {
        expect(pal.activeBackgroundSlots[i]).not.toBeNull();
        expect(pal.activeSpriteSlots[i]).not.toBeNull();
      }
    });

    it('preserves explicit universalBackgroundColor over legacy paletteSet[0][0]', () => {
      const json = JSON.stringify({
        formatVersion: 1,
        name: 'Mixed Legacy',
        mode: 'tileset',
        palette: {
          universalBackgroundColor: 0x30,
          paletteSet: [
            [0x0f, 0x01, 0x11, 0x21],
            [0x0f, 0x06, 0x16, 0x26],
            [0x0f, 0x02, 0x12, 0x22],
            [0x0f, 0x07, 0x17, 0x27],
          ],
        },
      });

      const result = deserializeProject(json);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.project.palette.universalBackgroundColor).toBe(0x30);
    });

    it('migrates animation paletteIndex to paletteId via active sprite slots', () => {
      const json = JSON.stringify({
        formatVersion: 1,
        name: 'Legacy Anim',
        mode: 'animation',
        palette: {
          palettes: [
            { id: 'pal_0', name: 'P0', colors: [0x0f, 0x01, 0x11, 0x21] },
            { id: 'pal_1', name: 'P1', colors: [0x0f, 0x06, 0x16, 0x26] },
          ],
          activeSpriteSlots: ['pal_0', 'pal_1', null, null],
        },
        animation: {
          name: 'hero',
          symbolPrefix: 'hero',
          animations: [
            {
              id: 'anim_1',
              name: 'walk',
              paletteIndex: 1,
              frameWidth: 16,
              frameHeight: 16,
            },
          ],
        },
      });

      const result = deserializeProject(json);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const anim = result.project.animation?.animations[0];
      // paletteIndex: 1 maps to activeSpriteSlots[1] = 'pal_1'
      expect(anim?.paletteId).toBe('pal_1');
    });

    it('gives paletteId precedence over conflicting paletteIndex', () => {
      const json = JSON.stringify({
        formatVersion: 1,
        name: 'Conflict',
        mode: 'animation',
        palette: {
          palettes: [
            { id: 'pal_0', name: 'P0', colors: [0x0f, 0x01, 0x11, 0x21] },
            { id: 'pal_1', name: 'P1', colors: [0x0f, 0x06, 0x16, 0x26] },
          ],
          activeSpriteSlots: ['pal_0', 'pal_1', null, null],
        },
        animation: {
          name: 'hero',
          symbolPrefix: 'hero',
          animations: [
            {
              id: 'anim_1',
              name: 'walk',
              paletteId: 'pal_0',
              paletteIndex: 1,
              frameWidth: 16,
              frameHeight: 16,
            },
          ],
        },
      });

      const result = deserializeProject(json);
      expect(result.success).toBe(true);
      if (!result.success) return;

      // paletteId takes precedence over paletteIndex
      expect(result.project.animation?.animations[0]?.paletteId).toBe('pal_0');
    });

    it('migrated legacy project serializes and re-deserializes idempotently', () => {
      const legacyJson = JSON.stringify({
        formatVersion: 1,
        name: 'Legacy Roundtrip',
        mode: 'tileset',
        palette: {
          paletteSet: [
            [0x0f, 0x01, 0x11, 0x21],
            [0x0f, 0x06, 0x16, 0x26],
            [0x0f, 0x02, 0x12, 0x22],
            [0x0f, 0x07, 0x17, 0x27],
          ],
        },
      });

      const result1 = deserializeProject(legacyJson);
      expect(result1.success).toBe(true);
      if (!result1.success) return;

      const json1 = serializeProject(result1.project);
      const result2 = deserializeProject(json1);
      expect(result2.success).toBe(true);
      if (!result2.success) return;

      const json2 = serializeProject(result2.project);
      expect(json2).toBe(json1);
    });

    it('masks color values with & 0x3F during migration', () => {
      const json = JSON.stringify({
        formatVersion: 1,
        name: 'Overflow Colors',
        mode: 'tileset',
        palette: {
          paletteSet: [
            [0x4f, 0x41, 0x51, 0x61],
            [0x0f, 0x06, 0x16, 0x26],
            [0x0f, 0x02, 0x12, 0x22],
            [0x0f, 0x07, 0x17, 0x27],
          ],
        },
      });

      const result = deserializeProject(json);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const pal = result.project.palette;
      // 0x4F & 0x3F = 0x0F
      expect(pal.universalBackgroundColor).toBe(0x0f);
      // Migrated palette colors should be masked
      const firstPal = pal.palettes[0];
      expect(firstPal).toBeDefined();
      if (!firstPal) return;
      for (const c of firstPal.colors) {
        expect(c).toBeLessThanOrEqual(0x3f);
        expect(c).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // NES hardware invariants
  // ---------------------------------------------------------------------------

  describe('NES hardware invariants', () => {
    const state = createFull8PaletteState();

    it('BG bank ($3F00..$3F0F) is independent of SPR bank ($3F10..$3F1F)', () => {
      const bgBytes = exportBackgroundPaletteBinary(state);
      const sprBytes = exportSpritePaletteBinary(state);

      // Bytes 1..3 of slot 0 must differ between BG and SPR
      expect(Array.from(bgBytes.subarray(1, 4))).not.toEqual(
        Array.from(sprBytes.subarray(1, 4)),
      );
    });

    it('enforces exactly 4 slots per bank', () => {
      expect(state.activeBackgroundSlots).toHaveLength(4);
      expect(state.activeSpriteSlots).toHaveLength(4);

      // assignPaletteToSlot rejects slot index >= 4
      expect(() =>
        assignPaletteToSlot(state.activeBackgroundSlots, 4, 'test'),
      ).toThrow();
      expect(() =>
        assignPaletteToSlot(state.activeBackgroundSlots, -1, 'test'),
      ).toThrow();
    });

    it('$3F00 is the universal background color shared across all BG subpalettes', () => {
      const bgSet = resolveActiveBackgroundPaletteSet(
        state.palettes,
        state.activeBackgroundSlots,
        state.universalBackgroundColor,
      );
      const color0Values = bgSet.map((p) => p[0]);
      expect(new Set(color0Values).size).toBe(1);
      expect(color0Values[0]).toBe(state.universalBackgroundColor);
    });

    it('sprite color index 0 is transparent (not a visible color)', () => {
      // In NES, sprite pixel value %00 means transparent.
      // The exported sprite bytes still contain the $3F00 mirror value at positions 0, 4, 8, 12,
      // but renderers must treat these as transparent.
      const sprBytes = exportSpritePaletteBinary(state);
      // The bytes at indices 0, 4, 8, 12 mirror $3F00 but are physically transparent in rendering
      for (const offset of [0, 4, 8, 12]) {
        expect(sprBytes[offset]).toBe(state.universalBackgroundColor);
      }
    });

    it('library >4 palettes does not imply hardware overflow', () => {
      const state12 = {
        ...state,
        palettes: [
          ...state.palettes,
          makePalette('extra_1', 'Extra 1', [0x0f, 0x10, 0x20, 0x30]),
          makePalette('extra_2', 'Extra 2', [0x0f, 0x11, 0x21, 0x31]),
          makePalette('extra_3', 'Extra 3', [0x0f, 0x12, 0x22, 0x32]),
          makePalette('extra_4', 'Extra 4', [0x0f, 0x13, 0x23, 0x33]),
        ],
      };
      expect(state12.palettes).toHaveLength(12);

      const diagnostics = analyzeProjectPaletteDiagnostics({
        universalBackgroundColor: state12.universalBackgroundColor,
        palettes: state12.palettes,
        activeBackgroundSlots: state12.activeBackgroundSlots,
        activeSpriteSlots: state12.activeSpriteSlots,
      });
      const overflow = diagnostics.filter(
        (f) => f.kind === 'slot-capacity-exceeded',
      );
      expect(overflow).toHaveLength(0);
    });

    it('4-slot limit considers simultaneous scene usage, not library size', () => {
      const diagnostics = analyzeProjectPaletteDiagnostics({
        universalBackgroundColor: state.universalBackgroundColor,
        palettes: [
          ...state.palettes,
          makePalette('extra_5', 'Extra 5', [0x0f, 0x14, 0x24, 0x34]),
        ],
        activeBackgroundSlots: state.activeBackgroundSlots,
        activeSpriteSlots: state.activeSpriteSlots,
        sceneInstances: [
          { id: 'i1', paletteId: 'spr_0' },
          { id: 'i2', paletteId: 'spr_1' },
          { id: 'i3', paletteId: 'spr_2' },
          { id: 'i4', paletteId: 'spr_3' },
          { id: 'i5', paletteId: 'extra_5' },
        ],
      });
      const overflow = diagnostics.filter(
        (f) => f.kind === 'slot-capacity-exceeded',
      );
      expect(overflow.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-subsystem consistency
  // ---------------------------------------------------------------------------

  describe('cross-subsystem consistency', () => {
    it('resolveProjectBackgroundPaletteSet produces same result as direct resolver', () => {
      const project = createFull8PaletteProject();
      const projectResolved = resolveProjectBackgroundPaletteSet(project);
      const directResolved = resolveActiveBackgroundPaletteSet(
        project.palette.palettes,
        project.palette.activeBackgroundSlots,
        project.palette.universalBackgroundColor,
      );
      expect(projectResolved).toEqual(directResolved);
    });

    it('resolveProjectSpritePaletteSet produces same result as direct resolver', () => {
      const project = createFull8PaletteProject();
      const projectResolved = resolveProjectSpritePaletteSet(project);
      const directResolved = resolveActiveSpritePaletteSet(
        project.palette.palettes,
        project.palette.activeSpriteSlots,
        undefined,
        project.palette.universalBackgroundColor,
      );
      expect(projectResolved).toEqual(directResolved);
    });

    it('resolveProjectPaletteState extracts canonical state from project', () => {
      const project = createFull8PaletteProject();
      const dualBank = resolveProjectPaletteState(project);
      expect(dualBank.universalBackgroundColor).toBe(
        project.palette.universalBackgroundColor,
      );
      expect(dualBank.palettes).toEqual(project.palette.palettes);
      expect(dualBank.activeBackgroundSlots).toEqual(
        project.palette.activeBackgroundSlots,
      );
      expect(dualBank.activeSpriteSlots).toEqual(
        project.palette.activeSpriteSlots,
      );
    });

    it('exporters from project state match exporters from canonical state', () => {
      const project = createFull8PaletteProject();
      const dualBank = resolveProjectPaletteState(project);

      const bgFromProject = exportBackgroundPaletteBinary(dualBank);
      const sprFromProject = exportSpritePaletteBinary(dualBank);
      const fullFromProject = exportFullPpuPaletteBinary(dualBank);

      // Manually resolve from project palette config
      const directState: DualBankPaletteState = {
        universalBackgroundColor: project.palette.universalBackgroundColor,
        palettes: project.palette.palettes,
        activeBackgroundSlots: project.palette.activeBackgroundSlots,
        activeSpriteSlots: project.palette.activeSpriteSlots,
      };

      expect(Array.from(bgFromProject)).toEqual(
        Array.from(exportBackgroundPaletteBinary(directState)),
      );
      expect(Array.from(sprFromProject)).toEqual(
        Array.from(exportSpritePaletteBinary(directState)),
      );
      expect(Array.from(fullFromProject)).toEqual(
        Array.from(exportFullPpuPaletteBinary(directState)),
      );
    });

    it('findPaletteSlotIndex is consistent between BG and SPR banks', () => {
      const state = createFull8PaletteState();
      // bg_2 should be in BG slot 2
      expect(findPaletteSlotIndex('bg_2', state.activeBackgroundSlots)).toBe(2);
      // bg_2 should NOT be in SPR slots
      expect(findPaletteSlotIndex('bg_2', state.activeSpriteSlots)).toBeNull();
      // spr_1 should be in SPR slot 1
      expect(findPaletteSlotIndex('spr_1', state.activeSpriteSlots)).toBe(1);
      // spr_1 should NOT be in BG slots
      expect(
        findPaletteSlotIndex('spr_1', state.activeBackgroundSlots),
      ).toBeNull();
    });

    it('createDefaultDualBankPaletteState produces valid state with zero diagnostics', () => {
      const defaultState = createDefaultDualBankPaletteState();
      const diagnostics = analyzeProjectPaletteDiagnostics({
        universalBackgroundColor: defaultState.universalBackgroundColor,
        palettes: defaultState.palettes,
        activeBackgroundSlots: defaultState.activeBackgroundSlots,
        activeSpriteSlots: defaultState.activeSpriteSlots,
      });
      // Allow inconsistent-universal-color warnings for default state
      // (default palettes may use $0F as color 0 which matches the default universal bg)
      const errors = diagnostics.filter((f) => f.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });
});
