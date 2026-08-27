/**
 * Domain model and pure primitives for NES Palette Library, Dual Hardware Banks,
 * Universal Background Color mirroring ($3F00), and asset usage tracking.
 * Part of Milestone 9: Palette Manager (Issue #122).
 *
 * Invariant: Logical != Physical.
 * PaletteDefinitions are authored resources in the project library with stable IDs,
 * while ActivePaletteSlots are physical PPU subpalette slots ($3F00..$3F0F for Background,
 * $3F10..$3F1F for Sprites).
 */

import type { NesPalette, NesPaletteSet } from './nes-palette';
import {
  assertNesColorCode,
  createDefaultNesPaletteSet,
  isValidNesColorCode,
  NES_COLORS_PER_PALETTE,
} from './nes-palette';

export { assertNesColorCode, isValidNesColorCode };

/**
 * Stable logical identifier for an authored palette in the project library.
 * Conceptually prefixed with 'pal_'.
 */
export type ProjectPaletteId = string;

/**
 * Classification of intended usage for UI filtering and authoring ergonomics.
 */
export type PaletteTarget = 'sprite' | 'background' | 'shared';

/**
 * Declarative definition of an authored palette in the project library.
 * Represents an authoring resource, not a physical PPU slot.
 */
export interface PaletteDefinition {
  readonly id: ProjectPaletteId;
  readonly name: string;
  /** 4 NES color codes ($00..$3F). In hardware, colors[0] is transparent in sprites or mirrors $3F00 in backgrounds. */
  readonly colors: NesPalette;
  /** Optional target classification for UI filtering. */
  readonly target?: PaletteTarget;
}

/**
 * Canonical 4-slot hardware assignment tuple for a single PPU palette bank.
 * Physical slots 0..3 correspond to:
 * - Background Bank: PPU $3F00..$3F0F
 * - Sprite Bank: PPU $3F10..$3F1F
 */
export type ActivePaletteSlots = readonly [
  ProjectPaletteId | null,
  ProjectPaletteId | null,
  ProjectPaletteId | null,
  ProjectPaletteId | null,
];

/**
 * Legacy alias for ActivePaletteSlots.
 */
export type ActiveSpritePaletteSlots = ActivePaletteSlots;

/**
 * Complete aggregated domain state for the dual-bank palette subsystem.
 */
export interface DualBankPaletteState {
  /** Universal background color code ($00..$3F) mapped to PPU $3F00. */
  readonly universalBackgroundColor: number;
  /** Complete library of palette definitions available in the project. */
  readonly palettes: readonly PaletteDefinition[];
  /** 4 active subpalette slots for Background rendering (PPU $3F00..$3F0F). */
  readonly activeBackgroundSlots: ActivePaletteSlots;
  /** 4 active subpalette slots for Sprite rendering (PPU $3F10..$3F1F). */
  readonly activeSpriteSlots: ActivePaletteSlots;
}

/**
 * Resolution result mapping a logical palette ID to a physical PPU slot index (0..3).
 */
export interface PaletteSlotResolution {
  readonly paletteId: ProjectPaletteId;
  readonly slotIndex: 0 | 1 | 2 | 3 | null;
  readonly isActive: boolean;
  readonly definition: PaletteDefinition | null;
}

export type SpritePaletteResolution = PaletteSlotResolution;
export type BackgroundPaletteResolution = PaletteSlotResolution;

/**
 * Scene-level palette requirement analysis against active slots.
 */
export interface ScenePaletteAnalysis {
  readonly distinctPaletteIds: readonly string[];
  readonly requiredCount: number;
  readonly activeCount: number;
  readonly unassignedPaletteIds: readonly string[];
  readonly slots: readonly (PaletteDefinition | null)[];
}

/**
 * Structured usage reference indicating where a palette is referenced across the project.
 */
export interface PaletteUsageReference {
  readonly type:
    'slot' | 'animation' | 'frame' | 'entity' | 'background' | 'scene';
  readonly name: string;
  readonly detail?: string;
}

/** Default universal background color code (NES $0F = Black). */
export const DEFAULT_UNIVERSAL_BACKGROUND_COLOR = 0x0f;

/** Default fallback 4-color subpalette when a slot is unassigned. */
export const DEFAULT_FALLBACK_SUBPALETTE: NesPalette = [0x0f, 0x00, 0x10, 0x30];

/**
 * Generates a stable unique ID for a palette definition.
 */
export function generatePaletteId(prefix = 'pal'): ProjectPaletteId {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  return `${prefix}_${timestamp}_${randomSuffix}`;
}

/**
 * Checks whether a value is a valid non-empty string palette ID.
 */
export function isProjectPaletteId(value: unknown): value is ProjectPaletteId {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Normalizes a candidate palette ID, generating a fallback if invalid or empty.
 */
export function normalizePaletteId(
  id: string | null | undefined,
  fallbackPrefix = 'pal',
): ProjectPaletteId {
  if (typeof id === 'string' && id.trim().length > 0) {
    return id.trim();
  }
  return generatePaletteId(fallbackPrefix);
}

/**
 * Creates an immutable PaletteDefinition with validated colors and defaults.
 */
export function createPaletteDefinition(options?: {
  id?: ProjectPaletteId;
  name?: string;
  colors?: NesPalette | readonly number[];
  target?: PaletteTarget;
}): PaletteDefinition {
  const id = normalizePaletteId(options?.id);
  const name = options?.name?.trim() ? options.name.trim() : 'New Palette';
  let colors: NesPalette;
  if (options?.colors?.length === 4) {
    for (const c of options.colors) {
      assertNesColorCode(c);
    }
    const [c0, c1, c2, c3] = options.colors;
    colors = [c0, c1, c2, c3];
  } else {
    colors = DEFAULT_FALLBACK_SUBPALETTE;
  }
  return {
    id,
    name,
    colors,
    ...(options?.target ? { target: options.target } : {}),
  };
}

/**
 * Creates 4 default palette definitions for a new or migrated project.
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

  return sourceSet.map((colors, index) => {
    for (const c of colors) {
      assertNesColorCode(c);
    }
    return {
      id: generatePaletteId(`pal_${String(index)}`),
      name: defaultNames[index] ?? `Palette ${String(index)}`,
      colors: [colors[0], colors[1], colors[2], colors[3]],
    };
  });
}

/**
 * Creates an empty 4-slot hardware assignment tuple.
 */
export function createEmptyActivePaletteSlots(): ActivePaletteSlots {
  return [null, null, null, null];
}

/**
 * Creates an active slots tuple initialized with the first 4 palette IDs in a library.
 */
export function createDefaultActivePaletteSlots(
  palettes?: readonly PaletteDefinition[],
): ActivePaletteSlots {
  return [
    palettes?.[0]?.id ?? null,
    palettes?.[1]?.id ?? null,
    palettes?.[2]?.id ?? null,
    palettes?.[3]?.id ?? null,
  ];
}

/**
 * Creates a default dual-bank palette state with independent Background and Sprite banks.
 */
export function createDefaultDualBankPaletteState(
  basePaletteSet?: NesPaletteSet,
  universalBackgroundColor: number = DEFAULT_UNIVERSAL_BACKGROUND_COLOR,
): DualBankPaletteState {
  assertNesColorCode(universalBackgroundColor);
  const baseSet = basePaletteSet ?? createDefaultNesPaletteSet();

  const bgPalettes: PaletteDefinition[] = [0, 1, 2, 3].map((i) => {
    const basePalette = baseSet[i] ?? DEFAULT_FALLBACK_SUBPALETTE;
    return {
      id: generatePaletteId(`pal_bg${String(i)}`),
      name: `Background Palette ${String(i)}`,
      colors: [
        universalBackgroundColor,
        basePalette[1],
        basePalette[2],
        basePalette[3],
      ],
      target: 'background',
    };
  });

  const spPalettes: PaletteDefinition[] = [0, 1, 2, 3].map((i) => {
    const basePalette = baseSet[i] ?? DEFAULT_FALLBACK_SUBPALETTE;
    return {
      id: generatePaletteId(`pal_sp${String(i)}`),
      name: `Sprite Palette ${String(i)}`,
      colors: [
        universalBackgroundColor,
        basePalette[1],
        basePalette[2],
        basePalette[3],
      ],
      target: 'sprite',
    };
  });

  const [bg0, bg1, bg2, bg3] = bgPalettes;
  const [sp0, sp1, sp2, sp3] = spPalettes;

  return {
    universalBackgroundColor,
    palettes: [...bgPalettes, ...spPalettes],
    activeBackgroundSlots: [
      bg0?.id ?? null,
      bg1?.id ?? null,
      bg2?.id ?? null,
      bg3?.id ?? null,
    ],
    activeSpriteSlots: [
      sp0?.id ?? null,
      sp1?.id ?? null,
      sp2?.id ?? null,
      sp3?.id ?? null,
    ],
  };
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
 * Finds the physical hardware slot index (0..3) where a palette ID is allocated.
 * Returns the first matching slot index, or null if unassigned/not found.
 */
export function findPaletteSlotIndex(
  paletteId: string | undefined | null,
  activeSlots: readonly (string | null)[] | undefined | null,
): 0 | 1 | 2 | 3 | null {
  if (!paletteId || !activeSlots) return null;
  const idx = activeSlots.indexOf(paletteId);
  return idx >= 0 && idx < 4 ? (idx as 0 | 1 | 2 | 3) : null;
}

/**
 * Resolves a palette ID against the 4 active sprite palette slots.
 */
export function resolveSpritePaletteSlot(
  paletteId: string | null | undefined,
  activeSlots?: readonly (string | null)[] | null,
  palettes?: readonly PaletteDefinition[] | null,
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
  const slotIndex = findPaletteSlotIndex(paletteId, activeSlots);

  return {
    paletteId,
    slotIndex,
    isActive: slotIndex !== null,
    definition,
  };
}

/**
 * Resolves a palette ID against the 4 active background palette slots.
 */
export function resolveBackgroundPaletteSlot(
  paletteId: string | null | undefined,
  activeSlots?: readonly (string | null)[] | null,
  palettes?: readonly PaletteDefinition[] | null,
): BackgroundPaletteResolution {
  return resolveSpritePaletteSlot(paletteId, activeSlots, palettes);
}

/**
 * Resolves the 4-palette NesPaletteSet corresponding to the 4 active slots.
 * Falls back to fallbackSet or default NES palette colors for empty or invalid slots.
 */
export function resolveActivePaletteSetBySlots(
  palettes?: readonly PaletteDefinition[] | null,
  activeSlots?: ActivePaletteSlots | readonly (string | null)[] | null,
  fallbackSet?: NesPaletteSet,
): NesPaletteSet {
  const fallback = fallbackSet ?? createDefaultNesPaletteSet();
  const result: NesPalette[] = [];

  for (let slot = 0; slot < 4; slot += 1) {
    const palId = activeSlots?.[slot];
    const def = findPaletteDefinition(palettes, palId);
    if (def) {
      result.push(def.colors);
    } else {
      const fallbackPal = fallback[slot] ?? DEFAULT_FALLBACK_SUBPALETTE;
      result.push(fallbackPal);
    }
  }

  const [p0, p1, p2, p3] = result;
  return [
    p0 ?? DEFAULT_FALLBACK_SUBPALETTE,
    p1 ?? DEFAULT_FALLBACK_SUBPALETTE,
    p2 ?? DEFAULT_FALLBACK_SUBPALETTE,
    p3 ?? DEFAULT_FALLBACK_SUBPALETTE,
  ];
}

/**
 * Resolves the 4-palette NesPaletteSet corresponding to the 4 active sprite palette slots.
 * Legacy alias for resolveActivePaletteSetBySlots.
 */
export function resolveActivePaletteSet(
  palettes: readonly PaletteDefinition[],
  activeSlots: readonly (string | null)[],
  fallbackSet?: NesPaletteSet,
): NesPaletteSet {
  return resolveActivePaletteSetBySlots(palettes, activeSlots, fallbackSet);
}

/**
 * Applies NES hardware universal background color mirroring to a 4-subpalette set.
 * In NES PPU RAM:
 * - $3F00 is the universal background color.
 * - $3F04, $3F08, $3F0C mirror $3F00.
 * Entry 0 of all 4 subpalettes is updated to universalBackgroundColor, while colors 1..3 are preserved.
 */
export function resolveUniversalBackgroundMirroring(
  paletteSet: NesPaletteSet,
  universalBackgroundColor: number,
): NesPaletteSet {
  assertNesColorCode(universalBackgroundColor);
  return [
    [
      universalBackgroundColor,
      paletteSet[0][1],
      paletteSet[0][2],
      paletteSet[0][3],
    ],
    [
      universalBackgroundColor,
      paletteSet[1][1],
      paletteSet[1][2],
      paletteSet[1][3],
    ],
    [
      universalBackgroundColor,
      paletteSet[2][1],
      paletteSet[2][2],
      paletteSet[2][3],
    ],
    [
      universalBackgroundColor,
      paletteSet[3][1],
      paletteSet[3][2],
      paletteSet[3][3],
    ],
  ];
}

/**
 * Resolves the 4 active Background subpalettes with PPU $3F00 universal color mirroring applied.
 */
export function resolveActiveBackgroundPaletteSet(
  palettes: readonly PaletteDefinition[] | null | undefined,
  activeBackgroundSlots:
    ActivePaletteSlots | readonly (string | null)[] | null | undefined,
  universalBackgroundColor: number,
  fallbackSet?: NesPaletteSet,
): NesPaletteSet {
  const rawSet = resolveActivePaletteSetBySlots(
    palettes,
    activeBackgroundSlots,
    fallbackSet,
  );
  return resolveUniversalBackgroundMirroring(rawSet, universalBackgroundColor);
}

/**
 * Resolves the 4 active Sprite subpalettes (PPU $3F10..$3F1F).
 * Note: Entry 0 in sprite subpalettes is transparent for sprite rendering on the NES.
 * If universalBackgroundColor is specified, entry 0 mirrors $3F00.
 */
export function resolveActiveSpritePaletteSet(
  palettes: readonly PaletteDefinition[] | undefined | null,
  activeSpriteSlots:
    ActivePaletteSlots | readonly (string | null)[] | undefined | null,
  fallbackSet?: NesPaletteSet,
  universalBackgroundColor?: number,
): NesPaletteSet {
  const rawSet = resolveActivePaletteSetBySlots(
    palettes,
    activeSpriteSlots,
    fallbackSet,
  );
  if (universalBackgroundColor !== undefined) {
    return resolveUniversalBackgroundMirroring(
      rawSet,
      universalBackgroundColor,
    );
  }
  return rawSet;
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
  return set[safeIndex] ?? DEFAULT_FALLBACK_SUBPALETTE;
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
 * Duplicates a palette definition with a new unique ID and preserved colors.
 */
export function duplicatePaletteDefinition(
  palette: PaletteDefinition,
  customName?: string,
  customId?: ProjectPaletteId,
): PaletteDefinition {
  return {
    id: normalizePaletteId(customId),
    name: customName ?? `${palette.name} (Copy)`,
    colors: [
      palette.colors[0],
      palette.colors[1],
      palette.colors[2],
      palette.colors[3],
    ],
    ...(palette.target ? { target: palette.target } : {}),
  };
}

/**
 * Renames a palette definition immutably.
 */
export function updatePaletteName(
  palette: PaletteDefinition,
  name: string,
): PaletteDefinition {
  const trimmed = name.trim();
  return {
    ...palette,
    name: trimmed.length > 0 ? trimmed : palette.name,
  };
}

/**
 * Updates a single color in a palette definition immutably.
 * Validates that colorIndex is 0..3 and colorCode is $00..$3F.
 */
export function updatePaletteColor(
  palette: PaletteDefinition,
  colorIndex: number,
  colorCode: number,
): PaletteDefinition {
  if (
    !Number.isInteger(colorIndex) ||
    colorIndex < 0 ||
    colorIndex >= NES_COLORS_PER_PALETTE
  ) {
    throw new RangeError('NES palette color indices must be between 0 and 3.');
  }
  assertNesColorCode(colorCode);

  const nextColors: [number, number, number, number] = [
    palette.colors[0],
    palette.colors[1],
    palette.colors[2],
    palette.colors[3],
  ];
  nextColors[colorIndex] = colorCode;

  return {
    ...palette,
    colors: nextColors,
  };
}

/**
 * Updates the target classification of a palette definition immutably.
 */
export function updatePaletteTarget(
  palette: PaletteDefinition,
  target?: PaletteTarget,
): PaletteDefinition {
  const result: {
    id: ProjectPaletteId;
    name: string;
    colors: NesPalette;
    target?: PaletteTarget;
  } = {
    id: palette.id,
    name: palette.name,
    colors: palette.colors,
  };
  if (target) {
    result.target = target;
  }
  return result;
}

/**
 * Assigns a palette ID to a hardware slot (0..3) immutably.
 */
export function assignPaletteToSlot(
  slots: ActivePaletteSlots,
  slotIndex: number,
  paletteId: ProjectPaletteId | null,
): ActivePaletteSlots {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 4) {
    throw new RangeError('Palette slot indices must be between 0 and 3.');
  }
  const next: [
    ProjectPaletteId | null,
    ProjectPaletteId | null,
    ProjectPaletteId | null,
    ProjectPaletteId | null,
  ] = [slots[0], slots[1], slots[2], slots[3]];
  next[slotIndex] = paletteId;
  return next;
}

export interface AnimationPaletteUsageTarget {
  readonly id: string;
  readonly name: string;
  readonly entity?: string;
  readonly paletteId?: string | null;
  readonly framePaletteIds?: readonly (string | null)[];
}

export interface BackgroundMapPaletteUsageTarget {
  readonly id: string;
  readonly name: string;
  readonly paletteId?: string | null;
  readonly paletteAssignments?: readonly number[];
}

export interface SceneInstancePaletteUsageTarget {
  readonly id: string;
  readonly name?: string;
  readonly entityId?: string;
  readonly animationName?: string;
  readonly paletteId?: string | null;
}

/**
 * Context options for rich palette usage tracking across multiple subsystem domains.
 */
export interface PaletteUsageSearchContext {
  readonly animations?: readonly AnimationPaletteUsageTarget[];
  readonly activeSpriteSlots?: readonly (string | null)[];
  readonly activeBackgroundSlots?: readonly (string | null)[];
  readonly backgroundMaps?: readonly BackgroundMapPaletteUsageTarget[];
  readonly sceneInstances?: readonly SceneInstancePaletteUsageTarget[];
}

export function isPaletteUsageSearchContext(
  value: unknown,
): value is PaletteUsageSearchContext {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Finds all usage references for a given palette ID across animations, active slots,
 * background maps, and scene instances.
 *
 * Supports both legacy positional argument calls and rich context object calls.
 */
export function findPaletteUsageReferences(
  paletteId: string,
  contextOrAnimations?:
    PaletteUsageSearchContext | readonly AnimationPaletteUsageTarget[],
  activeSpriteSlotsOrLegacySlots?: readonly (string | null)[],
  activeBackgroundSlots?: readonly (string | null)[],
): readonly PaletteUsageReference[] {
  if (!paletteId) return [];

  const references: PaletteUsageReference[] = [];

  let animations: readonly AnimationPaletteUsageTarget[] | undefined;
  let spSlots: readonly (string | null)[] | undefined;
  let bgSlots: readonly (string | null)[] | undefined;
  let bgMaps: readonly BackgroundMapPaletteUsageTarget[] | undefined;
  let scenes: readonly SceneInstancePaletteUsageTarget[] | undefined;

  if (Array.isArray(contextOrAnimations)) {
    animations = contextOrAnimations;
    spSlots = activeSpriteSlotsOrLegacySlots;
    bgSlots = activeBackgroundSlots;
  } else if (isPaletteUsageSearchContext(contextOrAnimations)) {
    animations = contextOrAnimations.animations;
    spSlots = contextOrAnimations.activeSpriteSlots;
    bgSlots = contextOrAnimations.activeBackgroundSlots;
    bgMaps = contextOrAnimations.backgroundMaps;
    scenes = contextOrAnimations.sceneInstances;
  }

  // Check active sprite slots
  if (spSlots) {
    spSlots.forEach((slotPalId, slotIndex) => {
      if (slotPalId === paletteId) {
        references.push({
          type: 'slot',
          name: `Sprite Palette Slot ${String(slotIndex)}`,
        });
      }
    });
  }

  // Check active background slots
  if (bgSlots) {
    bgSlots.forEach((slotPalId, slotIndex) => {
      if (slotPalId === paletteId) {
        references.push({
          type: 'slot',
          name: `Background Palette Slot ${String(slotIndex)}`,
        });
      }
    });
  }

  // Check animations / entities
  if (animations) {
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
  }

  // Check background maps
  if (bgMaps) {
    bgMaps.forEach((map) => {
      if (map.paletteId === paletteId) {
        references.push({
          type: 'background',
          name: map.name !== '' ? map.name : map.id,
          detail: 'Background map palette',
        });
      }
    });
  }

  // Check scene preview instances
  if (scenes) {
    scenes.forEach((inst) => {
      if (inst.paletteId === paletteId) {
        references.push({
          type: 'scene',
          name:
            inst.name !== undefined && inst.name !== '' ? inst.name : inst.id,
          detail: `Scene instance (${inst.entityId ?? 'entity'})`,
        });
      }
    });
  }

  return references;
}
