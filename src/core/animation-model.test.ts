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
          flipH: true,
          flipV: true,
          frameIndices: [0],
          frameDuration: 8,
        },
      ],
      originX: 8,
      flipDeduplication: false,
    });

    const anim = model.animations[0];
    expect(anim?.flipH).toBe(true);
    expect(anim?.flipV).toBe(true);
    const sprites = anim?.frames[0]?.sprites ?? [];
    expect(sprites).toHaveLength(2);
    // Metasprite x is flipped
    expect(sprites.map((s) => s.x)).toEqual([0, -8]);
    expect(
      sprites.every(
        (s) =>
          (s.attributes &
            (NES_SPRITE_FLIP_HORIZONTAL | NES_SPRITE_FLIP_VERTICAL)) ===
          (NES_SPRITE_FLIP_HORIZONTAL | NES_SPRITE_FLIP_VERTICAL),
      ),
    ).toBe(true);
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

  it('deserializes v4 JSON metadata correctly', () => {
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
          flip_h: true,
          flip_v: false,
          default_frame_duration: 4,
          frames: [{ source_index: 2, duration: 4 }],
        },
      ],
    });

    const parsed = deserializeAnimationMetadata(v4Json);
    expect(parsed.version).toBe(4);
    expect(parsed.animations[0]).toMatchObject({
      name: 'attack',
      playback: 'once',
      flipH: true,
      flipV: false,
      frameIndices: [2],
      frameDurations: [4],
    });
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
});
