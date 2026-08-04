import {
  colorDistanceFor,
  nearestColorIndex,
  rgbEuclideanDistance,
  type ColorDistance,
} from './color-distance';
import type {
  DitheringMode,
  QuantizationMode,
  QuantizationSettings,
} from './quantization-settings';
import { ImageAnalysisError, type RawImageData, type RgbColor } from './types';

const CHANNELS_PER_PIXEL = 4;

interface WeightedColor extends RgbColor {
  readonly count: number;
}

export interface ImageQuantizer {
  readonly mode: QuantizationMode;
  createPalette(
    colors: readonly WeightedColor[],
    maximumColors: number,
    distance: ColorDistance,
    availableColors: readonly RgbColor[],
  ): readonly RgbColor[];
}

export interface DitheringProcessor {
  readonly mode: DitheringMode;
  process(
    image: RawImageData,
    palette: readonly RgbColor[],
    distance: ColorDistance,
  ): Uint8ClampedArray<ArrayBuffer>;
}

export interface QuantizedImageResult {
  readonly image: RawImageData;
  readonly palette: readonly RgbColor[];
}

function colorKey(color: RgbColor): string {
  return `${String(color.red)},${String(color.green)},${String(color.blue)}`;
}

function clampChannel(channel: number): number {
  return Math.min(255, Math.max(0, channel));
}

function validateImage(image: RawImageData): void {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new ImageAnalysisError('invalid-dimensions');
  }
  if (image.data.length !== image.width * image.height * CHANNELS_PER_PIXEL) {
    throw new ImageAnalysisError('invalid-pixel-data');
  }
  for (let offset = 3; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset];
    if (alpha !== 0 && alpha !== 255) {
      throw new ImageAnalysisError('partial-transparency', {
        pixelIndex: Math.floor(offset / 4),
      });
    }
  }
}

function histogram(image: RawImageData): WeightedColor[] {
  const entries = new Map<string, WeightedColor>();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    const color = {
      red: image.data[offset] ?? 0,
      green: image.data[offset + 1] ?? 0,
      blue: image.data[offset + 2] ?? 0,
    };
    const key = colorKey(color);
    const known = entries.get(key);
    entries.set(key, { ...color, count: (known?.count ?? 0) + 1 });
  }
  return [...entries.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.red - right.red ||
      left.green - right.green ||
      left.blue - right.blue,
  );
}

function uniqueColors(colors: readonly RgbColor[]): RgbColor[] {
  const seen = new Set<string>();
  return colors.filter((color) => {
    const key = colorKey(color);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstColor(colors: readonly RgbColor[]): RgbColor {
  const color = colors[0];
  if (color === undefined) {
    throw new RangeError('A color palette must contain at least one color.');
  }
  return color;
}

function nearestColor(
  color: RgbColor,
  palette: readonly RgbColor[],
  distance: ColorDistance,
): RgbColor {
  return (
    palette[nearestColorIndex(color, palette, distance)] ?? firstColor(palette)
  );
}

function mapCentersToAvailable(
  centers: readonly RgbColor[],
  availableColors: readonly RgbColor[],
  distance: ColorDistance,
): RgbColor[] {
  return uniqueColors(
    centers.map((center) => nearestColor(center, availableColors, distance)),
  );
}

const nearestQuantizer: ImageQuantizer = {
  mode: 'nearest',
  createPalette(colors, maximumColors, distance, availableColors) {
    const usage = availableColors.map((color, index) => ({
      color,
      index,
      count: 0,
    }));
    colors.forEach((source) => {
      const index = nearestColorIndex(source, availableColors, distance);
      const entry = usage[index];
      if (entry !== undefined) entry.count += source.count;
    });
    return usage
      .filter(({ count }) => count > 0)
      .sort(
        (left, right) => right.count - left.count || left.index - right.index,
      )
      .slice(0, maximumColors)
      .map(({ color }) => color);
  },
};

function boxRange(colors: readonly WeightedColor[], channel: keyof RgbColor) {
  let minimum = 255;
  let maximum = 0;
  colors.forEach((color) => {
    minimum = Math.min(minimum, color[channel]);
    maximum = Math.max(maximum, color[channel]);
  });
  return maximum - minimum;
}

function averageBox(colors: readonly WeightedColor[]): RgbColor {
  let count = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  colors.forEach((color) => {
    count += color.count;
    red += color.red * color.count;
    green += color.green * color.count;
    blue += color.blue * color.count;
  });
  return {
    red: Math.round(red / count),
    green: Math.round(green / count),
    blue: Math.round(blue / count),
  };
}

const medianCutQuantizer: ImageQuantizer = {
  mode: 'median-cut',
  createPalette(colors, maximumColors, distance, availableColors) {
    const boxes: WeightedColor[][] = [[...colors]];
    while (boxes.length < maximumColors) {
      let splitIndex = -1;
      let largestRange = -1;
      boxes.forEach((box, index) => {
        if (box.length < 2) return;
        const range = Math.max(
          boxRange(box, 'red'),
          boxRange(box, 'green'),
          boxRange(box, 'blue'),
        );
        if (range > largestRange) {
          largestRange = range;
          splitIndex = index;
        }
      });
      if (splitIndex < 0) break;
      const box = boxes[splitIndex];
      if (box === undefined) break;
      const channels = ['red', 'green', 'blue'] as const;
      const channel = channels.reduce((best, candidate) =>
        boxRange(box, candidate) > boxRange(box, best) ? candidate : best,
      );
      box.sort(
        (left, right) =>
          left[channel] - right[channel] ||
          left.red - right.red ||
          left.green - right.green ||
          left.blue - right.blue,
      );
      const total = box.reduce((sum, color) => sum + color.count, 0);
      let accumulated = 0;
      let midpoint = 1;
      for (; midpoint < box.length; midpoint += 1) {
        accumulated += box[midpoint - 1]?.count ?? 0;
        if (accumulated >= total / 2) break;
      }
      boxes.splice(splitIndex, 1, box.slice(0, midpoint), box.slice(midpoint));
    }
    return mapCentersToAvailable(
      boxes.filter((box) => box.length > 0).map(averageBox),
      availableColors,
      distance,
    );
  },
};

function deterministicCenters(
  colors: readonly WeightedColor[],
  count: number,
): RgbColor[] {
  const first = colors[0];
  const centers: RgbColor[] = first === undefined ? [] : [{ ...first }];
  while (centers.length < count && centers.length < colors.length) {
    let best: WeightedColor | undefined;
    let bestScore = -1;
    for (const color of colors) {
      const separation = Math.min(
        ...centers.map((center) => rgbEuclideanDistance(color, center)),
      );
      const score = separation * Math.sqrt(color.count);
      if (score > bestScore) {
        best = color;
        bestScore = score;
      }
    }
    if (best === undefined) break;
    centers.push({ ...best });
  }
  return centers;
}

const kMeansQuantizer: ImageQuantizer = {
  mode: 'k-means',
  createPalette(colors, maximumColors, distance, availableColors) {
    let centers = deterministicCenters(colors, maximumColors);
    for (let iteration = 0; iteration < 16; iteration += 1) {
      const sums = centers.map(() => ({ red: 0, green: 0, blue: 0, count: 0 }));
      colors.forEach((color) => {
        const index = nearestColorIndex(color, centers, distance);
        const sum = sums[index];
        if (sum === undefined) return;
        sum.red += color.red * color.count;
        sum.green += color.green * color.count;
        sum.blue += color.blue * color.count;
        sum.count += color.count;
      });
      const next = centers.map((center, index) => {
        const sum = sums[index];
        return sum === undefined || sum.count === 0
          ? center
          : {
              red: Math.round(sum.red / sum.count),
              green: Math.round(sum.green / sum.count),
              blue: Math.round(sum.blue / sum.count),
            };
      });
      const stable = next.every(
        (center, index) =>
          colorKey(center) === colorKey(centers[index] ?? center),
      );
      centers = next;
      if (stable) break;
    }
    return mapCentersToAvailable(centers, availableColors, distance);
  },
};

const QUANTIZERS: Record<QuantizationMode, ImageQuantizer> = {
  nearest: nearestQuantizer,
  'median-cut': medianCutQuantizer,
  'k-means': kMeansQuantizer,
};

function writePixel(
  output: Uint8ClampedArray<ArrayBuffer>,
  offset: number,
  color: RgbColor,
  alpha: number,
): void {
  output[offset] = color.red;
  output[offset + 1] = color.green;
  output[offset + 2] = color.blue;
  output[offset + 3] = alpha;
}

const noDithering: DitheringProcessor = {
  mode: 'none',
  process(image, palette, distance) {
    const output = new Uint8ClampedArray(image.data.length);
    for (let offset = 0; offset < image.data.length; offset += 4) {
      const alpha = image.data[offset + 3] ?? 0;
      if (alpha === 0) {
        writePixel(output, offset, { red: 0, green: 0, blue: 0 }, 0);
        continue;
      }
      const source = {
        red: image.data[offset] ?? 0,
        green: image.data[offset + 1] ?? 0,
        blue: image.data[offset + 2] ?? 0,
      };
      writePixel(output, offset, nearestColor(source, palette, distance), 255);
    }
    return output;
  },
};

type DiffusionNeighbor = readonly [x: number, y: number, weight: number];

function errorDiffusionProcessor(
  mode: 'floyd-steinberg' | 'atkinson',
  neighbors: readonly DiffusionNeighbor[],
): DitheringProcessor {
  return {
    mode,
    process(image, palette, distance) {
      const work = new Float64Array(image.data.length);
      work.set(image.data);
      const output = new Uint8ClampedArray(image.data.length);
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const offset = (y * image.width + x) * 4;
          const alpha = image.data[offset + 3] ?? 0;
          if (alpha === 0) {
            writePixel(output, offset, { red: 0, green: 0, blue: 0 }, 0);
            continue;
          }
          const source = {
            red: clampChannel(work[offset] ?? 0),
            green: clampChannel(work[offset + 1] ?? 0),
            blue: clampChannel(work[offset + 2] ?? 0),
          };
          const target = nearestColor(source, palette, distance);
          writePixel(output, offset, target, 255);
          const errors = [
            source.red - target.red,
            source.green - target.green,
            source.blue - target.blue,
          ];
          neighbors.forEach(([deltaX, deltaY, weight]) => {
            const nextX = x + deltaX;
            const nextY = y + deltaY;
            if (
              nextX < 0 ||
              nextX >= image.width ||
              nextY < 0 ||
              nextY >= image.height
            ) {
              return;
            }
            const nextOffset = (nextY * image.width + nextX) * 4;
            if (image.data[nextOffset + 3] === 0) return;
            for (let channel = 0; channel < 3; channel += 1) {
              work[nextOffset + channel] = clampChannel(
                (work[nextOffset + channel] ?? 0) +
                  (errors[channel] ?? 0) * weight,
              );
            }
          });
        }
      }
      return output;
    },
  };
}

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

function expandBayer(matrix: readonly (readonly number[])[]): number[][] {
  const size = matrix.length;
  return Array.from({ length: size * 2 }, (_, y) =>
    Array.from({ length: size * 2 }, (_, x) => {
      const additions = [0, 2, 3, 1];
      const quadrant = Math.floor(y / size) * 2 + Math.floor(x / size);
      return (
        (matrix[y % size]?.[x % size] ?? 0) * 4 + (additions[quadrant] ?? 0)
      );
    }),
  );
}

function bayerProcessor(
  mode: 'bayer-4x4' | 'bayer-8x8',
  matrix: readonly (readonly number[])[],
): DitheringProcessor {
  return {
    mode,
    process(image, palette, distance) {
      const output = new Uint8ClampedArray(image.data.length);
      const size = matrix.length;
      const divisor = size * size;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const offset = (y * image.width + x) * 4;
          const alpha = image.data[offset + 3] ?? 0;
          if (alpha === 0) {
            writePixel(output, offset, { red: 0, green: 0, blue: 0 }, 0);
            continue;
          }
          const threshold =
            (((matrix[y % size]?.[x % size] ?? 0) + 0.5) / divisor - 0.5) * 64;
          const source = {
            red: clampChannel((image.data[offset] ?? 0) + threshold),
            green: clampChannel((image.data[offset + 1] ?? 0) + threshold),
            blue: clampChannel((image.data[offset + 2] ?? 0) + threshold),
          };
          writePixel(
            output,
            offset,
            nearestColor(source, palette, distance),
            255,
          );
        }
      }
      return output;
    },
  };
}

const DITHERERS: Record<DitheringMode, DitheringProcessor> = {
  none: noDithering,
  'floyd-steinberg': errorDiffusionProcessor('floyd-steinberg', [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ]),
  atkinson: errorDiffusionProcessor('atkinson', [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ]),
  'bayer-4x4': bayerProcessor('bayer-4x4', BAYER_4),
  'bayer-8x8': bayerProcessor('bayer-8x8', expandBayer(BAYER_4)),
};

export function quantizeImageToNes(
  image: RawImageData,
  availableColors: readonly RgbColor[],
  maximumColors: number,
  settings: QuantizationSettings,
): QuantizedImageResult {
  validateImage(image);
  const candidates = uniqueColors(availableColors);
  if (candidates.length === 0) {
    throw new RangeError('At least one NES color must be available.');
  }
  if (!Number.isInteger(maximumColors) || maximumColors <= 0) {
    throw new RangeError('The maximum color count must be positive.');
  }
  const distance = colorDistanceFor(settings.colorDistanceMode);
  const colors = histogram(image);
  const quantizer = QUANTIZERS[settings.quantizationMode];
  const palette =
    colors.length === 0
      ? [firstColor(candidates)]
      : quantizer.createPalette(
          colors,
          Math.min(maximumColors, candidates.length, colors.length),
          distance,
          candidates,
        );
  const safePalette = palette.length === 0 ? [firstColor(candidates)] : palette;
  const data = DITHERERS[settings.ditheringMode].process(
    image,
    safePalette,
    distance,
  );
  return {
    image: { width: image.width, height: image.height, data },
    palette: safePalette,
  };
}
