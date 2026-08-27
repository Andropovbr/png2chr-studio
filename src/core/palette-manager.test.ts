import { describe, expect, it } from 'vitest';
import {
  analyzeScenePalettes,
  assignPaletteToSlot,
  createDefaultActivePaletteSlots,
  createDefaultDualBankPaletteState,
  createDefaultPaletteDefinitions,
  createEmptyActivePaletteSlots,
  createPaletteDefinition,
  DEFAULT_FALLBACK_SUBPALETTE,
  DEFAULT_UNIVERSAL_BACKGROUND_COLOR,
  duplicatePaletteDefinition,
  findPaletteDefinition,
  findPaletteSlotIndex,
  findPaletteUsageReferences,
  generatePaletteId,
  isProjectPaletteId,
  normalizePaletteId,
  resolveActiveBackgroundPaletteSet,
  resolveActivePaletteSet,
  resolveActivePaletteSetBySlots,
  resolveActiveSpritePaletteSet,
  resolveBackgroundPaletteSlot,
  resolveEffectivePaletteColors,
  resolveSpritePaletteSlot,
  resolveUniversalBackgroundMirroring,
  updatePaletteColor,
  updatePaletteName,
  updatePaletteTarget,
  type ActivePaletteSlots,
  type DualBankPaletteState,
  type PaletteDefinition,
} from './palette-manager';
import type { NesPalette, NesPaletteSet } from './nes-palette';

describe('palette-manager domain module', () => {
  describe('ProjectPaletteId and ID helpers', () => {
    it('generates unique palette IDs with default and custom prefixes', () => {
      const id1 = generatePaletteId();
      const id2 = generatePaletteId();
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('pal_')).toBe(true);

      const customPrefixId = generatePaletteId('bg_pal');
      expect(customPrefixId.startsWith('bg_pal_')).toBe(true);
    });

    it('validates palette IDs with isProjectPaletteId', () => {
      expect(isProjectPaletteId('pal_hero')).toBe(true);
      expect(isProjectPaletteId('pal_123')).toBe(true);
      expect(isProjectPaletteId('')).toBe(false);
      expect(isProjectPaletteId('   ')).toBe(false);
      expect(isProjectPaletteId(null)).toBe(false);
      expect(isProjectPaletteId(undefined)).toBe(false);
      expect(isProjectPaletteId(123)).toBe(false);
    });

    it('normalizes palette IDs with normalizePaletteId', () => {
      expect(normalizePaletteId('  pal_custom  ')).toBe('pal_custom');
      const generated1 = normalizePaletteId('');
      expect(generated1.startsWith('pal_')).toBe(true);
      const generated2 = normalizePaletteId(null, 'custom_prefix');
      expect(generated2.startsWith('custom_prefix_')).toBe(true);
    });
  });

  describe('PaletteDefinition authoring and library operations', () => {
    it('creates a palette definition with defaults', () => {
      const pal = createPaletteDefinition();
      expect(pal.id.startsWith('pal_')).toBe(true);
      expect(pal.name).toBe('New Palette');
      expect(pal.colors).toEqual(DEFAULT_FALLBACK_SUBPALETTE);
      expect(pal.target).toBeUndefined();
    });

    it('creates a custom palette definition with specific properties and target', () => {
      const pal = createPaletteDefinition({
        id: 'pal_hero_blue',
        name: 'Hero Blue',
        colors: [0x0f, 0x01, 0x11, 0x21],
        target: 'sprite',
      });
      expect(pal.id).toBe('pal_hero_blue');
      expect(pal.name).toBe('Hero Blue');
      expect(pal.colors).toEqual([0x0f, 0x01, 0x11, 0x21]);
      expect(pal.target).toBe('sprite');
    });

    it('validates NES color codes when creating a palette definition', () => {
      expect(() =>
        createPaletteDefinition({
          colors: [0x0f, 0x01, 0x11, 0x40], // 0x40 is 64 (invalid)
        }),
      ).toThrow(RangeError);

      expect(() =>
        createPaletteDefinition({
          colors: [0x0f, -1, 0x11, 0x21],
        }),
      ).toThrow(RangeError);
    });

    it('creates 4 default palette definitions with distinct IDs', () => {
      const defaultDefs = createDefaultPaletteDefinitions();
      expect(defaultDefs).toHaveLength(4);
      const ids = new Set(defaultDefs.map((p) => p.id));
      expect(ids.size).toBe(4);
      expect(defaultDefs[0]?.colors).toHaveLength(4);
    });

    it('creates custom default palette definitions based on provided basePaletteSet', () => {
      const customBase = [
        [0x0f, 0x10, 0x20, 0x30],
        [0x0f, 0x11, 0x21, 0x31],
        [0x0f, 0x12, 0x22, 0x32],
        [0x0f, 0x13, 0x23, 0x33],
      ] as const;

      const defs = createDefaultPaletteDefinitions(customBase);
      expect(defs).toHaveLength(4);
      expect(defs[0]?.colors).toEqual([0x0f, 0x10, 0x20, 0x30]);
      expect(defs[1]?.colors).toEqual([0x0f, 0x11, 0x21, 0x31]);
      expect(defs[2]?.colors).toEqual([0x0f, 0x12, 0x22, 0x32]);
      expect(defs[3]?.colors).toEqual([0x0f, 0x13, 0x23, 0x33]);
    });

    it('finds palette definitions by ID', () => {
      const palA: PaletteDefinition = {
        id: 'pal_hero',
        name: 'Hero Blue',
        colors: [0x0f, 0x01, 0x11, 0x21],
      };
      const palB: PaletteDefinition = {
        id: 'pal_enemy',
        name: 'Enemy Red',
        colors: [0x0f, 0x05, 0x15, 0x25],
      };

      expect(findPaletteDefinition([palA, palB], 'pal_hero')).toBe(palA);
      expect(findPaletteDefinition([palA, palB], 'pal_enemy')).toBe(palB);
      expect(findPaletteDefinition([palA, palB], 'pal_nonexistent')).toBeNull();
      expect(findPaletteDefinition([], 'pal_hero')).toBeNull();
      expect(findPaletteDefinition(null, 'pal_hero')).toBeNull();
      expect(findPaletteDefinition([palA], null)).toBeNull();
    });

    it('duplicates palette with new stable ID, copy name, and independent colors array', () => {
      const original: PaletteDefinition = {
        id: 'pal_orig',
        name: 'Fire Red',
        colors: [0x0f, 0x06, 0x16, 0x26],
        target: 'sprite',
      };

      const duplicate = duplicatePaletteDefinition(original);
      expect(duplicate.id).not.toBe(original.id);
      expect(duplicate.name).toBe('Fire Red (Copy)');
      expect(duplicate.colors).toEqual(original.colors);
      expect(duplicate.colors).not.toBe(original.colors); // defensive clone
      expect(duplicate.target).toBe('sprite');
    });

    it('supports custom name and custom ID when duplicating a palette', () => {
      const original: PaletteDefinition = {
        id: 'pal_hero',
        name: 'Hero Normal',
        colors: [0x0f, 0x11, 0x21, 0x30],
      };

      const duplicate = duplicatePaletteDefinition(
        original,
        'Hero Super Saiyan',
        'pal_hero_ssj',
      );
      expect(duplicate.id).toBe('pal_hero_ssj');
      expect(duplicate.name).toBe('Hero Super Saiyan');
      expect(duplicate.colors).toEqual(original.colors);
    });

    it('updates palette name immutably without mutating original', () => {
      const original: PaletteDefinition = {
        id: 'pal_1',
        name: 'Old Name',
        colors: [0x0f, 0x01, 0x11, 0x21],
      };

      const updated = updatePaletteName(original, 'New Name');
      expect(updated.name).toBe('New Name');
      expect(original.name).toBe('Old Name');
      expect(updated.id).toBe(original.id);
      expect(updated.colors).toEqual(original.colors);

      // Preserves existing name if empty whitespace provided
      const unchanged = updatePaletteName(original, '   ');
      expect(unchanged.name).toBe('Old Name');
    });

    it('updates individual colors (0..3) immutably with validation', () => {
      const original: PaletteDefinition = {
        id: 'pal_1',
        name: 'Test',
        colors: [0x0f, 0x01, 0x11, 0x21],
      };

      // Update color 0
      const c0 = updatePaletteColor(original, 0, 0x00);
      expect(c0.colors).toEqual([0x00, 0x01, 0x11, 0x21]);
      expect(original.colors[0]).toBe(0x0f);

      // Update color 1
      const c1 = updatePaletteColor(original, 1, 0x05);
      expect(c1.colors).toEqual([0x0f, 0x05, 0x11, 0x21]);

      // Update color 2
      const c2 = updatePaletteColor(original, 2, 0x15);
      expect(c2.colors).toEqual([0x0f, 0x01, 0x15, 0x21]);

      // Update color 3
      const c3 = updatePaletteColor(original, 3, 0x30);
      expect(c3.colors).toEqual([0x0f, 0x01, 0x11, 0x30]);

      // Invalid color index
      expect(() => updatePaletteColor(original, -1, 0x05)).toThrow(RangeError);
      expect(() => updatePaletteColor(original, 4, 0x05)).toThrow(RangeError);

      // Invalid NES color code
      expect(() => updatePaletteColor(original, 1, -1)).toThrow(RangeError);
      expect(() => updatePaletteColor(original, 1, 64)).toThrow(RangeError);
    });

    it('updates palette target immutably', () => {
      const original: PaletteDefinition = {
        id: 'pal_1',
        name: 'Test',
        colors: [0x0f, 0x01, 0x11, 0x21],
      };

      const updated = updatePaletteTarget(original, 'background');
      expect(updated.target).toBe('background');
      expect(original.target).toBeUndefined();

      const cleared = updatePaletteTarget(updated, undefined);
      expect(cleared.target).toBeUndefined();
    });
  });

  describe('ActivePaletteSlots and slot resolvers', () => {
    it('creates empty and default active slots tuples', () => {
      const empty = createEmptyActivePaletteSlots();
      expect(empty).toEqual([null, null, null, null]);

      const pal0 = createPaletteDefinition({ id: 'p0' });
      const pal1 = createPaletteDefinition({ id: 'p1' });
      const defaultSlots = createDefaultActivePaletteSlots([pal0, pal1]);
      expect(defaultSlots).toEqual(['p0', 'p1', null, null]);
    });

    it('assigns palette to slot immutably with validation', () => {
      const slots: ActivePaletteSlots = ['p0', 'p1', null, null];
      const assigned = assignPaletteToSlot(slots, 2, 'p2');
      expect(assigned).toEqual(['p0', 'p1', 'p2', null]);
      expect(slots[2]).toBeNull(); // original untouched

      const unassigned = assignPaletteToSlot(assigned, 0, null);
      expect(unassigned).toEqual([null, 'p1', 'p2', null]);

      expect(() => assignPaletteToSlot(slots, -1, 'p0')).toThrow(RangeError);
      expect(() => assignPaletteToSlot(slots, 4, 'p0')).toThrow(RangeError);
    });

    it('finds palette slot index deterministically across edge cases', () => {
      const slots = ['pal_0', 'pal_1', 'pal_2', 'pal_3'];
      expect(findPaletteSlotIndex('pal_0', slots)).toBe(0); // first slot
      expect(findPaletteSlotIndex('pal_3', slots)).toBe(3); // last slot
      expect(findPaletteSlotIndex('pal_unassigned', slots)).toBeNull();
      expect(findPaletteSlotIndex(null, slots)).toBeNull();
      expect(findPaletteSlotIndex('pal_0', null)).toBeNull();

      // Duplicate slots return the first matching slot index
      const duplicateSlots = ['pal_dup', 'pal_other', 'pal_dup', null];
      expect(findPaletteSlotIndex('pal_dup', duplicateSlots)).toBe(0);
    });

    it('resolves sprite palette slot correctly (active vs not active)', () => {
      const palA = createPaletteDefinition({
        id: 'pal_hero',
        name: 'Hero Blue',
        colors: [0x0f, 0x01, 0x11, 0x21],
      });
      const palB = createPaletteDefinition({
        id: 'pal_enemy',
        name: 'Enemy Red',
        colors: [0x0f, 0x05, 0x15, 0x25],
      });
      const palC = createPaletteDefinition({
        id: 'pal_sword',
        name: 'Sword Steel',
        colors: [0x0f, 0x00, 0x10, 0x30],
      });
      const palD = createPaletteDefinition({
        id: 'pal_poison',
        name: 'Poison Green',
        colors: [0x0f, 0x0a, 0x1a, 0x2a],
      });
      const palE = createPaletteDefinition({
        id: 'pal_fire',
        name: 'Fire Orange',
        colors: [0x0f, 0x06, 0x16, 0x26],
      });

      const palettes = [palA, palB, palC, palD, palE];
      const activeSlots: ActivePaletteSlots = [
        'pal_hero',
        'pal_enemy',
        'pal_sword',
        'pal_poison',
      ];

      // Slot 0
      const resA = resolveSpritePaletteSlot('pal_hero', activeSlots, palettes);
      expect(resA.isActive).toBe(true);
      expect(resA.slotIndex).toBe(0);
      expect(resA.definition).toBe(palA);

      // Slot 3
      const resD = resolveSpritePaletteSlot(
        'pal_poison',
        activeSlots,
        palettes,
      );
      expect(resD.isActive).toBe(true);
      expect(resD.slotIndex).toBe(3);
      expect(resD.definition).toBe(palD);

      // Not in active slots (Fire)
      const resE = resolveSpritePaletteSlot('pal_fire', activeSlots, palettes);
      expect(resE.isActive).toBe(false);
      expect(resE.slotIndex).toBeNull();
      expect(resE.definition).toBe(palE);
    });

    it('resolves background palette slot identically via resolveBackgroundPaletteSlot', () => {
      const palA = createPaletteDefinition({
        id: 'pal_bg0',
        name: 'BG 0',
        colors: [0x0f, 0x01, 0x11, 0x21],
      });
      const palettes = [palA];
      const slots: ActivePaletteSlots = ['pal_bg0', null, null, null];

      const res = resolveBackgroundPaletteSlot('pal_bg0', slots, palettes);
      expect(res.isActive).toBe(true);
      expect(res.slotIndex).toBe(0);
      expect(res.definition).toBe(palA);
    });

    it('handles empty/null/undefined palette references in slot resolvers gracefully', () => {
      const resNull = resolveSpritePaletteSlot(null, null, null);
      expect(resNull.isActive).toBe(false);
      expect(resNull.slotIndex).toBeNull();
      expect(resNull.definition).toBeNull();

      const resEmpty = resolveSpritePaletteSlot('', ['pal_1'], []);
      expect(resEmpty.isActive).toBe(false);
      expect(resEmpty.slotIndex).toBeNull();

      const resBgNull = resolveBackgroundPaletteSlot(null, null, null);
      expect(resBgNull.isActive).toBe(false);
      expect(resBgNull.slotIndex).toBeNull();
    });
  });

  describe('Active Bank Resolution & Fallbacks', () => {
    it('resolves active NesPaletteSet from 4 active slots using resolveActivePaletteSetBySlots', () => {
      const pal0 = createPaletteDefinition({
        id: 'pal_0',
        name: 'P0',
        colors: [0x0f, 0x01, 0x11, 0x21],
      });
      const pal1 = createPaletteDefinition({
        id: 'pal_1',
        name: 'P1',
        colors: [0x0f, 0x02, 0x12, 0x22],
      });
      const palettes = [pal0, pal1];
      const activeSlots: ActivePaletteSlots = [
        'pal_0',
        'pal_1',
        null,
        'pal_invalid',
      ];

      const resolved = resolveActivePaletteSetBySlots(palettes, activeSlots);
      expect(resolved).toHaveLength(4);
      expect(resolved[0]).toEqual([0x0f, 0x01, 0x11, 0x21]);
      expect(resolved[1]).toEqual([0x0f, 0x02, 0x12, 0x22]);
      // Empty and invalid slots fall back deterministically to default NES palette set
      expect(resolved[2]).toEqual([0x0f, 0x09, 0x19, 0x29]);
      expect(resolved[3]).toEqual([0x0f, 0x03, 0x13, 0x23]);
    });

    it('uses custom fallbackSet when provided for unassigned/invalid slots', () => {
      const customFallback: NesPaletteSet = [
        [0x0f, 0x10, 0x20, 0x30],
        [0x0f, 0x11, 0x21, 0x31],
        [0x0f, 0x12, 0x22, 0x32],
        [0x0f, 0x13, 0x23, 0x33],
      ];
      const pal0 = createPaletteDefinition({
        id: 'pal_0',
        colors: [0x0f, 0x06, 0x16, 0x26],
      });
      const slots: ActivePaletteSlots = ['pal_0', null, null, null];

      const resolved = resolveActivePaletteSetBySlots(
        [pal0],
        slots,
        customFallback,
      );
      expect(resolved[0]).toEqual([0x0f, 0x06, 0x16, 0x26]);
      expect(resolved[1]).toEqual([0x0f, 0x11, 0x21, 0x31]);
      expect(resolved[2]).toEqual([0x0f, 0x12, 0x22, 0x32]);
      expect(resolved[3]).toEqual([0x0f, 0x13, 0x23, 0x33]);
    });

    it('preserves resolveActivePaletteSet legacy wrapper behavior', () => {
      const pal0 = createPaletteDefinition({
        id: 'pal_0',
        colors: [0x0f, 0x01, 0x11, 0x21],
      });
      const resolved = resolveActivePaletteSet(
        [pal0],
        ['pal_0', null, null, null],
      );
      expect(resolved[0]).toEqual([0x0f, 0x01, 0x11, 0x21]);
    });

    it('resolves effective palette colors for an entity/frame', () => {
      const palA = createPaletteDefinition({
        id: 'pal_custom',
        name: 'Custom',
        colors: [0x0f, 0x09, 0x19, 0x29],
      });

      // By ID
      const colors = resolveEffectivePaletteColors('pal_custom', [palA]);
      expect(colors).toEqual([0x0f, 0x09, 0x19, 0x29]);

      // Fallback when ID not found
      const fallbackColors = resolveEffectivePaletteColors(
        'nonexistent',
        [palA],
        1,
      );
      expect(fallbackColors).toHaveLength(4);
    });
  });

  describe('Universal Background Color ($3F00) & Mirroring', () => {
    it('mirrors universal background color into index 0 of all 4 subpalettes', () => {
      const inputSet: NesPaletteSet = [
        [0x00, 0x01, 0x02, 0x03],
        [0x05, 0x06, 0x07, 0x08],
        [0x09, 0x0a, 0x0b, 0x0c],
        [0x0d, 0x0e, 0x0f, 0x10],
      ];

      const mirrored = resolveUniversalBackgroundMirroring(inputSet, 0x20);

      // Index 0 of all subpalettes ($3F00, $3F04, $3F08, $3F0C) is mirrored to $20
      expect(mirrored[0][0]).toBe(0x20);
      expect(mirrored[1][0]).toBe(0x20);
      expect(mirrored[2][0]).toBe(0x20);
      expect(mirrored[3][0]).toBe(0x20);

      // Colors 1..3 are preserved exactly
      expect(mirrored[0].slice(1)).toEqual([0x01, 0x02, 0x03]);
      expect(mirrored[1].slice(1)).toEqual([0x06, 0x07, 0x08]);
      expect(mirrored[2].slice(1)).toEqual([0x0a, 0x0b, 0x0c]);
      expect(mirrored[3].slice(1)).toEqual([0x0e, 0x0f, 0x10]);

      // Original input set is not mutated
      expect(inputSet[0][0]).toBe(0x00);
      expect(inputSet[1][0]).toBe(0x05);
    });

    it('rejects invalid universal background color codes outside $00..$3F', () => {
      const inputSet: NesPaletteSet = [
        [0x0f, 1, 2, 3],
        [0x0f, 4, 5, 6],
        [0x0f, 7, 8, 9],
        [0x0f, 10, 11, 12],
      ];
      expect(() => resolveUniversalBackgroundMirroring(inputSet, -1)).toThrow(
        RangeError,
      );
      expect(() => resolveUniversalBackgroundMirroring(inputSet, 64)).toThrow(
        RangeError,
      );
      expect(() => resolveUniversalBackgroundMirroring(inputSet, 3.14)).toThrow(
        RangeError,
      );
    });

    it('resolves active Background palette set with universal background mirroring applied', () => {
      const bg0 = createPaletteDefinition({
        id: 'bg0',
        name: 'Grass',
        colors: [0x00, 0x09, 0x19, 0x29],
      });
      const bg1 = createPaletteDefinition({
        id: 'bg1',
        name: 'Bricks',
        colors: [0x00, 0x06, 0x16, 0x26],
      });
      const palettes = [bg0, bg1];
      const bgSlots: ActivePaletteSlots = ['bg0', 'bg1', null, null];

      const resolved = resolveActiveBackgroundPaletteSet(
        palettes,
        bgSlots,
        0x0f, // Black universal background ($3F00)
      );

      expect(resolved[0]).toEqual([0x0f, 0x09, 0x19, 0x29]);
      expect(resolved[1]).toEqual([0x0f, 0x06, 0x16, 0x26]);
      expect(resolved[2][0]).toBe(0x0f);
      expect(resolved[3][0]).toBe(0x0f);
    });

    it('resolves active Sprite palette set with transparency semantics', () => {
      const sp0 = createPaletteDefinition({
        id: 'sp0',
        name: 'Hero',
        colors: [0x00, 0x11, 0x21, 0x30],
      });
      const spSlots: ActivePaletteSlots = ['sp0', null, null, null];

      const resolved = resolveActiveSpritePaletteSet([sp0], spSlots);
      // Sprite colors 1..3 preserved
      expect(resolved[0][1]).toBe(0x11);
      expect(resolved[0][2]).toBe(0x21);
      expect(resolved[0][3]).toBe(0x30);

      // With universal color mirroring
      const resolvedWithUniversal = resolveActiveSpritePaletteSet(
        [sp0],
        spSlots,
        undefined,
        0x0f,
      );
      expect(resolvedWithUniversal[0]).toEqual([0x0f, 0x11, 0x21, 0x30]);
    });
  });

  describe('Dual Banks & Independence Invariant', () => {
    it('creates a default dual-bank palette state with independent Background and Sprite banks', () => {
      const state: DualBankPaletteState = createDefaultDualBankPaletteState();
      expect(state.universalBackgroundColor).toBe(
        DEFAULT_UNIVERSAL_BACKGROUND_COLOR,
      );
      expect(state.palettes).toHaveLength(8); // 4 BG + 4 SP

      const bgPalettes = state.palettes.filter(
        (p) => p.target === 'background',
      );
      const spPalettes = state.palettes.filter((p) => p.target === 'sprite');
      expect(bgPalettes).toHaveLength(4);
      expect(spPalettes).toHaveLength(4);

      expect(state.activeBackgroundSlots).toHaveLength(4);
      expect(state.activeSpriteSlots).toHaveLength(4);

      // Verify slot IDs are distinct between Background and Sprites
      const bgSlotSet = new Set(state.activeBackgroundSlots);
      const spSlotSet = new Set(state.activeSpriteSlots);
      expect(bgSlotSet.size).toBe(4);
      expect(spSlotSet.size).toBe(4);
      for (const id of bgSlotSet) {
        expect(spSlotSet.has(id)).toBe(false);
      }
    });

    it('verifies strict independence: resolving/modifying Sprite bank NEVER alters Background bank', () => {
      const bgDef0 = createPaletteDefinition({
        id: 'pal_bg_grass',
        name: 'Grass',
        colors: [0x0f, 0x09, 0x19, 0x29],
        target: 'background',
      });
      const spDef0 = createPaletteDefinition({
        id: 'pal_sp_hero',
        name: 'Hero Blue',
        colors: [0x0f, 0x01, 0x11, 0x21],
        target: 'sprite',
      });

      const palettes = [bgDef0, spDef0];
      const bgSlots: ActivePaletteSlots = ['pal_bg_grass', null, null, null];
      let spSlots: ActivePaletteSlots = ['pal_sp_hero', null, null, null];

      // Resolve initial BG bank
      const initialBg = resolveActiveBackgroundPaletteSet(
        palettes,
        bgSlots,
        0x0f,
      );
      expect(initialBg[0]).toEqual([0x0f, 0x09, 0x19, 0x29]);

      // Reassign Sprite Slot 0 to a completely new palette
      const spDef1 = createPaletteDefinition({
        id: 'pal_sp_fire',
        name: 'Hero Fire',
        colors: [0x0f, 0x06, 0x16, 0x26],
        target: 'sprite',
      });
      spSlots = assignPaletteToSlot(spSlots, 0, 'pal_sp_fire');

      // Resolve Sprite bank
      const resolvedSp = resolveActiveSpritePaletteSet(
        [...palettes, spDef1],
        spSlots,
      );
      expect(resolvedSp[0]).toEqual([0x0f, 0x06, 0x16, 0x26]);

      // Resolve Background bank again: MUST remain 100% identical and unaffected
      const afterBg = resolveActiveBackgroundPaletteSet(
        [...palettes, spDef1],
        bgSlots,
        0x0f,
      );
      expect(afterBg).toEqual(initialBg);
      expect(afterBg[0]).toEqual([0x0f, 0x09, 0x19, 0x29]);
    });
  });

  describe('Scene Analysis', () => {
    it('analyzes scene palettes and counts active vs unassigned palettes', () => {
      const palA = createPaletteDefinition({
        id: 'pal_a',
        name: 'A',
        colors: [0x0f, 1, 2, 3] as unknown as NesPalette,
      });
      const palB = createPaletteDefinition({
        id: 'pal_b',
        name: 'B',
        colors: [0x0f, 4, 5, 6] as unknown as NesPalette,
      });
      const palC = createPaletteDefinition({
        id: 'pal_c',
        name: 'C',
        colors: [0x0f, 7, 8, 9] as unknown as NesPalette,
      });
      const palD = createPaletteDefinition({
        id: 'pal_d',
        name: 'D',
        colors: [0x0f, 10, 11, 12] as unknown as NesPalette,
      });
      const palE = createPaletteDefinition({
        id: 'pal_e',
        name: 'E',
        colors: [0x0f, 13, 14, 15] as unknown as NesPalette,
      });

      const palettes = [palA, palB, palC, palD, palE];
      const activeSlots = ['pal_a', 'pal_b', 'pal_c', 'pal_d'];

      // 3 required, all active
      const analysis1 = analyzeScenePalettes(
        ['pal_a', 'pal_b', 'pal_a'],
        activeSlots,
        palettes,
      );
      expect(analysis1.requiredCount).toBe(2);
      expect(analysis1.activeCount).toBe(2);
      expect(analysis1.unassignedPaletteIds).toHaveLength(0);

      // 5 required, 1 not in active slots (pal_e)
      const analysis2 = analyzeScenePalettes(
        ['pal_a', 'pal_b', 'pal_c', 'pal_d', 'pal_e'],
        activeSlots,
        palettes,
      );
      expect(analysis2.requiredCount).toBe(5);
      expect(analysis2.activeCount).toBe(4);
      expect(analysis2.unassignedPaletteIds).toEqual(['pal_e']);
    });
  });

  describe('findPaletteUsageReferences', () => {
    it('finds usage references across entities, animations, and active sprite slots', () => {
      const animations = [
        {
          id: 'anim_1',
          name: 'walk',
          entity: 'Hero',
          paletteId: 'pal_hero',
        },
        {
          id: 'anim_2',
          name: 'attack',
          entity: 'Hero',
          paletteId: 'pal_hero',
        },
        {
          id: 'anim_3',
          name: 'fly',
          entity: 'Bat',
          paletteId: 'pal_bat',
        },
      ];
      const activeSlots = ['pal_hero', 'pal_bat', null, null];

      const heroRefs = findPaletteUsageReferences(
        'pal_hero',
        animations,
        activeSlots,
      );
      expect(heroRefs.some((r) => r.type === 'slot')).toBe(true);
      expect(
        heroRefs.some((r) => r.type === 'entity' && r.name === 'Hero'),
      ).toBe(true);

      const unusedRefs = findPaletteUsageReferences(
        'pal_unused',
        animations,
        activeSlots,
      );
      expect(unusedRefs).toHaveLength(0);

      // Empty palette ID returns empty array
      expect(findPaletteUsageReferences('', animations, activeSlots)).toEqual(
        [],
      );
    });

    it('tracks frame palette override references accurately', () => {
      const animations = [
        {
          id: 'anim_boss',
          name: 'phase2',
          entity: 'Boss',
          paletteId: 'pal_boss',
          framePaletteIds: ['pal_boss', 'pal_flash', 'pal_boss'],
        },
      ];
      const activeSlots = ['pal_boss', null, null, null];

      const flashRefs = findPaletteUsageReferences(
        'pal_flash',
        animations,
        activeSlots,
      );
      expect(flashRefs).toHaveLength(1);
      expect(flashRefs[0]?.type).toBe('frame');
      expect(flashRefs[0]?.name).toBe('Boss_phase2');
      expect(flashRefs[0]?.detail).toBe('Frame 2 palette override');
    });

    it('tracks usage across rich PaletteUsageSearchContext (dual slots, maps, scene instances)', () => {
      const context = {
        activeSpriteSlots: ['pal_hero', null, null, null],
        activeBackgroundSlots: [null, 'pal_stage_bricks', null, null],
        animations: [
          {
            id: 'anim_1',
            name: 'run',
            entity: 'Player',
            paletteId: 'pal_hero',
          },
        ],
        backgroundMaps: [
          {
            id: 'map_stage1',
            name: 'Stage 1 Outdoors',
            paletteId: 'pal_stage_bricks',
          },
        ],
        sceneInstances: [
          {
            id: 'inst_1',
            name: 'Player Spawn',
            entityId: 'Player',
            paletteId: 'pal_hero',
          },
        ],
      };

      // Hero references: sprite slot, animation entity, scene instance
      const heroRefs = findPaletteUsageReferences('pal_hero', context);
      expect(
        heroRefs.some((r) => r.type === 'slot' && r.name.includes('Sprite')),
      ).toBe(true);
      expect(
        heroRefs.some((r) => r.type === 'entity' && r.name === 'Player'),
      ).toBe(true);
      expect(heroRefs.some((r) => r.type === 'scene')).toBe(true);

      // Stage Bricks references: background slot, background map
      const bgRefs = findPaletteUsageReferences('pal_stage_bricks', context);
      expect(
        bgRefs.some((r) => r.type === 'slot' && r.name.includes('Background')),
      ).toBe(true);
      expect(
        bgRefs.some(
          (r) => r.type === 'background' && r.name === 'Stage 1 Outdoors',
        ),
      ).toBe(true);
    });
  });
});
