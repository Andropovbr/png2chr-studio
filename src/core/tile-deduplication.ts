import type { Tile } from './types';

export interface TileDeduplicationResult {
  readonly tiles: readonly Tile[];
  readonly originalToUnique: Uint32Array;
}

function tileKey(tile: Tile): string {
  return tile.pixels.join(',');
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
