export const COLLISION_COLUMNS = 32;
export const COLLISION_ROWS = 30;
export const COLLISION_CELL_COUNT = COLLISION_COLUMNS * COLLISION_ROWS;
export const COLLISION_MAP_SIZE = COLLISION_CELL_COUNT / 8;

export class CollisionEncodingError extends Error {
  public constructor(public readonly cellCount: number) {
    super('invalid-collision-map');
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
    if (cells[index] !== 0) {
      const byteIndex = Math.floor(index / 8);
      bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (0x80 >> (index % 8));
    }
  }
  return bytes;
}

export function countCollisionCells(cells: Uint8Array): number {
  let count = 0;
  for (const cell of cells) {
    if (cell !== 0) {
      count += 1;
    }
  }
  return count;
}
