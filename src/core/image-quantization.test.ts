import { describe, expect, it } from 'vitest';
import { NES_MASTER_PALETTE } from './nes-palette';
import { quantizeImageToNes } from './image-quantization';
import { analyzeImage } from './image-analysis';
import {
  DITHERING_MODES,
  QUANTIZATION_MODES,
  type QuantizationSettings,
} from './quantization-settings';
import {
  gradientFixture,
  outlinedDetailFixture,
  pixelArtFixture,
  transparencyFixture,
} from './fixtures/quantization-fixtures';
import type { RawImageData, RgbColor } from './types';

const availableColors = NES_MASTER_PALETTE.slice(0, 32);

function key(color: RgbColor): string {
  return `${String(color.red)},${String(color.green)},${String(color.blue)}`;
}

function settings(
  quantizationMode: QuantizationSettings['quantizationMode'],
  ditheringMode: QuantizationSettings['ditheringMode'] = 'none',
): QuantizationSettings {
  return {
    quantizationMode,
    ditheringMode,
    colorDistanceMode: 'perceptual',
  };
}

function opaqueOutputColors(image: RawImageData): Set<string> {
  const colors = new Set<string>();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    colors.add(
      key({
        red: image.data[offset] ?? 0,
        green: image.data[offset + 1] ?? 0,
        blue: image.data[offset + 2] ?? 0,
      }),
    );
  }
  return colors;
}

describe('PNG quantization pipeline', () => {
  it.each(QUANTIZATION_MODES)(
    '%s produces no more than the requested number of NES colors',
    (mode) => {
      const result = quantizeImageToNes(
        gradientFixture,
        availableColors,
        4,
        settings(mode),
      );
      const outputColors = opaqueOutputColors(result.image);
      const nesColors = new Set(NES_MASTER_PALETTE.map(key));
      expect(outputColors.size).toBeLessThanOrEqual(4);
      outputColors.forEach((color) => {
        expect(nesColors.has(color)).toBe(true);
      });
      expect(result.palette.length).toBeLessThanOrEqual(4);
    },
  );

  it('reduces PNGs with more than 256 source colors before indexed analysis', () => {
    const result = quantizeImageToNes(
      gradientFixture,
      availableColors,
      13,
      settings('median-cut'),
    );
    const indexed = analyzeImage(result.image);

    expect(indexed.colorCount).toBeLessThanOrEqual(13);
    expect(indexed.pixels).toHaveLength(32 * 16);
  });

  it.each(DITHERING_MODES)('%s preserves transparent pixels', (mode) => {
    const result = quantizeImageToNes(
      transparencyFixture,
      availableColors,
      4,
      settings('median-cut', mode),
    );
    for (let offset = 3; offset < result.image.data.length; offset += 4) {
      expect(result.image.data[offset]).toBe(transparencyFixture.data[offset]);
    }
  });

  it('does not diffuse errors into or through transparent pixels', () => {
    const data = new Uint8ClampedArray([
      110, 110, 110, 255, 255, 0, 255, 0, 180, 180, 180, 255,
    ]);
    const isolated = quantizeImageToNes(
      { width: 3, height: 1, data },
      [
        { red: 0, green: 0, blue: 0 },
        { red: 236, green: 238, blue: 236 },
      ],
      2,
      settings('nearest', 'floyd-steinberg'),
    );
    const independent = quantizeImageToNes(
      {
        width: 3,
        height: 1,
        data: new Uint8ClampedArray([
          110, 110, 110, 255, 0, 0, 0, 0, 180, 180, 180, 255,
        ]),
      },
      [
        { red: 0, green: 0, blue: 0 },
        { red: 236, green: 238, blue: 236 },
      ],
      2,
      settings('nearest', 'floyd-steinberg'),
    );
    expect(isolated.image.data).toEqual(independent.image.data);
    expect(isolated.image.data[7]).toBe(0);
  });

  it('keeps K-Means output deterministic', () => {
    const first = quantizeImageToNes(
      outlinedDetailFixture,
      availableColors,
      4,
      settings('k-means', 'atkinson'),
    );
    const second = quantizeImageToNes(
      outlinedDetailFixture,
      availableColors,
      4,
      settings('k-means', 'atkinson'),
    );
    expect(first.palette).toEqual(second.palette);
    expect(first.image.data).toEqual(second.image.data);
  });

  it.each(['bayer-4x4', 'bayer-8x8'] as const)(
    'keeps %s output deterministic',
    (mode) => {
      const first = quantizeImageToNes(
        gradientFixture,
        availableColors,
        4,
        settings('median-cut', mode),
      );
      const second = quantizeImageToNes(
        gradientFixture,
        availableColors,
        4,
        settings('median-cut', mode),
      );
      expect(first.image.data).toEqual(second.image.data);
    },
  );

  it('keeps existing NES pixel art stable with Nearest + None', () => {
    const result = quantizeImageToNes(
      pixelArtFixture,
      NES_MASTER_PALETTE,
      4,
      settings('nearest'),
    );
    expect(result.image.data).toEqual(pixelArtFixture.data);
  });
});
