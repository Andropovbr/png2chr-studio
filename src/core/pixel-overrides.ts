import type { IndexedImage } from './types';

export const TILE_SIZE = 8;
export const PIXELS_PER_TILE = TILE_SIZE * TILE_SIZE; // 64

/**
 * Sparse map of pixel overrides for a single 8x8 tile.
 * Keys are pixel offsets (0 to 63, where offset = y * 8 + x).
 * Values are NES color indices: 0, 1, 2, or 3.
 */
export type SingleTileOverrides = Record<number, number>;

/**
 * A dictionary of tile pixel overrides.
 * Key format: "${tileX}_${tileY}" where tileX and tileY are 8x8 tile coordinates in the spritesheet.
 * Value: SingleTileOverrides (sparse mapping of pixelOffset -> colorIndex 0..3)
 */
export type TilePixelOverrides = Record<string, SingleTileOverrides>;

export function getTileKey(tileX: number, tileY: number): string {
  return `${String(tileX)}_${String(tileY)}`;
}

export function parseTileKey(key: string): { tileX: number; tileY: number } | null {
  const parts = key.split('_');
  if (parts.length !== 2) return null;
  const tileX = parseInt(parts[0] ?? '', 10);
  const tileY = parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(tileX) || !Number.isFinite(tileY) || tileX < 0 || tileY < 0) {
    return null;
  }
  return { tileX, tileY };
}

export function calculateTileCoordinates(
  frameX: number,
  frameY: number,
  tileCol: number,
  tileRow: number,
): { tileX: number; tileY: number } {
  return {
    tileX: Math.floor((frameX + tileCol * TILE_SIZE) / TILE_SIZE),
    tileY: Math.floor((frameY + tileRow * TILE_SIZE) / TILE_SIZE),
  };
}

export function hasTileOverride(
  overrides: TilePixelOverrides | undefined | null,
  tileX: number,
  tileY: number,
): boolean {
  if (!overrides) return false;
  const key = getTileKey(tileX, tileY);
  const data = overrides[key];
  return Boolean(data && Object.keys(data).length > 0);
}

export function getTileOverride(
  overrides: TilePixelOverrides | undefined | null,
  tileX: number,
  tileY: number,
): SingleTileOverrides | undefined {
  if (!overrides) return undefined;
  const key = getTileKey(tileX, tileY);
  return overrides[key];
}

export function extractTileFromIndexedImage(
  image: IndexedImage,
  tileX: number,
  tileY: number,
  overrides?: TilePixelOverrides | null,
): Uint8Array {
  const pixels = new Uint8Array(PIXELS_PER_TILE);
  const startX = tileX * TILE_SIZE;
  const startY = tileY * TILE_SIZE;
  const tileOverride = overrides ? getTileOverride(overrides, tileX, tileY) : undefined;

  for (let y = 0; y < TILE_SIZE; y += 1) {
    const rowOffset = (startY + y) * image.width + startX;
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const offset = y * TILE_SIZE + x;
      const overridden = tileOverride?.[offset];
      if (typeof overridden === 'number' && overridden >= 0 && overridden <= 3) {
        pixels[offset] = overridden;
      } else if (startX + x < image.width && startY + y < image.height) {
        pixels[offset] = image.pixels[rowOffset + x] ?? 0;
      }
    }
  }
  return pixels;
}

/**
 * Creates or updates an override for a single pixel within an 8x8 tile.
 */
export function setTilePixelOverride(
  overrides: TilePixelOverrides | undefined | null,
  tileX: number,
  tileY: number,
  pixelX: number,
  pixelY: number,
  colorIndex: number,
): TilePixelOverrides {
  const safeIndex = Math.max(0, Math.min(3, Math.floor(colorIndex)));
  const key = getTileKey(tileX, tileY);
  const offset = pixelY * TILE_SIZE + pixelX;
  const currentTileMap = overrides?.[key] ?? {};

  return {
    ...(overrides ?? {}),
    [key]: {
      ...currentTileMap,
      [offset]: safeIndex,
    },
  };
}

/**
 * Removes manual override for an individual pixel in an 8x8 tile.
 */
export function resetSinglePixelOverride(
  overrides: TilePixelOverrides | undefined | null,
  tileX: number,
  tileY: number,
  pixelX: number,
  pixelY: number,
): TilePixelOverrides {
  if (!overrides) return {};
  const key = getTileKey(tileX, tileY);
  const currentTileMap = overrides[key];
  if (!currentTileMap) return { ...overrides };

  const offset = pixelY * TILE_SIZE + pixelX;
  if (!(offset in currentTileMap)) return { ...overrides };

  const nextTileMap: Record<number, number> = {};
  for (const [kStr, v] of Object.entries(currentTileMap)) {
    const k = parseInt(kStr, 10);
    if (k !== offset) {
      nextTileMap[k] = v;
    }
  }

  if (Object.keys(nextTileMap).length === 0) {
    const nextOverrides: TilePixelOverrides = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (k !== key) {
        nextOverrides[k] = v;
      }
    }
    return nextOverrides;
  }

  return {
    ...overrides,
    [key]: nextTileMap,
  };
}

/**
 * Removes manual overrides for a given tile, restoring the automatic generated pixels.
 */
export function resetTileOverride(
  overrides: TilePixelOverrides | undefined | null,
  tileX: number,
  tileY: number,
): TilePixelOverrides {
  if (!overrides) return {};
  const key = getTileKey(tileX, tileY);
  if (!(key in overrides)) return { ...overrides };
  const nextOverrides: TilePixelOverrides = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (k !== key) {
      nextOverrides[k] = v;
    }
  }
  return nextOverrides;
}

/**
 * Applies all tile pixel overrides over an IndexedImage, returning a new IndexedImage with
 * overrides composited.
 */
export function applyPixelOverridesToImage(
  baseImage: IndexedImage,
  overrides: TilePixelOverrides | undefined | null,
): IndexedImage {
  if (!overrides || Object.keys(overrides).length === 0) {
    return baseImage;
  }

  const mergedPixels = new Uint8Array(baseImage.pixels);

  for (const [key, tileMap] of Object.entries(overrides)) {
    const coords = parseTileKey(key);
    if (!coords) continue;
    const { tileX, tileY } = coords;
    const startX = tileX * TILE_SIZE;
    const startY = tileY * TILE_SIZE;

    if (startX >= baseImage.width || startY >= baseImage.height) {
      continue;
    }

    for (const [offsetStr, colorIndex] of Object.entries(tileMap)) {
      const offset = parseInt(offsetStr, 10);
      if (!Number.isFinite(offset) || offset < 0 || offset >= PIXELS_PER_TILE) continue;
      if (colorIndex < 0 || colorIndex > 3) continue;

      const px = offset % TILE_SIZE;
      const py = Math.floor(offset / TILE_SIZE);
      const imgX = startX + px;
      const imgY = startY + py;

      if (imgX < baseImage.width && imgY < baseImage.height) {
        mergedPixels[imgY * baseImage.width + imgX] = colorIndex;
      }
    }
  }

  return {
    width: baseImage.width,
    height: baseImage.height,
    pixels: mergedPixels,
    colors: baseImage.colors,
    transparentIndex: baseImage.transparentIndex,
    colorCount: baseImage.colorCount,
  };
}
