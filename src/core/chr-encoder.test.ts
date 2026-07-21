import { describe, expect, it } from 'vitest';

import { encodeChr, encodeTile } from './chr-encoder';
import type { Tile } from './types';

function createTile(pixels: Uint8Array): Tile {
  return { id: 0, column: 0, row: 0, pixels };
}

describe('CHR encoding', () => {
  it('encodes a completely empty tile', () => {
    expect(encodeTile(createTile(new Uint8Array(64)))).toEqual(
      new Uint8Array(16),
    );
  });

  it('encodes a tile filled with color index 1', () => {
    const encoded = encodeTile(createTile(new Uint8Array(64).fill(1)));

    expect(encoded.slice(0, 8)).toEqual(new Uint8Array(8).fill(0xff));
    expect(encoded.slice(8)).toEqual(new Uint8Array(8));
  });

  it('encodes all four color indices into separate bitplanes', () => {
    const pixels = new Uint8Array(64);
    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = index % 4;
    }

    const encoded = encodeTile(createTile(pixels));
    expect(encoded.slice(0, 8)).toEqual(new Uint8Array(8).fill(0x55));
    expect(encoded.slice(8)).toEqual(new Uint8Array(8).fill(0x33));
  });

  it('maps the leftmost pixel to bit 7', () => {
    const pixels = new Uint8Array(64);
    pixels[0] = 1;

    const encoded = encodeTile(createTile(pixels));
    expect(encoded[0]).toBe(0x80);
    expect(encoded[8]).toBe(0);
  });

  it('concatenates tiles without deduplication', () => {
    const empty = createTile(new Uint8Array(64));
    const filled = createTile(new Uint8Array(64).fill(1));

    expect(encodeChr([empty, filled])).toHaveLength(32);
  });
});
