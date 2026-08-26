/**
 * Domain model and helpers for stable Logical Project Asset identities
 * and canonical Logical Tile Keys (assetId:tileX:tileY).
 *
 * Established for Milestone 6: Tile Ownership & Asset Mapping.
 * Logical identities are strictly independent of physical CHR allocation.
 */

import type { ProjectAssetReference } from './project';

/** Unique, stable identifier for a logical asset in the project. */
export type ProjectAssetId = string;

/** Kinds of logical assets supported in PNG2CHR Studio. */
export type ProjectAssetKind =
  | 'spritesheet'
  | 'tileset-image'
  | 'playfield-image'
  | 'background-image'
  | 'base-chr';

/** Canonical string key for a logical tile in an asset: `${assetId}:${tileX}:${tileY}` */
export type LogicalTileKey = string;

/** 2D grid coordinate of a logical 8x8 tile within a source asset. */
export interface LogicalTileCoordinate {
  readonly tileX: number;
  readonly tileY: number;
}

/** Structured breakdown of a LogicalTileKey. */
export interface LogicalTileIdentifier {
  readonly assetId: ProjectAssetId;
  readonly tileX: number;
  readonly tileY: number;
}

/** Logical representation of a project asset. */
export interface ProjectAsset {
  readonly id: ProjectAssetId;
  readonly kind: ProjectAssetKind;
  readonly name?: string;
  readonly reference: ProjectAssetReference;
}

/** Prefix map for generating readable asset IDs. */
const ASSET_KIND_PREFIXES: Readonly<Record<ProjectAssetKind, string>> = {
  spritesheet: 'asset-anim',
  'tileset-image': 'asset-tileset',
  'playfield-image': 'asset-playfield',
  'background-image': 'asset-bg',
  'base-chr': 'asset-base-chr',
};

/**
 * Returns the default deterministic fallback ID for legacy projects lacking explicit asset IDs.
 */
export function getLegacyDeterministicAssetId(
  kind: ProjectAssetKind,
  secondaryKey?: string | number,
): ProjectAssetId {
  switch (kind) {
    case 'tileset-image':
      return 'asset-tileset-default';
    case 'playfield-image':
      return 'asset-playfield-default';
    case 'background-image':
      if (secondaryKey !== undefined && String(secondaryKey).trim() !== '') {
        const sanitized = String(secondaryKey)
          .trim()
          .replace(/[:/\\]/g, '-');
        return `asset-bg-${sanitized}`;
      }
      return 'asset-bg-default';
    case 'base-chr':
      return 'asset-base-chr-default';
    case 'spritesheet':
      if (secondaryKey !== undefined && String(secondaryKey).trim() !== '') {
        const sanitized = String(secondaryKey)
          .trim()
          .replace(/[:/\\]/g, '-');
        return `asset-anim-${sanitized}`;
      }
      return 'asset-anim-default';
    default:
      return 'asset-default';
  }
}

/**
 * Normalizes an unknown/raw asset ID into a valid, stable ProjectAssetId.
 * If rawId is valid and non-empty, preserves it; otherwise falls back to the deterministic legacy ID.
 */
export function normalizeProjectAssetId(
  rawId: unknown,
  fallbackKind: ProjectAssetKind,
  secondaryKey?: string | number,
): ProjectAssetId {
  if (typeof rawId === 'string') {
    const trimmed = rawId.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return getLegacyDeterministicAssetId(fallbackKind, secondaryKey);
}

/**
 * Generates a unique, stable asset ID for a newly created asset.
 */
export function generateProjectAssetId(
  kind: ProjectAssetKind = 'spritesheet',
  customPrefix?: string,
): ProjectAssetId {
  const prefix = customPrefix ?? ASSET_KIND_PREFIXES[kind];
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    const uuidSuffix = crypto.randomUUID().substring(0, 8);
    return `${prefix}-${uuidSuffix}`;
  }
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  return `${prefix}-${timestamp}-${randomSuffix}`;
}

/**
 * Creates a canonical LogicalTileKey string from assetId, tileX, and tileY.
 * Throws if assetId is empty, contains the ':' delimiter, or if coordinates are negative/non-integer.
 */
export function createLogicalTileKey(
  assetId: ProjectAssetId,
  tileX: number,
  tileY: number,
): LogicalTileKey {
  if (typeof assetId !== 'string' || assetId.trim().length === 0) {
    throw new Error(
      'Invalid LogicalTileKey: assetId must be a non-empty string.',
    );
  }
  const cleanAssetId = assetId.trim();
  if (cleanAssetId.includes(':')) {
    throw new Error(
      `Invalid LogicalTileKey: assetId "${cleanAssetId}" must not contain the ":" delimiter.`,
    );
  }
  if (!Number.isInteger(tileX) || tileX < 0) {
    throw new Error(
      `Invalid LogicalTileKey: tileX must be a non-negative integer, received ${String(tileX)}.`,
    );
  }
  if (!Number.isInteger(tileY) || tileY < 0) {
    throw new Error(
      `Invalid LogicalTileKey: tileY must be a non-negative integer, received ${String(tileY)}.`,
    );
  }
  return `${cleanAssetId}:${String(tileX)}:${String(tileY)}`;
}

/**
 * Parses a LogicalTileKey into its structured components.
 * Returns null if the key format is invalid.
 */
export function parseLogicalTileKey(key: string): LogicalTileIdentifier | null {
  if (typeof key !== 'string' || key.trim().length === 0) {
    return null;
  }
  const parts = key.trim().split(':');
  if (parts.length !== 3) {
    return null;
  }
  const [assetId, tileXStr, tileYStr] = parts;
  if (!assetId || assetId.length === 0) {
    return null;
  }
  if (!tileXStr || !/^\d+$/.test(tileXStr)) {
    return null;
  }
  if (!tileYStr || !/^\d+$/.test(tileYStr)) {
    return null;
  }
  const tileX = parseInt(tileXStr, 10);
  const tileY = parseInt(tileYStr, 10);
  if (!Number.isSafeInteger(tileX) || !Number.isSafeInteger(tileY)) {
    return null;
  }
  return {
    assetId,
    tileX,
    tileY,
  };
}

/**
 * Checks whether a given string is a valid LogicalTileKey.
 */
export function isValidLogicalTileKey(key: string): boolean {
  return parseLogicalTileKey(key) !== null;
}

/**
 * Compares two LogicalTileKeys for equality.
 */
export function areLogicalTileKeysEqual(
  keyA: LogicalTileKey,
  keyB: LogicalTileKey,
): boolean {
  return keyA === keyB;
}

/**
 * Formats a tile grid coordinate for display (e.g. "Col 3, Row 5").
 */
export function formatLogicalTileCoordinate(
  tileX: number,
  tileY: number,
): string {
  return `Col ${String(tileX)}, Row ${String(tileY)}`;
}

export interface ComputeAnimationLogicalTileCoordinateOptions {
  readonly frameIndex: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly imageWidth: number;
  readonly cellColumn: number;
  readonly cellRow: number;
}

/**
 * Computes the canonical logical tile coordinate (tileX, tileY) in the source sprite sheet
 * for a specific frame cell.
 */
export function computeAnimationLogicalTileCoordinate(
  options: ComputeAnimationLogicalTileCoordinateOptions,
): LogicalTileCoordinate {
  const {
    frameIndex,
    frameWidth,
    frameHeight,
    imageWidth,
    cellColumn,
    cellRow,
  } = options;

  const validFrameWidth = Math.max(8, frameWidth);
  const validFrameHeight = Math.max(8, frameHeight);
  const validImageWidth = Math.max(validFrameWidth, imageWidth);

  const columns = Math.max(1, Math.floor(validImageWidth / validFrameWidth));
  const safeFrameIndex = Math.max(0, frameIndex);
  const frameCol = safeFrameIndex % columns;
  const frameRow = Math.floor(safeFrameIndex / columns);

  const frameTileX = Math.floor((frameCol * validFrameWidth) / 8);
  const frameTileY = Math.floor((frameRow * validFrameHeight) / 8);

  return {
    tileX: frameTileX + Math.max(0, cellColumn),
    tileY: frameTileY + Math.max(0, cellRow),
  };
}

/**
 * Factory to create a ProjectAssetReference with a guaranteed stable asset ID.
 */
export function createProjectAssetReference(options: {
  readonly path: string;
  readonly name?: string;
  readonly sourceKind?: 'png' | 'chr' | 'nes';
  readonly dataUrl?: string;
  readonly id?: ProjectAssetId;
  readonly kind?: ProjectAssetKind;
}): ProjectAssetReference {
  const id =
    options.id ?? generateProjectAssetId(options.kind ?? 'spritesheet');
  return {
    id,
    path: options.path,
    ...(options.name ? { name: options.name } : {}),
    ...(options.sourceKind ? { sourceKind: options.sourceKind } : {}),
    ...(options.dataUrl ? { dataUrl: options.dataUrl } : {}),
  };
}

/** Minimal project structure needed to extract asset identities. */
export interface ExtractableProjectAssetSource {
  readonly tileset?: { readonly asset?: ProjectAssetReference | null } | null;
  readonly playfield?: { readonly asset?: ProjectAssetReference | null } | null;
  readonly backgrounds?: {
    readonly maps?: readonly {
      readonly id: string;
      readonly name?: string;
      readonly asset?: ProjectAssetReference | null;
      readonly assetId?: ProjectAssetId;
    }[];
  } | null;
  readonly animation?: {
    readonly destinationChr?: ProjectAssetReference | Uint8Array | null;
    readonly destinationChrName?: string | null;
    readonly animations: readonly {
      readonly id: string;
      readonly name?: string;
      readonly asset?: ProjectAssetReference | null;
    }[];
  } | null;
}

/**
 * Extracts all registered ProjectAsset objects from a StudioProject or ProjectView.
 */
export function extractProjectAssets(
  project: ExtractableProjectAssetSource,
): readonly ProjectAsset[] {
  const assets: ProjectAsset[] = [];

  if (project.tileset?.asset) {
    const ref = project.tileset.asset;
    const id = normalizeProjectAssetId(ref.id, 'tileset-image');
    assets.push({
      id,
      kind: 'tileset-image',
      name: ref.name ?? 'Tileset Image',
      reference: ref,
    });
  }

  if (project.playfield?.asset) {
    const ref = project.playfield.asset;
    const id = normalizeProjectAssetId(ref.id, 'playfield-image');
    assets.push({
      id,
      kind: 'playfield-image',
      name: ref.name ?? 'Playfield Image',
      reference: ref,
    });
  }

  if (project.backgrounds?.maps) {
    project.backgrounds.maps.forEach((map, idx) => {
      if (map.asset) {
        const ref = map.asset;
        const id = normalizeProjectAssetId(
          ref.id ?? map.assetId,
          'background-image',
          map.id,
        );
        const displayName =
          map.name && map.name.length > 0
            ? map.name
            : (ref.name ?? `Background Map ${String(idx + 1)}`);
        assets.push({
          id,
          kind: 'background-image',
          name: displayName,
          reference: ref,
        });
      }
    });
  }

  if (project.animation) {
    if (project.animation.destinationChr) {
      const dest = project.animation.destinationChr;
      if (typeof dest === 'object' && 'path' in dest) {
        const ref = dest;
        const id = normalizeProjectAssetId(ref.id, 'base-chr');
        assets.push({
          id,
          kind: 'base-chr',
          name: ref.name ?? 'Base CHR',
          reference: ref,
        });
      } else if (dest instanceof Uint8Array && dest.length > 0) {
        const id = getLegacyDeterministicAssetId('base-chr');
        assets.push({
          id,
          kind: 'base-chr',
          name: project.animation.destinationChrName ?? 'Base CHR',
          reference: { id, path: '' },
        });
      }
    }

    project.animation.animations.forEach((anim, idx) => {
      if (anim.asset) {
        const ref = anim.asset;
        const id = normalizeProjectAssetId(ref.id, 'spritesheet', anim.id);
        const displayName =
          anim.name && anim.name.length > 0
            ? anim.name
            : (ref.name ?? `Animation ${String(idx + 1)}`);
        assets.push({
          id,
          kind: 'spritesheet',
          name: displayName,
          reference: ref,
        });
      }
    });
  }

  return assets;
}
