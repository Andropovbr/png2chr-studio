import type { IndexedImage, RgbColor } from './types';

export const NES_COLOR_COUNT = 64;
export const NES_BACKGROUND_PALETTE_COUNT = 4;
export const NES_COLORS_PER_PALETTE = 4;
export const PLAYFIELD_PALETTE_COLUMNS = 16;
export const PLAYFIELD_PALETTE_ROWS = 15;
export const PLAYFIELD_PALETTE_REGION_SIZE = 16;
export const TILESET_PALETTE_REGION_SIZE = 8;
export const NO_PIXEL_OVERRIDE = 0xff;

export type NesPalette = readonly [number, number, number, number];
export type NesPaletteSet = readonly [
  NesPalette,
  NesPalette,
  NesPalette,
  NesPalette,
];

// Common NTSC 2C02 sRGB approximation. The exported values remain the
// hardware palette indices $00-$3F, not these preview colors.
const NES_MASTER_RGB: readonly (readonly [number, number, number])[] = [
  [84, 84, 84],
  [0, 30, 116],
  [8, 16, 144],
  [48, 0, 136],
  [68, 0, 100],
  [92, 0, 48],
  [84, 4, 0],
  [60, 24, 0],
  [32, 42, 0],
  [8, 58, 0],
  [0, 64, 0],
  [0, 60, 0],
  [0, 50, 60],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [152, 150, 152],
  [8, 76, 196],
  [48, 50, 236],
  [92, 30, 228],
  [136, 20, 176],
  [160, 20, 100],
  [152, 34, 32],
  [120, 60, 0],
  [84, 90, 0],
  [40, 114, 0],
  [8, 124, 0],
  [0, 118, 40],
  [0, 102, 120],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [236, 238, 236],
  [76, 154, 236],
  [120, 124, 236],
  [176, 98, 236],
  [228, 84, 236],
  [236, 88, 180],
  [236, 106, 100],
  [212, 136, 32],
  [160, 170, 0],
  [116, 196, 0],
  [76, 208, 32],
  [56, 204, 108],
  [56, 180, 204],
  [60, 60, 60],
  [0, 0, 0],
  [0, 0, 0],
  [236, 238, 236],
  [168, 204, 236],
  [188, 188, 236],
  [212, 178, 236],
  [236, 174, 236],
  [236, 174, 212],
  [236, 180, 176],
  [228, 196, 144],
  [204, 210, 120],
  [180, 222, 120],
  [168, 226, 144],
  [152, 226, 180],
  [160, 214, 228],
  [160, 162, 160],
  [0, 0, 0],
  [0, 0, 0],
];

export const NES_MASTER_PALETTE: readonly RgbColor[] = NES_MASTER_RGB.map(
  ([red, green, blue]) => ({ red, green, blue }),
);

const DEFAULT_PALETTE_CODES: NesPaletteSet = [
  [0x0f, 0x11, 0x21, 0x30],
  [0x0f, 0x06, 0x16, 0x26],
  [0x0f, 0x09, 0x19, 0x29],
  [0x0f, 0x03, 0x13, 0x23],
];

function assertNesColorCode(colorCode: number): void {
  if (!Number.isInteger(colorCode) || colorCode < 0 || colorCode >= 64) {
    throw new RangeError('NES color codes must be between $00 and $3F.');
  }
}

export function createDefaultNesPaletteSet(): NesPaletteSet {
  return DEFAULT_PALETTE_CODES.map((palette) => [
    ...palette,
  ]) as unknown as NesPaletteSet;
}

export function setNesPaletteColor(
  paletteSet: NesPaletteSet,
  paletteIndex: number,
  colorIndex: number,
  colorCode: number,
): NesPaletteSet {
  if (paletteIndex < 0 || paletteIndex >= NES_BACKGROUND_PALETTE_COUNT) {
    throw new RangeError(
      'NES background palette indices must be between 0 and 3.',
    );
  }
  if (colorIndex < 0 || colorIndex >= NES_COLORS_PER_PALETTE) {
    throw new RangeError('NES palette color indices must be between 0 and 3.');
  }
  assertNesColorCode(colorCode);

  const next: number[][] = paletteSet.map((palette) => [...palette]);
  if (colorIndex === 0) {
    next.forEach((palette) => {
      palette[0] = colorCode;
    });
  } else {
    const palette = next[paletteIndex];
    if (palette !== undefined) {
      palette[colorIndex] = colorCode;
    }
  }
  return next as unknown as NesPaletteSet;
}

export function encodeNesBackgroundPalettes(
  paletteSet: NesPaletteSet,
): Uint8Array {
  const bytes = new Uint8Array(16);
  paletteSet.forEach((palette, paletteIndex) => {
    palette.forEach((colorCode, colorIndex) => {
      assertNesColorCode(colorCode);
      bytes[paletteIndex * 4 + colorIndex] = colorCode;
    });
  });
  return bytes;
}

export function createPaletteAssignments(
  imageWidth: number,
  imageHeight: number,
  regionSize: number,
): Uint8Array {
  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    regionSize <= 0 ||
    imageWidth % regionSize !== 0 ||
    imageHeight % regionSize !== 0
  ) {
    throw new RangeError('Palette regions must divide the image exactly.');
  }
  return new Uint8Array((imageWidth / regionSize) * (imageHeight / regionSize));
}

export function createPixelOverrides(
  imageWidth: number,
  imageHeight: number,
): Uint8Array {
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new RangeError('Pixel override dimensions must be positive.');
  }
  return new Uint8Array(imageWidth * imageHeight).fill(NO_PIXEL_OVERRIDE);
}

function colorDistance(left: RgbColor, right: RgbColor): number {
  const red = left.red - right.red;
  const green = left.green - right.green;
  const blue = left.blue - right.blue;
  return red * red + green * green + blue * blue;
}

export function mapImageToNesPalettes(
  image: IndexedImage,
  paletteSet: NesPaletteSet,
  assignments: Uint8Array,
  regionSize: number,
  pixelOverrides?: Uint8Array,
): IndexedImage {
  const regionColumns = image.width / regionSize;
  const regionRows = image.height / regionSize;
  if (
    !Number.isInteger(regionColumns) ||
    !Number.isInteger(regionRows) ||
    assignments.length !== regionColumns * regionRows
  ) {
    throw new RangeError('Palette assignments do not match the image regions.');
  }
  if (
    pixelOverrides !== undefined &&
    pixelOverrides.length !== image.pixels.length
  ) {
    throw new RangeError('Pixel overrides do not match the image dimensions.');
  }

  const pixels = new Uint8Array(image.pixels.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixelOffset = y * image.width + x;
      const override = pixelOverrides?.[pixelOffset];
      if (override !== undefined && override !== NO_PIXEL_OVERRIDE) {
        if (override > 3) {
          throw new RangeError('CHR pixel overrides must be between 0 and 3.');
        }
        pixels[pixelOffset] = override;
        continue;
      }
      const sourceIndex = image.pixels[pixelOffset] ?? 0;
      if (image.transparentIndex === sourceIndex) {
        pixels[pixelOffset] = 0;
        continue;
      }
      const sourceColor = image.colors[sourceIndex];
      if (sourceColor === undefined || sourceColor === null) {
        throw new RangeError('The indexed image contains an unassigned color.');
      }
      const regionIndex =
        Math.floor(y / regionSize) * regionColumns + Math.floor(x / regionSize);
      const paletteIndex = assignments[regionIndex] ?? 0;
      const palette = paletteSet[paletteIndex];
      if (palette === undefined) {
        throw new RangeError('Palette assignments must be between 0 and 3.');
      }

      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      palette.forEach((colorCode, colorIndex) => {
        const nesColor = NES_MASTER_PALETTE[colorCode];
        if (nesColor === undefined) {
          throw new RangeError(
            'The palette contains an unsupported NES color.',
          );
        }
        const distance = colorDistance(sourceColor, nesColor);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = colorIndex;
        }
      });
      pixels[pixelOffset] = nearestIndex;
    }
  }

  return {
    ...image,
    pixels,
    colors: paletteSet[0].map((code) => NES_MASTER_PALETTE[code] ?? null),
    transparentIndex: image.transparentIndex === null ? null : 0,
    colorCount: 4,
  };
}

export function assignPalettePreservingPixelIndices(
  image: IndexedImage,
  paletteSet: NesPaletteSet,
  assignments: Uint8Array,
  regionSize: number,
  pixelOverrides: Uint8Array,
  regionIndex: number,
  paletteIndex: number,
): { assignments: Uint8Array; pixelOverrides: Uint8Array } {
  const regionColumns = image.width / regionSize;
  const regionRows = image.height / regionSize;
  if (
    !Number.isInteger(regionColumns) ||
    !Number.isInteger(regionRows) ||
    regionIndex < 0 ||
    regionIndex >= regionColumns * regionRows ||
    paletteIndex < 0 ||
    paletteIndex >= NES_BACKGROUND_PALETTE_COUNT
  ) {
    throw new RangeError('Palette assignment is outside the image regions.');
  }

  const nextAssignments = assignments.slice();
  const nextOverrides = pixelOverrides.slice();
  if (nextAssignments[regionIndex] === paletteIndex) {
    return { assignments: nextAssignments, pixelOverrides: nextOverrides };
  }

  const mapped = mapImageToNesPalettes(
    image,
    paletteSet,
    assignments,
    regionSize,
    pixelOverrides,
  );
  const regionColumn = regionIndex % regionColumns;
  const regionRow = Math.floor(regionIndex / regionColumns);
  const startX = regionColumn * regionSize;
  const startY = regionRow * regionSize;
  for (let y = startY; y < startY + regionSize; y += 1) {
    for (let x = startX; x < startX + regionSize; x += 1) {
      const pixelIndex = y * image.width + x;
      nextOverrides[pixelIndex] = mapped.pixels[pixelIndex] ?? 0;
    }
  }
  nextAssignments[regionIndex] = paletteIndex;
  return { assignments: nextAssignments, pixelOverrides: nextOverrides };
}

export function renderNesPaletteImage(
  image: IndexedImage,
  paletteSet: NesPaletteSet,
  assignments: Uint8Array,
  regionSize: number,
): Uint8ClampedArray<ArrayBuffer> {
  const regionColumns = image.width / regionSize;
  const regionRows = image.height / regionSize;
  if (
    !Number.isInteger(regionColumns) ||
    !Number.isInteger(regionRows) ||
    assignments.length !== regionColumns * regionRows
  ) {
    throw new RangeError('Palette assignments do not match the image regions.');
  }

  const rgba: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(
    image.width * image.height * 4,
  );
  for (let pixelIndex = 0; pixelIndex < image.pixels.length; pixelIndex += 1) {
    const x = pixelIndex % image.width;
    const y = Math.floor(pixelIndex / image.width);
    const regionIndex =
      Math.floor(y / regionSize) * regionColumns + Math.floor(x / regionSize);
    const paletteIndex = assignments[regionIndex] ?? 0;
    const colorIndex = image.pixels[pixelIndex] ?? 0;
    const colorCode = paletteSet[paletteIndex]?.[colorIndex];
    const color =
      colorCode === undefined ? undefined : NES_MASTER_PALETTE[colorCode];
    if (color === undefined) {
      throw new RangeError(
        'The mapped image contains an unsupported NES color.',
      );
    }
    const target = pixelIndex * 4;
    rgba[target] = color.red;
    rgba[target + 1] = color.green;
    rgba[target + 2] = color.blue;
    rgba[target + 3] = 255;
  }
  return rgba;
}

export function encodePlayfieldAttributeTable(
  assignments: Uint8Array,
): Uint8Array {
  if (
    assignments.length !==
    PLAYFIELD_PALETTE_COLUMNS * PLAYFIELD_PALETTE_ROWS
  ) {
    throw new RangeError('A playfield needs 16 x 15 palette assignments.');
  }

  const bytes = new Uint8Array(64);
  for (let attributeRow = 0; attributeRow < 8; attributeRow += 1) {
    for (let attributeColumn = 0; attributeColumn < 8; attributeColumn += 1) {
      let value = 0;
      for (let quadrantY = 0; quadrantY < 2; quadrantY += 1) {
        for (let quadrantX = 0; quadrantX < 2; quadrantX += 1) {
          const regionColumn = attributeColumn * 2 + quadrantX;
          const regionRow = attributeRow * 2 + quadrantY;
          const paletteIndex =
            regionRow < PLAYFIELD_PALETTE_ROWS
              ? (assignments[
                  regionRow * PLAYFIELD_PALETTE_COLUMNS + regionColumn
                ] ?? 0)
              : 0;
          if (paletteIndex > 3) {
            throw new RangeError(
              'Palette assignments must be between 0 and 3.',
            );
          }
          const shift = quadrantY * 4 + quadrantX * 2;
          value |= paletteIndex << shift;
        }
      }
      bytes[attributeRow * 8 + attributeColumn] = value;
    }
  }
  return bytes;
}
