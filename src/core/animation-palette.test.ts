import { describe, expect, it } from 'vitest';

import {
  createDefaultNesPaletteSet,
  NES_MASTER_PALETTE,
  setNesPaletteColor,
} from './nes-palette';
import {
  mapAnimationImageToNesPalette,
  renderAnimationToRawImageData,
} from './animation-palette';
import type { IndexedImage } from './types';

function opaqueImage(): IndexedImage {
  const colors = [0x0f, 0x11, 0x21, 0x30].map(
    (code) => NES_MASTER_PALETTE[code] ?? null,
  );
  return {
    width: 8,
    height: 8,
    pixels: Uint8Array.from({ length: 64 }, (_, index) => index % 4),
    colors,
    transparentIndex: null,
    colorCount: 4,
  };
}

describe('animation palette mapping', () => {
  it('keeps pixel color indices stable when a palette slot changes', () => {
    const initial = mapAnimationImageToNesPalette(
      opaqueImage(),
      createDefaultNesPaletteSet(),
      0,
      8,
    );
    const changedPalettes = setNesPaletteColor(
      createDefaultNesPaletteSet(),
      0,
      1,
      0x2a,
    );
    const recolored = mapAnimationImageToNesPalette(
      opaqueImage(),
      changedPalettes,
      0,
      8,
      initial.colorIndices,
    );
    const switchedPalette = mapAnimationImageToNesPalette(
      opaqueImage(),
      changedPalettes,
      2,
      8,
      initial.colorIndices,
    );

    expect(Array.from(initial.colorIndices.slice(0, 8))).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3,
    ]);
    expect(recolored.image.pixels).toEqual(initial.image.pixels);
    expect(recolored.colorIndices).not.toBe(initial.colorIndices);
    expect(switchedPalette.image.pixels).toEqual(initial.image.pixels);
    expect(switchedPalette.assignments.every((index) => index === 2)).toBe(
      true,
    );
  });

  it('allows opaque sprite sheets to use palette slot zero', () => {
    const mapping = mapAnimationImageToNesPalette(
      opaqueImage(),
      createDefaultNesPaletteSet(),
      0,
      8,
    );

    expect(mapping.image.pixels[0]).toBe(0);
    expect(new Set(mapping.image.pixels)).toEqual(new Set([0, 1, 2, 3]));
  });

  it('reserves palette slot zero only for transparent pixels', () => {
    const image: IndexedImage = {
      width: 8,
      height: 8,
      pixels: Uint8Array.from({ length: 64 }, (_, index) =>
        index === 0 ? 0 : 1,
      ),
      colors: [null, NES_MASTER_PALETTE[0x0f] ?? null],
      transparentIndex: 0,
      colorCount: 2,
    };
    const mapping = mapAnimationImageToNesPalette(
      image,
      createDefaultNesPaletteSet(),
      0,
      8,
    );

    expect(mapping.image.pixels[0]).toBe(0);
    expect(Array.from(mapping.image.pixels.slice(1))).not.toContain(0);
  });

  it('renders indexed image to raw RGBA image data with transparent alpha and NES colors', () => {
    const palettes = createDefaultNesPaletteSet();
    const image: IndexedImage = {
      width: 2,
      height: 1,
      pixels: Uint8Array.from([0, 1]),
      colors: [null, NES_MASTER_PALETTE[palettes[0][1]] ?? null],
      transparentIndex: 0,
      colorCount: 2,
    };
    const raw = renderAnimationToRawImageData(image, palettes, 0);

    expect(raw.width).toBe(2);
    expect(raw.height).toBe(1);
    // Pixel 0 is transparent: alpha 0
    expect(raw.data[3]).toBe(0);
    // Pixel 1 is opaque: alpha 255
    expect(raw.data[7]).toBe(255);
    const expectedColor = NES_MASTER_PALETTE[palettes[0][1]];
    expect(raw.data[4]).toBe(expectedColor?.red);
    expect(raw.data[5]).toBe(expectedColor?.green);
    expect(raw.data[6]).toBe(expectedColor?.blue);
  });
});
