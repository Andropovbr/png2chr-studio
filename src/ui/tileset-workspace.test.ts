import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultNesPaletteSet,
  encodeNesBackgroundPalettes,
} from '../core/nes-palette';
import type { IndexedImage, Tile } from '../core/types';
import {
  createTilesetWorkspace,
  type TilesetWorkspaceOptions,
} from './tileset-workspace';
import { createAppShell } from './app-shell';
import { createSidebar } from './sidebar';

class MockElement {
  tagName: string;
  className = '';
  id = '';
  children: MockElement[] = [];
  attributes = new Map<string, string>();
  eventListeners = new Map<string, ((e?: unknown) => void)[]>();
  _text = '';
  title = '';
  type = '';
  value = '';
  checked = false;
  disabled = false;
  min = '';
  max = '';
  step = '';
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

  get href() {
    return this.attributes.get('href') ?? '';
  }
  set href(val: string) {
    this.attributes.set('href', val);
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
      toggle: (cls: string, force?: boolean) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        const has = classes.has(cls);
        const shouldAdd = force ?? !has;
        if (shouldAdd) {
          classes.add(cls);
        } else {
          classes.delete(cls);
        }
        this.className = Array.from(classes).join(' ');
        return shouldAdd;
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

  contains(element: MockElement): boolean {
    if (this === element) return true;
    return this.children.some((child) => child.contains(element));
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const tokens = selector.trim().split(/\s+/);
    if (tokens.length > 1) {
      let current: MockElement[] = [this];
      for (const token of tokens) {
        const next: MockElement[] = [];
        for (const el of current) {
          next.push(...el.querySelectorAll(token));
        }
        current = next;
      }
      return current;
    }

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

  getContext(type: string) {
    if (type === '2d') {
      const noop = (): void => {
        // no-op
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
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
      };
    }
    return null;
  }
}

function createSampleTile(patternValue: number): Tile {
  const pixels = new Uint8Array(64);
  pixels.fill(patternValue);
  return {
    id: 0,
    row: 0,
    column: 0,
    pixels,
  };
}

function createSampleIndexedImage(width = 16, height = 8): IndexedImage {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = i < 64 ? 0 : 1;
  }
  return {
    width,
    height,
    pixels,
    colors: [
      { red: 0x7c, green: 0x7c, blue: 0x7c },
      { red: 0x00, green: 0x00, blue: 0xfc },
      { red: 0x00, green: 0x00, blue: 0xbc },
      { red: 0x44, green: 0x28, blue: 0xbc },
    ],
    transparentIndex: null,
    colorCount: 4,
  };
}

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight: number,
    height?: number,
  ) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? 0;
    }
  }
}

describe('TilesetWorkspace composition and byte-compatibility', () => {
  beforeEach(() => {
    (
      globalThis as unknown as { document: unknown; ImageData: unknown }
    ).document = {
      createElement: (tagName: string) => new MockElement(tagName),
    };
    (globalThis as unknown as { ImageData: unknown }).ImageData = MockImageData;
  });

  const basePaletteSet = createDefaultNesPaletteSet();

  function defaultOptions(
    overrides: Partial<TilesetWorkspaceOptions> = {},
  ): TilesetWorkspaceOptions {
    const indexedImage = createSampleIndexedImage();
    const tiles: Tile[] = [createSampleTile(1), createSampleTile(2)];
    return {
      fileName: 'test_tileset.png',
      sourceKind: 'png',
      width: indexedImage.width,
      height: indexedImage.height,
      sourceImage: null,
      indexedImage,
      tiles,
      deduplicationEnabled: false,
      flipDeduplicationEnabled: false,
      paletteSet: basePaletteSet,
      paletteAssignments: new Uint8Array([0, 0]),
      pixelOverrides: new Uint8Array(indexedImage.pixels.length),
      activePaletteIndex: 0,
      activeColorIndex: 1,
      quantizationSettings: {
        quantizationMode: 'median-cut',
        ditheringMode: 'none',
        colorDistanceMode: 'perceptual',
      },
      quantizationPreviews: [],
      quantizationPreviewsLoading: false,
      quantizationCollapsed: false,
      showPaletteNumbers: false,
      previewTool: 'palette',
      zoomedPaletteRegion: null,
      paletteColorTarget: { paletteIndex: 0, colorIndex: 1 },
      loading: false,
      error: null,
      onModeChange: vi.fn(),
      onFile: vi.fn(),
      onToggleQuantizationCollapse: vi.fn(),
      onQuantizationSettingsChange: vi.fn(),
      onActiveToolChange: vi.fn(),
      onPaletteRegionSelect: vi.fn(),
      onActivePaletteChange: vi.fn(),
      onActiveColorChange: vi.fn(),
      onShowPaletteNumbersChange: vi.fn(),
      onZoomedRegionChange: vi.fn(),
      onColorTargetChange: vi.fn(),
      onPaletteColorChange: vi.fn(),
      onPixelOverridesChange: vi.fn(),
      onDeduplicationChange: vi.fn(),
      onFlipDeduplicationChange: vi.fn(),
      onDownloadBytes: vi.fn(),
      ...overrides,
    };
  }

  it('composes all required panels and section anchors', () => {
    const options = defaultOptions();
    const workspace = createTilesetWorkspace(options);

    expect(workspace.classList.contains('workspace')).toBe(true);

    const mockRoot = workspace as unknown as MockElement;
    expect(mockRoot.querySelector('#section-image')).not.toBeNull();
    expect(mockRoot.querySelector('#section-quantization')).not.toBeNull();
    expect(
      mockRoot.querySelector('.playfield-editing-workspace'),
    ).not.toBeNull();
    expect(mockRoot.querySelector('#section-palettes')).not.toBeNull();
    expect(mockRoot.querySelector('.diagnostics-panel')).not.toBeNull();
    expect(mockRoot.querySelector('#section-tiles')).not.toBeNull();
    expect(mockRoot.querySelector('#section-export')).not.toBeNull();
  });

  it('attaches host diagnostics element with correct metrics', () => {
    const options = defaultOptions();
    const workspace = createTilesetWorkspace(options);

    expect(workspace.diagnosticsElement).toBeDefined();
    const mockDiag = workspace.diagnosticsElement as unknown as MockElement;
    expect(mockDiag.classList.contains('diagnostics-panel')).toBe(true);

    const text = mockDiag.textContent;
    expect(text).toContain('16 × 8');
  });

  it('can be mounted within AppShell seamlessly', () => {
    const options = defaultOptions();
    const workspace = createTilesetWorkspace(options);
    const sidebar = createSidebar({
      activeWorkspace: 'tileset',
      fileName: options.fileName,
    });
    const header = document.createElement('header');

    const shell = createAppShell({
      header,
      sidebar,
      workspace,
      diagnostics: workspace.diagnosticsElement,
    });

    expect(shell.workspaceHost.contains(workspace as unknown as Node)).toBe(
      true,
    );
    expect(
      shell.diagnosticsHost.contains(
        workspace.diagnosticsElement as unknown as Node,
      ),
    ).toBe(true);
  });

  it('preserves exact byte compatibility for CHR and Palette exports in tileset mode', () => {
    const onDownloadBytes = vi.fn();
    const options = defaultOptions({ onDownloadBytes });
    const workspace = createTilesetWorkspace(options);

    const mockRoot = workspace as unknown as MockElement;
    const downloadButtons = mockRoot.querySelectorAll('.export-panel button');
    expect(downloadButtons.length).toBeGreaterThan(0);

    // Trigger download buttons
    downloadButtons.forEach((btn) => {
      btn.click();
    });

    expect(onDownloadBytes).toHaveBeenCalled();

    // Verify CHR bytes match domain padChrRom(encodeChr(visibleTiles))
    const chrCall = onDownloadBytes.mock.calls.find((call) =>
      (call[1] as string).endsWith('.chr'),
    );
    expect(chrCall).toBeDefined();
    if (chrCall) {
      expect((chrCall[0] as Uint8Array).length).toBe(8192);
      expect(chrCall[1]).toBe('test_tileset.chr');
    }

    // Verify Palette bytes match encodeNesBackgroundPalettes
    const expectedPalette = encodeNesBackgroundPalettes(options.paletteSet);
    const palCall = onDownloadBytes.mock.calls.find((call) =>
      (call[1] as string).endsWith('.pal'),
    );
    expect(palCall).toBeDefined();
    if (palCall) {
      expect(palCall[0]).toEqual(expectedPalette);
      expect((palCall[0] as Uint8Array).length).toBe(16);
      expect(palCall[1]).toBe('test_tileset.pal');
    }
  });

  it('respects deduplication toggles in tileset mode', () => {
    // Two identical 8x8 tiles in 16x8 image
    const pixels = new Uint8Array(16 * 8);
    pixels.fill(1); // identical pattern
    const identicalImage: IndexedImage = {
      width: 16,
      height: 8,
      pixels,
      colors: [
        { red: 0x7c, green: 0x7c, blue: 0x7c },
        { red: 0x00, green: 0x00, blue: 0xfc },
        { red: 0x00, green: 0x00, blue: 0xbc },
        { red: 0x44, green: 0x28, blue: 0xbc },
      ],
      transparentIndex: null,
      colorCount: 2,
    };

    const options = defaultOptions({
      indexedImage: identicalImage,
      deduplicationEnabled: true,
    });

    const onDownloadBytes = vi.fn();
    const workspace = createTilesetWorkspace({ ...options, onDownloadBytes });

    const mockRoot = workspace as unknown as MockElement;
    const downloadButtons = mockRoot.querySelectorAll('.export-panel button');
    downloadButtons.forEach((btn) => {
      btn.click();
    });

    const chrCall = onDownloadBytes.mock.calls.find((call) =>
      (call[1] as string).endsWith('.chr'),
    );
    expect(chrCall).toBeDefined();
    if (chrCall) {
      expect((chrCall[0] as Uint8Array).length).toBe(8192);
    }
  });

  it('renders Inspect in CHR buttons on tile cards and invokes onInspectInChr callback', () => {
    const onInspectInChr = vi.fn();
    const options = defaultOptions({
      onInspectInChr,
    });

    const workspace = createTilesetWorkspace(options);
    const mockRoot = workspace as unknown as MockElement;

    const inspectBtn = mockRoot.querySelector('.tile-inspect-chr-btn');
    expect(inspectBtn).not.toBeNull();
    inspectBtn?.click();

    expect(onInspectInChr).toHaveBeenCalledWith(0);
  });
});
