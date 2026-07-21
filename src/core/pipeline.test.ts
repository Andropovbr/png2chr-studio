import { describe, expect, it } from 'vitest';

import { encodeChr } from './chr-encoder';
import { analyzeImage } from './image-analysis';
import { extractTiles } from './tile-extraction';

describe('PNG pixel to CHR pipeline', () => {
  it('preserves left-to-right tile order through CHR encoding', () => {
    const rgba = new Uint8ClampedArray(16 * 8 * 4);

    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 16; column += 1) {
        const offset = (row * 16 + column) * 4;
        const channel = column < 8 ? 0 : 255;
        rgba[offset] = channel;
        rgba[offset + 1] = channel;
        rgba[offset + 2] = channel;
        rgba[offset + 3] = 255;
      }
    }

    const indexedImage = analyzeImage({ width: 16, height: 8, data: rgba });
    const tiles = extractTiles(indexedImage);
    const chr = encodeChr(tiles);

    expect(chr).toHaveLength(32);
    expect(chr.slice(0, 16)).toEqual(new Uint8Array(16));
    expect(chr.slice(16, 24)).toEqual(new Uint8Array(8).fill(0xff));
    expect(chr.slice(24, 32)).toEqual(new Uint8Array(8));
  });
});
