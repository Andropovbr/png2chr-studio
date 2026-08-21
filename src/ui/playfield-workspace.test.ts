import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeChr } from '../core/chr-encoder';
import { padChrRom } from '../core/chr-rom';
import {
  COLLISION_TYPES,
  createEmptyCollisionMap,
  encodeCollisionMap,
} from '../core/collision-encoder';
import {
  createDefaultNesPaletteSet,
  encodeNesBackgroundPalettes,
  mapImageToNesPalettes,
  PLAYFIELD_PALETTE_REGION_SIZE,
} from '../core/nes-palette';
import { encodePlayfield } from '../core/playfield-encoder';
import { extractTiles } from '../core/tile-extraction';
import type { IndexedImage, Tile } from '../core/types';
import {
  createPlayfieldWorkspace,
  type PlayfieldWorkspaceOptions,
} from './playfield-workspace';
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
        font: '',
        textAlign: '',
        textBaseline: '',
        imageSmoothingEnabled: false,
      };
    }
    return null;
  }
}

function create256x240PlayfieldIndexedImage(): IndexedImage {
  const width = 256;
  const height = 240;
  const pixels = new Uint8Array(width * height);
  // Set simple pattern
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = i % 4;
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

describe('PlayfieldWorkspace composition and byte-compatibility', () => {
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
    overrides: Partial<PlayfieldWorkspaceOptions> = {},
  ): PlayfieldWorkspaceOptions {
    const indexedImage = create256x240PlayfieldIndexedImage();
    const tiles: Tile[] = extractTiles(indexedImage);
    const paletteAssignments = new Uint8Array(240); // 16x15 regions of 16x16
    const collisionCells = createEmptyCollisionMap();
    collisionCells[0] = COLLISION_TYPES.solid;

    return {
      fileName: 'world1.png',
      sourceKind: 'png',
      width: indexedImage.width,
      height: indexedImage.height,
      sourceImage: null,
      indexedImage,
      tiles,
      deduplicationEnabled: true,
      collisionCells,
      activeCollisionType: COLLISION_TYPES.solid,
      randomPlayfieldFeatures: [],
      paletteSet: basePaletteSet,
      paletteAssignments,
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
      onRandomPlayfieldFeaturesChange: vi.fn(),
      onGeneratePlayfield: vi.fn(),
      onToggleQuantizationCollapse: vi.fn(),
      onQuantizationSettingsChange: vi.fn(),
      onActiveToolChange: vi.fn(),
      onCollisionChange: vi.fn(),
      onCollisionTypeChange: vi.fn(),
      onPaletteRegionSelect: vi.fn(),
      onActivePaletteChange: vi.fn(),
      onActiveColorChange: vi.fn(),
      onShowPaletteNumbersChange: vi.fn(),
      onZoomedRegionChange: vi.fn(),
      onColorTargetChange: vi.fn(),
      onPaletteColorChange: vi.fn(),
      onPixelOverridesChange: vi.fn(),
      onDeduplicationChange: vi.fn(),
      onDownloadBytes: vi.fn(),
      ...overrides,
    };
  }

  it('composes all required playfield panels and section anchors', () => {
    const options = defaultOptions();
    const workspace = createPlayfieldWorkspace(options);

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

  it('attaches host diagnostics element with correct 256x240 metrics', () => {
    const options = defaultOptions();
    const workspace = createPlayfieldWorkspace(options);

    expect(workspace.diagnosticsElement).toBeDefined();
    const mockDiag = workspace.diagnosticsElement as unknown as MockElement;
    expect(mockDiag.classList.contains('diagnostics-panel')).toBe(true);
    expect(mockDiag.textContent).toContain('256 × 240');
  });

  it('can be mounted within AppShell seamlessly', () => {
    const options = defaultOptions();
    const workspace = createPlayfieldWorkspace(options);
    const sidebar = createSidebar({
      activeWorkspace: 'playfield',
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

  it('preserves exact byte compatibility for CHR, Nametable, Attribute Table, Collision Map, and Palette', () => {
    const onDownloadBytes = vi.fn();
    const options = defaultOptions({ onDownloadBytes });
    const workspace = createPlayfieldWorkspace(options);

    const mockRoot = workspace as unknown as MockElement;
    const downloadButtons = mockRoot.querySelectorAll('.export-panel button');
    expect(downloadButtons.length).toBeGreaterThan(0);

    // Trigger download buttons
    downloadButtons.forEach((btn) => {
      btn.click();
    });

    expect(onDownloadBytes).toHaveBeenCalled();

    // Verify playfield encoding domain output
    const sourceIndexed = options.indexedImage;
    if (sourceIndexed === null) {
      throw new Error('Expected indexed image');
    }
    const mappedImage = mapImageToNesPalettes(
      sourceIndexed,
      options.paletteSet,
      options.paletteAssignments,
      PLAYFIELD_PALETTE_REGION_SIZE,
      options.pixelOverrides,
      false,
      options.quantizationSettings.colorDistanceMode,
    );
    const mappedTiles = extractTiles(mappedImage);
    const expectedPlayfield = encodePlayfield(
      mappedImage,
      mappedTiles,
      options.deduplicationEnabled,
      options.paletteAssignments,
    );

    // 1. CHR (.chr)
    const expectedChr = padChrRom(encodeChr(expectedPlayfield.chrTiles));
    const chrCall = onDownloadBytes.mock.calls.find((call) =>
      (call[1] as string).endsWith('.chr'),
    );
    expect(chrCall).toBeDefined();
    if (chrCall) {
      expect(chrCall[0]).toEqual(expectedChr);
      const chrBytes = chrCall[0] as Uint8Array;
      expect(chrBytes.length).toBe(8192);
      expect(chrCall[1]).toBe('world1.chr');
    }

    // 2. Nametable (.nam) - 960 bytes
    const namCall = onDownloadBytes.mock.calls.find((call) =>
      (call[1] as string).endsWith('.nam'),
    );
    expect(namCall).toBeDefined();
    if (namCall) {
      expect(namCall[0]).toEqual(expectedPlayfield.nametable);
      const namBytes = namCall[0] as Uint8Array;
      expect(namBytes.length).toBe(960);
      expect(namCall[1]).toBe('world1.nam');
    }

    // 3. Attribute Table (.atr) - 64 bytes
    const atrCall = onDownloadBytes.mock.calls.find((call) =>
      (call[1] as string).endsWith('.atr'),
    );
    expect(atrCall).toBeDefined();
    if (atrCall) {
      expect(atrCall[0]).toEqual(expectedPlayfield.attributeTable);
      const atrBytes = atrCall[0] as Uint8Array;
      expect(atrBytes.length).toBe(64);
      expect(atrCall[1]).toBe('world1.atr');
    }

    // 4. Collision Map (.col) - 480 bytes
    const expectedCol = encodeCollisionMap(options.collisionCells);
    const colCall = onDownloadBytes.mock.calls.find((call) =>
      (call[1] as string).endsWith('.col'),
    );
    expect(colCall).toBeDefined();
    if (colCall) {
      expect(colCall[0]).toEqual(expectedCol);
      const colBytes = colCall[0] as Uint8Array;
      expect(colBytes.length).toBe(480);
      expect(colCall[1]).toBe('world1.col');
    }

    // 5. Palette (.pal) - 16 bytes
    const expectedPal = encodeNesBackgroundPalettes(options.paletteSet);
    const palCall = onDownloadBytes.mock.calls.find((call) =>
      (call[1] as string).endsWith('.pal'),
    );
    expect(palCall).toBeDefined();
    if (palCall) {
      expect(palCall[0]).toEqual(expectedPal);
      const palBytes = palCall[0] as Uint8Array;
      expect(palBytes.length).toBe(16);
      expect(palCall[1]).toBe('world1.pal');
    }
  });

  it('handles playfield encoding errors gracefully via diagnostics without crashing', () => {
    // An image with dimensions not 256x240
    const nonStandardImage: IndexedImage = {
      width: 128,
      height: 128,
      pixels: new Uint8Array(128 * 128),
      colors: [
        { red: 0x7c, green: 0x7c, blue: 0x7c },
        { red: 0x00, green: 0x00, blue: 0xfc },
      ],
      transparentIndex: null,
      colorCount: 2,
    };
    const regionCount = (128 / 8) * (128 / 8);
    const options = defaultOptions({
      width: 128,
      height: 128,
      indexedImage: nonStandardImage,
      tiles: extractTiles(nonStandardImage),
      paletteAssignments: new Uint8Array(regionCount),
      pixelOverrides: new Uint8Array(128 * 128),
    });

    expect(() => createPlayfieldWorkspace(options)).not.toThrow();

    const workspace = createPlayfieldWorkspace(options);
    expect(workspace).toBeDefined();
    const mockDiag = workspace.diagnosticsElement as unknown as MockElement;
    expect(mockDiag.querySelector('.error-message')).not.toBeNull();
  });
});
