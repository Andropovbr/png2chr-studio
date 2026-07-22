import { describe, expect, it } from 'vitest';

import type { IndexedImage } from './types';
import {
  assignPalettePreservingPixelIndices,
  createDefaultNesPaletteSet,
  createPaletteAssignments,
  createPixelOverrides,
  encodeNesBackgroundPalettes,
  encodePlayfieldAttributeTable,
  mapImageToNesPalettes,
  NES_MASTER_PALETTE,
  renderNesPaletteImage,
  setNesPaletteColor,
} from './nes-palette';

describe('NES palettes', () => {
  it('exposes exactly the 64 color codes supported by the PPU', () => {
    expect(NES_MASTER_PALETTE).toHaveLength(64);
  });

  it('keeps the universal background color shared by all four palettes', () => {
    const palettes = setNesPaletteColor(
      createDefaultNesPaletteSet(),
      2,
      0,
      0x20,
    );

    expect(palettes.map((palette) => palette[0])).toEqual([
      0x20, 0x20, 0x20, 0x20,
    ]);
    expect(encodeNesBackgroundPalettes(palettes)).toHaveLength(16);
  });

  it('starts palette 3 with a distinct purple color ramp', () => {
    const palettes = createDefaultNesPaletteSet();
    const earlierColorCodes = new Set(
      palettes.slice(0, 3).flatMap((palette) => palette.slice(1)),
    );

    expect(palettes[3]).toEqual([0x0f, 0x03, 0x13, 0x23]);
    expect(
      palettes[3].slice(1).every((code) => !earlierColorCodes.has(code)),
    ).toBe(true);
  });

  it('rejects colors outside the NES 6-bit range', () => {
    expect(() =>
      setNesPaletteColor(createDefaultNesPaletteSet(), 0, 1, 0x40),
    ).toThrow(RangeError);
  });

  it('maps source colors to local two-bit indices in each assigned region', () => {
    const image: IndexedImage = {
      width: 16,
      height: 8,
      pixels: Uint8Array.from({ length: 128 }, (_, index) =>
        index % 16 < 8 ? 0 : 1,
      ),
      colors: [
        { red: 120, green: 124, blue: 236 },
        { red: 152, green: 34, blue: 32 },
      ],
      transparentIndex: null,
      colorCount: 2,
    };
    const assignments = Uint8Array.of(0, 1);
    const mapped = mapImageToNesPalettes(
      image,
      createDefaultNesPaletteSet(),
      assignments,
      8,
    );

    expect(mapped.pixels[0]).toBe(2);
    expect(mapped.pixels[8]).toBe(2);
    expect(Math.max(...mapped.pixels)).toBeLessThanOrEqual(3);
  });

  it('supports all four manually painted color indices inside one tile', () => {
    const image: IndexedImage = {
      width: 8,
      height: 8,
      pixels: new Uint8Array(64),
      colors: [{ red: 0, green: 0, blue: 0 }],
      transparentIndex: null,
      colorCount: 1,
    };
    const overrides = createPixelOverrides(8, 8);
    overrides.set([0, 1, 2, 3], 8);

    const mapped = mapImageToNesPalettes(
      image,
      createDefaultNesPaletteSet(),
      Uint8Array.of(0),
      8,
      overrides,
    );

    expect(Array.from(mapped.pixels.slice(8, 12))).toEqual([0, 1, 2, 3]);
  });

  it('preserves existing CHR indices when assigning another palette', () => {
    const image: IndexedImage = {
      width: 8,
      height: 8,
      pixels: Uint8Array.from({ length: 64 }, (_, index) => index % 4),
      colors: createDefaultNesPaletteSet()[0].map(
        (code) => NES_MASTER_PALETTE[code] ?? null,
      ),
      transparentIndex: null,
      colorCount: 4,
    };
    const result = assignPalettePreservingPixelIndices(
      image,
      createDefaultNesPaletteSet(),
      Uint8Array.of(0),
      8,
      createPixelOverrides(8, 8),
      0,
      3,
    );

    expect(result.assignments[0]).toBe(3);
    expect(Array.from(result.pixelOverrides.slice(0, 8))).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3,
    ]);
  });

  it('renders every region with its assigned palette', () => {
    const palettes = createDefaultNesPaletteSet();
    const image: IndexedImage = {
      width: 16,
      height: 8,
      pixels: new Uint8Array(128).fill(1),
      colors: palettes[0].map((code) => NES_MASTER_PALETTE[code] ?? null),
      transparentIndex: null,
      colorCount: 4,
    };
    const rgba = renderNesPaletteImage(image, palettes, Uint8Array.of(0, 3), 8);

    expect(Array.from(rgba.slice(0, 3))).toEqual([
      NES_MASTER_PALETTE[0x11]?.red,
      NES_MASTER_PALETTE[0x11]?.green,
      NES_MASTER_PALETTE[0x11]?.blue,
    ]);
    expect(Array.from(rgba.slice(8 * 4, 8 * 4 + 3))).toEqual([
      NES_MASTER_PALETTE[0x03]?.red,
      NES_MASTER_PALETTE[0x03]?.green,
      NES_MASTER_PALETTE[0x03]?.blue,
    ]);
  });

  it('encodes four 16 x 16 assignments into each attribute byte', () => {
    const assignments = createPaletteAssignments(256, 240, 16);
    assignments[0] = 3;
    assignments[1] = 1;
    assignments[16] = 2;
    assignments[17] = 2;

    const attributes = encodePlayfieldAttributeTable(assignments);

    expect(attributes).toHaveLength(64);
    expect(attributes[0]).toBe(0xa7);
    expect(attributes[63]).toBe(0);
  });
});
