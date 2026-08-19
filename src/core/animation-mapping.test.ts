import { describe, expect, it } from 'vitest';

import { createAnimationFrameMapping } from './animation-mapping';
import {
  NES_SPRITE_FLIP_HORIZONTAL,
  buildAnimationProjectModel,
} from './animation-model';
import type { IndexedImage, Tile } from './types';

function tileWith(x: number, y: number): Tile {
  const pixels = new Uint8Array(64);
  pixels[y * 8 + x] = 1;
  return { id: 0, column: 0, row: 0, pixels };
}

function sheetFromTiles(tiles: readonly Tile[]): IndexedImage {
  const width = tiles.length * 8;
  const pixels = new Uint8Array(width * 8);
  tiles.forEach((tile, tileIndex) => {
    for (let y = 0; y < 8; y += 1) {
      pixels.set(
        tile.pixels.slice(y * 8, y * 8 + 8),
        y * width + tileIndex * 8,
      );
    }
  });
  return {
    width,
    height: 8,
    pixels,
    colors: [null, null, null, null],
    transparentIndex: 0,
    colorCount: 4,
  };
}

describe('animation mapping projection', () => {
  it('renders pixel overrides from the effective final CHR tile', () => {
    const model = buildAnimationProjectModel({
      name: 'hero',
      animations: [
        {
          id: 'anim-walk',
          name: 'hero_walk',
          image: sheetFromTiles([tileWith(0, 0)]),
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 8,
          pixelOverrides: { '0_0': { 0: 3 } },
        },
      ],
    });
    const animation = model.animations[0];
    const frame = animation?.frames[0];

    expect(animation).toBeDefined();
    expect(frame).toBeDefined();
    if (animation === undefined || frame === undefined) return;

    const [cell] = createAnimationFrameMapping(model, animation, frame);
    expect(cell?.tile?.pixels[0]).toBe(3);
    expect(cell?.sprite?.tile).toBe(0);
    expect(model.finalChr[0]).toBe(0x80);
    expect(model.finalChr[8]).toBe(0x80);
  });

  it('renders a flip-reused tile with its exported index and attributes', () => {
    const model = buildAnimationProjectModel({
      name: 'hero',
      animations: [
        {
          id: 'anim-walk',
          name: 'hero_walk',
          image: sheetFromTiles([tileWith(0, 0), tileWith(7, 0)]),
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0, 1],
          frameDuration: 8,
        },
      ],
      flipDeduplication: true,
    });
    const animation = model.animations[0];
    const frame = animation?.frames[1];

    expect(animation).toBeDefined();
    expect(frame).toBeDefined();
    if (animation === undefined || frame === undefined) return;

    const [cell] = createAnimationFrameMapping(model, animation, frame);
    expect(cell?.sprite).toMatchObject({
      tile: 0,
      physicalTileIndex: 0,
      attributes: NES_SPRITE_FLIP_HORIZONTAL,
      horizontalFlip: true,
      reuse: 'imported',
    });
    expect(cell?.tile?.pixels[7]).toBe(1);
    expect(model.chr.newTileCount).toBe(1);
    expect(model.chr.reusedImportedTiles).toBe(1);
  });

  it('uses final mirrored positions, orientation, attributes, and sprite order', () => {
    const model = buildAnimationProjectModel({
      name: 'hero',
      animations: [
        {
          id: 'anim-walk',
          name: 'hero_walk',
          image: sheetFromTiles([tileWith(0, 0), tileWith(2, 0)]),
          frameWidth: 16,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 8,
          category: 'movement',
          direction: 'right',
          exportMirroredDirection: true,
        },
      ],
      flipDeduplication: false,
    });
    const animation = model.animations.find(
      (candidate) => candidate.generatedByHorizontalFlip,
    );
    const frame = animation?.frames[0];

    expect(animation).toBeDefined();
    expect(frame).toBeDefined();
    if (animation === undefined || frame === undefined) return;
    expect(animation.id).toBe('anim-walk');

    const mapping = createAnimationFrameMapping(model, animation, frame);
    expect(
      mapping.map((cell) => ({
        column: cell.column,
        sourceColumn: cell.sprite?.sourceTileColumn,
        spriteOrder: cell.spriteOrder,
        x: cell.sprite?.x,
      })),
    ).toEqual([
      { column: 0, sourceColumn: 1, spriteOrder: 1, x: 0 },
      { column: 1, sourceColumn: 0, spriteOrder: 0, x: 8 },
    ]);
    expect(
      mapping.every(
        (cell) =>
          cell.sprite?.horizontalFlip === true &&
          cell.sprite.attributes === NES_SPRITE_FLIP_HORIZONTAL,
      ),
    ).toBe(true);
    expect(mapping[0]?.tile?.pixels[5]).toBe(1);
    expect(mapping[1]?.tile?.pixels[7]).toBe(1);
  });
});
