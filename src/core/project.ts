import type { CollisionType } from './collision-encoder';
import { createDefaultNesPaletteSet, type NesPaletteSet } from './nes-palette';
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
import type { ProjectMode } from '../ui/types';

export const CURRENT_PROJECT_FORMAT_VERSION = 1;
export const SUPPORTED_PROJECT_FORMAT_VERSIONS = [1] as const;

export interface ProjectAssetReference {
  /** Path to the asset file (relative to project file whenever possible). */
  readonly path: string;
  /** Optional original file name. */
  readonly name?: string;
  /** Source kind: png, chr, or nes. */
  readonly sourceKind?: 'png' | 'chr' | 'nes';
}

export interface ProjectAnimationItemConfig {
  readonly id: string;
  readonly name: string;
  readonly entity?: string;
  readonly asset: ProjectAssetReference | null;
  readonly paletteIndex?: number | null;
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

export interface StudioProject {
  readonly formatVersion: 1;
  readonly name: string;
  readonly mode: ProjectMode;
  readonly settings: {
    readonly deduplicationEnabled: boolean;
    readonly flipDeduplicationEnabled: boolean;
    readonly quantization: QuantizationSettings;
  };
  readonly palette: {
    readonly paletteSet: NesPaletteSet;
    readonly activePaletteIndex?: number;
    readonly activeColorIndex?: number;
  };
  readonly tileset?: ProjectTilesetConfig;
  readonly playfield?: ProjectPlayfieldConfig;
  readonly animation?: ProjectAnimationSettingsConfig;
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
      paletteSet: createDefaultNesPaletteSet(),
      activePaletteIndex: 0,
      activeColorIndex: 1,
    },
    tileset: {
      asset: null,
    },
    playfield: {
      asset: null,
      randomPlayfieldFeatures: [...DEFAULT_RANDOM_PLAYFIELD_FEATURES],
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
          paletteIndex: null,
          frameWidth: 16,
          frameHeight: 16,
          originX: 0,
          originY: 0,
          playback: 'loop',
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          defaultDuration: 12,
          frameIndices: [],
          frameDurations: [],
          framePalettes: [],
        },
      ],
    },
  };
}

/**
 * Serializes a StudioProject into formatted JSON string.
 */
export function serializeProject(project: StudioProject): string {
  return JSON.stringify(project, null, 2);
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
  } catch {
    return {
      success: false,
      error: {
        code: 'invalid-json',
        message: 'The project file does not contain valid JSON syntax.',
      },
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      success: false,
      error: {
        code: 'invalid-project-schema',
        message: 'The project file root must be a JSON object.',
      },
    };
  }

  const raw = parsed as Record<string, unknown>;

  if (raw.formatVersion === undefined || raw.formatVersion === null) {
    return {
      success: false,
      error: {
        code: 'missing-format-version',
        message:
          'The project file is missing the required "formatVersion" field.',
      },
    };
  }

  if (
    typeof raw.formatVersion !== 'number' ||
    !SUPPORTED_PROJECT_FORMAT_VERSIONS.includes(
      raw.formatVersion as (typeof SUPPORTED_PROJECT_FORMAT_VERSIONS)[number],
    )
  ) {
    const versionLabel =
      typeof raw.formatVersion === 'number' ||
      typeof raw.formatVersion === 'string'
        ? String(raw.formatVersion)
        : 'invalid';
    return {
      success: false,
      error: {
        code: 'unsupported-format-version',
        message: `Project format version ${versionLabel} is not supported.`,
        details: { formatVersion: raw.formatVersion },
      },
    };
  }

  const name =
    typeof raw.name === 'string' && raw.name.trim() !== ''
      ? raw.name.trim()
      : 'Untitled Project';

  const mode: ProjectMode =
    raw.mode === 'playfield' || raw.mode === 'animation' ? raw.mode : 'tileset';

  const rawSettings =
    typeof raw.settings === 'object' && raw.settings !== null
      ? (raw.settings as Record<string, unknown>)
      : {};

  const deduplicationEnabled = Boolean(rawSettings.deduplicationEnabled);
  const flipDeduplicationEnabled = Boolean(
    rawSettings.flipDeduplicationEnabled,
  );
  const quantization = normalizeQuantizationSettings(rawSettings.quantization);

  const rawPalette =
    typeof raw.palette === 'object' && raw.palette !== null
      ? (raw.palette as Record<string, unknown>)
      : {};

  let paletteSet: NesPaletteSet = createDefaultNesPaletteSet();
  if (
    Array.isArray(rawPalette.paletteSet) &&
    rawPalette.paletteSet.length === 4
  ) {
    const validRows = rawPalette.paletteSet.every(
      (row) => Array.isArray(row) && row.length === 4,
    );
    if (validRows) {
      const rows = rawPalette.paletteSet as unknown[][];
      const parsedSet = rows.map((row) =>
        row.map((val) => (typeof val === 'number' ? val & 0x3f : 0x0f)),
      );
      paletteSet = parsedSet as unknown as NesPaletteSet;
    }
  }

  const activePaletteIndex =
    typeof rawPalette.activePaletteIndex === 'number'
      ? Math.max(0, Math.min(3, rawPalette.activePaletteIndex))
      : 0;
  const activeColorIndex =
    typeof rawPalette.activeColorIndex === 'number'
      ? Math.max(0, Math.min(3, rawPalette.activeColorIndex))
      : 1;

  // Validate Tileset section
  let tileset: ProjectTilesetConfig | undefined;
  if (typeof raw.tileset === 'object' && raw.tileset !== null) {
    const rawTileset = raw.tileset as Record<string, unknown>;
    const asset = parseAssetReference(rawTileset.asset);
    const paletteAssignments = parseNumberArray(rawTileset.paletteAssignments);
    const pixelOverrides = parseNumberArray(rawTileset.pixelOverrides);
    tileset = {
      asset,
      ...(paletteAssignments !== undefined ? { paletteAssignments } : {}),
      ...(pixelOverrides !== undefined ? { pixelOverrides } : {}),
    };
  }

  // Validate Playfield section
  let playfield: ProjectPlayfieldConfig | undefined;
  if (typeof raw.playfield === 'object' && raw.playfield !== null) {
    const rawPlayfield = raw.playfield as Record<string, unknown>;
    const asset = parseAssetReference(rawPlayfield.asset);
    const collisionCells = parseNumberArray(rawPlayfield.collisionCells);
    const activeCollisionType =
      typeof rawPlayfield.activeCollisionType === 'number'
        ? (rawPlayfield.activeCollisionType as CollisionType)
        : undefined;
    const randomPlayfieldFeatures = Array.isArray(
      rawPlayfield.randomPlayfieldFeatures,
    )
      ? (rawPlayfield.randomPlayfieldFeatures as RandomPlayfieldFeature[])
      : undefined;
    const paletteAssignments = parseNumberArray(
      rawPlayfield.paletteAssignments,
    );
    const pixelOverrides = parseNumberArray(rawPlayfield.pixelOverrides);
    playfield = {
      asset,
      ...(collisionCells !== undefined ? { collisionCells } : {}),
      ...(activeCollisionType !== undefined ? { activeCollisionType } : {}),
      ...(randomPlayfieldFeatures !== undefined
        ? { randomPlayfieldFeatures }
        : {}),
      ...(paletteAssignments !== undefined ? { paletteAssignments } : {}),
      ...(pixelOverrides !== undefined ? { pixelOverrides } : {}),
    };
  }

  // Validate Animation section
  let animation: ProjectAnimationSettingsConfig | undefined;
  if (typeof raw.animation === 'object' && raw.animation !== null) {
    const rawAnim = raw.animation as Record<string, unknown>;
    const items: ProjectAnimationItemConfig[] = [];
    if (Array.isArray(rawAnim.animations)) {
      for (const item of rawAnim.animations) {
        if (typeof item === 'object' && item !== null) {
          const rawItem = item as Record<string, unknown>;
          const framePalettes = Array.isArray(rawItem.framePalettes)
            ? rawItem.framePalettes.map((p) =>
                typeof p === 'number' ? p : null,
              )
            : undefined;
          items.push({
            id:
              typeof rawItem.id === 'string'
                ? rawItem.id
                : `anim-${Math.random().toString(36).slice(2, 9)}`,
            name: typeof rawItem.name === 'string' ? rawItem.name : 'anim',
            entity:
              typeof rawItem.entity === 'string' && rawItem.entity.trim() !== ''
                ? rawItem.entity.trim()
                : typeof rawAnim.symbolPrefix === 'string' &&
                    rawAnim.symbolPrefix.trim() !== ''
                  ? rawAnim.symbolPrefix.trim()
                  : 'entity',
            asset: parseAssetReference(rawItem.asset),
            paletteIndex:
              typeof rawItem.paletteIndex === 'number'
                ? rawItem.paletteIndex
                : null,
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
            ...(rawItem.flipH !== undefined
              ? { flipH: Boolean(rawItem.flipH) }
              : {}),
            ...(rawItem.flipV !== undefined
              ? { flipV: Boolean(rawItem.flipV) }
              : {}),
            defaultDuration:
              typeof rawItem.defaultDuration === 'number' &&
              rawItem.defaultDuration > 0
                ? rawItem.defaultDuration
                : 12,
            frameIndices: parseNumberArray(rawItem.frameIndices) ?? [],
            frameDurations: parseNumberArray(rawItem.frameDurations) ?? [],
            ...(framePalettes !== undefined ? { framePalettes } : {}),
          });
        }
      }
    }

    animation = {
      name: typeof rawAnim.name === 'string' ? rawAnim.name : 'soldier',
      symbolPrefix:
        typeof rawAnim.symbolPrefix === 'string'
          ? rawAnim.symbolPrefix
          : 'soldier',
      defaultPaletteIndex:
        typeof rawAnim.defaultPaletteIndex === 'number'
          ? rawAnim.defaultPaletteIndex
          : 0,
      quantizationMode:
        rawAnim.quantizationMode === 'nearest' ||
        rawAnim.quantizationMode === 'k-means'
          ? rawAnim.quantizationMode
          : 'median-cut',
      ditheringMode:
        rawAnim.ditheringMode === 'floyd-steinberg' ||
        rawAnim.ditheringMode === 'atkinson' ||
        rawAnim.ditheringMode === 'bayer-4x4' ||
        rawAnim.ditheringMode === 'bayer-8x8'
          ? rawAnim.ditheringMode
          : 'none',
      flipDeduplication:
        rawAnim.flipDeduplication !== undefined
          ? Boolean(rawAnim.flipDeduplication)
          : true,
      spritePalette:
        typeof rawAnim.spritePalette === 'number' ? rawAnim.spritePalette : 0,
      spriteColorIndex:
        typeof rawAnim.spriteColorIndex === 'number'
          ? rawAnim.spriteColorIndex
          : 1,
      patternTable: rawAnim.patternTable === 1 ? 1 : 0,
      destinationPatternTable: rawAnim.destinationPatternTable === 1 ? 1 : 0,
      destinationChr: parseAssetReference(rawAnim.destinationChr),
      animations: items,
    };
  }

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
      paletteSet,
      activePaletteIndex,
      activeColorIndex,
    },
    tileset,
    playfield,
    animation,
  };

  return {
    success: true,
    project,
  };
}

function parseAssetReference(value: unknown): ProjectAssetReference | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.path !== 'string' || raw.path.trim() === '') return null;
  return {
    path: normalizePath(raw.path.trim()),
    name: typeof raw.name === 'string' ? raw.name.trim() : undefined,
    sourceKind:
      raw.sourceKind === 'png' ||
      raw.sourceKind === 'chr' ||
      raw.sourceKind === 'nes'
        ? raw.sourceKind
        : undefined,
  };
}

function parseNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is number => typeof v === 'number');
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
