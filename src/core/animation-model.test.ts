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

  it('exports both movement directions by mirroring metasprite positions and H-flip bits', () => {
    const sheet = sheetFromTiles([
      tileWith([
        [0, 0],
        [1, 1],
      ]),
      tileWith([
        [2, 0],
        [4, 3],
        [7, 7],
      ]),
    ]);
    const model = buildAnimationProjectModel({
      name: 'player',
      sourceImageName: 'player.png',
      image: sheet,
      frameWidth: 16,
      frameHeight: 8,
      animations: [
        {
          name: 'movement',
          category: 'movement',
          frameIndices: [0],
          frameDuration: 6,
          direction: 'right',
          exportMirroredDirection: true,
        },
      ],
      originX: 8,
      flipDeduplication: false,
    });

    expect(
      model.animations.map(({ name, direction }) => ({ name, direction })),
    ).toEqual([
      { name: 'movement_right', direction: 'right' },
      { name: 'movement_left', direction: 'left' },
    ]);
    expect(model.animations[0]?.generatedByHorizontalFlip).toBe(false);
    expect(model.animations[1]?.generatedByHorizontalFlip).toBe(true);
    expect(model.animations[0]?.frames[0]?.sprites.map(({ x }) => x)).toEqual([
      -8, 0,
    ]);
    expect(model.animations[1]?.frames[0]?.sprites.map(({ x }) => x)).toEqual([
      0, -8,
    ]);
    expect(
      model.animations[1]?.frames[0]?.sprites.every(
        ({ attributes, horizontalFlip }) =>
          (attributes & NES_SPRITE_FLIP_HORIZONTAL) !== 0 && horizontalFlip,
      ),
    ).toBe(true);
    expect(model.chr.newTileCount).toBe(2);
  });

  it('keeps original sprite orientation when exporting only one movement direction', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]])]);
    const model = buildAnimationProjectModel({
      name: 'ship',
      sourceImageName: 'ship.png',
      image: sheet,
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        {
          name: 'movement',
          category: 'movement',
          frameIndices: [0],
          frameDuration: 6,
          direction: 'left',
          exportMirroredDirection: false,
        },
      ],
    });

    expect(model.animations).toHaveLength(1);
    expect(model.animations[0]).toMatchObject({
      name: 'movement',
      direction: 'left',
      generatedByHorizontalFlip: false,
    });
    expect(model.animations[0]?.frames[0]?.sprites[0]).toMatchObject({
      x: 0,
      horizontalFlip: false,
      attributes: 0,
    });
  });

  it('rejects directional settings on idle animations', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]])]);
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
            direction: 'right',
          },
        ],
      }),
    ).toThrow(new AnimationModelError('invalid-animation-direction'));
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

  it('normalizes the configured symbol prefix and animation name', () => {
    const model = buildAnimationProjectModel({
      name: 'Idle State',
      symbolPrefix: 'Soldier #1',
      sourceImageName: 'unused.png',
      image: sheetFromTiles([tileWith([[0, 0]])]),
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        { name: 'idle', category: 'idle', frameIndices: [0], frameDuration: 8 },
      ],
    });

    expect(model.symbolPrefix).toBe('soldier_1');
    expect(model.symbolBase).toBe('soldier_1_idle_state');
    expect(model.chr.output).toBe('soldier_1_idle_state.chr');
  });

  it('derives a safe prefix from the source filename when omitted', () => {
    const model = buildAnimationProjectModel({
      name: 'Idle',
      sourceImageName: 'assets/Bee-Bot 01.png',
      image: sheetFromTiles([tileWith([[0, 0]])]),
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        { name: 'idle', category: 'idle', frameIndices: [0], frameDuration: 8 },
      ],
    });

    expect(model.symbolPrefix).toBe('bee_bot_01');
    expect(model.symbolBase).toBe('bee_bot_01_idle');
  });

  it('rejects a configured prefix without identifier characters', () => {
    expect(() =>
      buildAnimationProjectModel({
        name: 'idle',
        symbolPrefix: '---',
        sourceImageName: 'player.png',
        image: sheetFromTiles([tileWith([[0, 0]])]),
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
      }),
    ).toThrow(new AnimationModelError('invalid-symbol-prefix'));
  });

  it('is deterministic for identical input', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]]), tileWith([[7, 0]])]);
    const first = build(sheet);
    const second = build(sheet);
    expect(first).toEqual(second);
  });
});
