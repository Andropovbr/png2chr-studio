import { describe, expect, it } from 'vitest';

import { encodeChr } from './chr-encoder';
import {
  ANIMATION_METADATA_VERSION,
  AnimationModelError,
  NES_SPRITE_FLIP_HORIZONTAL,
  NES_SPRITE_FLIP_VERTICAL,
  buildAnimationProjectModel,
} from './animation-model';
import type { IndexedImage, Tile } from './types';

function image(
  width: number,
  height: number,
  pixels: ArrayLike<number>,
): IndexedImage {
  return {
    width,
    height,
    pixels: Uint8Array.from(pixels),
    colors: [
      null,
      { red: 255, green: 255, blue: 255 },
      { red: 128, green: 128, blue: 128 },
      { red: 0, green: 0, blue: 0 },
    ],
    transparentIndex: 0,
    colorCount: 4,
  };
}

function tileWith(points: readonly [number, number][]): Tile {
  const pixels = new Uint8Array(64);
  points.forEach(([x, y]) => {
    pixels[y * 8 + x] = 1;
  });
  return { id: 0, column: 0, row: 0, pixels };
}

function sheetFromTiles(tiles: readonly Tile[]): IndexedImage {
  const pixels = new Uint8Array(tiles.length * 64);
  tiles.forEach((tile, tileIndex) => {
    for (let y = 0; y < 8; y += 1) {
      pixels.set(
        tile.pixels.slice(y * 8, y * 8 + 8),
        y * tiles.length * 8 + tileIndex * 8,
      );
    }
  });
  return image(tiles.length * 8, 8, pixels);
}

function build(
  sheet: IndexedImage,
  frameIndices = [0, 1],
  baseChr?: Uint8Array,
) {
  return buildAnimationProjectModel({
    name: 'player',
    sourceImageName: 'player.png',
    image: sheet,
    frameWidth: 8,
    frameHeight: 8,
    animations: [
      { name: 'idle', category: 'idle', frameIndices, frameDuration: 12 },
    ],
    baseChr,
    capacityTiles: 256,
    flipDeduplication: true,
  });
}

describe('animation project model', () => {
  it('extracts selected frames in their explicit order', () => {
    const first = tileWith([[0, 0]]);
    const second = tileWith([[1, 0]]);
    const model = build(sheetFromTiles([first, second]), [1, 0]);

    expect(model.version).toBe(ANIMATION_METADATA_VERSION);
    expect(
      model.animations[0]?.frames.map((frame) => frame.sourceIndex),
    ).toEqual([1, 0]);
    expect(model.animations[0]?.frames.map((frame) => frame.sourceX)).toEqual([
      8, 0,
    ]);
  });

  it('stores an individual duration for every selected frame', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]]), tileWith([[1, 0]])]);
    const model = buildAnimationProjectModel({
      name: 'player',
      sourceImageName: 'player.png',
      image: sheet,
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        {
          name: 'idle',
          category: 'idle',
          frameIndices: [1, 0],
          frameDuration: 12,
          frameDurations: [4, 20],
        },
      ],
    });

    expect(model.animations[0]?.frames.map((frame) => frame.duration)).toEqual([
      4, 20,
    ]);
    expect(model.animations[0]?.defaultFrameDuration).toBe(12);
  });

  it('rejects missing or invalid individual frame durations', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]]), tileWith([[1, 0]])]);
    const animation = {
      name: 'idle',
      category: 'idle' as const,
      frameIndices: [0, 1],
      frameDuration: 12,
    };
    const options = {
      name: 'player',
      sourceImageName: 'player.png',
      image: sheet,
      frameWidth: 8,
      frameHeight: 8,
      animations: [animation],
    };

    expect(() =>
      buildAnimationProjectModel({
        ...options,
        animations: [{ ...animation, frameDurations: [4] }],
      }),
    ).toThrow(new AnimationModelError('invalid-frame-duration'));
    expect(() =>
      buildAnimationProjectModel({
        ...options,
        animations: [{ ...animation, frameDurations: [4, 0] }],
      }),
    ).toThrow(new AnimationModelError('invalid-frame-duration'));
  });

  it('deduplicates exact tiles across frames', () => {
    const repeated = tileWith([[2, 3]]);
    const model = build(sheetFromTiles([repeated, repeated]));

    expect(model.chr.newTileCount).toBe(1);
    expect(model.chr.reusedImportedTiles).toBe(1);
    expect(model.animations[0]?.frames[1]?.sprites[0]?.tile).toBe(0);
  });

  it.each([
    ['horizontal', tileWith([[7, 0]]), NES_SPRITE_FLIP_HORIZONTAL],
    ['vertical', tileWith([[0, 7]]), NES_SPRITE_FLIP_VERTICAL],
    [
      'combined',
      tileWith([[7, 7]]),
      NES_SPRITE_FLIP_HORIZONTAL | NES_SPRITE_FLIP_VERTICAL,
    ],
  ])(
    'deduplicates a %s flipped tile and stores attributes',
    (_, flipped, attributes) => {
      const original = tileWith([[0, 0]]);
      const model = build(sheetFromTiles([original, flipped]));

      expect(model.chr.newTileCount).toBe(1);
      expect(model.animations[0]?.frames[1]?.sprites[0]?.attributes).toBe(
        attributes,
      );
    },
  );

  it('deduplicates against destination CHR and preserves destination bytes', () => {
    const destinationTile = tileWith([[3, 4]]);
    const destination = encodeChr([destinationTile]);
    const model = build(sheetFromTiles([destinationTile]), [0], destination);

    expect(model.chr.baseTileCount).toBe(1);
    expect(model.chr.reusedDestinationTiles).toBe(1);
    expect(model.chr.newTileCount).toBe(0);
    expect(model.animations[0]?.frames[0]?.sprites[0]?.tile).toBe(0);
    expect(model.finalChr).toEqual(destination);
  });

  it.each([
    ['horizontal', tileWith([[7, 0]]), NES_SPRITE_FLIP_HORIZONTAL],
    ['vertical', tileWith([[0, 7]]), NES_SPRITE_FLIP_VERTICAL],
    [
      'combined',
      tileWith([[7, 7]]),
      NES_SPRITE_FLIP_HORIZONTAL | NES_SPRITE_FLIP_VERTICAL,
    ],
  ])(
    'deduplicates a %s flipped PNG tile against the destination CHR',
    (_, importedTile, attributes) => {
      const destination = encodeChr([tileWith([[0, 0]])]);
      const model = build(sheetFromTiles([importedTile]), [0], destination);

      expect(model.chr.reusedDestinationTiles).toBe(1);
      expect(model.chr.newTileCount).toBe(0);
      expect(model.finalChr).toEqual(destination);
      expect(model.animations[0]?.frames[0]?.sprites[0]).toMatchObject({
        tile: 0,
        attributes,
        reuse: 'destination',
      });
    },
  );

  it('offsets newly appended tile indexes by destination tile count', () => {
    const destination = encodeChr([tileWith([[0, 0]])]);
    const imported = tileWith([[1, 1]]);
    const model = build(sheetFromTiles([imported]), [0], destination);

    expect(model.animations[0]?.frames[0]?.sprites[0]?.tile).toBe(1);
    expect(model.chr.appendedTileStart).toBe(1);
    expect(model.chr.finalTileCount).toBe(2);
  });

  it('omits fully transparent tiles while preserving explicit offsets', () => {
    const transparent = tileWith([]);
    const visible = tileWith([[0, 0]]);
    const model = buildAnimationProjectModel({
      name: 'player',
      sourceImageName: 'player.png',
      image: sheetFromTiles([transparent, visible]),
      frameWidth: 16,
      frameHeight: 8,
      animations: [
        { name: 'idle', category: 'idle', frameIndices: [0], frameDuration: 8 },
      ],
    });

    const frame = model.animations[0]?.frames[0];
    expect(frame?.omittedTileCount).toBe(1);
    expect(frame?.sprites).toHaveLength(1);
    expect(frame?.sprites[0]).toMatchObject({ x: 8, y: 0 });
  });

  it('supports a completely transparent frame', () => {
    const model = build(sheetFromTiles([tileWith([])]), [0]);
    expect(model.animations[0]?.frames[0]?.sprites).toEqual([]);
    expect(model.chr.newTileCount).toBe(0);
  });

  it('rejects capacity overflow', () => {
    const destination = encodeChr([tileWith([[0, 0]])]);
    expect(() =>
      buildAnimationProjectModel({
        name: 'player',
        sourceImageName: 'player.png',
        image: sheetFromTiles([tileWith([[1, 1]])]),
        frameWidth: 8,
        frameHeight: 8,
        animations: [
          {
            name: 'idle',
            category: 'idle',
            frameIndices: [0],
            frameDuration: 8,
          },
        ],
        baseChr: destination,
        capacityTiles: 1,
      }),
    ).toThrow(
      new AnimationModelError('chr-capacity-overflow', { capacityTiles: 1 }),
    );
  });

  it('rejects duplicate selection and invalid dimensions', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]]), tileWith([[1, 0]])]);
    expect(() =>
      buildAnimationProjectModel({
        name: 'player',
        sourceImageName: 'player.png',
        image: sheet,
        frameWidth: 8,
        frameHeight: 8,
        animations: [
          {
            name: 'idle',
            category: 'idle',
            frameIndices: [0],
            frameDuration: 8,
          },
          {
            name: 'walk',
            category: 'movement',
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
      }),
    ).toThrow(
      new AnimationModelError('duplicate-frame-selection', { frameIndex: 0 }),
    );
    expect(() =>
      buildAnimationProjectModel({
        name: 'player',
        sourceImageName: 'player.png',
        image: sheet,
        frameWidth: 7,
        frameHeight: 8,
        animations: [
          {
            name: 'idle',
            category: 'idle',
            frameIndices: [0],
            frameDuration: 8,
          },
        ],
      }),
    ).toThrow(AnimationModelError);
  });

  it('accepts display names with accents and validates signed sprite offsets', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]])]);
    const named = buildAnimationProjectModel({
      name: 'Ação do herói',
      sourceImageName: 'player.png',
      image: sheet,
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        {
          name: 'parado',
          category: 'idle',
          frameIndices: [0],
          frameDuration: 8,
        },
      ],
    });
    expect(named.name).toBe('Ação do herói');

    expect(() =>
      buildAnimationProjectModel({
        name: 'player',
        sourceImageName: 'player.png',
        image: sheet,
        frameWidth: 8,
        frameHeight: 8,
        animations: [
          {
            name: 'idle',
            category: 'idle',
            frameIndices: [0],
            frameDuration: 8,
          },
        ],
        originX: 129,
      }),
    ).toThrow(new AnimationModelError('invalid-origin'));
  });

  it('is deterministic for identical input', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]]), tileWith([[7, 0]])]);
    const first = build(sheet);
    const second = build(sheet);
    expect(first).toEqual(second);
  });
});
