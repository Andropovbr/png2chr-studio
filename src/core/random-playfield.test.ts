import { describe, expect, it } from 'vitest';

import { encodePlayfield } from './playfield-encoder';
import {
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
});
