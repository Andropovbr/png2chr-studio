import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAnimationProjectModel,
  type AnimationDefinitionInput,
} from '../core/animation-model';
import { NES_MASTER_PALETTE, type NesPaletteSet } from '../core/nes-palette';
import type { PaletteDefinition } from '../core/palette-manager';
import type { IndexedImage, Tile } from '../core/types';
import { setLocale } from '../i18n';
import {
  CHR_ZOOM_LEVELS,
  createChrWorkspace,
  getChrPreviewPaletteOptions,
  NEUTRAL_NES_GRAYSCALE,
  resolveChrPreviewPaletteColors,
} from './chr-workspace';
import { createTileHistory, areTilePixelsEqual } from '../core/chr-tile-editor';
import { applyWorkspaceUpdate } from './state-update';
import { createWorkspaceState } from './workspace-state';
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
  style: Record<string, string> & {
    setProperty: (k: string, v: string) => void;
  };
  open = false;
  tabIndex = -1;
  focus = vi.fn();
  scrollIntoView = vi.fn();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    const styleObj: Record<string, string> = {};
    Object.defineProperty(styleObj, 'setProperty', {
      value: (k: string, v: string) => {
        styleObj[k] = v;
      },
      writable: true,
      configurable: true,
    });
    this.style = styleObj as Record<string, string> & {
      setProperty: (k: string, v: string) => void;
    };
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

  dispatchEvent(event: { type: string; [key: string]: unknown }) {
    const handlers = this.eventListeners.get(event.type) ?? [];
    handlers.forEach((fn) => {
      fn(event);
    });
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

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: 256,
      height: 256,
      right: 256,
      bottom: 256,
    };
  }

  getContext(type: string) {
    if (type === '2d') {
      const noop = (): void => {
        /* no-op */
      };
      return {
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: noop,
        drawImage: noop,
        fillRect: noop,
        strokeRect: noop,
        clearRect: noop,
        fillText: noop,
        strokeText: noop,
        beginPath: noop,
        stroke: noop,
        fill: noop,
        arc: noop,
        moveTo: noop,
        lineTo: noop,
        closePath: noop,
        save: noop,
        restore: noop,
        scale: noop,
        translate: noop,
      };
    }
    return null;
  }
}

function createMockIndexedImage(width: number, height: number): IndexedImage {
  const pixels = new Uint8Array(width * height);
  // Generate distinct non-zero values per 8x8 block so they aren't deduplicated
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tileCol = Math.floor(x / 8);
      const tileRow = Math.floor(y / 8);
      const tileIndex = tileRow * 2 + tileCol;
      const localX = x % 8;
      const localY = y % 8;
      if (tileIndex === 0) {
        pixels[y * width + x] = 1;
      } else if (tileIndex === 1) {
        pixels[y * width + x] = 2;
      } else if (tileIndex === 2) {
        pixels[y * width + x] = 3;
      } else {
        pixels[y * width + x] = (localX + localY) % 2 === 0 ? 1 : 2;
      }
    }
  }
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

describe('ChrWorkspace component', () => {
  beforeEach(() => {
    setLocale('en');
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tagName: string) => new MockElement(tagName),
    };
  });

  it('renders total occupancy as PT0 + PT1 with canonical metrics in animation mode', () => {
    const image = createMockIndexedImage(16, 16);
    const definitions: AnimationDefinitionInput[] = [
      {
        id: 'hero_idle',
        name: 'Hero_idle',
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

    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: model,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
    });

    const mockWs = workspace as unknown as MockElement;
    expect(mockWs.classList.contains('chr-workspace')).toBe(true);

    const totalLabel = mockWs.querySelector('.chr-total-occupancy-label');
    expect(totalLabel).not.toBeNull();
    // 4 tiles in PT0 (16x16 metasprite without transparent omission here because filled with color 1)
    expect(totalLabel?.textContent).toContain('4 / 512');

    const ptCards = mockWs.querySelectorAll('.chr-pt-card');
    expect(ptCards.length).toBe(2);

    const pt0Stats = ptCards[0]?.querySelector('.chr-pt-card-stats');
    const pt1Stats = ptCards[1]?.querySelector('.chr-pt-card-stats');
    expect(pt0Stats?.textContent).toContain('4 / 256');
    expect(pt1Stats?.textContent).toContain('0 / 256');

    // Total = PT0 + PT1
    expect(model.chr.finalTileCount).toBe(
      model.chr.patternTableFinalTileCounts[0] +
        model.chr.patternTableFinalTileCounts[1],
    );
  });

  it('correctly handles 4 KiB and 8 KiB base CHR with sparse occupancy and PT split', () => {
    // 4 KiB base CHR (256 tiles, 4096 bytes) with 2 non-empty tiles (sparse)
    const baseChr4k = new Uint8Array(4096);
    // tile 0 has non-zero byte
    baseChr4k[0] = 0x55;
    // tile 5 has non-zero byte
    baseChr4k[5 * 16] = 0xaa;

    const image = createMockIndexedImage(16, 16);
    const definitions: AnimationDefinitionInput[] = [
      {
        id: 'hero_walk',
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
      baseChr: baseChr4k,
      patternTable: 1,
      destinationPatternTable: 1,
    });

    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: model,
      baseChr: baseChr4k,
      baseChrName: 'sprites_base.chr',
      patternTable: 1,
      destinationPatternTable: 1,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
    });

    const mockWs = workspace as unknown as MockElement;
    const baseBadge = mockWs.querySelector('.chr-base-status-badge');
    expect(baseBadge?.textContent).toContain('sprites_base.chr');
    expect(baseBadge?.textContent).toContain('4096 bytes');

    // PT1 is sprite table and destination pattern table
    const ptCards = mockWs.querySelectorAll('.chr-pt-card');
    const pt1Role = ptCards[1]?.querySelector('.chr-pt-role-badge');
    expect(pt1Role?.classList.contains('is-sprite-pt')).toBe(true);

    const spriteCap = mockWs.querySelector('.chr-sprite-capacity-stats');
    expect(spriteCap?.textContent).toContain('256 tiles');
  });

  it('clarifies physical CHR indexes vs OAM-local tile indexes', () => {
    const workspace = createChrWorkspace({
      mode: 'tileset',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 1,
      destinationPatternTable: 1,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
    });

    const mockWs = workspace as unknown as MockElement;
    const oamExplain = mockWs.querySelector('.chr-oam-explain');
    expect(oamExplain?.textContent).toContain('(0..255)');
    expect(oamExplain?.textContent).toContain('physicalIndex % 256');

    const activeSpritePt = mockWs.querySelector('.chr-sprite-active-pt');
    expect(activeSpritePt?.textContent).toContain('PT1 ($1000)');
  });

  it('displays tileset/playfield deduplication breakdown and handles full 512-tile capacity correctly', () => {
    // Mock 10 tiles where 6 are duplicates (4 unique)
    const mockTile = (id: number): Tile => ({
      id,
      column: id % 16,
      row: Math.floor(id / 16),
      pixels: new Uint8Array(64).fill(id % 4),
    });

    const tiles: Tile[] = Array.from({ length: 10 }, (_, i) => mockTile(i));

    const workspace = createChrWorkspace({
      mode: 'tileset',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles,
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
    });

    const mockWs = workspace as unknown as MockElement;
    const reuseMetrics = mockWs.querySelector('.chr-reuse-metrics');
    expect(reuseMetrics).not.toBeNull();
    // 4 unique tiles, 6 saved
    expect(reuseMetrics?.textContent).toContain('4');
    expect(reuseMetrics?.textContent).toContain('6');
  });

  it('triggers export and navigation callbacks when action buttons are clicked', () => {
    const onDownloadBytes = vi.fn();
    const onNavigateToWorkspace = vi.fn();

    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
      onDownloadBytes,
      onNavigateToWorkspace,
    });

    const mockWs = workspace as unknown as MockElement;
    const exportPanel = mockWs.querySelector('.chr-export-panel');
    expect(exportPanel).not.toBeNull();

    const buttons = exportPanel?.querySelectorAll('button') ?? [];
    expect(buttons.length).toBe(3);

    // 1. Download CHR button
    buttons[0]?.click();
    expect(onDownloadBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'output.chr',
    );

    // 2. Go to Animation Editor button
    buttons[1]?.click();
    expect(onNavigateToWorkspace).toHaveBeenCalledWith('animation');

    // 3. Go to Palette Workspace button
    buttons[2]?.click();
    expect(onNavigateToWorkspace).toHaveBeenCalledWith('palette');
  });

  it('renders visual pattern tables panel (#section-chr-viewer) with PT0 and PT1 cards', () => {
    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
    });

    const mockWs = workspace as unknown as MockElement;
    const viewerPanel = mockWs.querySelector('#section-chr-viewer');
    expect(viewerPanel).not.toBeNull();
    expect(viewerPanel?.classList.contains('chr-viewer-panel')).toBe(true);

    const ptViewCards =
      viewerPanel?.querySelectorAll('.chr-pt-view-card') ?? [];
    expect(ptViewCards.length).toBe(2);

    // PT0 Header & Subtitle
    const pt0Card = ptViewCards[0];
    expect(pt0Card?.getAttribute('data-pattern-table')).toBe('0');
    expect(pt0Card?.textContent).toContain('$0000..$0FFF');
    expect(pt0Card?.textContent).toContain('256 tiles');

    // PT1 Header & Subtitle
    const pt1Card = ptViewCards[1];
    expect(pt1Card?.getAttribute('data-pattern-table')).toBe('1');
    expect(pt1Card?.textContent).toContain('$1000..$1FFF');
    expect(pt1Card?.textContent).toContain('256 tiles');
  });

  it('renders exactly 256 slots in PT0 (0..255) and 256 slots in PT1 (256..511) totaling 512 physical slots', () => {
    const workspace = createChrWorkspace({
      mode: 'tileset',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
    });

    const mockWs = workspace as unknown as MockElement;
    const ptViewCards = mockWs.querySelectorAll('.chr-pt-view-card');
    expect(ptViewCards.length).toBe(2);

    const pt0Slots = ptViewCards[0]?.querySelectorAll('.chr-tile-slot') ?? [];
    const pt1Slots = ptViewCards[1]?.querySelectorAll('.chr-tile-slot') ?? [];

    expect(pt0Slots.length).toBe(256);
    expect(pt1Slots.length).toBe(256);

    const allSlots = mockWs.querySelectorAll('.chr-tile-slot');
    expect(allSlots.length).toBe(512);

    // PT0 bounds
    expect(pt0Slots[0]?.getAttribute('data-physical-index')).toBe('0');
    expect(pt0Slots[0]?.getAttribute('data-local-index')).toBe('0');
    expect(pt0Slots[0]?.getAttribute('data-pattern-table')).toBe('0');
    expect(pt0Slots[0]?.getAttribute('data-row')).toBe('0');
    expect(pt0Slots[0]?.getAttribute('data-col')).toBe('0');

    expect(pt0Slots[255]?.getAttribute('data-physical-index')).toBe('255');
    expect(pt0Slots[255]?.getAttribute('data-local-index')).toBe('255');
    expect(pt0Slots[255]?.getAttribute('data-row')).toBe('15');
    expect(pt0Slots[255]?.getAttribute('data-col')).toBe('15');

    // PT1 bounds
    expect(pt1Slots[0]?.getAttribute('data-physical-index')).toBe('256');
    expect(pt1Slots[0]?.getAttribute('data-local-index')).toBe('0');
    expect(pt1Slots[0]?.getAttribute('data-pattern-table')).toBe('1');
    expect(pt1Slots[0]?.getAttribute('data-row')).toBe('0');
    expect(pt1Slots[0]?.getAttribute('data-col')).toBe('0');

    expect(pt1Slots[255]?.getAttribute('data-physical-index')).toBe('511');
    expect(pt1Slots[255]?.getAttribute('data-local-index')).toBe('255');
    expect(pt1Slots[255]?.getAttribute('data-row')).toBe('15');
    expect(pt1Slots[255]?.getAttribute('data-col')).toBe('15');
  });

  it('verifies 16x16 grid coordinate and addressing math for all slots', () => {
    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
    });

    const mockWs = workspace as unknown as MockElement;
    const pt0Card = mockWs.querySelectorAll('.chr-pt-view-card')[0];
    const pt0Slots = pt0Card?.querySelectorAll('.chr-tile-slot') ?? [];

    // Check slot index 16 (row 1, col 0)
    const slot16 = pt0Slots[16];
    expect(slot16?.getAttribute('data-physical-index')).toBe('16');
    expect(slot16?.getAttribute('data-local-index')).toBe('16');
    expect(slot16?.getAttribute('data-row')).toBe('1');
    expect(slot16?.getAttribute('data-col')).toBe('0');
    expect(slot16?.getAttribute('role')).toBe('gridcell');
    expect(slot16?.title).toContain('$0100');

    // Check slot index 31 (row 1, col 15)
    const slot31 = pt0Slots[31];
    expect(slot31?.getAttribute('data-physical-index')).toBe('31');
    expect(slot31?.getAttribute('data-local-index')).toBe('31');
    expect(slot31?.getAttribute('data-row')).toBe('1');
    expect(slot31?.getAttribute('data-col')).toBe('15');
  });

  it('renders 128x128 canvases for PT0 and PT1 and executes 2bpp decoding', () => {
    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
    });

    const mockWs = workspace as unknown as MockElement;
    const canvases = mockWs.querySelectorAll('.chr-pt-canvas');
    expect(canvases.length).toBe(2);

    canvases.forEach((canvas) => {
      expect(
        canvas.attributes.get('width') ??
          (canvas as unknown as { width: number }).width,
      ).toBe(128);
      expect(
        canvas.attributes.get('height') ??
          (canvas as unknown as { height: number }).height,
      ).toBe(128);
    });
  });

  it('renders zoom controls, scales canvas container, and responds to zoom changes', () => {
    const onZoomChange = vi.fn();
    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
      zoom: 3,
      onZoomChange,
    });

    const mockWs = workspace as unknown as MockElement;
    const zoomControls = mockWs.querySelector('.chr-zoom-controls');
    expect(zoomControls).not.toBeNull();

    const zoomButtons =
      zoomControls?.querySelectorAll('.segmented-button') ?? [];
    expect(zoomButtons.length).toBe(4); // 1x, 2x, 3x, 4x

    // 3x button should be active
    const activeBtn = zoomControls?.querySelector(
      '.segmented-button.is-active',
    );
    expect(activeBtn?.textContent).toBe('3×');
    expect(activeBtn?.getAttribute('aria-pressed')).toBe('true');

    // Canvas container style should be 128 * 3 = 384px
    const containers = mockWs.querySelectorAll('.chr-pt-canvas-container');
    expect(containers.length).toBe(2);
    expect(containers[0]?.style.width).toBe('384px');
    expect(containers[0]?.style.height).toBe('384px');

    // Click 4x button (index 3)
    zoomButtons[3]?.click();
    expect(onZoomChange).toHaveBeenCalledWith(4);
  });

  it('handles empty CHR gracefully and renders all 512 slots without error', () => {
    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: false,
      flipDeduplicationEnabled: false,
      zoom: 1,
    });

    const mockWs = workspace as unknown as MockElement;
    const slots = mockWs.querySelectorAll('.chr-tile-slot');
    expect(slots.length).toBe(512);

    const containers = mockWs.querySelectorAll('.chr-pt-canvas-container');
    expect(containers[0]?.style.width).toBe('128px');
    expect(containers[0]?.style.height).toBe('128px');
  });

  it('handles interactive tile selection on PT0 and PT1 via click and keyboard', () => {
    const onSelectTile = vi.fn();
    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
      selectedTileIndex: 10,
      onSelectTile,
    });

    const mockWs = workspace as unknown as MockElement;
    const slots = mockWs.querySelectorAll('.chr-tile-slot');

    // Slot 10 should have .is-selected and aria-selected="true"
    const slot10 = slots[10];
    expect(slot10?.classList.contains('is-selected')).toBe(true);
    expect(slot10?.getAttribute('aria-selected')).toBe('true');

    // Slot 20 should not be selected
    const slot20 = slots[20];
    expect(slot20?.classList.contains('is-selected')).toBe(false);
    expect(slot20?.getAttribute('aria-selected')).toBe('false');

    // Clicking slot 20 triggers onSelectTile(20)
    slot20?.click();
    expect(onSelectTile).toHaveBeenCalledWith(20);

    // Pressing Enter on slot 300 (in PT1) triggers onSelectTile(300)
    const slot300 = slots[300];
    slot300?.dispatchEvent({ type: 'keydown', key: 'Enter' });
    expect(onSelectTile).toHaveBeenCalledWith(300);

    // Pressing Space on slot 300 triggers onSelectTile(300)
    slot300?.dispatchEvent({ type: 'keydown', key: ' ' });
    expect(onSelectTile).toHaveBeenCalledWith(300);

    // Pressing Escape on slot triggers onSelectTile(null)
    slot10?.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(onSelectTile).toHaveBeenCalledWith(null);
  });

  it('renders contextual tile inspector panel with accurate addressing metadata, byte offsets, and enlarged preview', () => {
    const onSelectTile = vi.fn();
    const image = createMockIndexedImage(16, 16);
    const definitions: AnimationDefinitionInput[] = [
      {
        id: 'hero_idle',
        name: 'Hero_idle',
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

    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: model,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
      selectedTileIndex: 2,
      onSelectTile,
    });

    const mockWs = workspace as unknown as MockElement;
    const inspector = mockWs.querySelector('#section-chr-tile-inspector');
    expect(inspector).not.toBeNull();
    expect(inspector?.classList.contains('is-empty')).toBe(false);

    // Title & Target
    const title = inspector?.querySelector('.chr-tile-inspector-title');
    expect(title?.textContent).toBe('Tile Inspector');
    const target = inspector?.querySelector('.chr-tile-inspector-target');
    expect(target?.textContent).toContain('PT0 Slot $02 (#2)');

    // Enlarged Canvas Preview
    const previewCanvas = inspector?.querySelector(
      '.chr-tile-inspector-canvas',
    );
    expect(previewCanvas).not.toBeNull();
    expect(
      previewCanvas?.attributes.get('width') ??
        (previewCanvas as unknown as { width: number }).width,
    ).toBe(128);
    expect(
      previewCanvas?.attributes.get('height') ??
        (previewCanvas as unknown as { height: number }).height,
    ).toBe(128);

    // Pixel Grid & Toggle
    const pixelGrid = inspector?.querySelector(
      '.chr-tile-inspector-pixel-grid',
    );
    expect(pixelGrid?.classList.contains('is-visible')).toBe(true);
    const gridCells = pixelGrid?.querySelectorAll('.chr-pixel-grid-cell') ?? [];
    expect(gridCells.length).toBe(64);

    const toggleBtn = inspector?.querySelector('.chr-tile-grid-toggle');
    expect(toggleBtn?.getAttribute('aria-pressed')).toBe('true');
    toggleBtn?.click();
    expect(pixelGrid?.classList.contains('is-visible')).toBe(false);
    expect(toggleBtn?.getAttribute('aria-pressed')).toBe('false');

    // Metrics list
    const metrics = inspector?.querySelector('.chr-tile-inspector-metrics');
    expect(metrics).not.toBeNull();
    expect(metrics?.textContent).toContain('Global Physical Index');
    expect(metrics?.textContent).toContain('2 ($002)');
    expect(metrics?.textContent).toContain('Local Pattern Table Index');
    expect(metrics?.textContent).toContain('2 ($02)');
    expect(metrics?.textContent).toContain('Pattern Table');
    expect(metrics?.textContent).toContain('PT0 ($0000)');
    expect(metrics?.textContent).toContain('CHR-ROM Start Offset');
    expect(metrics?.textContent).toContain('$0020 (32)');
    expect(metrics?.textContent).toContain('Bitplane 0 Offset (+0)');
    expect(metrics?.textContent).toContain('$0020 (+0)');
    expect(metrics?.textContent).toContain('Bitplane 1 Offset (+8)');
    expect(metrics?.textContent).toContain('$0028 (+8)');

    // Slot state & Attribution
    const slotBadge = inspector?.querySelector('.chr-slot-state-badge');
    expect(slotBadge?.classList.contains('state-project')).toBe(true);
    expect(slotBadge?.textContent).toBe('Project Tile (Occupied)');

    const attribution = inspector?.querySelector('.chr-attribution-text');
    expect(attribution?.textContent).toContain('Hero_idle (#0)');

    // Deselect button
    const deselectBtn = inspector?.querySelector(
      '.chr-tile-inspector-deselect-btn',
    );
    expect(deselectBtn).not.toBeNull();
    deselectBtn?.click();
    expect(onSelectTile).toHaveBeenCalledWith(null);
  });

  it('correctly diagnoses Base CHR slot state and attribution in PT1', () => {
    const baseChr4k = new Uint8Array(4096);
    baseChr4k[0] = 0x55; // Tile 0 in base CHR (physical tile 256 in PT1)

    const workspace = createChrWorkspace({
      mode: 'animation',
      animationModel: null,
      baseChr: baseChr4k,
      baseChrName: 'sprites_base.chr',
      patternTable: 1,
      destinationPatternTable: 1,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
      selectedTileIndex: 256,
    });

    const mockWs = workspace as unknown as MockElement;
    const inspector = mockWs.querySelector('#section-chr-tile-inspector');
    expect(inspector).not.toBeNull();

    // Target
    const target = inspector?.querySelector('.chr-tile-inspector-target');
    expect(target?.textContent).toContain('PT1 Slot $00 (#256)');

    // Metrics for PT1 start
    const metrics = inspector?.querySelector('.chr-tile-inspector-metrics');
    expect(metrics?.textContent).toContain('256 ($100)');
    expect(metrics?.textContent).toContain('0 ($00)');
    expect(metrics?.textContent).toContain('PT1 ($1000)');
    expect(metrics?.textContent).toContain('$1000 (4096)');
    expect(metrics?.textContent).toContain('$1000 (+0)');
    expect(metrics?.textContent).toContain('$1008 (+8)');

    // Base CHR state & Attribution
    const slotBadge = inspector?.querySelector('.chr-slot-state-badge');
    expect(slotBadge?.classList.contains('state-base')).toBe(true);
    expect(slotBadge?.textContent).toBe('Base CHR (Imported)');

    const attribution = inspector?.querySelector('.chr-attribution-text');
    expect(attribution?.textContent).toContain('Base CHR: sprites_base.chr');
  });

  it('renders placeholder empty state when no tile is selected', () => {
    const workspace = createChrWorkspace({
      mode: 'tileset',
      animationModel: null,
      baseChr: null,
      baseChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      tiles: [],
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
      selectedTileIndex: null,
    });

    const mockWs = workspace as unknown as MockElement;
    const inspector = mockWs.querySelector('#section-chr-tile-inspector');
    expect(inspector).not.toBeNull();
    expect(inspector?.classList.contains('is-empty')).toBe(true);

    const emptyMessage = inspector?.querySelector('.chr-tile-inspector-empty');
    expect(emptyMessage).not.toBeNull();
    expect(emptyMessage?.textContent).toContain('Select any 8×8 tile slot');
  });

  it('verifies uniform square scaling across all zoom levels for both PT0 and PT1', () => {
    for (const zoom of CHR_ZOOM_LEVELS) {
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        zoom,
      });

      const mockWs = workspace as unknown as MockElement;
      const containers = mockWs.querySelectorAll('.chr-pt-canvas-container');
      expect(containers.length).toBe(2);

      const expectedDimension = `${String(128 * zoom)}px`;

      // Verify both PT0 and PT1 containers scale equally in width and height (square)
      containers.forEach((container) => {
        expect(container.style.width).toBe(expectedDimension);
        expect(container.style.height).toBe(expectedDimension);
      });

      // Verify backing canvases retain 128x128 resolution
      const canvases = mockWs.querySelectorAll('.chr-pt-canvas');
      expect(canvases.length).toBe(2);
      canvases.forEach((canvas) => {
        expect(
          canvas.attributes.get('width') ??
            (canvas as unknown as { width: number }).width,
        ).toBe(128);
        expect(
          canvas.attributes.get('height') ??
            (canvas as unknown as { height: number }).height,
        ).toBe(128);
      });

      // Verify both grids contain exactly 256 cells in 16x16 structure
      const overlays = mockWs.querySelectorAll('.chr-pt-grid-overlay');
      expect(overlays.length).toBe(2);
      overlays.forEach((overlay) => {
        const cells = overlay.querySelectorAll('.chr-tile-slot');
        expect(cells.length).toBe(256);

        // First cell (local index 0) must be row 0, col 0
        expect(cells[0]?.getAttribute('data-local-index')).toBe('0');
        expect(cells[0]?.getAttribute('data-row')).toBe('0');
        expect(cells[0]?.getAttribute('data-col')).toBe('0');

        // Last cell (local index 255) must be row 15, col 15
        expect(cells[255]?.getAttribute('data-local-index')).toBe('255');
        expect(cells[255]?.getAttribute('data-row')).toBe('15');
        expect(cells[255]?.getAttribute('data-col')).toBe('15');
      });
    }
  });

  it('guarantees that zoom updates are workspace-only and do not mark project dirty', () => {
    const initialWorkspace = createWorkspaceState();
    expect(initialWorkspace.chr.zoom).toBe(2);

    const updateResult = applyWorkspaceUpdate(initialWorkspace, (prev) => ({
      ...prev,
      chr: { ...prev.chr, zoom: 4 },
    }));

    expect(updateResult.value.chr.zoom).toBe(4);
    expect(updateResult.marksProjectDirty).toBe(false);
  });

  describe('palette-aware CHR preview resolution and UI', () => {
    const paletteSet: NesPaletteSet = [
      [0x0f, 0x11, 0x21, 0x30], // BG 0
      [0x0f, 0x06, 0x16, 0x26], // BG 1
      [0x0f, 0x09, 0x19, 0x29], // BG 2
      [0x0f, 0x03, 0x13, 0x23], // BG 3
    ];

    const palettes: readonly PaletteDefinition[] = [
      {
        id: 'pal_hero',
        name: 'Hero Palette',
        colors: [0x0f, 0x16, 0x27, 0x38],
      },
      {
        id: 'pal_enemy',
        name: 'Enemy Palette',
        colors: [0x0f, 0x05, 0x15, 0x25],
      },
      {
        id: 'pal_item',
        name: 'Item Palette',
        colors: [0x0f, 0x18, 0x28, 0x38],
      },
    ];

    const activeSlots: readonly (string | null)[] = [
      'pal_hero',
      'pal_enemy',
      null,
      null,
    ];

    it('resolves grayscale palette colors correctly', () => {
      const colors = resolveChrPreviewPaletteColors(
        'grayscale',
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(colors).toEqual(NEUTRAL_NES_GRAYSCALE);

      const defaultColors = resolveChrPreviewPaletteColors();
      expect(defaultColors).toEqual(NEUTRAL_NES_GRAYSCALE);
    });

    it('resolves background subpalettes 0..3 to exact NES master RGB colors', () => {
      // BG 0: [0x0f, 0x11, 0x21, 0x30]
      const bg0 = resolveChrPreviewPaletteColors(
        'bg-0',
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(bg0.length).toBe(4);
      expect(bg0[0]).toEqual(NES_MASTER_PALETTE[0x0f]);
      expect(bg0[1]).toEqual(NES_MASTER_PALETTE[0x11]);
      expect(bg0[2]).toEqual(NES_MASTER_PALETTE[0x21]);
      expect(bg0[3]).toEqual(NES_MASTER_PALETTE[0x30]);

      // BG 1: [0x0f, 0x06, 0x16, 0x26]
      const bg1 = resolveChrPreviewPaletteColors(
        'bg-1',
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(bg1[1]).toEqual(NES_MASTER_PALETTE[0x06]);
      expect(bg1[2]).toEqual(NES_MASTER_PALETTE[0x16]);
      expect(bg1[3]).toEqual(NES_MASTER_PALETTE[0x26]);
    });

    it('resolves active sprite subpalettes using assigned definition colors', () => {
      // SP 0 -> pal_hero: [0x0f, 0x16, 0x27, 0x38]
      const sp0 = resolveChrPreviewPaletteColors(
        'sp-0',
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(sp0.length).toBe(4);
      expect(sp0[0]).toEqual(NES_MASTER_PALETTE[0x0f]);
      expect(sp0[1]).toEqual(NES_MASTER_PALETTE[0x16]);
      expect(sp0[2]).toEqual(NES_MASTER_PALETTE[0x27]);
      expect(sp0[3]).toEqual(NES_MASTER_PALETTE[0x38]);

      // SP 1 -> pal_enemy: [0x0f, 0x05, 0x15, 0x25]
      const sp1 = resolveChrPreviewPaletteColors(
        'sp-1',
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(sp1[1]).toEqual(NES_MASTER_PALETTE[0x05]);
      expect(sp1[2]).toEqual(NES_MASTER_PALETTE[0x15]);
      expect(sp1[3]).toEqual(NES_MASTER_PALETTE[0x25]);

      // SP 2 (unassigned) -> fallback palette
      const sp2 = resolveChrPreviewPaletteColors(
        'sp-2',
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(sp2.length).toBe(4);
    });

    it('resolves named palette definitions by ID directly', () => {
      const custom = resolveChrPreviewPaletteColors(
        'pal_item',
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(custom.length).toBe(4);
      expect(custom[1]).toEqual(NES_MASTER_PALETTE[0x18]);
      expect(custom[2]).toEqual(NES_MASTER_PALETTE[0x28]);
      expect(custom[3]).toEqual(NES_MASTER_PALETTE[0x38]);
    });

    it('falls back safely to neutral grayscale when palette references are invalid or missing', () => {
      const invalidBg = resolveChrPreviewPaletteColors(
        'bg-99',
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(invalidBg).toEqual(NEUTRAL_NES_GRAYSCALE);

      const invalidSp = resolveChrPreviewPaletteColors(
        'sp-99',
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(invalidSp).toEqual(NEUTRAL_NES_GRAYSCALE);

      const missingId = resolveChrPreviewPaletteColors(
        'non_existent_palette_id',
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(missingId).toEqual(NEUTRAL_NES_GRAYSCALE);

      const nullPalettes = resolveChrPreviewPaletteColors(
        'bg-0',
        undefined,
        undefined,
        undefined,
      );
      expect(nullPalettes.length).toBe(4);
    });

    it('generates structured preview palette options with groups and swatches', () => {
      const options = getChrPreviewPaletteOptions(
        paletteSet,
        palettes,
        activeSlots,
      );
      expect(options.length).toBeGreaterThanOrEqual(9); // grayscale + 4 bg + 4 sp + custom

      const grayscaleOpt = options.find((o) => o.id === 'grayscale');
      expect(grayscaleOpt).toBeDefined();
      expect(grayscaleOpt?.group).toBe('grayscale');

      const bg0Opt = options.find((o) => o.id === 'bg-0');
      expect(bg0Opt).toBeDefined();
      expect(bg0Opt?.group).toBe('background');

      const sp0Opt = options.find((o) => o.id === 'sp-0');
      expect(sp0Opt).toBeDefined();
      expect(sp0Opt?.group).toBe('sprite');
      expect(sp0Opt?.label).toContain('Hero Palette');

      // pal_item is not in active slots, so it should appear under custom group
      const customOpt = options.find((o) => o.id === 'pal_item');
      expect(customOpt).toBeDefined();
      expect(customOpt?.group).toBe('custom');
      expect(customOpt?.label).toBe('Item Palette');
    });

    it('renders palette selection controls in the toolbar and triggers onPreviewPaletteChange', () => {
      const onPreviewPaletteChange = vi.fn();
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        paletteSet,
        palettes,
        activeSpritePaletteSlots: activeSlots,
        previewPalette: 'bg-1',
        onPreviewPaletteChange,
      });

      const mockWs = workspace as unknown as MockElement;
      const paletteControls = mockWs.querySelector('.chr-palette-controls');
      expect(paletteControls).not.toBeNull();

      const paletteSelect = paletteControls?.querySelector(
        '.chr-palette-select',
      );
      expect(paletteSelect).not.toBeNull();

      const swatches = paletteControls?.querySelectorAll('.chr-palette-swatch');
      expect(swatches?.length).toBe(4);

      // Simulate palette change event
      paletteSelect?.dispatchEvent({ type: 'change' });
      expect(onPreviewPaletteChange).toHaveBeenCalled();
    });

    it('guarantees that preview palette updates are workspace-only and do not mark project dirty', () => {
      const initialWorkspace = createWorkspaceState();
      expect(initialWorkspace.chr.previewPalette).toBe('grayscale');

      const updateResult = applyWorkspaceUpdate(initialWorkspace, (prev) => ({
        ...prev,
        chr: { ...prev.chr, previewPalette: 'bg-2' },
      }));

      expect(updateResult.value.chr.previewPalette).toBe('bg-2');
      expect(updateResult.marksProjectDirty).toBe(false);
    });
  });

  describe('CHR slot occupancy visualization & breakdown', () => {
    it('renders the occupancy legend with Project, Base CHR, and Free indicators', () => {
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
      });

      const mockWs = workspace as unknown as MockElement;
      const legend = mockWs.querySelector('.chr-occupancy-legend');
      expect(legend).not.toBeNull();
      expect(legend?.getAttribute('role')).toBe('group');

      const items = legend?.querySelectorAll('.chr-legend-item') ?? [];
      expect(items.length).toBe(5);
      expect(items[0]?.textContent).toContain('Project');
      expect(items[1]?.textContent).toContain('Base CHR');
      expect(items[2]?.textContent).toContain('Reserved');
      expect(items[3]?.textContent).toContain('Free');
      expect(items[4]?.textContent).toContain('Region');
    });

    it('renders pattern table occupancy badges and utilization subtitles on PT cards', () => {
      const baseChr = new Uint8Array(4096);
      for (let i = 0; i < 10; i += 1) {
        baseChr[i * 16] = 0xff; // 10 occupied tiles in base CHR
      }

      const projectTiles: Tile[] = [
        { id: 0, column: 0, row: 0, pixels: new Uint8Array(64).fill(1) },
        { id: 1, column: 1, row: 0, pixels: new Uint8Array(64).fill(2) },
      ];

      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr,
        baseChrName: 'game_base.chr',
        patternTable: 0,
        destinationPatternTable: 1,
        tiles: projectTiles,
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
      });

      const mockWs = workspace as unknown as MockElement;
      const pt0Card = mockWs.querySelector('[data-pattern-table="0"]');
      const pt1Card = mockWs.querySelector('[data-pattern-table="1"]');

      // PT0: 2 project tiles occupied
      const pt0Badge = pt0Card?.querySelector('.chr-pt-occupancy-badge');
      expect(pt0Badge?.textContent).toBe('2 / 256');
      expect(pt0Card?.textContent).toContain('2 / 256 occupied (254 free)');

      // PT1: 10 base CHR tiles occupied
      const pt1Badge = pt1Card?.querySelector('.chr-pt-occupancy-badge');
      expect(pt1Badge?.textContent).toBe('10 / 256');
      expect(pt1Card?.textContent).toContain('10 / 256 occupied (246 free)');
    });

    it('accurately distinguishes an intentionally allocated blank tile (16 zero bytes) as project from free slots', () => {
      const blankTile: Tile = {
        id: 0,
        column: 0,
        row: 0,
        pixels: new Uint8Array(64).fill(0), // blank tile (16 zeroes)
      };

      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [blankTile],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
      });

      const mockWs = workspace as unknown as MockElement;
      const pt0Card = mockWs.querySelector('[data-pattern-table="0"]');
      const slot0 = pt0Card?.querySelector('[data-physical-index="0"]');
      const slot1 = pt0Card?.querySelector('[data-physical-index="1"]');

      // Slot 0 is an intentionally allocated project tile despite being 16 zeroes
      expect(slot0?.getAttribute('data-occupancy')).toBe('project');
      expect(slot0?.classList.contains('is-occupancy-project')).toBe(true);
      expect(slot0?.getAttribute('aria-label')).toContain(
        'Project Tile (Occupied)',
      );
      expect(slot0?.title).toContain('Project Tile (Occupied)');

      // Slot 1 is unallocated / free
      expect(slot1?.getAttribute('data-occupancy')).toBe('empty');
      expect(slot1?.classList.contains('is-occupancy-empty')).toBe(true);
      expect(slot1?.getAttribute('aria-label')).toContain('Free (Unallocated)');
      expect(slot1?.title).toContain('Free (Unallocated)');
    });

    it('renders Base CHR slots with base occupancy decoration and attribution in tooltips', () => {
      const baseChr = new Uint8Array(4096);
      baseChr[0] = 0x55; // PT1 slot 256 has data

      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr,
        baseChrName: 'stages.chr',
        patternTable: 0,
        destinationPatternTable: 1,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
      });

      const mockWs = workspace as unknown as MockElement;
      const pt1Card = mockWs.querySelector('[data-pattern-table="1"]');
      const slot256 = pt1Card?.querySelector('[data-physical-index="256"]');
      const slot257 = pt1Card?.querySelector('[data-physical-index="257"]');

      // Slot 256 is from Base CHR
      expect(slot256?.getAttribute('data-occupancy')).toBe('base');
      expect(slot256?.classList.contains('is-occupancy-base')).toBe(true);
      expect(slot256?.getAttribute('aria-label')).toContain(
        'Base CHR (Imported)',
      );
      expect(slot256?.title).toContain('Base CHR (Imported)');

      // Slot 257 has no base data, so it is empty
      expect(slot257?.getAttribute('data-occupancy')).toBe('empty');
      expect(slot257?.classList.contains('is-occupancy-empty')).toBe(true);
    });

    it('maintains selection dominance over occupancy styles when a slot is selected', () => {
      const projectTiles: Tile[] = [
        { id: 0, column: 0, row: 0, pixels: new Uint8Array(64).fill(1) },
      ];

      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: projectTiles,
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 0,
      });

      const mockWs = workspace as unknown as MockElement;
      const slot0 = mockWs.querySelector('[data-physical-index="0"]');

      expect(slot0?.classList.contains('is-selected')).toBe(true);
      expect(slot0?.classList.contains('is-occupancy-project')).toBe(true);
      expect(slot0?.getAttribute('aria-selected')).toBe('true');
    });
  });

  describe('CHR Usage Highlighting', () => {
    const mockImage: IndexedImage = {
      width: 32,
      height: 16,
      pixels: new Uint8Array(512).fill(1),
      colors: [
        { red: 0, green: 0, blue: 0 },
        { red: 255, green: 0, blue: 0 },
        { red: 0, green: 255, blue: 0 },
        { red: 0, green: 0, blue: 255 },
      ],
      transparentIndex: 0,
      colorCount: 4,
    };

    const definitions: AnimationDefinitionInput[] = [
      {
        id: 'hero-walk',
        name: 'Hero_walk',
        entity: 'Hero',
        sourceImageName: 'hero.png',
        image: mockImage,
        paletteIndex: 0,
        quantizationMode: 'median-cut',
        frameWidth: 16,
        frameHeight: 16,
        originX: 0,
        originY: 0,
        playback: 'loop',
        allowHorizontalFlip: false,
        allowVerticalFlip: false,
        flipH: false,
        flipV: false,
        frameIndices: [0, 1],
        frameDuration: 6,
      },
    ];

    it('renders highlight dropdown controls and summary badge in toolbar', () => {
      const onHighlightScopeChange = vi.fn();
      const model = buildAnimationProjectModel({
        name: 'hero',
        animations: definitions,
        destinationPatternTable: 0,
        flipDeduplication: false,
      });

      const workspace = createChrWorkspace({
        mode: 'animation',
        animationModel: model,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        highlightScope: 'frame',
        onHighlightScopeChange,
        selectedAnimationId: 'hero-walk',
        selectedFrameIndex: 0,
      });

      const mockWs = workspace as unknown as MockElement;
      const select = mockWs.querySelector('.chr-highlight-select');
      expect(select).toBeDefined();

      const summary = mockWs.querySelector('.chr-highlight-summary');
      expect(summary).toBeDefined();
      expect(summary?.textContent).toContain('PT0: 1 · PT1: 0');

      select?.dispatchEvent({ type: 'change' });
    });

    it('applies is-highlighted and data-highlighted="true" to matching tiles and is-dimmed to others', () => {
      const model = buildAnimationProjectModel({
        name: 'hero',
        animations: definitions,
        destinationPatternTable: 0,
        flipDeduplication: false,
      });

      // Let's identify the physical tiles used in frame 0
      const frame0Tiles =
        model.animations[0]?.frames[0]?.sprites.map(
          (s) => s.physicalTileIndex,
        ) ?? [];
      expect(frame0Tiles.length).toBeGreaterThan(0);

      const workspace = createChrWorkspace({
        mode: 'animation',
        animationModel: model,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        highlightScope: 'frame',
        selectedAnimationId: 'hero-walk',
        selectedFrameIndex: 0,
      });

      const mockWs = workspace as unknown as MockElement;
      const pt0Card = mockWs.querySelector('[data-pattern-table="0"]');

      frame0Tiles.forEach((tileIdx) => {
        const slot = pt0Card?.querySelector(
          `[data-physical-index="${String(tileIdx)}"]`,
        );
        expect(slot?.classList.contains('is-highlighted')).toBe(true);
        expect(slot?.getAttribute('data-highlighted')).toBe('true');
        expect(slot?.classList.contains('is-dimmed')).toBe(false);
      });

      // An unused slot should be dimmed
      const unusedSlot = pt0Card?.querySelector('[data-physical-index="255"]');
      expect(unusedSlot?.classList.contains('is-dimmed')).toBe(true);
      expect(unusedSlot?.getAttribute('data-highlighted')).toBe('false');
    });

    it('maintains selection dominance over highlight and dimming styles', () => {
      const model = buildAnimationProjectModel({
        name: 'hero',
        animations: definitions,
        destinationPatternTable: 0,
        flipDeduplication: false,
      });

      const targetTile =
        model.animations[0]?.frames[0]?.sprites[0]?.physicalTileIndex ?? 0;

      const workspace = createChrWorkspace({
        mode: 'animation',
        animationModel: model,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        highlightScope: 'frame',
        selectedAnimationId: 'hero-walk',
        selectedFrameIndex: 0,
        selectedTileIndex: targetTile,
      });

      const mockWs = workspace as unknown as MockElement;
      const selectedSlot = mockWs.querySelector(
        `[data-physical-index="${String(targetTile)}"]`,
      );

      expect(selectedSlot?.classList.contains('is-selected')).toBe(true);
      expect(selectedSlot?.classList.contains('is-highlighted')).toBe(true);
      expect(selectedSlot?.getAttribute('aria-selected')).toBe('true');
      expect(selectedSlot?.getAttribute('data-highlighted')).toBe('true');
    });

    it('is independently usable when no animation or frame is pre-selected in the animation workspace', () => {
      const model = buildAnimationProjectModel({
        name: 'hero',
        animations: definitions,
        destinationPatternTable: 0,
        flipDeduplication: false,
      });

      // No selectedAnimationId, selectedFrameIndex, or selectedEntity supplied
      const workspace = createChrWorkspace({
        mode: 'animation',
        animationModel: model,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        highlightScope: 'frame',
      });

      const mockWs = workspace as unknown as MockElement;
      const select = mockWs.querySelector('.chr-highlight-select');
      expect(select).toBeDefined();

      const animSelect = mockWs.querySelector('.chr-highlight-anim-select');
      expect(animSelect).toBeDefined();

      const frameSelect = mockWs.querySelector('.chr-highlight-frame-select');
      expect(frameSelect).toBeDefined();

      const summary = mockWs.querySelector('.chr-highlight-summary');
      expect(summary).toBeDefined();
      expect(summary?.textContent).toContain('PT0: 1 · PT1: 0');
    });

    it('provides dedicated animation and frame select dropdowns that invoke onSelectAnimation and onSelectFrame', () => {
      const onSelectAnimation = vi.fn();
      const onSelectFrame = vi.fn();
      const model = buildAnimationProjectModel({
        name: 'hero',
        animations: [
          ...definitions,
          {
            name: 'hero_attack',
            sourceImageName: 'hero.png',
            image: mockImage,
            playback: 'once',
            allowHorizontalFlip: false,
            allowVerticalFlip: false,
            flipH: false,
            flipV: false,
            frameIndices: [0],
            frameDuration: 4,
          },
        ],
        destinationPatternTable: 0,
        flipDeduplication: false,
      });

      const workspace = createChrWorkspace({
        mode: 'animation',
        animationModel: model,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        highlightScope: 'frame',
        selectedAnimationId: 'hero-walk',
        selectedFrameIndex: 1,
        onSelectAnimation,
        onSelectFrame,
      });

      const mockWs = workspace as unknown as MockElement;
      const animSelect = mockWs.querySelector('.chr-highlight-anim-select');
      expect(animSelect).toBeDefined();
      expect(animSelect?.children.length).toBe(2);

      animSelect?.dispatchEvent({ type: 'change' });
      expect(onSelectAnimation).toHaveBeenCalled();

      const frameSelect = mockWs.querySelector('.chr-highlight-frame-select');
      expect(frameSelect).toBeDefined();
      expect(frameSelect?.children.length).toBe(2);

      frameSelect?.dispatchEvent({ type: 'change' });
      expect(onSelectFrame).toHaveBeenCalled();
    });

    it('provides entity selector dropdown when multiple entities exist and invokes onSelectEntity', () => {
      const onSelectEntity = vi.fn();
      const model = buildAnimationProjectModel({
        name: 'game',
        animations: [
          {
            name: 'Hero_walk',
            entity: 'Hero',
            sourceImageName: 'hero.png',
            image: mockImage,
            playback: 'loop',
            allowHorizontalFlip: false,
            allowVerticalFlip: false,
            flipH: false,
            flipV: false,
            frameIndices: [0],
            frameDuration: 6,
          },
          {
            name: 'Enemy_walk',
            entity: 'Enemy',
            sourceImageName: 'enemy.png',
            image: mockImage,
            playback: 'loop',
            allowHorizontalFlip: false,
            allowVerticalFlip: false,
            flipH: false,
            flipV: false,
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
        destinationPatternTable: 0,
        flipDeduplication: false,
      });

      const workspace = createChrWorkspace({
        mode: 'animation',
        animationModel: model,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        highlightScope: 'entity',
        selectedEntity: 'Hero',
        onSelectEntity,
      });

      const mockWs = workspace as unknown as MockElement;
      const entitySelect = mockWs.querySelector('.chr-highlight-entity-select');
      expect(entitySelect).toBeDefined();
      expect(entitySelect?.children.length).toBe(2);

      entitySelect?.dispatchEvent({ type: 'change' });
      expect(onSelectEntity).toHaveBeenCalled();
    });

    it('preserves state purity when updating highlightScope in WorkspaceState', () => {
      const initialState = createWorkspaceState();
      expect(initialState.chr.highlightScope).toBe('none');

      const result = applyWorkspaceUpdate(initialState, {
        ...initialState,
        chr: {
          ...initialState.chr,
          highlightScope: 'animation',
          selectedAnimationId: 'hero-walk',
          selectedFrameIndex: 1,
        },
      });

      expect(result.marksProjectDirty).toBe(false);
      expect(result.value.chr.highlightScope).toBe('animation');
      expect(result.value.chr.selectedAnimationId).toBe('hero-walk');
      expect(result.value.chr.selectedFrameIndex).toBe(1);
      expect(initialState.chr.highlightScope).toBe('none');
    });

    it('wires reverse lookup references in Tile Inspector and triggers onNavigateToAnimation callback', () => {
      const mockImage = createMockIndexedImage(16, 16);
      const model = buildAnimationProjectModel({
        name: 'Hero',
        animations: [
          {
            name: 'Hero_walk',
            entity: 'Hero',
            sourceImageName: 'hero.png',
            image: mockImage,
            playback: 'loop',
            allowHorizontalFlip: false,
            allowVerticalFlip: false,
            flipH: false,
            flipV: false,
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
        destinationPatternTable: 0,
        flipDeduplication: false,
      });

      const onNavigateToAnimation = vi.fn();
      const workspace = createChrWorkspace({
        mode: 'animation',
        animationModel: model,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 0,
        onNavigateToAnimation,
      });

      const mockWs = workspace as unknown as MockElement;
      const inspector = mockWs.querySelector('.chr-tile-inspector-panel');
      expect(inspector).not.toBeNull();

      const jumpBtn = mockWs.querySelector('.chr-tile-ref-jump-btn');
      expect(jumpBtn).not.toBeNull();
      jumpBtn?.click();

      expect(onNavigateToAnimation).toHaveBeenCalled();
    });

    it('collects playfield nametable references and wires onNavigateToPlayfield', () => {
      const onNavigateToPlayfield = vi.fn();
      const nametable = new Uint8Array(960);
      nametable[10] = 5; // (10, 0) -> tile 5

      const workspace = createChrWorkspace({
        mode: 'playfield',
        animationModel: null,
        playfieldNametable: nametable,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 5,
        onNavigateToPlayfield,
      });

      const mockWs = workspace as unknown as MockElement;
      const refItem = mockWs.querySelector('.chr-tile-ref-item');
      expect(refItem).not.toBeNull();
      expect(refItem?.textContent).toContain('(10, 0) · tile $05');

      const jumpBtn = mockWs.querySelector('.chr-tile-ref-jump-btn');
      jumpBtn?.click();

      expect(onNavigateToPlayfield).toHaveBeenCalledWith(10, 0);
    });
  });

  describe('CHR Usage Heatmap and Reuse Diagnostics', () => {
    const rawImage: IndexedImage = {
      width: 16,
      height: 16,
      pixels: new Uint8Array(256),
      colors: [
        { red: 0, green: 0, blue: 0 },
        { red: 255, green: 255, blue: 255 },
        { red: 128, green: 128, blue: 128 },
        { red: 64, green: 64, blue: 64 },
      ],
      transparentIndex: 0,
      colorCount: 4,
    };
    rawImage.pixels.fill(1);

    const animationInput: AnimationDefinitionInput[] = [
      {
        id: 'hero_idle',
        name: 'Hero_idle',
        entity: 'Hero',
        image: rawImage,
        frameWidth: 16,
        frameHeight: 16,
        originX: 8,
        originY: 16,
        frameIndices: [0],
        frameDuration: 8,
      },
    ];

    it('renders heatmap toggle and triggers onToggleHeatmap callback', () => {
      const onToggleHeatmap = vi.fn();
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        heatmapEnabled: false,
        onToggleHeatmap,
      });

      const mockWs = workspace as unknown as MockElement;
      const heatmapControls = mockWs.querySelector('.chr-heatmap-controls');
      expect(heatmapControls).not.toBeNull();

      const buttons = heatmapControls?.querySelectorAll('.segmented-button');
      expect(buttons?.length).toBe(2);

      // Click "Heatmap" button to activate
      buttons?.[1]?.click();
      expect(onToggleHeatmap).toHaveBeenCalledWith(true);
    });

    it('renders heatmap legend, summary bar, and slot badges when heatmapEnabled is true', () => {
      const model = buildAnimationProjectModel({
        name: 'Hero_project',
        animations: animationInput,
        patternTable: 0,
        destinationPatternTable: 0,
      });

      const workspace = createChrWorkspace({
        mode: 'animation',
        animationModel: model,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        heatmapEnabled: true,
      });

      const mockWs = workspace as unknown as MockElement;

      // Heatmap legend rendered
      const heatmapLegend = mockWs.querySelector('.chr-heatmap-legend');
      expect(heatmapLegend).not.toBeNull();
      const legendItems = heatmapLegend?.querySelectorAll(
        '.chr-heatmap-legend-item',
      );
      expect(legendItems?.length).toBe(5);

      // Summary bar rendered
      const summaryBar = mockWs.querySelector('.chr-heatmap-summary-bar');
      expect(summaryBar).not.toBeNull();
      expect(summaryBar?.textContent).toContain('Reuse:');

      // Grid overlay has .has-heatmap
      const gridOverlays = mockWs.querySelectorAll('.chr-pt-grid-overlay');
      expect(gridOverlays[0]?.classList.contains('has-heatmap')).toBe(true);

      // Referenced slots have badges and attributes
      const slot0 = mockWs.querySelector('[data-physical-index="0"]');
      expect(slot0).not.toBeNull();
      expect(slot0?.getAttribute('data-heatmap-bucket')).not.toBeNull();
      expect(slot0?.getAttribute('data-ref-count')).not.toBeNull();

      const badge = slot0?.querySelector('.chr-slot-ref-badge');
      expect(badge).not.toBeNull();
    });

    it('preserves transient state purity without marking project dirty when toggling heatmap', () => {
      const initialState = createWorkspaceState();
      expect(initialState.chr.heatmapEnabled).toBe(false);

      const update = applyWorkspaceUpdate(initialState, {
        ...initialState,
        chr: {
          ...initialState.chr,
          heatmapEnabled: true,
        },
      });

      expect(update.value.chr.heatmapEnabled).toBe(true);
      expect(update.marksProjectDirty).toBe(false);
    });
  });

  describe('Issue #45 — CHR Viewer Polish, Keyboard Navigation, and Accessibility', () => {
    it('implements roving tabindex and accessible grid ARIA on pattern table slots', () => {
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: null,
      });

      const mockWs = workspace as unknown as MockElement;
      const gridOverlay = mockWs.querySelector('.chr-pt-grid-overlay');
      expect(gridOverlay).not.toBeNull();
      expect(gridOverlay?.getAttribute('role')).toBe('grid');
      expect(gridOverlay?.getAttribute('aria-rowcount')).toBe('16');
      expect(gridOverlay?.getAttribute('aria-colcount')).toBe('16');

      const slots = gridOverlay?.querySelectorAll('.chr-tile-slot') ?? [];
      expect(slots.length).toBe(256);

      // Without selection, first slot (0) has tabIndex 0, others have -1
      expect(slots[0]?.tabIndex).toBe(0);
      expect(slots[1]?.tabIndex).toBe(-1);
      expect(slots[255]?.tabIndex).toBe(-1);

      // Gridcell ARIA attributes
      expect(slots[0]?.getAttribute('role')).toBe('gridcell');
      expect(slots[0]?.getAttribute('aria-rowindex')).toBe('1');
      expect(slots[0]?.getAttribute('aria-colindex')).toBe('1');
      expect(slots[0]?.getAttribute('aria-selected')).toBe('false');

      expect(slots[17]?.getAttribute('aria-rowindex')).toBe('2');
      expect(slots[17]?.getAttribute('aria-colindex')).toBe('2');
    });

    it('sets roving tabIndex to selected tile when selectedTileIndex is provided', () => {
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 10,
      });

      const mockWs = workspace as unknown as MockElement;
      const slot0 = mockWs.querySelector('[data-physical-index="0"]');
      const slot10 = mockWs.querySelector('[data-physical-index="10"]');

      expect(slot0?.tabIndex).toBe(-1);
      expect(slot10?.tabIndex).toBe(0);
      expect(slot10?.getAttribute('aria-selected')).toBe('true');
      expect(slot10?.focus).toHaveBeenCalled();
      expect(slot10?.scrollIntoView).toHaveBeenCalled();
    });

    it('handles keyboard navigation across rows and columns via Arrow keys', () => {
      const onSelectTile = vi.fn();
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: null,
        onSelectTile,
      });

      const mockWs = workspace as unknown as MockElement;
      const slot0 = mockWs.querySelector('[data-local-index="0"]');
      const slot1 = mockWs.querySelector('[data-local-index="1"]');
      const slot16 = mockWs.querySelector('[data-local-index="16"]');
      const slot255 = mockWs.querySelector('[data-local-index="255"]');

      expect(slot0?.tabIndex).toBe(0);

      // ArrowRight from slot 0 moves to slot 1
      const preventDefault = vi.fn();
      slot0?.dispatchEvent({
        type: 'keydown',
        key: 'ArrowRight',
        preventDefault,
      });
      expect(preventDefault).toHaveBeenCalled();
      expect(slot0?.tabIndex).toBe(-1);
      expect(slot1?.tabIndex).toBe(0);
      expect(slot1?.focus).toHaveBeenCalled();

      // ArrowDown from slot 0 moves to slot 16
      slot0?.dispatchEvent({
        type: 'keydown',
        key: 'ArrowDown',
        preventDefault,
      });
      expect(slot16?.tabIndex).toBe(0);
      expect(slot16?.focus).toHaveBeenCalled();

      // ArrowLeft from slot 0 wraps to slot 255
      slot0?.dispatchEvent({
        type: 'keydown',
        key: 'ArrowLeft',
        preventDefault,
      });
      expect(slot255?.tabIndex).toBe(0);
      expect(slot255?.focus).toHaveBeenCalled();
    });

    it('handles Home, End, PageUp, PageDown, Enter, Space, and Escape keys', () => {
      const onSelectTile = vi.fn();
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: null,
        onSelectTile,
      });

      const mockWs = workspace as unknown as MockElement;
      const slot20 = mockWs.querySelector('[data-local-index="20"]'); // Row 1, Col 4
      const slot16 = mockWs.querySelector('[data-local-index="16"]'); // Row 1, Col 0
      const slot31 = mockWs.querySelector('[data-local-index="31"]'); // Row 1, Col 15
      const slot4 = mockWs.querySelector('[data-local-index="4"]'); // Row 0, Col 4
      const slot244 = mockWs.querySelector('[data-local-index="244"]'); // Row 15, Col 4

      const preventDefault = vi.fn();

      // Home moves to start of row (slot 16)
      slot20?.dispatchEvent({
        type: 'keydown',
        key: 'Home',
        ctrlKey: false,
        preventDefault,
      });
      expect(slot16?.tabIndex).toBe(0);
      expect(slot16?.focus).toHaveBeenCalled();

      // End moves to end of row (slot 31)
      slot20?.dispatchEvent({
        type: 'keydown',
        key: 'End',
        ctrlKey: false,
        preventDefault,
      });
      expect(slot31?.tabIndex).toBe(0);
      expect(slot31?.focus).toHaveBeenCalled();

      // PageUp moves to top of column (slot 4)
      slot20?.dispatchEvent({
        type: 'keydown',
        key: 'PageUp',
        preventDefault,
      });
      expect(slot4?.tabIndex).toBe(0);
      expect(slot4?.focus).toHaveBeenCalled();

      // PageDown moves to bottom of column (slot 244)
      slot20?.dispatchEvent({
        type: 'keydown',
        key: 'PageDown',
        preventDefault,
      });
      expect(slot244?.tabIndex).toBe(0);
      expect(slot244?.focus).toHaveBeenCalled();

      // Enter selects tile
      slot20?.dispatchEvent({
        type: 'keydown',
        key: 'Enter',
        preventDefault,
      });
      expect(onSelectTile).toHaveBeenCalledWith(20);

      // Escape deselects
      slot20?.dispatchEvent({
        type: 'keydown',
        key: 'Escape',
        preventDefault,
      });
      expect(onSelectTile).toHaveBeenCalledWith(null);
    });

    it('updates roving tabIndex when clicking on a slot', () => {
      const onSelectTile = vi.fn();
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: null,
        onSelectTile,
      });

      const mockWs = workspace as unknown as MockElement;
      const slot0 = mockWs.querySelector('[data-local-index="0"]');
      const slot45 = mockWs.querySelector('[data-local-index="45"]');

      expect(slot0?.tabIndex).toBe(0);
      expect(slot45?.tabIndex).toBe(-1);

      slot45?.click();
      expect(slot45?.tabIndex).toBe(0);
      expect(slot0?.tabIndex).toBe(-1);
      expect(onSelectTile).toHaveBeenCalledWith(45);
    });

    it('groups toolbar controls into semantic viewGroup and contextGroup with zoom data attribute', () => {
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        zoom: 4,
      });

      const mockWs = workspace as unknown as MockElement;
      const viewGroup = mockWs.querySelector(
        '.chr-toolbar-group.is-view-group',
      );
      expect(viewGroup).not.toBeNull();
      expect(viewGroup?.getAttribute('role')).toBe('group');
      expect(viewGroup?.querySelector('.chr-zoom-controls')).not.toBeNull();
      expect(viewGroup?.querySelector('.chr-palette-controls')).not.toBeNull();
      expect(viewGroup?.querySelector('.chr-heatmap-controls')).not.toBeNull();

      const contextGroup = mockWs.querySelector(
        '.chr-toolbar-group.is-context-group',
      );
      expect(contextGroup).not.toBeNull();
      expect(contextGroup?.getAttribute('role')).toBe('group');
      expect(
        contextGroup?.querySelector('.chr-highlight-controls'),
      ).not.toBeNull();
      expect(
        contextGroup?.querySelector('.chr-occupancy-legend'),
      ).not.toBeNull();

      const canvasContainer = mockWs.querySelector('.chr-pt-canvas-container');
      expect(canvasContainer?.getAttribute('data-zoom')).toBe('4');
    });

    it('forwards onTilePixelsChange to the embedded tile inspector', () => {
      const onTilePixelsChange = vi.fn();
      const testPixels = new Uint8Array(64);
      testPixels[0] = 3;
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [{ id: 0, column: 0, row: 0, pixels: testPixels }],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 0,
        onTilePixelsChange,
      });

      const mockWs = workspace as unknown as MockElement;
      const rotateBtn = mockWs.querySelector(
        '.chr-editor-action-btn[data-action="rotate-cw"]',
      );
      expect(rotateBtn).not.toBeNull();
      rotateBtn?.click();

      expect(onTilePixelsChange).toHaveBeenCalledTimes(1);
      expect(onTilePixelsChange).toHaveBeenCalledWith(
        0,
        expect.any(Uint8Array),
      );
    });

    it('projects controlled CHR Editor UI state and reports state changes', () => {
      const onEditorStateChange = vi.fn();
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 0,
        editorState: {
          activeTool: 'eraser',
          selectedColorIndex: 3,
          showGrid: false,
          shiftWrap: true,
        },
        onEditorStateChange,
      });

      const mockWs = workspace as unknown as MockElement;
      expect(
        mockWs
          .querySelector('.chr-editor-tool-btn[data-tool="eraser"]')
          ?.getAttribute('aria-pressed'),
      ).toBe('true');
      expect(
        mockWs
          .querySelector('.chr-editor-color-btn[data-color-index="3"]')
          ?.getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        mockWs
          .querySelector('.chr-editor-grid-btn')
          ?.getAttribute('aria-pressed'),
      ).toBe('false');
      expect(
        mockWs
          .querySelector('.chr-editor-wrap-btn')
          ?.getAttribute('aria-pressed'),
      ).toBe('true');

      mockWs.querySelector('.chr-editor-grid-btn')?.click();
      expect(onEditorStateChange).toHaveBeenCalledWith({
        activeTool: 'eraser',
        selectedColorIndex: 3,
        showGrid: true,
        shiftWrap: true,
      });
    });

    it('preserves history instance across workspace re-renders and allows Undo/Redo to update project via onTilePixelsChange', () => {
      const onTilePixelsChange = vi.fn();
      const initialPixels = new Uint8Array(64);
      initialPixels[0] = 3;
      const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);

      // Initial render of workspace
      const ws1 = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [{ id: 0, column: 0, row: 0, pixels: initialPixels }],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 0,
        history,
        onTilePixelsChange,
      });

      const mockWs1 = ws1 as unknown as MockElement;
      const rotateBtn = mockWs1.querySelector(
        '.chr-editor-action-btn[data-action="rotate-cw"]',
      );
      expect(rotateBtn).not.toBeNull();
      rotateBtn?.click();

      expect(onTilePixelsChange).toHaveBeenCalledTimes(1);
      const editedPixels = onTilePixelsChange.mock.calls[0]?.[1] as Uint8Array;
      expect(history.canUndo).toBe(true);

      // Workspace re-render (e.g. after project update) with the SAME history instance
      const ws2 = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [{ id: 0, column: 0, row: 0, pixels: editedPixels }],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 0,
        history,
        onTilePixelsChange,
      });

      const mockWs2 = ws2 as unknown as MockElement;
      const undoBtn = mockWs2.querySelector(
        '.chr-editor-action-btn[data-action="undo"]',
      );
      expect(undoBtn).not.toBeNull();
      expect(undoBtn?.attributes.get('aria-disabled')).toBe('false');

      // Click Undo
      undoBtn?.click();
      expect(onTilePixelsChange).toHaveBeenCalledTimes(2);
      const undonePixels = onTilePixelsChange.mock.calls[1]?.[1] as Uint8Array;
      expect(areTilePixelsEqual(undonePixels, initialPixels)).toBe(true);
      expect(history.canRedo).toBe(true);

      // Workspace re-render after Undo with the SAME history instance
      const ws3 = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [{ id: 0, column: 0, row: 0, pixels: undonePixels }],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 0,
        history,
        onTilePixelsChange,
      });

      const mockWs3 = ws3 as unknown as MockElement;
      const redoBtn = mockWs3.querySelector(
        '.chr-editor-action-btn[data-action="redo"]',
      );
      expect(redoBtn).not.toBeNull();
      expect(redoBtn?.attributes.get('aria-disabled')).toBe('false');

      // Click Redo
      redoBtn?.click();
      expect(onTilePixelsChange).toHaveBeenCalledTimes(3);
      const redonePixels = onTilePixelsChange.mock.calls[2]?.[1] as Uint8Array;
      expect(areTilePixelsEqual(redonePixels, editedPixels)).toBe(true);
    });

    it('isolates history when switching between different selected tile indices', () => {
      const pixels0 = new Uint8Array(64);
      pixels0[0] = 1;
      const pixels1 = new Uint8Array(64);
      pixels1[0] = 2;

      const history0 = createTileHistory(pixels0, 50, areTilePixelsEqual);
      const history1 = createTileHistory(pixels1, 50, areTilePixelsEqual);

      // Edit tile 0
      const ws0 = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [
          { id: 0, column: 0, row: 0, pixels: pixels0 },
          { id: 1, column: 1, row: 0, pixels: pixels1 },
        ],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 0,
        history: history0,
      });
      const mockWs0 = ws0 as unknown as MockElement;
      const rotate0 = mockWs0.querySelector(
        '.chr-editor-action-btn[data-action="rotate-cw"]',
      );
      rotate0?.click();
      expect(history0.canUndo).toBe(true);

      // Select tile 1 (with isolated history1)
      const ws1 = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [
          { id: 0, column: 0, row: 0, pixels: pixels0 },
          { id: 1, column: 1, row: 0, pixels: pixels1 },
        ],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 1,
        history: history1,
      });
      const mockWs1 = ws1 as unknown as MockElement;
      const undo1 = mockWs1.querySelector(
        '.chr-editor-action-btn[data-action="undo"]',
      );
      expect(undo1?.attributes.get('aria-disabled')).toBe('true');
      expect(history1.canUndo).toBe(false);
    });

    it('handles full continuous Pencil stroke without intermediate host re-renders and commits atomically on pointerup', () => {
      let currentTilePixels: Uint8Array = new Uint8Array(64);
      const history = createTileHistory(
        currentTilePixels,
        50,
        areTilePixelsEqual,
      );

      let canonicalCommits = 0;
      let activeWorkspaceMock: MockElement | null = null;

      const renderHostWorkspace = (): void => {
        const ws = createChrWorkspace({
          mode: 'tileset',
          animationModel: null,
          baseChr: null,
          baseChrName: null,
          patternTable: 0,
          destinationPatternTable: 0,
          tiles: [{ id: 0, column: 0, row: 0, pixels: currentTilePixels }],
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          selectedTileIndex: 0,
          history,
          onTilePixelsChange: (_physicalIndex, newPixels) => {
            canonicalCommits += 1;
            currentTilePixels = newPixels;
            // Simulate host global render on canonical update
            renderHostWorkspace();
          },
        });
        activeWorkspaceMock = ws as unknown as MockElement;
      };

      // 1. Initial Host Render
      renderHostWorkspace();
      const initialWs = activeWorkspaceMock as MockElement | null;
      expect(initialWs).not.toBeNull();
      const initialCanvas = initialWs?.querySelector('.chr-tile-editor-canvas');
      expect(initialCanvas).not.toBeNull();

      // 2. Start Pencil Drag (pointerdown)
      initialCanvas?.dispatchEvent({
        type: 'pointerdown',
        button: 0,
        clientX: 37,
        clientY: 37,
        pointerId: 1,
      });

      // No canonical commit yet -> editor/canvas has NOT been destroyed
      expect(canonicalCommits).toBe(0);

      // 3. Continuous Drag (pointermove over 5 pixels)
      for (let x = 2; x <= 6; x += 1) {
        initialCanvas?.dispatchEvent({
          type: 'pointermove',
          clientX: x * 32 + 5,
          clientY: 37,
          pointerId: 1,
        });
        expect(canonicalCommits).toBe(0);
      }

      // 4. Release Pointer (pointerup)
      initialCanvas?.dispatchEvent({
        type: 'pointerup',
        pointerId: 1,
      });

      // Exactly 1 canonical commit occurred upon stroke completion!
      expect(canonicalCommits).toBe(1);
      expect(history.depth).toBe(1);
      expect(history.canUndo).toBe(true);

      // 5. Host re-rendered after commit -> Undo button is now active
      const postCommitWs = activeWorkspaceMock as MockElement | null;
      const undoBtn = postCommitWs?.querySelector(
        '.chr-editor-action-btn[data-action="undo"]',
      );
      expect(undoBtn).not.toBeNull();
      expect(undoBtn?.attributes.get('aria-disabled')).toBe('false');

      // 6. Execute Undo
      undoBtn?.click();
      expect(canonicalCommits).toBe(2);
      expect(currentTilePixels.every((p) => p === 0)).toBe(true);
      expect(history.canRedo).toBe(true);

      // 7. Execute Redo
      const postUndoWs = activeWorkspaceMock as MockElement | null;
      const redoBtn = postUndoWs?.querySelector(
        '.chr-editor-action-btn[data-action="redo"]',
      );
      expect(redoBtn).not.toBeNull();
      expect(redoBtn?.attributes.get('aria-disabled')).toBe('false');
      redoBtn?.click();
      expect(canonicalCommits).toBe(3);
      expect(currentTilePixels[1 * 8 + 1]).toBe(1);
    });

    it('handles single click Pencil stroke in real host lifecycle with 1 commit and enabled Undo', () => {
      let currentTilePixels: Uint8Array = new Uint8Array(64);
      const history = createTileHistory(
        currentTilePixels,
        50,
        areTilePixelsEqual,
      );

      let canonicalCommits = 0;
      let activeWorkspaceMock: MockElement | null = null;

      const renderHostWorkspace = (): void => {
        const ws = createChrWorkspace({
          mode: 'tileset',
          animationModel: null,
          baseChr: null,
          baseChrName: null,
          patternTable: 0,
          destinationPatternTable: 0,
          tiles: [{ id: 0, column: 0, row: 0, pixels: currentTilePixels }],
          deduplicationEnabled: true,
          flipDeduplicationEnabled: false,
          selectedTileIndex: 0,
          history,
          onTilePixelsChange: (_physicalIndex, newPixels) => {
            canonicalCommits += 1;
            currentTilePixels = newPixels;
            renderHostWorkspace();
          },
        });
        activeWorkspaceMock = ws as unknown as MockElement;
      };

      renderHostWorkspace();
      const wsMock = activeWorkspaceMock as MockElement | null;
      const canvas = wsMock?.querySelector('.chr-tile-editor-canvas');

      // Simple Click
      canvas?.dispatchEvent({
        type: 'pointerdown',
        button: 0,
        clientX: 50,
        clientY: 50,
        pointerId: 1,
      });
      expect(canonicalCommits).toBe(0);

      canvas?.dispatchEvent({
        type: 'pointerup',
        pointerId: 1,
      });

      expect(canonicalCommits).toBe(1);
      expect(history.canUndo).toBe(true);
      expect(currentTilePixels[1 * 8 + 1]).toBe(1);
    });
  });

  describe('CHR regions and reservations visualization', () => {
    it('decorates slots in PT0 and PT1 with region classes, data attributes, and custom colors', () => {
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        chrRegions: [
          {
            id: 'reg-player',
            name: 'Player Sprites',
            patternTable: 0,
            startTile: 0,
            endTile: 15,
            kind: 'region',
            color: '#38bdf8',
          },
          {
            id: 'res-runtime',
            name: 'Runtime FX',
            patternTable: 0,
            startTile: 10,
            endTile: 20,
            kind: 'reservation',
          },
          {
            id: 'reg-bg',
            name: 'Background Forest',
            patternTable: 1,
            startTile: 0,
            endTile: 31,
            kind: 'region',
          },
        ],
      });

      const mockWs = workspace as unknown as MockElement;

      // Slot 0 in PT0 (Physical 0, Local 0): Start of Player Sprites
      const slot0 = mockWs.querySelector(
        '.chr-tile-slot[data-physical-index="0"]',
      );
      expect(slot0).not.toBeNull();
      expect(slot0?.classList.contains('in-region')).toBe(true);
      expect(slot0?.classList.contains('is-region-start')).toBe(true);
      expect(slot0?.getAttribute('data-in-region')).toBe('true');
      expect(slot0?.getAttribute('data-region-names')).toBe('Player Sprites');
      expect(slot0?.title).toContain('Region: Player Sprites');
      expect(slot0?.getAttribute('aria-label')).toContain(
        'Region: Player Sprites',
      );

      // Slot 12 in PT0 (Physical 12, Local 12): Inside both Player Sprites and Runtime FX reservation
      const slot12 = mockWs.querySelector(
        '.chr-tile-slot[data-physical-index="12"]',
      );
      expect(slot12).not.toBeNull();
      expect(slot12?.classList.contains('in-region')).toBe(true);
      expect(slot12?.classList.contains('in-reservation')).toBe(true);
      expect(slot12?.getAttribute('data-in-region')).toBe('true');
      expect(slot12?.getAttribute('data-in-reservation')).toBe('true');
      expect(slot12?.getAttribute('data-region-names')).toBe('Player Sprites');
      expect(slot12?.getAttribute('data-reservation-names')).toBe('Runtime FX');
      expect(slot12?.title).toContain('Region: Player Sprites');
      expect(slot12?.title).toContain('Reservation: Runtime FX');
      expect(slot12?.getAttribute('aria-label')).toContain(
        'Region: Player Sprites',
      );
      expect(slot12?.getAttribute('aria-label')).toContain(
        'Reservation: Runtime FX',
      );

      // Slot 15 in PT0 (Physical 15, Local 15): End of Player Sprites
      const slot15 = mockWs.querySelector(
        '.chr-tile-slot[data-physical-index="15"]',
      );
      expect(slot15?.classList.contains('is-region-end')).toBe(true);

      // Slot 256 in PT1 (Physical 256, Local 0): Start of Background Forest on PT1
      const slot256 = mockWs.querySelector(
        '.chr-tile-slot[data-physical-index="256"]',
      );
      expect(slot256).not.toBeNull();
      expect(slot256?.classList.contains('in-region')).toBe(true);
      expect(slot256?.classList.contains('is-region-start')).toBe(true);
      expect(slot256?.getAttribute('data-region-names')).toBe(
        'Background Forest',
      );
    });

    it('classifies empty slots inside reservation as reserved while preserving occupied base tiles', () => {
      const baseChr = new Uint8Array(4096);
      baseChr[10 * 16] = 0x55; // Base tile at slot 10

      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr,
        baseChrName: 'base.chr',
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        chrRegions: [
          {
            id: 'res-runtime',
            name: 'Runtime FX',
            patternTable: 0,
            startTile: 10,
            endTile: 20,
            kind: 'reservation',
          },
        ],
      });

      const mockWs = workspace as unknown as MockElement;

      // Slot 10 is occupied by Base CHR: occupancy remains 'base', in-reservation is true
      const slot10 = mockWs.querySelector(
        '.chr-tile-slot[data-physical-index="10"]',
      );
      expect(slot10?.getAttribute('data-occupancy')).toBe('base');
      expect(slot10?.classList.contains('is-occupancy-base')).toBe(true);
      expect(slot10?.classList.contains('in-reservation')).toBe(true);

      // Slot 11 is empty within reservation: occupancy is 'reserved', in-reservation is true
      const slot11 = mockWs.querySelector(
        '.chr-tile-slot[data-physical-index="11"]',
      );
      expect(slot11?.getAttribute('data-occupancy')).toBe('reserved');
      expect(slot11?.classList.contains('is-occupancy-reserved')).toBe(true);
      expect(slot11?.classList.contains('in-reservation')).toBe(true);

      // Slot 0 is empty outside reservation: occupancy is 'empty', in-reservation is false
      const slot0 = mockWs.querySelector(
        '.chr-tile-slot[data-physical-index="0"]',
      );
      expect(slot0?.getAttribute('data-occupancy')).toBe('empty');
      expect(slot0?.classList.contains('is-occupancy-empty')).toBe(true);
      expect(slot0?.classList.contains('in-reservation')).toBe(false);
    });

    it('does not add extra tab stops or break keyboard navigation with region overlays', () => {
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 5,
        chrRegions: [
          {
            id: 'reg-1',
            name: 'Region 1',
            patternTable: 0,
            startTile: 0,
            endTile: 10,
            kind: 'region',
          },
        ],
      });

      const mockWs = workspace as unknown as MockElement;
      const pt0Overlay = mockWs.querySelector(
        '.chr-pt-view-card[data-pattern-table="0"] .chr-pt-grid-overlay',
      );
      const allSlots = pt0Overlay?.querySelectorAll('.chr-tile-slot') ?? [];
      expect(allSlots.length).toBe(256);

      const tabStops = Array.from(allSlots).filter((s) => s.tabIndex === 0);
      expect(tabStops.length).toBe(1);
      expect(tabStops[0]?.getAttribute('data-local-index')).toBe('5');
    });

    it('mounts Region Manager panel in CHR workspace and forwards onUpdateChrRegions callback', () => {
      const onUpdateChrRegions = vi.fn();
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        chrRegions: [
          {
            id: 'reg-hero',
            name: 'Hero',
            patternTable: 0,
            startTile: 0,
            endTile: 15,
            kind: 'region',
          },
        ],
        onUpdateChrRegions,
      });

      const mockWs = workspace as unknown as MockElement;
      const section = mockWs.querySelector('#section-chr-regions');
      expect(section).not.toBeNull();
      expect(
        section?.querySelector('.chr-region-manager-title')?.textContent,
      ).toBe('CHR Regions & Reservations');
      expect(
        section?.querySelector('.chr-region-count-badge')?.textContent,
      ).toBe('1 configured');
      expect(section?.textContent).toContain('Hero');
    });

    it('immediately reflects reserved slots in pattern table grid when reservations are present', () => {
      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        chrRegions: [
          {
            id: 'res-runtime',
            name: 'Runtime FX',
            patternTable: 0,
            startTile: 0x20,
            endTile: 0x2f,
            kind: 'reservation',
          },
        ],
      });

      const mockWs = workspace as unknown as MockElement;
      const pt0Overlay = mockWs.querySelector(
        '.chr-pt-view-card[data-pattern-table="0"] .chr-pt-grid-overlay',
      );

      // Slot $20 should have is-occupancy-reserved and in-reservation
      const slot20 = pt0Overlay?.querySelector(
        '.chr-tile-slot[data-local-index="32"]',
      );
      expect(slot20?.classList.contains('is-occupancy-reserved')).toBe(true);
      expect(slot20?.classList.contains('in-reservation')).toBe(true);

      // Slot $00 should be normal empty
      const slot00 = pt0Overlay?.querySelector(
        '.chr-tile-slot[data-local-index="0"]',
      );
      expect(slot00?.classList.contains('is-occupancy-reserved')).toBe(false);
      expect(slot00?.classList.contains('is-occupancy-empty')).toBe(true);
    });
  });

  describe('Tile Ownership & Asset Mapping in CHR Workspace (Milestone 6)', () => {
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

    it('renders Asset Highlight dropdown in toolbar and invokes onHighlightAssetIdChange', () => {
      const onHighlightAssetIdChange = vi.fn();

      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 0,
          origin: {
            primaryAssetId: 'asset-hero',
            primaryAssetName: 'Hero Sheet',
            creationKind: 'extracted',
          },
          usages: [],
          usageCount: 1,
          isShared: false,
        },
        {
          physicalIndex: 1,
          origin: {
            primaryAssetId: 'asset-enemy',
            primaryAssetName: 'Enemy Sheet',
            creationKind: 'extracted',
          },
          usages: [],
          usageCount: 1,
          isShared: false,
        },
      ]);

      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        chrAssetMappingIndex: mockMappingIndex,
        highlightedAssetId: null,
        onHighlightAssetIdChange,
      });

      const mockWs = workspace as unknown as MockElement;
      const assetSelect = mockWs.querySelector('.chr-highlight-asset-select');
      expect(assetSelect).not.toBeNull();

      const optionsList = assetSelect?.querySelectorAll('option') ?? [];
      expect(optionsList.length).toBe(3); // None + Hero + Enemy
      expect(optionsList[1]?.textContent).toContain('Hero Sheet (1)');
      expect(optionsList[2]?.textContent).toContain('Enemy Sheet (1)');

      if (assetSelect) {
        assetSelect.value = 'asset-hero';
      }
      assetSelect?.eventListeners.get('change')?.forEach((fn) => {
        fn();
      });
      expect(onHighlightAssetIdChange).toHaveBeenCalledWith('asset-hero');
    });

    it('highlights tiles associated with the asset across PT0/PT1 and dims other tiles', () => {
      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 10,
          origin: {
            primaryAssetId: 'asset-hero',
            primaryAssetName: 'Hero Sheet',
            creationKind: 'extracted',
          },
          usages: [],
          usageCount: 1,
          isShared: false,
        },
        {
          physicalIndex: 260,
          origin: {
            primaryAssetId: 'asset-hero',
            primaryAssetName: 'Hero Sheet',
            creationKind: 'extracted',
          },
          usages: [],
          usageCount: 1,
          isShared: false,
        },
      ]);

      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        chrAssetMappingIndex: mockMappingIndex,
        highlightedAssetId: 'asset-hero',
      });

      const mockWs = workspace as unknown as MockElement;
      const slot10 = mockWs.querySelector(
        '.chr-tile-slot[data-physical-index="10"]',
      );
      const slot260 = mockWs.querySelector(
        '.chr-tile-slot[data-physical-index="260"]',
      );
      const slot5 = mockWs.querySelector(
        '.chr-tile-slot[data-physical-index="5"]',
      );

      expect(slot10?.classList.contains('is-highlighted')).toBe(true);
      expect(slot10?.getAttribute('data-highlighted')).toBe('true');

      expect(slot260?.classList.contains('is-highlighted')).toBe(true);
      expect(slot260?.getAttribute('data-highlighted')).toBe('true');

      expect(slot5?.classList.contains('is-highlighted')).toBe(false);
      expect(slot5?.classList.contains('is-dimmed')).toBe(true);
    });

    it('triggers onNavigateToAnimation when Jump to Frame button in inspector is clicked', () => {
      const onNavigateToAnimation = vi.fn();

      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 4,
          origin: {
            primaryAssetId: 'asset-player',
            primaryAssetName: 'Player',
            creationKind: 'extracted',
          },
          usages: [
            {
              type: 'animation',
              assetId: 'asset-player',
              animationId: 'anim-attack',
              animationName: 'attack',
              frameIndex: 1,
              spriteIndex: 0,
              x: 0,
              y: 0,
              horizontalFlip: false,
              verticalFlip: false,
              physicalTileIndex: 4,
            },
          ],
          usageCount: 1,
          isShared: false,
        },
      ]);

      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        selectedTileIndex: 4,
        chrAssetMappingIndex: mockMappingIndex,
        onNavigateToAnimation,
      });

      const mockWs = workspace as unknown as MockElement;
      const jumpBtn = mockWs.querySelector('.chr-tile-ref-jump-btn');
      expect(jumpBtn).not.toBeNull();

      jumpBtn?.click();
      expect(onNavigateToAnimation).toHaveBeenCalledWith('anim-attack', 1);
    });

    it('renders Asset CHR Usage & Metrics panel with per-asset cards and chips', () => {
      const onHighlightAssetIdChange = vi.fn();

      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 0,
          origin: {
            primaryAssetId: 'asset-hero',
            primaryAssetName: 'Hero Sheet',
            creationKind: 'extracted',
          },
          usages: [
            {
              type: 'animation',
              assetId: 'asset-hero',
              animationId: 'idle',
              frameIndex: 0,
              spriteIndex: 0,
              x: 0,
              y: 0,
              horizontalFlip: false,
              verticalFlip: false,
              physicalTileIndex: 0,
            },
          ],
          usageCount: 1,
          isShared: false,
        },
        {
          physicalIndex: 260, // PT1
          origin: {
            primaryAssetId: 'asset-hero',
            primaryAssetName: 'Hero Sheet',
            creationKind: 'extracted',
          },
          usages: [],
          usageCount: 0,
          isShared: false,
        },
      ]);

      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        chrAssetMappingIndex: mockMappingIndex,
        onHighlightAssetIdChange,
      });

      const mockWs = workspace as unknown as MockElement;
      const metricsPanel = mockWs.querySelector('#section-chr-asset-metrics');
      expect(metricsPanel).not.toBeNull();

      const cards =
        metricsPanel?.querySelectorAll('.chr-asset-metric-card') ?? [];
      expect(cards.length).toBe(1);

      const nameEl = cards[0]?.querySelector('.chr-asset-metric-name');
      expect(nameEl?.textContent).toBe('Hero Sheet');

      const chips = cards[0]?.querySelectorAll('.chr-metric-chip') ?? [];
      const chipTexts = chips.map((c) => c.textContent);
      expect(chipTexts).toContain('2 unique slots');
      expect(chipTexts).toContain('2 owned');
      expect(chipTexts).toContain('PT0: 1 · PT1: 1');

      // Click highlight button on asset card
      const highlightBtn = cards[0]?.querySelector('.chr-asset-highlight-btn');
      expect(highlightBtn).not.toBeNull();
      highlightBtn?.click();
      expect(onHighlightAssetIdChange).toHaveBeenCalledWith('asset-hero');
    });

    it('renders ownership diagnostics with action buttons to inspect affected slot', () => {
      const onSelectTile = vi.fn();

      // Slot 12 is a canonical orphan (extracted, 0 usages)
      const mockMappingIndex = buildTestMappingIndex([
        {
          physicalIndex: 12,
          origin: {
            primaryAssetId: 'asset-orphan',
            primaryAssetName: 'Orphan Sheet',
            creationKind: 'extracted',
          },
          usages: [],
          usageCount: 0,
          isShared: false,
        },
      ]);

      const workspace = createChrWorkspace({
        mode: 'tileset',
        animationModel: null,
        baseChr: null,
        baseChrName: null,
        patternTable: 0,
        destinationPatternTable: 0,
        tiles: [],
        deduplicationEnabled: true,
        flipDeduplicationEnabled: false,
        chrAssetMappingIndex: mockMappingIndex,
        onSelectTile,
      });

      const mockWs = workspace as unknown as MockElement;
      const diagItems = mockWs.querySelectorAll('.chr-ownership-diag-item');
      expect(diagItems.length).toBeGreaterThanOrEqual(1);

      const orphanItem = diagItems[0];
      expect(orphanItem?.textContent).toContain('PT0:$0C');

      const inspectBtn = orphanItem?.querySelector('.chr-diag-action-btn');
      expect(inspectBtn).not.toBeNull();
      inspectBtn?.click();
      expect(onSelectTile).toHaveBeenCalledWith(12);
    });
  });
});
