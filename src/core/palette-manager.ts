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
  NES_BACKGROUND_PALETTE_COUNT,
  NES_COLORS_PER_PALETTE,
} from './nes-palette';
import { t } from '../i18n';

export { assertNesColorCode, isValidNesColorCode };

/** Both NES palette banks expose four physical subpalette slots. */
const NES_PALETTE_BANK_SLOT_COUNT = NES_BACKGROUND_PALETTE_COUNT;

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
      id: `pal_${String(index)}`,
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
      id: `pal_bg_${String(i)}`,
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
      id: `pal_sp_${String(i)}`,
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
 * Projects a logical sprite palette ID to the 2-bit physical OAM palette
 * index. The numeric fallback is used only by compatibility adapters when the
 * logical palette is absent or not assigned to an active SPR slot.
 */
export function resolveEffectiveSpritePaletteIndex(
  paletteId: string | null | undefined,
  activeSlots: readonly (string | null)[] | undefined | null,
  palettes: readonly PaletteDefinition[] | undefined | null,
  legacyFallbackIndex = 0,
): 0 | 1 | 2 | 3 {
  const resolvedSlot = resolveSpritePaletteSlot(
    paletteId,
    activeSlots,
    palettes,
  ).slotIndex;
  if (resolvedSlot !== null) return resolvedSlot;

  const clampedFallback = Math.max(0, Math.min(3, legacyFallbackIndex));
  return ([0, 1, 2, 3] as const)[clampedFallback] ?? 0;
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
 * Resolves the 4 active Background subpalettes for a StudioProject-like object.
 */
export function resolveProjectBackgroundPaletteSet(
  projectOrPalette: {
    readonly palette?: {
      readonly universalBackgroundColor?: number;
      readonly palettes?: readonly PaletteDefinition[];
      readonly activeBackgroundSlots?: ActivePaletteSlots;
      readonly paletteSet?: NesPaletteSet;
    };
    readonly universalBackgroundColor?: number;
    readonly palettes?: readonly PaletteDefinition[];
    readonly activeBackgroundSlots?: ActivePaletteSlots;
    readonly paletteSet?: NesPaletteSet;
  },
  fallbackSet?: NesPaletteSet,
): NesPaletteSet {
  const palConfig =
    'palette' in projectOrPalette && projectOrPalette.palette
      ? projectOrPalette.palette
      : projectOrPalette;
  const palettes = palConfig.palettes;
  const bgSlots = palConfig.activeBackgroundSlots;
  const univColor =
    palConfig.universalBackgroundColor ?? DEFAULT_UNIVERSAL_BACKGROUND_COLOR;
  return resolveActiveBackgroundPaletteSet(
    palettes,
    bgSlots,
    univColor,
    fallbackSet ?? palConfig.paletteSet,
  );
}

/**
 * Resolves the 4 active Sprite subpalettes for a StudioProject-like object.
 */
export function resolveProjectSpritePaletteSet(
  projectOrPalette: {
    readonly palette?: {
      readonly universalBackgroundColor?: number;
      readonly palettes?: readonly PaletteDefinition[];
      readonly activeSpriteSlots?: ActivePaletteSlots;
      readonly activeSpritePaletteSlots?: readonly (string | null)[];
      readonly paletteSet?: NesPaletteSet;
    };
    readonly universalBackgroundColor?: number;
    readonly palettes?: readonly PaletteDefinition[];
    readonly activeSpriteSlots?: ActivePaletteSlots;
    readonly activeSpritePaletteSlots?: readonly (string | null)[];
    readonly paletteSet?: NesPaletteSet;
  },
  fallbackSet?: NesPaletteSet,
): NesPaletteSet {
  const palConfig =
    'palette' in projectOrPalette && projectOrPalette.palette
      ? projectOrPalette.palette
      : projectOrPalette;
  const palettes = palConfig.palettes;
  const spSlots =
    palConfig.activeSpriteSlots ??
    ('activeSpritePaletteSlots' in palConfig
      ? palConfig.activeSpritePaletteSlots
      : undefined);
  const univColor =
    palConfig.universalBackgroundColor ?? DEFAULT_UNIVERSAL_BACKGROUND_COLOR;
  return resolveActiveSpritePaletteSet(
    palettes,
    spSlots,
    fallbackSet ?? palConfig.paletteSet,
    univColor,
  );
}

/**
 * Extracts the canonical DualBankPaletteState from a StudioProject-like object.
 */
export function resolveProjectPaletteState(projectOrPalette: {
  readonly palette?: {
    readonly universalBackgroundColor?: number;
    readonly palettes?: readonly PaletteDefinition[];
    readonly activeBackgroundSlots?: ActivePaletteSlots;
    readonly activeSpriteSlots?: ActivePaletteSlots;
    readonly activeSpritePaletteSlots?: readonly (string | null)[];
    readonly paletteSet?: NesPaletteSet;
  };
  readonly universalBackgroundColor?: number;
  readonly palettes?: readonly PaletteDefinition[];
  readonly activeBackgroundSlots?: ActivePaletteSlots;
  readonly activeSpriteSlots?: ActivePaletteSlots;
  readonly activeSpritePaletteSlots?: readonly (string | null)[];
  readonly paletteSet?: NesPaletteSet;
}): DualBankPaletteState {
  const palConfig =
    'palette' in projectOrPalette && projectOrPalette.palette
      ? projectOrPalette.palette
      : projectOrPalette;
  const fallbackSet = palConfig.paletteSet;
  const palettes =
    palConfig.palettes ?? createDefaultPaletteDefinitions(fallbackSet);
  const univColor =
    palConfig.universalBackgroundColor ??
    fallbackSet?.[0]?.[0] ??
    DEFAULT_UNIVERSAL_BACKGROUND_COLOR;
  const activeBg =
    palConfig.activeBackgroundSlots ??
    createDefaultActivePaletteSlots(palettes);
  const spSource =
    palConfig.activeSpriteSlots ??
    ('activeSpritePaletteSlots' in palConfig
      ? palConfig.activeSpritePaletteSlots
      : undefined);
  const activeSp: ActivePaletteSlots =
    spSource?.length === 4
      ? [
          spSource[0] ?? null,
          spSource[1] ?? null,
          spSource[2] ?? null,
          spSource[3] ?? null,
        ]
      : createDefaultActivePaletteSlots(palettes);

  return {
    universalBackgroundColor: univColor,
    palettes,
    activeBackgroundSlots: activeBg,
    activeSpriteSlots: activeSp,
  };
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
  readonly animationId?: string;
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
        references.push({
          type: 'animation',
          name: `${entityName}_${anim.name}`,
          detail: 'Default animation palette',
        });
      }

      anim.framePaletteIds?.forEach((framePaletteId, frameIndex) => {
        if (framePaletteId === paletteId) {
          references.push({
            type: 'frame',
            name: `${anim.entity ?? 'entity'}_${anim.name}`,
            detail: `Frame ${String(frameIndex + 1)} palette override`,
          });
        }
      });
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

/**
 * Palette diagnostic kind identifiers (Milestone 9 - Issue #124).
 */
export type PaletteDiagnosticKind =
  | 'dangling-palette-reference'
  | 'unassigned-active-slot'
  | 'slot-capacity-exceeded'
  | 'invalid-nes-color'
  | 'inconsistent-universal-color';

/**
 * Consumer categories that reference palettes across project assets.
 */
export type PaletteConsumerType =
  'animation' | 'frame' | 'scene' | 'slot' | 'background';

export interface BasePaletteDiagnosticFact {
  readonly id: string;
  readonly code: PaletteDiagnosticKind;
  readonly kind: PaletteDiagnosticKind;
  readonly severity: 'error' | 'warning';
}

export interface DanglingPaletteReferenceDiagnosticFact extends BasePaletteDiagnosticFact {
  readonly code: 'dangling-palette-reference';
  readonly kind: 'dangling-palette-reference';
  readonly severity: 'error';
  readonly paletteId: string;
  readonly consumerType: PaletteConsumerType;
  readonly consumerId?: string;
  readonly consumerName: string;
  readonly bank?: 'sprite' | 'background';
  readonly slotIndex?: number;
  readonly frameIndex?: number;
  readonly contextId?: string;
}

export interface UnassignedActiveSlotDiagnosticFact extends BasePaletteDiagnosticFact {
  readonly code: 'unassigned-active-slot';
  readonly kind: 'unassigned-active-slot';
  readonly severity: 'warning';
  readonly paletteId: string;
  readonly paletteName: string;
  readonly bank: 'sprite' | 'background';
  readonly consumerType: 'animation' | 'frame' | 'scene' | 'background';
  readonly consumerId?: string;
  readonly consumerName: string;
  readonly frameIndex?: number;
  readonly contextId?: string;
}

export interface SlotCapacityExceededDiagnosticFact extends BasePaletteDiagnosticFact {
  readonly code: 'slot-capacity-exceeded';
  readonly kind: 'slot-capacity-exceeded';
  readonly severity: 'error';
  readonly bank: 'sprite' | 'background';
  readonly contextType: 'scene' | 'animation' | 'frame';
  readonly contextId?: string;
  readonly contextName: string;
  readonly requiredCount: number;
  readonly maxCapacity: number;
  readonly distinctPaletteIds: readonly string[];
}

export interface InvalidNesColorDiagnosticFact extends BasePaletteDiagnosticFact {
  readonly code: 'invalid-nes-color';
  readonly kind: 'invalid-nes-color';
  readonly severity: 'error';
  readonly paletteId?: string;
  readonly paletteName?: string;
  readonly colorIndex?: number;
  readonly colorValue: number;
  readonly isUniversalBackground: boolean;
}

export interface InconsistentUniversalColorDiagnosticFact extends BasePaletteDiagnosticFact {
  readonly code: 'inconsistent-universal-color';
  readonly kind: 'inconsistent-universal-color';
  readonly severity: 'warning';
  readonly paletteId: string;
  readonly paletteName: string;
  readonly actualColor: number;
  readonly expectedColor: number;
}

export type PaletteDiagnosticFact =
  | DanglingPaletteReferenceDiagnosticFact
  | UnassignedActiveSlotDiagnosticFact
  | SlotCapacityExceededDiagnosticFact
  | InvalidNesColorDiagnosticFact
  | InconsistentUniversalColorDiagnosticFact;

export interface AnalyzePaletteDiagnosticsOptions {
  readonly universalBackgroundColor?: number;
  readonly palettes?: readonly PaletteDefinition[];
  readonly activeBackgroundSlots?:
    ActivePaletteSlots | readonly (string | null)[];
  readonly activeSpriteSlots?: ActivePaletteSlots | readonly (string | null)[];
  readonly activeSpritePaletteSlots?: readonly (string | null)[];
  readonly paletteSet?: NesPaletteSet;
  readonly animations?: readonly {
    readonly id: string;
    readonly name: string;
    readonly entity?: string;
    readonly paletteId?: string | null;
    readonly framePaletteIds?: readonly (string | null)[];
  }[];
  readonly animation?: {
    readonly animations?: readonly {
      readonly id: string;
      readonly name: string;
      readonly entity?: string;
      readonly paletteId?: string | null;
      readonly framePaletteIds?: readonly (string | null)[];
    }[];
  };
  readonly backgrounds?:
    | readonly {
        readonly id: string;
        readonly name: string;
        readonly paletteId?: string | null;
      }[]
    | {
        readonly maps?: readonly {
          readonly id: string;
          readonly name: string;
          readonly paletteId?: string | null;
        }[];
      };
  readonly scenePreview?: {
    readonly instances?: readonly {
      readonly id: string;
      readonly name?: string;
      readonly animationId?: string;
      readonly entityId?: string;
      readonly animationName?: string;
      readonly paletteId?: string | null;
      readonly visible?: boolean;
    }[];
  };
  readonly sceneInstances?: readonly {
    readonly id: string;
    readonly name?: string;
    readonly animationId?: string;
    readonly entityId?: string;
    readonly animationName?: string;
    readonly paletteId?: string | null;
    readonly visible?: boolean;
    readonly frameIndex?: number;
  }[];
  readonly sceneContexts?: readonly {
    readonly id: string;
    readonly name?: string;
    readonly instances: readonly {
      readonly id: string;
      readonly name?: string;
      readonly animationId?: string;
      readonly entityId?: string;
      readonly animationName?: string;
      readonly paletteId?: string | null;
      readonly visible?: boolean;
      readonly frameIndex?: number;
    }[];
  }[];
  readonly palette?: {
    readonly universalBackgroundColor?: number;
    readonly palettes?: readonly PaletteDefinition[];
    readonly activeBackgroundSlots?:
      ActivePaletteSlots | readonly (string | null)[];
    readonly activeSpriteSlots?:
      ActivePaletteSlots | readonly (string | null)[];
    readonly activeSpritePaletteSlots?: readonly (string | null)[];
    readonly paletteSet?: NesPaletteSet;
  };
}

interface PaletteDiagnosticSceneInstance {
  readonly id: string;
  readonly name?: string;
  readonly animationId?: string;
  readonly entityId?: string;
  readonly animationName?: string;
  readonly paletteId?: string | null;
  readonly visible?: boolean;
  readonly frameIndex?: number;
}

interface PaletteDiagnosticSceneContext {
  readonly id: string;
  readonly name?: string;
  readonly instances: readonly PaletteDiagnosticSceneInstance[];
}

function isPaletteDiagnosticSceneContextArray(
  value: unknown,
): value is readonly PaletteDiagnosticSceneContext[] {
  return Array.isArray(value);
}

function diagnosticDisplayName(
  name: string | undefined,
  fallback: string,
): string {
  const trimmed = name?.trim();
  return trimmed === undefined || trimmed === '' ? fallback : trimmed;
}

function activePaletteIdSet(
  slots: readonly (string | null)[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const id of slots) {
    if (typeof id === 'string' && id.trim() !== '') {
      ids.add(id.trim());
    }
  }
  return ids;
}

function compareDiagnosticText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortPaletteDiagnosticFacts(
  facts: readonly PaletteDiagnosticFact[],
): readonly PaletteDiagnosticFact[] {
  return [...facts].sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'error' ? -1 : 1;
    }
    if (a.kind !== b.kind) {
      return compareDiagnosticText(a.kind, b.kind);
    }
    return compareDiagnosticText(a.id, b.id);
  });
}

/**
 * Pure domain analyzer for palette integrity, NES hardware constraints,
 * dangling references, slot allocations, capacity, and color consistency.
 */
export function analyzeProjectPaletteDiagnostics(
  projectOrOptions:
    | AnalyzePaletteDiagnosticsOptions
    | {
        readonly palette?: {
          readonly universalBackgroundColor?: number;
          readonly palettes?: readonly PaletteDefinition[];
          readonly activeBackgroundSlots?: ActivePaletteSlots;
          readonly activeSpriteSlots?: ActivePaletteSlots;
          readonly activeSpritePaletteSlots?: readonly (string | null)[];
          readonly paletteSet?: NesPaletteSet;
        };
        readonly universalBackgroundColor?: number;
        readonly palettes?: readonly PaletteDefinition[];
        readonly activeBackgroundSlots?: ActivePaletteSlots;
        readonly activeSpriteSlots?: ActivePaletteSlots;
        readonly activeSpritePaletteSlots?: readonly (string | null)[];
        readonly animation?: {
          readonly animations?: readonly {
            readonly id: string;
            readonly name: string;
            readonly entity?: string;
            readonly paletteId?: string | null;
            readonly framePaletteIds?: readonly (string | null)[];
          }[];
        };
        readonly backgrounds?: {
          readonly maps?: readonly {
            readonly id: string;
            readonly name: string;
            readonly paletteId?: string | null;
          }[];
        };
        readonly scenePreview?: {
          readonly instances?: readonly {
            readonly id: string;
            readonly name?: string;
            readonly entityId?: string;
            readonly animationName?: string;
            readonly paletteId?: string | null;
            readonly visible?: boolean;
            readonly frameIndex?: number;
          }[];
        };
        readonly sceneContexts?: readonly {
          readonly id: string;
          readonly name?: string;
          readonly instances: readonly {
            readonly id: string;
            readonly name?: string;
            readonly entityId?: string;
            readonly animationName?: string;
            readonly paletteId?: string | null;
            readonly visible?: boolean;
            readonly frameIndex?: number;
          }[];
        }[];
      },
): readonly PaletteDiagnosticFact[] {
  const palConfig =
    'palette' in projectOrOptions && projectOrOptions.palette
      ? projectOrOptions.palette
      : projectOrOptions;

  const palettes = palConfig.palettes ?? [];
  const paletteMap = new Map<string, PaletteDefinition>();
  for (const p of palettes) {
    if (typeof p.id === 'string' && p.id.trim() !== '') {
      paletteMap.set(p.id.trim(), p);
    }
  }

  const universalBackgroundColor =
    palConfig.universalBackgroundColor ??
    projectOrOptions.universalBackgroundColor;

  const rawBgSlots = palConfig.activeBackgroundSlots ??
    projectOrOptions.activeBackgroundSlots ?? [null, null, null, null];
  const activeBgSlots: (string | null)[] = [
    rawBgSlots[0] ?? null,
    rawBgSlots[1] ?? null,
    rawBgSlots[2] ?? null,
    rawBgSlots[3] ?? null,
  ];
  const activeBgSet = activePaletteIdSet(activeBgSlots);

  const rawSpSlots = palConfig.activeSpriteSlots ??
    palConfig.activeSpritePaletteSlots ??
    projectOrOptions.activeSpriteSlots ??
    projectOrOptions.activeSpritePaletteSlots ?? [null, null, null, null];
  const activeSpSlots: (string | null)[] = [
    rawSpSlots[0] ?? null,
    rawSpSlots[1] ?? null,
    rawSpSlots[2] ?? null,
    rawSpSlots[3] ?? null,
  ];
  const activeSpSet = activePaletteIdSet(activeSpSlots);

  let animations: readonly {
    readonly id: string;
    readonly name: string;
    readonly entity?: string;
    readonly paletteId?: string | null;
    readonly framePaletteIds?: readonly (string | null)[];
  }[] = [];
  if (
    'animations' in projectOrOptions &&
    Array.isArray(projectOrOptions.animations)
  ) {
    animations = projectOrOptions.animations;
  } else if (
    'animation' in projectOrOptions &&
    projectOrOptions.animation &&
    Array.isArray(projectOrOptions.animation.animations)
  ) {
    animations = projectOrOptions.animation.animations;
  }

  let backgroundMaps: readonly {
    readonly id: string;
    readonly name: string;
    readonly paletteId?: string | null;
  }[] = [];
  if ('backgrounds' in projectOrOptions && projectOrOptions.backgrounds) {
    const backgrounds = projectOrOptions.backgrounds;
    if (Array.isArray(backgrounds)) {
      backgroundMaps = backgrounds;
    } else {
      const backgroundCollection = backgrounds as {
        readonly maps?: readonly {
          readonly id: string;
          readonly name: string;
          readonly paletteId?: string | null;
        }[];
      };
      if (Array.isArray(backgroundCollection.maps)) {
        backgroundMaps = backgroundCollection.maps;
      }
    }
  }

  let sceneInstances: readonly {
    readonly id: string;
    readonly name?: string;
    readonly animationId?: string;
    readonly entityId?: string;
    readonly animationName?: string;
    readonly paletteId?: string | null;
    readonly visible?: boolean;
    readonly frameIndex?: number;
  }[] = [];
  if (
    'sceneInstances' in projectOrOptions &&
    Array.isArray(projectOrOptions.sceneInstances)
  ) {
    sceneInstances = projectOrOptions.sceneInstances;
  } else if (
    'scenePreview' in projectOrOptions &&
    projectOrOptions.scenePreview &&
    Array.isArray(projectOrOptions.scenePreview.instances)
  ) {
    sceneInstances = projectOrOptions.scenePreview.instances;
  }

  const sceneContexts: readonly PaletteDiagnosticSceneContext[] =
    'sceneContexts' in projectOrOptions &&
    isPaletteDiagnosticSceneContextArray(projectOrOptions.sceneContexts)
      ? projectOrOptions.sceneContexts
      : [
          {
            id: 'preview',
            name: 'Scene Preview',
            instances: sceneInstances,
          },
        ];

  const facts: PaletteDiagnosticFact[] = [];
  const emittedKeys = new Set<string>();

  const emit = (fact: PaletteDiagnosticFact): void => {
    if (!emittedKeys.has(fact.id)) {
      emittedKeys.add(fact.id);
      facts.push(fact);
    }
  };

  // 1. Check invalid NES color codes
  if (
    universalBackgroundColor !== undefined &&
    !isValidNesColorCode(universalBackgroundColor)
  ) {
    emit({
      id: 'invalid-nes-color:universal-bg',
      code: 'invalid-nes-color',
      kind: 'invalid-nes-color',
      severity: 'error',
      isUniversalBackground: true,
      colorValue: universalBackgroundColor,
    });
  }

  for (const palette of palettes) {
    for (let c = 0; c < NES_COLORS_PER_PALETTE; c++) {
      const colorValue = palette.colors[c] ?? Number.NaN;
      if (!isValidNesColorCode(colorValue)) {
        emit({
          id: `invalid-nes-color:${palette.id}:${String(c)}`,
          code: 'invalid-nes-color',
          kind: 'invalid-nes-color',
          severity: 'error',
          paletteId: palette.id,
          paletteName: palette.name,
          colorIndex: c,
          colorValue,
          isUniversalBackground: false,
        });
      }
    }
  }

  // 2. Check universal background color consistency ($3F00) on background subpalettes
  if (
    universalBackgroundColor !== undefined &&
    isValidNesColorCode(universalBackgroundColor)
  ) {
    for (const palette of palettes) {
      const isBgTarget = palette.target === 'background';
      const isAssignedToBgSlot = activeBgSet.has(palette.id);
      if (isBgTarget || isAssignedToBgSlot) {
        const color0 = palette.colors[0];
        if (
          isValidNesColorCode(color0) &&
          color0 !== universalBackgroundColor
        ) {
          emit({
            id: `inconsistent-universal-color:${palette.id}`,
            code: 'inconsistent-universal-color',
            kind: 'inconsistent-universal-color',
            severity: 'warning',
            paletteId: palette.id,
            paletteName: palette.name,
            actualColor: color0,
            expectedColor: universalBackgroundColor,
          });
        }
      }
    }
  }

  // 3. Check dangling palette references on active slots
  for (let s = 0; s < NES_PALETTE_BANK_SLOT_COUNT; s++) {
    const palId = activeBgSlots[s];
    if (typeof palId === 'string' && palId.trim() !== '') {
      if (!paletteMap.has(palId.trim())) {
        emit({
          id: `dangling:slot:bg:${String(s)}:${palId.trim()}`,
          code: 'dangling-palette-reference',
          kind: 'dangling-palette-reference',
          severity: 'error',
          paletteId: palId.trim(),
          consumerType: 'slot',
          consumerName: `Background Palette Slot ${String(s)}`,
          bank: 'background',
          slotIndex: s,
        });
      }
    }
  }

  for (let s = 0; s < NES_PALETTE_BANK_SLOT_COUNT; s++) {
    const palId = activeSpSlots[s];
    if (typeof palId === 'string' && palId.trim() !== '') {
      if (!paletteMap.has(palId.trim())) {
        emit({
          id: `dangling:slot:sp:${String(s)}:${palId.trim()}`,
          code: 'dangling-palette-reference',
          kind: 'dangling-palette-reference',
          severity: 'error',
          paletteId: palId.trim(),
          consumerType: 'slot',
          consumerName: `Sprite Palette Slot ${String(s)}`,
          bank: 'sprite',
          slotIndex: s,
        });
      }
    }
  }

  // 4. Check animations & frame overrides
  for (const anim of animations) {
    const animName = anim.name.trim() || anim.id;
    if (typeof anim.paletteId === 'string' && anim.paletteId.trim() !== '') {
      const palId = anim.paletteId.trim();
      if (!paletteMap.has(palId)) {
        emit({
          id: `dangling:anim:${anim.id}:${palId}`,
          code: 'dangling-palette-reference',
          kind: 'dangling-palette-reference',
          severity: 'error',
          paletteId: palId,
          consumerType: 'animation',
          consumerId: anim.id,
          consumerName: animName,
          bank: 'sprite',
        });
      } else if (!activeSpSet.has(palId)) {
        emit({
          id: `unassigned:anim:${anim.id}:${palId}`,
          code: 'unassigned-active-slot',
          kind: 'unassigned-active-slot',
          severity: 'warning',
          paletteId: palId,
          paletteName: paletteMap.get(palId)?.name ?? palId,
          bank: 'sprite',
          consumerType: 'animation',
          consumerId: anim.id,
          consumerName: animName,
        });
      }
    }

    if (anim.framePaletteIds) {
      for (let f = 0; f < anim.framePaletteIds.length; f++) {
        const framePalId = anim.framePaletteIds[f];
        if (typeof framePalId === 'string' && framePalId.trim() !== '') {
          const palId = framePalId.trim();
          if (!paletteMap.has(palId)) {
            emit({
              id: `dangling:frame:${anim.id}:${String(f)}:${palId}`,
              code: 'dangling-palette-reference',
              kind: 'dangling-palette-reference',
              severity: 'error',
              paletteId: palId,
              consumerType: 'frame',
              consumerId: anim.id,
              consumerName: animName,
              frameIndex: f,
              bank: 'sprite',
            });
          } else if (!activeSpSet.has(palId)) {
            emit({
              id: `unassigned:frame:${anim.id}:${String(f)}:${palId}`,
              code: 'unassigned-active-slot',
              kind: 'unassigned-active-slot',
              severity: 'warning',
              paletteId: palId,
              paletteName: paletteMap.get(palId)?.name ?? palId,
              bank: 'sprite',
              consumerType: 'frame',
              consumerId: anim.id,
              consumerName: animName,
              frameIndex: f,
            });
          }
        }
      }
    }
  }

  // 5. Check background maps
  for (const map of backgroundMaps) {
    const mapName = map.name.trim() || map.id;
    if (typeof map.paletteId === 'string' && map.paletteId.trim() !== '') {
      const palId = map.paletteId.trim();
      if (!paletteMap.has(palId)) {
        emit({
          id: `dangling:bg-map:${map.id}:${palId}`,
          code: 'dangling-palette-reference',
          kind: 'dangling-palette-reference',
          severity: 'error',
          paletteId: palId,
          consumerType: 'background',
          consumerId: map.id,
          consumerName: mapName,
          bank: 'background',
        });
      } else if (!activeBgSet.has(palId)) {
        emit({
          id: `unassigned:bg-map:${map.id}:${palId}`,
          code: 'unassigned-active-slot',
          kind: 'unassigned-active-slot',
          severity: 'warning',
          paletteId: palId,
          paletteName: paletteMap.get(palId)?.name ?? palId,
          bank: 'background',
          consumerType: 'background',
          consumerId: map.id,
          consumerName: mapName,
        });
      }
    }
  }

  // 6. Check scene instance references in every independently modeled context.
  for (const sceneContext of sceneContexts) {
    for (const inst of sceneContext.instances) {
      const instName = diagnosticDisplayName(inst.name, inst.id);
      if (typeof inst.paletteId === 'string' && inst.paletteId.trim() !== '') {
        const palId = inst.paletteId.trim();
        if (!paletteMap.has(palId)) {
          emit({
            id: `dangling:scene:${sceneContext.id}:${inst.id}:${palId}`,
            code: 'dangling-palette-reference',
            kind: 'dangling-palette-reference',
            severity: 'error',
            paletteId: palId,
            consumerType: 'scene',
            consumerId: inst.id,
            consumerName: instName,
            bank: 'sprite',
            contextId: sceneContext.id,
          });
        } else if (!activeSpSet.has(palId)) {
          emit({
            id: `unassigned:scene:${sceneContext.id}:${inst.id}:${palId}`,
            code: 'unassigned-active-slot',
            kind: 'unassigned-active-slot',
            severity: 'warning',
            paletteId: palId,
            paletteName: paletteMap.get(palId)?.name ?? palId,
            bank: 'sprite',
            consumerType: 'scene',
            consumerId: inst.id,
            consumerName: instName,
            contextId: sceneContext.id,
          });
        }
      }
    }
  }

  // 7. Check each simultaneous scene context independently. The project library
  // and animations that are not instantiated together do not consume slots.
  for (const sceneContext of sceneContexts) {
    const scenePalettes = new Set<string>();
    for (const inst of sceneContext.instances) {
      if (inst.visible === false) continue;
      if (typeof inst.paletteId === 'string' && inst.paletteId.trim() !== '') {
        scenePalettes.add(inst.paletteId.trim());
        continue;
      }
      const matches =
        inst.animationId !== undefined
          ? animations.filter((animation) => animation.id === inst.animationId)
          : animations.filter(
              (animation) =>
                inst.animationName !== undefined &&
                animation.name === inst.animationName &&
                (!inst.entityId ||
                  (animation.entity ?? 'entity').toLowerCase() ===
                    inst.entityId.toLowerCase()),
            );
      const matchedAnim = matches.length === 1 ? matches[0] : undefined;
      if (!matchedAnim) continue;

      const frameIndex =
        Number.isInteger(inst.frameIndex) && (inst.frameIndex ?? -1) >= 0
          ? (inst.frameIndex ?? 0)
          : 0;
      const effectivePaletteId =
        matchedAnim.framePaletteIds?.[frameIndex] ?? matchedAnim.paletteId;
      if (
        typeof effectivePaletteId === 'string' &&
        effectivePaletteId.trim() !== ''
      ) {
        scenePalettes.add(effectivePaletteId.trim());
      }
    }

    if (scenePalettes.size > NES_PALETTE_BANK_SLOT_COUNT) {
      const sortedPaletteIds = Array.from(scenePalettes).sort();
      emit({
        id: `slot-capacity-exceeded:scene:${sceneContext.id}`,
        code: 'slot-capacity-exceeded',
        kind: 'slot-capacity-exceeded',
        severity: 'error',
        bank: 'sprite',
        contextType: 'scene',
        contextId: sceneContext.id,
        contextName: diagnosticDisplayName(sceneContext.name, sceneContext.id),
        requiredCount: scenePalettes.size,
        maxCapacity: NES_PALETTE_BANK_SLOT_COUNT,
        distinctPaletteIds: sortedPaletteIds,
      });
    }
  }

  return sortPaletteDiagnosticFacts(facts);
}

/**
 * Formats a typed PaletteDiagnosticFact into a localized human-readable string.
 */
export function formatPaletteDiagnosticMessage(
  fact: PaletteDiagnosticFact,
): string {
  switch (fact.kind) {
    case 'dangling-palette-reference': {
      if (fact.consumerType === 'slot') {
        const bankName =
          fact.bank === 'background'
            ? t('paletteBankBackground')
            : t('paletteBankSprite');
        return t('paletteDiagDanglingSlotReference', {
          bank: bankName,
          slotIndex: fact.slotIndex ?? 0,
          paletteId: fact.paletteId,
        });
      }
      if (fact.consumerType === 'frame') {
        return t('paletteDiagDanglingFrameReference', {
          consumerName: fact.consumerName,
          frameIndex: (fact.frameIndex ?? 0) + 1,
          paletteId: fact.paletteId,
        });
      }
      return t('paletteDiagDanglingReference', {
        consumerName: fact.consumerName,
        consumerType: t(
          fact.consumerType === 'animation'
            ? 'paletteConsumerAnimation'
            : fact.consumerType === 'scene'
              ? 'paletteConsumerScene'
              : 'paletteConsumerBackground',
        ),
        paletteId: fact.paletteId,
      });
    }

    case 'unassigned-active-slot': {
      const bankName =
        fact.bank === 'background'
          ? t('paletteBankBackground')
          : t('paletteBankSprite');
      if (fact.consumerType === 'frame') {
        return t('paletteDiagUnassignedFrameSlot', {
          consumerName: fact.consumerName,
          frameIndex: (fact.frameIndex ?? 0) + 1,
          paletteName: fact.paletteName,
          bank: bankName,
        });
      }
      return t('paletteDiagUnassignedSlot', {
        consumerName: fact.consumerName,
        paletteName: fact.paletteName,
        bank: bankName,
      });
    }

    case 'slot-capacity-exceeded': {
      const bankName =
        fact.bank === 'background'
          ? t('paletteBankBackground')
          : t('paletteBankSprite');
      return t('paletteDiagSlotCapacityExceeded', {
        contextName:
          fact.contextId === 'preview'
            ? t('scenePreviewTitle')
            : fact.contextName,
        requiredCount: fact.requiredCount,
        maxCapacity: fact.maxCapacity,
        bank: bankName,
      });
    }

    case 'invalid-nes-color': {
      const hex = Number.isFinite(fact.colorValue)
        ? (Math.floor(fact.colorValue) & 0xff)
            .toString(16)
            .toUpperCase()
            .padStart(2, '0')
        : '??';
      if (fact.isUniversalBackground) {
        return t('paletteDiagInvalidUniversalColor', {
          hex,
          value: fact.colorValue,
        });
      }
      return t('paletteDiagInvalidColor', {
        paletteName: fact.paletteName ?? 'Palette',
        colorIndex: fact.colorIndex ?? 0,
        hex,
        value: fact.colorValue,
      });
    }

    case 'inconsistent-universal-color': {
      const actualHex = (fact.actualColor & 0x3f)
        .toString(16)
        .toUpperCase()
        .padStart(2, '0');
      const expectedHex = (fact.expectedColor & 0x3f)
        .toString(16)
        .toUpperCase()
        .padStart(2, '0');
      return t('paletteDiagInconsistentUniversalColor', {
        paletteName: fact.paletteName,
        actualHex,
        expectedHex,
      });
    }
  }
}
