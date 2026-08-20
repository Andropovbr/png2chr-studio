import type { NesPalette, NesPaletteSet } from './nes-palette';
import { createDefaultNesPaletteSet } from './nes-palette';

export interface PaletteDefinition {
  readonly id: string;
  readonly name: string;
  readonly colors: NesPalette;
}

export type ActiveSpritePaletteSlots = readonly [
  string | null,
  string | null,
  string | null,
  string | null,
];

export interface SpritePaletteResolution {
  readonly paletteId: string;
  readonly slotIndex: 0 | 1 | 2 | 3 | null;
  readonly isActive: boolean;
  readonly definition: PaletteDefinition | null;
}

export interface ScenePaletteAnalysis {
  readonly distinctPaletteIds: readonly string[];
  readonly requiredCount: number;
  readonly activeCount: number;
  readonly unassignedPaletteIds: readonly string[];
  readonly slots: readonly (PaletteDefinition | null)[];
}

export interface PaletteUsageReference {
  readonly type: 'entity' | 'animation' | 'slot';
  readonly name: string;
  readonly detail?: string;
}

/**
 * Generates a stable unique ID for a palette definition.
 */
export function generatePaletteId(prefix = 'pal'): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  return `${prefix}_${timestamp}_${randomSuffix}`;
}

/**
 * Creates default palette definitions for a new or migrated project.
 */
export function createDefaultPaletteDefinitions(
  basePaletteSet?: NesPaletteSet,
): readonly PaletteDefinition[] {
  const sourceSet = basePaletteSet ?? createDefaultNesPaletteSet();
  const defaultNames = [
    'Sprite Palette 0',
    'Sprite Palette 1',
    'Sprite Palette 2',
    'Sprite Palette 3',
  ];

  return sourceSet.map((colors, index) => ({
    id: generatePaletteId(`pal_${String(index)}`),
    name: defaultNames[index] ?? `Palette ${String(index)}`,
    colors: [...colors] as unknown as NesPalette,
  }));
}

/**
 * Finds a palette definition by its ID in a list of definitions.
 */
export function findPaletteDefinition(
  palettes: readonly PaletteDefinition[] | undefined | null,
  paletteId: string | undefined | null,
): PaletteDefinition | null {
  if (!palettes || !paletteId) return null;
  return palettes.find((p) => p.id === paletteId) ?? null;
}

/**
 * Resolves a palette ID against the 4 active sprite palette slots.
 */
export function resolveSpritePaletteSlot(
  paletteId: string | undefined | null,
  activeSlots: readonly (string | null)[] | undefined | null,
  palettes: readonly PaletteDefinition[] | undefined | null,
): SpritePaletteResolution {
  if (!paletteId) {
    return {
      paletteId: '',
      slotIndex: null,
      isActive: false,
      definition: null,
    };
  }

  const definition = findPaletteDefinition(palettes, paletteId);
  const slotIdx = activeSlots ? activeSlots.indexOf(paletteId) : -1;
  const isSlotValid = slotIdx >= 0 && slotIdx < 4;

  return {
    paletteId,
    slotIndex: isSlotValid ? (slotIdx as 0 | 1 | 2 | 3) : null,
    isActive: isSlotValid,
    definition,
  };
}

/**
 * Resolves the 4-palette NesPaletteSet corresponding to the 4 active sprite palette slots.
 * Falls back to default NES palette colors for empty or invalid slots.
 */
export function resolveActivePaletteSet(
  palettes: readonly PaletteDefinition[],
  activeSlots: readonly (string | null)[],
  fallbackSet?: NesPaletteSet,
): NesPaletteSet {
  const fallback = fallbackSet ?? createDefaultNesPaletteSet();
  const result: NesPalette[] = [];

  for (let slot = 0; slot < 4; slot += 1) {
    const palId = activeSlots[slot];
    const def = findPaletteDefinition(palettes, palId);
    if (def) {
      result.push(def.colors);
    } else {
      result.push(fallback[slot] ?? [0x0f, 0x00, 0x10, 0x30]);
    }
  }

  return result as unknown as NesPaletteSet;
}

/**
 * Resolves the effective 4-color NesPalette for a given animation/frame.
 */
export function resolveEffectivePaletteColors(
  paletteId: string | undefined | null,
  palettes: readonly PaletteDefinition[] | undefined | null,
  fallbackPaletteIndex = 0,
  paletteSet?: NesPaletteSet,
): NesPalette {
  const def = findPaletteDefinition(palettes, paletteId);
  if (def) {
    return def.colors;
  }
  const set = paletteSet ?? createDefaultNesPaletteSet();
  const safeIndex = Math.max(0, Math.min(3, fallbackPaletteIndex));
  return set[safeIndex] ?? [0x0f, 0x00, 0x10, 0x30];
}

/**
 * Analyzes the distinct palettes required by a scene and checks their slot availability.
 */
export function analyzeScenePalettes(
  requiredPaletteIds: readonly string[],
  activeSlots: readonly (string | null)[],
  palettes: readonly PaletteDefinition[],
): ScenePaletteAnalysis {
  const distinctSet = new Set(
    requiredPaletteIds.filter(
      (id) => typeof id === 'string' && id.trim() !== '',
    ),
  );
  const distinctPaletteIds = Array.from(distinctSet);

  const activeSlotSet = new Set(
    activeSlots.filter(
      (id): id is string => typeof id === 'string' && id.trim() !== '',
    ),
  );

  const activeCount = distinctPaletteIds.filter((id) =>
    activeSlotSet.has(id),
  ).length;

  const unassignedPaletteIds = distinctPaletteIds.filter(
    (id) => !activeSlotSet.has(id),
  );

  const slots = [0, 1, 2, 3].map((slot) => {
    const palId = activeSlots[slot];
    return findPaletteDefinition(palettes, palId);
  });

  return {
    distinctPaletteIds,
    requiredCount: distinctPaletteIds.length,
    activeCount,
    unassignedPaletteIds,
    slots,
  };
}

/**
 * Duplicates a palette definition with a new unique ID.
 */
export function duplicatePaletteDefinition(
  palette: PaletteDefinition,
  customName?: string,
): PaletteDefinition {
  return {
    id: generatePaletteId(),
    name: customName ?? `${palette.name} (Copy)`,
    colors: [...palette.colors] as unknown as NesPalette,
  };
}

/**
 * Finds all usage references for a given palette ID across animations and active slots.
 */
export function findPaletteUsageReferences(
  paletteId: string,
  animations: readonly {
    readonly id: string;
    readonly name: string;
    readonly entity?: string;
    readonly paletteId?: string | null;
    readonly framePaletteIds?: readonly (string | null)[];
  }[],
  activeSlots: readonly (string | null)[],
): readonly PaletteUsageReference[] {
  const references: PaletteUsageReference[] = [];

  // Check active slots
  activeSlots.forEach((slotPalId, slotIndex) => {
    if (slotPalId === paletteId) {
      references.push({
        type: 'slot',
        name: `Sprite Palette Slot ${String(slotIndex)}`,
      });
    }
  });

  // Check animations / entities
  const checkedEntities = new Set<string>();
  animations.forEach((anim) => {
    if (anim.paletteId === paletteId) {
      const entityName = anim.entity?.trim() ? anim.entity.trim() : 'entity';
      if (!checkedEntities.has(entityName)) {
        checkedEntities.add(entityName);
        references.push({
          type: 'entity',
          name: entityName,
          detail: `Animation: ${anim.name}`,
        });
      }
    }

    if (anim.framePaletteIds?.includes(paletteId)) {
      references.push({
        type: 'animation',
        name: `${anim.entity ?? 'entity'}_${anim.name}`,
        detail: 'Frame palette override',
      });
    }
  });

  return references;
}
