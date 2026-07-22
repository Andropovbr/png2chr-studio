import type { IndexedImage, RgbColor } from './types';

export const RANDOM_PLAYFIELD_WIDTH = 256;
export const RANDOM_PLAYFIELD_HEIGHT = 240;
export const RANDOM_PLAYFIELD_COLUMNS = 32;
export const RANDOM_PLAYFIELD_ROWS = 30;
export const RANDOM_PLAYFIELD_TILE_LIMIT = 6;

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

export function generateRandomPlayfield(
  random: RandomSource = Math.random,
): IndexedImage {
  const tileMap = new Uint8Array(
    RANDOM_PLAYFIELD_COLUMNS * RANDOM_PLAYFIELD_ROWS,
  );

  for (let row = 1; row < 20; row += 1) {
    for (let column = 0; column < RANDOM_PLAYFIELD_COLUMNS; column += 1) {
      if (randomUnit(random) < 0.055) {
        setTile(tileMap, column, row, 1);
      }
    }
  }

  for (let cloud = 0; cloud < 3; cloud += 1) {
    const row = 2 + randomInteger(random, 8);
    const column = randomInteger(random, RANDOM_PLAYFIELD_COLUMNS - 3);
    setTile(tileMap, column, row, 2);
    setTile(tileMap, column + 1, row, 2);
    setTile(tileMap, column + 2, row, 2);
  }

  for (let platform = 0; platform < 5; platform += 1) {
    const row = 11 + randomInteger(random, 14);
    const column = randomInteger(random, RANDOM_PLAYFIELD_COLUMNS - 8);
    const length = 3 + randomInteger(random, 6);
    for (let offset = 0; offset < length; offset += 1) {
      setTile(tileMap, column + offset, row, 5);
    }
  }

  for (let column = 0; column < RANDOM_PLAYFIELD_COLUMNS; column += 1) {
    setTile(tileMap, column, 26, 3);
    for (let row = 27; row < RANDOM_PLAYFIELD_ROWS; row += 1) {
      setTile(tileMap, column, row, 4);
    }
  }

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
