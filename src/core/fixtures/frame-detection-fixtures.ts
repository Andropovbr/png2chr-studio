import type { RawImageData } from '../types';

export interface GridCellSpec {
  /** Left edge of the opaque rectangle inside the image (absolute pixels). */
  readonly x: number;
  /** Top edge of the opaque rectangle inside the image (absolute pixels). */
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GridSpec {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly GridCellSpec[];
}

/**
 * Builds an opaque-on-transparent image from a set of white rectangles.
 * Every pixel outside the rectangles stays fully transparent.
 */
export function buildGridImage(spec: GridSpec): RawImageData {
  const data = new Uint8ClampedArray(spec.width * spec.height * 4);
  for (const cell of spec.cells) {
    for (let y = 0; y < cell.height; y += 1) {
      for (let x = 0; x < cell.width; x += 1) {
        const pixel = cell.x + x;
        const row = cell.y + y;
        if (pixel < 0 || row < 0 || pixel >= spec.width || row >= spec.height) {
          continue;
        }
        const index = (row * spec.width + pixel) * 4;
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
        data[index + 3] = 255;
      }
    }
  }
  return { width: spec.width, height: spec.height, data };
}

/** Fully opaque image used as the ambiguous (no usable grid) case. */
export function buildSolidImage(width: number, height: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 200;
    data[index * 4 + 1] = 200;
    data[index * 4 + 2] = 200;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
}

/**
 * Case 1: a 2 x 2 grid of 16 x 8 frames without gutters. Each frame holds a
 * 15 x 7 blob anchored to the top-left corner (single-pixel margins on the
 * right and bottom), which keeps the correct grid unambiguous.
 */
export function frameGrid16x8Fixture(): RawImageData {
  return buildGridImage({
    width: 32,
    height: 16,
    cells: [
      { x: 1, y: 1, width: 15, height: 7 },
      { x: 17, y: 1, width: 15, height: 7 },
      { x: 1, y: 9, width: 15, height: 7 },
      { x: 17, y: 9, width: 15, height: 7 },
    ],
  });
}

/**
 * Case 2: a 2 x 2 grid of 16 x 16 frames without gutters.
 */
export function frameGrid16x16Fixture(): RawImageData {
  return buildGridImage({
    width: 32,
    height: 32,
    cells: [
      { x: 1, y: 1, width: 15, height: 15 },
      { x: 17, y: 1, width: 15, height: 15 },
      { x: 1, y: 17, width: 15, height: 15 },
      { x: 17, y: 17, width: 15, height: 15 },
    ],
  });
}

/**
 * Case 3: a single 16 x 8 cell containing a 13 x 7 blob. The recommended
 * frame must be the full cell (16 x 8), not an 8 x 8 subdivision.
 */
export function singleCell13x7Fixture(): RawImageData {
  return buildGridImage({
    width: 16,
    height: 8,
    cells: [{ x: 3, y: 1, width: 13, height: 7 }],
  });
}

/**
 * Case 4: a 2 x 2 grid of 16 x 8 frames separated by single-pixel transparent
 * gutters (image is 33 x 17). The gutter spacing must drive the detection.
 */
export function gutteredGrid16x8Fixture(): RawImageData {
  return buildGridImage({
    width: 33,
    height: 17,
    cells: [
      { x: 1, y: 1, width: 15, height: 7 },
      { x: 18, y: 1, width: 14, height: 7 },
      { x: 1, y: 9, width: 15, height: 7 },
      { x: 18, y: 9, width: 14, height: 7 },
    ],
  });
}

/**
 * Case 5: a fully opaque image. Every divisor produces an equally plausible
 * (or implausible) grid, so the confidence must be reduced.
 */
export function solidFixture(): RawImageData {
  return buildSolidImage(32, 32);
}

/**
 * Case 6: an irregular sheet mixing 8-pixel and 16-pixel wide frames in the
 * same image, so no single grid fits; detection must not auto-apply.
 */
export function irregularFixture(): RawImageData {
  return buildGridImage({
    width: 40,
    height: 16,
    cells: [
      // Top row: four 8 x 8 frames.
      { x: 0, y: 0, width: 8, height: 8 },
      { x: 8, y: 0, width: 8, height: 8 },
      { x: 16, y: 0, width: 8, height: 8 },
      { x: 24, y: 0, width: 8, height: 8 },
      // Bottom row: two 16 x 8 frames.
      { x: 0, y: 8, width: 16, height: 8 },
      { x: 16, y: 8, width: 16, height: 8 },
    ],
  });
}

/**
 * Case 8: a second, different sheet (an 8 x 8 grid) used to prove that loading
 * a new PNG produces a fresh detection that replaces the previous one.
 */
export function frameGrid8x8Fixture(): RawImageData {
  return buildGridImage({
    width: 16,
    height: 16,
    cells: [
      { x: 0, y: 0, width: 7, height: 7 },
      { x: 9, y: 0, width: 7, height: 7 },
      { x: 0, y: 9, width: 7, height: 7 },
      { x: 9, y: 9, width: 7, height: 7 },
    ],
  });
}
