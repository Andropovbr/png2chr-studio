import { describe, it, expect } from 'vitest';
import {
  applyChrTileEdit,
  resolveTileEditOrigin,
} from './chr-project-integration';
import {
  createEmptyTilePixels,
  decodeChrTileToPixels,
  encodeChrTileFromPixels,
  copyTileToClipboard,
  pasteTileFromClipboard,
} from './chr-tile-editor';
import { buildAnimationProjectModel } from './animation-model';
import { createDefaultNesPaletteSet } from './nes-palette';
import {
  serializeProject,
  deserializeProject,
  createDefaultProject,
} from './project';
import type { AnimationItemSetting } from '../ui/types';
import type { IndexedImage } from './types';

function createDummyIndexedImage(
  width: number,
  height: number,
  fillVal = 0,
): IndexedImage {
  return {
    width,
    height,
    pixels: new Uint8Array(width * height).fill(fillVal),
    colors: [
      { red: 0, green: 0, blue: 0 },
      { red: 100, green: 100, blue: 100 },
      { red: 180, green: 180, blue: 180 },
      { red: 255, green: 255, blue: 255 },
    ],
    transparentIndex: 0,
    colorCount: 4,
  };
}

describe('chr-project-integration', () => {
  describe('resolveTileEditOrigin', () => {
    it('returns unmapped for out-of-bounds physical indices (-1, 512)', () => {
      const resNeg = resolveTileEditOrigin({ physicalIndex: -1 });
      expect(resNeg.type).toBe('unmapped');

      const resOver = resolveTileEditOrigin({ physicalIndex: 512 });
      expect(resOver.type).toBe('unmapped');
    });

    it('resolves empty slot target for unreferenced slots without Base CHR', () => {
      const target0 = resolveTileEditOrigin({ physicalIndex: 0 });
      expect(target0.type).toBe('empty');
      if (target0.type === 'empty') {
        expect(target0.physicalIndex).toBe(0);
        expect(target0.patternTable).toBe(0);
      }

      const target256 = resolveTileEditOrigin({ physicalIndex: 256 });
      expect(target256.type).toBe('empty');
      if (target256.type === 'empty') {
        expect(target256.physicalIndex).toBe(256);
        expect(target256.patternTable).toBe(1);
      }
    });

    it('resolves Base CHR target when slot is occupied by Base CHR', () => {
      const baseChr = new Uint8Array(4096);
      // Mark slot 5 in Base CHR as occupied (non-zero bytes)
      baseChr[5 * 16] = 0x55;

      const target5 = resolveTileEditOrigin({
        physicalIndex: 5,
        baseChr,
        destinationPatternTable: 0,
      });
      expect(target5.type).toBe('base');
      if (target5.type === 'base') {
        expect(target5.physicalIndex).toBe(5);
        expect(target5.byteOffsetInBaseChr).toBe(5 * 16);
      }

      // Base CHR in PT1 (destinationPatternTable = 1)
      const target261 = resolveTileEditOrigin({
        physicalIndex: 256 + 5,
        baseChr,
        destinationPatternTable: 1,
      });
      expect(target261.type).toBe('base');
      if (target261.type === 'base') {
        expect(target261.physicalIndex).toBe(261);
        expect(target261.byteOffsetInBaseChr).toBe(5 * 16);
      }
    });

    it('resolves Animation target when physical tile belongs to an animation sprite', () => {
      const image = createDummyIndexedImage(32, 16, 0);
      // Put a solid sprite at frame 0
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          image.pixels[y * 32 + x] = 2;
        }
      }

      const animModel = buildAnimationProjectModel({
        name: 'hero',
        image,
        frameWidth: 16,
        frameHeight: 16,
        animations: [
          {
            id: 'anim-idle',
            name: 'idle',
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
      });

      const animations: AnimationItemSetting[] = [
        {
          id: 'anim-idle',
          name: 'idle',
          frameWidth: 16,
          frameHeight: 16,
          frameIndices: [0],
          frameDurations: [6],
          defaultDuration: 6,
          playback: 'loop',
          originX: 0,
          originY: 0,
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          source: {
            fileName: 'hero.png',
            sourceImage: {} as ImageData,
            indexedImage: image,
          },
        },
      ];

      // Physical tile 0 in PT0
      const target = resolveTileEditOrigin({
        physicalIndex: 0,
        mode: 'animation',
        animationModel: animModel,
        animations,
      });

      expect(target.type).toBe('animation');
      if (target.type === 'animation') {
        expect(target.animationId).toBe('anim-idle');
        expect(target.tileX).toBe(0);
        expect(target.tileY).toBe(0);
      }
    });
  });

  describe('applyChrTileEdit', () => {
    it('applies edits to Animation pixelOverrides without mutating original', () => {
      const animations: AnimationItemSetting[] = [
        {
          id: 'anim-1',
          name: 'walk',
          frameWidth: 16,
          frameHeight: 16,
          frameIndices: [0],
          frameDurations: [6],
          defaultDuration: 6,
          playback: 'loop',
          originX: 0,
          originY: 0,
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          source: null,
        },
      ];

      const newPixels = createEmptyTilePixels(3);
      const target = {
        type: 'animation' as const,
        animationId: 'anim-1',
        animationName: 'walk',
        frameIndex: 0,
        tileX: 1,
        tileY: 2,
      };

      const result = applyChrTileEdit({
        physicalIndex: 0,
        newPixels,
        target,
        animations,
      });

      expect(result.success).toBe(true);
      expect(result.updatedAnimations).toBeDefined();
      const updatedAnim = result.updatedAnimations?.[0];
      expect(updatedAnim?.pixelOverrides?.['1_2']).toBeDefined();
      expect(updatedAnim?.pixelOverrides?.['1_2']?.[0]).toBe(3);
      expect(updatedAnim?.pixelOverrides?.['1_2']?.[63]).toBe(3);

      // Original unchanged
      expect(animations[0]?.pixelOverrides).toBeUndefined();
    });

    it('applies edits to Tileset / Playfield pixelOverrides and re-extracts tiles', () => {
      const image = createDummyIndexedImage(16, 16, 0);
      const paletteSet = createDefaultNesPaletteSet();
      const paletteAssignments = new Uint8Array(4).fill(0);
      const newPixels = createEmptyTilePixels(2);

      const target = {
        type: 'tileset' as const,
        tileIndex: 0,
        tileX: 0,
        tileY: 0,
        column: 0,
        row: 0,
      };

      const result = applyChrTileEdit({
        physicalIndex: 0,
        newPixels,
        target,
        indexedImage: image,
        paletteSet,
        paletteAssignments,
        paletteRegionSize: 8,
      });

      expect(result.success).toBe(true);
      expect(result.updatedPixelOverrides).toBeDefined();
      expect(result.updatedPixelOverrides?.[0]).toBe(2);
      expect(result.updatedPixelOverrides?.[7]).toBe(2);
      expect(result.updatedTiles).toBeDefined();
      expect(result.updatedTiles?.length).toBe(4);
      expect(result.updatedTiles?.[0]?.pixels[0]).toBe(2);
    });

    it('applies edits to Base CHR modifying only the 16 bytes of the specified tile', () => {
      const baseChr = new Uint8Array(4096);
      baseChr[0] = 0xaa;
      baseChr[100] = 0xbb;

      const newPixels = createEmptyTilePixels(1);
      const target = {
        type: 'base' as const,
        physicalIndex: 10,
        byteOffsetInBaseChr: 10 * 16,
        destinationPatternTable: 0 as const,
      };

      const result = applyChrTileEdit({
        physicalIndex: 10,
        newPixels,
        target,
        baseChr,
        baseChrName: 'level.chr',
      });

      expect(result.success).toBe(true);
      expect(result.updatedDestinationChr).toBeDefined();
      const updated = result.updatedDestinationChr;
      expect(updated?.length).toBe(4096);
      // Byte 0 and Byte 100 unchanged
      expect(updated?.[0]).toBe(0xaa);
      expect(updated?.[100]).toBe(0xbb);

      // Tile 10 encoded
      const tile10 = updated?.subarray(160, 176);
      const expected16 = encodeChrTileFromPixels(newPixels);
      expect(tile10).toEqual(expected16);
    });

    it('materializes empty slot when no Base CHR exists into 8 KiB buffer', () => {
      const newPixels = createEmptyTilePixels(3);
      const target = {
        type: 'empty' as const,
        physicalIndex: 42,
        patternTable: 0 as const,
      };

      const result = applyChrTileEdit({
        physicalIndex: 42,
        newPixels,
        target,
        baseChr: null,
      });

      expect(result.success).toBe(true);
      expect(result.updatedDestinationChr?.length).toBe(8192);
      expect(result.updatedDestinationPatternTable).toBe(0);
      const slotBytes = result.updatedDestinationChr?.subarray(
        42 * 16,
        43 * 16,
      );
      expect(slotBytes).toEqual(encodeChrTileFromPixels(newPixels));
    });

    it('expands 4 KiB Base CHR to 8 KiB when materializing a slot in the opposite Pattern Table', () => {
      const baseChr = new Uint8Array(4096);
      baseChr[0] = 0x12; // byte in PT0

      const newPixels = createEmptyTilePixels(2);
      // Physical index 300 is in PT1 (256..511)
      const target = {
        type: 'empty' as const,
        physicalIndex: 300,
        patternTable: 1 as const,
      };

      const result = applyChrTileEdit({
        physicalIndex: 300,
        newPixels,
        target,
        baseChr,
        destinationPatternTable: 0,
      });

      expect(result.success).toBe(true);
      expect(result.updatedDestinationChr?.length).toBe(8192);
      expect(result.updatedDestinationPatternTable).toBe(0);
      // PT0 byte preserved
      expect(result.updatedDestinationChr?.[0]).toBe(0x12);
      // PT1 slot populated
      const slotBytes = result.updatedDestinationChr?.subarray(
        300 * 16,
        301 * 16,
      );
      expect(slotBytes).toEqual(encodeChrTileFromPixels(newPixels));
    });
  });

  describe('round-trip persistence and workflows', () => {
    it('persists animation pixelOverrides round-trip in .p2c.json schema', () => {
      const project = createDefaultProject('Hero Project', 'animation');
      const editedPixels = createEmptyTilePixels(3);
      editedPixels[0] = 1;

      const firstAnim = project.animation?.animations[0];
      const animSetting: AnimationItemSetting = {
        id: firstAnim?.id ?? 'anim-1',
        name: firstAnim?.name ?? 'idle',
        frameWidth: 16,
        frameHeight: 16,
        frameIndices: [0],
        frameDurations: [6],
        defaultDuration: 6,
        playback: 'loop',
        originX: 0,
        originY: 0,
        allowHorizontalFlip: false,
        allowVerticalFlip: false,
        source: null,
      };

      const target = {
        type: 'animation' as const,
        animationId: animSetting.id,
        animationName: animSetting.name,
        frameIndex: 0,
        tileX: 0,
        tileY: 0,
      };

      const result = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: editedPixels,
        target,
        animations: [animSetting],
      });

      expect(result.success).toBe(true);
      const updatedOverrides = result.updatedAnimations?.[0]?.pixelOverrides;

      if (!project.animation) throw new Error('Missing animation config');
      const updatedProject = {
        ...project,
        animation: {
          ...project.animation,
          animations: project.animation.animations.map((a, i) =>
            i === 0 ? { ...a, pixelOverrides: updatedOverrides } : a,
          ),
        },
      };

      // Serialize to .p2c.json text
      const jsonText = serializeProject(updatedProject);
      expect(jsonText).toContain('"pixelOverrides"');

      // Deserialize back
      const deserialized = deserializeProject(jsonText);
      expect(deserialized.success).toBe(true);
      if (deserialized.success) {
        const loadedAnim = deserialized.project.animation?.animations[0];
        expect(loadedAnim?.pixelOverrides?.['0_0']?.[0]).toBe(1);
        expect(loadedAnim?.pixelOverrides?.['0_0']?.[1]).toBe(3);
      }
    });

    it('persists tileset pixelOverrides round-trip in .p2c.json schema', () => {
      const project = createDefaultProject('Tileset Project', 'tileset');
      const img = createDummyIndexedImage(16, 16, 0);
      const editedPixels = createEmptyTilePixels(2);

      const target = {
        type: 'tileset' as const,
        tileIndex: 0,
        tileX: 0,
        tileY: 0,
        column: 0,
        row: 0,
      };

      const result = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: editedPixels,
        target,
        indexedImage: img,
      });

      expect(result.success).toBe(true);
      if (!project.tileset) throw new Error('Missing tileset config');
      const updatedProject = {
        ...project,
        tileset: {
          ...project.tileset,
          pixelOverrides: Array.from(result.updatedPixelOverrides ?? []),
        },
      };

      const jsonText = serializeProject(updatedProject);
      const deserialized = deserializeProject(jsonText);
      expect(deserialized.success).toBe(true);
      if (deserialized.success) {
        expect(deserialized.project.tileset?.pixelOverrides?.[0]).toBe(2);
        expect(deserialized.project.tileset?.pixelOverrides?.[7]).toBe(2);
      }
    });

    it('supports cross-tile copy from PT0 and paste into PT1 Base CHR tile', () => {
      // Tile A in PT0
      const tileA = createEmptyTilePixels(1);
      tileA[0] = 3;
      tileA[63] = 2;

      // Copy Tile A
      const copied = copyTileToClipboard(tileA);
      expect(copied[0]).toBe(3);

      // Select Tile B in PT1 (Base CHR at index 260)
      const baseChr = new Uint8Array(4096);
      const pasted = pasteTileFromClipboard();
      expect(pasted).not.toBeNull();
      if (!pasted) return;

      const targetB = {
        type: 'base' as const,
        physicalIndex: 260,
        byteOffsetInBaseChr: (260 - 256) * 16,
        destinationPatternTable: 1 as const,
      };

      const resultB = applyChrTileEdit({
        physicalIndex: 260,
        newPixels: pasted,
        target: targetB,
        baseChr,
        destinationPatternTable: 1,
      });

      expect(resultB.success).toBe(true);
      const tileBBytes = resultB.updatedDestinationChr?.subarray(
        4 * 16,
        5 * 16,
      );
      expect(tileBBytes).toBeDefined();
      if (tileBBytes) {
        const decodedB = decodeChrTileToPixels(tileBBytes);
        expect(decodedB[0]).toBe(3);
        expect(decodedB[63]).toBe(2);
      }

      // Tile A in source remains independent
      expect(tileA[0]).toBe(3);
    });
  });
});
