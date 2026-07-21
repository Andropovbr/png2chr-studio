import { mapColors } from './color-mapping';
import {
  ImageAnalysisError,
  type IndexedImage,
  type RawImageData,
} from './types';

const TILE_SIZE = 8;
const CHANNELS_PER_PIXEL = 4;

export function analyzeImage(image: RawImageData): IndexedImage {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    image.width % TILE_SIZE !== 0 ||
    image.height % TILE_SIZE !== 0
  ) {
    throw new ImageAnalysisError('invalid-dimensions');
  }

  const expectedLength = image.width * image.height * CHANNELS_PER_PIXEL;
  if (image.data.length !== expectedLength) {
    throw new ImageAnalysisError('invalid-pixel-data');
  }

  return mapColors(image);
}
