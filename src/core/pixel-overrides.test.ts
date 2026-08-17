import { describe, expect, it } from 'vitest';
import {
  applyPixelOverridesToImage,
  calculateTileCoordinates,
  extractTileFromIndexedImage,
  getTileKey,
  getTileOverride,
  hasTileOverride,
  parseTileKey,
  resetSinglePixelOverride,
  resetTileOverride,
  setTilePixelOverride,
  type TilePixelOverrides,
} from './pixel-overrides';
import type { IndexedImage } from './types';

function createBlankIndexedImage(width = 16, height = 16): IndexedImage {
  return {
    width,
    height,
    colors: [
      { red: 0, green: 0, blue: 0 },
      { red: 255, green: 0, blue: 0 },
      { red: 0, green: 255, blue: 0 },
      { red: 0, green: 0, blue: 255 },
    ],
    transparentIndex: 0,
    colorCount: 4,
    pixels: new Uint8Array(width * height), // all 0
  };
}

describe('pixel-overrides domain module', () => {
  it('computes and parses stable tile coordinate keys', () => {
    expect(getTileKey(0, 0)).toBe('0_0');
    expect(getTileKey(3, 7)).toBe('3_7');
    expect(parseTileKey('3_7')).toEqual({ tileX: 3, tileY: 7 });
    expect(parseTileKey('invalid')).toBeNull();
    expect(parseTileKey('-1_2')).toBeNull();

    // From frame position + tile column/row
    const coords = calculateTileCoordinates(16, 32, 1, 0); // sourceX=16 (col 2), sourceY=32 (row 4) + tileCol 1
    expect(coords).toEqual({ tileX: 3, tileY: 4 });
  });

  it('sets individual pixel override and clamps values strictly to 0..3', () => {
    let overrides: TilePixelOverrides = {};

    overrides = setTilePixelOverride(overrides, 0, 0, 2, 3, 2); // tile (0,0), pixel (2,3) = index 2
    expect(hasTileOverride(overrides, 0, 0)).toBe(true);
    expect(hasTileOverride(overrides, 1, 0)).toBe(false);

    const tileData = getTileOverride(overrides, 0, 0);
    expect(tileData).toBeDefined();
    expect(tileData?.[3 * 8 + 2]).toBe(2);

    // Clamp out-of-range value
    overrides = setTilePixelOverride(overrides, 0, 0, 0, 0, 99);
    expect(getTileOverride(overrides, 0, 0)?.[0]).toBe(3);
  });

  it('composites sparse overrides over an indexed image non-destructively', () => {
    const base = createBlankIndexedImage(16, 16);
    base.pixels[0] = 1; // base pixel at (0,0) is 1

    let overrides: TilePixelOverrides = {};
    // Override pixel at (1,0) of tile (0,0) to index 3
    overrides = setTilePixelOverride(overrides, 0, 0, 1, 0, 3);
    // Override pixel at (0,0) of tile (1,1) (global x=8, y=8) to index 2
    overrides = setTilePixelOverride(overrides, 1, 1, 0, 0, 2);

    const composited = applyPixelOverridesToImage(base, overrides);

    // Original base image is unchanged
    expect(base.pixels[1]).toBe(0);

    // Composited image has base + overrides
    expect(composited.pixels[0]).toBe(1); // kept from base untouched
    expect(composited.pixels[1]).toBe(3); // overridden
    expect(composited.pixels[8 * 16 + 8]).toBe(2); // overridden at (8,8)
  });

  it('resets a single pixel override back to automatic generated value', () => {
    let overrides: TilePixelOverrides = {};

    overrides = setTilePixelOverride(overrides, 0, 0, 2, 2, 3);
    overrides = setTilePixelOverride(overrides, 0, 0, 3, 3, 2);
    expect(hasTileOverride(overrides, 0, 0)).toBe(true);

    // Reset only pixel (2,2)
    overrides = resetSinglePixelOverride(overrides, 0, 0, 2, 2);
    expect(hasTileOverride(overrides, 0, 0)).toBe(true);
    expect(getTileOverride(overrides, 0, 0)?.[2 * 8 + 2]).toBeUndefined();
    expect(getTileOverride(overrides, 0, 0)?.[3 * 8 + 3]).toBe(2);

    // Reset remaining pixel (3,3) -> tile override becomes empty and is cleaned up
    overrides = resetSinglePixelOverride(overrides, 0, 0, 3, 3);
    expect(hasTileOverride(overrides, 0, 0)).toBe(false);
  });

  it('resets entire tile override back to automatic generated values', () => {
    const base = createBlankIndexedImage(16, 16);
    let overrides: TilePixelOverrides = {};

    overrides = setTilePixelOverride(overrides, 0, 0, 4, 4, 3);
    expect(hasTileOverride(overrides, 0, 0)).toBe(true);

    overrides = resetTileOverride(overrides, 0, 0);
    expect(hasTileOverride(overrides, 0, 0)).toBe(false);

    const composited = applyPixelOverridesToImage(base, overrides);
    expect(composited.pixels[4 * 16 + 4]).toBe(0);
  });

  it('retains sparse overrides when base image quantization changes underneath', () => {
    let overrides: TilePixelOverrides = {};
    overrides = setTilePixelOverride(overrides, 0, 0, 5, 5, 2);

    // User changes quantizer from median-cut to k-means:
    // Base image now has new automatic indices (e.g. index 1 at (0,0) and (5,5))
    const baseNew = createBlankIndexedImage(16, 16);
    baseNew.pixels[0] = 1;
    baseNew.pixels[5 * 16 + 5] = 1;

    const merged = applyPixelOverridesToImage(baseNew, overrides);
    // Base generated pixel at (0,0) is adopted from new quantizer
    expect(merged.pixels[0]).toBe(1);
    // Overridden pixel at (5,5) wins over newly generated pixel
    expect(merged.pixels[5 * 16 + 5]).toBe(2);
  });

  it('extracts tile pixels with overrides applied', () => {
    const base = createBlankIndexedImage(16, 16);
    base.pixels[0] = 1;

    let overrides: TilePixelOverrides = {};
    overrides = setTilePixelOverride(overrides, 0, 0, 1, 0, 3);

    const tilePixels = extractTileFromIndexedImage(base, 0, 0, overrides);
    expect(tilePixels[0]).toBe(1); // from base
    expect(tilePixels[1]).toBe(3); // from override
    expect(tilePixels[2]).toBe(0); // untouched 0
  });
});
