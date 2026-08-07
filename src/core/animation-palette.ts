import { type ColorDistanceMode } from './color-distance';
import {
  createPaletteAssignments,
  mapImageToNesPalettes,
  NES_BACKGROUND_PALETTE_COUNT,
  type NesPaletteSet,
} from './nes-palette';
import type { IndexedImage } from './types';

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

  const assignments = createPaletteAssignments(
    image.width,
    image.height,
    regionSize,
  ).fill(paletteIndex);
  const mapped = mapImageToNesPalettes(
    image,
    paletteSet,
    assignments,
    regionSize,
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
