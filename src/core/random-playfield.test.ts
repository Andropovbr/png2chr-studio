import { describe, expect, it } from 'vitest';

import { encodePlayfield } from './playfield-encoder';
import {
  DEFAULT_RANDOM_PLAYFIELD_FEATURES,
  generateRandomPlayfield,
  RANDOM_PLAYFIELD_COLORS,
  RANDOM_PLAYFIELD_HEIGHT,
  RANDOM_PLAYFIELD_NES_PALETTE,
  RANDOM_PLAYFIELD_TILE_LIMIT,
  RANDOM_PLAYFIELD_WIDTH,
} from './random-playfield';
import { deduplicateTiles } from './tile-deduplication';
import { extractTiles } from './tile-extraction';

describe('random playfield generation', () => {
  it('creates a complete NES playfield using one four-color palette', () => {
    const image = generateRandomPlayfield(() => 0.5);

    expect(image.width).toBe(RANDOM_PLAYFIELD_WIDTH);
    expect(image.height).toBe(RANDOM_PLAYFIELD_HEIGHT);
    expect(image.pixels).toHaveLength(256 * 240);
    expect(image.colors).toEqual(RANDOM_PLAYFIELD_COLORS);
    expect(image.colorCount).toBe(4);
    expect(Math.max(...image.pixels)).toBeLessThanOrEqual(3);
    expect(RANDOM_PLAYFIELD_NES_PALETTE).toEqual([0x0f, 0x11, 0x21, 0x30]);
  });

  it('uses a small reusable tile set that can always be exported', () => {
    const image = generateRandomPlayfield(() => 0.25);
    const tiles = extractTiles(image);
    const uniqueTiles = deduplicateTiles(tiles);
    const playfield = encodePlayfield(image, tiles, true);

    expect(tiles).toHaveLength(32 * 30);
    expect(uniqueTiles.length).toBeLessThanOrEqual(RANDOM_PLAYFIELD_TILE_LIMIT);
    expect(playfield.chrTiles.length).toBe(uniqueTiles.length);
    expect(playfield.nametable).toHaveLength(960);
    expect(playfield.attributeTable).toEqual(new Uint8Array(64));
  });

  it('can be deterministic when supplied with a seeded random source', () => {
    let state = 7;
    const seededRandom = (): number => {
      state = (state * 16_807) % 2_147_483_647;
      return state / 2_147_483_647;
    };

    const first = generateRandomPlayfield(seededRandom);
    state = 7;
    const second = generateRandomPlayfield(seededRandom);

    expect(second.pixels).toEqual(first.pixels);
  });

  it.each([
    ['top-border', 0, 0, 31, 0],
    ['bottom-border', 0, 29, 31, 29],
    ['left-border', 0, 0, 0, 29],
    ['right-border', 31, 0, 31, 29],
  ] as const)(
    'fills the complete %s',
    (feature, startColumn, startRow, endColumn, endRow) => {
      const image = generateRandomPlayfield(() => 0.5, {
        features: [feature],
      });
      const tiles = extractTiles(image);
      const tileAt = (column: number, row: number) =>
        tiles[row * 32 + column]?.pixels ?? new Uint8Array();
      const length = Math.max(endColumn - startColumn, endRow - startRow);

      for (let offset = 0; offset <= length; offset += 1) {
        const column = startColumn + Math.min(offset, endColumn - startColumn);
        const row = startRow + Math.min(offset, endRow - startRow);
        expect(
          Array.from(tileAt(column, row)).some((pixel) => pixel !== 0),
        ).toBe(true);
      }
    },
  );

  it('connects vertically aligned platforms with stairs', () => {
    const image = generateRandomPlayfield(() => 0.5, {
      features: ['platforms', 'stairs'],
    });
    const tiles = extractTiles(image);
    const tileAt = (column: number, row: number) =>
      tiles[row * 32 + column]?.pixels ?? new Uint8Array();
    const isStairs = (pixels: Uint8Array) =>
      pixels[1] === 3 && pixels[6] === 3 && pixels[8 + 2] === 2;

    expect(isStairs(tileAt(16, 11))).toBe(true);
    expect(isStairs(tileAt(16, 12))).toBe(true);
    expect(isStairs(tileAt(16, 13))).toBe(true);
    expect(isStairs(tileAt(16, 10))).toBe(false);
    expect(isStairs(tileAt(16, 14))).toBe(false);
  });

  it.each([
    'walls',
    'platforms',
    'clouds',
    'stars',
    'trees',
    'stairs',
  ] as const)('draws the selected %s feature', (feature) => {
    const image = generateRandomPlayfield(() => 0, {
      features: [feature],
    });

    expect(Array.from(image.pixels).some((pixel) => pixel !== 0)).toBe(true);
  });

  it('requires at least one selected feature', () => {
    expect(() => generateRandomPlayfield(() => 0.5, { features: [] })).toThrow(
      RangeError,
    );
    expect(DEFAULT_RANDOM_PLAYFIELD_FEATURES.length).toBeGreaterThan(0);
  });
});
