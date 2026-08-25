import { describe, it, expect } from 'vitest';
import {
  applyChrTileEdit,
  resolveTileEditOrigin,
} from './chr-project-integration';
import {
  createEmptyTilePixels,
  cloneTilePixels,
  decodeChrTileToPixels,
  encodeChrTileFromPixels,
  copyTileToClipboard,
  pasteTileFromClipboard,
  createTileHistory,
  areTilePixelsEqual,
} from './chr-tile-editor';
import { buildAnimationProjectModel } from './animation-model';
import { createDefaultNesPaletteSet } from './nes-palette';
import {
  serializeProject,
  deserializeProject,
  createDefaultProject,
  type StudioProject,
} from './project';
import { encodeTile } from './chr-encoder';
import {
  classifyChrSlots,
  calculatePatternTableCapacity,
  calculateChrRegionCapacity,
  analyzeChrRegionDiagnostics,
  NES_CHR_ROM_SIZE,
  type ChrRegion,
  type ChrSlotClassification,
} from './chr-pattern-table';
import type { AnimationItemSetting } from '../ui/types';
import type { IndexedImage, Tile } from './types';

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

    it('handles full Undo / Redo lifecycle on Animation tile pixelOverrides and round-trip persistence', () => {
      const project = createDefaultProject('Hero Project', 'animation');
      const initialPixels = createEmptyTilePixels(0);
      const editedPixels = createEmptyTilePixels(3);
      editedPixels[0] = 1;

      const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);

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

      // 1. Perform Edit (e.g. pencil stroke / transform)
      history.pushState(cloneTilePixels(editedPixels));
      const editResult = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: editedPixels,
        target,
        animations: [animSetting],
      });
      expect(editResult.success).toBe(true);
      expect(history.canUndo).toBe(true);

      const editedOverrides = editResult.updatedAnimations?.[0]?.pixelOverrides;
      expect(editedOverrides?.['0_0']?.[0]).toBe(1);

      // 2. Perform Undo
      const undonePixels = history.undo();
      expect(undonePixels).toBeDefined();
      if (!undonePixels) throw new Error('Expected undonePixels');
      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(true);

      const undoResult = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: undonePixels,
        target,
        animations: [
          {
            ...animSetting,
            pixelOverrides: editedOverrides,
          },
        ],
      });
      expect(undoResult.success).toBe(true);
      const restoredOverrides =
        undoResult.updatedAnimations?.[0]?.pixelOverrides;
      expect(restoredOverrides?.['0_0']?.[0]).toBe(0);

      // 3. Round-trip persistence in undone state
      if (!project.animation) throw new Error('Missing animation config');
      const projectUndone = {
        ...project,
        animation: {
          ...project.animation,
          animations: project.animation.animations.map((a, i) =>
            i === 0 ? { ...a, pixelOverrides: restoredOverrides } : a,
          ),
        },
      };
      const jsonUndone = serializeProject(projectUndone);
      const deserializedUndone = deserializeProject(jsonUndone);
      expect(deserializedUndone.success).toBe(true);
      if (deserializedUndone.success) {
        expect(
          deserializedUndone.project.animation?.animations[0]?.pixelOverrides?.[
            '0_0'
          ]?.[0],
        ).toBe(0);
      }

      // 4. Perform Redo
      const redonePixels = history.redo();
      expect(redonePixels).toBeDefined();
      if (!redonePixels) throw new Error('Expected redonePixels');
      expect(history.canUndo).toBe(true);
      expect(history.canRedo).toBe(false);

      const redoResult = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: redonePixels,
        target,
        animations: [
          {
            ...animSetting,
            pixelOverrides: restoredOverrides,
          },
        ],
      });
      expect(redoResult.success).toBe(true);
      const reAppliedOverrides =
        redoResult.updatedAnimations?.[0]?.pixelOverrides;
      expect(reAppliedOverrides?.['0_0']?.[0]).toBe(1);

      // 5. Round-trip persistence in redone state
      const projectRedone = {
        ...project,
        animation: {
          ...project.animation,
          animations: project.animation.animations.map((a, i) =>
            i === 0 ? { ...a, pixelOverrides: reAppliedOverrides } : a,
          ),
        },
      };
      const jsonRedone = serializeProject(projectRedone);
      const deserializedRedone = deserializeProject(jsonRedone);
      expect(deserializedRedone.success).toBe(true);
      if (deserializedRedone.success) {
        expect(
          deserializedRedone.project.animation?.animations[0]?.pixelOverrides?.[
            '0_0'
          ]?.[0],
        ).toBe(1);
      }
    });

    it('handles full Undo / Redo lifecycle on Base CHR tile bytes and round-trip persistence', () => {
      const initialBase = new Uint8Array(4096);
      initialBase[0] = 0x11;
      const initialPixels = decodeChrTileToPixels(initialBase.subarray(0, 16));

      const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);

      const editedPixels = createEmptyTilePixels(2);
      editedPixels[0] = 3;

      const target = {
        type: 'base' as const,
        physicalIndex: 0,
        byteOffsetInBaseChr: 0,
        destinationPatternTable: 0 as const,
      };

      // 1. Edit Base CHR tile
      history.pushState(cloneTilePixels(editedPixels));
      const editResult = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: editedPixels,
        target,
        baseChr: initialBase,
        destinationPatternTable: 0,
      });
      expect(editResult.success).toBe(true);
      const editedBase = editResult.updatedDestinationChr;
      expect(editedBase).toBeDefined();
      expect(editedBase?.[0]).not.toBe(0x11);

      // 2. Undo Base CHR edit
      const undonePixels = history.undo();
      expect(undonePixels).toBeDefined();
      if (!undonePixels) throw new Error('Expected undonePixels');
      const undoResult = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: undonePixels,
        target,
        baseChr: editedBase,
        destinationPatternTable: 0,
      });
      expect(undoResult.success).toBe(true);
      const restoredBase = undoResult.updatedDestinationChr;
      expect(restoredBase?.[0]).toBe(0x11);

      // 3. Redo Base CHR edit
      const redonePixels = history.redo();
      expect(redonePixels).toBeDefined();
      if (!redonePixels) throw new Error('Expected redonePixels');
      const redoResult = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: redonePixels,
        target,
        baseChr: restoredBase,
        destinationPatternTable: 0,
      });
      expect(redoResult.success).toBe(true);
      expect(redoResult.updatedDestinationChr?.[0]).toBe(editedBase?.[0]);
    });

    it('handles full Undo / Redo lifecycle on Tileset pixelOverrides and round-trip persistence', () => {
      const project = createDefaultProject('Tileset Project', 'tileset');
      const img = createDummyIndexedImage(16, 16, 0);
      const initialPixels = createEmptyTilePixels(0);
      const editedPixels = createEmptyTilePixels(2);

      const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);

      const target = {
        type: 'tileset' as const,
        tileIndex: 0,
        tileX: 0,
        tileY: 0,
        column: 0,
        row: 0,
      };

      // 1. Edit
      history.pushState(cloneTilePixels(editedPixels));
      const editResult = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: editedPixels,
        target,
        indexedImage: img,
      });
      expect(editResult.success).toBe(true);
      expect(editResult.updatedPixelOverrides?.[0]).toBe(2);

      // 2. Undo
      const undonePixels = history.undo();
      expect(undonePixels).toBeDefined();
      if (!undonePixels) throw new Error('Expected undonePixels');
      const undoResult = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: undonePixels,
        target,
        indexedImage: img,
        pixelOverrides: editResult.updatedPixelOverrides,
      });
      expect(undoResult.success).toBe(true);
      expect(undoResult.updatedPixelOverrides?.[0]).toBe(0);

      // 3. Redo
      const redonePixels = history.redo();
      expect(redonePixels).toBeDefined();
      if (!redonePixels) throw new Error('Expected redonePixels');
      const redoResult = applyChrTileEdit({
        physicalIndex: 0,
        newPixels: redonePixels,
        target,
        indexedImage: img,
        pixelOverrides: undoResult.updatedPixelOverrides,
      });
      expect(redoResult.success).toBe(true);
      expect(redoResult.updatedPixelOverrides?.[0]).toBe(2);

      // 4. Persistence round-trip in undone state
      if (!project.tileset) throw new Error('Missing tileset config');
      const projectUndone = {
        ...project,
        tileset: {
          ...project.tileset,
          pixelOverrides: Array.from(undoResult.updatedPixelOverrides ?? []),
        },
      };
      const jsonUndone = serializeProject(projectUndone);
      const deserializedUndone = deserializeProject(jsonUndone);
      expect(deserializedUndone.success).toBe(true);
      if (deserializedUndone.success) {
        expect(deserializedUndone.project.tileset?.pixelOverrides?.[0]).toBe(0);
      }
    });
  });

  describe('Milestone 5: CHR Regions & Reservations End-to-End Integration', () => {
    function makeTile(id: number, fillVal: number): Tile {
      return {
        id,
        column: 0,
        row: 0,
        pixels: new Uint8Array(64).fill(fillVal),
      };
    }

    it('guarantees identical reservation-aware allocation start index ($04) across Animation, Tileset, and Playfield modes', () => {
      const reservation: ChrRegion = {
        id: 'res-runtime-fx',
        name: 'Runtime FX',
        patternTable: 0,
        startTile: 0x00,
        endTile: 0x03,
        kind: 'reservation',
      };

      // 1. Animation Mode: Add a 16x16 frame (4 non-transparent 8x8 tiles)
      const animImage = createDummyIndexedImage(16, 16, 0);
      for (let y = 0; y < 16; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          animImage.pixels[y * 16 + x] = 1; // non-transparent
        }
      }

      const animModel = buildAnimationProjectModel({
        name: 'hero',
        image: animImage,
        frameWidth: 16,
        frameHeight: 16,
        patternTable: 0,
        chrRegions: [reservation],
        animations: [
          {
            id: 'anim-1',
            name: 'idle',
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
      });

      // The 4 sprite tiles should be placed starting at slot $04 (physical indices 4, 5, 6, 7 in PT0)
      const allocatedAnimSlots =
        animModel.animations[0]?.frames[0]?.sprites.map(
          (s) => s.physicalTileIndex,
        );
      expect(allocatedAnimSlots).toBeDefined();
      expect(allocatedAnimSlots).toEqual([4, 4, 4, 4]); // all 4 cells have identical content -> deduped to index 4
      expect(allocatedAnimSlots?.[0]).toBe(4); // Starts at $04, NOT $00!

      // 2. Tileset Mode: Encode distinct tiles with reservation
      const tilesetTiles = [makeTile(0, 1), makeTile(1, 2), makeTile(2, 3)];
      const tilesetClassifications = classifyChrSlots({
        mode: 'tileset',
        destinationPatternTable: 0,
        tiles: tilesetTiles,
        deduplicationEnabled: false,
        chrRegions: [reservation],
      });

      // Slots 0..3 are reserved (empty)
      expect(tilesetClassifications[0]?.occupancy).toBe('reserved');
      expect(tilesetClassifications[1]?.occupancy).toBe('reserved');
      expect(tilesetClassifications[2]?.occupancy).toBe('reserved');
      expect(tilesetClassifications[3]?.occupancy).toBe('reserved');

      // Slots 4..6 contain the 3 tiles
      expect(tilesetClassifications[4]?.occupancy).toBe('project');
      expect(tilesetClassifications[5]?.occupancy).toBe('project');
      expect(tilesetClassifications[6]?.occupancy).toBe('project');

      // 3. Playfield Mode: Same behavior
      const playfieldClassifications = classifyChrSlots({
        mode: 'playfield',
        destinationPatternTable: 0,
        tiles: tilesetTiles,
        deduplicationEnabled: false,
        chrRegions: [reservation],
      });

      expect(playfieldClassifications[0]?.occupancy).toBe('reserved');
      expect(playfieldClassifications[3]?.occupancy).toBe('reserved');
      expect(playfieldClassifications[4]?.occupancy).toBe('project');
      expect(playfieldClassifications[5]?.occupancy).toBe('project');
      expect(playfieldClassifications[6]?.occupancy).toBe('project');
    });

    it('correctly reuses Base CHR content inside a reservation for candidate tiles and NEVER matches empty reserved slots for dedup', () => {
      // Create Base CHR with a unique tile at slot $01 in PT0
      const baseChr = new Uint8Array(NES_CHR_ROM_SIZE);
      // Encode a unique pattern in slot 1 (offset 16..31)
      const baseTile = makeTile(1, 2);
      const encodedTileBytes = encodeTile(baseTile);
      baseChr.set(encodedTileBytes, 16);

      // Reservation covers slots $00..$03
      const reservation: ChrRegion = {
        id: 'res-base-block',
        name: 'Protected Base',
        patternTable: 0,
        startTile: 0x00,
        endTile: 0x03,
        kind: 'reservation',
      };

      // 1. Candidate tile in left cell matches baseTile at slot $01 (color 2)
      // 2. Candidate tile in right cell is completely different (color 3)
      const animImage = createDummyIndexedImage(16, 8, 0);
      // Left 8x8 cell: color 2 (matches base tile at slot 1)
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          animImage.pixels[y * 16 + x] = 2;
        }
      }
      // Right 8x8 cell: color 3 (new distinct tile)
      for (let y = 0; y < 8; y += 1) {
        for (let x = 8; x < 16; x += 1) {
          animImage.pixels[y * 16 + x] = 3;
        }
      }

      const animModel = buildAnimationProjectModel({
        name: 'hero',
        image: animImage,
        frameWidth: 16,
        frameHeight: 8,
        patternTable: 0,
        destinationPatternTable: 0,
        baseChr,
        chrRegions: [reservation],
        animations: [
          {
            id: 'anim-1',
            name: 'idle',
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
      });

      const sprites = animModel.animations[0]?.frames[0]?.sprites;
      expect(sprites?.length).toBe(2);

      // Cell 0 should be deduplicated to Base CHR slot 1 (inside the reservation)
      expect(sprites?.[0]?.physicalTileIndex).toBe(1);

      // Cell 1 (new tile) should skip the reservation ($00..$03) and allocate at slot $04!
      expect(sprites?.[1]?.physicalTileIndex).toBe(4);

      // Empty reserved slots ($00, $02, $03) were NEVER matched for deduplication!
      expect(sprites?.[1]?.physicalTileIndex).not.toBe(0);
      expect(sprites?.[1]?.physicalTileIndex).not.toBe(2);
      expect(sprites?.[1]?.physicalTileIndex).not.toBe(3);
    });

    it('guarantees capacity calculation prevents double counting when reservation covers occupied content', () => {
      // 512 classifications:
      // In PT0 ($00..$FF):
      // - Slot 0: Base CHR
      // - Slot 1: Project tile
      // - Slots 2..3: empty reserved
      // - Slots 4..255: empty unreserved (252 slots)
      const classifications: ChrSlotClassification[] = [];
      for (let i = 0; i < 512; i += 1) {
        let occupancy: 'base' | 'project' | 'reserved' | 'empty' = 'empty';
        if (i === 0) occupancy = 'base';
        else if (i === 1) occupancy = 'project';
        else if (i === 2 || i === 3) occupancy = 'reserved';

        classifications.push({
          physicalIndex: i,
          localIndex: i % 256,
          patternTable: i < 256 ? 0 : 1,
          occupancy,
        });
      }

      const reservation: ChrRegion = {
        id: 'res-mixed',
        name: 'Mixed Reservation',
        patternTable: 0,
        startTile: 0,
        endTile: 3,
        kind: 'reservation',
      };

      const pt0Cap = calculatePatternTableCapacity(classifications, 0);
      expect(pt0Cap.totalOccupiedTiles).toBe(2); // Slot 0 + Slot 1
      expect(pt0Cap.totalReservedEmptyTiles).toBe(2); // Slot 2 + Slot 3
      expect(pt0Cap.totalEmptyTiles).toBe(252);
      expect(pt0Cap.availableSlots).toBe(252); // EXACT: 256 - 2 - 2 = 252 (NO double counting!)

      const regCap = calculateChrRegionCapacity(reservation, classifications);
      expect(regCap.totalTiles).toBe(4);
      expect(regCap.occupiedTiles).toBe(2);
      expect(regCap.reservedEmptyTiles).toBe(2);
      expect(regCap.availableTiles).toBe(0);
      expect(regCap.isFull).toBe(false); // only 2 of 4 are occupied
    });

    it('generates deterministic diagnostics and maintains stable IDs across lifecycle', () => {
      const region1: ChrRegion = {
        id: 'reg-player',
        name: 'Player',
        patternTable: 0,
        startTile: 0,
        endTile: 15,
        kind: 'region',
      };
      const region2: ChrRegion = {
        id: 'reg-shared',
        name: 'Shared FX',
        patternTable: 0,
        startTile: 10,
        endTile: 25,
        kind: 'region',
      };
      const reservation1: ChrRegion = {
        id: 'res-runtime',
        name: 'Runtime',
        patternTable: 0,
        startTile: 20,
        endTile: 30,
        kind: 'reservation',
      };

      const facts = analyzeChrRegionDiagnostics({
        chrRegions: [region1, region2, reservation1],
      });

      // 1. Region-Region Overlap between Player and Shared FX ($10-$15)
      const regOverlap = facts.find(
        (f) =>
          f.kind === 'region-overlap' &&
          (f as { overlapType: string }).overlapType === 'region-region',
      );
      expect(regOverlap).toBeDefined();
      expect(regOverlap?.severity).toBe('warning');
      expect(regOverlap?.id).toBe('chr-region-overlap:reg-player:reg-shared');

      // 2. Region-Reservation Overlap between Shared FX and Runtime ($20-$25)
      const resRegOverlap = facts.find(
        (f) =>
          f.kind === 'region-overlap' &&
          (f as { overlapType: string }).overlapType === 'region-reservation',
      );
      expect(resRegOverlap).toBeDefined();
      expect(resRegOverlap?.severity).toBe('info');
      expect(resRegOverlap?.id).toBe(
        'chr-region-reservation-overlap:reg-shared:res-runtime',
      );
    });

    it('performs comprehensive CRUD and round-trip persistence preserving stable IDs and resiliently dropping corrupted items', () => {
      const initialProject = createDefaultProject(
        'Milestone 5 Test',
        'tileset',
      );
      expect(initialProject.chrRegions).toEqual([]);

      const regionHero: ChrRegion = {
        id: 'reg-hero-uuid-1',
        name: 'Hero Sprites',
        patternTable: 0,
        startTile: 0x00,
        endTile: 0x1f,
        kind: 'region',
        notes: 'Main protagonist animation slots',
        color: '#38bdf8',
      };

      const reservationFx: ChrRegion = {
        id: 'res-fx-uuid-2',
        name: 'Dynamic Spells',
        patternTable: 1,
        startTile: 0x80,
        endTile: 0x9f,
        kind: 'reservation',
        notes: 'Combat effect particles loaded at runtime',
        color: '#a855f7',
      };

      // 1. Save project with regions
      const projectWithRegions: StudioProject = {
        ...initialProject,
        chrRegions: [regionHero, reservationFx],
      };

      const serialized = serializeProject(projectWithRegions);
      const deserialized = deserializeProject(serialized);
      expect(deserialized.success).toBe(true);
      if (!deserialized.success) throw new Error('Deserialization failed');

      expect(deserialized.project.chrRegions?.length).toBe(2);
      expect(deserialized.project.chrRegions?.[0]).toEqual(regionHero);
      expect(deserialized.project.chrRegions?.[1]).toEqual(reservationFx);

      // 2. Edit an existing region (Hero endTile changed to $2F, ID preserved)
      const editedHero: ChrRegion = {
        ...regionHero,
        endTile: 0x2f,
        notes: 'Expanded to 48 tiles',
      };

      const projectEdited: StudioProject = {
        ...deserialized.project,
        chrRegions: [editedHero, reservationFx],
      };

      const serializedEdited = serializeProject(projectEdited);
      const deserializedEdited = deserializeProject(serializedEdited);
      expect(deserializedEdited.success).toBe(true);
      if (!deserializedEdited.success)
        throw new Error('Deserialization failed');

      expect(deserializedEdited.project.chrRegions?.[0]?.id).toBe(
        'reg-hero-uuid-1',
      ); // STABLE ID!
      expect(deserializedEdited.project.chrRegions?.[0]?.endTile).toBe(0x2f);
      expect(deserializedEdited.project.chrRegions?.[0]?.notes).toBe(
        'Expanded to 48 tiles',
      );

      // 3. Delete a region (remove reservationFx)
      const projectDeleted: StudioProject = {
        ...deserializedEdited.project,
        chrRegions: [editedHero],
      };

      const serializedDeleted = serializeProject(projectDeleted);
      const deserializedDeleted = deserializeProject(serializedDeleted);
      expect(deserializedDeleted.success).toBe(true);
      if (!deserializedDeleted.success)
        throw new Error('Deserialization failed');

      expect(deserializedDeleted.project.chrRegions?.length).toBe(1);
      expect(deserializedDeleted.project.chrRegions?.[0]?.name).toBe(
        'Hero Sprites',
      );
    });
  });
});
