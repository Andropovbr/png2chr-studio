import type { Tile } from './types';

function tileKey(tile: Tile): string {
  return tile.pixels.join(',');
}

/**
 * Removes exact pixel duplicates while preserving the first occurrence order.
 * IDs are reassigned because they represent positions in the exported CHR data.
 */
export function deduplicateTiles(tiles: readonly Tile[]): Tile[] {
  const uniqueTiles: Tile[] = [];
  const knownTiles = new Set<string>();

  tiles.forEach((tile) => {
    const key = tileKey(tile);
    if (knownTiles.has(key)) {
      return;
    }

    knownTiles.add(key);
    uniqueTiles.push({ ...tile, id: uniqueTiles.length });
  });

  return uniqueTiles;
}
