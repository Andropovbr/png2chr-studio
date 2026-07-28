import { describe, expect, it } from 'vitest';

import {
  COLLISION_CELL_COUNT,
  COLLISION_MAP_SIZE,
  COLLISION_TYPES,
  CollisionEncodingError,
  countCollisionCells,
  countCollisionTypes,
  createEmptyCollisionMap,
  encodeCollisionMap,
} from './collision-encoder';

describe('collision encoding', () => {
  it('creates an empty 32 by 30 collision grid', () => {
    const cells = createEmptyCollisionMap();

    expect(cells).toHaveLength(COLLISION_CELL_COUNT);
    expect(cells).toEqual(new Uint8Array(COLLISION_CELL_COUNT));
  });

  it('packs two four-bit collision types per byte, left cell first', () => {
    const cells = createEmptyCollisionMap();
    cells[0] = COLLISION_TYPES.solid;
    cells[1] = COLLISION_TYPES.damage;
    cells[2] = COLLISION_TYPES.ladder;
    cells[3] = COLLISION_TYPES.moveUp;
    cells[4] = COLLISION_TYPES.moveDown;
    cells[COLLISION_CELL_COUNT - 1] = COLLISION_TYPES.conveyorRight;

    const result = encodeCollisionMap(cells);

    expect(result).toHaveLength(COLLISION_MAP_SIZE);
    expect(Array.from(result.slice(0, 3))).toEqual([0x12, 0x34, 0xa0]);
    expect(result[result.length - 1]).toBe(0x09);
  });

  it('preserves solid as collision type 1', () => {
    const cells = createEmptyCollisionMap();
    cells[0] = COLLISION_TYPES.solid;
    cells[1] = COLLISION_TYPES.solid;

    expect(encodeCollisionMap(cells)[0]).toBe(0x11);
  });

  it('counts occupied cells and each collision type', () => {
    const cells = createEmptyCollisionMap();
    cells[0] = COLLISION_TYPES.solid;
    cells[1] = COLLISION_TYPES.damage;
    cells[2] = COLLISION_TYPES.damage;

    expect(countCollisionCells(cells)).toBe(3);
    expect(countCollisionTypes(cells)).toEqual(
      new Map([
        [COLLISION_TYPES.solid, 1],
        [COLLISION_TYPES.damage, 2],
      ]),
    );
  });

  it('rejects collision maps with an unexpected number of cells', () => {
    expect(() => encodeCollisionMap(new Uint8Array(10))).toThrow(
      CollisionEncodingError,
    );
  });

  it('rejects collision types that do not fit in four bits', () => {
    const cells = createEmptyCollisionMap();
    cells[0] = 0x10;

    expect(() => encodeCollisionMap(cells)).toThrow(
      new CollisionEncodingError(COLLISION_CELL_COUNT, 0x10),
    );
  });
});
