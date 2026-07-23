import { describe, expect, it } from 'vitest';

import {
  ChrDecodingError,
  chrTilesToIndexedImage,
  decodeChr,
  decodeChrTile,
} from './chr-decoder';
import { encodeChr, encodeTile } from './chr-encoder';
import type { Tile } from './types';

const PREVIEW_COLORS = [
  { red: 0, green: 0, blue: 0 },
  { red: 1, green: 1, blue: 1 },
  { red: 2, green: 2, blue: 2 },
  { red: 3, green: 3, blue: 3 },
];

function tileWithFourColors(): Tile {
  return {
    id: 0,
    column: 0,
    row: 0,
    pixels: Uint8Array.from({ length: 64 }, (_, index) => index % 4),
  };
}

describe('CHR decoding', () => {
  it('decodes both NES bitplanes into four color indices', () => {
    const decoded = decodeChrTile(encodeTile(tileWithFourColors()));

    expect(Array.from(decoded.pixels.slice(0, 8))).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3,
    ]);
  });

  it('round-trips a sequence of CHR tiles', () => {
    const source = [
      tileWithFourColors(),
      { ...tileWithFourColors(), pixels: new Uint8Array(64).fill(3) },
    ];
    const decoded = decodeChr(encodeChr(source));

    expect(decoded).toHaveLength(2);
    expect(encodeChr(decoded)).toEqual(encodeChr(source));
  });

  it('lays out imported tiles in rows of 16', () => {
    const decoded = decodeChr(new Uint8Array(17 * 16));

    expect(decoded[15]).toMatchObject({ column: 15, row: 0 });
    expect(decoded[16]).toMatchObject({ column: 0, row: 1 });
  });

  it('builds a compact indexed preview without adding exportable tiles', () => {
    const tiles = decodeChr(
      encodeChr([tileWithFourColors(), tileWithFourColors()]),
    );
    const image = chrTilesToIndexedImage(tiles, PREVIEW_COLORS);

    expect(image).toMatchObject({ width: 16, height: 8, colorCount: 4 });
    expect(Array.from(image.pixels.slice(0, 8))).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3,
    ]);
    expect(Array.from(image.pixels.slice(8, 16))).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3,
    ]);
  });

  it.each([
    ['empty-file', new Uint8Array()],
    ['invalid-size', new Uint8Array(17)],
  ] as const)('rejects %s input', (code, bytes) => {
    expect(() => decodeChr(bytes)).toThrow(
      expect.objectContaining<Partial<ChrDecodingError>>({ code }),
    );
  });
});
