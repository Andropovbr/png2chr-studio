import type { IndexedImage, Tile } from './types';

export const TILE_SIZE = 8;
const PIXELS_PER_TILE = TILE_SIZE * TILE_SIZE;

export function extractTiles(image: IndexedImage): Tile[] {
  if (
    image.width % TILE_SIZE !== 0 ||
    image.height % TILE_SIZE !== 0 ||
    image.pixels.length !== image.width * image.height
  ) {
    throw new RangeError('Indexed image cannot be divided into 8x8 tiles.');
  }

  const columns = image.width / TILE_SIZE;
  const rows = image.height / TILE_SIZE;
  const tiles: Tile[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const pixels = new Uint8Array(PIXELS_PER_TILE);

      for (let tileY = 0; tileY < TILE_SIZE; tileY += 1) {
        for (let tileX = 0; tileX < TILE_SIZE; tileX += 1) {
          const sourceX = column * TILE_SIZE + tileX;
          const sourceY = row * TILE_SIZE + tileY;
          const sourceIndex = sourceY * image.width + sourceX;
          const targetIndex = tileY * TILE_SIZE + tileX;
          pixels[targetIndex] = image.pixels[sourceIndex] ?? 0;
        }
      }

      tiles.push({
        id: row * columns + column,
        column,
        row,
        pixels,
      });
    }
  }

  return tiles;
}
