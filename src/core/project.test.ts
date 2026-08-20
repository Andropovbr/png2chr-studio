import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_FORMAT_VERSION,
  createDefaultProject,
  deserializeProject,
  findMissingAssets,
  getDirectoryPath,
  normalizePath,
  resolveRelativePath,
  serializeProject,
  toRelativePath,
  type StudioProject,
} from './project';
import { createDefaultNesPaletteSet } from './nes-palette';

describe('StudioProject core infrastructure', () => {
  it('creates a clean default project with formatVersion 1', () => {
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
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.name).toBe('Platformer Test');
    expect(parsed.mode).toBe('playfield');
  });

  it('deserializes a valid project JSON correctly', () => {
    const source: StudioProject = {
      formatVersion: 1,
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

  it('performs lossless round-trip save -> load', () => {
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
              path: 'sprites/hero_walk.png',
              name: 'hero_walk.png',
              sourceKind: 'png',
            },
            paletteId: original.palette.palettes?.[1]?.id ?? 'pal_1',
            paletteIndex: 1,
            framePaletteIds: [
              original.palette.palettes?.[1]?.id ?? 'pal_1',
              original.palette.palettes?.[1]?.id ?? 'pal_1',
              original.palette.palettes?.[2]?.id ?? 'pal_2',
              original.palette.palettes?.[1]?.id ?? 'pal_1',
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
      expect(loaded.project).toEqual(enriched);
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
        formatVersion: 1,
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
              entityId: 'Soldier',
              animationName: 'walk_down',
              x: 120,
              y: 100,
              visible: true,
              name: 'Soldier #1',
            },
            {
              id: 'inst-2',
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
          entityId: 'Soldier',
          animationName: 'walk_down',
          x: 120,
          y: 100,
          visible: true,
          name: 'Soldier #1',
        });
        expect(deserialized.project.scenePreview?.instances[1]).toEqual({
          id: 'inst-2',
          entityId: 'Bat',
          animationName: 'fly',
          x: 180,
          y: 80,
          visible: false,
          name: 'Bat #1',
        });
      }
    });

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
      if (!defaultProj.animation) {
        throw new Error(
          'Default animation project must have animation settings',
        );
      }
      const project: StudioProject = {
        ...defaultProj,
        name: 'Palettes Test',
        palette: {
          paletteSet: defaultProj.palette.paletteSet,
          activePaletteIndex: 1,
          activeColorIndex: 2,
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
        if (palettes) {
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
      }
    });
  });
});
