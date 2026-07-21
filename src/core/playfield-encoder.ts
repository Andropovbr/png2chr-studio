import { deduplicateTileSet } from './tile-deduplication';
import type { IndexedImage, Tile } from './types';

export const PLAYFIELD_WIDTH = 256;
export const PLAYFIELD_HEIGHT = 240;
export const PLAYFIELD_TILE_COUNT = 32 * 30;
export const NAMETABLE_SIZE = PLAYFIELD_TILE_COUNT;
export const ATTRIBUTE_TABLE_SIZE = 64;
export const MAX_PLAYFIELD_TILES = 256;

export type PlayfieldEncodingErrorCode =
  | 'invalid-playfield-dimensions'
  | 'invalid-playfield-tiles'
  | 'too-many-playfield-tiles';

export class PlayfieldEncodingError extends Error {
  public constructor(
    public readonly code: PlayfieldEncodingErrorCode,
    public readonly tileCount?: number,
  ) {
    super(code);
    this.name = 'PlayfieldEncodingError';
  }
}

export interface PlayfieldExport {
  readonly chrTiles: readonly Tile[];
  readonly nametable: Uint8Array;
  readonly attributeTable: Uint8Array;
}

function createIdentityTileSet(tiles: readonly Tile[]): {
  tiles: readonly Tile[];
  originalToUnique: Uint32Array;
} {
  const originalToUnique = new Uint32Array(tiles.length);
  const indexedTiles = tiles.map((tile, index) => {
    originalToUnique[index] = index;
    return { ...tile, id: index };
  });
  return { tiles: indexedTiles, originalToUnique };
}

export function encodePlayfield(
  image: IndexedImage,
  tiles: readonly Tile[],
  deduplicationEnabled: boolean,
): PlayfieldExport {
  if (image.width !== PLAYFIELD_WIDTH || image.height !== PLAYFIELD_HEIGHT) {
    throw new PlayfieldEncodingError('invalid-playfield-dimensions');
  }

  if (tiles.length !== PLAYFIELD_TILE_COUNT) {
    throw new PlayfieldEncodingError('invalid-playfield-tiles');
  }

  const tileSet = deduplicationEnabled
    ? deduplicateTileSet(tiles)
    : createIdentityTileSet(tiles);

  if (tileSet.tiles.length > MAX_PLAYFIELD_TILES) {
    throw new PlayfieldEncodingError(
      'too-many-playfield-tiles',
      tileSet.tiles.length,
    );
  }

  return {
    chrTiles: tileSet.tiles,
    nametable: Uint8Array.from(tileSet.originalToUnique),
    // Version 0.3 uses one global four-color palette, so every quadrant selects palette 0.
    attributeTable: new Uint8Array(ATTRIBUTE_TABLE_SIZE),
  };
}
