import { describe, expect, it } from 'vitest';

import { encodeChr } from './chr-encoder';
import {
  ANIMATION_METADATA_VERSION,
  AnimationModelError,
  NES_SPRITE_FLIP_HORIZONTAL,
  NES_SPRITE_FLIP_VERTICAL,
  buildAnimationProjectModel,
  deserializeAnimationMetadata,
  type AnimationPlayback,
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

  it('stores playback mode and individual duration for every selected frame', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]]), tileWith([[1, 0]])]);
    const model = buildAnimationProjectModel({
      name: 'player',
      sourceImageName: 'player.png',
      image: sheet,
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        {
          name: 'attack',
          playback: 'once',
          frameIndices: [1, 0],
          frameDuration: 12,
          frameDurations: [4, 20],
        },
      ],
    });

    expect(model.animations[0]?.playback).toBe('once');
    expect(model.animations[0]?.frames.map((frame) => frame.duration)).toEqual([
      4, 20,
    ]);
    expect(model.animations[0]?.defaultFrameDuration).toBe(12);
  });

  it('supports multiple arbitrary animations with custom names and playback modes', () => {
    const sheet = sheetFromTiles([
      tileWith([[0, 0]]),
      tileWith([[1, 0]]),
      tileWith([[2, 0]]),
      tileWith([[3, 0]]),
      tileWith([[4, 0]]),
    ]);
    const model = buildAnimationProjectModel({
      name: 'soldier',
      sourceImageName: 'soldier.png',
      image: sheet,
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        {
          name: 'idle',
          playback: 'loop',
          frameIndices: [0],
          frameDuration: 10,
        },
        { name: 'walk', playback: 'loop', frameIndices: [1], frameDuration: 8 },
        {
          name: 'attack',
          playback: 'once',
          frameIndices: [2],
          frameDuration: 6,
        },
        { name: 'hurt', playback: 'once', frameIndices: [3], frameDuration: 4 },
        {
          name: 'death',
          playback: 'once',
          frameIndices: [4],
          frameDuration: 12,
        },
      ],
    });

    expect(model.animations).toHaveLength(5);
    expect(model.animations.map((a) => a.name)).toEqual([
      'idle',
      'walk',
      'attack',
      'hurt',
      'death',
    ]);
    expect(model.animations.map((a) => a.playback)).toEqual([
      'loop',
      'loop',
      'once',
      'once',
      'once',
    ]);
  });

  it('supports horizontal and vertical flips on generic animations', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]]), tileWith([[1, 1]])]);
    const model = buildAnimationProjectModel({
      name: 'hero',
      sourceImageName: 'hero.png',
      image: sheet,
      frameWidth: 16,
      frameHeight: 8,
      animations: [
        {
          name: 'cast_flipped',
          playback: 'once',
          allowHorizontalFlip: true,
          allowVerticalFlip: true,
          frameIndices: [0],
          frameDuration: 8,
        },
      ],
      originX: 8,
      flipDeduplication: false,
    });

    const anim = model.animations[0];
    expect(anim?.allowHorizontalFlip).toBe(true);
    expect(anim?.allowVerticalFlip).toBe(true);
    expect(anim?.flipH).toBe(true);
    expect(anim?.flipV).toBe(true);
    const sprites = anim?.frames[0]?.sprites ?? [];
    expect(sprites).toHaveLength(2);
    // Base animation keeps natural orientation
    expect(sprites.map((s) => s.x)).toEqual([-8, 0]);
  });

  it('rejects duplicate animation names and duplicate sanitized C identifiers', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]]), tileWith([[1, 0]])]);
    expect(() =>
      buildAnimationProjectModel({
        name: 'player',
        sourceImageName: 'player.png',
        image: sheet,
        frameWidth: 8,
        frameHeight: 8,
        animations: [
          { name: 'walk', frameIndices: [0], frameDuration: 8 },
          { name: 'Walk', frameIndices: [1], frameDuration: 8 },
        ],
      }),
    ).toThrow(
      new AnimationModelError('duplicate-animation-name', { name: 'Walk' }),
    );

    expect(() =>
      buildAnimationProjectModel({
        name: 'player',
        sourceImageName: 'player.png',
        image: sheet,
        frameWidth: 8,
        frameHeight: 8,
        animations: [
          { name: 'walk left', frameIndices: [0], frameDuration: 8 },
          { name: 'walk-left', frameIndices: [1], frameDuration: 8 },
        ],
      }),
    ).toThrow(
      new AnimationModelError('duplicate-animation-identifier', {
        name: 'walk-left',
        identifier: 'walk_left',
      }),
    );
  });

  it('rejects invalid playback modes', () => {
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
            name: 'walk',
            playback: 'invalid' as unknown as AnimationPlayback,
            frameIndices: [0],
            frameDuration: 8,
          },
        ],
      }),
    ).toThrow(
      new AnimationModelError('invalid-playback', { playback: 'invalid' }),
    );
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
    expect(model.finalChr).toHaveLength(8 * 1024);
    expect(model.finalChr.slice(0, destination.length)).toEqual(destination);
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
      expect(model.finalChr).toHaveLength(8 * 1024);
      expect(model.finalChr.slice(0, destination.length)).toEqual(destination);
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

  it('keeps sprite tile bytes local to the selected pattern table', () => {
    const destination = encodeChr(
      Array.from({ length: 256 }, () => tileWith([[0, 0]])),
    );
    const model = buildAnimationProjectModel({
      name: 'player',
      sourceImageName: 'player.png',
      image: sheetFromTiles([tileWith([[1, 1]])]),
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        { name: 'idle', category: 'idle', frameIndices: [0], frameDuration: 8 },
      ],
      baseChr: destination,
      patternTable: 1,
    });

    expect(model.patternTable).toBe(1);
    expect(model.animations[0]?.frames[0]?.sprites[0]).toMatchObject({
      tile: 0,
      physicalTileIndex: 256,
      reuse: 'new',
    });
    expect(model.chr.patternTable).toBe(1);
    expect(model.chr.physicalCapacityTiles).toBe(512);
    expect(model.chr.patternTableCapacityTiles).toBe(256);
    expect(model.finalChr.slice(0, destination.length)).toEqual(destination);
  });

  it('allocates the final local tile index at physical tile 511', () => {
    const destination = encodeChr(
      Array.from({ length: 255 }, () => tileWith([[0, 0]])),
    );
    const model = buildAnimationProjectModel({
      name: 'player',
      sourceImageName: 'player.png',
      image: sheetFromTiles([tileWith([[1, 1]])]),
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        { name: 'idle', category: 'idle', frameIndices: [0], frameDuration: 8 },
      ],
      baseChr: destination,
      patternTable: 1,
      destinationPatternTable: 1,
    });

    expect(model.animations[0]?.frames[0]?.sprites[0]).toMatchObject({
      tile: 255,
      physicalTileIndex: 511,
    });
  });

  it('does not deduplicate tiles across pattern tables', () => {
    const repeatedTile = tileWith([[2, 2]]);
    const model = buildAnimationProjectModel({
      name: 'player',
      sourceImageName: 'player.png',
      image: sheetFromTiles([repeatedTile]),
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        { name: 'idle', category: 'idle', frameIndices: [0], frameDuration: 8 },
      ],
      baseChr: encodeChr([repeatedTile]),
      patternTable: 1,
    });

    expect(model.chr.reusedDestinationTiles).toBe(0);
    expect(model.chr.newTileCount).toBe(1);
    expect(model.animations[0]?.frames[0]?.sprites[0]).toMatchObject({
      tile: 0,
      physicalTileIndex: 256,
      reuse: 'new',
    });
  });

  it('rejects allocation when the selected pattern table is full', () => {
    const destination = encodeChr(
      Array.from({ length: 256 }, () => tileWith([[0, 0]])),
    );

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
      }),
    ).toThrow(
      new AnimationModelError('pattern-table-capacity-overflow', {
        patternTable: 0,
        capacityTiles: 256,
      }),
    );
  });

  it('treats a full pattern table 1 as full even when table 0 is empty', () => {
    const destination = encodeChr(
      Array.from({ length: 256 }, () => tileWith([[0, 0]])),
    );

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
        patternTable: 1,
        destinationPatternTable: 1,
      }),
    ).toThrow(
      new AnimationModelError('pattern-table-capacity-overflow', {
        patternTable: 1,
        capacityTiles: 256,
      }),
    );
  });

  it('accepts a full 8 KiB CHR ROM when its selected table has matching tiles', () => {
    const repeatedTile = tileWith([[2, 2]]);
    const destination = encodeChr(
      Array.from({ length: 512 }, () => repeatedTile),
    );
    const model = buildAnimationProjectModel({
      name: 'player',
      sourceImageName: 'player.png',
      image: sheetFromTiles([repeatedTile]),
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        { name: 'idle', category: 'idle', frameIndices: [0], frameDuration: 8 },
      ],
      baseChr: destination,
      patternTable: 1,
    });

    expect(model.finalChr).toEqual(destination);
    expect(model.animations[0]?.frames[0]?.sprites[0]).toMatchObject({
      tile: 0,
      physicalTileIndex: 256,
      reuse: 'destination',
    });
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
            frameIndices: [10],
            frameDuration: 8,
          },
        ],
      }),
    ).toThrow(
      new AnimationModelError('invalid-frame-selection', { frameIndex: 10 }),
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

  it('deserializes and migrates legacy v3 JSON to generic animations', () => {
    const legacyJson = JSON.stringify({
      format: 'png2chr-studio-animation',
      version: 3,
      name: 'hero',
      symbol_prefix: 'hero',
      symbol_base: 'hero_idle',
      source: {
        image: 'hero.png',
        frame_width: 16,
        frame_height: 16,
      },
      animations: [
        {
          name: 'idle',
          type: 'idle',
          default_frame_duration: 12,
          frames: [{ source_index: 0, duration: 12 }],
        },
        {
          name: 'movement_left',
          type: 'movement',
          generated_by_horizontal_flip: true,
          default_frame_duration: 6,
          frames: [{ source_index: 1, duration: 6 }],
        },
      ],
    });

    const parsed = deserializeAnimationMetadata(legacyJson);
    expect(parsed.version).toBe(3);
    expect(parsed.patternTable).toBe(0);
    expect(parsed.destinationPatternTable).toBe(0);
    expect(parsed.animations).toHaveLength(2);
    expect(parsed.animations[0]).toMatchObject({
      name: 'idle',
      playback: 'loop',
      flipH: false,
      flipV: false,
      frameIndices: [0],
    });
    expect(parsed.animations[1]).toMatchObject({
      name: 'movement_left',
      playback: 'loop',
      flipH: true,
      flipV: false,
      frameIndices: [1],
    });
  });

  it('deserializes v4 JSON metadata correctly with allow_horizontal_flip and allow_vertical_flip', () => {
    const v4Json = JSON.stringify({
      format: 'png2chr-studio-animation',
      version: 4,
      name: 'soldier',
      symbol_prefix: 'soldier',
      symbol_base: 'soldier',
      source: {
        image: 'soldier.png',
        frame_width: 8,
        frame_height: 8,
      },
      animations: [
        {
          name: 'attack',
          playback: 'once',
          allow_horizontal_flip: true,
          allow_vertical_flip: false,
          default_frame_duration: 4,
          origin_x: 4,
          origin_y: 8,
          frames: [{ source_index: 2, duration: 4 }],
        },
      ],
    });

    const parsed = deserializeAnimationMetadata(v4Json);
    expect(parsed.version).toBe(4);
    expect(parsed.name).toBe('soldier');
    expect(parsed.symbolPrefix).toBe('soldier');
    expect(parsed.animations[0]).toMatchObject({
      name: 'attack',
      playback: 'once',
      allowHorizontalFlip: true,
      allowVerticalFlip: false,
      flipH: true,
      flipV: false,
      originX: 4,
      originY: 8,
      frameIndices: [2],
      frameDurations: [4],
    });
  });

  it('unifies symbolBase to single name when symbolPrefix matches name', () => {
    const sheet = sheetFromTiles([tileWith([[0, 0]])]);
    const model = buildAnimationProjectModel({
      name: 'soldier',
      symbolPrefix: 'soldier',
      sourceImageName: 'soldier.png',
      image: sheet,
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        {
          name: 'idle',
          playback: 'loop',
          frameIndices: [0],
          frameDuration: 10,
        },
      ],
    });

    expect(model.symbolPrefix).toBe('soldier');
    expect(model.symbolBase).toBe('soldier');
  });

  it('supports multiple animations with independent PNG sources, frame sizes, and origins', () => {
    const idleTile = tileWith([[1, 1]]);
    const attackTile1 = tileWith([[2, 2]]);
    const attackTile2 = tileWith([[3, 3]]);

    const idleSheet = sheetFromTiles([idleTile]); // 8x8
    const attackSheet = sheetFromTiles([attackTile1, attackTile2]); // 16x8 (two 8x8 tiles)

    const model = buildAnimationProjectModel({
      name: 'soldier',
      symbolPrefix: 'soldier',
      animations: [
        {
          name: 'idle',
          sourceImageName: 'soldier_idle.png',
          image: idleSheet,
          frameWidth: 8,
          frameHeight: 8,
          originX: 4,
          originY: 4,
          playback: 'loop',
          frameIndices: [0],
          frameDuration: 12,
        },
        {
          name: 'attack',
          sourceImageName: 'soldier_attack.png',
          image: attackSheet,
          frameWidth: 16,
          frameHeight: 8,
          originX: 8,
          originY: 0,
          playback: 'once',
          frameIndices: [0],
          frameDuration: 6,
        },
      ],
    });

    expect(model.animations).toHaveLength(2);
    expect(model.animations[0]).toMatchObject({
      name: 'idle',
      sourceFile: 'soldier_idle.png',
      width: 8,
      height: 8,
      originX: 4,
      originY: 4,
      playback: 'loop',
    });
    expect(model.animations[1]).toMatchObject({
      name: 'attack',
      sourceFile: 'soldier_attack.png',
      width: 16,
      height: 8,
      originX: 8,
      originY: 0,
      playback: 'once',
    });
    // CHR has 3 distinct tiles
    expect(model.chr.finalTileCount).toBe(3);
  });

  it('deduplicates identical tiles across different PNG sources', () => {
    const sharedTile = tileWith([
      [1, 2],
      [3, 4],
    ]);
    const uniqueTile = tileWith([[5, 6]]);

    const sheet1 = sheetFromTiles([sharedTile]);
    const sheet2 = sheetFromTiles([sharedTile, uniqueTile]);

    const model = buildAnimationProjectModel({
      name: 'hero',
      symbolPrefix: 'hero',
      animations: [
        {
          name: 'idle',
          sourceImageName: 'idle.png',
          image: sheet1,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 10,
        },
        {
          name: 'walk',
          sourceImageName: 'walk.png',
          image: sheet2,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0, 1],
          frameDuration: 8,
        },
      ],
    });

    expect(model.chr.newTileCount).toBe(2);
    expect(model.chr.reusedImportedTiles).toBe(1);
    expect(model.chr.finalTileCount).toBe(2);
  });

  it('supports flip deduplication across different PNG sources', () => {
    const normalTile = tileWith([[0, 0]]);
    const flippedTile = tileWith([[7, 0]]); // H-flipped version of normalTile

    const sheet1 = sheetFromTiles([normalTile]);
    const sheet2 = sheetFromTiles([flippedTile]);

    const model = buildAnimationProjectModel({
      name: 'hero',
      symbolPrefix: 'hero',
      flipDeduplication: true,
      animations: [
        {
          name: 'idle',
          sourceImageName: 'idle.png',
          image: sheet1,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 10,
        },
        {
          name: 'cast',
          sourceImageName: 'cast.png',
          image: sheet2,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 8,
        },
      ],
    });

    expect(model.chr.newTileCount).toBe(1);
    expect(model.chr.reusedImportedTiles).toBe(1);
    expect(model.animations[1]?.frames[0]?.sprites[0]?.attributes).toBe(
      NES_SPRITE_FLIP_HORIZONTAL,
    );
  });

  it('deserializes per-animation source v4 JSON metadata correctly', () => {
    const v4Json = JSON.stringify({
      format: 'png2chr-studio-animation',
      version: 4,
      name: 'soldier',
      symbol_prefix: 'soldier',
      symbol_base: 'soldier',
      animations: [
        {
          name: 'idle',
          source_file: 'soldier_idle.png',
          frame_width: 16,
          frame_height: 24,
          origin_x: 8,
          origin_y: 23,
          playback: 'loop',
          flip_h: false,
          flip_v: false,
          default_frame_duration: 12,
          frames: [{ source_index: 0, duration: 12 }],
        },
        {
          name: 'attack',
          source_file: 'soldier_attack.png',
          frame_width: 24,
          frame_height: 24,
          origin_x: 12,
          origin_y: 23,
          playback: 'once',
          flip_h: true,
          flip_v: false,
          default_frame_duration: 6,
          frames: [{ source_index: 1, duration: 6 }],
        },
      ],
    });

    const parsed = deserializeAnimationMetadata(v4Json);
    expect(parsed.version).toBe(4);
    expect(parsed.animations).toHaveLength(2);
    expect(parsed.animations[0]).toMatchObject({
      name: 'idle',
      sourceFile: 'soldier_idle.png',
      frameWidth: 16,
      frameHeight: 24,
      originX: 8,
      originY: 23,
      playback: 'loop',
    });
    expect(parsed.animations[1]).toMatchObject({
      name: 'attack',
      sourceFile: 'soldier_attack.png',
      frameWidth: 24,
      frameHeight: 24,
      originX: 12,
      originY: 23,
      playback: 'once',
      flipH: true,
    });
  });

  it('supports full multi-source asset scenario: idle, walk, attack, death with independent PNGs', () => {
    const idleSheet = image(
      16,
      16,
      Array.from({ length: 256 }, (_, i) => (i % 3) + 1),
    );
    const walkSheet = image(
      32,
      16,
      Array.from({ length: 512 }, (_, i) => (i % 2) + 1),
    );
    const attackSheet = image(
      24,
      24,
      Array.from({ length: 576 }, () => 2),
    );
    const deathSheet = image(
      16,
      32,
      Array.from({ length: 512 }, () => 1),
    );

    const model = buildAnimationProjectModel({
      name: 'hero',
      symbolPrefix: 'hero',
      animations: [
        {
          name: 'idle',
          sourceImageName: 'idle.png',
          image: idleSheet,
          frameWidth: 16,
          frameHeight: 16,
          originX: 8,
          originY: 15,
          playback: 'loop',
          frameIndices: [0],
          frameDuration: 12,
        },
        {
          name: 'walk',
          sourceImageName: 'walk.png',
          image: walkSheet,
          frameWidth: 16,
          frameHeight: 16,
          originX: 8,
          originY: 15,
          playback: 'loop',
          frameIndices: [0, 1],
          frameDuration: 8,
        },
        {
          name: 'attack',
          sourceImageName: 'attack.png',
          image: attackSheet,
          frameWidth: 24,
          frameHeight: 24,
          originX: 12,
          originY: 23,
          playback: 'once',
          frameIndices: [0],
          frameDuration: 6,
        },
        {
          name: 'death',
          sourceImageName: 'death.png',
          image: deathSheet,
          frameWidth: 16,
          frameHeight: 16,
          originX: 8,
          originY: 15,
          playback: 'once',
          frameIndices: [0, 1],
          frameDuration: 10,
        },
      ],
    });

    expect(model.animations).toHaveLength(4);
    expect(model.animations[0]?.name).toBe('idle');
    expect(model.animations[0]?.sourceFile).toBe('idle.png');
    expect(model.animations[0]?.playback).toBe('loop');

    expect(model.animations[1]?.name).toBe('walk');
    expect(model.animations[1]?.sourceFile).toBe('walk.png');
    expect(model.animations[1]?.playback).toBe('loop');

    expect(model.animations[2]?.name).toBe('attack');
    expect(model.animations[2]?.sourceFile).toBe('attack.png');
    expect(model.animations[2]?.playback).toBe('once');
    expect(model.animations[2]?.width).toBe(24);
    expect(model.animations[2]?.height).toBe(24);

    expect(model.animations[3]?.name).toBe('death');
    expect(model.animations[3]?.sourceFile).toBe('death.png');
    expect(model.animations[3]?.playback).toBe('once');

    // Consolidated CHR contains all unique tiles from all 4 animations
    expect(model.finalChr.length).toBeGreaterThan(0);
    expect(model.chr.finalTileCount).toBeGreaterThan(0);
  });

  it('guarantees immutability of graphic data when enabling allowHorizontalFlip', () => {
    const tile1 = tileWith([[1, 2]]);
    const tile2 = tileWith([[3, 4]]);
    const sheet = sheetFromTiles([tile1, tile2]);

    const modelNoFlip = buildAnimationProjectModel({
      name: 'soldier',
      symbolPrefix: 'soldier',
      animations: [
        {
          name: 'idle',
          sourceImageName: 'soldier.png',
          image: sheet,
          frameWidth: 16,
          frameHeight: 8,
          originX: 8,
          originY: 4,
          playback: 'loop',
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          frameIndices: [0],
          frameDuration: 8,
        },
      ],
    });

    const modelWithFlip = buildAnimationProjectModel({
      name: 'soldier',
      symbolPrefix: 'soldier',
      animations: [
        {
          name: 'idle',
          sourceImageName: 'soldier.png',
          image: sheet,
          frameWidth: 16,
          frameHeight: 8,
          originX: 8,
          originY: 4,
          playback: 'loop',
          allowHorizontalFlip: true,
          allowVerticalFlip: false,
          frameIndices: [0],
          frameDuration: 8,
        },
      ],
    });

    // Final CHR bytes must be completely identical
    expect(modelWithFlip.finalChr).toEqual(modelNoFlip.finalChr);
    expect(modelWithFlip.chr.finalTileCount).toBe(
      modelNoFlip.chr.finalTileCount,
    );

    // Frame sprites and tiles must be completely identical
    const frameNoFlip = modelNoFlip.animations[0]?.frames[0];
    const frameWithFlip = modelWithFlip.animations[0]?.frames[0];
    expect(frameWithFlip?.sprites).toEqual(frameNoFlip?.sprites);

    // Only allowHorizontalFlip capability changes
    expect(modelNoFlip.animations[0]?.allowHorizontalFlip).toBe(false);
    expect(modelWithFlip.animations[0]?.allowHorizontalFlip).toBe(true);
  });

  it('migrates legacy JSON v4 with per-animation quantization_mode to global colorReduction', () => {
    const legacyV4Json = JSON.stringify({
      format: 'png2chr-studio-animation',
      version: 4,
      name: 'soldier',
      symbol_prefix: 'soldier',
      animations: [
        {
          name: 'idle',
          quantization_mode: 'k-means',
          allow_horizontal_flip: true,
          frames: [{ source_index: 0, duration: 10 }],
        },
      ],
    });

    const parsed = deserializeAnimationMetadata(legacyV4Json);
    expect(parsed.colorReduction).toBe('k-means');
    expect(parsed.animations[0]?.quantizationMode).toBe('k-means');
  });

  it('uses root color_reduction as source of truth during JSON v4 deserialization', () => {
    const v4Json = JSON.stringify({
      format: 'png2chr-studio-animation',
      version: 4,
      name: 'soldier',
      symbol_prefix: 'soldier',
      color_reduction: 'nearest',
      animations: [
        {
          name: 'idle',
          // even if legacy field exists, root is source of truth
          quantization_mode: 'k-means',
          allow_horizontal_flip: true,
          frames: [{ source_index: 0, duration: 10 }],
        },
      ],
    });

    const parsed = deserializeAnimationMetadata(v4Json);
    expect(parsed.colorReduction).toBe('nearest');
  });

  it('resolves effective palette hierarchically (frame -> animation -> asset default)', () => {
    const sheet = sheetFromTiles([
      tileWith([[0, 0]]),
      tileWith([[1, 0]]),
      tileWith([[2, 0]]),
    ]);

    const model = buildAnimationProjectModel({
      name: 'soldier',
      symbolPrefix: 'soldier',
      defaultPaletteIndex: 1,
      animations: [
        {
          name: 'inherited_anim',
          image: sheet,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0, 1, 2],
          frameDuration: 6,
          // no animation palette -> inherits defaultPaletteIndex (1)
          // frame 2 overrides with palette 3
          framePalettes: [null, null, 3],
        },
        {
          name: 'explicit_anim',
          image: sheet,
          paletteIndex: 2,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0, 1],
          frameDuration: 6,
          // frame 1 overrides with palette 0
          framePalettes: [null, 0],
        },
      ],
    });

    expect(model.defaultPaletteIndex).toBe(1);

    // First animation: effective animation palette is 1
    const anim0 = model.animations[0];
    expect(anim0).toBeDefined();
    expect(anim0?.paletteIndex).toBeNull();
    expect(anim0?.effectivePalette).toBe(1);
    expect(anim0?.frames[0]?.paletteIndex).toBeNull();
    expect(anim0?.frames[0]?.effectivePalette).toBe(1);
    expect(anim0?.frames[0]?.sprites[0]?.palette).toBe(1);
    expect((anim0?.frames[0]?.sprites[0]?.attributes ?? 0) & 0x03).toBe(1);

    expect(anim0?.frames[1]?.effectivePalette).toBe(1);
    expect(anim0?.frames[1]?.sprites[0]?.palette).toBe(1);

    expect(anim0?.frames[2]?.paletteIndex).toBe(3);
    expect(anim0?.frames[2]?.effectivePalette).toBe(3);
    expect(anim0?.frames[2]?.sprites[0]?.palette).toBe(3);
    expect((anim0?.frames[2]?.sprites[0]?.attributes ?? 0) & 0x03).toBe(3);

    // Second animation: effective animation palette is 2
    const anim1 = model.animations[1];
    expect(anim1).toBeDefined();
    expect(anim1?.paletteIndex).toBe(2);
    expect(anim1?.effectivePalette).toBe(2);
    expect(anim1?.frames[0]?.paletteIndex).toBeNull();
    expect(anim1?.frames[0]?.effectivePalette).toBe(2);
    expect(anim1?.frames[0]?.sprites[0]?.palette).toBe(2);
    expect((anim1?.frames[0]?.sprites[0]?.attributes ?? 0) & 0x03).toBe(2);

    expect(anim1?.frames[1]?.paletteIndex).toBe(0);
    expect(anim1?.frames[1]?.effectivePalette).toBe(0);
    expect(anim1?.frames[1]?.sprites[0]?.palette).toBe(0);
    expect((anim1?.frames[1]?.sprites[0]?.attributes ?? 0) & 0x03).toBe(0);
  });

  it('preserves Flip H/V bits while setting palette bits in sprite attributes', () => {
    // Tile 0: point at (0, 0)
    // Tile 1: horizontal flip of Tile 0: point at (7, 0)
    const t0 = tileWith([[0, 0]]);
    const t1 = tileWith([[7, 0]]);
    const sheet = sheetFromTiles([t0, t1]);

    const model = buildAnimationProjectModel({
      name: 'hero',
      defaultPaletteIndex: 2,
      animations: [
        {
          name: 'walk',
          image: sheet,
          paletteIndex: 3,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0, 1],
          frameDuration: 8,
        },
      ],
      flipDeduplication: true,
    });

    const anim = model.animations[0];
    // Frame 0: original tile, no flip, palette 3 -> attributes = 3
    expect(anim?.frames[0]?.sprites[0]?.horizontalFlip).toBe(false);
    expect(anim?.frames[0]?.sprites[0]?.attributes).toBe(3);

    // Frame 1: matched with horizontal flip, palette 3 -> attributes = 0x40 | 3 = 0x43
    expect(anim?.frames[1]?.sprites[0]?.horizontalFlip).toBe(true);
    expect(anim?.frames[1]?.sprites[0]?.attributes).toBe(
      NES_SPRITE_FLIP_HORIZONTAL | 3,
    );
    expect(anim?.frames[1]?.sprites[0]?.palette).toBe(3);
  });

  it('does NOT duplicate CHR tiles when changing palettes', () => {
    const identicalTile = tileWith([
      [2, 2],
      [3, 3],
    ]);
    const sheetA = sheetFromTiles([identicalTile]);
    const sheetB = sheetFromTiles([identicalTile]);

    const model = buildAnimationProjectModel({
      name: 'wizard',
      defaultPaletteIndex: 0,
      animations: [
        {
          name: 'cast_fire',
          image: sheetA,
          paletteIndex: 1, // palette 1 (e.g. fire)
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 10,
        },
        {
          name: 'cast_ice',
          image: sheetB,
          paletteIndex: 2, // palette 2 (e.g. ice)
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 10,
        },
      ],
      flipDeduplication: true,
    });

    // Only 1 unique tile allocated in CHR
    expect(model.chr.finalTileCount).toBe(1);
    expect(model.chr.reusedImportedTiles).toBe(1);
    expect(model.animations[0]?.frames[0]?.sprites[0]?.tile).toBe(0);
    expect(model.animations[1]?.frames[0]?.sprites[0]?.tile).toBe(0);
    expect(model.animations[0]?.frames[0]?.sprites[0]?.attributes).toBe(1);
    expect(model.animations[1]?.frames[0]?.sprites[0]?.attributes).toBe(2);
  });

  it('deserializes JSON v4 with default_palette_index, color_reduction, and frame palette overrides', () => {
    const jsonText = JSON.stringify({
      format: 'png2chr-studio-animation',
      version: 4,
      name: 'soldier',
      symbol_prefix: 'soldier',
      default_palette_index: 2,
      color_reduction: 'nearest',
      animations: [
        {
          name: 'idle',
          palette_index: 1,
          allow_horizontal_flip: true,
          frames: [
            { source_index: 0, duration: 10, palette_index: null },
            { source_index: 1, duration: 12, palette_index: 3 },
          ],
        },
        {
          name: 'hurt',
          palette_index: null,
          frames: [{ source_index: 2, duration: 4, palette_index: 0 }],
        },
      ],
    });

    const parsed = deserializeAnimationMetadata(jsonText);
    expect(parsed.defaultPaletteIndex).toBe(2);
    expect(parsed.colorReduction).toBe('nearest');
    expect(parsed.animations[0]?.paletteIndex).toBe(1);
    expect(parsed.animations[0]?.framePalettes).toEqual([null, 3]);
    expect(parsed.animations[1]?.paletteIndex).toBeNull();
    expect(parsed.animations[1]?.framePalettes).toEqual([0]);
  });

  it('deserializes v5 pattern-table settings', () => {
    const parsed = deserializeAnimationMetadata(
      JSON.stringify({
        format: 'png2chr-studio-animation',
        version: 5,
        name: 'ship',
        pattern_table: 1,
        destination_pattern_table: 1,
        animations: [],
      }),
    );

    expect(parsed.patternTable).toBe(1);
    expect(parsed.destinationPatternTable).toBe(1);
  });
});
