export const COLLISION_COLUMNS = 32;
export const COLLISION_ROWS = 30;
export const COLLISION_CELL_COUNT = COLLISION_COLUMNS * COLLISION_ROWS;
export const COLLISION_MAP_SIZE = COLLISION_CELL_COUNT / 2;

export const COLLISION_TYPES = {
  none: 0,
  solid: 1,
  damage: 2,
  ladder: 3,
  moveUp: 4,
  water: 5,
  oneWay: 6,
  ice: 7,
  conveyorLeft: 8,
  conveyorRight: 9,
  moveDown: 10,
} as const;

export type CollisionTypeName = keyof typeof COLLISION_TYPES;
export type CollisionType = (typeof COLLISION_TYPES)[CollisionTypeName];

export const PAINTABLE_COLLISION_TYPES: readonly CollisionTypeName[] = [
  'solid',
  'damage',
  'ladder',
  'moveUp',
  'moveDown',
  'water',
  'oneWay',
  'ice',
  'conveyorLeft',
  'conveyorRight',
];

const MAX_COLLISION_TYPE = 0x0f;

export class CollisionEncodingError extends Error {
  public constructor(
    public readonly cellCount: number,
    public readonly invalidValue?: number,
  ) {
    super(
      invalidValue === undefined
        ? 'invalid-collision-map'
        : 'invalid-collision-type',
    );
    this.name = 'CollisionEncodingError';
  }
}

export function createEmptyCollisionMap(): Uint8Array {
  return new Uint8Array(COLLISION_CELL_COUNT);
}

export function encodeCollisionMap(cells: Uint8Array): Uint8Array {
  if (cells.length !== COLLISION_CELL_COUNT) {
    throw new CollisionEncodingError(cells.length);
  }

  const bytes = new Uint8Array(COLLISION_MAP_SIZE);
  for (let index = 0; index < cells.length; index += 1) {
    const collisionType = cells[index] ?? COLLISION_TYPES.none;
    if (collisionType > MAX_COLLISION_TYPE) {
      throw new CollisionEncodingError(cells.length, collisionType);
    }
    const byteIndex = Math.floor(index / 2);
    const shift = index % 2 === 0 ? 4 : 0;
    bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (collisionType << shift);
  }
  return bytes;
}

export function countCollisionCells(cells: Uint8Array): number {
  let count = 0;
  for (const cell of cells) {
    if (cell !== COLLISION_TYPES.none) {
      count += 1;
    }
  }
  return count;
}

export function countCollisionTypes(
  cells: Uint8Array,
): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const cell of cells) {
    if (cell === COLLISION_TYPES.none) continue;
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  return counts;
}
