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
import type {
  ChrAssetMappingIndex,
  PhysicalSlotAttribution,
} from '../core/chr-asset-mapping';

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
    const event = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
      target: this,
    };
    handlers.forEach((fn) => {
      fn(event);
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

  replaceChildren(...nodes: (MockElement | string)[]) {
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const match = (el: MockElement): boolean => {
      if (selector.includes('[')) {
        const attrMatch = /\[([^=\]]+)(?:=['"]?([^'"\]]+)['"]?)?\]/.exec(
          selector,
        );
        if (attrMatch) {
          const attr = attrMatch[1]?.trim();
          const val = attrMatch[2]?.trim();
          if (attr) {
            const hasAttr = el.attributes.has(attr);
            if (!hasAttr) return false;
            if (val !== undefined) {
              if (el.attributes.get(attr) !== val) return false;
            }
          }
        }
        const baseSelector = selector.split('[')[0]?.trim();
        if (!baseSelector) return true;
        if (baseSelector.startsWith('.')) {
          const classes = baseSelector.split('.').filter(Boolean);
          return classes.every((cls) => el.classList.contains(cls));
        }
        return el.tagName.toLowerCase() === baseSelector.toLowerCase();
      }
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

    it('diagnoses an intentionally allocated blank tile (16 zero bytes) as project, NOT empty', () => {
      const finalChr = new Uint8Array(8192); // all zeroes
      const blankTile: Tile = {
        id: 0,
        column: 0,
        row: 0,
        pixels: new Uint8Array(64).fill(0),
      };

      const diagnosis = resolveTileSlotDiagnosis(
        0,
        finalChr,
        'tileset',
        null,
        null,
        null,
        0,
        [blankTile],
      );

      expect(diagnosis.state).toBe('project');
      expect(diagnosis.stateLabel).toBe('Project Tile (Occupied)');
      expect(diagnosis.attribution).toContain('Tile #0');
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

    it('renders enlarged preview using custom preview palette colors', () => {
      const customColors = [
        { red: 0, green: 0, blue: 0 },
        { red: 255, green: 0, blue: 0 },
        { red: 0, green: 255, blue: 0 },
        { red: 0, green: 0, blue: 255 },
      ];

      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: new Uint8Array(8192),
        colors: customColors,
      });

      const mockEl = inspector as unknown as MockElement;
      const canvas = mockEl.querySelector('.chr-tile-inspector-canvas');
      expect(canvas).not.toBeNull();
    });

    it('renders contextual highlight badge when tile is highlighted in active scope', () => {
      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: new Uint8Array(8192),
        isHighlighted: true,
        highlightScopeLabel: 'Current Frame (#0)',
      });

      const mockEl = inspector as unknown as MockElement;
      const badge = mockEl.querySelector('.chr-tile-highlight-badge');
      expect(badge).not.toBeNull();
      expect(badge?.classList.contains('is-highlighted')).toBe(true);
      expect(badge?.textContent).toContain('Highlighted in Current Frame (#0)');
    });

    it('renders Used by section with empty message when no references exist', () => {
      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: new Uint8Array(8192),
        references: [],
      });

      const mockEl = inspector as unknown as MockElement;
      expect(mockEl.querySelector('.chr-tile-used-by-title')?.textContent).toBe(
        'Used by (0)',
      );
      expect(mockEl.querySelector('.chr-tile-used-by-empty')?.textContent).toBe(
        'No current project references',
      );
    });

    it('renders reference items with jump buttons and invokes onNavigateToReference', () => {
      const onNavigateToReference = vi.fn();
      const references = [
        {
          type: 'animation' as const,
          entity: 'Hero',
          animationId: 'hero-walk',
          animationName: 'Hero_walk',
          frameIndex: 0,
          spriteIndex: 0,
          x: 0,
          y: 0,
          horizontalFlip: false,
          verticalFlip: false,
          physicalTileIndex: 5,
        },
        {
          type: 'playfield' as const,
          column: 4,
          row: 2,
          nametableIndex: 68,
          tileIndex: 5,
          physicalTileIndex: 5,
        },
        {
          type: 'tileset' as const,
          tileIndex: 5,
          physicalTileIndex: 5,
        },
      ];

      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: new Uint8Array(8192),
        references,
        onNavigateToReference,
      });

      const mockEl = inspector as unknown as MockElement;
      expect(mockEl.querySelector('.chr-tile-used-by-title')?.textContent).toBe(
        'Used by (3)',
      );

      const items = mockEl.querySelectorAll('.chr-tile-ref-item');
      expect(items.length).toBe(3);
      expect(items[0]?.textContent).toContain('Hero · Hero_walk · Frame #0');
      expect(items[1]?.textContent).toContain('(4, 2) · tile $05');
      expect(items[2]?.textContent).toContain('tile #5');

      const jumpBtns = mockEl.querySelectorAll('.chr-tile-ref-jump-btn');
      expect(jumpBtns.length).toBe(3);

      jumpBtns[0]?.click();
      expect(onNavigateToReference).toHaveBeenCalledWith(references[0]);

      jumpBtns[1]?.click();
      expect(onNavigateToReference).toHaveBeenCalledWith(references[1]);
    });

    it('truncates references when more than initial count and toggles full list', () => {
      const references = Array.from({ length: 10 }, (_, i) => ({
        type: 'animation' as const,
        entity: 'Hero',
        animationId: 'hero-walk',
        animationName: 'Hero_walk',
        frameIndex: i,
        spriteIndex: 0,
        x: 0,
        y: 0,
        horizontalFlip: false,
        verticalFlip: false,
        physicalTileIndex: 5,
      }));

      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: new Uint8Array(8192),
        references,
      });

      const mockEl = inspector as unknown as MockElement;
      let items = mockEl.querySelectorAll('.chr-tile-ref-item');
      expect(items.length).toBe(6);

      const toggleBtn = mockEl.querySelector('.chr-tile-refs-toggle-btn');
      expect(toggleBtn).not.toBeNull();
      expect(toggleBtn?.getAttribute('aria-expanded')).toBe('false');
      expect(toggleBtn?.textContent).toContain('Show all (10)');

      toggleBtn?.click();
      const expandedToggleBtn = mockEl.querySelector(
        '.chr-tile-refs-toggle-btn',
      );
      expect(expandedToggleBtn?.getAttribute('aria-expanded')).toBe('true');
      items = mockEl.querySelectorAll('.chr-tile-ref-item');
      expect(items.length).toBe(10);
    });

    it('renders reuse diagnostics section with badges and metrics chips', () => {
      const diagnostic = {
        physicalTileIndex: 5,
        referenceCount: 3,
        resourceCount: 2,
        frameCount: 2,
        animationCount: 2,
        entityCount: 1,
        bucket: 'moderate' as const,
      };

      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: new Uint8Array(8192),
        diagnostic,
      });

      const mockEl = inspector as unknown as MockElement;
      const usageSection = mockEl.querySelector('.chr-tile-usage-section');
      expect(usageSection).not.toBeNull();

      const badge = mockEl.querySelector('.chr-tile-usage-badge');
      expect(badge?.textContent).toContain('Moderate reuse (3 references)');
      expect(badge?.classList.contains('bucket-moderate')).toBe(true);

      const chips = mockEl.querySelectorAll('.chr-tile-usage-chip');
      expect(chips.length).toBe(4);
      expect(chips[0]?.textContent).toContain('Logical References: 3');
      expect(chips[1]?.textContent).toContain('Distinct Frames: 2');
      expect(chips[2]?.textContent).toContain('Distinct Animations: 2');
      expect(chips[3]?.textContent).toContain('Distinct Entities: 1');
    });

    it('diagnoses unreferenced project tiles with neutral non-judgmental badge', () => {
      const finalChr = new Uint8Array(8192);
      finalChr[5 * 16] = 0xff; // non-zero project tile
      const diagnostic = {
        physicalTileIndex: 5,
        referenceCount: 0,
        resourceCount: 0,
        frameCount: 0,
        animationCount: 0,
        entityCount: 0,
        bucket: 'unused' as const,
      };

      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: finalChr,
        diagnostic,
      });

      const mockEl = inspector as unknown as MockElement;
      const badge = mockEl.querySelector('.chr-tile-usage-badge');
      expect(badge?.textContent).toContain(
        'Occupied · no known project references',
      );
      expect(badge?.classList.contains('is-unreferenced-occupied')).toBe(true);
    });

    it('propagates onTilePixelsChange when editing actions occur in the embedded editor', () => {
      const onTilePixelsChange = vi.fn();
      const finalChr = new Uint8Array(8192);
      finalChr[5 * 16] = 0x55;

      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: finalChr,
        onTilePixelsChange,
      });

      const mockEl = inspector as unknown as MockElement;
      const rotateBtn = mockEl.querySelector(
        '.chr-editor-action-btn[data-action="rotate-cw"]',
      );
      expect(rotateBtn).not.toBeNull();
      rotateBtn?.click();

      expect(onTilePixelsChange).toHaveBeenCalledTimes(1);
      expect(onTilePixelsChange).toHaveBeenCalledWith(
        5,
        expect.any(Uint8Array),
      );
    });

    it('renders Region and Reservation as None when no regions cover the tile', () => {
      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: new Uint8Array(8192),
        chrRegions: [],
      });

      const mockEl = inspector as unknown as MockElement;
      const regionMetric = mockEl.querySelector('.chr-metric-region');
      const regionDd = regionMetric?.querySelector('dd');
      const resMetric = mockEl.querySelector('.chr-metric-reservation');
      const resDd = resMetric?.querySelector('dd');
      expect(regionDd?.textContent).toBe('None');
      expect(resDd?.textContent).toBe('None');
    });

    it('renders single Region badge with name, range, and color swatch', () => {
      const inspector = createChrTileInspector({
        selectedTileIndex: 5, // PT0 tile $05
        finalChrBytes: new Uint8Array(8192),
        chrRegions: [
          {
            id: 'reg-player',
            name: 'Player',
            patternTable: 0,
            startTile: 0,
            endTile: 15,
            kind: 'region',
            color: '#38bdf8',
          },
        ],
      });

      const mockEl = inspector as unknown as MockElement;
      const badge = mockEl.querySelector('.chr-region-badge');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain('Player ($00-$0F)');
      const swatch = mockEl.querySelector('.chr-region-color-swatch');
      expect(swatch).not.toBeNull();
      expect(swatch?.style.backgroundColor).toBe('#38bdf8');
    });

    it('renders multiple Region badges when overlapping regions cover the selected tile', () => {
      const inspector = createChrTileInspector({
        selectedTileIndex: 0x10, // PT0 tile $10
        finalChrBytes: new Uint8Array(8192),
        chrRegions: [
          {
            id: 'reg-1',
            name: 'Player',
            patternTable: 0,
            startTile: 0x00,
            endTile: 0x1f,
            kind: 'region',
          },
          {
            id: 'reg-2',
            name: 'Shared FX',
            patternTable: 0,
            startTile: 0x10,
            endTile: 0x2f,
            kind: 'region',
          },
        ],
      });

      const mockEl = inspector as unknown as MockElement;
      const badges = mockEl.querySelectorAll('.chr-region-badge');
      expect(badges.length).toBe(2);
      expect(badges[0]?.textContent).toContain('Player ($00-$1F)');
      expect(badges[1]?.textContent).toContain('Shared FX ($10-$2F)');
    });

    it('renders Reservation badge when tile falls within a reservation', () => {
      const inspector = createChrTileInspector({
        selectedTileIndex: 0x35, // PT0 tile $35
        finalChrBytes: new Uint8Array(8192),
        chrRegions: [
          {
            id: 'res-runtime',
            name: 'Runtime Buffer',
            patternTable: 0,
            startTile: 0x30,
            endTile: 0x3f,
            kind: 'reservation',
          },
        ],
      });

      const mockEl = inspector as unknown as MockElement;
      const resBadge = mockEl.querySelector('.chr-reservation-badge');
      expect(resBadge).not.toBeNull();
      expect(resBadge?.textContent).toContain('Runtime Buffer ($30-$3F)');
    });

    it('renders both Region and Reservation badges when tile is in both', () => {
      const inspector = createChrTileInspector({
        selectedTileIndex: 0x35,
        finalChrBytes: new Uint8Array(8192),
        chrRegions: [
          {
            id: 'reg-player',
            name: 'Player',
            patternTable: 0,
            startTile: 0x00,
            endTile: 0x3f,
            kind: 'region',
          },
          {
            id: 'res-runtime',
            name: 'Runtime Buffer',
            patternTable: 0,
            startTile: 0x30,
            endTile: 0x3f,
            kind: 'reservation',
          },
        ],
      });

      const mockEl = inspector as unknown as MockElement;
      const regionBadge = mockEl.querySelector('.chr-region-badge');
      const resBadge = mockEl.querySelector('.chr-reservation-badge');
      expect(regionBadge?.textContent).toContain('Player ($00-$3F)');
      expect(resBadge?.textContent).toContain('Runtime Buffer ($30-$3F)');
    });

    it('correctly resolves tile slot diagnosis with reservations and base CHR', () => {
      const baseChr = new Uint8Array(4096);
      baseChr[0x10 * 16] = 0xaa; // Base CHR at slot $10

      const diagnosisBase = resolveTileSlotDiagnosis(
        0x10,
        new Uint8Array(8192),
        'tileset',
        null,
        baseChr,
        'main.chr',
        0,
        [],
        true,
        false,
        [
          {
            id: 'res-1',
            name: 'Res1',
            patternTable: 0,
            startTile: 0x00,
            endTile: 0x20,
            kind: 'reservation',
          },
        ],
      );
      // Occupied tile inside reservation remains 'base'
      expect(diagnosisBase.state).toBe('base');

      const diagnosisReserved = resolveTileSlotDiagnosis(
        0x05,
        new Uint8Array(8192),
        'tileset',
        null,
        baseChr,
        'main.chr',
        0,
        [],
        true,
        false,
        [
          {
            id: 'res-1',
            name: 'Res1',
            patternTable: 0,
            startTile: 0x00,
            endTile: 0x20,
            kind: 'reservation',
          },
        ],
      );
      // Empty tile inside reservation becomes 'reserved'
      expect(diagnosisReserved.state).toBe('reserved');
    });
  });

  describe('Tile Ownership & Asset Mapping Inspection (Milestone 6)', () => {
    function buildTestMappingIndex(
      attributions: Partial<PhysicalSlotAttribution>[],
    ): ChrAssetMappingIndex {
      const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
        { length: 512 },
        (_, idx) => ({
          physicalIndex: idx,
          patternTable: idx < 256 ? (0 as const) : (1 as const),
          localIndex: idx % 256,
          origin: undefined,
          usages: [],
          usageCount: 0,
          isShared: false,
        }),
      );
      const physicalIndicesByAsset = new Map<string, Set<number>>();
      const usagesByLogicalKey = new Map();

      for (const attr of attributions) {
        if (attr.physicalIndex !== undefined) {
          const existing = byPhysicalIndex[attr.physicalIndex];
          if (existing) {
            const fullAttr: PhysicalSlotAttribution = {
              ...existing,
              ...attr,
              patternTable:
                attr.physicalIndex < 256 ? (0 as const) : (1 as const),
              localIndex: attr.physicalIndex % 256,
            };
            byPhysicalIndex[attr.physicalIndex] = fullAttr;
          }
          if (attr.origin?.primaryAssetId) {
            const assetSet =
              physicalIndicesByAsset.get(attr.origin.primaryAssetId) ??
              new Set<number>();
            assetSet.add(attr.physicalIndex);
            physicalIndicesByAsset.set(attr.origin.primaryAssetId, assetSet);
          }
        }
      }

      return {
        byPhysicalIndex,
        physicalIndicesByAsset,
        usagesByLogicalKey,
      };
    }

    it('renders structured Asset Origin & Usage section with extracted origin', () => {
      const finalChr = new Uint8Array(8192);
      finalChr[0] = 0x55;

      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 0,
          origin: {
            primaryAssetId: 'asset-hero-sheet',
            primaryAssetName: 'Hero Sprite Sheet',
            logicalKey: 'asset-hero-sheet:0,0',
            sourceCoordinates: {
              tileX: 0,
              tileY: 0,
              pixelX: 0,
              pixelY: 0,
            },
            creationKind: 'extracted',
          },
          usages: [
            {
              type: 'animation',
              assetId: 'asset-hero-sheet',
              entity: 'hero',
              animationId: 'anim-idle',
              animationName: 'idle',
              frameIndex: 0,
              spriteIndex: 0,
              x: 0,
              y: 0,
              horizontalFlip: false,
              verticalFlip: false,
              physicalTileIndex: 0,
              logicalKey: 'asset-hero-sheet:0,0',
            },
          ],
          usageCount: 1,
          isShared: false,
        },
      ]);

      const inspector = createChrTileInspector({
        selectedTileIndex: 0,
        finalChrBytes: finalChr,
        mode: 'animation',
        mappingIndex: mockMappingIndex,
      });

      const mockEl = inspector as unknown as MockElement;
      const ownershipSection = mockEl.querySelector(
        '#chr-tile-ownership-section',
      );
      expect(ownershipSection).not.toBeNull();
      expect(ownershipSection?.textContent).toContain('Asset Origin & Usage');
      expect(ownershipSection?.textContent).toContain('Hero Sprite Sheet');
      expect(ownershipSection?.textContent).toContain('asset-hero-sheet');
      expect(ownershipSection?.textContent).toContain('(0, 0) · (px: 0, 0)');
      expect(ownershipSection?.textContent).toContain('Extracted from asset');

      const kindBadge = mockEl.querySelector('.chr-creation-kind-badge');
      expect(kindBadge?.classList.contains('kind-extracted')).toBe(true);
    });

    it('renders shared badge distinguishing single asset and multiple assets sharing', () => {
      const finalChr = new Uint8Array(8192);

      const mockMappingIndexMulti = buildTestMappingIndex([
        {
          physicalIndex: 12,
          origin: {
            primaryAssetId: 'asset-hero',
            primaryAssetName: 'Hero',
            creationKind: 'extracted',
          },
          usages: [
            {
              type: 'animation',
              assetId: 'asset-hero',
              animationId: 'anim-walk',
              animationName: 'walk',
              frameIndex: 0,
              spriteIndex: 0,
              x: 0,
              y: 0,
              horizontalFlip: false,
              verticalFlip: false,
              physicalTileIndex: 12,
            },
            {
              type: 'animation',
              assetId: 'asset-enemy',
              animationId: 'anim-patrol',
              animationName: 'patrol',
              frameIndex: 1,
              spriteIndex: 0,
              x: 8,
              y: 0,
              horizontalFlip: true,
              verticalFlip: false,
              physicalTileIndex: 12,
            },
          ],
          usageCount: 2,
          isShared: true,
        },
      ]);

      const inspector = createChrTileInspector({
        selectedTileIndex: 12,
        finalChrBytes: finalChr,
        mode: 'animation',
        mappingIndex: mockMappingIndexMulti,
      });

      const mockEl = inspector as unknown as MockElement;
      const sharedBadge = mockEl.querySelector('.chr-tile-shared-badge');
      expect(sharedBadge).not.toBeNull();
      expect(sharedBadge?.textContent).toContain(
        'Shared (2 references across 2 assets)',
      );
    });

    it('renders highlight asset action button and triggers callback', () => {
      const finalChr = new Uint8Array(8192);
      const onHighlightAssetId = vi.fn();

      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 5,
          origin: {
            primaryAssetId: 'asset-soldier',
            primaryAssetName: 'Soldier',
            creationKind: 'extracted',
          },
          usages: [],
          usageCount: 0,
          isShared: false,
        },
      ]);

      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: finalChr,
        mappingIndex: mockMappingIndex,
        highlightedAssetId: null,
        onHighlightAssetId,
      });

      const mockEl = inspector as unknown as MockElement;
      const highlightBtn = mockEl.querySelector('.chr-origin-highlight-btn');
      expect(highlightBtn).not.toBeNull();
      expect(highlightBtn?.textContent).toBe('Highlight asset tiles');

      highlightBtn?.click();
      expect(onHighlightAssetId).toHaveBeenCalledWith('asset-soldier');
    });

    it('renders clear highlight button when the asset is already highlighted', () => {
      const finalChr = new Uint8Array(8192);
      const onHighlightAssetId = vi.fn();

      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 5,
          origin: {
            primaryAssetId: 'asset-soldier',
            primaryAssetName: 'Soldier',
            creationKind: 'extracted',
          },
          usages: [],
          usageCount: 0,
          isShared: false,
        },
      ]);

      const inspector = createChrTileInspector({
        selectedTileIndex: 5,
        finalChrBytes: finalChr,
        mappingIndex: mockMappingIndex,
        highlightedAssetId: 'asset-soldier',
        onHighlightAssetId,
      });

      const mockEl = inspector as unknown as MockElement;
      const highlightBtn = mockEl.querySelector('.chr-origin-highlight-btn');
      expect(highlightBtn).not.toBeNull();
      expect(highlightBtn?.textContent).toBe('Clear asset highlight');
      expect(highlightBtn?.classList.contains('is-active')).toBe(true);

      highlightBtn?.click();
      expect(onHighlightAssetId).toHaveBeenCalledWith(null);
    });

    it('renders structured Usages with Jump to Frame button invoking navigation callback', () => {
      const finalChr = new Uint8Array(8192);
      const onNavigateToAnimation = vi.fn();

      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 8,
          origin: {
            primaryAssetId: 'asset-hero',
            primaryAssetName: 'Hero',
            creationKind: 'extracted',
          },
          usages: [
            {
              type: 'animation',
              assetId: 'asset-hero',
              entity: 'player',
              animationId: 'anim-jump',
              animationName: 'jump',
              frameIndex: 2,
              spriteIndex: 1,
              x: 8,
              y: 16,
              horizontalFlip: true,
              verticalFlip: false,
              physicalTileIndex: 8,
            },
          ],
          usageCount: 1,
          isShared: false,
        },
      ]);

      const inspector = createChrTileInspector({
        selectedTileIndex: 8,
        finalChrBytes: finalChr,
        mappingIndex: mockMappingIndex,
        onNavigateToAnimation,
      });

      const mockEl = inspector as unknown as MockElement;
      const usageItem = mockEl.querySelector('.chr-tile-ref-item');
      expect(usageItem).not.toBeNull();
      expect(usageItem?.textContent).toContain(
        'player · jump · Frame #2 · sprite (8, 16) [Flip H]',
      );

      const jumpBtn = mockEl.querySelector('.chr-tile-ref-jump-btn');
      expect(jumpBtn).not.toBeNull();
      jumpBtn?.click();

      expect(onNavigateToAnimation).toHaveBeenCalledWith('anim-jump', 2);
    });

    it('renders structured Playfield and Tileset usages with jump callbacks', () => {
      const finalChr = new Uint8Array(8192);
      const onNavigateToPlayfield = vi.fn();
      const onNavigateToTileset = vi.fn();

      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 20,
          origin: {
            primaryAssetId: 'asset-world',
            creationKind: 'extracted',
          },
          usages: [
            {
              type: 'playfield',
              assetId: 'asset-world',
              column: 4,
              row: 6,
              nametableIndex: 196,
              localTileIndex: 20,
              physicalTileIndex: 20,
            },
            {
              type: 'tileset',
              assetId: 'asset-world',
              tileIndex: 20,
              sourceCoordinates: { tileX: 2, tileY: 1 },
              physicalTileIndex: 20,
            },
          ],
          usageCount: 2,
          isShared: true,
        },
      ]);

      const inspector = createChrTileInspector({
        selectedTileIndex: 20,
        finalChrBytes: finalChr,
        mappingIndex: mockMappingIndex,
        onNavigateToPlayfield,
        onNavigateToTileset,
      });

      const mockEl = inspector as unknown as MockElement;
      const jumpButtons = mockEl.querySelectorAll('.chr-tile-ref-jump-btn');
      expect(jumpButtons.length).toBe(2);

      jumpButtons[0]?.click();
      expect(onNavigateToPlayfield).toHaveBeenCalledWith(4, 6);

      jumpButtons[1]?.click();
      expect(onNavigateToTileset).toHaveBeenCalledWith(20);
    });

    it('renders empty slot message when slot is empty and unallocated', () => {
      const finalChr = new Uint8Array(8192);

      const inspector = createChrTileInspector({
        selectedTileIndex: 50,
        finalChrBytes: finalChr,
        mappingIndex: buildTestMappingIndex([]),
      });

      const mockEl = inspector as unknown as MockElement;
      const emptyMsg = mockEl.querySelector('.chr-origin-empty-msg');
      expect(emptyMsg).not.toBeNull();
      expect(emptyMsg?.textContent).toBe(
        'No project asset is associated with this slot.',
      );
    });

    it('renders manual-materialized creation kind badge for manual CHR edit', () => {
      const finalChr = new Uint8Array(8192);
      finalChr[0x30 * 16] = 0x33;

      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 0x30,
          origin: {
            primaryAssetId: 'asset-manual',
            primaryAssetName: 'Manual Tile',
            creationKind: 'manual-materialized',
          },
          usages: [],
          usageCount: 0,
          isShared: false,
        },
      ]);

      const inspector = createChrTileInspector({
        selectedTileIndex: 0x30,
        finalChrBytes: finalChr,
        mappingIndex: mockMappingIndex,
      });

      const mockEl = inspector as unknown as MockElement;
      const kindBadge = mockEl.querySelector('.chr-creation-kind-badge');
      expect(kindBadge?.textContent).toBe('Manual CHR edit');
      expect(kindBadge?.classList.contains('kind-manual-materialized')).toBe(
        true,
      );
    });

    it('renders in Portuguese pt-BR with full translation parity', () => {
      setLocale('pt-BR');
      const finalChr = new Uint8Array(8192);

      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 1,
          origin: {
            primaryAssetId: 'asset-heroi',
            primaryAssetName: 'Herói',
            creationKind: 'extracted',
          },
          usages: [
            {
              type: 'animation',
              assetId: 'asset-heroi',
              animationId: 'anim-correr',
              animationName: 'correr',
              frameIndex: 0,
              spriteIndex: 0,
              x: 0,
              y: 0,
              horizontalFlip: true,
              verticalFlip: false,
              physicalTileIndex: 1,
            },
          ],
          usageCount: 1,
          isShared: false,
        },
      ]);

      const inspector = createChrTileInspector({
        selectedTileIndex: 1,
        finalChrBytes: finalChr,
        mappingIndex: mockMappingIndex,
      });

      const mockEl = inspector as unknown as MockElement;
      expect(mockEl.textContent).toContain('Origem e Uso do Asset');
      expect(mockEl.textContent).toContain('Origem');
      expect(mockEl.textContent).toContain('Extraído do asset');
      expect(mockEl.textContent).toContain('Ir para origem');
    });
  });
});
