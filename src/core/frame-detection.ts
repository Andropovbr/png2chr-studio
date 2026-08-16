import type { RawImageData } from './types';

export type FrameDetectionConfidence = 'high' | 'medium' | 'low';

export interface FrameDetectionCandidate {
  readonly width: number;
  readonly height: number;
  readonly score: number;
}

export interface FrameDetectionResult {
  readonly recommendedWidth: number;
  readonly recommendedHeight: number;
  readonly confidence: FrameDetectionConfidence;
  readonly candidates: readonly FrameDetectionCandidate[];
}

const MIN_FRAME_SIZE = 8;

const WEIGHT_SEPARATION = 0.35;
const WEIGHT_PERIODICITY = 0.25;
const WEIGHT_SIMILARITY = 0.15;
const WEIGHT_OCCUPANCY = 0.1;
const WEIGHT_ALIGNMENT = 0.15;

function isTransparent(alpha: number): boolean {
  return alpha < 128;
}

export function detectFrameGrid(image: RawImageData): FrameDetectionResult {
  const { width, height, data } = image;
  const pixelCount = width * height;
  const opaque = new Uint8Array(pixelCount);
  let transparentPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (isTransparent(data[index * 4 + 3] ?? 0)) {
      opaque[index] = 0;
      transparentPixels += 1;
    } else {
      opaque[index] = 1;
    }
  }

  const transparentCols: number[] = [];
  const transparentRows: number[] = [];
  for (let x = 0; x < width; x += 1) {
    let columnEmpty = true;
    for (let y = 0; y < height; y += 1) {
      if (opaque[y * width + x] !== 0) {
        columnEmpty = false;
        break;
      }
    }
    if (columnEmpty) transparentCols.push(x);
  }
  for (let y = 0; y < height; y += 1) {
    let rowEmpty = true;
    for (let x = 0; x < width; x += 1) {
      if (opaque[y * width + x] !== 0) {
        rowEmpty = false;
        break;
      }
    }
    if (rowEmpty) transparentRows.push(y);
  }

  const widths = candidateSizes(width, transparentCols);
  const heights = candidateSizes(height, transparentRows);
  if (widths.length === 0 || heights.length === 0) {
    return {
      recommendedWidth: width,
      recommendedHeight: height,
      confidence: 'low',
      candidates: [],
    };
  }

  const scored: FrameDetectionCandidate[] = [];
  for (const candidateWidth of widths) {
    for (const candidateHeight of heights) {
      scored.push({
        width: candidateWidth,
        height: candidateHeight,
        score: scoreCandidate(
          opaque,
          width,
          height,
          candidateWidth,
          candidateHeight,
        ),
      });
    }
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.width - a.width ||
      b.height - a.height,
  );

  const best = scored[0];
  if (best === undefined) {
    return {
      recommendedWidth: width,
      recommendedHeight: height,
      confidence: 'low',
      candidates: [],
    };
  }
  const second = scored[1];
  const margin = second === undefined ? 1 : best.score - second.score;

  const confidence =
    transparentPixels === 0
      ? 'low'
      : best.score >= 0.55 && margin >= 0.1
        ? 'high'
        : best.score < 0.3 || margin < 0.04
          ? 'low'
          : 'medium';

  return {
    recommendedWidth: best.width,
    recommendedHeight: best.height,
    confidence,
    candidates: scored,
  };
}

export function decideFrameDimensions(
  currentWidth: number,
  currentHeight: number,
  detection: FrameDetectionResult | null,
): { width: number; height: number } {
  if (detection?.confidence !== 'high') {
    return { width: currentWidth, height: currentHeight };
  }
  return {
    width: detection.recommendedWidth,
    height: detection.recommendedHeight,
  };
}

function candidateSizes(
  total: number,
  gutters: readonly number[],
): number[] {
  const sizes = new Set<number>();
  for (let size = MIN_FRAME_SIZE; size <= total; size += 1) {
    if (total % size === 0) {
      sizes.add(size);
    }
  }
  for (const gutter of gutters) {
    if (gutter >= MIN_FRAME_SIZE) {
      sizes.add(gutter);
    }
  }
  for (let index = 0; index + 1 < gutters.length; index += 1) {
    const first = gutters[index];
    const second = gutters[index + 1];
    if (first === undefined || second === undefined) continue;
    const gap = second - first;
    if (gap >= MIN_FRAME_SIZE) {
      sizes.add(gap);
    }
  }
  return [...sizes].sort((a, b) => a - b);
}

function scoreCandidate(
  opaque: Uint8Array,
  width: number,
  height: number,
  candidateWidth: number,
  candidateHeight: number,
): number {
  const columns = Math.floor(width / candidateWidth);
  const rows = Math.floor(height / candidateHeight);

  const seamLines: number[] = [];
  const alignmentLines: number[] = [];
  for (let column = 1; column < columns; column += 1) {
    const x = column * candidateWidth;
    seamLines.push(transparentFractionColumn(opaque, width, height, x));
    alignmentLines.push(alignmentAtColumn(opaque, width, height, x));
  }
  for (let row = 1; row < rows; row += 1) {
    const y = row * candidateHeight;
    seamLines.push(transparentFractionRow(opaque, width, y));
    alignmentLines.push(alignmentAtRow(opaque, width, height, y));
  }

  const separation = seamLines.length === 0 ? 1 : average(seamLines);
  const alignment = alignmentLines.length === 0 ? 1 : average(alignmentLines);

  let totalOpaque = 0;
  let coveredOpaque = 0;
  let connectedSum = 0;
  const fractions: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const startX = column * candidateWidth;
      const startY = row * candidateHeight;
      const cellOpaque = countCellOpaque(
        opaque,
        width,
        height,
        startX,
        startY,
        candidateWidth,
        candidateHeight,
      );
      totalOpaque += cellOpaque;
      coveredOpaque += cellOpaque;
      fractions.push(cellOpaque / (candidateWidth * candidateHeight));
      connectedSum += largestComponent(
        opaque,
        width,
        startX,
        startY,
        candidateWidth,
        candidateHeight,
      );
    }
  }

  // Content left outside the candidate cells (for example in trailing
  // gutters) reduces the confidence that the whole sheet fits this grid.
  const fullOpaque = countCellOpaque(
    opaque,
    width,
    height,
    0,
    0,
    width,
    height,
  );
  const coverage = fullOpaque === 0 ? 0 : coveredOpaque / fullOpaque;

  const mean = average(fractions);
  let variance = 0;
  for (const fraction of fractions) {
    variance += (fraction - mean) ** 2;
  }
  variance /= Math.max(1, fractions.length);
  const bernoulliMaximum = mean * (1 - mean);
  const periodicity =
    bernoulliMaximum <= 1e-9 ? 1 : 1 - Math.min(1, variance / bernoulliMaximum);

  const similarity =
    totalOpaque === 0
      ? 1
      : Math.max(0, Math.min(1, (connectedSum / totalOpaque - 0.5) * 2));

  let occupancySum = 0;
  for (const fraction of fractions) {
    let penalty = 0;
    if (fraction < 0.02) {
      penalty = (0.02 - fraction) / 0.02;
    } else if (fraction > 0.98) {
      penalty = (fraction - 0.98) / 0.02;
    }
    occupancySum += 1 - penalty;
  }
  const occupancy = occupancySum / Math.max(1, fractions.length);

  const weighted =
    WEIGHT_SEPARATION * separation +
    WEIGHT_PERIODICITY * periodicity +
    WEIGHT_SIMILARITY * similarity +
    WEIGHT_OCCUPANCY * occupancy +
    WEIGHT_ALIGNMENT * alignment;

  return coverage * weighted;
}

function transparentFractionColumn(
  opaque: Uint8Array,
  width: number,
  height: number,
  x: number,
): number {
  let empty = 0;
  for (let y = 0; y < height; y += 1) {
    if (opaque[y * width + x] === 0) empty += 1;
  }
  return empty / height;
}

function transparentFractionRow(
  opaque: Uint8Array,
  width: number,
  y: number,
): number {
  let empty = 0;
  for (let x = 0; x < width; x += 1) {
    if (opaque[y * width + x] === 0) empty += 1;
  }
  return empty / width;
}

function alignmentAtColumn(
  opaque: Uint8Array,
  width: number,
  height: number,
  x: number,
): number {
  const density = columnDensity(opaque, width, height, x);
  const left = x - 1 >= 0 ? columnDensity(opaque, width, height, x - 1) : density;
  const right =
    x + 1 < width ? columnDensity(opaque, width, height, x + 1) : density;
  const neighbor = (left + right) / 2;
  if (neighbor <= 1e-9) return density <= 1e-9 ? 1 : 0;
  return 1 - Math.min(1, density / neighbor);
}

function alignmentAtRow(
  opaque: Uint8Array,
  width: number,
  height: number,
  y: number,
): number {
  const density = rowDensity(opaque, width, y);
  const above = y - 1 >= 0 ? rowDensity(opaque, width, y - 1) : density;
  const below =
    y + 1 < height ? rowDensity(opaque, width, y + 1) : density;
  const neighbor = (above + below) / 2;
  if (neighbor <= 1e-9) return density <= 1e-9 ? 1 : 0;
  return 1 - Math.min(1, density / neighbor);
}

function columnDensity(
  opaque: Uint8Array,
  width: number,
  height: number,
  x: number,
): number {
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    count += opaque[y * width + x] ?? 0;
  }
  return count / height;
}

function rowDensity(
  opaque: Uint8Array,
  width: number,
  y: number,
): number {
  let count = 0;
  for (let x = 0; x < width; x += 1) {
    count += opaque[y * width + x] ?? 0;
  }
  return count / width;
}

function countCellOpaque(
  opaque: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  cellWidth: number,
  cellHeight: number,
): number {
  let count = 0;
  for (let y = 0; y < cellHeight && startY + y < height; y += 1) {
    for (let x = 0; x < cellWidth && startX + x < width; x += 1) {
      count += opaque[(startY + y) * width + (startX + x)] ?? 0;
    }
  }
  return count;
}

function largestComponent(
  opaque: Uint8Array,
  width: number,
  startX: number,
  startY: number,
  cellWidth: number,
  cellHeight: number,
): number {
  const cellSize = cellWidth * cellHeight;
  const visited = new Uint8Array(cellSize);
  let largest = 0;
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const localIndex = y * cellWidth + x;
      if (visited[localIndex] !== 0) continue;
      const globalIndex = (startY + y) * width + (startX + x);
      if (opaque[globalIndex] === 0) continue;
      const queue: number[] = [localIndex];
      visited[localIndex] = 1;
      let size = 0;
      while (queue.length > 0) {
        const current = queue.pop();
        if (current === undefined) {
          break;
        }
        size += 1;
        const currentX = current % cellWidth;
        const currentY = Math.floor(current / cellWidth);
        const neighbors: readonly (readonly [number, number])[] = [
          [currentX - 1, currentY],
          [currentX + 1, currentY],
          [currentX, currentY - 1],
          [currentX, currentY + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= cellWidth || ny >= cellHeight) {
            continue;
          }
          const neighborIndex = ny * cellWidth + nx;
          if (visited[neighborIndex] !== 0) continue;
          const neighborGlobal = (startY + ny) * width + (startX + nx);
          if (opaque[neighborGlobal] === 0) continue;
          visited[neighborIndex] = 1;
          queue.push(neighborIndex);
        }
      }
      if (size > largest) largest = size;
    }
  }
  return largest;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}