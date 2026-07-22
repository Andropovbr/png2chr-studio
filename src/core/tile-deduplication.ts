import type { Tile } from './types';

export interface TileDeduplicationResult {
  readonly tiles: readonly Tile[];
  readonly originalToUnique: Uint32Array;
}

function tileKey(tile: Tile): string {
  return tile.pixels.join(',');
}

function transformedTileKey(
  tile: Tile,
  horizontalFlip: boolean,
  verticalFlip: boolean,
): string {
  if (tile.pixels.length !== 64) {
    throw new RangeError('A tile must contain exactly 64 pixels.');
  }

  const pixels: number[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const sourceRow = verticalFlip ? 7 - row : row;
      const sourceColumn = horizontalFlip ? 7 - column : column;
      pixels.push(tile.pixels[sourceRow * 8 + sourceColumn] ?? 0);
    }
  }
  return pixels.join(',');
}

function flipInvariantTileKey(tile: Tile): string {
  const keys = [
    transformedTileKey(tile, false, false),
    transformedTileKey(tile, true, false),
    transformedTileKey(tile, false, true),
    transformedTileKey(tile, true, true),
  ];
  return keys.reduce((smallest, key) => (key < smallest ? key : smallest));
}

/**
 * Removes exact pixel duplicates while preserving the first occurrence order.
 * IDs are reassigned because they represent positions in the exported CHR data.
 */
export function deduplicateTileSet(
  tiles: readonly Tile[],
): TileDeduplicationResult {
  const uniqueTiles: Tile[] = [];
  const indicesByTile = new Map<string, number>();
  const originalToUnique = new Uint32Array(tiles.length);

  tiles.forEach((tile, originalIndex) => {
    const key = tileKey(tile);
    const knownIndex = indicesByTile.get(key);
    if (knownIndex !== undefined) {
      originalToUnique[originalIndex] = knownIndex;
      return;
    }

    const uniqueIndex = uniqueTiles.length;
    indicesByTile.set(key, uniqueIndex);
    originalToUnique[originalIndex] = uniqueIndex;
    uniqueTiles.push({ ...tile, id: uniqueIndex });
  });

  return { tiles: uniqueTiles, originalToUnique };
}

export function deduplicateTiles(tiles: readonly Tile[]): readonly Tile[] {
  return deduplicateTileSet(tiles).tiles;
}

/**
 * Removes tiles equivalent under horizontal and/or vertical flips.
 * The first orientation encountered is retained for CHR export.
 */
export function deduplicateTilesConsideringFlips(
  tiles: readonly Tile[],
): readonly Tile[] {
  const uniqueTiles: Tile[] = [];
  const knownTiles = new Set<string>();

  tiles.forEach((tile) => {
    const key = flipInvariantTileKey(tile);
    if (knownTiles.has(key)) {
      return;
    }

    knownTiles.add(key);
    uniqueTiles.push({ ...tile, id: uniqueTiles.length });
  });

  return uniqueTiles;
}
