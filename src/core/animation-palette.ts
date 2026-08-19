import { type ColorDistanceMode } from './color-distance';
import {
  createPaletteAssignments,
  mapImageToNesPalettes,
  NES_BACKGROUND_PALETTE_COUNT,
  NES_MASTER_PALETTE,
  type NesPalette,
  type NesPaletteSet,
} from './nes-palette';
import type { IndexedImage, RawImageData, Tile } from './types';

export interface AnimationPaletteMapping {
  readonly image: IndexedImage;
  readonly colorIndices: Uint8Array;
  readonly assignments: Uint8Array;
}

export function mapAnimationImageToNesPalette(
  image: IndexedImage,
  paletteSet: NesPaletteSet,
  paletteIndex: number,
  regionSize: number,
  colorIndices?: Uint8Array,
  colorDistanceMode: ColorDistanceMode = 'perceptual',
): AnimationPaletteMapping {
  if (
    !Number.isInteger(paletteIndex) ||
    paletteIndex < 0 ||
    paletteIndex >= NES_BACKGROUND_PALETTE_COUNT
  ) {
    throw new RangeError('Sprite palette indices must be between 0 and 3.');
  }
  if (
    colorIndices !== undefined &&
    colorIndices.length !== image.pixels.length
  ) {
    throw new RangeError(
      'Sprite color indices do not match the image dimensions.',
    );
  }

  const actualRegionSize =
    image.width % regionSize === 0 && image.height % regionSize === 0
      ? regionSize
      : image.width % 16 === 0 && image.height % 16 === 0
        ? 16
        : 8;

  const assignments = createPaletteAssignments(
    image.width,
    image.height,
    actualRegionSize,
  ).fill(paletteIndex);
  const mapped = mapImageToNesPalettes(
    image,
    paletteSet,
    assignments,
    actualRegionSize,
    colorIndices,
    image.transparentIndex !== null,
    colorDistanceMode,
  );
  return {
    image: mapped,
    colorIndices: colorIndices?.slice() ?? mapped.pixels.slice(),
    assignments,
  };
}

export function renderIndexedImageWithPalette(
  image: IndexedImage,
  palette: NesPalette,
): RawImageData {
  const data = new Uint8Array(image.width * image.height * 4);

  for (let i = 0; i < image.pixels.length; i += 1) {
    const pixel = image.pixels[i] ?? 0;
    const offset = i * 4;
    if (pixel === 0 || pixel === image.transparentIndex) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    } else {
      const slot = Math.max(0, Math.min(3, pixel));
      const colorCode = palette[slot] ?? 0x0f;
      const rgb = NES_MASTER_PALETTE[colorCode] ?? {
        red: 0,
        green: 0,
        blue: 0,
      };
      data[offset] = rgb.red;
      data[offset + 1] = rgb.green;
      data[offset + 2] = rgb.blue;
      data[offset + 3] = 255;
    }
  }

  return {
    width: image.width,
    height: image.height,
    data,
  };
}

export function renderAnimationToRawImageData(
  image: IndexedImage,
  paletteSet: NesPaletteSet,
  paletteIndex: number,
): RawImageData {
  const activePalette = paletteSet[paletteIndex] ?? [0x0f, 0x00, 0x10, 0x30];
  return renderIndexedImageWithPalette(image, activePalette);
}

export function renderAnimationTileToRawImageData(
  tile: Tile,
  paletteSet: NesPaletteSet,
  paletteIndex: number,
): RawImageData {
  return renderAnimationToRawImageData(
    {
      width: 8,
      height: 8,
      pixels: tile.pixels,
      colors: [null, null, null, null],
      transparentIndex: 0,
      colorCount: 4,
    },
    paletteSet,
    paletteIndex,
  );
}
