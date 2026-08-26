import { describe, it, expect } from 'vitest';
import {
  createLogicalTileKey,
  parseLogicalTileKey,
  isValidLogicalTileKey,
  areLogicalTileKeysEqual,
  formatLogicalTileCoordinate,
  computeAnimationLogicalTileCoordinate,
  generateProjectAssetId,
  getLegacyDeterministicAssetId,
  normalizeProjectAssetId,
  createProjectAssetReference,
  extractProjectAssets,
  type ProjectAssetId,
} from './asset-identity';
import { createDefaultProject, type StudioProject } from './project';

describe('asset-identity domain model', () => {
  describe('createLogicalTileKey', () => {
    it('creates canonical key in ${assetId}:${tileX}:${tileY} format', () => {
      const key = createLogicalTileKey('asset-hero-123', 4, 7);
      expect(key).toBe('asset-hero-123:4:7');
    });

    it('handles (0, 0) coordinates correctly', () => {
      const key = createLogicalTileKey('asset-tileset-default', 0, 0);
      expect(key).toBe('asset-tileset-default:0:0');
    });

    it('throws when assetId is empty or whitespace only', () => {
      expect(() => createLogicalTileKey('', 0, 0)).toThrow(/non-empty string/);
      expect(() => createLogicalTileKey('   ', 1, 2)).toThrow(
        /non-empty string/,
      );
    });

    it('throws when assetId contains colon delimiter', () => {
      expect(() => createLogicalTileKey('asset:invalid', 0, 0)).toThrow(
        /must not contain the ":" delimiter/,
      );
    });

    it('throws when coordinates are negative or non-integers', () => {
      expect(() => createLogicalTileKey('asset-hero', -1, 0)).toThrow(
        /non-negative integer/,
      );
      expect(() => createLogicalTileKey('asset-hero', 0, -5)).toThrow(
        /non-negative integer/,
      );
      expect(() => createLogicalTileKey('asset-hero', 1.5, 0)).toThrow(
        /non-negative integer/,
      );
      expect(() => createLogicalTileKey('asset-hero', 0, NaN)).toThrow(
        /non-negative integer/,
      );
    });
  });

  describe('parseLogicalTileKey', () => {
    it('successfully parses valid keys', () => {
      const parsed = parseLogicalTileKey('asset-hero-123:4:7');
      expect(parsed).toEqual({
        assetId: 'asset-hero-123',
        tileX: 4,
        tileY: 7,
      });
    });

    it('returns null on invalid formats or non-numeric coordinates', () => {
      expect(parseLogicalTileKey('')).toBeNull();
      expect(parseLogicalTileKey('invalid-key')).toBeNull();
      expect(parseLogicalTileKey('asset-hero:1')).toBeNull();
      expect(parseLogicalTileKey('asset-hero:1:2:3')).toBeNull();
      expect(parseLogicalTileKey(':1:2')).toBeNull();
      expect(parseLogicalTileKey('asset-hero:abc:2')).toBeNull();
      expect(parseLogicalTileKey('asset-hero:1:-2')).toBeNull();
      expect(parseLogicalTileKey('asset-hero:1.5:2')).toBeNull();
    });
  });

  describe('isValidLogicalTileKey and areLogicalTileKeysEqual', () => {
    it('validates keys correctly', () => {
      expect(isValidLogicalTileKey('asset-1:0:0')).toBe(true);
      expect(isValidLogicalTileKey('asset-tileset:15:30')).toBe(true);
      expect(isValidLogicalTileKey('invalid')).toBe(false);
    });

    it('compares keys for equality', () => {
      const key1 = createLogicalTileKey('asset-a', 2, 3);
      const key2 = createLogicalTileKey('asset-a', 2, 3);
      const key3 = createLogicalTileKey('asset-b', 2, 3);

      expect(areLogicalTileKeysEqual(key1, key2)).toBe(true);
      expect(areLogicalTileKeysEqual(key1, key3)).toBe(false);
    });
  });

  describe('formatLogicalTileCoordinate', () => {
    it('formats coordinates as Col X, Row Y', () => {
      expect(formatLogicalTileCoordinate(3, 5)).toBe('Col 3, Row 5');
      expect(formatLogicalTileCoordinate(0, 0)).toBe('Col 0, Row 0');
    });
  });

  describe('computeAnimationLogicalTileCoordinate', () => {
    it('computes sprite sheet tile coordinates for frame cells accurately', () => {
      // 128px wide spritesheet, 16x16 frames -> 8 frames per row.
      // Frame 0 (top-left): (tileX: 0, tileY: 0) to (1, 1).
      const coordF0C0 = computeAnimationLogicalTileCoordinate({
        frameIndex: 0,
        frameWidth: 16,
        frameHeight: 16,
        imageWidth: 128,
        cellColumn: 0,
        cellRow: 0,
      });
      expect(coordF0C0).toEqual({ tileX: 0, tileY: 0 });

      const coordF0C1 = computeAnimationLogicalTileCoordinate({
        frameIndex: 0,
        frameWidth: 16,
        frameHeight: 16,
        imageWidth: 128,
        cellColumn: 1,
        cellRow: 1,
      });
      expect(coordF0C1).toEqual({ tileX: 1, tileY: 1 });

      // Frame 1 (second frame in row 0): frameTileX = 2 (16px / 8)
      const coordF1C0 = computeAnimationLogicalTileCoordinate({
        frameIndex: 1,
        frameWidth: 16,
        frameHeight: 16,
        imageWidth: 128,
        cellColumn: 0,
        cellRow: 0,
      });
      expect(coordF1C0).toEqual({ tileX: 2, tileY: 0 });

      // Frame 8 (first frame in row 1): frameTileX = 0, frameTileY = 2 (16px / 8)
      const coordF8C0 = computeAnimationLogicalTileCoordinate({
        frameIndex: 8,
        frameWidth: 16,
        frameHeight: 16,
        imageWidth: 128,
        cellColumn: 0,
        cellRow: 0,
      });
      expect(coordF8C0).toEqual({ tileX: 0, tileY: 2 });
    });
  });

  describe('generateProjectAssetId', () => {
    it('generates unique string IDs with correct kind prefix', () => {
      const idAnim = generateProjectAssetId('spritesheet');
      const idTileset = generateProjectAssetId('tileset-image');
      const idPlayfield = generateProjectAssetId('playfield-image');
      const idBase = generateProjectAssetId('base-chr');

      expect(idAnim).toMatch(/^asset-anim-/);
      expect(idTileset).toMatch(/^asset-tileset-/);
      expect(idPlayfield).toMatch(/^asset-playfield-/);
      expect(idBase).toMatch(/^asset-base-chr-/);

      expect(generateProjectAssetId('spritesheet')).not.toBe(
        generateProjectAssetId('spritesheet'),
      );
    });
  });

  describe('getLegacyDeterministicAssetId & normalizeProjectAssetId', () => {
    it('returns exact deterministic legacy fallback IDs', () => {
      expect(getLegacyDeterministicAssetId('tileset-image')).toBe(
        'asset-tileset-default',
      );
      expect(getLegacyDeterministicAssetId('playfield-image')).toBe(
        'asset-playfield-default',
      );
      expect(getLegacyDeterministicAssetId('base-chr')).toBe(
        'asset-base-chr-default',
      );
      expect(getLegacyDeterministicAssetId('spritesheet', 'anim-idle')).toBe(
        'asset-anim-anim-idle',
      );
      expect(getLegacyDeterministicAssetId('spritesheet', 0)).toBe(
        'asset-anim-0',
      );
      expect(getLegacyDeterministicAssetId('spritesheet')).toBe(
        'asset-anim-default',
      );
    });

    it('normalizes missing or invalid rawId to deterministic fallback', () => {
      expect(normalizeProjectAssetId(undefined, 'tileset-image')).toBe(
        'asset-tileset-default',
      );
      expect(normalizeProjectAssetId('', 'playfield-image')).toBe(
        'asset-playfield-default',
      );
      expect(normalizeProjectAssetId('   ', 'base-chr')).toBe(
        'asset-base-chr-default',
      );
      expect(normalizeProjectAssetId(null, 'spritesheet', 'walk')).toBe(
        'asset-anim-walk',
      );
    });

    it('preserves valid explicit IDs', () => {
      expect(
        normalizeProjectAssetId('my-custom-hero-id', 'spritesheet', 'walk'),
      ).toBe('my-custom-hero-id');
    });
  });

  describe('createProjectAssetReference', () => {
    it('creates asset reference with guaranteed ID', () => {
      const ref1 = createProjectAssetReference({
        path: 'sprites/hero.png',
        name: 'hero.png',
        kind: 'spritesheet',
      });
      expect(ref1.id).toBeDefined();
      expect(ref1.id).toMatch(/^asset-anim-/);
      expect(ref1.path).toBe('sprites/hero.png');

      const ref2 = createProjectAssetReference({
        id: 'explicit-id-999',
        path: 'tiles/tileset.png',
        kind: 'tileset-image',
      });
      expect(ref2.id).toBe('explicit-id-999');
    });
  });

  describe('extractProjectAssets', () => {
    it('extracts all active assets from StudioProject', () => {
      const project = createDefaultProject('Test', 'animation');
      const animSettings = project.animation;
      if (!animSettings) throw new Error('Missing animation settings');
      const firstAnim = animSettings.animations[0];
      if (!firstAnim) throw new Error('Missing first animation');

      const projectWithAssets: StudioProject = {
        ...project,
        tileset: {
          asset: {
            id: 'asset-tileset-1',
            path: 'tiles.png',
            name: 'tiles.png',
          },
        },
        playfield: {
          asset: {
            id: 'asset-playfield-1',
            path: 'screen.png',
            name: 'screen.png',
          },
        },
        animation: {
          ...animSettings,
          destinationChr: {
            id: 'asset-base-chr-1',
            path: 'base.chr',
            name: 'base.chr',
          },
          animations: [
            {
              ...firstAnim,
              id: 'anim-hero',
              name: 'Hero Idle',
              asset: {
                id: 'asset-hero-sheet',
                path: 'hero.png',
                name: 'hero.png',
              },
            },
          ],
        },
      };

      const extracted = extractProjectAssets(projectWithAssets);
      expect(extracted.length).toBe(4);

      const kinds = extracted.map((a) => a.kind);
      expect(kinds).toContain('tileset-image');
      expect(kinds).toContain('playfield-image');
      expect(kinds).toContain('base-chr');
      expect(kinds).toContain('spritesheet');

      const ids = extracted.map((a) => a.id);
      expect(ids).toEqual([
        'asset-tileset-1',
        'asset-playfield-1',
        'asset-base-chr-1',
        'asset-hero-sheet',
      ]);
    });

    it('extracts active assets from ProjectView with anim.source and backgrounds', () => {
      const mockProjectView = {
        mode: 'animation' as const,
        assetId: null,
        fileName: null,
        backgrounds: {
          maps: [
            {
              id: 'bg-map-1',
              name: 'Level 1',
              assetId: 'asset-bg-forest',
            },
          ],
        },
        animation: {
          destinationChrAssetId: 'asset-base-chr-custom',
          destinationChrName: 'custom_base.chr',
          destinationChr: new Uint8Array(8192),
          animations: [
            {
              id: 'anim-warrior',
              name: 'Warrior Run',
              source: {
                assetId: 'asset-warrior-sheet',
                fileName: 'warrior.png',
              },
            },
            {
              id: 'mage',
              name: 'Mage Cast',
              source: null, // No loaded source image, uses deterministic ID from anim.id
            },
          ],
        },
      };

      const extracted = extractProjectAssets(mockProjectView);
      expect(extracted).toHaveLength(4);

      const ids = extracted.map((a) => a.id);
      expect(ids).toContain('asset-bg-forest');
      expect(ids).toContain('asset-base-chr-custom');
      expect(ids).toContain('asset-warrior-sheet');
      expect(ids).toContain('asset-anim-mage');
    });

    it('extracts tileset and playfield from ProjectView when in respective modes', () => {
      const tilesetView = {
        mode: 'tileset' as const,
        assetId: 'asset-custom-tileset',
        fileName: 'dungeon_tiles.png',
      };
      const extractedTileset = extractProjectAssets(tilesetView);
      expect(extractedTileset).toHaveLength(1);
      expect(extractedTileset[0]?.id).toBe('asset-custom-tileset');
      expect(extractedTileset[0]?.kind).toBe('tileset-image');

      const playfieldView = {
        mode: 'playfield' as const,
        assetId: null,
        fileName: 'overworld.png',
      };
      const extractedPlayfield = extractProjectAssets(playfieldView);
      expect(extractedPlayfield).toHaveLength(1);
      expect(extractedPlayfield[0]?.id).toBe('asset-playfield-default');
      expect(extractedPlayfield[0]?.kind).toBe('playfield-image');
    });
  });

  describe('Logical Tile Independence vs Physical CHR Allocation', () => {
    it('proves two distinct assets with identical coordinates produce distinct logical keys', () => {
      const assetA: ProjectAssetId = 'asset-hero';
      const assetB: ProjectAssetId = 'asset-enemy';

      const keyA = createLogicalTileKey(assetA, 0, 0);
      const keyB = createLogicalTileKey(assetB, 0, 0);

      // Both are at coordinate (0, 0) in their respective images
      expect(keyA).toBe('asset-hero:0:0');
      expect(keyB).toBe('asset-enemy:0:0');
      expect(keyA).not.toBe(keyB);
      expect(areLogicalTileKeysEqual(keyA, keyB)).toBe(false);
    });

    it('proves identical coordinates in the same asset produce the exact same logical key', () => {
      const assetId: ProjectAssetId = 'asset-hero';

      // Sprite in frame 0 and sprite in frame 1 pointing to source tile (2, 3)
      const keyFrame0 = createLogicalTileKey(assetId, 2, 3);
      const keyFrame1 = createLogicalTileKey(assetId, 2, 3);

      expect(keyFrame0).toBe('asset-hero:2:3');
      expect(areLogicalTileKeysEqual(keyFrame0, keyFrame1)).toBe(true);
    });
  });
});
