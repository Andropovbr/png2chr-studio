import { createLogicalTileKey, type ProjectAssetId } from './asset-identity';
import { encodeChr } from './chr-encoder';
import {
  applyPixelOverridesToImage,
  type TilePixelOverrides,
} from './pixel-overrides';
import type {
  DecodedGraphicsAsset,
  GraphicsPixelOverrides,
  ProjectGraphicsConfiguration,
} from './project-graphics';
import { extractTiles } from './tile-extraction';
import type { IndexedImage, Tile } from './types';

export interface GraphicsAssetDecodeSource {
  readonly assetId: ProjectAssetId;
  readonly indexedImage?: IndexedImage;
  /** Use for independently decoded NES 2bpp sources. */
  readonly tiles?: readonly Tile[];
}

export type GraphicsAssetDecodeResult =
  | { readonly success: true; readonly assets: readonly DecodedGraphicsAsset[] }
  | {
      readonly success: false;
      readonly assetId: ProjectAssetId;
      readonly reason: 'missing-source' | 'incompatible-source';
    };

function decodedAsset(
  assetId: ProjectAssetId,
  tiles: readonly Tile[],
  widthTiles: number,
  heightTiles: number,
): DecodedGraphicsAsset {
  return {
    assetId,
    widthTiles,
    heightTiles,
    tiles,
    tilesByLogicalKey: new Map(
      tiles.map((tile) => [
        createLogicalTileKey(assetId, tile.column, tile.row),
        tile,
      ]),
    ),
  };
}

function validTiles(tiles: readonly Tile[]): boolean {
  const coordinates = new Set<string>();
  return tiles.every((tile) => {
    const valid =
      Number.isInteger(tile.column) &&
      tile.column >= 0 &&
      Number.isInteger(tile.row) &&
      tile.row >= 0 &&
      tile.pixels.length === 64;
    const key = `${String(tile.column)}:${String(tile.row)}`;
    if (!valid || coordinates.has(key)) return false;
    coordinates.add(key);
    return true;
  });
}

function indexedOverrides(
  overrides: GraphicsPixelOverrides | undefined,
): Uint8Array | undefined {
  return overrides?.kind === 'indexed-image'
    ? new Uint8Array(overrides.values)
    : undefined;
}

function sparseOverrides(
  overrides: GraphicsPixelOverrides | undefined,
): TilePixelOverrides | undefined {
  return overrides?.kind === 'sparse-tiles' ? overrides.values : undefined;
}

/**
 * Decodes every non-Base-CHR catalog asset by its stable ID. This deliberately
 * never substitutes another asset's tiles when a source is absent or wrong.
 */
export function decodeProjectGraphicsAssets(
  graphics: ProjectGraphicsConfiguration,
  sources: readonly GraphicsAssetDecodeSource[],
  requiredAssetIds?: ReadonlySet<ProjectAssetId>,
): GraphicsAssetDecodeResult {
  const sourcesById = new Map(
    sources.map((source) => [source.assetId, source]),
  );
  const decodedAssets: DecodedGraphicsAsset[] = [];
  for (const asset of graphics.assets) {
    if (requiredAssetIds && !requiredAssetIds.has(asset.id)) continue;
    const source = sourcesById.get(asset.id);
    if (!source) {
      return { success: false, assetId: asset.id, reason: 'missing-source' };
    }
    if (asset.logicalTiles.decoding === 'nes-2bpp') {
      if (!source.tiles || !validTiles(source.tiles)) {
        return {
          success: false,
          assetId: asset.id,
          reason: 'incompatible-source',
        };
      }
      const widthTiles = Math.max(
        1,
        Math.max(...source.tiles.map((tile) => tile.column + 1), 0),
      );
      const heightTiles = Math.max(
        1,
        Math.max(...source.tiles.map((tile) => tile.row + 1), 0),
      );
      decodedAssets.push(
        decodedAsset(asset.id, source.tiles, widthTiles, heightTiles),
      );
      continue;
    }
    const image = source.indexedImage;
    const override = indexedOverrides(asset.logicalTiles.pixelOverrides);
    if (
      !image ||
      image.width % 8 !== 0 ||
      image.height % 8 !== 0 ||
      (override !== undefined && override.length !== image.pixels.length)
    ) {
      return {
        success: false,
        assetId: asset.id,
        reason: 'incompatible-source',
      };
    }
    const indexed = override
      ? { ...image, pixels: override }
      : applyPixelOverridesToImage(
          image,
          sparseOverrides(asset.logicalTiles.pixelOverrides),
        );
    decodedAssets.push(
      decodedAsset(
        asset.id,
        extractTiles(indexed),
        Math.floor(indexed.width / 8),
        Math.floor(indexed.height / 8),
      ),
    );
  }
  return { success: true, assets: decodedAssets };
}

/** Developer tile-pack utility. Result has no project allocation or slot meaning. */
export function encodeRawGraphicsTilePack(
  asset: DecodedGraphicsAsset,
): Uint8Array {
  return encodeChr(asset.tiles);
}
