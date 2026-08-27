import { describe, expect, it } from 'vitest';
import type { NesPalette } from './nes-palette';
import {
  analyzeProjectPaletteDiagnostics,
  type AnalyzePaletteDiagnosticsOptions,
  type PaletteDefinition,
  type PaletteDiagnosticFact,
} from './palette-manager';

function palette(
  id: string,
  target: PaletteDefinition['target'] = 'sprite',
  colors: readonly number[] = [0x0f, 0x01, 0x11, 0x21],
): PaletteDefinition {
  return {
    id,
    name: id.replace('pal_', ''),
    colors: colors as unknown as NesPalette,
    target,
  };
}

function baseOptions(
  overrides: Partial<AnalyzePaletteDiagnosticsOptions> = {},
): AnalyzePaletteDiagnosticsOptions {
  const palettes = [
    palette('pal_a'),
    palette('pal_b'),
    palette('pal_c'),
    palette('pal_d'),
    palette('pal_e'),
  ];
  return {
    universalBackgroundColor: 0x0f,
    palettes,
    activeBackgroundSlots: [null, null, null, null],
    activeSpriteSlots: ['pal_a', 'pal_b', 'pal_c', 'pal_d'],
    ...overrides,
  };
}

type PaletteFactKind = PaletteDiagnosticFact['kind'];
type PaletteFactOfKind<T extends PaletteFactKind> = Extract<
  PaletteDiagnosticFact,
  { readonly kind: T }
>;

function factsOfKind<T extends PaletteFactKind>(
  options: AnalyzePaletteDiagnosticsOptions,
  kind: T,
): readonly PaletteFactOfKind<T>[] {
  return analyzeProjectPaletteDiagnostics(options).filter(
    (fact): fact is PaletteFactOfKind<T> => fact.kind === kind,
  );
}

describe('palette diagnostics', () => {
  describe('dangling-palette-reference', () => {
    it('reports animation, frame override and both active-bank slot references', () => {
      const facts = factsOfKind(
        baseOptions({
          activeBackgroundSlots: ['pal_missing_bg', null, null, null],
          activeSpriteSlots: ['pal_a', 'pal_missing_sprite', null, null],
          animations: [
            {
              id: 'anim_boss',
              name: 'Boss Walk',
              paletteId: 'pal_missing_animation',
              framePaletteIds: [null, 'pal_missing_frame'],
            },
          ],
        }),
        'dangling-palette-reference',
      );

      expect(facts).toHaveLength(4);
      expect(facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            consumerType: 'animation',
            paletteId: 'pal_missing_animation',
          }),
          expect.objectContaining({
            consumerType: 'frame',
            frameIndex: 1,
            paletteId: 'pal_missing_frame',
          }),
          expect.objectContaining({ bank: 'background', slotIndex: 0 }),
          expect.objectContaining({ bank: 'sprite', slotIndex: 1 }),
        ]),
      );
    });

    it('does not report valid IDs and reports references when the library is empty', () => {
      expect(
        factsOfKind(
          baseOptions({
            animations: [{ id: 'anim_ok', name: 'Idle', paletteId: 'pal_a' }],
          }),
          'dangling-palette-reference',
        ),
      ).toHaveLength(0);

      const emptyLibraryFacts = factsOfKind(
        baseOptions({
          palettes: [],
          activeBackgroundSlots: [null, null, null, null],
          activeSpriteSlots: [null, null, null, null],
          animations: [
            { id: 'anim_missing', name: 'Missing', paletteId: 'pal_none' },
          ],
        }),
        'dangling-palette-reference',
      );
      expect(emptyLibraryFacts).toHaveLength(1);
    });

    it('reports a direct scene-instance reference with its scene context', () => {
      const facts = factsOfKind(
        baseOptions({
          sceneContexts: [
            {
              id: 'boss_room',
              instances: [
                {
                  id: 'boss_instance',
                  name: 'Boss',
                  paletteId: 'pal_missing_scene',
                },
              ],
            },
          ],
        }),
        'dangling-palette-reference',
      );

      expect(facts).toEqual([
        expect.objectContaining({
          code: 'dangling-palette-reference',
          consumerType: 'scene',
          consumerId: 'boss_instance',
          contextId: 'boss_room',
        }),
      ]);
    });

    it('keeps distinct consumers independently actionable while deduplicating identical references', () => {
      const duplicate = {
        id: 'anim_hero',
        name: 'Hero',
        paletteId: 'pal_missing',
      };
      const facts = factsOfKind(
        baseOptions({
          animations: [
            duplicate,
            duplicate,
            { id: 'anim_boss', name: 'Boss', paletteId: 'pal_missing' },
          ],
        }),
        'dangling-palette-reference',
      );

      expect(facts).toHaveLength(2);
      expect(facts.map((fact) => fact.consumerId)).toEqual([
        'anim_boss',
        'anim_hero',
      ]);
    });
  });

  describe('unassigned-active-slot', () => {
    it('warns only when a valid sprite consumer palette is absent from active slots', () => {
      const facts = factsOfKind(
        baseOptions({
          animations: [
            { id: 'anim_active', name: 'Active', paletteId: 'pal_a' },
            { id: 'anim_inactive', name: 'Inactive', paletteId: 'pal_e' },
          ],
        }),
        'unassigned-active-slot',
      );

      expect(facts).toHaveLength(1);
      expect(facts[0]).toEqual(
        expect.objectContaining({
          consumerId: 'anim_inactive',
          paletteId: 'pal_e',
          bank: 'sprite',
        }),
      );
    });

    it('supports background consumers and shared palettes in the required bank', () => {
      const shared = palette('pal_shared', 'shared');
      const facts = factsOfKind(
        baseOptions({
          palettes: [shared],
          activeBackgroundSlots: [null, null, null, null],
          activeSpriteSlots: [null, null, null, null],
          animations: [
            {
              id: 'anim_shared',
              name: 'Shared Sprite',
              paletteId: 'pal_shared',
            },
          ],
          backgrounds: [
            {
              id: 'bg_shared',
              name: 'Shared Background',
              paletteId: 'pal_shared',
            },
          ],
        }),
        'unassigned-active-slot',
      );

      expect(facts).toHaveLength(2);
      expect(facts.map((fact) => fact.bank).sort()).toEqual([
        'background',
        'sprite',
      ]);
    });

    it('does not warn for unused library palettes or empty slots without consumers', () => {
      const facts = factsOfKind(
        baseOptions({
          palettes: [
            ...(baseOptions().palettes ?? []),
            palette('pal_library_only'),
            palette('pal_library_only_2'),
          ],
          activeSpriteSlots: ['pal_a', null, null, null],
          animations: [],
        }),
        'unassigned-active-slot',
      );
      expect(facts).toHaveLength(0);
    });

    it('reports multiple consumers of the same unassigned palette separately', () => {
      const facts = factsOfKind(
        baseOptions({
          animations: [
            { id: 'anim_one', name: 'One', paletteId: 'pal_e' },
            { id: 'anim_two', name: 'Two', paletteId: 'pal_e' },
          ],
        }),
        'unassigned-active-slot',
      );
      expect(facts).toHaveLength(2);
    });
  });

  describe('slot-capacity-exceeded', () => {
    function sceneInstances(ids: readonly string[]) {
      return ids.map((paletteId, index) => ({
        id: `instance_${String(index)}`,
        paletteId,
        visible: true,
      }));
    }

    it.each([
      [['pal_a'], 0],
      [['pal_a', 'pal_b', 'pal_c', 'pal_d'], 0],
      [['pal_a', 'pal_b', 'pal_c', 'pal_d', 'pal_e'], 1],
      [['pal_a', 'pal_a', 'pal_b', 'pal_c', 'pal_c'], 0],
    ] as const)(
      'counts distinct simultaneous palettes for %j',
      (ids, count) => {
        const facts = factsOfKind(
          baseOptions({ sceneInstances: sceneInstances(ids) }),
          'slot-capacity-exceeded',
        );
        expect(facts).toHaveLength(count);
      },
    );

    it('does not count asset or instance quantity when palettes are shared', () => {
      const facts = factsOfKind(
        baseOptions({
          sceneInstances: sceneInstances([
            'pal_a',
            'pal_a',
            'pal_b',
            'pal_b',
            'pal_c',
          ]),
        }),
        'slot-capacity-exceeded',
      );
      expect(facts).toHaveLength(0);
    });

    it('analyzes separate scene contexts independently and ignores global animation count', () => {
      const facts = factsOfKind(
        baseOptions({
          animations: ['a', 'b', 'c', 'd', 'e'].map((id) => ({
            id: `anim_${id}`,
            name: id,
            paletteId: `pal_${id}`,
          })),
          sceneContexts: [
            {
              id: 'scene_a',
              instances: sceneInstances(['pal_a', 'pal_b', 'pal_c']),
            },
            {
              id: 'scene_b',
              instances: sceneInstances(['pal_c', 'pal_d', 'pal_e']),
            },
          ],
        }),
        'slot-capacity-exceeded',
      );
      expect(facts).toHaveLength(0);
    });

    it('uses frame overrides for an explicit simultaneous scene frame', () => {
      const facts = factsOfKind(
        baseOptions({
          palettes: [...(baseOptions().palettes ?? []), palette('pal_flash')],
          animations: [
            {
              id: 'anim_boss',
              name: 'attack',
              entity: 'Boss',
              paletteId: 'pal_a',
              framePaletteIds: [null, 'pal_flash'],
            },
          ],
          sceneInstances: [
            {
              id: 'boss',
              entityId: 'Boss',
              animationName: 'attack',
              frameIndex: 1,
            },
          ],
        }),
        'slot-capacity-exceeded',
      );
      expect(facts).toHaveLength(0);
    });
  });

  describe('NES color validation', () => {
    it('accepts the inclusive $00..$3F boundaries', () => {
      const facts = factsOfKind(
        baseOptions({
          universalBackgroundColor: 0x00,
          palettes: [palette('pal_limits', 'sprite', [0x00, 0x3f, 0x01, 0x02])],
        }),
        'invalid-nes-color',
      );
      expect(facts).toHaveLength(0);
    });

    it.each([-1, 0x40, 1.5])('rejects invalid definition color %s', (value) => {
      const facts = factsOfKind(
        baseOptions({
          palettes: [palette('pal_invalid', 'sprite', [0x0f, value, 1, 2])],
        }),
        'invalid-nes-color',
      );
      expect(facts).toEqual([
        expect.objectContaining({
          paletteId: 'pal_invalid',
          colorIndex: 1,
          colorValue: value,
        }),
      ]);
    });

    it('reports an invalid universal background color independently', () => {
      const facts = factsOfKind(
        baseOptions({ universalBackgroundColor: 0x40 }),
        'invalid-nes-color',
      );
      expect(facts).toEqual([
        expect.objectContaining({
          isUniversalBackground: true,
          colorValue: 0x40,
        }),
      ]);
    });
  });

  describe('inconsistent-universal-color', () => {
    it('accepts four consistent background subpalettes', () => {
      const facts = factsOfKind(
        baseOptions({
          palettes: ['a', 'b', 'c', 'd'].map((id) =>
            palette(`pal_bg_${id}`, 'background'),
          ),
        }),
        'inconsistent-universal-color',
      );
      expect(facts).toHaveLength(0);
    });

    it('reports every divergent background subpalette without mutating it', () => {
      const palettes = [
        palette('pal_bg_a', 'background'),
        palette('pal_bg_b', 'background', [0x00, 1, 2, 3]),
        palette('pal_bg_c', 'background', [0x01, 4, 5, 6]),
        palette('pal_bg_d', 'background'),
      ];
      const before = JSON.stringify(palettes);
      const facts = factsOfKind(
        baseOptions({ palettes }),
        'inconsistent-universal-color',
      );

      expect(facts).toHaveLength(2);
      expect(facts.map((fact) => fact.paletteId)).toEqual([
        'pal_bg_b',
        'pal_bg_c',
      ]);
      expect(JSON.stringify(palettes)).toBe(before);
    });

    it('does not apply the background rule to sprite-only or inactive shared palettes', () => {
      const facts = factsOfKind(
        baseOptions({
          palettes: [
            palette('pal_sprite', 'sprite', [0x00, 1, 2, 3]),
            palette('pal_shared', 'shared', [0x01, 4, 5, 6]),
          ],
          activeBackgroundSlots: [null, null, null, null],
          activeSpriteSlots: ['pal_sprite', 'pal_shared', null, null],
        }),
        'inconsistent-universal-color',
      );
      expect(facts).toHaveLength(0);
    });

    it('applies the rule to shared palettes assigned to the background bank', () => {
      const facts = factsOfKind(
        baseOptions({
          palettes: [palette('pal_shared', 'shared', [0x00, 1, 2, 3])],
          activeBackgroundSlots: ['pal_shared', null, null, null],
          activeSpriteSlots: [null, null, null, null],
        }),
        'inconsistent-universal-color',
      );
      expect(facts).toHaveLength(1);
    });
  });

  it('returns deterministic, stable and structurally deduplicated facts', () => {
    const options = baseOptions({
      activeBackgroundSlots: ['pal_missing', 'pal_missing', null, null],
      animations: [
        { id: 'anim_z', name: 'Z', paletteId: 'pal_e' },
        { id: 'anim_a', name: 'A', paletteId: 'pal_missing' },
        { id: 'anim_a', name: 'A', paletteId: 'pal_missing' },
      ],
    });
    const first = analyzeProjectPaletteDiagnostics(options);
    const second = analyzeProjectPaletteDiagnostics(options);

    expect(second).toEqual(first);
    expect(new Set(first.map((fact) => fact.id)).size).toBe(first.length);
    expect(first.map((fact) => fact.id)).toEqual([
      'dangling:anim:anim_a:pal_missing',
      'dangling:slot:bg:0:pal_missing',
      'dangling:slot:bg:1:pal_missing',
      'unassigned:anim:anim_z:pal_e',
    ]);
  });
});
