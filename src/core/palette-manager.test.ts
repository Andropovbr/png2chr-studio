import { describe, expect, it } from 'vitest';
import {
  analyzeScenePalettes,
  createDefaultPaletteDefinitions,
  duplicatePaletteDefinition,
  findPaletteDefinition,
  findPaletteUsageReferences,
  generatePaletteId,
  resolveActivePaletteSet,
  resolveEffectivePaletteColors,
  resolveSpritePaletteSlot,
  type PaletteDefinition,
} from './palette-manager';
import type { NesPalette } from './nes-palette';

describe('palette-manager domain module', () => {
  it('generates unique palette IDs', () => {
    const id1 = generatePaletteId();
    const id2 = generatePaletteId();
    expect(id1).not.toBe(id2);
    expect(id1.startsWith('pal_')).toBe(true);
  });

  it('creates 4 default palette definitions with distinct IDs', () => {
    const defaultDefs = createDefaultPaletteDefinitions();
    expect(defaultDefs).toHaveLength(4);
    const ids = new Set(defaultDefs.map((p) => p.id));
    expect(ids.size).toBe(4);
    expect(defaultDefs[0]?.colors).toHaveLength(4);
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
  });

  it('resolves sprite palette slot correctly (active vs not active)', () => {
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
    const palC: PaletteDefinition = {
      id: 'pal_sword',
      name: 'Sword Steel',
      colors: [0x0f, 0x00, 0x10, 0x30],
    };
    const palD: PaletteDefinition = {
      id: 'pal_poison',
      name: 'Poison Green',
      colors: [0x0f, 0x0a, 0x1a, 0x2a],
    };
    const palE: PaletteDefinition = {
      id: 'pal_fire',
      name: 'Fire Orange',
      colors: [0x0f, 0x06, 0x16, 0x26],
    };

    const palettes = [palA, palB, palC, palD, palE];
    const activeSlots = ['pal_hero', 'pal_enemy', 'pal_sword', 'pal_poison'];

    // Slot 0
    const resA = resolveSpritePaletteSlot('pal_hero', activeSlots, palettes);
    expect(resA.isActive).toBe(true);
    expect(resA.slotIndex).toBe(0);
    expect(resA.definition).toBe(palA);

    // Slot 3
    const resD = resolveSpritePaletteSlot('pal_poison', activeSlots, palettes);
    expect(resD.isActive).toBe(true);
    expect(resD.slotIndex).toBe(3);
    expect(resD.definition).toBe(palD);

    // Not in active slots (Fire)
    const resE = resolveSpritePaletteSlot('pal_fire', activeSlots, palettes);
    expect(resE.isActive).toBe(false);
    expect(resE.slotIndex).toBeNull();
    expect(resE.definition).toBe(palE);
  });

  it('resolves active NesPaletteSet from 4 active slots', () => {
    const pal0: PaletteDefinition = {
      id: 'pal_0',
      name: 'P0',
      colors: [0x0f, 0x01, 0x11, 0x21],
    };
    const pal1: PaletteDefinition = {
      id: 'pal_1',
      name: 'P1',
      colors: [0x0f, 0x02, 0x12, 0x22],
    };
    const palettes = [pal0, pal1];
    const activeSlots = ['pal_0', 'pal_1', null, 'pal_invalid'];

    const resolved = resolveActivePaletteSet(palettes, activeSlots);
    expect(resolved).toHaveLength(4);
    expect(resolved[0]).toEqual([0x0f, 0x01, 0x11, 0x21]);
    expect(resolved[1]).toEqual([0x0f, 0x02, 0x12, 0x22]);
    // Empty slots fall back to default
    expect(resolved[2]).toHaveLength(4);
    expect(resolved[3]).toHaveLength(4);
  });

  it('resolves effective palette colors for an entity/frame', () => {
    const palA: PaletteDefinition = {
      id: 'pal_custom',
      name: 'Custom',
      colors: [0x0f, 0x09, 0x19, 0x29],
    };

    // By ID
    const colors = resolveEffectivePaletteColors('pal_custom', [palA]);
    expect(colors).toEqual([0x0f, 0x09, 0x19, 0x29]);

    // Fallback when ID not found
    const fallbackColors = resolveEffectivePaletteColors('nonexistent', [palA], 1);
    expect(fallbackColors).toHaveLength(4);
  });

  it('analyzes scene palettes and counts active vs unassigned palettes', () => {
    const palA: PaletteDefinition = { id: 'pal_a', name: 'A', colors: [0x0f, 1, 2, 3] as unknown as NesPalette };
    const palB: PaletteDefinition = { id: 'pal_b', name: 'B', colors: [0x0f, 4, 5, 6] as unknown as NesPalette };
    const palC: PaletteDefinition = { id: 'pal_c', name: 'C', colors: [0x0f, 7, 8, 9] as unknown as NesPalette };
    const palD: PaletteDefinition = { id: 'pal_d', name: 'D', colors: [0x0f, 10, 11, 12] as unknown as NesPalette };
    const palE: PaletteDefinition = { id: 'pal_e', name: 'E', colors: [0x0f, 13, 14, 15] as unknown as NesPalette };

    const palettes = [palA, palB, palC, palD, palE];
    const activeSlots = ['pal_a', 'pal_b', 'pal_c', 'pal_d'];

    // 3 required, all active
    const analysis1 = analyzeScenePalettes(['pal_a', 'pal_b', 'pal_a'], activeSlots, palettes);
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

  it('duplicates palette with new stable ID and copy name', () => {
    const original: PaletteDefinition = {
      id: 'pal_orig',
      name: 'Fire Red',
      colors: [0x0f, 0x06, 0x16, 0x26],
    };

    const duplicate = duplicatePaletteDefinition(original);
    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.name).toBe('Fire Red (Copy)');
    expect(duplicate.colors).toEqual(original.colors);
  });

  it('finds usage references across entities, animations, and active slots', () => {
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

    const heroRefs = findPaletteUsageReferences('pal_hero', animations, activeSlots);
    expect(heroRefs.some((r) => r.type === 'slot')).toBe(true);
    expect(heroRefs.some((r) => r.type === 'entity' && r.name === 'Hero')).toBe(true);

    const unusedRefs = findPaletteUsageReferences('pal_unused', animations, activeSlots);
    expect(unusedRefs).toHaveLength(0);
  });
});
