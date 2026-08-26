import { describe, expect, it } from 'vitest';
import {
  extractFrameTile,
  extractFrameTilePixels,
  extractLogicalAnimationFrame,
  extractLogicalAnimationFrames,
  extractLogicalMetaspriteTiles,
  isTransparentTilePixels,
  transparentTile,
} from './metasprite-extraction';
import type { IndexedImage } from './types';

function createTestIndexedImage(
  width: number,
  height: number,
  filler: (x: number, y: number) => number = () => 0,
): IndexedImage {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = filler(x, y);
    }
  }
  return {
    width,
    height,
    pixels,
    colors: [
      { red: 0, green: 0, blue: 0 },
      { red: 255, green: 0, blue: 0 },
      { red: 0, green: 255, blue: 0 },
      { red: 0, green: 0, blue: 255 },
    ],
    transparentIndex: 0,
    colorCount: 4,
  };
}

describe('metasprite-extraction (Issue #94)', () => {
  describe('isTransparentTilePixels & transparentTile', () => {
    it('identifies 100% transparent pixel buffer (all 0s)', () => {
      const transparent = new Uint8Array(64);
      expect(isTransparentTilePixels(transparent)).toBe(true);
      expect(transparentTile({ pixels: transparent })).toBe(true);
    });

    it('identifies non-transparent pixel buffer when any pixel is non-zero', () => {
      const nonTrans1 = new Uint8Array(64);
      nonTrans1[0] = 1;
      expect(isTransparentTilePixels(nonTrans1)).toBe(false);

      const nonTrans63 = new Uint8Array(64);
      nonTrans63[63] = 3;
      expect(isTransparentTilePixels(nonTrans63)).toBe(false);
    });
  });

  describe('extractFrameTilePixels & extractFrameTile', () => {
    it('extracts exact 8x8 pixel slice from image grid', () => {
      const image = createTestIndexedImage(16, 16, (x, y) => ((x + y) % 3) + 1);
      const rawPixels = extractFrameTilePixels(image, 8, 8);
      const tile = extractFrameTile(image, 8, 8, 0, 0);

      expect(rawPixels.length).toBe(64);
      expect(tile.pixels.length).toBe(64);
      expect(tile.pixels).toEqual(rawPixels);
      expect(tile.column).toBe(0);
      expect(tile.row).toBe(0);
      // Top-left pixel of tile at (8, 8) in image
      expect(tile.pixels[0]).toBe(((8 + 8) % 3) + 1);
      // Pixel at (7, 7) within tile -> (15, 15) in image
      expect(tile.pixels[63]).toBe(((15 + 15) % 3) + 1);
    });
  });

  describe('extractLogicalMetaspriteTiles', () => {
    it('extracts a single visible 8x8 frame', () => {
      const image = createTestIndexedImage(8, 8, () => 1);
      const result = extractLogicalMetaspriteTiles({
        image,
        sourceX: 0,
        sourceY: 0,
        frameWidth: 8,
        frameHeight: 8,
        originX: 0,
        originY: 0,
        assetId: 'hero-asset',
      });

      expect(result.totalCellCount).toBe(1);
      expect(result.omittedTileCount).toBe(0);
      expect(result.sprites.length).toBe(1);

      const sprite = result.sprites[0];
      expect(sprite).toBeDefined();
      if (!sprite) return;

      expect(sprite.tileColumn).toBe(0);
      expect(sprite.tileRow).toBe(0);
      expect(sprite.tileX).toBe(0);
      expect(sprite.tileY).toBe(0);
      expect(sprite.logicalKey).toBe('hero-asset:0:0');
      expect(sprite.x).toBe(0);
      expect(sprite.y).toBe(0);
      expect(sprite.pixels.every((p) => p === 1)).toBe(true);
    });

    it('omits 100% transparent cell and increments omittedTileCount', () => {
      const image = createTestIndexedImage(8, 8, () => 0); // 100% transparent
      const result = extractLogicalMetaspriteTiles({
        image,
        sourceX: 0,
        sourceY: 0,
        frameWidth: 8,
        frameHeight: 8,
        assetId: 'hero-asset',
      });

      expect(result.totalCellCount).toBe(1);
      expect(result.omittedTileCount).toBe(1);
      expect(result.sprites.length).toBe(0);
    });

    it('extracts multi-cell frame (16x16) with transparent cell in the middle without shifting other coordinates', () => {
      // 16x16 frame: 4 cells of 8x8.
      // Top-Left (0,0): visible (1)
      // Top-Right (1,0): transparent (0)
      // Bottom-Left (0,1): transparent (0)
      // Bottom-Right (1,1): visible (2)
      const image = createTestIndexedImage(16, 16, (x, y) => {
        if (x < 8 && y < 8) return 1;
        if (x >= 8 && y >= 8) return 2;
        return 0;
      });

      const result = extractLogicalMetaspriteTiles({
        image,
        sourceX: 0,
        sourceY: 0,
        frameWidth: 16,
        frameHeight: 16,
        originX: 8,
        originY: 8,
        assetId: 'hero-asset',
      });

      expect(result.totalCellCount).toBe(4);
      expect(result.omittedTileCount).toBe(2);
      expect(result.sprites.length).toBe(2);

      const [tl, br] = result.sprites;
      expect(tl).toBeDefined();
      expect(br).toBeDefined();
      if (!tl || !br) return;

      // Top-Left: column 0, row 0 -> relative x = 0 - 8 = -8, relative y = 0 - 8 = -8
      expect(tl.tileColumn).toBe(0);
      expect(tl.tileRow).toBe(0);
      expect(tl.tileX).toBe(0);
      expect(tl.tileY).toBe(0);
      expect(tl.logicalKey).toBe('hero-asset:0:0');
      expect(tl.x).toBe(-8);
      expect(tl.y).toBe(-8);

      // Bottom-Right: column 1, row 1 -> relative x = 8 - 8 = 0, relative y = 8 - 8 = 0
      expect(br.tileColumn).toBe(1);
      expect(br.tileRow).toBe(1);
      expect(br.tileX).toBe(1);
      expect(br.tileY).toBe(1);
      expect(br.logicalKey).toBe('hero-asset:1:1');
      expect(br.x).toBe(0);
      expect(br.y).toBe(0);
    });

    it('calculates canonical logicalKey based on absolute spritesheet coordinates', () => {
      // 32x32 image. Frame 3 at sourceX = 16, sourceY = 16
      const image = createTestIndexedImage(32, 32, () => 2);
      const result = extractLogicalMetaspriteTiles({
        image,
        sourceX: 16,
        sourceY: 16,
        frameWidth: 16,
        frameHeight: 16,
        assetId: 'enemy-walk',
      });

      expect(result.sprites.length).toBe(4);
      // sourceX 16 = tileX 2, sourceY 16 = tileY 2
      expect(result.sprites[0]?.logicalKey).toBe('enemy-walk:2:2');
      expect(result.sprites[1]?.logicalKey).toBe('enemy-walk:3:2');
      expect(result.sprites[2]?.logicalKey).toBe('enemy-walk:2:3');
      expect(result.sprites[3]?.logicalKey).toBe('enemy-walk:3:3');
    });
  });

  describe('extractLogicalAnimationFrame & extractLogicalAnimationFrames', () => {
    it('extracts single frame metadata and logical sprites', () => {
      const image = createTestIndexedImage(16, 16, () => 1);
      const frame = extractLogicalAnimationFrame({
        image,
        sourceIndex: 0,
        sourceX: 0,
        sourceY: 0,
        duration: 8,
        paletteIndex: 2,
        effectivePalette: 2,
        frameWidth: 16,
        frameHeight: 16,
        originX: 4,
        originY: 4,
        assetId: 'hero',
      });

      expect(frame.sourceIndex).toBe(0);
      expect(frame.duration).toBe(8);
      expect(frame.paletteIndex).toBe(2);
      expect(frame.effectivePalette).toBe(2);
      expect(frame.width).toBe(16);
      expect(frame.height).toBe(16);
      expect(frame.omittedTileCount).toBe(0);
      expect(frame.sprites.length).toBe(4);
    });

    it('extracts multiple frames with custom durations and palette overrides', () => {
      const image = createTestIndexedImage(32, 16, () => 1); // 2 frames of 16x16
      const frames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0, 1],
        defaultDuration: 6,
        frameDurations: [4, 8],
        framePalettes: [null, 3],
        defaultPaletteIndex: 1,
        paletteIndex: null,
        frameWidth: 16,
        frameHeight: 16,
        originX: 0,
        originY: 0,
        assetId: 'hero-run',
      });

      expect(frames.length).toBe(2);

      const [f0, f1] = frames;
      expect(f0?.sourceIndex).toBe(0);
      expect(f0?.sourceX).toBe(0);
      expect(f0?.duration).toBe(4);
      expect(f0?.effectivePalette).toBe(1);

      expect(f1?.sourceIndex).toBe(1);
      expect(f1?.sourceX).toBe(16);
      expect(f1?.duration).toBe(8);
      expect(f1?.effectivePalette).toBe(3);
    });

    it('applies pixel overrides so that overridden pixels turn transparent cell into visible', () => {
      const rawImage = createTestIndexedImage(16, 16, () => 0); // 100% transparent initially

      // Pixel override at tile (0, 0) setting pixel offset 0 to color 2
      const pixelOverrides = {
        '0_0': { 0: 2 },
      };

      const frames = extractLogicalAnimationFrames({
        image: rawImage,
        pixelOverrides,
        frameIndices: [0],
        defaultDuration: 6,
        frameWidth: 16,
        frameHeight: 16,
        assetId: 'override-test',
      });

      const frame0 = frames[0];
      expect(frame0).toBeDefined();
      if (!frame0) return;

      // In 16x16, 4 cells total. Cell (0,0) is visible due to override; other 3 remain transparent
      expect(frame0.omittedTileCount).toBe(3);
      expect(frame0.sprites.length).toBe(1);
      expect(frame0.sprites[0]?.tileColumn).toBe(0);
      expect(frame0.sprites[0]?.tileRow).toBe(0);
      expect(frame0.sprites[0]?.pixels[0]).toBe(2);
    });

    it('modifies extracted tile pixels when pixel override modifies an existing visible cell', () => {
      const rawImage = createTestIndexedImage(16, 16, () => 1); // all pixels = 1

      // Modify tile at (1, 1), offset 10 to color 3
      const pixelOverrides = {
        '1_1': { 10: 3 },
      };

      const frames = extractLogicalAnimationFrames({
        image: rawImage,
        pixelOverrides,
        frameIndices: [0],
        defaultDuration: 6,
        frameWidth: 16,
        frameHeight: 16,
        assetId: 'override-modify-test',
      });

      const frame0 = frames[0];
      expect(frame0?.sprites.length).toBe(4);
      const sprite11 = frame0?.sprites.find(
        (s) => s.tileColumn === 1 && s.tileRow === 1,
      );
      expect(sprite11).toBeDefined();
      expect(sprite11?.pixels[10]).toBe(3);
      expect(sprite11?.pixels[0]).toBe(1);
    });

    it('handles non-square frame dimensions (e.g. 24x32, 3x4 tiles)', () => {
      const image = createTestIndexedImage(24, 32, () => 2);
      const frames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0],
        defaultDuration: 5,
        frameWidth: 24,
        frameHeight: 32,
        originX: 12,
        originY: 24,
        assetId: 'tall-sprite',
      });

      expect(frames.length).toBe(1);
      const frame = frames[0];
      expect(frame?.sprites.length).toBe(12); // 3 cols * 4 rows = 12 tiles

      // Top-left: (0, 0) -> x = 0 - 12 = -12, y = 0 - 24 = -24
      const tl = frame?.sprites[0];
      expect(tl?.x).toBe(-12);
      expect(tl?.y).toBe(-24);
      expect(tl?.logicalKey).toBe('tall-sprite:0:0');

      // Bottom-right: (2, 3) -> x = 16 - 12 = 4, y = 24 - 24 = 0
      const br = frame?.sprites[11];
      expect(br?.x).toBe(4);
      expect(br?.y).toBe(0);
      expect(br?.logicalKey).toBe('tall-sprite:2:3');
    });

    it('ensures LogicalTileKey is strictly stable regardless of frame order or extraction order', () => {
      const image = createTestIndexedImage(32, 32, () => 1);

      // Extract frame 1 (tileX 2..3, tileY 0..1) first, then frame 0 (tileX 0..1, tileY 0..1)
      const framesReversed = extractLogicalAnimationFrames({
        image,
        frameIndices: [1, 0],
        defaultDuration: 5,
        frameWidth: 16,
        frameHeight: 16,
        assetId: 'order-test',
      });

      const frame1Sprites = framesReversed[0]?.sprites;
      const frame0Sprites = framesReversed[1]?.sprites;

      expect(frame1Sprites?.[0]?.logicalKey).toBe('order-test:2:0');
      expect(frame0Sprites?.[0]?.logicalKey).toBe('order-test:0:0');
    });

    it('guarantees immutability and does not mutate input image or parameters', () => {
      const image = createTestIndexedImage(16, 16, () => 1);
      const originalImageBytes = new Uint8Array(image.pixels);
      const frameIndices = [0];

      const frames = extractLogicalAnimationFrames({
        image,
        frameIndices,
        defaultDuration: 6,
        frameWidth: 16,
        frameHeight: 16,
        assetId: 'immutable-test',
      });

      expect(frames.length).toBe(1);
      expect(image.pixels).toEqual(originalImageBytes);
      expect(Object.isFrozen(frames)).toBe(true);
      expect(Object.isFrozen(frames[0]?.sprites)).toBe(true);
    });
  });
});
