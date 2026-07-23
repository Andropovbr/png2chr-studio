import type { IndexedImage, RgbColor, Tile } from './types';

const TILE_SIZE = 8;
const BYTES_PER_TILE = 16;
const DEFAULT_TILE_COLUMNS = 16;

export type ChrDecodingErrorCode = 'empty-file' | 'invalid-size';

export class ChrDecodingError extends Error {
  public constructor(public readonly code: ChrDecodingErrorCode) {
    super(code);
    this.name = 'ChrDecodingError';
  }
}

export function decodeChrTile(
  bytes: Uint8Array,
  id = 0,
  column = 0,
  row = 0,
): Tile {
  if (bytes.length !== BYTES_PER_TILE) {
    throw new ChrDecodingError('invalid-size');
  }

  const pixels = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let pixelRow = 0; pixelRow < TILE_SIZE; pixelRow += 1) {
    const bitplane0 = bytes[pixelRow] ?? 0;
    const bitplane1 = bytes[pixelRow + TILE_SIZE] ?? 0;
    for (let pixelColumn = 0; pixelColumn < TILE_SIZE; pixelColumn += 1) {
      const bit = 7 - pixelColumn;
      pixels[pixelRow * TILE_SIZE + pixelColumn] =
        ((bitplane0 >> bit) & 1) | (((bitplane1 >> bit) & 1) << 1);
    }
  }

  return { id, column, row, pixels };
}

export function decodeChr(
  bytes: Uint8Array,
  columns = DEFAULT_TILE_COLUMNS,
): Tile[] {
  if (bytes.length === 0) {
    throw new ChrDecodingError('empty-file');
  }
  if (bytes.length % BYTES_PER_TILE !== 0 || columns <= 0) {
    throw new ChrDecodingError('invalid-size');
  }

  const tileCount = bytes.length / BYTES_PER_TILE;
  return Array.from({ length: tileCount }, (_, id) =>
    decodeChrTile(
      bytes.slice(id * BYTES_PER_TILE, (id + 1) * BYTES_PER_TILE),
      id,
      id % columns,
      Math.floor(id / columns),
    ),
  );
}

export function chrTilesToIndexedImage(
  tiles: readonly Tile[],
  colors: readonly RgbColor[],
): IndexedImage {
  if (tiles.length === 0) {
    throw new ChrDecodingError('empty-file');
  }
  if (colors.length !== 4) {
    throw new RangeError('A CHR preview needs exactly four colors.');
  }

  const columns = Math.min(DEFAULT_TILE_COLUMNS, tiles.length);
  const rows = Math.ceil(tiles.length / columns);
  const width = columns * TILE_SIZE;
  const height = rows * TILE_SIZE;
  const pixels = new Uint8Array(width * height);

  tiles.forEach((tile, tileIndex) => {
    const tileColumn = tileIndex % columns;
    const tileRow = Math.floor(tileIndex / columns);
    for (let y = 0; y < TILE_SIZE; y += 1) {
      const sourceStart = y * TILE_SIZE;
      const targetStart =
        (tileRow * TILE_SIZE + y) * width + tileColumn * TILE_SIZE;
      pixels.set(
        tile.pixels.slice(sourceStart, sourceStart + TILE_SIZE),
        targetStart,
      );
    }
  });

  return {
    width,
    height,
    pixels,
    colors,
    transparentIndex: null,
    colorCount: 4,
  };
}
