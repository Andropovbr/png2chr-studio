import { describe, it, expect } from 'vitest';
import {
  validateNesProject,
  validateSpritePalettes,
  validateChrAndPatternTable,
  validateAnimationFramesAndPixels,
  validateSceneOamAndScanlines,
  groupConsecutiveScanlineConflicts,
  type NesValidatorInput,
} from './nes-validator';
import type { PaletteDefinition } from './palette-manager';
import type { AnimationItemSetting } from '../ui/types';
import type { ScenePreviewInstance } from './scene-preview';
import type { AnimationProjectModel } from './animation-model';

describe('NES Validator', () => {
  const samplePalettes: PaletteDefinition[] = [
    { id: 'pal_0', name: 'Hero Blue', colors: [0x0f, 0x01, 0x11, 0x21] },
    { id: 'pal_1', name: 'Bat Purple', colors: [0x0f, 0x03, 0x13, 0x23] },
    { id: 'pal_2', name: 'Sword Steel', colors: [0x0f, 0x00, 0x10, 0x30] },
    { id: 'pal_3', name: 'Fire Orange', colors: [0x0f, 0x06, 0x16, 0x26] },
    { id: 'pal_4', name: 'Poison Green', colors: [0x0f, 0x0a, 0x1a, 0x2a] },
  ];

  describe('Sprite Palettes Validation', () => {
    it('passes when 1 to 4 distinct palettes are used in active slots', () => {
      const activeSlots = ['pal_0', 'pal_1', 'pal_2', 'pal_3'];
      const animations: AnimationItemSetting[] = [
        {
          id: 'a1',
          name: 'walk',
          entity: 'Hero',
          paletteId: 'pal_0',
          frameWidth: 16,
          frameHeight: 16,
          originX: 0,
          originY: 0,
          playback: 'loop',
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          defaultDuration: 8,
          frameIndices: [0],
          frameDurations: [8],
          source: null,
          collapsed: false,
        },
        {
          id: 'a2',
          name: 'fly',
          entity: 'Bat',
          paletteId: 'pal_1',
          frameWidth: 16,
          frameHeight: 16,
          originX: 0,
          originY: 0,
          playback: 'loop',
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          defaultDuration: 8,
          frameIndices: [0],
          frameDurations: [8],
          source: null,
          collapsed: false,
        },
      ];

      const instances: ScenePreviewInstance[] = [
        { id: 'i1', entityId: 'Hero', animationName: 'walk', x: 20, y: 30, visible: true },
        { id: 'i2', entityId: 'Bat', animationName: 'fly', x: 80, y: 50, visible: true },
      ];

      const res = validateSpritePalettes({
        palettes: samplePalettes,
        activeSpritePaletteSlots: activeSlots,
        animations,
        scenePreview: { instances },
      });

      expect(res.issues).toHaveLength(0);
      expect(res.palettesUsed).toBe(2);
      expect(res.activeSlotsFilled).toBe(4);
    });

    it('emits NES_PALETTE_LIMIT error when 5 distinct palettes are used in the scene', () => {
      const activeSlots = ['pal_0', 'pal_1', 'pal_2', 'pal_3'];
      const animations: AnimationItemSetting[] = [
        { id: 'a0', name: 'a0', entity: 'E0', paletteId: 'pal_0', frameWidth: 16, frameHeight: 16, originX: 0, originY: 0, playback: 'loop', allowHorizontalFlip: false, allowVerticalFlip: false, defaultDuration: 8, frameIndices: [0], frameDurations: [8], source: null, collapsed: false },
        { id: 'a1', name: 'a1', entity: 'E1', paletteId: 'pal_1', frameWidth: 16, frameHeight: 16, originX: 0, originY: 0, playback: 'loop', allowHorizontalFlip: false, allowVerticalFlip: false, defaultDuration: 8, frameIndices: [0], frameDurations: [8], source: null, collapsed: false },
        { id: 'a2', name: 'a2', entity: 'E2', paletteId: 'pal_2', frameWidth: 16, frameHeight: 16, originX: 0, originY: 0, playback: 'loop', allowHorizontalFlip: false, allowVerticalFlip: false, defaultDuration: 8, frameIndices: [0], frameDurations: [8], source: null, collapsed: false },
        { id: 'a3', name: 'a3', entity: 'E3', paletteId: 'pal_3', frameWidth: 16, frameHeight: 16, originX: 0, originY: 0, playback: 'loop', allowHorizontalFlip: false, allowVerticalFlip: false, defaultDuration: 8, frameIndices: [0], frameDurations: [8], source: null, collapsed: false },
        { id: 'a4', name: 'a4', entity: 'E4', paletteId: 'pal_4', frameWidth: 16, frameHeight: 16, originX: 0, originY: 0, playback: 'loop', allowHorizontalFlip: false, allowVerticalFlip: false, defaultDuration: 8, frameIndices: [0], frameDurations: [8], source: null, collapsed: false },
      ];

      const instances: ScenePreviewInstance[] = [
        { id: 'i0', entityId: 'E0', animationName: 'a0', x: 0, y: 0, visible: true },
        { id: 'i1', entityId: 'E1', animationName: 'a1', x: 0, y: 0, visible: true },
        { id: 'i2', entityId: 'E2', animationName: 'a2', x: 0, y: 0, visible: true },
        { id: 'i3', entityId: 'E3', animationName: 'a3', x: 0, y: 0, visible: true },
        { id: 'i4', entityId: 'E4', animationName: 'a4', x: 0, y: 0, visible: true },
      ];

      const res = validateSpritePalettes({
        palettes: samplePalettes,
        activeSpritePaletteSlots: activeSlots,
        animations,
        scenePreview: { instances },
      });

      expect(res.palettesUsed).toBe(5);
      const limitIssue = res.issues.find((i) => i.code === 'NES_PALETTE_LIMIT');
      expect(limitIssue).toBeDefined();
      expect(limitIssue?.severity).toBe('error');

      const notActiveIssue = res.issues.find((i) => i.code === 'NES_PALETTE_NOT_ACTIVE');
      expect(notActiveIssue).toBeDefined();
      expect(notActiveIssue?.paletteId).toBe('pal_4');
    });

    it('ignores invisible scene instances', () => {
      const activeSlots = ['pal_0', 'pal_1', null, null];
      const animations: AnimationItemSetting[] = [
        { id: 'a0', name: 'a0', entity: 'Hero', paletteId: 'pal_0', frameWidth: 16, frameHeight: 16, originX: 0, originY: 0, playback: 'loop', allowHorizontalFlip: false, allowVerticalFlip: false, defaultDuration: 8, frameIndices: [0], frameDurations: [8], source: null, collapsed: false },
        { id: 'a4', name: 'a4', entity: 'Secret', paletteId: 'pal_4', frameWidth: 16, frameHeight: 16, originX: 0, originY: 0, playback: 'loop', allowHorizontalFlip: false, allowVerticalFlip: false, defaultDuration: 8, frameIndices: [0], frameDurations: [8], source: null, collapsed: false },
      ];

      const instances: ScenePreviewInstance[] = [
        { id: 'i0', entityId: 'Hero', animationName: 'a0', x: 0, y: 0, visible: true },
        { id: 'i4', entityId: 'Secret', animationName: 'a4', x: 0, y: 0, visible: false },
      ];

      const res = validateSpritePalettes({
        palettes: samplePalettes,
        activeSpritePaletteSlots: activeSlots,
        animations,
        scenePreview: { instances },
      });

      expect(res.palettesUsed).toBe(1);
      expect(res.issues).toHaveLength(0);
    });
  });

  describe('CHR & Pattern Table Validation', () => {
    it('validates 256 tiles as within capacity', () => {
      const mockModel = {
        chr: { patternTableFinalTileCount: 256 },
        animations: [],
      } as unknown as AnimationProjectModel;

      const res = validateChrAndPatternTable({
        animationModel: mockModel,
      });

      expect(res.tilesUsed).toBe(256);
      const capacityIssue = res.issues.find((i) => i.code === 'NES_CHR_CAPACITY');
      expect(capacityIssue).toBeUndefined();
    });

    it('emits NES_CHR_CAPACITY error when tiles > 256', () => {
      const mockModel = {
        chr: { patternTableFinalTileCount: 267 },
        animations: [],
      } as unknown as AnimationProjectModel;

      const res = validateChrAndPatternTable({
        animationModel: mockModel,
      });

      expect(res.tilesUsed).toBe(267);
      const capacityIssue = res.issues.find((i) => i.code === 'NES_CHR_CAPACITY');
      expect(capacityIssue).toBeDefined();
      expect(capacityIssue?.severity).toBe('error');
    });

    it('emits NES_CHR_NEAR_CAPACITY warning when tiles >= 240 and <= 256', () => {
      const mockModel = {
        chr: { patternTableFinalTileCount: 245 },
        animations: [],
      } as unknown as AnimationProjectModel;

      const res = validateChrAndPatternTable({
        animationModel: mockModel,
      });

      expect(res.tilesUsed).toBe(245);
      const nearCapIssue = res.issues.find((i) => i.code === 'NES_CHR_NEAR_CAPACITY');
      expect(nearCapIssue).toBeDefined();
      expect(nearCapIssue?.severity).toBe('warning');
    });

    it('detects sprite tile indexing outside selected pattern table', () => {
      const mockModel = {
        chr: { patternTableFinalTileCount: 10 },
        animations: [
          {
            name: 'walk',
            frames: [
              {
                sourceIndex: 0,
                sprites: [
                  { tile: 0, physicalTileIndex: 300 }, // in pattern table 1 while pattern table 0 selected
                ],
              },
            ],
          },
        ],
      } as unknown as AnimationProjectModel;

      const res = validateChrAndPatternTable({
        animationModel: mockModel,
        patternTable: 0,
      });

      const ptIssue = res.issues.find((i) => i.code === 'NES_WRONG_PATTERN_TABLE');
      expect(ptIssue).toBeDefined();
      expect(ptIssue?.severity).toBe('error');
    });
  });

  describe('Frame Dimensions and Pixel Index Validation', () => {
    it('detects frame dimensions not multiple of 8', () => {
      const animations: AnimationItemSetting[] = [
        {
          id: 'a1',
          name: 'bad_dim',
          entity: 'Hero',
          frameWidth: 17,
          frameHeight: 16,
          originX: 0,
          originY: 0,
          playback: 'loop',
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          defaultDuration: 8,
          frameIndices: [0],
          frameDurations: [8],
          source: null,
          collapsed: false,
        },
      ];

      const issues = validateAnimationFramesAndPixels({ animations });
      const dimIssue = issues.find((i) => i.code === 'NES_FRAME_DIMENSIONS');
      expect(dimIssue).toBeDefined();
      expect(dimIssue?.severity).toBe('error');
    });

    it('detects pixel values outside 0..3 in pixelOverrides', () => {
      const animations: AnimationItemSetting[] = [
        {
          id: 'a1',
          name: 'bad_pixels',
          entity: 'Hero',
          frameWidth: 16,
          frameHeight: 16,
          originX: 0,
          originY: 0,
          playback: 'loop',
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          defaultDuration: 8,
          frameIndices: [0],
          frameDurations: [8],
          pixelOverrides: {
            '0,0': {
              0: 4 as unknown as number,
            },
          },
          source: null,
          collapsed: false,
        },
      ];

      const issues = validateAnimationFramesAndPixels({ animations });
      const pxIssue = issues.find((i) => i.code === 'NES_PIXEL_INDEX_RANGE');
      expect(pxIssue).toBeDefined();
      expect(pxIssue?.severity).toBe('error');
    });
  });

  describe('OAM and Scanline Sprite Limits', () => {
    it('groups consecutive scanlines exceeding 8 sprites and calculates peak', () => {
      const counts = new Array(240).fill(0);
      for (let y = 100; y <= 110; y += 1) {
        counts[y] = 10;
      }
      counts[105] = 12; // Peak

      const groups = groupConsecutiveScanlineConflicts(counts, 8);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.startScanline).toBe(100);
      expect(groups[0]?.endScanline).toBe(110);
      expect(groups[0]?.peakCount).toBe(12);
      expect(groups[0]?.peakScanline).toBe(105);
    });

    it('emits NES_OAM_LIMIT error when total hardware sprites exceed 64', () => {
      // 17 instances of 2x2 tiles (4 sprites each) = 68 sprites > 64
      const instances: ScenePreviewInstance[] = Array.from({ length: 17 }, (_, i) => ({
        id: `inst_${String(i)}`,
        entityId: 'Hero',
        animationName: 'idle',
        x: (i % 8) * 16,
        y: Math.floor(i / 8) * 32,
        visible: true,
      }));

      const animations: AnimationItemSetting[] = [
        {
          id: 'a1',
          name: 'idle',
          entity: 'Hero',
          frameWidth: 16,
          frameHeight: 16,
          originX: 0,
          originY: 0,
          playback: 'loop',
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          defaultDuration: 8,
          frameIndices: [0],
          frameDurations: [8],
          source: null,
          collapsed: false,
        },
      ];

      const res = validateSceneOamAndScanlines({
        animations,
        scenePreview: { instances },
      });

      expect(res.oamSpritesUsed).toBe(68);
      const oamIssue = res.issues.find((i) => i.code === 'NES_OAM_LIMIT');
      expect(oamIssue).toBeDefined();
      expect(oamIssue?.severity).toBe('error');
    });

    it('emits NES_SCANLINE_SPRITE_LIMIT warning when > 8 sprites overlap scanlines', () => {
      // 5 instances placed horizontally at y = 50 (each 16x16 = 2 columns of 8x8 = 10 sprites on scanline 50..57)
      const instances: ScenePreviewInstance[] = Array.from({ length: 5 }, (_, i) => ({
        id: `inst_${String(i)}`,
        entityId: 'Hero',
        animationName: 'idle',
        x: i * 20,
        y: 50,
        visible: true,
      }));

      const animations: AnimationItemSetting[] = [
        {
          id: 'a1',
          name: 'idle',
          entity: 'Hero',
          frameWidth: 16,
          frameHeight: 16,
          originX: 0,
          originY: 0,
          playback: 'loop',
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          defaultDuration: 8,
          frameIndices: [0],
          frameDurations: [8],
          source: null,
          collapsed: false,
        },
      ];

      const res = validateSceneOamAndScanlines({
        animations,
        scenePreview: { instances },
      });

      expect(res.peakSpritesPerScanline).toBe(10);
      expect(res.peakScanlineIndex).toBe(50);
      const scanIssue = res.issues.find((i) => i.code === 'NES_SCANLINE_SPRITE_LIMIT');
      expect(scanIssue).toBeDefined();
      expect(scanIssue?.severity).toBe('warning');
    });
  });

  describe('Full Project Validation Result', () => {
    it('returns valid = true when no errors are present', () => {
      const input: NesValidatorInput = {
        palettes: samplePalettes,
        activeSpritePaletteSlots: ['pal_0', 'pal_1', 'pal_2', 'pal_3'],
        animations: [
          {
            id: 'a1',
            name: 'idle',
            entity: 'Hero',
            paletteId: 'pal_0',
            frameWidth: 16,
            frameHeight: 16,
            originX: 0,
            originY: 0,
            playback: 'loop',
            allowHorizontalFlip: false,
            allowVerticalFlip: false,
            defaultDuration: 8,
            frameIndices: [0],
            frameDurations: [8],
            source: null,
            collapsed: false,
          },
        ],
        scenePreview: {
          instances: [
            { id: 'i1', entityId: 'Hero', animationName: 'idle', x: 50, y: 50, visible: true },
          ],
        },
      };

      const result = validateNesProject(input);
      expect(result.valid).toBe(true);
      expect(result.errorCount).toBe(0);
      expect(result.metrics.spritePalettesUsed).toBe(1);
      expect(result.metrics.oamSpritesUsed).toBe(4);
    });

    it('returns valid = false when errors are present', () => {
      const input: NesValidatorInput = {
        palettes: samplePalettes,
        activeSpritePaletteSlots: ['pal_0', null, null, null],
        animations: [
          {
            id: 'a1',
            name: 'idle',
            entity: 'Hero',
            paletteId: 'pal_4', // Not active
            frameWidth: 16,
            frameHeight: 16,
            originX: 0,
            originY: 0,
            playback: 'loop',
            allowHorizontalFlip: false,
            allowVerticalFlip: false,
            defaultDuration: 8,
            frameIndices: [0],
            frameDurations: [8],
            source: null,
            collapsed: false,
          },
        ],
        scenePreview: {
          instances: [
            { id: 'i1', entityId: 'Hero', animationName: 'idle', x: 50, y: 50, visible: true },
          ],
        },
      };

      const result = validateNesProject(input);
      expect(result.valid).toBe(false);
      expect(result.errorCount).toBe(1);
    });
  });
});
