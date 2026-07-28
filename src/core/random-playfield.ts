import type { IndexedImage, RgbColor } from './types';

export const RANDOM_PLAYFIELD_WIDTH = 256;
export const RANDOM_PLAYFIELD_HEIGHT = 240;
export const RANDOM_PLAYFIELD_COLUMNS = 32;
export const RANDOM_PLAYFIELD_ROWS = 30;
export const RANDOM_PLAYFIELD_TILE_LIMIT = 9;

export type RandomPlayfieldFeature =
  | 'walls'
  | 'platforms'
  | 'clouds'
  | 'stars'
  | 'trees'
  | 'stairs'
  | 'top-border'
  | 'bottom-border'
  | 'left-border'
  | 'right-border';

export const DEFAULT_RANDOM_PLAYFIELD_FEATURES: readonly RandomPlayfieldFeature[] =
  ['platforms', 'clouds', 'stars', 'bottom-border'];

export interface RandomPlayfieldOptions {
  readonly features: readonly RandomPlayfieldFeature[];
}

// One NES background palette: black, blue, light blue and white.
export const RANDOM_PLAYFIELD_NES_PALETTE = [0x0f, 0x11, 0x21, 0x30] as const;

// Browser preview approximations for the NES color codes above.
export const RANDOM_PLAYFIELD_COLORS: readonly RgbColor[] = [
  { red: 0, green: 0, blue: 0 },
  { red: 0, green: 62, blue: 166 },
  { red: 76, green: 154, blue: 236 },
  { red: 255, green: 255, blue: 255 },
];

type RandomSource = () => number;

interface Platform {
  readonly row: number;
  readonly start: number;
  readonly end: number;
}

const PATTERN = {
  empty: 0,
  star: 1,
  cloud: 2,
  wallTop: 3,
  wall: 4,
  platform: 5,
  foliage: 6,
  trunk: 7,
  stairs: 8,
} as const;

function tile(draw: (x: number, y: number) => number): Uint8Array {
  const pixels = new Uint8Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      pixels[y * 8 + x] = draw(x, y);
    }
  }
  return pixels;
}

const TILE_PATTERNS = [
  tile(() => 0),
  tile((x, y) => ((x === 3 || x === 4) && (y === 3 || y === 4) ? 3 : 0)),
  tile((x, y) => {
    if (y >= 3 && y <= 6 && x >= 1 && x <= 6) return 3;
    if (y === 2 && x >= 3 && x <= 5) return 2;
    return 0;
  }),
  tile((x, y) => {
    if (y === 0) return 3;
    if (y < 3) return (x + y) % 2 === 0 ? 2 : 1;
    return 1;
  }),
  tile((x, y) => (((x >> 1) + (y >> 1)) % 2 === 0 ? 1 : 2)),
  tile((x, y) => {
    if (x === 0 || x === 7 || y === 0 || y === 7) return 3;
    return (x + y) % 2 === 0 ? 2 : 1;
  }),
  tile((x, y) => {
    const distance = Math.abs(x - 3.5) + Math.abs(y - 3.5);
    return distance < 4.5 ? (distance < 2.5 ? 2 : 1) : 0;
  }),
  tile((x, y) => (x >= 3 && x <= 4 ? (y % 2 === 0 ? 3 : 1) : 0)),
  tile((x, y) => {
    if (x === 1 || x === 6) return 3;
    if ((y === 1 || y === 6) && x > 1 && x < 6) return 2;
    return 0;
  }),
] as const;

function randomUnit(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999_999, Math.max(0, value));
}

function randomInteger(random: RandomSource, maximum: number): number {
  return Math.floor(randomUnit(random) * maximum);
}

function setTile(
  tileMap: Uint8Array,
  column: number,
  row: number,
  pattern: number,
): void {
  if (
    column >= 0 &&
    column < RANDOM_PLAYFIELD_COLUMNS &&
    row >= 0 &&
    row < RANDOM_PLAYFIELD_ROWS
  ) {
    tileMap[row * RANDOM_PLAYFIELD_COLUMNS + column] = pattern;
  }
}

function addStars(tileMap: Uint8Array, random: RandomSource): void {
  for (let row = 1; row < 20; row += 1) {
    for (let column = 1; column < RANDOM_PLAYFIELD_COLUMNS - 1; column += 1) {
      if (randomUnit(random) < 0.055) {
        setTile(tileMap, column, row, PATTERN.star);
      }
    }
  }
}

function addClouds(tileMap: Uint8Array, random: RandomSource): void {
  for (let cloud = 0; cloud < 3; cloud += 1) {
    const row = 2 + randomInteger(random, 8);
    const column = 1 + randomInteger(random, RANDOM_PLAYFIELD_COLUMNS - 5);
    for (let offset = 0; offset < 3; offset += 1) {
      setTile(tileMap, column + offset, row, PATTERN.cloud);
    }
  }
}

function addPlatforms(tileMap: Uint8Array, random: RandomSource): Platform[] {
  const platforms: Platform[] = [];
  for (let index = 0; index < 5; index += 1) {
    const row = 9 + index * 4 + randomInteger(random, 2);
    const length = 4 + randomInteger(random, 5);
    const start =
      1 + randomInteger(random, RANDOM_PLAYFIELD_COLUMNS - length - 2);
    const end = start + length - 1;
    for (let column = start; column <= end; column += 1) {
      setTile(tileMap, column, row, PATTERN.platform);
    }
    platforms.push({ row, start, end });
  }
  return platforms;
}

function addStairs(
  tileMap: Uint8Array,
  platforms: readonly Platform[],
  random: RandomSource,
): void {
  if (platforms.length === 0) {
    for (let stairs = 0; stairs < 3; stairs += 1) {
      const column = 2 + randomInteger(random, RANDOM_PLAYFIELD_COLUMNS - 4);
      const startRow = 8 + randomInteger(random, RANDOM_PLAYFIELD_ROWS - 16);
      for (let row = startRow; row < startRow + 5; row += 1) {
        setTile(tileMap, column, row, PATTERN.stairs);
      }
    }
    return;
  }

  let connected = 0;
  for (
    let upperIndex = 0;
    upperIndex < platforms.length - 1 && connected < 3;
    upperIndex += 1
  ) {
    const upper = platforms[upperIndex];
    const lower = platforms[upperIndex + 1];
    if (upper === undefined || lower === undefined) continue;
    const overlapStart = Math.max(upper.start, lower.start);
    const overlapEnd = Math.min(upper.end, lower.end);
    if (overlapStart > overlapEnd) continue;
    const column =
      overlapStart + randomInteger(random, overlapEnd - overlapStart + 1);
    for (let row = upper.row + 1; row < lower.row; row += 1) {
      setTile(tileMap, column, row, PATTERN.stairs);
    }
    connected += 1;
  }

  if (connected === 0 && platforms[0] !== undefined) {
    const platform = platforms[0];
    const column =
      platform.start + randomInteger(random, platform.end - platform.start + 1);
    for (
      let row = platform.row + 1;
      row < Math.min(platform.row + 5, RANDOM_PLAYFIELD_ROWS - 1);
      row += 1
    ) {
      setTile(tileMap, column, row, PATTERN.stairs);
    }
  }
}

function addWalls(tileMap: Uint8Array, random: RandomSource): void {
  for (let wall = 0; wall < 4; wall += 1) {
    const vertical = randomUnit(random) < 0.5;
    const startColumn = 2 + randomInteger(random, RANDOM_PLAYFIELD_COLUMNS - 8);
    const startRow = 5 + randomInteger(random, RANDOM_PLAYFIELD_ROWS - 12);
    const length = 3 + randomInteger(random, 5);
    for (let offset = 0; offset < length; offset += 1) {
      setTile(
        tileMap,
        startColumn + (vertical ? 0 : offset),
        startRow + (vertical ? offset : 0),
        vertical || offset > 0 ? PATTERN.wall : PATTERN.wallTop,
      );
    }
  }
}

function addTrees(tileMap: Uint8Array, random: RandomSource): void {
  for (let tree = 0; tree < 4; tree += 1) {
    const column = 2 + randomInteger(random, RANDOM_PLAYFIELD_COLUMNS - 5);
    const baseRow = 20 + randomInteger(random, 7);
    setTile(tileMap, column, baseRow, PATTERN.trunk);
    setTile(tileMap, column, baseRow - 1, PATTERN.trunk);
    for (let y = -3; y <= -2; y += 1) {
      for (let x = -1; x <= 1; x += 1) {
        setTile(tileMap, column + x, baseRow + y, PATTERN.foliage);
      }
    }
  }
}

function addBorders(
  tileMap: Uint8Array,
  features: ReadonlySet<RandomPlayfieldFeature>,
): void {
  if (features.has('top-border')) {
    for (let column = 0; column < RANDOM_PLAYFIELD_COLUMNS; column += 1) {
      setTile(tileMap, column, 0, PATTERN.wall);
    }
  }
  if (features.has('bottom-border')) {
    for (let column = 0; column < RANDOM_PLAYFIELD_COLUMNS; column += 1) {
      setTile(tileMap, column, RANDOM_PLAYFIELD_ROWS - 1, PATTERN.wall);
    }
  }
  if (features.has('left-border')) {
    for (let row = 0; row < RANDOM_PLAYFIELD_ROWS; row += 1) {
      setTile(tileMap, 0, row, PATTERN.wall);
    }
  }
  if (features.has('right-border')) {
    for (let row = 0; row < RANDOM_PLAYFIELD_ROWS; row += 1) {
      setTile(tileMap, RANDOM_PLAYFIELD_COLUMNS - 1, row, PATTERN.wall);
    }
  }
}

export function generateRandomPlayfield(
  random: RandomSource = Math.random,
  options: RandomPlayfieldOptions = {
    features: DEFAULT_RANDOM_PLAYFIELD_FEATURES,
  },
): IndexedImage {
  const features = new Set(options.features);
  if (features.size === 0) {
    throw new RangeError('Select at least one random playfield feature.');
  }
  const tileMap = new Uint8Array(
    RANDOM_PLAYFIELD_COLUMNS * RANDOM_PLAYFIELD_ROWS,
  );

  if (features.has('stars')) addStars(tileMap, random);
  if (features.has('clouds')) addClouds(tileMap, random);
  if (features.has('walls')) addWalls(tileMap, random);
  if (features.has('trees')) addTrees(tileMap, random);
  const platforms = features.has('platforms')
    ? addPlatforms(tileMap, random)
    : [];
  if (features.has('stairs')) addStairs(tileMap, platforms, random);
  addBorders(tileMap, features);

  const pixels = new Uint8Array(
    RANDOM_PLAYFIELD_WIDTH * RANDOM_PLAYFIELD_HEIGHT,
  );
  for (let tileRow = 0; tileRow < RANDOM_PLAYFIELD_ROWS; tileRow += 1) {
    for (
      let tileColumn = 0;
      tileColumn < RANDOM_PLAYFIELD_COLUMNS;
      tileColumn += 1
    ) {
      const patternIndex =
        tileMap[tileRow * RANDOM_PLAYFIELD_COLUMNS + tileColumn] ?? 0;
      const pattern = TILE_PATTERNS[patternIndex] ?? TILE_PATTERNS[0];
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const targetX = tileColumn * 8 + x;
          const targetY = tileRow * 8 + y;
          pixels[targetY * RANDOM_PLAYFIELD_WIDTH + targetX] =
            pattern[y * 8 + x] ?? 0;
        }
      }
    }
  }

  return {
    width: RANDOM_PLAYFIELD_WIDTH,
    height: RANDOM_PLAYFIELD_HEIGHT,
    pixels,
    colors: RANDOM_PLAYFIELD_COLORS,
    transparentIndex: null,
    colorCount: RANDOM_PLAYFIELD_COLORS.length,
  };
}
