import { describe, expect, it } from 'vitest';

import {
  ATTRIBUTE_TABLE_SIZE,
  encodePlayfield,
  NAMETABLE_SIZE,
  PlayfieldEncodingError,
} from './playfield-encoder';
import type { IndexedImage, Tile } from './types';

function indexedImage(width = 256, height = 240): IndexedImage {
  return {
    width,
    height,
    pixels: new Uint8Array(width * height),
    colors: [null, null, null, null],
    transparentIndex: null,
    colorCount: 1,
  };
}

function tile(id: number, value: number): Tile {
  return {
    id,
    column: id % 32,
    row: Math.floor(id / 32),
    pixels: new Uint8Array(64).fill(value),
  };
}

function capturePlayfieldError(
  operation: () => unknown,
): PlayfieldEncodingError {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof PlayfieldEncodingError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected playfield encoding to fail.');
}

describe('playfield encoding', () => {
  it('creates a 960-byte nametable using deduplicated tile indices', () => {
    const tiles = Array.from({ length: 960 }, (_, id) => tile(id, id % 2));

    const result = encodePlayfield(indexedImage(), tiles, true);

    expect(result.chrTiles).toHaveLength(2);
    expect(result.nametable).toHaveLength(NAMETABLE_SIZE);
    expect(Array.from(result.nametable.slice(0, 6))).toEqual([
      0, 1, 0, 1, 0, 1,
    ]);
  });

  it('creates a zeroed 64-byte Attribute Table for the global palette', () => {
    const tiles = Array.from({ length: 960 }, (_, id) => tile(id, 0));

    const result = encodePlayfield(indexedImage(), tiles, true);

    expect(result.attributeTable).toEqual(new Uint8Array(ATTRIBUTE_TABLE_SIZE));
  });

  it('rejects images that are not 256x240 pixels', () => {
    const error = capturePlayfieldError(() =>
      encodePlayfield(indexedImage(128, 120), [], true),
    );

    expect(error.code).toBe('invalid-playfield-dimensions');
  });

  it('rejects playfields with more than 256 exported tiles', () => {
    const tiles = Array.from({ length: 960 }, (_, id) => {
      const result = tile(id, 0);
      result.pixels[0] = id & 0xff;
      result.pixels[1] = id >> 8;
      return result;
    });

    const error = capturePlayfieldError(() =>
      encodePlayfield(indexedImage(), tiles, true),
    );

    expect(error.code).toBe('too-many-playfield-tiles');
    expect(error.tileCount).toBe(960);
  });

  it('requires deduplication for a complete 960-tile screen', () => {
    const tiles = Array.from({ length: 960 }, (_, id) => tile(id, id % 2));

    const error = capturePlayfieldError(() =>
      encodePlayfield(indexedImage(), tiles, false),
    );

    expect(error.code).toBe('too-many-playfield-tiles');
    expect(error.tileCount).toBe(960);
  });
});
