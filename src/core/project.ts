import type { CollisionType } from './collision-encoder';
import {
  createDefaultNesPaletteSet,
  isValidNesColorCode,
  type NesPaletteSet,
} from './nes-palette';
import {
  DEFAULT_QUANTIZATION_SETTINGS,
  normalizeQuantizationSettings,
  type DitheringMode,
  type QuantizationMode,
  type QuantizationSettings,
} from './quantization-settings';
import {
  DEFAULT_RANDOM_PLAYFIELD_FEATURES,
  type RandomPlayfieldFeature,
} from './random-playfield';
import type { AnimationPlayback } from './animation-model';
import type { ProjectMode } from './project-mode';
import {
  type ProjectScenePreviewConfig,
  type ScenePreviewInstance,
  generateInstanceId,
} from './scene-preview';
import { validateChrRegion, type ChrRegion } from './chr-pattern-table';
import {
  createLogicalTileKey,
  normalizeProjectAssetId,
  type ProjectAssetId,
  type ProjectAssetKind,
} from './asset-identity';
import type {
  BackgroundMapCell,
  BackgroundMapDefinition,
  BackgroundPatternTable,
} from './background-model';
import {
  BACKGROUND_HEIGHT_TILES,
  BACKGROUND_PALETTE_ASSIGNMENT_COUNT,
  BACKGROUND_TILE_COUNT,
  BACKGROUND_WIDTH_TILES,
} from './background-model';

export type { ProjectScenePreviewConfig, ScenePreviewInstance, ChrRegion };
export * from './asset-identity';
export * from './chr-asset-mapping';
export * from './asset-lifecycle';
export * from './metasprite-extraction';
export * from './chr-spritesheet-allocation';
export * from './background-model';
export * from './background-exporters';
export type {
  ActivePaletteSlots,
  AnalyzePaletteDiagnosticsOptions,
  DualBankPaletteState,
  PaletteConsumerType,
  PaletteDefinition,
  PaletteDiagnosticFact,
  PaletteDiagnosticKind,
  ProjectPaletteId,
} from './palette-manager';
export {
  analyzeProjectPaletteDiagnostics,
  formatPaletteDiagnosticMessage,
  resolveProjectBackgroundPaletteSet,
  resolveProjectPaletteState,
  resolveProjectSpritePaletteSet,
} from './palette-manager';

export const CURRENT_PROJECT_FORMAT_VERSION = 1;
export const SUPPORTED_PROJECT_FORMAT_VERSIONS = [1] as const;

export interface ProjectAssetReference {
  /** Stable unique logical asset identifier. */
  readonly id?: ProjectAssetId;
  /** Path to the asset file (relative to project file whenever possible). */
  readonly path: string;
  /** Optional original file name. */
  readonly name?: string;
  /** Source kind: png, chr, or nes. */
  readonly sourceKind?: 'png' | 'chr' | 'nes';
  /** Optional embedded data URL or Base64 for instant self-contained reconstruction. */
  readonly dataUrl?: string;
}

import type { TilePixelOverrides } from './pixel-overrides';
import {
  DEFAULT_UNIVERSAL_BACKGROUND_COLOR,
  createDefaultDualBankPaletteState,
  createDefaultPaletteDefinitions,
  resolveActiveBackgroundPaletteSet,
  type ActivePaletteSlots,
  type PaletteDefinition,
} from './palette-manager';

export interface ProjectAnimationItemConfig {
  readonly id: string;
  readonly name: string;
  readonly entity?: string;
  readonly asset: ProjectAssetReference | null;
  readonly paletteId?: string | null;
  readonly paletteIndex?: number | null;
  readonly framePaletteIds?: readonly (string | null)[];
  readonly quantizationMode?: QuantizationMode;
  readonly ditheringMode?: DitheringMode;
  readonly pixelOverrides?: TilePixelOverrides;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly originX: number;
  readonly originY: number;
  readonly playback: AnimationPlayback;
  readonly allowHorizontalFlip: boolean;
  readonly allowVerticalFlip: boolean;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly defaultDuration: number;
  readonly frameIndices: readonly number[];
  readonly frameDurations: readonly number[];
  readonly framePalettes?: readonly (number | null)[];
}

export interface ProjectAnimationSettingsConfig {
  readonly name: string;
  readonly symbolPrefix: string;
  readonly defaultPaletteIndex: number;
  readonly quantizationMode: QuantizationMode;
  readonly ditheringMode: DitheringMode;
  readonly flipDeduplication: boolean;
  readonly spritePalette: number;
  readonly spriteColorIndex: number;
  readonly patternTable: 0 | 1;
  readonly destinationPatternTable: 0 | 1;
  readonly destinationChr: ProjectAssetReference | null;
  readonly animations: readonly ProjectAnimationItemConfig[];
}

export interface ProjectTilesetConfig {
  readonly asset: ProjectAssetReference | null;
  readonly paletteAssignments?: readonly number[];
  readonly pixelOverrides?: readonly number[];
}

export interface ProjectPlayfieldConfig {
  readonly asset: ProjectAssetReference | null;
  readonly collisionCells?: readonly number[];
  readonly activeCollisionType?: CollisionType;
  readonly randomPlayfieldFeatures?: readonly RandomPlayfieldFeature[];
  readonly paletteAssignments?: readonly number[];
  readonly pixelOverrides?: readonly number[];
}

export interface ProjectBackgroundSettingsConfig {
  readonly activeMapId?: string | null;
  readonly maps: readonly BackgroundMapDefinition[];
}

export interface ProjectPaletteConfig {
  /** Canonical universal background color ($3F00). */
  readonly universalBackgroundColor: number;
  /** Canonical complete library of palette definitions. */
  readonly palettes: readonly PaletteDefinition[];
  /** Canonical 4-slot active subpalettes for Background ($3F00..$3F0F). */
  readonly activeBackgroundSlots: ActivePaletteSlots;
  /** Canonical 4-slot active subpalettes for Sprites ($3F10..$3F1F). */
  readonly activeSpriteSlots: ActivePaletteSlots;
  /** Active palette index in UI editor (convenience). */
  readonly activePaletteIndex?: number;
  /** Active color index in UI editor (convenience). */
  readonly activeColorIndex?: number;
  /** Legacy 4-subpalette matrix maintained for backward compatibility. */
  readonly paletteSet: NesPaletteSet;
  /** Legacy alias for activeSpriteSlots maintained for backward compatibility. */
  readonly activeSpritePaletteSlots?: readonly (string | null)[];
}

export interface StudioProject {
  readonly formatVersion: 1;
  readonly name: string;
  readonly mode: ProjectMode;
  readonly settings: {
    readonly deduplicationEnabled: boolean;
    readonly flipDeduplicationEnabled: boolean;
    readonly quantization: QuantizationSettings;
  };
  readonly palette: ProjectPaletteConfig;
  readonly chrRegions?: readonly ChrRegion[];
  readonly tileset?: ProjectTilesetConfig;
  readonly playfield?: ProjectPlayfieldConfig;
  readonly backgrounds?: ProjectBackgroundSettingsConfig;
  readonly animation?: ProjectAnimationSettingsConfig;
  readonly scenePreview?: ProjectScenePreviewConfig;
}

export interface MissingAssetInfo {
  readonly name: string;
  readonly expectedPath: string;
  readonly message: string;
}

export type ProjectDeserializationResult =
  | {
      readonly success: true;
      readonly project: StudioProject;
    }
  | {
      readonly success: false;
      readonly error: {
        readonly code:
          | 'invalid-json'
          | 'missing-format-version'
          | 'unsupported-format-version'
          | 'invalid-project-schema';
        readonly message: string;
        readonly details?: Record<string, unknown>;
      };
    };

/**
 * Normalizes file path to use forward slashes and removes leading redundant `./`.
 */
export function normalizePath(path: string): string {
  const unixStyle = path.replace(/\\/g, '/');
  return unixStyle.replace(/^(\.\/)+/, '');
}

/**
 * Extracts directory name from a file path.
 */
export function getDirectoryPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
}

/**
 * Computes a relative path from a base directory to a target file path.
 */
export function toRelativePath(
  baseDirPath: string,
  targetFilePath: string,
): string {
  const normBase = normalizePath(baseDirPath).replace(/\/+$/, '');
  const normTarget = normalizePath(targetFilePath);

  if (!normBase) {
    return normTarget;
  }

  // If on Windows and drive letters differ, cannot make relative.
  const baseDriveMatch = /^([a-zA-Z]:)/.exec(normBase);
  const targetDriveMatch = /^([a-zA-Z]:)/.exec(normTarget);
  if (
    baseDriveMatch &&
    targetDriveMatch &&
    baseDriveMatch[1]?.toLowerCase() !== targetDriveMatch[1]?.toLowerCase()
  ) {
    return normTarget;
  }

  const baseParts = normBase.split('/').filter(Boolean);
  const targetParts = normTarget.split('/').filter(Boolean);

  let commonLength = 0;
  while (
    commonLength < baseParts.length &&
    commonLength < targetParts.length &&
    baseParts[commonLength]?.toLowerCase() ===
      targetParts[commonLength]?.toLowerCase()
  ) {
    commonLength += 1;
  }

  const upCount = baseParts.length - commonLength;
  const upSegments = Array.from({ length: upCount }, () => '..');
  const downSegments = targetParts.slice(commonLength);
  const result = [...upSegments, ...downSegments].join('/');

  return result || './';
}

/**
 * Resolves a relative path against a base directory path.
 */
export function resolveRelativePath(
  baseDirPath: string,
  relativePath: string,
): string {
  const normBase = normalizePath(baseDirPath).replace(/\/+$/, '');
  const normRel = normalizePath(relativePath);

  // If relative path is absolute (e.g. /path or C:/path), return it normalized.
  if (/^(\/|[a-zA-Z]:)/.test(normRel)) {
    return normRel;
  }

  if (!normBase) {
    return normRel;
  }

  const segments = [
    ...normBase.split('/').filter(Boolean),
    ...normRel.split('/'),
  ];
  const resolved: string[] = [];

  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
      } else {
        resolved.push('..');
      }
    } else {
      resolved.push(seg);
    }
  }

  // Preserve drive letter prefix on Windows if it had one
  if (/^[a-zA-Z]:/.test(normBase)) {
    const drive = /^([a-zA-Z]:)/.exec(normBase)?.[1] ?? '';
    const withoutDrive = resolved.filter((s) => s !== drive);
    return `${drive}/${withoutDrive.join('/')}`;
  }

  const isLeadingSlash = normBase.startsWith('/');
  return (isLeadingSlash ? '/' : '') + resolved.join('/');
}

/**
 * Creates a clean default StudioProject.
 */
export function createDefaultProject(
  name = 'Untitled Project',
  mode: ProjectMode = 'tileset',
): StudioProject {
  const dualBank = createDefaultDualBankPaletteState();
  const defaultPaletteSet = resolveActiveBackgroundPaletteSet(
    dualBank.palettes,
    dualBank.activeBackgroundSlots,
    dualBank.universalBackgroundColor,
  );

  return {
    formatVersion: 1,
    name,
    mode,
    settings: {
      deduplicationEnabled: mode === 'playfield',
      flipDeduplicationEnabled: false,
      quantization: DEFAULT_QUANTIZATION_SETTINGS,
    },
    palette: {
      universalBackgroundColor: dualBank.universalBackgroundColor,
      palettes: dualBank.palettes,
      activeBackgroundSlots: dualBank.activeBackgroundSlots,
      activeSpriteSlots: dualBank.activeSpriteSlots,
      activePaletteIndex: 0,
      activeColorIndex: 1,
      paletteSet: defaultPaletteSet,
      activeSpritePaletteSlots: dualBank.activeSpriteSlots,
    },
    chrRegions: [],
    tileset: {
      asset: null,
    },
    playfield: {
      asset: null,
      randomPlayfieldFeatures: [...DEFAULT_RANDOM_PLAYFIELD_FEATURES],
    },
    backgrounds: {
      activeMapId: null,
      maps: [],
    },
    animation: {
      name: 'soldier',
      symbolPrefix: 'soldier',
      defaultPaletteIndex: 0,
      quantizationMode: 'median-cut',
      ditheringMode: 'none',
      flipDeduplication: true,
      spritePalette: 0,
      spriteColorIndex: 1,
      patternTable: 0,
      destinationPatternTable: 0,
      destinationChr: null,
      animations: [
        {
          id: 'anim-default',
          name: 'idle',
          entity: 'entity',
          asset: null,
          paletteId:
            dualBank.activeSpriteSlots[0] ?? dualBank.palettes[0]?.id ?? null,
          paletteIndex: null,
          framePaletteIds: [],
          framePalettes: [],
          quantizationMode: 'median-cut',
          ditheringMode: 'none',
          frameWidth: 16,
          frameHeight: 16,
          originX: 8,
          originY: 16,
          playback: 'loop',
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          defaultDuration: 12,
          frameIndices: [],
          frameDurations: [],
        },
      ],
    },
    scenePreview: {
      instances: [],
    },
  };
}

/**
 * Serializes a StudioProject into formatted JSON string.
 */
export function serializeProject(project: StudioProject): string {
  const paletteSet = resolveActiveBackgroundPaletteSet(
    project.palette.palettes,
    project.palette.activeBackgroundSlots,
    project.palette.universalBackgroundColor,
    project.palette.paletteSet,
  );
  const persistableProject: StudioProject = {
    ...project,
    palette: {
      ...project.palette,
      paletteSet,
      activeSpritePaletteSlots: project.palette.activeSpriteSlots,
    },
  };
  return JSON.stringify(persistableProject, null, 2);
}

/**
 * Deserializes and validates a JSON string into a StudioProject.
 */
export function deserializeProject(
  jsonText: string,
): ProjectDeserializationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error: unknown) {
    return {
      success: false,
      error: {
        code: 'invalid-json',
        message: 'Project file is not valid JSON.',
        details: {
          originalError: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      success: false,
      error: {
        code: 'invalid-project-schema',
        message: 'Project root must be a JSON object.',
      },
    };
  }

  const raw = parsed as Record<string, unknown>;

  if (!('formatVersion' in raw)) {
    return {
      success: false,
      error: {
        code: 'missing-format-version',
        message: 'Project file does not contain a formatVersion field.',
      },
    };
  }

  if (
    typeof raw.formatVersion !== 'number' ||
    !SUPPORTED_PROJECT_FORMAT_VERSIONS.includes(
      raw.formatVersion as (typeof SUPPORTED_PROJECT_FORMAT_VERSIONS)[number],
    )
  ) {
    return {
      success: false,
      error: {
        code: 'unsupported-format-version',
        message: `Unsupported project formatVersion: ${String(raw.formatVersion)}. Supported versions: ${SUPPORTED_PROJECT_FORMAT_VERSIONS.join(', ')}.`,
        details: {
          formatVersion: raw.formatVersion,
          supportedVersions: SUPPORTED_PROJECT_FORMAT_VERSIONS,
        },
      },
    };
  }

  const name =
    typeof raw.name === 'string' && raw.name.trim() !== ''
      ? raw.name.trim()
      : 'Untitled Project';

  const mode: ProjectMode =
    raw.mode === 'tileset' ||
    raw.mode === 'playfield' ||
    raw.mode === 'animation'
      ? raw.mode
      : 'tileset';

  const rawSettings =
    typeof raw.settings === 'object' && raw.settings !== null
      ? (raw.settings as Record<string, unknown>)
      : {};

  const deduplicationEnabled =
    typeof rawSettings.deduplicationEnabled === 'boolean'
      ? rawSettings.deduplicationEnabled
      : true;

  const flipDeduplicationEnabled =
    typeof rawSettings.flipDeduplicationEnabled === 'boolean'
      ? rawSettings.flipDeduplicationEnabled
      : true;

  const quantization = normalizeQuantizationSettings(rawSettings.quantization);

  const rawPalette =
    typeof raw.palette === 'object' && raw.palette !== null
      ? (raw.palette as Record<string, unknown>)
      : {};

  const legacyPaletteSet = parsePaletteSet(rawPalette.paletteSet);
  const parsedPalettes = parsePaletteDefinitions(rawPalette.palettes);

  // 1. Resolve universal background color ($3F00)
  let universalBackgroundColor: number;
  if (
    typeof rawPalette.universalBackgroundColor === 'number' &&
    isValidNesColorCode(rawPalette.universalBackgroundColor)
  ) {
    universalBackgroundColor = rawPalette.universalBackgroundColor & 0x3f;
  } else if (isValidNesColorCode(legacyPaletteSet[0][0])) {
    universalBackgroundColor = legacyPaletteSet[0][0];
  } else {
    universalBackgroundColor = DEFAULT_UNIVERSAL_BACKGROUND_COLOR;
  }

  // 2. Resolve library of palettes
  const palettes: readonly PaletteDefinition[] =
    parsedPalettes ?? createDefaultPaletteDefinitions(legacyPaletteSet);

  // 3. Resolve active background slots
  const parsedBgSlots = parseActiveSlots(rawPalette.activeBackgroundSlots);
  const activeBackgroundSlots: ActivePaletteSlots = parsedBgSlots ?? [
    palettes[0]?.id ?? null,
    palettes[1]?.id ?? null,
    palettes[2]?.id ?? null,
    palettes[3]?.id ?? null,
  ];

  // 4. Resolve active sprite slots
  const parsedSpSlots = parseActiveSlots(
    rawPalette.activeSpriteSlots ?? rawPalette.activeSpritePaletteSlots,
  );
  const activeSpriteSlots: ActivePaletteSlots = parsedSpSlots ?? [
    palettes[0]?.id ?? null,
    palettes[1]?.id ?? null,
    palettes[2]?.id ?? null,
    palettes[3]?.id ?? null,
  ];

  // 5. Effective background paletteSet for backward compatibility
  const paletteSet = resolveActiveBackgroundPaletteSet(
    palettes,
    activeBackgroundSlots,
    universalBackgroundColor,
    legacyPaletteSet,
  );

  const activePaletteIndex =
    typeof rawPalette.activePaletteIndex === 'number'
      ? Math.max(0, Math.min(3, Math.floor(rawPalette.activePaletteIndex)))
      : undefined;
  const activeColorIndex =
    typeof rawPalette.activeColorIndex === 'number'
      ? Math.max(0, Math.min(3, Math.floor(rawPalette.activeColorIndex)))
      : undefined;

  let tileset: ProjectTilesetConfig | undefined;
  if (typeof raw.tileset === 'object' && raw.tileset !== null) {
    const rawTileset = raw.tileset as Record<string, unknown>;
    tileset = {
      asset: parseAssetReference(rawTileset.asset, 'tileset-image'),
      paletteAssignments: parseNumberArray(rawTileset.paletteAssignments),
      pixelOverrides: parseNumberArray(rawTileset.pixelOverrides),
    };
  }

  let playfield: ProjectPlayfieldConfig | undefined;
  if (typeof raw.playfield === 'object' && raw.playfield !== null) {
    const rawPlayfield = raw.playfield as Record<string, unknown>;
    playfield = {
      asset: parseAssetReference(rawPlayfield.asset, 'playfield-image'),
      collisionCells: parseNumberArray(rawPlayfield.collisionCells),
      activeCollisionType:
        typeof rawPlayfield.activeCollisionType === 'number'
          ? (rawPlayfield.activeCollisionType as CollisionType)
          : undefined,
      randomPlayfieldFeatures: Array.isArray(
        rawPlayfield.randomPlayfieldFeatures,
      )
        ? (rawPlayfield.randomPlayfieldFeatures as RandomPlayfieldFeature[])
        : undefined,
      paletteAssignments: parseNumberArray(rawPlayfield.paletteAssignments),
      pixelOverrides: parseNumberArray(rawPlayfield.pixelOverrides),
    };
  }

  let animation: ProjectAnimationSettingsConfig | undefined;
  if (typeof raw.animation === 'object' && raw.animation !== null) {
    const rawAnim = raw.animation as Record<string, unknown>;
    const rawItems = Array.isArray(rawAnim.animations)
      ? rawAnim.animations
      : [];
    const items: ProjectAnimationItemConfig[] = [];
    for (const item of rawItems) {
      if (typeof item !== 'object' || item === null) continue;
      const rawItem = item as Record<string, unknown>;

      const animId =
        typeof rawItem.id === 'string' && rawItem.id.trim() !== ''
          ? rawItem.id.trim()
          : `anim-${String(items.length + 1)}`;

      const rawPaletteId =
        typeof rawItem.paletteId === 'string' && rawItem.paletteId.trim() !== ''
          ? rawItem.paletteId.trim()
          : undefined;

      const rawPaletteIndex =
        typeof rawItem.paletteIndex === 'number' ? rawItem.paletteIndex : null;

      // Migrate paletteIndex to paletteId if paletteId is not explicitly set
      let resolvedPaletteId: string | null;
      if (rawPaletteId !== undefined) {
        resolvedPaletteId = rawPaletteId;
      } else if (
        rawPaletteIndex !== null &&
        rawPaletteIndex >= 0 &&
        rawPaletteIndex < 4
      ) {
        resolvedPaletteId =
          activeSpriteSlots[rawPaletteIndex] ??
          palettes[rawPaletteIndex]?.id ??
          null;
      } else {
        resolvedPaletteId = activeSpriteSlots[0] ?? palettes[0]?.id ?? null;
      }

      const rawFramePaletteIds = parseStringArray(rawItem.framePaletteIds);
      const rawFramePalettes = Array.isArray(rawItem.framePalettes)
        ? rawItem.framePalettes.map((p) => (typeof p === 'number' ? p : null))
        : undefined;

      const resolvedFramePaletteIds =
        rawFramePaletteIds ??
        (rawFramePalettes
          ? rawFramePalettes.map((pIdx) => {
              if (pIdx !== null && pIdx >= 0 && pIdx < 4) {
                return activeSpriteSlots[pIdx] ?? palettes[pIdx]?.id ?? null;
              }
              return null;
            })
          : undefined);

      items.push({
        id: animId,
        name:
          typeof rawItem.name === 'string' && rawItem.name.trim() !== ''
            ? rawItem.name.trim()
            : 'anim',
        entity:
          typeof rawItem.entity === 'string' && rawItem.entity.trim() !== ''
            ? rawItem.entity.trim()
            : 'entity',
        asset: parseAssetReference(rawItem.asset, 'spritesheet', animId),
        paletteId: resolvedPaletteId,
        paletteIndex: rawPaletteIndex,
        framePaletteIds: resolvedFramePaletteIds,
        framePalettes: rawFramePalettes,
        quantizationMode:
          rawItem.quantizationMode === 'nearest' ||
          rawItem.quantizationMode === 'median-cut' ||
          rawItem.quantizationMode === 'k-means'
            ? rawItem.quantizationMode
            : undefined,
        ditheringMode:
          rawItem.ditheringMode === 'none' ||
          rawItem.ditheringMode === 'floyd-steinberg'
            ? rawItem.ditheringMode
            : undefined,
        frameWidth:
          typeof rawItem.frameWidth === 'number' && rawItem.frameWidth > 0
            ? rawItem.frameWidth
            : 16,
        frameHeight:
          typeof rawItem.frameHeight === 'number' && rawItem.frameHeight > 0
            ? rawItem.frameHeight
            : 16,
        originX: typeof rawItem.originX === 'number' ? rawItem.originX : 0,
        originY: typeof rawItem.originY === 'number' ? rawItem.originY : 0,
        playback: rawItem.playback === 'once' ? 'once' : 'loop',
        allowHorizontalFlip: Boolean(rawItem.allowHorizontalFlip),
        allowVerticalFlip: Boolean(rawItem.allowVerticalFlip),
        flipH: typeof rawItem.flipH === 'boolean' ? rawItem.flipH : undefined,
        flipV: typeof rawItem.flipV === 'boolean' ? rawItem.flipV : undefined,
        defaultDuration:
          typeof rawItem.defaultDuration === 'number' &&
          rawItem.defaultDuration > 0
            ? rawItem.defaultDuration
            : 12,
        pixelOverrides: parseTilePixelOverrides(rawItem.pixelOverrides),
        frameIndices: parseNumberArray(rawItem.frameIndices) ?? [],
        frameDurations: parseNumberArray(rawItem.frameDurations) ?? [],
      });
    }

    animation = {
      name:
        typeof rawAnim.name === 'string' && rawAnim.name.trim() !== ''
          ? rawAnim.name.trim()
          : 'entity',
      symbolPrefix:
        typeof rawAnim.symbolPrefix === 'string' &&
        rawAnim.symbolPrefix.trim() !== ''
          ? rawAnim.symbolPrefix.trim()
          : 'entity',
      defaultPaletteIndex:
        typeof rawAnim.defaultPaletteIndex === 'number'
          ? Math.max(0, Math.min(3, Math.floor(rawAnim.defaultPaletteIndex)))
          : 0,
      quantizationMode:
        rawAnim.quantizationMode === 'nearest' ||
        rawAnim.quantizationMode === 'median-cut' ||
        rawAnim.quantizationMode === 'k-means'
          ? rawAnim.quantizationMode
          : 'median-cut',
      ditheringMode:
        rawAnim.ditheringMode === 'none' ||
        rawAnim.ditheringMode === 'floyd-steinberg'
          ? rawAnim.ditheringMode
          : 'none',
      flipDeduplication:
        typeof rawAnim.flipDeduplication === 'boolean'
          ? rawAnim.flipDeduplication
          : true,
      spritePalette:
        typeof rawAnim.spritePalette === 'number'
          ? Math.max(0, Math.min(3, Math.floor(rawAnim.spritePalette)))
          : 0,
      spriteColorIndex:
        typeof rawAnim.spriteColorIndex === 'number'
          ? rawAnim.spriteColorIndex
          : 1,
      patternTable: rawAnim.patternTable === 1 ? 1 : 0,
      destinationPatternTable: rawAnim.destinationPatternTable === 1 ? 1 : 0,
      destinationChr: parseAssetReference(rawAnim.destinationChr, 'base-chr'),
      animations: items,
    };
  }

  const scenePreview = parseScenePreview(
    raw.scenePreview,
    animation?.animations ?? [],
  );
  const chrRegions = parseChrRegions(raw.chrRegions);
  const backgrounds = parseBackgroundSettings(raw.backgrounds);

  const project: StudioProject = {
    formatVersion: 1,
    name,
    mode,
    settings: {
      deduplicationEnabled,
      flipDeduplicationEnabled,
      quantization,
    },
    palette: {
      universalBackgroundColor,
      palettes,
      activeBackgroundSlots,
      activeSpriteSlots,
      ...(activePaletteIndex !== undefined ? { activePaletteIndex } : {}),
      ...(activeColorIndex !== undefined ? { activeColorIndex } : {}),
      paletteSet,
      activeSpritePaletteSlots: activeSpriteSlots,
    },
    ...(chrRegions !== undefined ? { chrRegions } : {}),
    ...(tileset !== undefined ? { tileset } : {}),
    ...(playfield !== undefined ? { playfield } : {}),
    ...(backgrounds !== undefined ? { backgrounds } : {}),
    ...(animation !== undefined ? { animation } : {}),
    ...(scenePreview !== undefined ? { scenePreview } : {}),
  };

  return {
    success: true,
    project,
  };
}

function parseChrRegions(value: unknown): readonly ChrRegion[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const regions: ChrRegion[] = [];
  for (const item of value) {
    const result = validateChrRegion(item);
    if (result.valid) {
      regions.push(result.region);
    }
  }
  return regions;
}

function parsePaletteSet(value: unknown): NesPaletteSet {
  if (Array.isArray(value) && value.length === 4) {
    const validRows = value.every(
      (row) => Array.isArray(row) && row.length === 4,
    );
    if (validRows) {
      const rows = value as unknown[][];
      const parsedSet = rows.map((row) =>
        row.map((val) => (typeof val === 'number' ? val & 0x3f : 0x0f)),
      );
      return parsedSet as unknown as NesPaletteSet;
    }
  }
  return createDefaultNesPaletteSet();
}

function parsePaletteDefinitions(
  value: unknown,
): readonly PaletteDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: PaletteDefinition[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const rawDef = item as Record<string, unknown>;
    if (typeof rawDef.id !== 'string' || rawDef.id.trim() === '') continue;
    const id = rawDef.id.trim();
    const name =
      typeof rawDef.name === 'string' && rawDef.name.trim() !== ''
        ? rawDef.name.trim()
        : 'Palette';

    let target: 'sprite' | 'background' | 'shared' | undefined;
    if (
      rawDef.target === 'sprite' ||
      rawDef.target === 'background' ||
      rawDef.target === 'shared'
    ) {
      target = rawDef.target;
    }

    let colors: [number, number, number, number] = [0x0f, 0x00, 0x10, 0x30];
    if (Array.isArray(rawDef.colors) && rawDef.colors.length === 4) {
      colors = [
        typeof rawDef.colors[0] === 'number' &&
        Number.isFinite(rawDef.colors[0])
          ? rawDef.colors[0] & 0x3f
          : 0x0f,
        typeof rawDef.colors[1] === 'number' &&
        Number.isFinite(rawDef.colors[1])
          ? rawDef.colors[1] & 0x3f
          : 0x00,
        typeof rawDef.colors[2] === 'number' &&
        Number.isFinite(rawDef.colors[2])
          ? rawDef.colors[2] & 0x3f
          : 0x10,
        typeof rawDef.colors[3] === 'number' &&
        Number.isFinite(rawDef.colors[3])
          ? rawDef.colors[3] & 0x3f
          : 0x30,
      ];
    }
    result.push({
      id,
      name,
      colors,
      ...(target !== undefined ? { target } : {}),
    });
  }
  return result.length > 0 ? result : undefined;
}

function parseActiveSlots(value: unknown): ActivePaletteSlots | undefined {
  if (!Array.isArray(value)) return undefined;
  const s0 =
    typeof value[0] === 'string' && value[0].trim() !== ''
      ? value[0].trim()
      : null;
  const s1 =
    typeof value[1] === 'string' && value[1].trim() !== ''
      ? value[1].trim()
      : null;
  const s2 =
    typeof value[2] === 'string' && value[2].trim() !== ''
      ? value[2].trim()
      : null;
  const s3 =
    typeof value[3] === 'string' && value[3].trim() !== ''
      ? value[3].trim()
      : null;
  return [s0, s1, s2, s3];
}

function parseStringArray(value: unknown): (string | null)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null,
  );
}

function parseAssetReference(
  value: unknown,
  fallbackKind?: ProjectAssetKind,
  fallbackSecondaryKey?: string | number,
): ProjectAssetReference | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.path !== 'string' || raw.path.trim() === '') return null;
  const rawId =
    typeof raw.id === 'string' && raw.id.trim() !== ''
      ? raw.id.trim()
      : undefined;
  const id = fallbackKind
    ? normalizeProjectAssetId(rawId, fallbackKind, fallbackSecondaryKey)
    : rawId;
  return {
    ...(id ? { id } : {}),
    path: normalizePath(raw.path.trim()),
    name: typeof raw.name === 'string' ? raw.name.trim() : undefined,
    sourceKind:
      raw.sourceKind === 'png' ||
      raw.sourceKind === 'chr' ||
      raw.sourceKind === 'nes'
        ? raw.sourceKind
        : undefined,
    dataUrl:
      typeof raw.dataUrl === 'string' && raw.dataUrl.trim() !== ''
        ? raw.dataUrl
        : undefined,
  };
}

function parseNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is number => typeof v === 'number');
}

function parseTilePixelOverrides(
  value: unknown,
): TilePixelOverrides | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const result: Record<string, Record<number, number>> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) continue;
    const tileMap = val as Record<string, unknown>;
    const sanitizedTileMap: Record<number, number> = {};
    for (const [offsetStr, colorIdx] of Object.entries(tileMap)) {
      const offset = parseInt(offsetStr, 10);
      if (!Number.isFinite(offset) || offset < 0 || offset >= 64) continue;
      if (typeof colorIdx === 'number' && colorIdx >= 0 && colorIdx <= 3) {
        sanitizedTileMap[offset] = Math.floor(colorIdx);
      }
    }
    if (Object.keys(sanitizedTileMap).length > 0) {
      result[key] = sanitizedTileMap;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseScenePreview(
  value: unknown,
  animations: readonly ProjectAnimationItemConfig[],
): ProjectScenePreviewConfig | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.instances)) return { instances: [] };
  const instances: ScenePreviewInstance[] = [];
  for (const item of raw.instances) {
    if (typeof item !== 'object' || item === null) continue;
    const rawInst = item as Record<string, unknown>;
    if (
      typeof rawInst.entityId !== 'string' ||
      rawInst.entityId.trim() === ''
    ) {
      continue;
    }
    const id =
      typeof rawInst.id === 'string' && rawInst.id.trim() !== ''
        ? rawInst.id.trim()
        : generateInstanceId();
    const entityId = rawInst.entityId.trim();
    const animationName =
      typeof rawInst.animationName === 'string' &&
      rawInst.animationName.trim() !== ''
        ? rawInst.animationName.trim()
        : 'idle';
    const persistedAnimationId =
      typeof rawInst.animationId === 'string'
        ? rawInst.animationId.trim()
        : undefined;
    let animationId = persistedAnimationId;
    if (animationId === undefined) {
      const matches = animations.filter(
        (animation) =>
          (animation.entity ?? 'entity').toLowerCase() ===
            entityId.toLowerCase() && animation.name === animationName,
      );
      animationId = matches.length === 1 ? (matches[0]?.id ?? '') : '';
    }
    const idMatches =
      animationId === ''
        ? []
        : animations.filter((animation) => animation.id === animationId);
    const resolvedAnimation = idMatches.length === 1 ? idMatches[0] : undefined;
    const x =
      typeof rawInst.x === 'number' && Number.isFinite(rawInst.x)
        ? rawInst.x
        : 0;
    const y =
      typeof rawInst.y === 'number' && Number.isFinite(rawInst.y)
        ? rawInst.y
        : 0;
    const visible =
      typeof rawInst.visible === 'boolean' ? rawInst.visible : true;
    const name =
      typeof rawInst.name === 'string' && rawInst.name.trim() !== ''
        ? rawInst.name.trim()
        : undefined;
    instances.push({
      id,
      animationId,
      entityId: resolvedAnimation?.entity ?? entityId,
      animationName: resolvedAnimation?.name ?? animationName,
      x,
      y,
      visible,
      ...(name ? { name } : {}),
    });
  }
  return { instances };
}

/**
 * Checks all referenced assets across a StudioProject and returns missing asset records
 * given an asset existence checker.
 */
export function findMissingAssets(
  project: StudioProject,
  assetExists: (path: string) => boolean,
): MissingAssetInfo[] {
  const missing: MissingAssetInfo[] = [];

  const check = (ref: ProjectAssetReference | null | undefined) => {
    if (!ref?.path) return;
    if (ref.dataUrl) return;
    if (!assetExists(ref.path)) {
      missing.push({
        name: ref.name ?? ref.path.split('/').pop() ?? ref.path,
        expectedPath: ref.path,
        message: `Asset "${ref.name ?? ref.path}" was not found at expected path "${ref.path}".`,
      });
    }
  };

  if (project.tileset?.asset) {
    check(project.tileset.asset);
  }

  if (project.playfield?.asset) {
    check(project.playfield.asset);
  }

  if (project.backgrounds?.maps) {
    for (const map of project.backgrounds.maps) {
      if (map.asset) {
        check(map.asset);
      }
    }
  }

  if (project.animation) {
    if (project.animation.destinationChr) {
      check(project.animation.destinationChr);
    }
    for (const anim of project.animation.animations) {
      if (anim.asset) {
        check(anim.asset);
      }
    }
  }

  return missing;
}

function parseBackgroundSettings(
  value: unknown,
): ProjectBackgroundSettingsConfig | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;

  const activeMapId =
    typeof raw.activeMapId === 'string' && raw.activeMapId.trim() !== ''
      ? raw.activeMapId.trim()
      : null;

  const rawMaps: readonly unknown[] = Array.isArray(raw.maps) ? raw.maps : [];
  const maps: BackgroundMapDefinition[] = [];

  for (let i = 0; i < rawMaps.length; i += 1) {
    const rawMap: unknown = rawMaps[i];
    if (typeof rawMap !== 'object' || rawMap === null) continue;
    const mapObj = rawMap as Record<string, unknown>;

    const id =
      typeof mapObj.id === 'string' && mapObj.id.trim() !== ''
        ? mapObj.id.trim()
        : `bg-map-${String(i + 1)}`;

    const name =
      typeof mapObj.name === 'string' && mapObj.name.trim() !== ''
        ? mapObj.name.trim()
        : `Background Map ${String(i + 1)}`;

    const widthTiles =
      typeof mapObj.widthTiles === 'number' && mapObj.widthTiles > 0
        ? mapObj.widthTiles
        : BACKGROUND_WIDTH_TILES;

    const heightTiles =
      typeof mapObj.heightTiles === 'number' && mapObj.heightTiles > 0
        ? mapObj.heightTiles
        : BACKGROUND_HEIGHT_TILES;

    const patternTable: BackgroundPatternTable =
      mapObj.patternTable === 1 ? 1 : 0;

    const asset = parseAssetReference(mapObj.asset, 'background-image', id);
    const rawAssetId =
      typeof mapObj.assetId === 'string' && mapObj.assetId.trim() !== ''
        ? mapObj.assetId.trim()
        : undefined;
    const assetId = rawAssetId
      ? normalizeProjectAssetId(rawAssetId, 'background-image')
      : (asset?.id ?? undefined);

    const cells = parseBackgroundMapCells(
      mapObj.cells,
      widthTiles * heightTiles,
      assetId,
    );
    const paletteAssignments = parseBackgroundPaletteAssignments(
      mapObj.paletteAssignments,
    );

    maps.push({
      id,
      name,
      widthTiles,
      heightTiles,
      patternTable,
      ...(assetId ? { assetId } : {}),
      ...(asset ? { asset } : {}),
      cells,
      paletteAssignments,
    });
  }

  return {
    activeMapId: activeMapId ?? maps[0]?.id ?? null,
    maps,
  };
}

function parseBackgroundMapCells(
  value: unknown,
  expectedLength = BACKGROUND_TILE_COUNT,
  fallbackAssetId?: ProjectAssetId,
): readonly (BackgroundMapCell | null)[] {
  if (!Array.isArray(value)) {
    return Array.from({ length: expectedLength }, () => null);
  }

  const rawCells: readonly unknown[] = value;
  const cells: (BackgroundMapCell | null)[] = [];
  for (let i = 0; i < expectedLength; i += 1) {
    const rawCell: unknown = rawCells[i];
    if (typeof rawCell !== 'object' || rawCell === null) {
      cells.push(null);
      continue;
    }
    const cellObj = rawCell as Record<string, unknown>;
    const tileX =
      typeof cellObj.tileX === 'number' && cellObj.tileX >= 0
        ? Math.floor(cellObj.tileX)
        : i % BACKGROUND_WIDTH_TILES;
    const tileY =
      typeof cellObj.tileY === 'number' && cellObj.tileY >= 0
        ? Math.floor(cellObj.tileY)
        : Math.floor(i / BACKGROUND_WIDTH_TILES);

    const rawKey =
      typeof cellObj.logicalKey === 'string' && cellObj.logicalKey.trim() !== ''
        ? cellObj.logicalKey.trim()
        : undefined;
    const logicalKey =
      rawKey ??
      createLogicalTileKey(fallbackAssetId ?? 'asset-bg', tileX, tileY);

    const sourceTileIndex =
      typeof cellObj.sourceTileIndex === 'number' &&
      cellObj.sourceTileIndex >= 0
        ? Math.floor(cellObj.sourceTileIndex)
        : undefined;

    cells.push({
      logicalKey,
      tileX,
      tileY,
      ...(sourceTileIndex !== undefined ? { sourceTileIndex } : {}),
    });
  }

  return Object.freeze(cells);
}

function parseBackgroundPaletteAssignments(value: unknown): readonly number[] {
  if (
    !Array.isArray(value) ||
    value.length !== BACKGROUND_PALETTE_ASSIGNMENT_COUNT
  ) {
    return Array.from({ length: BACKGROUND_PALETTE_ASSIGNMENT_COUNT }, () => 0);
  }
  const assignments = value.map((v) =>
    typeof v === 'number' ? Math.max(0, Math.min(3, Math.floor(v))) : 0,
  );
  return Object.freeze(assignments);
}
