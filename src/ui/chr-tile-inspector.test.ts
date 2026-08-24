import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAnimationProjectModel,
  type AnimationDefinitionInput,
} from '../core/animation-model';
import type { IndexedImage, Tile } from '../core/types';
import { setLocale } from '../i18n';
import {
  createChrTileInspector,
  renderEnlargedTileCanvas,
  resolveTileSlotDiagnosis,
} from './chr-tile-inspector';

class MockElement {
  tagName: string;
  className = '';
  id = '';
  children: MockElement[] = [];
  attributes = new Map<string, string>();
  eventListeners = new Map<string, ((e?: unknown) => void)[]>();
  _text = '';
  value = '';
  title = '';
  width = 0;
  height = 0;
  style: Record<string, string> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    return this._text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this._text = val;
    this.children = [];
  }

  get classList() {
    return {
      contains: (cls: string) => this.className.split(/\s+/).includes(cls),
      add: (cls: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.add(cls);
        this.className = Array.from(classes).join(' ');
      },
      remove: (cls: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.delete(cls);
        this.className = Array.from(classes).join(' ');
      },
    };
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(event: string, handler: (e?: unknown) => void) {
    const list = this.eventListeners.get(event) ?? [];
    list.push(handler);
    this.eventListeners.set(event, list);
  }

  click() {
    const handlers = this.eventListeners.get('click') ?? [];
    handlers.forEach((fn) => {
      fn();
    });
  }

  append(...nodes: (MockElement | string)[]) {
    nodes.forEach((node) => {
      if (typeof node === 'string') {
        this._text += node;
      } else {
        this.children.push(node);
      }
    });
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const match = (el: MockElement): boolean => {
      if (selector.startsWith('.')) {
        const classes = selector.split('.').filter(Boolean);
        return classes.every((cls) => el.classList.contains(cls));
      }
      if (selector.startsWith('#')) {
        return el.id === selector.slice(1);
      }
      return el.tagName.toLowerCase() === selector.toLowerCase();
    };

    const traverse = (el: MockElement) => {
      for (const child of el.children) {
        if (match(child)) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  getContext(type: string) {
    if (type === '2d') {
      return {
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: vi.fn(),
      };
    }
    return null;
  }
}

function createMockIndexedImage(width: number, height: number): IndexedImage {
  const pixels = new Uint8Array(width * height).fill(1);
  return {
    width,
    height,
    pixels,
    colors: [
      { red: 0, green: 0, blue: 0 },
      { red: 255, green: 255, blue: 255 },
      { red: 128, green: 128, blue: 128 },
      { red: 64, green: 64, blue: 64 },
    ],
    transparentIndex: 0,
    colorCount: 4,
  };
}

describe('ChrTileInspector component and utilities', () => {
  beforeEach(() => {
    setLocale('en');
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tagName: string) => new MockElement(tagName),
    };
  });

  describe('resolveTileSlotDiagnosis', () => {
    it('diagnoses empty slot when tile bytes are all zeroes', () => {
      const finalChr = new Uint8Array(8192);
      const diagnosis = resolveTileSlotDiagnosis(
        15,
        finalChr,
        'tileset',
        null,
        null,
        null,
        0,
        [],
      );

      expect(diagnosis.state).toBe('empty');
      expect(diagnosis.stateLabel).toBe('Empty (Unallocated)');
      expect(diagnosis.attribution).toBe('None (Unused slot)');
    });

    it('diagnoses project tile in tileset mode when non-zero and maps tile position', () => {
      const finalChr = new Uint8Array(8192);
      finalChr[10 * 16] = 0xaa;

      const tiles: Tile[] = [
        {
          id: 10,
          column: 2,
          row: 1,
          pixels: new Uint8Array(64).fill(1),
        },
      ];

      const diagnosis = resolveTileSlotDiagnosis(
        10,
        finalChr,
        'tileset',
        null,
        null,
        null,
        0,
        tiles,
      );

      expect(diagnosis.state).toBe('project');
      expect(diagnosis.stateLabel).toBe('Project Tile (Occupied)');
      expect(diagnosis.attribution).toContain('Tile #10');
      expect(diagnosis.attribution).toContain('Col 2, Row 1');
    });

    it('diagnoses Base CHR slot when tile data originates from imported base CHR', () => {
      const baseChr = new Uint8Array(4096);
      baseChr[5 * 16] = 0xff; // local slot 5 in PT0

      const finalChr = new Uint8Array(8192);
      finalChr[5 * 16] = 0xff;

      const diagnosis = resolveTileSlotDiagnosis(
        5,
        finalChr,
        'tileset',
        null,
        baseChr,
        'game_base.chr',
        0,
        [],
      );

      expect(diagnosis.state).toBe('base');
      expect(diagnosis.stateLabel).toBe('Base CHR (Imported)');
      expect(diagnosis.attribution).toBe('Base CHR: game_base.chr');
    });

    it('diagnoses animation metasprite source attribution across multiple frames', () => {
      const image = createMockIndexedImage(16, 16);
      const definitions: AnimationDefinitionInput[] = [
        {
          id: 'walk',
          name: 'Hero_walk',
          image,
          frameWidth: 16,
          frameHeight: 16,
          originX: 8,
          originY: 16,
          frameIndices: [0],
          frameDuration: 8,
        },
      ];

      const model = buildAnimationProjectModel({
        name: 'Hero',
        animations: definitions,
        patternTable: 0,
        destinationPatternTable: 0,
      });

      const diagnosis = resolveTileSlotDiagnosis(
        0,
        model.finalChr,
        'animation',
        model,
        null,
        null,
        0,
        [],
      );

      expect(diagnosis.state).toBe('project');
      expect(diagnosis.attribution).toContain('Hero_walk (#0)');
    });
  });

  describe('renderEnlargedTileCanvas', () => {
    it('creates 128x128 image data and renders scaled 2bpp pixel data', () => {
      const canvas = new MockElement('canvas') as unknown as HTMLCanvasElement;
      const chrBytes = new Uint8Array(8192);
      // Fill plane 0 and plane 1 with test patterns for tile 0
      chrBytes[0] = 0b11000000;
      chrBytes[8] = 0b10100000;

      renderEnlargedTileCanvas(canvas, chrBytes, 0, 16);

      const mockCanvas = canvas as unknown as MockElement;
      expect(
        mockCanvas.attributes.get('width') ??
          (mockCanvas as unknown as { width: number }).width,
      ).toBe(128);
      expect(
        mockCanvas.attributes.get('height') ??
          (mockCanvas as unknown as { height: number }).height,
      ).toBe(128);
    });
  });

  describe('createChrTileInspector component', () => {
    it('creates empty inspector when selectedTileIndex is null', () => {
      const inspector = createChrTileInspector({
        selectedTileIndex: null,
        finalChrBytes: new Uint8Array(8192),
      });

      const mockEl = inspector as unknown as MockElement;
      expect(mockEl.classList.contains('is-empty')).toBe(true);
      expect(
        mockEl.querySelector('.chr-tile-inspector-empty')?.textContent,
      ).toContain('Select any 8×8 tile slot');
    });

    it('creates populated inspector with deselect button and metrics', () => {
      const onDeselect = vi.fn();
      const inspector = createChrTileInspector({
        selectedTileIndex: 42,
        finalChrBytes: new Uint8Array(8192),
        onDeselect,
      });

      const mockEl = inspector as unknown as MockElement;
      expect(mockEl.classList.contains('is-empty')).toBe(false);
      expect(
        mockEl.querySelector('.chr-tile-inspector-target')?.textContent,
      ).toContain('PT0 Slot $2A (#42)');

      const deselectBtn = mockEl.querySelector(
        '.chr-tile-inspector-deselect-btn',
      );
      expect(deselectBtn).not.toBeNull();
      deselectBtn?.click();
      expect(onDeselect).toHaveBeenCalled();
    });
  });
});
