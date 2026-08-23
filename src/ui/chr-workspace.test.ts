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
        return el.classList.contains(selector.slice(1));
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
});
