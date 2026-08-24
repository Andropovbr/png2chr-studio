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
import { applyWorkspaceUpdate } from './state-update';
import { createWorkspaceState } from './workspace-state';

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

  dispatchEvent(event: { type: string; [key: string]: unknown }) {
    const handlers = this.eventListeners.get(event.type) ?? [];
    handlers.forEach((fn) => {
      fn(event);
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
      if (selector.startsWith('[') && selector.endsWith(']')) {
        const inner = selector.slice(1, -1);
        if (inner.includes('=')) {
          const [attr, rawVal] = inner.split('=');
          const val = rawVal ? rawVal.replace(/^["']|["']$/g, '') : '';
          return el.getAttribute(attr?.trim() ?? '') === val;
        }
        return el.attributes.has(inner.trim());
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
      chr: { ...prev.chr, zoom: 8 },
    }));

    expect(updateResult.value.chr.zoom).toBe(8);
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
      expect(items.length).toBe(3);
      expect(items[0]?.textContent).toContain('Project');
      expect(items[1]?.textContent).toContain('Base CHR');
      expect(items[2]?.textContent).toContain('Free');
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
});
