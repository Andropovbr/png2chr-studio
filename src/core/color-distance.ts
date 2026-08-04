import type { RgbColor } from './types';

export const COLOR_DISTANCE_MODES = ['rgb', 'perceptual'] as const;

export type ColorDistanceMode = (typeof COLOR_DISTANCE_MODES)[number];

export type ColorDistance = (left: RgbColor, right: RgbColor) => number;

function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function rgbToOklab(color: RgbColor): readonly [number, number, number] {
  const red = srgbChannelToLinear(color.red);
  const green = srgbChannelToLinear(color.green);
  const blue = srgbChannelToLinear(color.blue);
  const light = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  );
  const medium = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  );
  const short = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  );
  return [
    0.2104542553 * light + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * light - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * light + 0.7827717662 * medium - 0.808675766 * short,
  ];
}

export function rgbEuclideanDistance(left: RgbColor, right: RgbColor): number {
  const red = left.red - right.red;
  const green = left.green - right.green;
  const blue = left.blue - right.blue;
  return red * red + green * green + blue * blue;
}

export function perceptualDistance(left: RgbColor, right: RgbColor): number {
  const [leftL, leftA, leftB] = rgbToOklab(left);
  const [rightL, rightA, rightB] = rgbToOklab(right);
  const light = leftL - rightL;
  const greenRed = leftA - rightA;
  const blueYellow = leftB - rightB;
  return light * light + greenRed * greenRed + blueYellow * blueYellow;
}

export function colorDistanceFor(mode: ColorDistanceMode): ColorDistance {
  return mode === 'rgb' ? rgbEuclideanDistance : perceptualDistance;
}

export function nearestColorIndex(
  color: RgbColor,
  palette: readonly RgbColor[],
  distance: ColorDistance,
): number {
  if (palette.length === 0) {
    throw new RangeError('A color palette must contain at least one color.');
  }
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  palette.forEach((candidate, index) => {
    const candidateDistance = distance(color, candidate);
    if (candidateDistance < nearestDistance) {
      nearestDistance = candidateDistance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}
