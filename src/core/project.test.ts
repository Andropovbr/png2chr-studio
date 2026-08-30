import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_FORMAT_VERSION,
  createDefaultProjectGraphicsConfiguration,
  createDefaultProject,
  deserializeProject,
  findMissingAssets,
  getDirectoryPath,
  normalizePath,
  resolveProjectBackgroundPaletteSet,
  resolveProjectPaletteState,
  resolveProjectSpritePaletteSet,
  resolveRelativePath,
  serializeProject,
  toRelativePath,
  type StudioProject,
} from './project';
import { createDefaultNesPaletteSet } from './nes-palette';
import { extractProjectAssets } from './asset-identity';
import {
  createEmptyBackgroundMap,
  reconcileBackgroundMaps,
  type BackgroundMapDefinition,
} from './background-model';
import { resolveEffectivePaletteColors } from './palette-manager';

describe('StudioProject core infrastructure', () => {
  it('creates a clean default project with current formatVersion', () => {
    const project = createDefaultProject('NES Survivor', 'animation');
    expect(project.formatVersion).toBe(CURRENT_PROJECT_FORMAT_VERSION);
    expect(project.name).toBe('NES Survivor');
    expect(project.mode).toBe('animation');
    expect(project.settings.quantization.quantizationMode).toBe('median-cut');
    expect(project.palette.paletteSet.length).toBe(4);
    expect(project.animation?.animations.length).toBeGreaterThan(0);
  });

  it('serializes a project to valid formatted JSON', () => {
    const project = createDefaultProject('Platformer Test', 'playfield');
    const json = serializeProject(project);
    expect(typeof json).toBe('string');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.formatVersion).toBe(2);
    expect(parsed.name).toBe('Platformer Test');
    expect(parsed.mode).toBe('playfield');
  });

  it('deserializes a valid project JSON correctly', () => {
    const source: StudioProject = {
      formatVersion: 2,
      graphics: createDefaultProjectGraphicsConfiguration(),
      name: 'Mega Game',
      mode: 'tileset',
      settings: {
        deduplicationEnabled: true,
        flipDeduplicationEnabled: true,
        quantization: {
          quantizationMode: 'k-means',
          ditheringMode: 'floyd-steinberg',
          colorDistanceMode: 'rgb',
        },
      },
      palette: {
        universalBackgroundColor: 0x0f,
        palettes: [
          {
            id: 'pal_0',
            name: 'Palette 0',
            colors: [0x0f, 0x00, 0x10, 0x30],
          },
        ],
        activeBackgroundSlots: ['pal_0', null, null, null],
        activeSpriteSlots: ['pal_0', null, null, null],
        paletteSet: createDefaultNesPaletteSet(),
        activePaletteIndex: 2,
        activeColorIndex: 3,
      },
      tileset: {
        asset: {
          path: 'assets/tiles.png',
          name: 'tiles.png',
          sourceKind: 'png',
        },
        paletteAssignments: [0, 1, 2, 3],
        pixelOverrides: [1, 2, 3],
      },
    };

    const json = serializeProject(source);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.name).toBe('Mega Game');
      expect(result.project.mode).toBe('tileset');
      expect(result.project.settings.deduplicationEnabled).toBe(true);
      expect(result.project.settings.flipDeduplicationEnabled).toBe(true);
      expect(result.project.settings.quantization.quantizationMode).toBe(
        'k-means',
      );
      expect(result.project.settings.quantization.ditheringMode).toBe(
        'floyd-steinberg',
      );
      expect(result.project.settings.quantization.colorDistanceMode).toBe(
        'rgb',
      );
      expect(result.project.tileset?.asset?.path).toBe('assets/tiles.png');
      expect(result.project.tileset?.paletteAssignments).toEqual([0, 1, 2, 3]);
      expect(result.project.tileset?.pixelOverrides).toEqual([1, 2, 3]);
    }
  });

  it('performs lossless round-trip save -> load for animation mode projects', () => {
    const original = createDefaultProject('Full Adventure', 'animation');
    const baseAnimation =
      original.animation ?? createDefaultProject().animation;
    if (!baseAnimation) throw new Error('Missing base animation');
    const enriched: StudioProject = {
      ...original,
      animation: {
        ...baseAnimation,
        name: 'hero',
        symbolPrefix: 'hero_anim',
        defaultPaletteIndex: 1,
        flipDeduplication: true,
        patternTable: 1,
        destinationPatternTable: 0,
        destinationChr: {
          id: 'asset-base-chr-default',
          path: 'chr/base.chr',
          name: 'base.chr',
          sourceKind: 'chr',
        },
        animations: [
          {
            id: 'walk-id',
            name: 'walk',
            entity: 'hero',
            asset: {
              id: 'asset-anim-walk-id',
              path: 'sprites/hero_walk.png',
              name: 'hero_walk.png',
              sourceKind: 'png',
            },
            paletteId: original.palette.palettes[1]?.id ?? 'pal_1',
            paletteIndex: 1,
            framePaletteIds: [
              original.palette.palettes[1]?.id ?? 'pal_1',
              original.palette.palettes[1]?.id ?? 'pal_1',
              original.palette.palettes[2]?.id ?? 'pal_2',
              original.palette.palettes[1]?.id ?? 'pal_1',
            ],
            quantizationMode: 'median-cut',
            ditheringMode: 'none',
            frameWidth: 16,
            frameHeight: 32,
            originX: 8,
            originY: 32,
            playback: 'loop',
            allowHorizontalFlip: true,
            allowVerticalFlip: false,
            defaultDuration: 6,
            frameIndices: [0, 1, 2, 3],
            frameDurations: [6, 6, 8, 6],
            framePalettes: [1, 1, 2, 1],
          },
        ],
      },
    };

    const serialized = serializeProject(enriched);
    const loaded = deserializeProject(serialized);

    expect(loaded.success).toBe(true);
    if (loaded.success) {
      const reloaded = deserializeProject(serializeProject(loaded.project));
      expect(reloaded.success).toBe(true);
      if (reloaded.success) expect(reloaded.project).toEqual(loaded.project);
    }
  });

  it('performs lossless round-trip save -> load for tileset mode projects', () => {
    const tilesetProject: StudioProject = {
      formatVersion: 2,
      graphics: createDefaultProjectGraphicsConfiguration(),
      name: 'Dungeon Tileset',
      mode: 'tileset',
      settings: {
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        quantization: {
          quantizationMode: 'k-means',
          ditheringMode: 'floyd-steinberg',
          colorDistanceMode: 'rgb',
        },
      },
      palette: {
        universalBackgroundColor: 0x0f,
        palettes: [
          {
            id: 'pal_gray',
            name: 'Stone Gray',
            colors: [0x0f, 0x00, 0x10, 0x30],
          },
          {
            id: 'pal_red',
            name: 'Lava Red',
            colors: [0x0f, 0x06, 0x16, 0x26],
          },
        ],
        activeBackgroundSlots: ['pal_gray', 'pal_red', null, null],
        activeSpriteSlots: ['pal_gray', 'pal_red', null, null],
        activePaletteIndex: 1,
        activeColorIndex: 2,
        paletteSet: [
          [0x0f, 0x00, 0x10, 0x30],
          [0x0f, 0x06, 0x16, 0x26],
          [0x0f, 0x09, 0x19, 0x29],
          [0x0f, 0x03, 0x13, 0x23],
        ],
        activeSpritePaletteSlots: ['pal_gray', 'pal_red', null, null],
      },
      tileset: {
        asset: {
          id: 'asset-tileset-dungeon',
          path: 'assets/tiles/dungeon.png',
          name: 'dungeon.png',
          sourceKind: 'png',
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADUlEQVR4nGNgGAWDCQAAB4ABAXb6Z9YAAAAASUVORK5CYII=',
        },
        paletteAssignments: [0, 1, 2, 3, 0, 1, 2, 3],
        pixelOverrides: [0, 1, 2, 3, 0, 0, 1, 2],
      },
    };

    const serialized = serializeProject(tilesetProject);
    const loaded = deserializeProject(serialized);

    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.name).toBe('Dungeon Tileset');
      expect(loaded.project.mode).toBe('tileset');
      expect(loaded.project.settings.deduplicationEnabled).toBe(true);
      expect(loaded.project.settings.flipDeduplicationEnabled).toBe(false);
      expect(loaded.project.settings.quantization).toEqual({
        quantizationMode: 'k-means',
        ditheringMode: 'floyd-steinberg',
        colorDistanceMode: 'rgb',
      });
      expect(loaded.project.tileset?.asset).toEqual({
        id: 'asset-tileset-dungeon',
        path: 'assets/tiles/dungeon.png',
        name: 'dungeon.png',
        sourceKind: 'png',
        dataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADUlEQVR4nGNgGAWDCQAAB4ABAXb6Z9YAAAAASUVORK5CYII=',
      });
      expect(loaded.project.tileset?.paletteAssignments).toEqual([
        0, 1, 2, 3, 0, 1, 2, 3,
      ]);
      expect(loaded.project.tileset?.pixelOverrides).toEqual([
        0, 1, 2, 3, 0, 0, 1, 2,
      ]);
      expect(loaded.project.palette.palettes).toEqual([
        {
          id: 'pal_gray',
          name: 'Stone Gray',
          colors: [0x0f, 0x00, 0x10, 0x30],
        },
        {
          id: 'pal_red',
          name: 'Lava Red',
          colors: [0x0f, 0x06, 0x16, 0x26],
        },
      ]);
      expect(loaded.project.palette.activeSpritePaletteSlots).toEqual([
        'pal_gray',
        'pal_red',
        null,
        null,
      ]);
      expect(serializeProject(loaded.project)).toBe(serialized);
    }
  });

  it('performs lossless round-trip save -> load for playfield mode projects', () => {
    const dummyCollisionCells = Array.from({ length: 960 }, (_, i) => i % 11);
    const dummyPaletteAssignments = Array.from({ length: 64 }, (_, i) => i % 4);
    const dummyPixelOverrides = Array.from({ length: 128 }, (_, i) => i % 4);

    const playfieldProject: StudioProject = {
      formatVersion: 2,
      graphics: createDefaultProjectGraphicsConfiguration(),
      name: 'Stage 1 Overworld',
      mode: 'playfield',
      settings: {
        deduplicationEnabled: true,
        flipDeduplicationEnabled: true,
        quantization: {
          quantizationMode: 'median-cut',
          ditheringMode: 'none',
          colorDistanceMode: 'perceptual',
        },
      },
      palette: {
        universalBackgroundColor: 0x0f,
        palettes: [
          {
            id: 'pal_sky',
            name: 'Sky Blue',
            colors: [0x0f, 0x01, 0x11, 0x21],
          },
          {
            id: 'pal_grass',
            name: 'Grass Green',
            colors: [0x0f, 0x0a, 0x1a, 0x2a],
          },
        ],
        activeBackgroundSlots: ['pal_sky', 'pal_grass', null, null],
        activeSpriteSlots: ['pal_sky', 'pal_grass', null, null],
        activePaletteIndex: 2,
        activeColorIndex: 3,
        paletteSet: [
          [0x0f, 0x01, 0x11, 0x21],
          [0x0f, 0x0a, 0x1a, 0x2a],
          [0x0f, 0x09, 0x19, 0x29],
          [0x0f, 0x03, 0x13, 0x23],
        ],
        activeSpritePaletteSlots: ['pal_sky', 'pal_grass', null, null],
      },
      playfield: {
        asset: {
          id: 'asset-playfield-overworld',
          path: 'stages/overworld_level1.png',
          name: 'overworld_level1.png',
          sourceKind: 'png',
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADUlEQVR4nGNgGAWDCQAAB4ABAXb6Z9YAAAAASUVORK5CYII=',
        },
        collisionCells: dummyCollisionCells,
        activeCollisionType: 1,
        randomPlayfieldFeatures: ['walls', 'platforms', 'clouds'],
        paletteAssignments: dummyPaletteAssignments,
        pixelOverrides: dummyPixelOverrides,
      },
    };

    const serialized = serializeProject(playfieldProject);
    const loaded = deserializeProject(serialized);

    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.name).toBe('Stage 1 Overworld');
      expect(loaded.project.mode).toBe('playfield');
      expect(loaded.project.settings.deduplicationEnabled).toBe(true);
      expect(loaded.project.settings.flipDeduplicationEnabled).toBe(true);
      expect(loaded.project.playfield?.asset).toEqual({
        id: 'asset-playfield-overworld',
        path: 'stages/overworld_level1.png',
        name: 'overworld_level1.png',
        sourceKind: 'png',
        dataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADUlEQVR4nGNgGAWDCQAAB4ABAXb6Z9YAAAAASUVORK5CYII=',
      });
      expect(loaded.project.playfield?.collisionCells).toEqual(
        dummyCollisionCells,
      );
      expect(loaded.project.playfield?.activeCollisionType).toBe(1);
      expect(loaded.project.playfield?.randomPlayfieldFeatures).toEqual([
        'walls',
        'platforms',
        'clouds',
      ]);
      expect(loaded.project.playfield?.paletteAssignments).toEqual(
        dummyPaletteAssignments,
      );
      expect(loaded.project.playfield?.pixelOverrides).toEqual(
        dummyPixelOverrides,
      );
      expect(serializeProject(loaded.project)).toBe(serialized);
    }
  });

  it('preserves removal of a saved base CHR across save and reload', () => {
    const initial = createDefaultProject('Base CHR removal', 'animation');
    const animation = initial.animation;
    if (!animation) throw new Error('Missing animation settings');

    const selectedBaseChr: StudioProject = {
      ...initial,
      animation: {
        ...animation,
        destinationChr: {
          path: 'examples/base-chr-persistence/game.chr',
          name: 'game.chr',
          sourceKind: 'chr',
          dataUrl: 'data:application/octet-stream;base64,AA==',
        },
      },
    };

    const firstSave = deserializeProject(serializeProject(selectedBaseChr));
    expect(firstSave.success).toBe(true);
    if (!firstSave.success) return;
    expect(firstSave.project.animation?.destinationChr?.name).toBe('game.chr');

    const baseChrRemoved: StudioProject = {
      ...firstSave.project,
      animation: {
        ...(firstSave.project.animation ?? animation),
        destinationChr: null,
      },
    };

    const removalSave = serializeProject(baseChrRemoved);
    expect(
      (
        JSON.parse(removalSave) as {
          animation?: { destinationChr?: unknown };
        }
      ).animation?.destinationChr,
    ).toBeNull();

    const reloaded = deserializeProject(removalSave);
    expect(reloaded.success).toBe(true);
    if (!reloaded.success) return;
    expect(reloaded.project.animation?.destinationChr).toBeNull();

    const replacementBaseChr: StudioProject = {
      ...reloaded.project,
      animation: {
        ...(reloaded.project.animation ?? animation),
        destinationChr: {
          path: 'examples/base-chr-persistence/replacement.chr',
          name: 'replacement.chr',
          sourceKind: 'chr',
        },
      },
    };
    const replacementReloaded = deserializeProject(
      serializeProject(replacementBaseChr),
    );
    expect(replacementReloaded.success).toBe(true);
    if (replacementReloaded.success) {
      expect(replacementReloaded.project.animation?.destinationChr?.name).toBe(
        'replacement.chr',
      );
    }
  });

  describe('Path handling & relative path resolution', () => {
    it('normalizes path separators to forward slashes and strips leading redundant ./', () => {
      expect(normalizePath('assets\\sprites\\hero.png')).toBe(
        'assets/sprites/hero.png',
      );
      expect(normalizePath('.\\assets\\hero.png')).toBe('assets/hero.png');
      expect(normalizePath('./hero.png')).toBe('hero.png');
    });

    it('computes directory path from file path', () => {
      expect(getDirectoryPath('projects/rpg/project.p2c.json')).toBe(
        'projects/rpg',
      );
      expect(getDirectoryPath('project.p2c.json')).toBe('');
      expect(getDirectoryPath('C:/projects/game/project.json')).toBe(
        'C:/projects/game',
      );
    });

    it('computes relative paths correctly', () => {
      expect(
        toRelativePath('projects/rpg', 'projects/rpg/assets/player.png'),
      ).toBe('assets/player.png');
      expect(toRelativePath('projects/rpg', 'projects/shared/tiles.png')).toBe(
        '../shared/tiles.png',
      );
      expect(toRelativePath('', 'assets/player.png')).toBe('assets/player.png');
    });

    it('resolves relative paths against base directories correctly', () => {
      expect(resolveRelativePath('projects/rpg', 'assets/player.png')).toBe(
        'projects/rpg/assets/player.png',
      );
      expect(resolveRelativePath('projects/rpg', '../shared/tiles.png')).toBe(
        'projects/shared/tiles.png',
      );
      expect(resolveRelativePath('', 'assets/player.png')).toBe(
        'assets/player.png',
      );
    });

    it('allows moving an entire project folder without breaking relative references', () => {
      const originalBase = '/users/dev/games/nes-hero';
      const assetRelative = 'sprites/hero.png';
      const fullPathOriginal = resolveRelativePath(originalBase, assetRelative);
      expect(fullPathOriginal).toBe(
        '/users/dev/games/nes-hero/sprites/hero.png',
      );

      const movedBase = '/shared/backup/nes-hero';
      const fullPathMoved = resolveRelativePath(movedBase, assetRelative);
      expect(fullPathMoved).toBe('/shared/backup/nes-hero/sprites/hero.png');
    });
  });

  describe('Missing assets and error handling', () => {
    it('detects missing assets and reports expected paths without throwing', () => {
      const project: StudioProject = {
        formatVersion: 2,
        graphics: createDefaultProjectGraphicsConfiguration(),
        name: 'Missing Test',
        mode: 'animation',
        settings: {
          deduplicationEnabled: false,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'median-cut',
            ditheringMode: 'none',
            colorDistanceMode: 'perceptual',
          },
        },
        palette: {
          universalBackgroundColor: 0x0f,
          palettes: [
            {
              id: 'pal_0',
              name: 'Palette 0',
              colors: [0x0f, 0x00, 0x10, 0x30],
            },
          ],
          activeBackgroundSlots: ['pal_0', null, null, null],
          activeSpriteSlots: ['pal_0', null, null, null],
          paletteSet: createDefaultNesPaletteSet(),
        },
        animation: {
          name: 'hero',
          symbolPrefix: 'hero',
          defaultPaletteIndex: 0,
          quantizationMode: 'median-cut',
          ditheringMode: 'none',
          flipDeduplication: true,
          spritePalette: 0,
          spriteColorIndex: 1,
          patternTable: 0,
          destinationPatternTable: 0,
          destinationChr: {
            path: 'chr/missing_base.chr',
            name: 'missing_base.chr',
          },
          animations: [
            {
              id: 'a1',
              name: 'walk',
              asset: {
                path: 'sprites/missing_walk.png',
                name: 'missing_walk.png',
              },
              frameWidth: 16,
              frameHeight: 16,
              originX: 0,
              originY: 0,
              playback: 'loop',
              allowHorizontalFlip: false,
              allowVerticalFlip: false,
              defaultDuration: 10,
              frameIndices: [0],
              frameDurations: [10],
            },
            {
              id: 'a2',
              name: 'jump',
              asset: {
                path: 'sprites/existing_jump.png',
                name: 'existing_jump.png',
              },
              frameWidth: 16,
              frameHeight: 16,
              originX: 0,
              originY: 0,
              playback: 'loop',
              allowHorizontalFlip: false,
              allowVerticalFlip: false,
              defaultDuration: 10,
              frameIndices: [0],
              frameDurations: [10],
            },
          ],
        },
      };

      const existingFiles = new Set(['sprites/existing_jump.png']);
      const missing = findMissingAssets(project, (p) => existingFiles.has(p));

      expect(missing.length).toBe(2);
      expect(missing[0]?.name).toBe('missing_base.chr');
      expect(missing[0]?.expectedPath).toBe('chr/missing_base.chr');
      expect(missing[1]?.name).toBe('missing_walk.png');
      expect(missing[1]?.expectedPath).toBe('sprites/missing_walk.png');
    });

    it('rejects invalid JSON syntax with a clear error', () => {
      const result = deserializeProject('{ "invalidJson": true, ');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('invalid-json');
      }
    });

    it('rejects JSON without formatVersion with a clear error', () => {
      const result = deserializeProject(
        JSON.stringify({ name: 'Old project' }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('missing-format-version');
      }
    });

    it('rejects unsupported formatVersion with a clear error', () => {
      const result = deserializeProject(
        JSON.stringify({ formatVersion: 999, name: 'Future project' }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('unsupported-format-version');
        expect(result.error.details?.formatVersion).toBe(999);
      }
    });

    it('rejects non-object roots with invalid-project-schema', () => {
      const result = deserializeProject('[1, 2, 3]');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('invalid-project-schema');
      }
    });

    it('round-trips scenePreview instances properly', () => {
      const project: StudioProject = {
        ...createDefaultProject(),
        scenePreview: {
          instances: [
            {
              id: 'inst-1',
              animationId: 'anim-walk',
              entityId: 'Soldier',
              animationName: 'walk_down',
              x: 120,
              y: 100,
              visible: true,
              name: 'Soldier #1',
            },
            {
              id: 'inst-2',
              animationId: 'anim-fly',
              entityId: 'Bat',
              animationName: 'fly',
              x: 180,
              y: 80,
              visible: false,
              name: 'Bat #1',
            },
          ],
        },
      };

      const serialized = serializeProject(project);
      const deserialized = deserializeProject(serialized);
      expect(deserialized.success).toBe(true);
      if (deserialized.success) {
        expect(deserialized.project.scenePreview?.instances).toHaveLength(2);
        expect(deserialized.project.scenePreview?.instances[0]).toEqual({
          id: 'inst-1',
          animationId: 'anim-walk',
          entityId: 'Soldier',
          animationName: 'walk_down',
          x: 120,
          y: 100,
          visible: true,
          name: 'Soldier #1',
        });
        expect(deserialized.project.scenePreview?.instances[1]).toEqual({
          id: 'inst-2',
          animationId: 'anim-fly',
          entityId: 'Bat',
          animationName: 'fly',
          x: 180,
          y: 80,
          visible: false,
          name: 'Bat #1',
        });
      }
    });

    it('migrates one exact legacy scene animation match to its stable ID', () => {
      const legacy = createDefaultProject('animation');
      const json = JSON.stringify({
        ...legacy,
        scenePreview: {
          instances: [
            {
              id: 'legacy-exact',
              entityId: 'entity',
              animationName: 'idle',
              x: 0,
              y: 0,
              visible: true,
            },
          ],
        },
      });

      const result = deserializeProject(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.scenePreview?.instances[0]?.animationId).toBe(
          'anim-default',
        );
      }
    });

    it('refreshes legacy aliases from a canonical animation ID', () => {
      const project = createDefaultProject('animation');
      const result = deserializeProject(
        JSON.stringify({
          ...project,
          scenePreview: {
            instances: [
              {
                id: 'renamed-instance',
                animationId: 'anim-default',
                entityId: 'old-entity',
                animationName: 'old-name',
                x: 0,
                y: 0,
                visible: true,
              },
            ],
          },
        }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.scenePreview?.instances[0]).toMatchObject({
          animationId: 'anim-default',
          entityId: 'entity',
          animationName: 'idle',
        });
      }
    });

    it.each(['zero', 'multiple'])(
      'marks a legacy scene reference unresolved for %s matches',
      (matchCount) => {
        const legacy = createDefaultProject('animation');
        if (legacy.animation === undefined) {
          throw new Error('Expected animation project settings.');
        }
        const original = legacy.animation.animations[0];
        if (original === undefined) {
          throw new Error('Expected default animation.');
        }
        const animations =
          matchCount === 'zero'
            ? legacy.animation.animations.map((animation) => ({
                ...animation,
                name: 'other',
              }))
            : [
                ...legacy.animation.animations,
                { ...original, id: 'anim-duplicate' },
              ];
        const result = deserializeProject(
          JSON.stringify({
            ...legacy,
            animation: { ...legacy.animation, animations },
            scenePreview: {
              instances: [
                {
                  id: `legacy-${matchCount}`,
                  entityId: 'entity',
                  animationName: 'idle',
                  x: 0,
                  y: 0,
                  visible: true,
                },
              ],
            },
          }),
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.project.scenePreview?.instances[0]?.animationId).toBe(
            '',
          );
        }
      },
    );

    it('round-trips animation item pixelOverrides properly', () => {
      const project: StudioProject = {
        ...createDefaultProject('animation'),
        name: 'Pixel Overrides Test',
        animation: {
          name: 'Hero',
          symbolPrefix: 'hero',
          defaultPaletteIndex: 0,
          quantizationMode: 'median-cut',
          ditheringMode: 'none',
          flipDeduplication: true,
          spritePalette: 0,
          spriteColorIndex: 1,
          patternTable: 0,
          destinationPatternTable: 0,
          destinationChr: null,
          animations: [
            {
              id: 'anim_1',
              name: 'walk',
              entity: 'Hero',
              asset: null,
              frameWidth: 16,
              frameHeight: 16,
              originX: 8,
              originY: 16,
              playback: 'loop',
              allowHorizontalFlip: true,
              allowVerticalFlip: false,
              defaultDuration: 8,
              frameIndices: [0, 1],
              frameDurations: [8, 8],
              pixelOverrides: {
                '0_0': { 0: 3, 1: 2, 63: 1 },
                '1_0': { 10: 2 },
              },
            },
          ],
        },
      };

      const serialized = serializeProject(project);
      const deserialized = deserializeProject(serialized);
      expect(deserialized.success).toBe(true);
      if (deserialized.success) {
        const item = deserialized.project.animation?.animations[0];
        expect(item?.pixelOverrides).toEqual({
          '0_0': { 0: 3, 1: 2, 63: 1 },
          '1_0': { 10: 2 },
        });
      }
    });

    it('round-trips palettes and activeSpritePaletteSlots', () => {
      const defaultProj = createDefaultProject('animation');
      expect(defaultProj.animation).toBeDefined();
      if (!defaultProj.animation) {
        throw new Error('Expected defaultProj.animation to be defined');
      }
      const project: StudioProject = {
        ...defaultProj,
        name: 'Palettes Test',
        palette: {
          universalBackgroundColor: 0x0f,
          palettes: [
            {
              id: 'pal_soldier_blue',
              name: 'Soldier Blue',
              colors: [0x0f, 0x01, 0x11, 0x21],
            },
            {
              id: 'pal_bat_purple',
              name: 'Bat Purple',
              colors: [0x0f, 0x03, 0x13, 0x23],
            },
          ],
          activeBackgroundSlots: [
            'pal_soldier_blue',
            'pal_bat_purple',
            null,
            null,
          ],
          activeSpriteSlots: ['pal_soldier_blue', 'pal_bat_purple', null, null],
          activePaletteIndex: 1,
          activeColorIndex: 2,
          paletteSet: defaultProj.palette.paletteSet,
          activeSpritePaletteSlots: [
            'pal_soldier_blue',
            'pal_bat_purple',
            null,
            null,
          ],
        },
        animation: {
          ...defaultProj.animation,
          animations: [
            {
              id: 'anim_1',
              name: 'walk',
              entity: 'Soldier',
              asset: null,
              paletteId: 'pal_soldier_blue',
              frameWidth: 16,
              frameHeight: 16,
              originX: 8,
              originY: 16,
              playback: 'loop',
              allowHorizontalFlip: false,
              allowVerticalFlip: false,
              defaultDuration: 8,
              frameIndices: [0],
              frameDurations: [8],
            },
          ],
        },
      };

      const serialized = serializeProject(project);
      const deserialized = deserializeProject(serialized);
      expect(deserialized.success).toBe(true);
      if (deserialized.success) {
        expect(deserialized.project.palette.palettes).toEqual([
          {
            id: 'pal_soldier_blue',
            name: 'Soldier Blue',
            colors: [0x0f, 0x01, 0x11, 0x21],
          },
          {
            id: 'pal_bat_purple',
            name: 'Bat Purple',
            colors: [0x0f, 0x03, 0x13, 0x23],
          },
        ]);
        expect(deserialized.project.palette.activeSpritePaletteSlots).toEqual([
          'pal_soldier_blue',
          'pal_bat_purple',
          null,
          null,
        ]);
        expect(deserialized.project.animation?.animations[0]?.paletteId).toBe(
          'pal_soldier_blue',
        );
      }
    });

    it('migrates legacy project without palettes into PaletteDefinitions and active slots', () => {
      const legacyJson = JSON.stringify({
        formatVersion: 1,
        name: 'Legacy Project',
        mode: 'animation',
        settings: {
          deduplicationEnabled: false,
          flipDeduplicationEnabled: true,
          quantization: {
            quantizationMode: 'median-cut',
            ditheringMode: 'none',
            colorDistanceMode: 'perceptual',
          },
        },
        palette: {
          paletteSet: [
            [0x0f, 0x01, 0x11, 0x21],
            [0x0f, 0x05, 0x15, 0x25],
            [0x0f, 0x09, 0x19, 0x29],
            [0x0f, 0x0c, 0x1c, 0x2c],
          ],
        },
        animation: {
          name: 'Hero',
          symbolPrefix: 'hero',
          defaultPaletteIndex: 0,
          quantizationMode: 'median-cut',
          ditheringMode: 'none',
          flipDeduplication: true,
          spritePalette: 0,
          spriteColorIndex: 1,
          patternTable: 0,
          destinationPatternTable: 0,
          destinationChr: null,
          animations: [
            {
              id: 'anim_1',
              name: 'walk',
              entity: 'Hero',
              paletteIndex: 1,
              frameWidth: 16,
              frameHeight: 16,
              originX: 8,
              originY: 16,
              playback: 'loop',
              allowHorizontalFlip: false,
              allowVerticalFlip: false,
              defaultDuration: 8,
              frameIndices: [0],
              frameDurations: [8],
            },
          ],
        },
      });

      const deserialized = deserializeProject(legacyJson);
      expect(deserialized.success).toBe(true);
      if (deserialized.success) {
        const palettes = deserialized.project.palette.palettes;
        expect(palettes).toBeDefined();
        expect(palettes).toHaveLength(4);
        expect(palettes[0]?.colors).toEqual([0x0f, 0x01, 0x11, 0x21]);
        expect(palettes[1]?.colors).toEqual([0x0f, 0x05, 0x15, 0x25]);

        const slots = deserialized.project.palette.activeSpritePaletteSlots;
        expect(slots).toBeDefined();
        expect(slots).toEqual(palettes.map((p) => p.id));

        // Legacy paletteIndex 1 migrated to palettes[1].id
        const animItem = deserialized.project.animation?.animations[0];
        expect(animItem?.paletteId).toBe(palettes[1]?.id);
      }
    });

    it('initializes default project with empty chrRegions array', () => {
      const project = createDefaultProject('Clean Project', 'animation');
      expect(project.chrRegions).toEqual([]);
    });

    it('performs lossless round-trip persistence with multiple ChrRegions and reservations', () => {
      const original: StudioProject = {
        ...createDefaultProject('Region Project', 'animation'),
        chrRegions: [
          {
            id: 'reg-player',
            name: 'Hero Sprites',
            patternTable: 0,
            startTile: 0,
            endTile: 31,
            kind: 'region',
            notes: 'Main character run and jump frames',
            color: '#00E5FF',
          },
          {
            id: 'res-dyn-effects',
            name: 'Dynamic Effects Bank',
            patternTable: 1,
            startTile: 192,
            endTile: 255,
            kind: 'reservation',
            notes: 'Reserved for explosion particles',
          },
        ],
      };

      const json = serializeProject(original);
      const result = deserializeProject(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.chrRegions).toEqual([
          {
            id: 'reg-player',
            name: 'Hero Sprites',
            patternTable: 0,
            startTile: 0,
            endTile: 31,
            kind: 'region',
            notes: 'Main character run and jump frames',
            color: '#00E5FF',
          },
          {
            id: 'res-dyn-effects',
            name: 'Dynamic Effects Bank',
            patternTable: 1,
            startTile: 192,
            endTile: 255,
            kind: 'reservation',
            notes: 'Reserved for explosion particles',
          },
        ]);
      }
    });

    it('loads legacy project JSON without chrRegions without errors', () => {
      const legacyJson = JSON.stringify({
        formatVersion: 1,
        name: 'Legacy Project',
        mode: 'tileset',
        settings: {
          deduplicationEnabled: false,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'median-cut',
            ditheringMode: 'none',
            colorDistanceMode: 'rgb',
          },
        },
        palette: {
          paletteSet: createDefaultNesPaletteSet(),
          activePaletteIndex: 0,
          activeColorIndex: 1,
        },
      });

      const result = deserializeProject(legacyJson);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.chrRegions).toBeUndefined();
        // Safe default access
        expect(result.project.chrRegions ?? []).toEqual([]);
      }
    });

    it('filters out corrupted chrRegion entries during deserialization', () => {
      const jsonWithCorrupted = JSON.stringify({
        formatVersion: 1,
        name: 'Corrupted Test',
        mode: 'tileset',
        settings: {
          deduplicationEnabled: false,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'median-cut',
            ditheringMode: 'none',
            colorDistanceMode: 'rgb',
          },
        },
        palette: {
          paletteSet: createDefaultNesPaletteSet(),
        },
        chrRegions: [
          {
            id: 'valid-reg',
            name: 'Valid Region',
            patternTable: 0,
            startTile: 0,
            endTile: 15,
            kind: 'region',
          },
          {
            id: 'invalid-reg',
            name: 'Invalid Region',
            patternTable: 0,
            startTile: 50,
            endTile: 10, // Invalid: start > end
            kind: 'region',
          },
          null,
          'not an object',
        ],
      });

      const result = deserializeProject(jsonWithCorrupted);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.chrRegions).toEqual([
          {
            id: 'valid-reg',
            name: 'Valid Region',
            patternTable: 0,
            startTile: 0,
            endTile: 15,
            kind: 'region',
          },
        ]);
      }
    });

    describe('Milestone 6: Project Asset Identity & Legacy Normalization', () => {
      it('performs lossless round-trip persistence with explicit asset IDs', () => {
        const original: StudioProject = {
          ...createDefaultProject('Asset ID Test', 'animation'),
          tileset: {
            asset: {
              id: 'asset-tileset-custom-123',
              path: 'tiles.png',
              name: 'tiles.png',
            },
          },
          playfield: {
            asset: {
              id: 'asset-playfield-custom-456',
              path: 'screen.png',
              name: 'screen.png',
            },
          },
          animation: {
            name: 'entity',
            symbolPrefix: 'entity',
            defaultPaletteIndex: 0,
            quantizationMode: 'median-cut',
            ditheringMode: 'none',
            flipDeduplication: true,
            spritePalette: 0,
            spriteColorIndex: 1,
            patternTable: 0,
            destinationPatternTable: 0,
            destinationChr: {
              id: 'asset-base-chr-custom-789',
              path: 'base.chr',
              name: 'base.chr',
            },
            animations: [
              {
                id: 'anim-walk',
                name: 'Walk',
                paletteId: null,
                paletteIndex: null,
                quantizationMode: 'median-cut',
                ditheringMode: 'none',
                frameWidth: 16,
                frameHeight: 16,
                originX: 8,
                originY: 16,
                playback: 'loop',
                allowHorizontalFlip: false,
                allowVerticalFlip: false,
                defaultDuration: 12,
                frameIndices: [],
                frameDurations: [],
                asset: {
                  id: 'asset-anim-walk-sheet',
                  path: 'hero_walk.png',
                  name: 'hero_walk.png',
                },
              },
            ],
          },
        };

        const json = serializeProject(original);
        const result = deserializeProject(json);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.project.tileset?.asset?.id).toBe(
            'asset-tileset-custom-123',
          );
          expect(result.project.playfield?.asset?.id).toBe(
            'asset-playfield-custom-456',
          );
          expect(result.project.animation?.destinationChr?.id).toBe(
            'asset-base-chr-custom-789',
          );
          expect(result.project.animation?.animations[0]?.asset?.id).toBe(
            'asset-anim-walk-sheet',
          );
        }
      });

      it('normalizes legacy Tileset project without asset ID with deterministic fallback', () => {
        const legacyTilesetJson = JSON.stringify({
          formatVersion: 1,
          name: 'Legacy Tileset',
          mode: 'tileset',
          settings: {
            deduplicationEnabled: false,
            flipDeduplicationEnabled: false,
            quantization: {
              quantizationMode: 'median-cut',
              ditheringMode: 'none',
              colorDistanceMode: 'rgb',
            },
          },
          palette: {
            paletteSet: createDefaultNesPaletteSet(),
          },
          tileset: {
            asset: {
              path: 'tiles.png',
              name: 'tiles.png',
            },
          },
        });

        const result = deserializeProject(legacyTilesetJson);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.project.tileset?.asset?.id).toBe(
            'asset-tileset-default',
          );
        }
      });

      it('normalizes legacy Playfield project without asset ID with deterministic fallback', () => {
        const legacyPlayfieldJson = JSON.stringify({
          formatVersion: 1,
          name: 'Legacy Playfield',
          mode: 'playfield',
          settings: {
            deduplicationEnabled: true,
            flipDeduplicationEnabled: false,
            quantization: {
              quantizationMode: 'median-cut',
              ditheringMode: 'none',
              colorDistanceMode: 'rgb',
            },
          },
          palette: {
            paletteSet: createDefaultNesPaletteSet(),
          },
          playfield: {
            asset: {
              path: 'world1.png',
              name: 'world1.png',
            },
          },
        });

        const result = deserializeProject(legacyPlayfieldJson);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.project.playfield?.asset?.id).toBe(
            'asset-playfield-default',
          );
        }
      });

      it('normalizes legacy Animation project and Base CHR without asset IDs with deterministic fallbacks', () => {
        const legacyAnimJson = JSON.stringify({
          formatVersion: 1,
          name: 'Legacy Anim',
          mode: 'animation',
          settings: {
            deduplicationEnabled: true,
            flipDeduplicationEnabled: false,
            quantization: {
              quantizationMode: 'median-cut',
              ditheringMode: 'none',
              colorDistanceMode: 'rgb',
            },
          },
          palette: {
            paletteSet: createDefaultNesPaletteSet(),
          },
          animation: {
            name: 'hero',
            symbolPrefix: 'hero',
            defaultPaletteIndex: 0,
            quantizationMode: 'median-cut',
            ditheringMode: 'none',
            flipDeduplication: true,
            spritePalette: 0,
            spriteColorIndex: 1,
            patternTable: 0,
            destinationPatternTable: 0,
            destinationChr: {
              path: 'game.chr',
              name: 'game.chr',
            },
            animations: [
              {
                id: 'anim_idle',
                name: 'idle',
                asset: {
                  path: 'hero_idle.png',
                  name: 'hero_idle.png',
                },
                frameWidth: 16,
                frameHeight: 16,
                originX: 8,
                originY: 16,
                playback: 'loop',
                allowHorizontalFlip: false,
                allowVerticalFlip: false,
                defaultDuration: 6,
                frameIndices: [0],
                frameDurations: [6],
              },
              {
                id: 'anim_jump',
                name: 'jump',
                asset: {
                  path: 'hero_jump.png',
                  name: 'hero_jump.png',
                },
                frameWidth: 16,
                frameHeight: 16,
                originX: 8,
                originY: 16,
                playback: 'once',
                allowHorizontalFlip: false,
                allowVerticalFlip: false,
                defaultDuration: 8,
                frameIndices: [0],
                frameDurations: [8],
              },
            ],
          },
        });

        const result = deserializeProject(legacyAnimJson);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.project.animation?.destinationChr?.id).toBe(
            'asset-base-chr-default',
          );
          expect(result.project.animation?.animations[0]?.asset?.id).toBe(
            'asset-anim-anim_idle',
          );
          expect(result.project.animation?.animations[1]?.asset?.id).toBe(
            'asset-anim-anim_jump',
          );
        }
      });

      it('preserves normalized legacy IDs across repeated save and reload cycles', () => {
        const legacyJson = JSON.stringify({
          formatVersion: 1,
          name: 'Legacy Cycle Test',
          mode: 'tileset',
          settings: {
            deduplicationEnabled: false,
            flipDeduplicationEnabled: false,
            quantization: {
              quantizationMode: 'median-cut',
              ditheringMode: 'none',
              colorDistanceMode: 'rgb',
            },
          },
          palette: {
            paletteSet: createDefaultNesPaletteSet(),
          },
          tileset: {
            asset: {
              path: 'tiles.png',
            },
          },
        });

        // 1. Initial deserialization (normalizes ID)
        const firstLoad = deserializeProject(legacyJson);
        expect(firstLoad.success).toBe(true);
        if (!firstLoad.success) throw new Error('Deserialization failed');
        const normalizedId = firstLoad.project.tileset?.asset?.id;
        expect(normalizedId).toBe('asset-tileset-default');

        // 2. Serialize back to JSON
        const serialized = serializeProject(firstLoad.project);

        // 3. Second deserialization
        const secondLoad = deserializeProject(serialized);
        expect(secondLoad.success).toBe(true);
        if (!secondLoad.success) throw new Error('Deserialization failed');
        expect(secondLoad.project.tileset?.asset?.id).toBe(normalizedId);
      });

      it('preserves asset IDs even when asset display names or project names are modified', () => {
        const project = createDefaultProject('Original Project', 'tileset');
        const projectWithAsset: StudioProject = {
          ...project,
          tileset: {
            asset: {
              id: 'asset-tileset-stable-id-1',
              path: 'old_filename.png',
              name: 'Old Display Name',
            },
          },
        };

        // User renames project and asset file name
        const renamedProject: StudioProject = {
          ...projectWithAsset,
          name: 'Renamed Project 2026',
          tileset: {
            asset: {
              id: 'asset-tileset-stable-id-1',
              name: 'New Fancy Display Name',
              path: 'new_filename.png',
            },
          },
        };

        const json = serializeProject(renamedProject);
        const result = deserializeProject(json);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.project.name).toBe('Renamed Project 2026');
          expect(result.project.tileset?.asset?.name).toBe(
            'New Fancy Display Name',
          );
          // ID remains strictly stable!
          expect(result.project.tileset?.asset?.id).toBe(
            'asset-tileset-stable-id-1',
          );
        }
      });
    });
  });

  describe('Milestone 8: Background Maps Project Persistence & Lifecycle', () => {
    it('initializes default project with empty backgrounds configuration', () => {
      const project = createDefaultProject('BG Project');
      expect(project.backgrounds).toBeDefined();
      expect(project.backgrounds?.activeMapId).toBeNull();
      expect(project.backgrounds?.maps).toEqual([]);
    });

    it('performs round-trip serialization and deserialization with background maps', () => {
      const map1 = createEmptyBackgroundMap({
        id: 'bg-overworld',
        name: 'Overworld Stage 1',
        patternTable: 0,
        assetId: 'asset-bg-forest',
      });

      // Populate a few cells and palette assignments
      const cells = [...map1.cells];
      cells[0] = {
        logicalKey: 'asset-bg-forest:0:0',
        tileX: 0,
        tileY: 0,
        sourceTileIndex: 0,
      };
      cells[31] = {
        logicalKey: 'asset-bg-forest:31:0',
        tileX: 31,
        tileY: 0,
      };
      cells[959] = {
        logicalKey: 'asset-bg-forest:15:10',
        tileX: 15,
        tileY: 10,
        sourceTileIndex: 42,
      };

      const palettes = [...map1.paletteAssignments];
      palettes[0] = 1;
      palettes[15] = 2;
      palettes[239] = 3;

      const populatedMap: BackgroundMapDefinition = {
        ...map1,
        asset: {
          id: 'asset-bg-forest',
          path: 'assets/forest_bg.png',
          name: 'forest_bg.png',
          sourceKind: 'png',
        },
        cells,
        paletteAssignments: palettes,
      };

      const map2 = createEmptyBackgroundMap({
        id: 'bg-dungeon',
        name: 'Dungeon Room 1',
        patternTable: 1,
        assetId: 'asset-bg-dungeon',
      });

      const sourceProject: StudioProject = {
        ...createDefaultProject('My Adventure'),
        backgrounds: {
          activeMapId: 'bg-overworld',
          maps: [populatedMap, map2],
        },
      };

      const json = serializeProject(sourceProject);
      const result = deserializeProject(json);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const loaded = result.project;
      expect(loaded.backgrounds).toBeDefined();
      if (!loaded.backgrounds) return;

      expect(loaded.backgrounds.activeMapId).toBe('bg-overworld');
      expect(loaded.backgrounds.maps.length).toBe(2);

      const loadedMap1 = loaded.backgrounds.maps[0];
      expect(loadedMap1).toBeDefined();
      if (!loadedMap1) return;

      expect(loadedMap1.id).toBe('bg-overworld');
      expect(loadedMap1.name).toBe('Overworld Stage 1');
      expect(loadedMap1.patternTable).toBe(0);
      expect(loadedMap1.widthTiles).toBe(32);
      expect(loadedMap1.heightTiles).toBe(30);
      expect(loadedMap1.assetId).toBe('asset-bg-forest');
      expect(loadedMap1.asset?.path).toBe('assets/forest_bg.png');
      expect(loadedMap1.cells.length).toBe(960);
      expect(loadedMap1.cells[0]).toEqual({
        logicalKey: 'asset-bg-forest:0:0',
        tileX: 0,
        tileY: 0,
        sourceTileIndex: 0,
      });
      expect(loadedMap1.cells[1]).toBeNull();
      expect(loadedMap1.cells[31]).toEqual({
        logicalKey: 'asset-bg-forest:31:0',
        tileX: 31,
        tileY: 0,
      });
      expect(loadedMap1.cells[959]).toEqual({
        logicalKey: 'asset-bg-forest:15:10',
        tileX: 15,
        tileY: 10,
        sourceTileIndex: 42,
      });

      expect(loadedMap1.paletteAssignments.length).toBe(240);
      expect(loadedMap1.paletteAssignments[0]).toBe(1);
      expect(loadedMap1.paletteAssignments[15]).toBe(2);
      expect(loadedMap1.paletteAssignments[239]).toBe(3);

      const loadedMap2 = loaded.backgrounds.maps[1];
      expect(loadedMap2).toBeDefined();
      if (!loadedMap2) return;

      expect(loadedMap2.id).toBe('bg-dungeon');
      expect(loadedMap2.patternTable).toBe(1);
      expect(loadedMap2.cells.length).toBe(960);
      expect(loadedMap2.cells.every((c) => c === null)).toBe(true);
    });

    it('ensures serialization purity: no physical CHR properties exist in JSON', () => {
      const map = createEmptyBackgroundMap({
        id: 'bg-purity',
        name: 'Purity Test',
      });
      const project: StudioProject = {
        ...createDefaultProject('Purity Project'),
        backgrounds: {
          activeMapId: 'bg-purity',
          maps: [map],
        },
      };

      const json = serializeProject(project);
      expect(json).not.toContain('physicalTileIndex');
      expect(json).not.toContain('localTileIndex');
      expect(json).not.toContain('resolvedCells');
      expect(json).not.toContain('finalChr');
      expect(json).not.toContain('workingSlots');
      expect(json).not.toContain('allocationResult');
    });

    it('maintains backward compatibility when loading projects without backgrounds field', () => {
      const legacyProject = createDefaultProject(
        'Legacy v1 Project',
        'playfield',
      );
      const json = serializeProject(legacyProject);

      // Remove backgrounds key manually to simulate older file
      const raw = JSON.parse(json) as Record<string, unknown>;
      delete raw.backgrounds;
      const strippedJson = JSON.stringify(raw);

      const result = deserializeProject(strippedJson);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.name).toBe('Legacy v1 Project');
        expect(result.project.mode).toBe('playfield');
        expect(result.project.playfield).toBeDefined();
        // Missing backgrounds field parses cleanly as undefined without error
        expect(result.project.backgrounds).toBeUndefined();
      }
    });

    it('findMissingAssets detects missing background assets', () => {
      const project: StudioProject = {
        ...createDefaultProject('Asset Check'),
        backgrounds: {
          maps: [
            {
              ...createEmptyBackgroundMap({ id: 'bg-1', name: 'Map 1' }),
              asset: {
                id: 'asset-bg-1',
                path: 'missing_bg.png',
                name: 'missing_bg.png',
              },
            },
            {
              ...createEmptyBackgroundMap({ id: 'bg-2', name: 'Map 2' }),
              asset: {
                id: 'asset-bg-2',
                path: 'existing_bg.png',
                name: 'existing_bg.png',
              },
            },
          ],
        },
      };

      const missing = findMissingAssets(
        project,
        (p) => p === 'existing_bg.png',
      );
      expect(missing.length).toBe(1);
      expect(missing[0]?.expectedPath).toBe('missing_bg.png');
    });

    it('extractProjectAssets extracts background images with kind background-image', () => {
      const project: StudioProject = {
        ...createDefaultProject('Extractor Test'),
        backgrounds: {
          maps: [
            {
              ...createEmptyBackgroundMap({ id: 'bg-castle', name: 'Castle' }),
              asset: {
                id: 'asset-bg-castle',
                path: 'castle.png',
                name: 'castle.png',
              },
            },
          ],
        },
      };

      const extracted = extractProjectAssets(project);
      const bgAsset = extracted.find((a) => a.kind === 'background-image');
      expect(bgAsset).toBeDefined();
      expect(bgAsset?.id).toBe('asset-bg-castle');
      expect(bgAsset?.name).toBe('Castle');
      expect(bgAsset?.reference.path).toBe('castle.png');
    });

    it('reconcileBackgroundMaps validates maps and reports diagnostics', () => {
      const validMap = createEmptyBackgroundMap({
        id: 'bg-valid',
        name: 'Valid Map',
        patternTable: 0,
        assetId: 'asset-bg-1',
      });

      const duplicateMap = {
        ...validMap,
        name: 'Duplicate Map',
      };

      const invalidDimsMap: BackgroundMapDefinition = {
        ...validMap,
        id: 'bg-invalid-dims',
        widthTiles: 16,
        heightTiles: 15,
      };

      const invalidPatternTableMap: BackgroundMapDefinition = {
        ...validMap,
        id: 'bg-invalid-pt',
        patternTable: 2 as unknown as 0,
      };

      const invalidPalettesMap: BackgroundMapDefinition = {
        ...validMap,
        id: 'bg-invalid-palettes',
        paletteAssignments: [0, 1, 4, 2], // Only 4 items, value 4 > 3
      };

      const badCells = [...validMap.cells];
      badCells[5] = {
        logicalKey: 'corrupted-key-without-colons',
        tileX: 0,
        tileY: 0,
      };
      badCells[10] = {
        logicalKey: 'asset-bg-1:50:50',
        tileX: 50,
        tileY: 50,
      };

      const malformedCellsMap: BackgroundMapDefinition = {
        ...validMap,
        id: 'bg-malformed-cells',
        cells: badCells,
      };

      const availableAssetIds = new Set(['asset-bg-1']);
      const assetDimensions = new Map([
        ['asset-bg-1', { widthInTiles: 32, heightInTiles: 30 }],
      ]);

      const result = reconcileBackgroundMaps(
        [
          validMap,
          duplicateMap,
          invalidDimsMap,
          invalidPatternTableMap,
          invalidPalettesMap,
          malformedCellsMap,
        ],
        { availableAssetIds, assetDimensions },
      );

      expect(result.valid).toBe(false);
      const factKinds = result.facts.map((f) => f.kind);
      expect(factKinds).toContain('duplicate-map-id');
      expect(factKinds).toContain('invalid-dimensions');
      expect(factKinds).toContain('invalid-pattern-table');
      expect(factKinds).toContain('invalid-palette-assignments');
      expect(factKinds).toContain('malformed-logical-key');
      expect(factKinds).toContain('out-of-bounds-tile-coordinate');
    });

    it('reconcileBackgroundMaps warns when referenced asset is missing', () => {
      const map = createEmptyBackgroundMap({
        id: 'bg-missing-asset',
        name: 'Missing Asset Map',
        assetId: 'asset-unknown',
      });

      const result = reconcileBackgroundMaps([map], {
        availableAssetIds: new Set(['asset-available-1']),
      });

      expect(result.valid).toBe(true); // Warnings do not make valid false
      expect(result.facts.length).toBe(1);
      expect(result.facts[0]?.kind).toBe('missing-asset');
      expect(result.facts[0]?.severity).toBe('warning');
    });
  });

  describe('Dual-Bank Palette Persistence & Migration (Milestone 9 - Issue #123)', () => {
    it('creates a default project directly in the canonical dual-bank state', () => {
      const project = createDefaultProject('Dual Bank Test', 'animation');

      expect(project.palette.universalBackgroundColor).toBe(0x0f);
      expect(project.palette.palettes).toHaveLength(8); // 4 BG + 4 SP
      expect(project.palette.activeBackgroundSlots).toEqual([
        'pal_bg_0',
        'pal_bg_1',
        'pal_bg_2',
        'pal_bg_3',
      ]);
      expect(project.palette.activeSpriteSlots).toEqual([
        'pal_sp_0',
        'pal_sp_1',
        'pal_sp_2',
        'pal_sp_3',
      ]);
      expect(project.palette.activeSpritePaletteSlots).toEqual([
        'pal_sp_0',
        'pal_sp_1',
        'pal_sp_2',
        'pal_sp_3',
      ]);

      // Subpalettes in palettes match target tags
      const bgDefs = project.palette.palettes.filter(
        (p) => p.target === 'background',
      );
      const spDefs = project.palette.palettes.filter(
        (p) => p.target === 'sprite',
      );
      expect(bgDefs).toHaveLength(4);
      expect(spDefs).toHaveLength(4);

      // Default animation item references sprite slot 0
      const defaultAnim = project.animation?.animations[0];
      expect(defaultAnim?.paletteId).toBe('pal_sp_0');
      expect(defaultAnim?.paletteIndex).toBeNull();
    });

    it('migrates legacy project with only paletteSet into deterministic PaletteDefinitions and dual-bank slots', () => {
      const legacyJson = JSON.stringify({
        formatVersion: 1,
        name: 'Retro Quest',
        mode: 'animation',
        settings: {
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'median-cut',
            ditheringMode: 'none',
            colorDistanceMode: 'perceptual',
          },
        },
        palette: {
          paletteSet: [
            [0x0f, 0x01, 0x11, 0x21],
            [0x0f, 0x06, 0x16, 0x26],
            [0x0f, 0x09, 0x19, 0x29],
            [0x0f, 0x03, 0x13, 0x23],
          ],
          activePaletteIndex: 1,
          activeColorIndex: 2,
        },
        animation: {
          name: 'Hero',
          symbolPrefix: 'hero',
          defaultPaletteIndex: 1,
          quantizationMode: 'median-cut',
          ditheringMode: 'none',
          flipDeduplication: true,
          spritePalette: 1,
          spriteColorIndex: 1,
          patternTable: 0,
          destinationPatternTable: 0,
          destinationChr: null,
          animations: [
            {
              id: 'walk',
              name: 'walk',
              entity: 'hero',
              paletteIndex: 2,
              frameWidth: 16,
              frameHeight: 16,
              originX: 8,
              originY: 16,
              playback: 'loop',
              allowHorizontalFlip: false,
              allowVerticalFlip: false,
              defaultDuration: 8,
              frameIndices: [0, 1],
              frameDurations: [8, 8],
              framePalettes: [1, 3],
            },
          ],
        },
      });

      const res = deserializeProject(legacyJson);
      expect(res.success).toBe(true);
      if (!res.success) return;

      const p = res.project;
      expect(p.palette.universalBackgroundColor).toBe(0x0f);
      expect(p.palette.palettes).toHaveLength(4);
      expect(p.palette.palettes[0]?.id).toBe('pal_0');
      expect(p.palette.palettes[1]?.id).toBe('pal_1');
      expect(p.palette.palettes[2]?.id).toBe('pal_2');
      expect(p.palette.palettes[3]?.id).toBe('pal_3');

      expect(p.palette.palettes[1]?.colors).toEqual([0x0f, 0x06, 0x16, 0x26]);

      // Both background and sprite slots initialized deterministically to the migrated palettes
      expect(p.palette.activeBackgroundSlots).toEqual([
        'pal_0',
        'pal_1',
        'pal_2',
        'pal_3',
      ]);
      expect(p.palette.activeSpriteSlots).toEqual([
        'pal_0',
        'pal_1',
        'pal_2',
        'pal_3',
      ]);

      // Animation paletteIndex 2 migrated to paletteId 'pal_2'
      const anim = p.animation?.animations[0];
      expect(anim?.paletteId).toBe('pal_2');
      expect(anim?.paletteIndex).toBe(2);

      // Frame overrides migrated
      expect(anim?.framePaletteIds).toEqual(['pal_1', 'pal_3']);
      expect(anim?.framePalettes).toEqual([1, 3]);
    });

    it('ensures deterministic migration IDs: opening the same legacy JSON multiple times produces identical IDs', () => {
      const legacyJson = JSON.stringify({
        formatVersion: 1,
        name: 'Deterministic Test',
        mode: 'tileset',
        settings: {
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'k-means',
            ditheringMode: 'none',
            colorDistanceMode: 'rgb',
          },
        },
        palette: {
          paletteSet: [
            [0x0f, 0x01, 0x11, 0x21],
            [0x0f, 0x02, 0x12, 0x22],
            [0x0f, 0x03, 0x13, 0x23],
            [0x0f, 0x04, 0x14, 0x24],
          ],
        },
      });

      const res1 = deserializeProject(legacyJson);
      const res2 = deserializeProject(legacyJson);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      if (!res1.success || !res2.success) return;

      expect(res1.project.palette.palettes).toEqual(
        res2.project.palette.palettes,
      );
      expect(res1.project.palette.activeBackgroundSlots).toEqual(
        res2.project.palette.activeBackgroundSlots,
      );
      expect(res1.project.palette.activeSpriteSlots).toEqual(
        res2.project.palette.activeSpriteSlots,
      );
      expect(res1.project).toEqual(res2.project);
    });

    it('ensures multiple round-trip serialization/deserialization cycles are strictly idempotent', () => {
      const original = createDefaultProject('Idempotency Test', 'animation');
      const json1 = serializeProject(original);

      const res1 = deserializeProject(json1);
      expect(res1.success).toBe(true);
      if (!res1.success) return;
      const json2 = serializeProject(res1.project);

      const res2 = deserializeProject(json2);
      expect(res2.success).toBe(true);
      if (!res2.success) return;
      const json3 = serializeProject(res2.project);

      const res3 = deserializeProject(json3);
      expect(res3.success).toBe(true);
      if (!res3.success) return;
      const json4 = serializeProject(res3.project);

      expect(json2).toBe(json1);
      expect(json3).toBe(json2);
      expect(json4).toBe(json3);
      expect(res2.project).toEqual(res1.project);
      expect(res3.project).toEqual(res2.project);
    });

    it('handles paletteId vs paletteIndex precedence and conflict handling', () => {
      const palettesJson = JSON.stringify({
        formatVersion: 1,
        name: 'Precedence Test',
        mode: 'animation',
        settings: {
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'median-cut',
            ditheringMode: 'none',
            colorDistanceMode: 'perceptual',
          },
        },
        palette: {
          universalBackgroundColor: 0x0f,
          palettes: [
            {
              id: 'pal_hero_blue',
              name: 'Hero Blue',
              colors: [0x0f, 0x01, 0x11, 0x21],
            },
            {
              id: 'pal_hero_red',
              name: 'Hero Red',
              colors: [0x0f, 0x06, 0x16, 0x26],
            },
            {
              id: 'pal_hero_gold',
              name: 'Hero Gold',
              colors: [0x0f, 0x27, 0x17, 0x37],
            },
          ],
          activeBackgroundSlots: [null, null, null, null],
          activeSpriteSlots: ['pal_hero_blue', 'pal_hero_red', null, null],
        },
        animation: {
          name: 'Hero',
          symbolPrefix: 'hero',
          defaultPaletteIndex: 0,
          quantizationMode: 'median-cut',
          ditheringMode: 'none',
          flipDeduplication: true,
          spritePalette: 0,
          spriteColorIndex: 1,
          patternTable: 0,
          destinationPatternTable: 0,
          destinationChr: null,
          animations: [
            // Case A: paletteId only
            {
              id: 'anim_a',
              name: 'a',
              paletteId: 'pal_hero_gold',
              frameWidth: 16,
              frameHeight: 16,
              originX: 8,
              originY: 16,
              playback: 'loop',
              allowHorizontalFlip: false,
              allowVerticalFlip: false,
              defaultDuration: 8,
              frameIndices: [0],
              frameDurations: [8],
            },
            // Case B: paletteIndex only (1 -> pal_hero_red in sprite slot 1)
            {
              id: 'anim_b',
              name: 'b',
              paletteIndex: 1,
              frameWidth: 16,
              frameHeight: 16,
              originX: 8,
              originY: 16,
              playback: 'loop',
              allowHorizontalFlip: false,
              allowVerticalFlip: false,
              defaultDuration: 8,
              frameIndices: [0],
              frameDurations: [8],
            },
            // Case C: both paletteId and paletteIndex conflicting (paletteId wins)
            {
              id: 'anim_c',
              name: 'c',
              paletteId: 'pal_hero_gold',
              paletteIndex: 0, // Slot 0 is pal_hero_blue, but pal_hero_gold must win
              frameWidth: 16,
              frameHeight: 16,
              originX: 8,
              originY: 16,
              playback: 'loop',
              allowHorizontalFlip: false,
              allowVerticalFlip: false,
              defaultDuration: 8,
              frameIndices: [0],
              frameDurations: [8],
            },
            // Case D: invalid paletteIndex (-1 / 99) falls back safely
            {
              id: 'anim_d',
              name: 'd',
              paletteIndex: 99,
              frameWidth: 16,
              frameHeight: 16,
              originX: 8,
              originY: 16,
              playback: 'loop',
              allowHorizontalFlip: false,
              allowVerticalFlip: false,
              defaultDuration: 8,
              frameIndices: [0],
              frameDurations: [8],
            },
          ],
        },
      });

      const res = deserializeProject(palettesJson);
      expect(res.success).toBe(true);
      if (!res.success) return;

      const anims = res.project.animation?.animations ?? [];
      expect(anims[0]?.paletteId).toBe('pal_hero_gold');
      expect(anims[1]?.paletteId).toBe('pal_hero_red');
      expect(anims[2]?.paletteId).toBe('pal_hero_gold');
      expect(anims[3]?.paletteId).toBe('pal_hero_blue'); // slot 0 fallback
    });

    it('migrates universalBackgroundColor consistently from legacy paletteSet[0][0]', () => {
      const json = JSON.stringify({
        formatVersion: 1,
        name: 'Universal Color Test',
        mode: 'tileset',
        settings: {
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'nearest',
            ditheringMode: 'none',
            colorDistanceMode: 'rgb',
          },
        },
        palette: {
          paletteSet: [
            [0x21, 0x01, 0x11, 0x31], // Blue universal background $21
            [0x21, 0x02, 0x12, 0x32],
            [0x21, 0x03, 0x13, 0x33],
            [0x21, 0x04, 0x14, 0x34],
          ],
        },
      });

      const res = deserializeProject(json);
      expect(res.success).toBe(true);
      if (!res.success) return;

      expect(res.project.palette.universalBackgroundColor).toBe(0x21);
      // Resolved background palette set mirrors 0x21 across entry 0 of all 4 subpalettes
      const bgSet = resolveProjectBackgroundPaletteSet(res.project);
      expect(bgSet[0][0]).toBe(0x21);
      expect(bgSet[1][0]).toBe(0x21);
      expect(bgSet[2][0]).toBe(0x21);
      expect(bgSet[3][0]).toBe(0x21);
    });

    it('handles legacy projects with divergent subpalette color 0 values deterministically', () => {
      const jsonDivergent = JSON.stringify({
        formatVersion: 1,
        name: 'Divergent Color 0 Test',
        mode: 'tileset',
        settings: {
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'nearest',
            ditheringMode: 'none',
            colorDistanceMode: 'rgb',
          },
        },
        palette: {
          paletteSet: [
            [0x01, 0x11, 0x21, 0x31], // Slot 0 has color 0x01
            [0x02, 0x12, 0x22, 0x32], // Divergent 0x02
            [0x03, 0x13, 0x23, 0x33], // Divergent 0x03
            [0x04, 0x14, 0x24, 0x34], // Divergent 0x04
          ],
        },
      });

      const res = deserializeProject(jsonDivergent);
      expect(res.success).toBe(true);
      if (!res.success) return;

      // Slot 0 color [0][0] ($01) is chosen deterministically as universalBackgroundColor
      expect(res.project.palette.universalBackgroundColor).toBe(0x01);

      // Background palette set mirrors $01 into index 0 of all 4 subpalettes, while preserving 1..3
      const bgSet = resolveProjectBackgroundPaletteSet(res.project);
      expect(bgSet[0]).toEqual([0x01, 0x11, 0x21, 0x31]);
      expect(bgSet[1]).toEqual([0x01, 0x12, 0x22, 0x32]);
      expect(bgSet[2]).toEqual([0x01, 0x13, 0x23, 0x33]);
      expect(bgSet[3]).toEqual([0x01, 0x14, 0x24, 0x34]);
    });

    it('handles partial schemas: missing active slots auto-populated from palette library', () => {
      const partialJson = JSON.stringify({
        formatVersion: 1,
        name: 'Partial Schema Test',
        mode: 'tileset',
        settings: {
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'nearest',
            ditheringMode: 'none',
            colorDistanceMode: 'rgb',
          },
        },
        palette: {
          palettes: [
            {
              id: 'pal_custom_a',
              name: 'A',
              colors: [0x0f, 0x00, 0x10, 0x20],
            },
            {
              id: 'pal_custom_b',
              name: 'B',
              colors: [0x0f, 0x01, 0x11, 0x21],
            },
          ],
          // activeBackgroundSlots and activeSpriteSlots are omitted
        },
      });

      const res = deserializeProject(partialJson);
      expect(res.success).toBe(true);
      if (!res.success) return;

      expect(res.project.palette.universalBackgroundColor).toBe(0x0f);
      expect(res.project.palette.activeBackgroundSlots).toEqual([
        'pal_custom_a',
        'pal_custom_b',
        null,
        null,
      ]);
      expect(res.project.palette.activeSpriteSlots).toEqual([
        'pal_custom_a',
        'pal_custom_b',
        null,
        null,
      ]);
    });

    it('handles slot arrays with non-standard lengths by normalizing to 4-slot tuples', () => {
      const json = JSON.stringify({
        formatVersion: 1,
        name: 'Non Standard Slots Test',
        mode: 'tileset',
        settings: {
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'nearest',
            ditheringMode: 'none',
            colorDistanceMode: 'rgb',
          },
        },
        palette: {
          palettes: [
            { id: 'pal_1', name: '1', colors: [0x0f, 0x01, 0x11, 0x21] },
            { id: 'pal_2', name: '2', colors: [0x0f, 0x02, 0x12, 0x22] },
          ],
          activeBackgroundSlots: ['pal_1'], // length 1
          activeSpriteSlots: [
            'pal_1',
            'pal_2',
            'pal_extra_1',
            'pal_extra_2',
            'pal_overflow',
          ], // length 5
        },
      });

      const res = deserializeProject(json);
      expect(res.success).toBe(true);
      if (!res.success) return;

      expect(res.project.palette.activeBackgroundSlots).toEqual([
        'pal_1',
        null,
        null,
        null,
      ]);
      expect(res.project.palette.activeSpriteSlots).toEqual([
        'pal_1',
        'pal_2',
        'pal_extra_1',
        'pal_extra_2',
      ]);
    });

    it('handles palettes with invalid color numbers by masking to 6-bit NES range ($00..$3F)', () => {
      const json = JSON.stringify({
        formatVersion: 1,
        name: 'Masking Test',
        mode: 'tileset',
        settings: {
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'nearest',
            ditheringMode: 'none',
            colorDistanceMode: 'rgb',
          },
        },
        palette: {
          palettes: [
            {
              id: 'pal_masked',
              name: 'Masked',
              colors: [0x4f, 0x101, -1, 0x3f], // Out of 6-bit range
            },
          ],
        },
      });

      const res = deserializeProject(json);
      expect(res.success).toBe(true);
      if (!res.success) return;

      const p0 = res.project.palette.palettes[0];
      expect(p0?.colors[0]).toBe(0x4f & 0x3f); // 0x0f
      expect(p0?.colors[1]).toBe(0x101 & 0x3f); // 0x01
      expect(p0?.colors[3]).toBe(0x3f);
    });

    it('handles dangling palette IDs in slots and animations gracefully without crashing resolvers', () => {
      const json = JSON.stringify({
        formatVersion: 1,
        name: 'Dangling IDs Test',
        mode: 'animation',
        settings: {
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          quantization: {
            quantizationMode: 'nearest',
            ditheringMode: 'none',
            colorDistanceMode: 'rgb',
          },
        },
        palette: {
          palettes: [
            {
              id: 'pal_valid',
              name: 'Valid',
              colors: [0x0f, 0x01, 0x11, 0x21],
            },
          ],
          activeBackgroundSlots: ['pal_valid', 'pal_deleted_bg', null, null],
          activeSpriteSlots: ['pal_valid', 'pal_deleted_sp', null, null],
        },
        animation: {
          name: 'Hero',
          symbolPrefix: 'hero',
          defaultPaletteIndex: 0,
          quantizationMode: 'median-cut',
          ditheringMode: 'none',
          flipDeduplication: true,
          spritePalette: 0,
          spriteColorIndex: 1,
          patternTable: 0,
          destinationPatternTable: 0,
          destinationChr: null,
          animations: [
            {
              id: 'ghost',
              name: 'ghost',
              paletteId: 'pal_deleted_anim',
              frameWidth: 16,
              frameHeight: 16,
              originX: 8,
              originY: 16,
              playback: 'loop',
              allowHorizontalFlip: false,
              allowVerticalFlip: false,
              defaultDuration: 8,
              frameIndices: [0],
              frameDurations: [8],
            },
          ],
        },
      });

      const res = deserializeProject(json);
      expect(res.success).toBe(true);
      if (!res.success) return;

      // Active slots retain the IDs even if dangling
      expect(res.project.palette.activeBackgroundSlots[1]).toBe(
        'pal_deleted_bg',
      );
      expect(res.project.palette.activeSpriteSlots[1]).toBe('pal_deleted_sp');

      // Resolvers do not crash on dangling IDs and fall back to default palette colors
      const bgSet = resolveProjectBackgroundPaletteSet(res.project);
      expect(bgSet[0]).toEqual([0x0f, 0x01, 0x11, 0x21]); // pal_valid
      expect(bgSet[1]).toBeDefined(); // Slot 1 fallback

      const spSet = resolveProjectSpritePaletteSet(res.project);
      expect(spSet[0]).toEqual([0x0f, 0x01, 0x11, 0x21]); // pal_valid
      expect(spSet[1]).toBeDefined(); // Slot 1 fallback

      const effectiveAnimColors = resolveEffectivePaletteColors(
        res.project.animation?.animations[0]?.paletteId,
        res.project.palette.palettes,
        0,
        res.project.palette.paletteSet,
      );
      expect(effectiveAnimColors).toHaveLength(4);
    });

    it('verifies legacy project-level adapters: resolveProjectBackgroundPaletteSet, resolveProjectSpritePaletteSet, resolveProjectPaletteState', () => {
      const project = createDefaultProject('Adapters Test', 'animation');

      const bgSet = resolveProjectBackgroundPaletteSet(project);
      const spSet = resolveProjectSpritePaletteSet(project);
      const state = resolveProjectPaletteState(project);

      expect(bgSet).toHaveLength(4);
      expect(spSet).toHaveLength(4);
      expect(state.universalBackgroundColor).toBe(0x0f);
      expect(state.palettes).toHaveLength(8);
      expect(state.activeBackgroundSlots).toEqual([
        'pal_bg_0',
        'pal_bg_1',
        'pal_bg_2',
        'pal_bg_3',
      ]);
      expect(state.activeSpriteSlots).toEqual([
        'pal_sp_0',
        'pal_sp_1',
        'pal_sp_2',
        'pal_sp_3',
      ]);
    });
  });
});
