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
  parseLogicalTileKey,
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
  createBackgroundMapFromPlayfield,
  createEmptyBackgroundMap,
} from './background-model';
import {
  PROJECT_GRAPHICS_PROFILE,
  createDefaultRenderContext,
  createDefaultProjectGraphicsConfiguration,
  createEmptyProjectBaseChr,
  createProjectBaseChr,
  validateProjectGraphicsConfiguration,
  type GraphicsPixelOverrides,
  type ProjectAssetSource,
  type ProjectBaseChr,
  type ProjectGraphicsAsset,
  type ProjectGraphicsConfiguration,
  type ProjectLogicalTileSource,
  type ProjectRenderContext,
} from './project-graphics';

export type { ProjectScenePreviewConfig, ScenePreviewInstance, ChrRegion };
export * from './asset-identity';
export * from './chr-asset-mapping';
export * from './asset-lifecycle';
export * from './metasprite-extraction';
export * from './chr-spritesheet-allocation';
export * from './background-model';
export * from './background-exporters';
export * from './project-graphics';
export * from './project-graphics-compiler';
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

export const CURRENT_PROJECT_FORMAT_VERSION = 2;
export const SUPPORTED_PROJECT_FORMAT_VERSIONS = [1, 2] as const;

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
  /** Canonical link to graphics.assets in formatVersion 2. */
  readonly assetId?: ProjectAssetId | null;
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
  /** Canonical link to graphics.assets in formatVersion 2. */
  readonly assetId?: ProjectAssetId | null;
  readonly asset: ProjectAssetReference | null;
  readonly paletteAssignments?: readonly number[];
  readonly pixelOverrides?: readonly number[];
}

export interface ProjectPlayfieldConfig {
  /** Canonical link to graphics.assets in formatVersion 2. */
  readonly assetId?: ProjectAssetId | null;
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

interface StudioProjectData {
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

const MIGRATED_PLAYFIELD_MAP_ID = 'background-playfield-default';

function migratePlayfieldScreen(
  project: StudioProjectData,
  updateActiveMap = false,
): StudioProjectData {
  const playfield = project.playfield;
  const hasSource = playfield?.asset != null || playfield?.assetId != null;
  const hasScreenData =
    playfield !== undefined &&
    (hasSource || (!updateActiveMap && playfield.collisionCells !== undefined));
  if (!hasScreenData) return project;

  const existingMaps = project.backgrounds?.maps ?? [];
  const activeMap = updateActiveMap
    ? existingMaps.find((map) => map.migratedFromPlayfield === true)
    : undefined;
  let mapId = MIGRATED_PLAYFIELD_MAP_ID;
  let suffix = 2;
  while (existingMaps.some((map) => map.id === mapId)) {
    mapId = `${MIGRATED_PLAYFIELD_MAP_ID}-${String(suffix)}`;
    suffix += 1;
  }
  const assetId = hasSource
    ? normalizeProjectAssetId(
        playfield.assetId ?? playfield.asset?.id,
        'playfield-image',
      )
    : undefined;
  const migratedMap: BackgroundMapDefinition = {
    ...(assetId === undefined
      ? {
          ...createEmptyBackgroundMap({
            id: activeMap?.id ?? mapId,
            name:
              activeMap?.name ?? playfield.asset?.name ?? 'Migrated Playfield',
            patternTable:
              activeMap?.patternTable ??
              (project.animation?.destinationPatternTable === 1 ? 1 : 0),
          }),
          ...(playfield.collisionCells !== undefined
            ? {
                collision: {
                  cells: [...playfield.collisionCells],
                  ...(playfield.activeCollisionType !== undefined
                    ? { activeType: playfield.activeCollisionType }
                    : {}),
                },
              }
            : {}),
          ...(playfield.randomPlayfieldFeatures !== undefined
            ? {
                procedural: {
                  features: [...playfield.randomPlayfieldFeatures],
                },
              }
            : {}),
        }
      : createBackgroundMapFromPlayfield({
          id: activeMap?.id ?? mapId,
          name:
            activeMap?.name ?? playfield.asset?.name ?? 'Migrated Playfield',
          assetId,
          patternTable:
            activeMap?.patternTable ??
            (project.animation?.destinationPatternTable === 1 ? 1 : 0),
          paletteAssignments: playfield.paletteAssignments,
          collisionCells: playfield.collisionCells,
          activeCollisionType: playfield.activeCollisionType,
          randomPlayfieldFeatures: playfield.randomPlayfieldFeatures,
        })),
    migratedFromPlayfield: true,
  };

  return {
    ...project,
    backgrounds: {
      activeMapId:
        project.mode === 'playfield'
          ? migratedMap.id
          : (project.backgrounds?.activeMapId ?? migratedMap.id),
      maps:
        activeMap === undefined
          ? [...existingMaps, migratedMap]
          : existingMaps.map((map) =>
              map.id === activeMap.id ? migratedMap : map,
            ),
    },
  };
}

/** Current canonical project. Version 1 exists only as deserializer input. */
export interface StudioProject extends StudioProjectData {
  readonly formatVersion: 2;
  readonly graphics: ProjectGraphicsConfiguration;
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
    formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
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
      assetId: null,
      asset: null,
    },
    playfield: {
      assetId: null,
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
      patternTable: 1,
      destinationPatternTable: 0,
      destinationChr: null,
      animations: [
        {
          id: 'anim-default',
          name: 'idle',
          entity: 'entity',
          assetId: null,
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
    graphics: createDefaultProjectGraphicsConfiguration(['anim-default']),
  };
}

/**
 * Serializes a StudioProject into formatted JSON string.
 */
export function serializeProject(project: StudioProject): string {
  const canonicalProject = stripProjectGraphicsCompatibilityPayloads(
    canonicalizeProjectGraphics(
      migratePlayfieldScreen(project, true) as StudioProject,
    ),
  );
  const paletteSet = resolveActiveBackgroundPaletteSet(
    canonicalProject.palette.palettes,
    canonicalProject.palette.activeBackgroundSlots,
    canonicalProject.palette.universalBackgroundColor,
    canonicalProject.palette.paletteSet,
  );
  const {
    graphics,
    playfield: playfieldCompatibilityProjection,
    ...projectWithoutGraphics
  } = canonicalProject;
  void playfieldCompatibilityProjection;
  const persistableProject: StudioProject = {
    ...projectWithoutGraphics,
    formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
    palette: {
      ...canonicalProject.palette,
      paletteSet,
      activeSpritePaletteSlots: canonicalProject.palette.activeSpriteSlots,
    },
    graphics,
  };
  return JSON.stringify(persistableProject, null, 2);
}

function stripProjectGraphicsCompatibilityPayloads(
  project: StudioProject,
): StudioProject {
  const assetIds = new Set(project.graphics.assets.map((asset) => asset.id));
  const stripTilesetPayload = (
    config: ProjectTilesetConfig,
  ): ProjectTilesetConfig => {
    const {
      assetId = null,
      asset,
      paletteAssignments,
      pixelOverrides,
      ...rest
    } = config;
    const linked = assetId !== null && assetIds.has(assetId);
    return {
      assetId,
      asset: linked ? null : asset,
      ...rest,
      ...(linked ? {} : { paletteAssignments, pixelOverrides }),
    };
  };
  const stripPlayfieldPayload = (
    config: ProjectPlayfieldConfig,
  ): ProjectPlayfieldConfig => {
    const {
      assetId = null,
      asset,
      paletteAssignments,
      pixelOverrides,
      ...rest
    } = config;
    const linked = assetId !== null && assetIds.has(assetId);
    return {
      assetId,
      asset: linked ? null : asset,
      ...rest,
      ...(linked ? {} : { paletteAssignments, pixelOverrides }),
    };
  };

  return {
    ...project,
    ...(project.tileset
      ? { tileset: stripTilesetPayload(project.tileset) }
      : {}),
    ...(project.playfield
      ? { playfield: stripPlayfieldPayload(project.playfield) }
      : {}),
    ...(project.backgrounds
      ? {
          backgrounds: {
            ...project.backgrounds,
            maps: project.backgrounds.maps.map((map) => ({
              ...map,
              asset: null,
            })),
          },
        }
      : {}),
    ...(project.animation
      ? {
          animation: {
            ...project.animation,
            destinationChr: null,
            animations: project.animation.animations.map((animation) => {
              const linked =
                animation.assetId !== null &&
                animation.assetId !== undefined &&
                assetIds.has(animation.assetId);
              return linked
                ? {
                    ...animation,
                    asset: null,
                    quantizationMode: undefined,
                    ditheringMode: undefined,
                    pixelOverrides: undefined,
                  }
                : animation;
            }),
          },
        }
      : {}),
  };
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
    const asset = parseAssetReference(rawTileset.asset, 'tileset-image');
    tileset = {
      assetId: parseConsumerAssetId(rawTileset.assetId, asset),
      asset,
      paletteAssignments: parseNumberArray(rawTileset.paletteAssignments),
      pixelOverrides: parseNumberArray(rawTileset.pixelOverrides),
    };
  }

  let playfield: ProjectPlayfieldConfig | undefined;
  if (typeof raw.playfield === 'object' && raw.playfield !== null) {
    const rawPlayfield = raw.playfield as Record<string, unknown>;
    const asset = parseAssetReference(rawPlayfield.asset, 'playfield-image');
    playfield = {
      assetId: parseConsumerAssetId(rawPlayfield.assetId, asset),
      asset,
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
      const asset = parseAssetReference(rawItem.asset, 'spritesheet', animId);
      const pixelOverrides = parseTilePixelOverrides(rawItem.pixelOverrides);

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
        assetId: parseConsumerAssetId(rawItem.assetId, asset),
        asset,
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
        ...(typeof rawItem.flipH === 'boolean' ? { flipH: rawItem.flipH } : {}),
        ...(typeof rawItem.flipV === 'boolean' ? { flipV: rawItem.flipV } : {}),
        defaultDuration:
          typeof rawItem.defaultDuration === 'number' &&
          rawItem.defaultDuration > 0
            ? rawItem.defaultDuration
            : 12,
        ...(pixelOverrides !== undefined ? { pixelOverrides } : {}),
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

  const parsedProjectData: StudioProjectData = {
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
  const projectData = migratePlayfieldScreen(parsedProjectData);

  let graphics: ProjectGraphicsConfiguration;
  try {
    const parsedGraphics =
      raw.formatVersion === CURRENT_PROJECT_FORMAT_VERSION
        ? parseProjectGraphicsConfiguration(raw.graphics)
        : migrateLegacyProjectGraphics(projectData);
    graphics = ensureBackgroundRenderContexts(
      parsedGraphics,
      projectData.backgrounds?.maps ?? [],
      projectData.animation?.patternTable === 0 ? 0 : 1,
      projectData.animation?.animations.map((animation) => animation.id) ?? [],
    );
  } catch (error: unknown) {
    return {
      success: false,
      error: {
        code: 'invalid-project-schema',
        message:
          error instanceof Error
            ? error.message
            : 'Project graphics configuration is invalid.',
      },
    };
  }

  const project: StudioProject = {
    formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
    ...projectData,
    graphics,
  };
  const referenceErrors = validateProjectGraphicsReferences(
    projectData,
    graphics,
  );
  if (referenceErrors.length > 0) {
    return {
      success: false,
      error: {
        code: 'invalid-project-schema',
        message: referenceErrors.join(' '),
      },
    };
  }

  return {
    success: true,
    project: projectGraphicsCompatibilityProjection(project),
  };
}

function ensureBackgroundRenderContexts(
  graphics: ProjectGraphicsConfiguration,
  maps: readonly BackgroundMapDefinition[],
  spritePatternTable: 0 | 1,
  animationIds: readonly string[],
): ProjectGraphicsConfiguration {
  const referencedMapIds = new Set(
    graphics.renderContexts.flatMap((context) => context.mapIds),
  );
  const missingContexts = maps
    .filter((map) => !referencedMapIds.has(map.id))
    .map((map) => ({
      id: `render-context-${map.id}`,
      name: `${map.name} Render Context`,
      backgroundPatternTable: map.patternTable,
      spriteMode: '8x8' as const,
      spritePatternTable,
      mapIds: [map.id],
      animationIds: [...animationIds],
    }));
  return missingContexts.length === 0
    ? graphics
    : {
        ...graphics,
        renderContexts: [...graphics.renderContexts, ...missingContexts],
      };
}

function validateProjectGraphicsReferences(
  project: StudioProjectData,
  graphics: ProjectGraphicsConfiguration,
): readonly string[] {
  const errors: string[] = [];
  const assetIds = new Set(graphics.assets.map((asset) => asset.id));
  const mapIds = new Set(
    (project.backgrounds?.maps ?? []).map((map) => map.id),
  );
  const animationIds = new Set(
    (project.animation?.animations ?? []).map((animation) => animation.id),
  );
  const requireAsset = (id: string | undefined, owner: string): void => {
    if (id !== undefined && !assetIds.has(id)) {
      errors.push(`${owner} references missing graphics asset "${id}".`);
    }
  };
  requireAsset(project.tileset?.assetId ?? undefined, 'Tileset');
  requireAsset(project.playfield?.assetId ?? undefined, 'Playfield');
  for (const map of project.backgrounds?.maps ?? []) {
    requireAsset(map.assetId ?? map.asset?.id, `Background map "${map.id}"`);
    for (const cell of map.cells) {
      if (cell === null) continue;
      const key = parseLogicalTileKey(cell.logicalKey);
      if (key !== null) requireAsset(key.assetId, `Background map "${map.id}"`);
    }
  }
  for (const animation of project.animation?.animations ?? []) {
    requireAsset(animation.assetId ?? undefined, `Animation "${animation.id}"`);
  }
  for (const context of graphics.renderContexts) {
    for (const mapId of context.mapIds) {
      if (!mapIds.has(mapId)) {
        errors.push(
          `Render context "${context.id}" references missing map "${mapId}".`,
        );
      }
    }
    for (const animationId of context.animationIds) {
      if (!animationIds.has(animationId)) {
        errors.push(
          `Render context "${context.id}" references missing animation "${animationId}".`,
        );
      }
    }
  }
  return errors;
}

function sourceFromAssetReference(
  reference: ProjectAssetReference,
): ProjectAssetSource {
  return {
    path: reference.path,
    ...(reference.name !== undefined ? { name: reference.name } : {}),
    ...(reference.sourceKind !== undefined
      ? { sourceKind: reference.sourceKind }
      : {}),
    ...(reference.dataUrl !== undefined ? { dataUrl: reference.dataUrl } : {}),
  };
}

function legacyLogicalTileSource(
  reference: ProjectAssetReference | null,
  quantization: QuantizationSettings,
  paletteBank: 'background' | 'sprite',
  paletteAssignments?: readonly number[],
  pixelOverrides?: GraphicsPixelOverrides,
): ProjectLogicalTileSource {
  const sourceKind = reference?.sourceKind;
  const decodedChr = sourceKind === 'chr' || sourceKind === 'nes';
  return {
    decoding: decodedChr ? 'nes-2bpp' : 'png-indexed',
    quantization: decodedChr ? null : quantization,
    paletteBank: decodedChr ? null : paletteBank,
    ...(paletteAssignments !== undefined ? { paletteAssignments } : {}),
    ...(pixelOverrides !== undefined ? { pixelOverrides } : {}),
  };
}

function dataUrlByteLength(dataUrl: string | undefined): number | null {
  if (dataUrl === undefined) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !/;base64$/i.test(dataUrl.slice(0, comma))) return null;
  const payload = dataUrl.slice(comma + 1).replace(/\s/g, '');
  if (payload.length === 0) return 0;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function migrateLegacyProjectGraphics(
  project: StudioProjectData,
): ProjectGraphicsConfiguration {
  const assets = new Map<ProjectAssetId, ProjectGraphicsAsset>();
  const register = (asset: ProjectGraphicsAsset): void => {
    const existing = assets.get(asset.id);
    if (existing === undefined) {
      assets.set(asset.id, asset);
      return;
    }
    if (JSON.stringify(existing) !== JSON.stringify(asset)) {
      throw new Error(
        `Legacy project uses asset ID "${asset.id}" for conflicting graphics definitions.`,
      );
    }
  };
  const registerReference = (
    reference: ProjectAssetReference | null | undefined,
    kind: Exclude<ProjectAssetKind, 'base-chr'>,
    name: string,
    logicalTiles: ProjectLogicalTileSource,
    secondaryKey?: string,
    explicitId?: ProjectAssetId | null,
  ): ProjectAssetId | null => {
    if (reference === null || reference === undefined) return null;
    if (explicitId && reference.id && explicitId !== reference.id) {
      throw new Error(`${name} has conflicting assetId and asset.id values.`);
    }
    const id = normalizeProjectAssetId(
      explicitId ?? reference.id,
      kind,
      secondaryKey,
    );
    register({
      id,
      kind,
      name: reference.name ?? name,
      source: sourceFromAssetReference(reference),
      logicalTiles,
    });
    return id;
  };

  registerReference(
    project.tileset?.asset,
    'tileset-image',
    'Tileset Image',
    legacyLogicalTileSource(
      project.tileset?.asset ?? null,
      project.settings.quantization,
      'background',
      project.tileset?.paletteAssignments,
      project.tileset?.pixelOverrides
        ? {
            kind: 'indexed-image',
            values: project.tileset.pixelOverrides,
          }
        : undefined,
    ),
    undefined,
    project.tileset?.assetId,
  );
  registerReference(
    project.playfield?.asset,
    'playfield-image',
    'Playfield Image',
    legacyLogicalTileSource(
      project.playfield?.asset ?? null,
      project.settings.quantization,
      'background',
      project.playfield?.paletteAssignments,
      project.playfield?.pixelOverrides
        ? {
            kind: 'indexed-image',
            values: project.playfield.pixelOverrides,
          }
        : undefined,
    ),
    undefined,
    project.playfield?.assetId,
  );

  for (const map of project.backgrounds?.maps ?? []) {
    if (map.assetId && map.asset?.id && map.assetId !== map.asset.id) {
      throw new Error(
        `Background map "${map.id}" has conflicting assetId and asset.id values.`,
      );
    }
    if (map.asset) {
      registerReference(
        map.asset,
        'background-image',
        map.name,
        legacyLogicalTileSource(
          map.asset,
          project.settings.quantization,
          'background',
        ),
        map.id,
        map.assetId,
      );
    } else if (map.assetId && !assets.has(map.assetId)) {
      register({
        id: map.assetId,
        kind: 'background-image',
        name: map.name,
        source: null,
        logicalTiles: legacyLogicalTileSource(
          null,
          project.settings.quantization,
          'background',
        ),
      });
    }
  }

  for (const animation of project.animation?.animations ?? []) {
    const quantization = normalizeQuantizationSettings({
      ...project.settings.quantization,
      quantizationMode:
        animation.quantizationMode ?? project.animation?.quantizationMode,
      ditheringMode:
        animation.ditheringMode ?? project.animation?.ditheringMode,
    });
    registerReference(
      animation.asset,
      'spritesheet',
      animation.name,
      legacyLogicalTileSource(
        animation.asset,
        quantization,
        'sprite',
        undefined,
        animation.pixelOverrides
          ? { kind: 'sparse-tiles', values: animation.pixelOverrides }
          : undefined,
      ),
      animation.id,
      animation.assetId,
    );
  }

  for (const map of project.backgrounds?.maps ?? []) {
    for (const cell of map.cells) {
      if (cell === null) continue;
      const parsed = parseLogicalTileKey(cell.logicalKey);
      if (parsed === null) {
        throw new Error(
          `Background map "${map.id}" contains invalid LogicalTileKey "${cell.logicalKey}".`,
        );
      }
      if (!assets.has(parsed.assetId)) {
        register({
          id: parsed.assetId,
          kind: 'background-image',
          name: parsed.assetId,
          source: null,
          logicalTiles: legacyLogicalTileSource(
            null,
            project.settings.quantization,
            'background',
          ),
        });
      }
    }
  }

  const legacyBase = project.animation?.destinationChr ?? null;
  const embeddedBaseLength = dataUrlByteLength(legacyBase?.dataUrl);
  const baseChr = legacyBase
    ? createProjectBaseChr({
        assetId: normalizeProjectAssetId(legacyBase.id, 'base-chr'),
        source: sourceFromAssetReference(legacyBase),
        byteLength:
          embeddedBaseLength !== null &&
          embeddedBaseLength <= 8192 &&
          embeddedBaseLength % 16 === 0
            ? embeddedBaseLength
            : null,
        shortFilePatternTable:
          project.animation?.destinationPatternTable === 1 ? 1 : 0,
      })
    : createEmptyProjectBaseChr();

  const animationIds = (project.animation?.animations ?? []).map(
    (animation) => animation.id,
  );
  if (new Set(animationIds).size !== animationIds.length) {
    throw new Error('Legacy project contains duplicate animation IDs.');
  }
  const maps = project.backgrounds?.maps ?? [];
  const mapIds = maps.map((map) => map.id);
  if (new Set(mapIds).size !== mapIds.length) {
    throw new Error('Legacy project contains duplicate Background map IDs.');
  }
  const spritePatternTable = project.animation?.patternTable === 1 ? 1 : 0;
  const renderContexts: ProjectRenderContext[] =
    maps.length > 0
      ? maps.map((map) => ({
          id: `render-context-${map.id}`,
          name: `${map.name} Render Context`,
          backgroundPatternTable: map.patternTable,
          spriteMode: '8x8',
          spritePatternTable,
          mapIds: [map.id],
          animationIds: [...animationIds],
        }))
      : [
          {
            ...createDefaultRenderContext(animationIds),
            spritePatternTable,
          },
        ];

  const graphics: ProjectGraphicsConfiguration = {
    profile: PROJECT_GRAPHICS_PROFILE,
    assets: [...assets.values()],
    baseChr,
    renderContexts,
  };
  const errors = validateProjectGraphicsConfiguration(graphics);
  if (errors.length > 0) throw new Error(errors.join(' '));
  return graphics;
}

function referenceFromGraphicsAsset(
  asset: ProjectGraphicsAsset | undefined,
): ProjectAssetReference | null {
  if (asset?.source === null || asset === undefined) return null;
  return { id: asset.id, ...asset.source };
}

function projectGraphicsCompatibilityProjection(
  project: StudioProject,
): StudioProject {
  const assets = new Map(
    project.graphics.assets.map((asset) => [asset.id, asset] as const),
  );
  const resolveLinkedAsset = (
    reference: ProjectAssetReference | null | undefined,
    explicitId?: string,
    fallbackKind?: Exclude<ProjectAssetKind, 'base-chr'>,
    secondaryKey?: string,
  ): ProjectGraphicsAsset | undefined => {
    const rawId = explicitId ?? reference?.id;
    const id =
      rawId === undefined && fallbackKind !== undefined
        ? normalizeProjectAssetId(undefined, fallbackKind, secondaryKey)
        : rawId;
    return id === undefined ? undefined : assets.get(id);
  };
  const indexedOverrides = (
    asset: ProjectGraphicsAsset | undefined,
  ): readonly number[] | undefined =>
    asset?.logicalTiles.pixelOverrides?.kind === 'indexed-image'
      ? asset.logicalTiles.pixelOverrides.values
      : undefined;

  const tilesetAsset = resolveLinkedAsset(
    project.tileset?.asset,
    project.tileset?.assetId ?? undefined,
    'tileset-image',
  );
  const migratedPlayfieldMap = project.backgrounds?.maps.find(
    (map) => map.migratedFromPlayfield === true,
  );
  const projectedPlayfield =
    project.playfield ??
    (migratedPlayfieldMap !== undefined
      ? {
          assetId: migratedPlayfieldMap.assetId ?? null,
          asset: migratedPlayfieldMap.asset ?? null,
          paletteAssignments: migratedPlayfieldMap.paletteAssignments,
          collisionCells: migratedPlayfieldMap.collision?.cells,
          activeCollisionType: migratedPlayfieldMap.collision?.activeType,
          randomPlayfieldFeatures: migratedPlayfieldMap.procedural?.features,
        }
      : undefined);
  const playfieldAsset = resolveLinkedAsset(
    projectedPlayfield?.asset,
    projectedPlayfield?.assetId ?? undefined,
    'playfield-image',
  );
  const contextsByMap = new Map<string, ProjectRenderContext>();
  for (const context of project.graphics.renderContexts) {
    for (const mapId of context.mapIds) {
      if (!contextsByMap.has(mapId)) contextsByMap.set(mapId, context);
    }
  }
  const defaultContext = project.graphics.renderContexts[0];

  const animation = project.animation
    ? {
        ...project.animation,
        patternTable:
          defaultContext?.spritePatternTable ?? project.animation.patternTable,
        destinationPatternTable: project.graphics.baseChr.shortFilePatternTable,
        destinationChr:
          project.graphics.baseChr.assetId === null ||
          project.graphics.baseChr.source === null
            ? null
            : {
                id: project.graphics.baseChr.assetId,
                ...project.graphics.baseChr.source,
              },
        animations: project.animation.animations.map((animationItem) => {
          const asset = resolveLinkedAsset(
            animationItem.asset,
            animationItem.assetId ?? undefined,
            'spritesheet',
            animationItem.id,
          );
          const sparseOverrides =
            asset?.logicalTiles.pixelOverrides?.kind === 'sparse-tiles'
              ? asset.logicalTiles.pixelOverrides.values
              : undefined;
          return {
            ...animationItem,
            ...(asset !== undefined
              ? {
                  assetId: asset.id,
                  asset: referenceFromGraphicsAsset(asset),
                }
              : {}),
            ...(asset?.logicalTiles.quantization !== null &&
            asset?.logicalTiles.quantization !== undefined
              ? {
                  quantizationMode:
                    asset.logicalTiles.quantization.quantizationMode,
                  ditheringMode: asset.logicalTiles.quantization.ditheringMode,
                }
              : {}),
            ...(sparseOverrides !== undefined
              ? { pixelOverrides: sparseOverrides }
              : {}),
          };
        }),
      }
    : undefined;

  return {
    ...project,
    ...(project.tileset
      ? {
          tileset: {
            ...project.tileset,
            ...(tilesetAsset !== undefined
              ? {
                  assetId: tilesetAsset.id,
                  asset: referenceFromGraphicsAsset(tilesetAsset),
                }
              : {}),
            ...(tilesetAsset?.logicalTiles.paletteAssignments !== undefined
              ? {
                  paletteAssignments:
                    tilesetAsset.logicalTiles.paletteAssignments,
                }
              : {}),
            ...(indexedOverrides(tilesetAsset) !== undefined
              ? { pixelOverrides: indexedOverrides(tilesetAsset) }
              : {}),
          },
        }
      : {}),
    ...(projectedPlayfield
      ? {
          playfield: {
            ...projectedPlayfield,
            ...(playfieldAsset !== undefined
              ? {
                  assetId: playfieldAsset.id,
                  asset: referenceFromGraphicsAsset(playfieldAsset),
                }
              : {}),
            ...(playfieldAsset?.logicalTiles.paletteAssignments !== undefined
              ? {
                  paletteAssignments:
                    playfieldAsset.logicalTiles.paletteAssignments,
                }
              : {}),
            ...(indexedOverrides(playfieldAsset) !== undefined
              ? { pixelOverrides: indexedOverrides(playfieldAsset) }
              : {}),
          },
        }
      : {}),
    ...(project.backgrounds
      ? {
          backgrounds: {
            ...project.backgrounds,
            maps: project.backgrounds.maps.map((map) => {
              const asset = resolveLinkedAsset(
                map.asset,
                map.assetId,
                'background-image',
                map.id,
              );
              return {
                ...map,
                patternTable:
                  contextsByMap.get(map.id)?.backgroundPatternTable ??
                  map.patternTable,
                ...(asset === undefined
                  ? {}
                  : {
                      assetId: asset.id,
                      asset: referenceFromGraphicsAsset(asset),
                    }),
              };
            }),
          },
        }
      : {}),
    ...(animation !== undefined ? { animation } : {}),
  };
}

/**
 * Canonical runtime-to-persistence adapter for legacy editors.
 * Version 2 parsing never uses this direction; it projects aliases from graphics.
 */
export function canonicalizeProjectGraphics(
  project: StudioProject,
): StudioProject {
  const projectData: StudioProjectData = project;
  const existing = project.graphics;
  const derived = migrateLegacyProjectGraphics(projectData);
  const linkedIds = new Set(derived.assets.map((asset) => asset.id));
  const assets = [
    ...derived.assets,
    ...existing.assets.filter((asset) => !linkedIds.has(asset.id)),
  ];
  const legacyBaseReference = project.animation?.destinationChr ?? null;
  const existingBaseReference =
    existing.baseChr.assetId === null || existing.baseChr.source === null
      ? null
      : {
          id: existing.baseChr.assetId,
          ...existing.baseChr.source,
        };
  const baseChrUnchanged =
    JSON.stringify(legacyBaseReference) ===
      JSON.stringify(existingBaseReference) &&
    (project.animation?.destinationPatternTable ?? 0) ===
      existing.baseChr.shortFilePatternTable;

  const existingContexts = existing.renderContexts;
  const derivedByMap = new Map(
    derived.renderContexts.flatMap((context) =>
      context.mapIds.map((mapId) => [mapId, context] as const),
    ),
  );
  let renderContexts: ProjectRenderContext[] = existingContexts.map(
    (context) => ({
      ...context,
      mapIds: context.mapIds.filter((mapId) =>
        (project.backgrounds?.maps ?? []).some((map) => map.id === mapId),
      ),
      animationIds: context.animationIds.filter((animationId) =>
        (project.animation?.animations ?? []).some(
          (animation) => animation.id === animationId,
        ),
      ),
    }),
  );
  for (const map of project.backgrounds?.maps ?? []) {
    if (renderContexts.some((context) => context.mapIds.includes(map.id))) {
      const projectedPatternTable = existingContexts.find((context) =>
        context.mapIds.includes(map.id),
      )?.backgroundPatternTable;
      if (
        projectedPatternTable !== undefined &&
        projectedPatternTable !== map.patternTable
      ) {
        renderContexts = renderContexts.map((context) =>
          context.mapIds.includes(map.id)
            ? { ...context, backgroundPatternTable: map.patternTable }
            : context,
        );
      }
    } else {
      const migratedContext = derivedByMap.get(map.id);
      if (migratedContext !== undefined) renderContexts.push(migratedContext);
    }
  }
  const projectedSpritePatternTable = existingContexts[0]?.spritePatternTable;
  if (
    project.animation &&
    projectedSpritePatternTable !== undefined &&
    projectedSpritePatternTable !== project.animation.patternTable
  ) {
    renderContexts = renderContexts.map((context) => ({
      ...context,
      spritePatternTable: project.animation?.patternTable ?? 1,
    }));
  }
  if (renderContexts.length === 0) renderContexts = [...derived.renderContexts];

  const canonical: StudioProject = {
    ...project,
    formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
    graphics: {
      profile: existing.profile,
      assets,
      baseChr: baseChrUnchanged ? existing.baseChr : derived.baseChr,
      renderContexts,
    },
  };
  const errors = [...validateProjectGraphicsConfiguration(canonical.graphics)];
  errors.push(
    ...validateProjectGraphicsReferences(projectData, canonical.graphics),
  );
  if (errors.length > 0) throw new Error(errors.join(' '));
  return projectGraphicsCompatibilityProjection(canonical);
}

function parseProjectAssetSource(value: unknown): ProjectAssetSource | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('graphics asset source must be an object or null.');
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.path !== 'string') {
    throw new Error('graphics asset source must contain a path.');
  }
  if ('id' in raw) {
    throw new Error(
      'graphics asset source must not contain a second asset ID.',
    );
  }
  return {
    path: normalizePath(raw.path),
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(raw.sourceKind === 'png' ||
    raw.sourceKind === 'chr' ||
    raw.sourceKind === 'nes'
      ? { sourceKind: raw.sourceKind }
      : {}),
    ...(typeof raw.dataUrl === 'string' ? { dataUrl: raw.dataUrl } : {}),
  };
}

function parseProjectGraphicsConfiguration(
  value: unknown,
): ProjectGraphicsConfiguration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('formatVersion 2 requires a graphics configuration.');
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.profile !== 'object' ||
    raw.profile === null ||
    Array.isArray(raw.profile)
  ) {
    throw new Error('graphics.profile must identify the supported profile.');
  }
  const profile = raw.profile as Record<string, unknown>;
  if (
    profile.mapper !== PROJECT_GRAPHICS_PROFILE.mapper ||
    profile.chrMemory !== PROJECT_GRAPHICS_PROFILE.chrMemory ||
    profile.spriteMode !== PROJECT_GRAPHICS_PROFILE.spriteMode ||
    profile.patternTableMode !== PROJECT_GRAPHICS_PROFILE.patternTableMode
  ) {
    throw new Error(
      'graphics.profile is not the supported NROM static-CHR profile.',
    );
  }
  const rawAssets = Array.isArray(raw.assets) ? raw.assets : null;
  const rawContexts = Array.isArray(raw.renderContexts)
    ? raw.renderContexts
    : null;
  if (rawAssets === null || rawContexts === null) {
    throw new Error('graphics assets and renderContexts must be arrays.');
  }

  const assets: ProjectGraphicsAsset[] = rawAssets.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('graphics asset entries must be objects.');
    }
    const asset = item as Record<string, unknown>;
    if (
      typeof asset.id !== 'string' ||
      asset.id.trim() === '' ||
      typeof asset.name !== 'string' ||
      asset.name.trim() === '' ||
      (asset.kind !== 'spritesheet' &&
        asset.kind !== 'tileset-image' &&
        asset.kind !== 'playfield-image' &&
        asset.kind !== 'background-image')
    ) {
      throw new Error('graphics asset identity or kind is invalid.');
    }
    if (
      typeof asset.logicalTiles !== 'object' ||
      asset.logicalTiles === null ||
      Array.isArray(asset.logicalTiles)
    ) {
      throw new Error(
        `Graphics asset "${asset.id}" lacks logical tile inputs.`,
      );
    }
    const rawTiles = asset.logicalTiles as Record<string, unknown>;
    if (
      rawTiles.decoding !== 'png-indexed' &&
      rawTiles.decoding !== 'nes-2bpp'
    ) {
      throw new Error(`Graphics asset "${asset.id}" has invalid decoding.`);
    }
    const pixelOverrides = parseGraphicsPixelOverrides(rawTiles.pixelOverrides);
    const paletteAssignments = parseNumberArray(rawTiles.paletteAssignments);
    const logicalTiles: ProjectLogicalTileSource = {
      decoding: rawTiles.decoding,
      quantization:
        rawTiles.quantization === null
          ? null
          : normalizeQuantizationSettings(rawTiles.quantization),
      paletteBank:
        rawTiles.paletteBank === 'background' ||
        rawTiles.paletteBank === 'sprite'
          ? rawTiles.paletteBank
          : null,
      ...(paletteAssignments !== undefined ? { paletteAssignments } : {}),
      ...(pixelOverrides !== undefined ? { pixelOverrides } : {}),
    };
    return {
      id: asset.id.trim(),
      kind: asset.kind,
      name: asset.name.trim(),
      source: parseProjectAssetSource(asset.source),
      logicalTiles,
    };
  });

  if (
    typeof raw.baseChr !== 'object' ||
    raw.baseChr === null ||
    Array.isArray(raw.baseChr)
  ) {
    throw new Error('graphics.baseChr must be an object.');
  }
  const rawBase = raw.baseChr as Record<string, unknown>;
  const rawRanges = Array.isArray(rawBase.slotPolicies)
    ? rawBase.slotPolicies
    : [];
  if (
    rawBase.assetId !== null &&
    (typeof rawBase.assetId !== 'string' || rawBase.assetId.trim() === '')
  ) {
    throw new Error('graphics.baseChr.assetId must be a string or null.');
  }
  if (
    rawBase.byteLength !== null &&
    (typeof rawBase.byteLength !== 'number' ||
      !Number.isInteger(rawBase.byteLength) ||
      rawBase.byteLength < 0 ||
      rawBase.byteLength > 8192 ||
      rawBase.byteLength % 16 !== 0)
  ) {
    throw new Error('graphics.baseChr.byteLength is invalid.');
  }
  if (
    rawBase.shortFilePatternTable !== 0 &&
    rawBase.shortFilePatternTable !== 1
  ) {
    throw new Error('graphics.baseChr.shortFilePatternTable must be 0 or 1.');
  }
  const baseChr: ProjectBaseChr = {
    assetId:
      typeof rawBase.assetId === 'string' && rawBase.assetId.trim() !== ''
        ? rawBase.assetId.trim()
        : null,
    source: parseProjectAssetSource(rawBase.source),
    byteLength:
      rawBase.byteLength === null
        ? null
        : typeof rawBase.byteLength === 'number'
          ? rawBase.byteLength
          : Number.NaN,
    shortFilePatternTable: rawBase.shortFilePatternTable === 1 ? 1 : 0,
    slotPolicies: rawRanges.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error('Base CHR slot policy entries must be objects.');
      }
      const range = item as Record<string, unknown>;
      if (
        (range.occupancy !== 'available' &&
          range.occupancy !== 'occupied' &&
          range.occupancy !== 'unknown') ||
        (range.writability !== 'writable' && range.writability !== 'locked') ||
        (range.provenance !== 'none' &&
          range.provenance !== 'imported-base-chr' &&
          range.provenance !== 'pending-source')
      ) {
        throw new Error('Base CHR slot policy semantics are invalid.');
      }
      return {
        startSlot:
          typeof range.startSlot === 'number' ? range.startSlot : Number.NaN,
        endSlot: typeof range.endSlot === 'number' ? range.endSlot : Number.NaN,
        occupancy: range.occupancy,
        writability: range.writability,
        ownerAssetId:
          typeof range.ownerAssetId === 'string' &&
          range.ownerAssetId.trim() !== ''
            ? range.ownerAssetId.trim()
            : null,
        provenance: range.provenance,
      };
    }),
  };

  const renderContexts: ProjectRenderContext[] = rawContexts.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('Render context entries must be objects.');
    }
    const context = item as Record<string, unknown>;
    if (
      typeof context.id !== 'string' ||
      context.id.trim() === '' ||
      typeof context.name !== 'string' ||
      context.name.trim() === '' ||
      !Array.isArray(context.mapIds) ||
      !Array.isArray(context.animationIds)
    ) {
      throw new Error('Render context identity or consumers are invalid.');
    }
    if (
      (context.backgroundPatternTable !== 0 &&
        context.backgroundPatternTable !== 1) ||
      (context.spritePatternTable !== 0 && context.spritePatternTable !== 1) ||
      context.spriteMode !== '8x8'
    ) {
      throw new Error(
        'Render context Pattern Tables or sprite mode are invalid.',
      );
    }
    return {
      id: context.id.trim(),
      name: context.name.trim(),
      backgroundPatternTable: context.backgroundPatternTable === 1 ? 1 : 0,
      spriteMode: '8x8',
      spritePatternTable: context.spritePatternTable === 1 ? 1 : 0,
      mapIds: context.mapIds.filter(
        (entry): entry is string => typeof entry === 'string',
      ),
      animationIds: context.animationIds.filter(
        (entry): entry is string => typeof entry === 'string',
      ),
    };
  });
  const graphics: ProjectGraphicsConfiguration = {
    profile: PROJECT_GRAPHICS_PROFILE,
    assets,
    baseChr,
    renderContexts,
  };
  const errors = validateProjectGraphicsConfiguration(graphics);
  if (errors.length > 0) throw new Error(errors.join(' '));
  return graphics;
}

function parseGraphicsPixelOverrides(
  value: unknown,
): GraphicsPixelOverrides | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'indexed-image' && Array.isArray(raw.values)) {
    return {
      kind: 'indexed-image',
      values: raw.values.filter(
        (entry): entry is number => typeof entry === 'number',
      ),
    };
  }
  if (raw.kind === 'sparse-tiles') {
    const values = parseTilePixelOverrides(raw.values);
    return values === undefined ? undefined : { kind: 'sparse-tiles', values };
  }
  return undefined;
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

function parseConsumerAssetId(
  value: unknown,
  compatibilityReference: ProjectAssetReference | null,
): ProjectAssetId | null {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : (compatibilityReference?.id ?? null);
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
    // Read canonical anchor coords if present in persisted JSON.
    // Do NOT fabricate anchors when absent – migration to anchorX/Y happens
    // at runtime in computeInstanceProjection or when instances are updated.
    const rawAnchorX =
      typeof rawInst.anchorX === 'number' && Number.isFinite(rawInst.anchorX)
        ? rawInst.anchorX
        : undefined;
    const rawAnchorY =
      typeof rawInst.anchorY === 'number' && Number.isFinite(rawInst.anchorY)
        ? rawInst.anchorY
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
      ...(rawAnchorX !== undefined && rawAnchorY !== undefined
        ? { anchorX: rawAnchorX, anchorY: rawAnchorY }
        : {}),
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
    const migratedFromPlayfield = mapObj.migratedFromPlayfield === true;
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
    const collision = parseBackgroundCollision(mapObj.collision);
    const procedural = parseBackgroundProcedural(mapObj.procedural);

    maps.push({
      id,
      name,
      widthTiles,
      heightTiles,
      patternTable,
      ...(migratedFromPlayfield
        ? { migratedFromPlayfield: true as const }
        : {}),
      ...(assetId ? { assetId } : {}),
      ...(asset ? { asset } : {}),
      cells,
      paletteAssignments,
      ...(collision !== undefined ? { collision } : {}),
      ...(procedural !== undefined ? { procedural } : {}),
    });
  }

  return {
    activeMapId: activeMapId ?? maps[0]?.id ?? null,
    maps,
  };
}

function parseBackgroundCollision(
  value: unknown,
): BackgroundMapDefinition['collision'] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const cells = parseNumberArray(raw.cells);
  if (cells === undefined) return undefined;
  return {
    cells,
    ...(typeof raw.activeType === 'number'
      ? { activeType: raw.activeType as CollisionType }
      : {}),
  };
}

function parseBackgroundProcedural(
  value: unknown,
): BackgroundMapDefinition['procedural'] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.features)) return undefined;
  return { features: raw.features as RandomPlayfieldFeature[] };
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
