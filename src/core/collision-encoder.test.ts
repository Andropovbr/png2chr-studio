import { describe, expect, it } from 'vitest';

import {
  COLLISION_CELL_COUNT,
  COLLISION_MAP_SIZE,
  CollisionEncodingError,
  createEmptyCollisionMap,
  encodeCollisionMap,
} from './collision-encoder';

describe('collision encoding', () => {
  it('creates an empty 32 by 30 collision grid', () => {
    const cells = createEmptyCollisionMap();

    expect(cells).toHaveLength(COLLISION_CELL_COUNT);
    expect(cells).toEqual(new Uint8Array(COLLISION_CELL_COUNT));
  });

  it('packs collision cells from left to right using the high bit first', () => {
    const cells = createEmptyCollisionMap();
    cells[0] = 1;
    cells[7] = 1;
    cells[8] = 1;
    cells[31] = 1;
    cells[32] = 1;
    cells[COLLISION_CELL_COUNT - 1] = 1;

    const result = encodeCollisionMap(cells);

    expect(result).toHaveLength(COLLISION_MAP_SIZE);
    expect(Array.from(result.slice(0, 5))).toEqual([
      0b10000001, 0b10000000, 0, 0b00000001, 0b10000000,
    ]);
    expect(result[result.length - 1]).toBe(0b00000001);
  });

  it('treats every non-zero value as a solid cell', () => {
    const cells = createEmptyCollisionMap();
    cells[1] = 255;

    expect(encodeCollisionMap(cells)[0]).toBe(0b01000000);
  });

  it('rejects collision maps with an unexpected number of cells', () => {
    expect(() => encodeCollisionMap(new Uint8Array(10))).toThrow(
      CollisionEncodingError,
    );
  });
});
