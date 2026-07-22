import { describe, expect, it } from 'vitest';

import { analyzeImage } from './image-analysis';
import { ImageAnalysisError, type RawImageData } from './types';

function createImage(
  colors: readonly (readonly [number, number, number, number])[],
): RawImageData {
  const data = new Uint8ClampedArray(8 * 8 * 4);

  for (let pixelIndex = 0; pixelIndex < 64; pixelIndex += 1) {
    const color = colors[pixelIndex % colors.length];
    if (color === undefined) {
      throw new Error('At least one test color is required.');
    }
    data.set(color, pixelIndex * 4);
  }

  return { width: 8, height: 8, data };
}

function captureAnalysisError(operation: () => unknown): ImageAnalysisError {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof ImageAnalysisError) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected image analysis to fail.');
}

describe('image analysis', () => {
  it('always maps complete transparency to index 0', () => {
    const image = createImage([
      [255, 0, 0, 255],
      [12, 34, 56, 0],
    ]);

    const result = analyzeImage(image);

    expect(result.transparentIndex).toBe(0);
    expect(result.pixels[0]).toBe(1);
    expect(result.pixels[1]).toBe(0);
    expect(result.colors[1]).toEqual({ red: 255, green: 0, blue: 0 });
  });

  it('rejects partial transparency', () => {
    const image = createImage([[255, 0, 0, 128]]);

    const error = captureAnalysisError(() => analyzeImage(image));

    expect(error.code).toBe('partial-transparency');
    expect(error.details.pixelIndex).toBe(0);
  });

  it('accepts source images with more than four colors for later NES quantization', () => {
    const image = createImage([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 0, 255],
      [255, 0, 255, 255],
    ]);

    const result = analyzeImage(image);

    expect(result.colorCount).toBe(5);
    expect(new Set(result.pixels).size).toBe(5);
  });

  it('keeps opaque colors in first-occurrence order', () => {
    const image = createImage([
      [0, 0, 255, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);

    const result = analyzeImage(image);

    expect(result.colors.slice(0, 2)).toEqual([
      { red: 0, green: 0, blue: 255 },
      { red: 255, green: 0, blue: 0 },
    ]);
    expect(Array.from(result.pixels.slice(0, 3))).toEqual([0, 1, 0]);
  });
});
