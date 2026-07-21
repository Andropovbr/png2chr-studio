import {
  ImageAnalysisError,
  type IndexedImage,
  type RawImageData,
  type RgbColor,
} from './types';

const CHANNELS_PER_PIXEL = 4;
const MAX_COLOR_INDICES = 4;

function colorKey(red: number, green: number, blue: number): string {
  return [red, green, blue].join(',');
}

function discoverOpaqueColors(image: RawImageData): {
  colors: RgbColor[];
  hasTransparency: boolean;
} {
  const colors: RgbColor[] = [];
  const knownColors = new Set<string>();
  let hasTransparency = false;

  for (
    let offset = 0;
    offset < image.data.length;
    offset += CHANNELS_PER_PIXEL
  ) {
    const alpha = image.data[offset + 3];

    if (alpha === 0) {
      hasTransparency = true;
      continue;
    }

    if (alpha !== 255) {
      throw new ImageAnalysisError('partial-transparency', {
        pixelIndex: offset / CHANNELS_PER_PIXEL,
      });
    }

    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];

    if (red === undefined || green === undefined || blue === undefined) {
      throw new ImageAnalysisError('invalid-pixel-data');
    }

    const key = colorKey(red, green, blue);
    if (!knownColors.has(key)) {
      knownColors.add(key);
      colors.push({ red, green, blue });
    }
  }

  return { colors, hasTransparency };
}

export function mapColors(image: RawImageData): IndexedImage {
  const { colors: opaqueColors, hasTransparency } = discoverOpaqueColors(image);
  const colorCount = opaqueColors.length + Number(hasTransparency);

  if (colorCount > MAX_COLOR_INDICES) {
    throw new ImageAnalysisError('too-many-colors', {
      colorCount,
      colors: opaqueColors,
      hasTransparency,
    });
  }

  const firstOpaqueIndex = hasTransparency ? 1 : 0;
  const indicesByColor = new Map<string, number>();
  const palette: (RgbColor | null)[] = Array.from(
    { length: MAX_COLOR_INDICES },
    () => null,
  );

  opaqueColors.forEach((color, position) => {
    const index = firstOpaqueIndex + position;
    indicesByColor.set(colorKey(color.red, color.green, color.blue), index);
    palette[index] = color;
  });

  const pixels = new Uint8Array(image.width * image.height);
  for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
    const offset = pixelIndex * CHANNELS_PER_PIXEL;
    const alpha = image.data[offset + 3];

    if (alpha === 0) {
      pixels[pixelIndex] = 0;
      continue;
    }

    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    if (red === undefined || green === undefined || blue === undefined) {
      throw new ImageAnalysisError('invalid-pixel-data');
    }

    const index = indicesByColor.get(colorKey(red, green, blue));
    if (index === undefined) {
      throw new ImageAnalysisError('invalid-pixel-data');
    }
    pixels[pixelIndex] = index;
  }

  return {
    width: image.width,
    height: image.height,
    pixels,
    colors: palette,
    transparentIndex: hasTransparency ? 0 : null,
    colorCount,
  };
}
