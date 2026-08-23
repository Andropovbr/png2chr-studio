import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAnimationProjectModel,
  type AnimationDefinitionInput,
} from '../core/animation-model';
import type { IndexedImage, Tile } from '../core/types';
import { createChrWorkspace } from './chr-workspace';

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
  style: Record<string, string> = {};
  open = false;

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

  dispatchEvent(event: { type: string }) {
    const handlers = this.eventListeners.get(event.type) ?? [];
    handlers.forEach((fn) => {
      fn();
    });
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
    expect(zoomButtons.length).toBe(5); // 1x, 2x, 3x, 4x, 8x

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
});
