import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBackgroundWorkspace,
  resolveBackgroundPaletteSet,
  type BackgroundWorkspaceOptions,
} from './background-workspace';
import {
  createEmptyBackgroundMap,
  type BackgroundProjectModel,
  type BackgroundMapReconciliationFact,
} from '../core/background-model';
import { createDefaultNesPaletteSet } from '../core/nes-palette';
import type { PaletteDefinition } from '../core/palette-manager';
import type { Tile } from '../core/types';
import type { ProjectAsset } from '../core/asset-identity';
import { setLocale } from '../i18n';

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
}

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
  checked = false;
  options: { value: string; textContent: string; selected?: boolean }[] = [];
  style: Record<string, string> & {
    setProperty: (k: string, v: string) => void;
  };
  tabIndex = -1;
  focus = vi.fn();

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
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 256, height: 240 };
  }

  getContext(type: string) {
    if (type === '2d') {
      return {
        createImageData: (w: number, h: number) => new MockImageData(w, h),
        putImageData: vi.fn(),
      };
    }
    return null;
  }

  append(...nodes: (MockElement | string)[]) {
    nodes.forEach((node) => {
      if (typeof node === 'string') {
        this._text += node;
      } else {
        this.children.push(node);
        if (this.tagName === 'SELECT' && node.tagName === 'OPTION') {
          this.options.push({
            value: node.value,
            textContent: node.textContent,
            selected: node.attributes.has('selected'),
          });
        }
      }
    });
  }

  replaceChildren(...nodes: (MockElement | string)[]) {
    this.children = [];
    this._text = '';
    this.options = [];
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
}

beforeEach(() => {
  setLocale('en');
  (
    globalThis as unknown as {
      document: unknown;
      window: unknown;
      ImageData: unknown;
      KeyboardEvent: unknown;
      Event: unknown;
    }
  ).document = {
    createElement: (tag: string) => new MockElement(tag),
    createElementNS: (_ns: string, tag: string) => new MockElement(tag),
    createTextNode: (txt: string) => txt,
    body: new MockElement('body'),
  };

  (globalThis as unknown as { ImageData: unknown }).ImageData = MockImageData;

  class MockEvent {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
    preventDefault() {
      // no-op
    }
    stopPropagation() {
      // no-op
    }
  }

  class MockKeyboardEvent extends MockEvent {
    key: string;
    constructor(type: string, init?: { key?: string }) {
      super(type);
      this.key = init?.key ?? '';
    }
  }

  (globalThis as unknown as { Event: unknown }).Event = MockEvent;
  (globalThis as unknown as { KeyboardEvent: unknown }).KeyboardEvent =
    MockKeyboardEvent;

  (globalThis as unknown as { window: unknown }).window = {
    confirm: vi.fn().mockReturnValue(true),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
});

function createMockBackgroundWorkspaceOptions(
  overrides: Partial<BackgroundWorkspaceOptions> = {},
): BackgroundWorkspaceOptions {
  const map1 = createEmptyBackgroundMap({
    id: 'bg-overworld',
    name: 'Overworld Level 1',
    patternTable: 0,
    assetId: 'asset-tileset-1',
  });

  const map2 = createEmptyBackgroundMap({
    id: 'bg-dungeon',
    name: 'Dungeon Level 1',
    patternTable: 1,
    assetId: 'asset-tileset-2',
  });

  const paletteSet = createDefaultNesPaletteSet();
  const palettes: readonly PaletteDefinition[] = paletteSet.map(
    (colors, index) => ({
      id: `pal_bg_${String(index)}`,
      name: `Background ${String(index)}`,
      colors,
      target: 'background',
    }),
  );

  const mockTiles: Tile[] = Array.from({ length: 16 }, (_, i) => ({
    id: i,
    column: i % 4,
    row: Math.floor(i / 4),
    pixels: new Uint8Array(64).fill(i % 4),
  }));

  const availableAssets: ProjectAsset[] = [
    {
      id: 'asset-tileset-1',
      name: 'Overworld Tileset',
      kind: 'background-image',
      reference: {
        id: 'asset-tileset-1',
        name: 'Overworld Tileset',
        path: 'overworld.png',
      },
    },
    {
      id: 'asset-tileset-2',
      name: 'Dungeon Tileset',
      kind: 'background-image',
      reference: {
        id: 'asset-tileset-2',
        name: 'Dungeon Tileset',
        path: 'dungeon.png',
      },
    },
  ];

  const assetTilesMap = new Map<string, readonly Tile[]>([
    ['asset-tileset-1', mockTiles],
    ['asset-tileset-2', mockTiles],
  ]);

  const compiledModel: BackgroundProjectModel = {
    map: map1,
    patternTable: 0,
    nametable: new Uint8Array(960),
    attributeTable: new Uint8Array(64),
    fullMapBuffer: new Uint8Array(1024),
    finalChr: new Uint8Array(8192),
    resolvedCells: Array.from({ length: 960 }, (_, i) => ({
      column: i % 32,
      row: Math.floor(i / 32),
      cellIndex: i,
      localTileIndex: i % 256,
      physicalTileIndex: i % 256,
      paletteIndex: 0,
      logicalKey: `asset-tileset-1:${String(i % 4)}:${String(Math.floor(i / 4))}`,
      sourceTileIndex: i % 16,
    })),
    slots: [],
    reusedBaseTiles: 0,
    reusedProjectTiles: 0,
    newTileCount: 0,
    uniqueTileCount: 0,
  };

  return {
    maps: [map1, map2],
    activeMapId: 'bg-overworld',
    palettes,
    activeBackgroundSlots: [
      palettes[0]?.id ?? null,
      palettes[1]?.id ?? null,
      palettes[2]?.id ?? null,
      palettes[3]?.id ?? null,
    ],
    universalBackgroundColor: paletteSet[0][0],
    availableAssets,
    assetTilesMap,
    compiledModel,
    reconciliationFacts: [],
    state: {
      selectedMapId: 'bg-overworld',
      selectedCellIndex: 0,
      activeTool: 'pencil',
      selectedTileKey: 'asset-tileset-1:0:0',
      selectedPaletteIndex: 0,
      zoom: 2,
      showGrid: true,
      showAttributeOverlay: true,
    },
    onSelectMap: vi.fn(),
    onAddMap: vi.fn(),
    onNewMapFromFile: vi.fn(),
    onGenerateTestScreen: vi.fn(),
    onDeleteMap: vi.fn(),
    onRenameMap: vi.fn(),
    onPatternTableChange: vi.fn(),
    onAssetChange: vi.fn(),
    onCellsChange: vi.fn(),
    onPaletteAssignmentsChange: vi.fn(),
    onStateChange: vi.fn(),
    onNavigateToChrTile: vi.fn(),
    ...overrides,
  };
}

describe('Background Workspace Component', () => {
  describe('Empty State', () => {
    it('renders empty state when no maps exist and allows creating a new map', () => {
      const options = createMockBackgroundWorkspaceOptions({
        maps: [],
        activeMapId: null,
      });

      const element = createBackgroundWorkspace(options);
      expect(
        element.querySelector('.background-empty-workspace'),
      ).not.toBeNull();

      const createBtn = element.querySelector<HTMLButtonElement>(
        '#bg-empty-create-btn',
      );
      expect(createBtn).not.toBeNull();
      createBtn?.click();
      expect(options.onAddMap).toHaveBeenCalledTimes(1);
    });
  });

  describe('Toolbar & Map Lifecycle', () => {
    it('exposes contextual screen creation actions', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      expect(element.querySelector('#bg-new-screen-png-input')).not.toBeNull();
      expect(
        element.querySelector('#bg-generate-test-screen-btn'),
      ).not.toBeNull();
    });

    it('renders map dropdown and calls onSelectMap on change', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const select = element.querySelector<HTMLSelectElement>('#bg-map-select');
      expect(select).not.toBeNull();
      expect(select?.value).toBe('bg-overworld');
      expect(select?.options.length).toBe(2);

      if (select) {
        select.value = 'bg-dungeon';
        select.dispatchEvent(new Event('change'));
      }

      expect(options.onSelectMap).toHaveBeenCalledWith('bg-dungeon');
    });

    it('triggers onAddMap when clicking + New Map', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const addBtn =
        element.querySelector<HTMLButtonElement>('#bg-new-map-btn');
      addBtn?.click();
      expect(options.onAddMap).toHaveBeenCalledTimes(1);
    });

    it('triggers onDeleteMap when clicking Delete Map with confirmation', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      const element = createBackgroundWorkspace(options);
      const deleteBtn =
        element.querySelector<HTMLButtonElement>('#bg-delete-map-btn');
      deleteBtn?.click();

      expect(confirmSpy).toHaveBeenCalled();
      expect(options.onDeleteMap).toHaveBeenCalledWith('bg-overworld');
    });

    it('triggers onRenameMap when changing map name input', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const nameInput =
        element.querySelector<HTMLInputElement>('#bg-map-name-input');
      expect(nameInput?.value).toBe('Overworld Level 1');

      if (nameInput) {
        nameInput.value = 'World 1-1';
        nameInput.dispatchEvent(new Event('change'));
      }

      expect(options.onRenameMap).toHaveBeenCalledWith(
        'bg-overworld',
        'World 1-1',
      );
    });

    it('triggers onPatternTableChange when toggling PT0 / PT1 buttons', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const pt1Btn = element.querySelector<HTMLButtonElement>('#bg-pt1-btn');
      pt1Btn?.click();
      expect(options.onPatternTableChange).toHaveBeenCalledWith(
        'bg-overworld',
        1,
      );

      // PT0 button should not re-trigger if already on PT0
      const pt0Btn = element.querySelector<HTMLButtonElement>('#bg-pt0-btn');
      pt0Btn?.click();
      expect(options.onPatternTableChange).toHaveBeenCalledTimes(1);
    });

    it('triggers onAssetChange when selecting a source image asset', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const assetSelect =
        element.querySelector<HTMLSelectElement>('#bg-asset-select');
      expect(assetSelect).not.toBeNull();

      if (assetSelect) {
        assetSelect.value = 'asset-tileset-2';
        assetSelect.dispatchEvent(new Event('change'));
      }

      expect(options.onAssetChange).toHaveBeenCalledWith(
        'bg-overworld',
        'asset-tileset-2',
      );
    });
  });

  describe('Tools & Subpalette Selection', () => {
    it('switches tool on click', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const eraseBtn =
        element.querySelector<HTMLButtonElement>('#bg-tool-erase');
      eraseBtn?.click();
      expect(options.onStateChange).toHaveBeenCalledWith({
        activeTool: 'erase',
      });

      const pickerBtn =
        element.querySelector<HTMLButtonElement>('#bg-tool-picker');
      pickerBtn?.click();
      expect(options.onStateChange).toHaveBeenCalledWith({
        activeTool: 'picker',
      });

      const paletteBtn =
        element.querySelector<HTMLButtonElement>('#bg-tool-palette');
      paletteBtn?.click();
      expect(options.onStateChange).toHaveBeenCalledWith({
        activeTool: 'palette',
      });
    });

    it('selects subpalette on swatch click', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const sp2Btn =
        element.querySelector<HTMLButtonElement>('#bg-subpalette-2');
      sp2Btn?.click();
      expect(options.onStateChange).toHaveBeenCalledWith({
        selectedPaletteIndex: 2,
      });
    });

    it('labels physical BG slots with logical palette identity and exposes empty slots', () => {
      const base = createMockBackgroundWorkspaceOptions();
      const options = createMockBackgroundWorkspaceOptions({
        activeBackgroundSlots: [
          base.palettes[2]?.id ?? null,
          null,
          base.palettes[0]?.id ?? null,
          base.palettes[1]?.id ?? null,
        ] as const,
      });
      const element = createBackgroundWorkspace(options);
      const bg0 = element.querySelector<HTMLButtonElement>('#bg-subpalette-0');
      const bg1 = element.querySelector<HTMLButtonElement>('#bg-subpalette-1');

      expect(bg0?.getAttribute('aria-label')).toContain('BG 0 — Background 2');
      expect(bg1?.getAttribute('data-palette-status')).toBe('empty');
      expect(bg1?.classList.contains('is-unassigned')).toBe(true);

      bg0?.click();
      expect(options.onStateChange).toHaveBeenCalledWith({
        selectedPaletteIndex: 0,
      });
    });

    it('derives colors only from the Background bank, preserves physical assignments, and uses canonical universal color', () => {
      const base = createMockBackgroundWorkspaceOptions();
      const physicalAssignments = base.maps[0]?.paletteAssignments.slice();
      const first = resolveBackgroundPaletteSet(base);
      const reassignedOptions = {
        ...base,
        activeBackgroundSlots: [
          base.palettes[3]?.id ?? null,
          base.palettes[1]?.id ?? null,
          base.palettes[2]?.id ?? null,
          base.palettes[0]?.id ?? null,
        ],
        universalBackgroundColor: 0x30,
        activeSpriteSlots: [null, null, null, null],
      } satisfies BackgroundWorkspaceOptions & {
        readonly activeSpriteSlots: readonly (string | null)[];
      };
      const reassigned = resolveBackgroundPaletteSet(reassignedOptions);

      expect(reassigned[0][0]).toBe(0x30);
      expect(reassigned[0][1]).toBe(base.palettes[3]?.colors[1]);
      expect(reassigned[0]).not.toEqual(first[0]);
      expect(base.maps[0]?.paletteAssignments).toEqual(physicalAssignments);

      const emptyA = resolveBackgroundPaletteSet({
        ...base,
        activeBackgroundSlots: [null, null, null, null] as const,
      });
      const spriteBankVariant = {
        ...base,
        activeBackgroundSlots: [null, null, null, null],
        activeSpriteSlots: [
          base.palettes[0]?.id ?? null,
          base.palettes[1]?.id ?? null,
          base.palettes[2]?.id ?? null,
          base.palettes[3]?.id ?? null,
        ],
      } satisfies BackgroundWorkspaceOptions & {
        readonly activeSpriteSlots: readonly (string | null)[];
      };
      const emptyB = resolveBackgroundPaletteSet(spriteBankVariant);
      expect(emptyB).toEqual(emptyA);
    });
  });

  describe('Source Tile Browser', () => {
    it('renders tiles and handles selection', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const tileItem =
        element.querySelector<HTMLButtonElement>('#bg-browser-tile-3');
      expect(tileItem).not.toBeNull();
      tileItem?.click();

      expect(options.onStateChange).toHaveBeenCalledWith({
        selectedTileKey: 'asset-tileset-1:3:0',
        activeTool: 'pencil',
      });
    });

    it('renders empty message when no asset is associated', () => {
      const mapWithoutAsset = {
        ...createEmptyBackgroundMap({ id: 'bg-empty' }),
        assetId: undefined,
      };
      const options = createMockBackgroundWorkspaceOptions({
        maps: [mapWithoutAsset],
        activeMapId: 'bg-empty',
      });

      const element = createBackgroundWorkspace(options);
      expect(element.querySelector('.empty-hint')).not.toBeNull();
    });
  });

  describe('View Controls (Zoom, Grid, Attribute Overlay)', () => {
    it('handles zoom selection', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const zoom3x = element.querySelector<HTMLButtonElement>('#bg-zoom-3x');
      zoom3x?.click();
      expect(options.onStateChange).toHaveBeenCalledWith({ zoom: 3 });
    });

    it('toggles grid and attribute overlay', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const gridCheck =
        element.querySelector<HTMLInputElement>('#bg-grid-checkbox');
      if (gridCheck) {
        gridCheck.checked = false;
        gridCheck.dispatchEvent(new Event('change'));
      }
      expect(options.onStateChange).toHaveBeenCalledWith({ showGrid: false });

      const attrCheck =
        element.querySelector<HTMLInputElement>('#bg-attr-checkbox');
      if (attrCheck) {
        attrCheck.checked = false;
        attrCheck.dispatchEvent(new Event('change'));
      }
      expect(options.onStateChange).toHaveBeenCalledWith({
        showAttributeOverlay: false,
      });
    });
  });

  describe('Inspector & CHR Navigation', () => {
    it('displays cell details and physical CHR mapping', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);

      const coords = element.querySelector('#bg-inspect-coords');
      expect(coords?.textContent).toContain('Col 0, Row 0 (#0)');

      const logicalKey = element.querySelector('#bg-inspect-logical-key');
      expect(logicalKey?.textContent).toBe('Empty Cell');

      const physicalTile = element.querySelector('#bg-inspect-physical-tile');
      expect(physicalTile?.textContent).toContain('PT0 #0 (CHR Slot #0)');

      const navBtn = element.querySelector<HTMLButtonElement>(
        '#bg-inspect-nav-chr-btn',
      );
      expect(navBtn).not.toBeNull();
      navBtn?.click();
      expect(options.onNavigateToChrTile).toHaveBeenCalledWith(0);
    });
  });

  describe('Diagnostics Panel', () => {
    it('renders diagnostics facts when present', () => {
      const facts: BackgroundMapReconciliationFact[] = [
        {
          kind: 'missing-asset',
          severity: 'error',
          message: 'Asset asset-missing not found.',
          mapId: 'bg-overworld',
        },
        {
          kind: 'malformed-logical-key',
          severity: 'warning',
          message: 'Unresolved tile key detected.',
          mapId: 'bg-overworld',
        },
      ];

      const options = createMockBackgroundWorkspaceOptions({
        reconciliationFacts: facts,
      });

      const element = createBackgroundWorkspace(options);
      const items = element.querySelectorAll('.diagnostic-item');
      expect(items.length).toBe(2);
      expect(
        element.diagnosticsElement.querySelectorAll('.diagnostic-item').length,
      ).toBe(2);
      expect(items[0]?.textContent).toContain(
        'ERROR: Asset asset-missing not found.',
      );
      expect(items[1]?.textContent).toContain(
        'WARNING: Unresolved tile key detected.',
      );
    });

    it('renders clean message when no diagnostics exist', () => {
      const options = createMockBackgroundWorkspaceOptions({
        reconciliationFacts: [],
      });

      const element = createBackgroundWorkspace(options);
      const items = element.querySelectorAll('.diagnostic-item.is-ok');
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.textContent).toContain('No background diagnostics');
    });
  });

  describe('Keyboard Navigation & Actions on Canvas Viewport', () => {
    it('navigates cells via Arrow keys', () => {
      const options = createMockBackgroundWorkspaceOptions({
        state: {
          selectedMapId: 'bg-overworld',
          selectedCellIndex: 0,
          activeTool: 'pencil',
          selectedTileKey: 'asset-tileset-1:0:0',
          selectedPaletteIndex: 0,
          zoom: 2,
          showGrid: true,
          showAttributeOverlay: true,
        },
      });

      const element = createBackgroundWorkspace(options);
      const viewport = element.querySelector<HTMLElement>('#section-bg-canvas');
      expect(viewport).not.toBeNull();

      // Press ArrowRight (moves from 0 to 1)
      viewport?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
      );
      expect(options.onStateChange).toHaveBeenCalledWith({
        selectedCellIndex: 1,
      });

      // Press ArrowDown (moves from 0 to 32)
      viewport?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
      );
      expect(options.onStateChange).toHaveBeenCalledWith({
        selectedCellIndex: 32,
      });
    });

    it('applies tool on Space / Enter key', () => {
      const options = createMockBackgroundWorkspaceOptions({
        state: {
          selectedMapId: 'bg-overworld',
          selectedCellIndex: 10,
          activeTool: 'pencil',
          selectedTileKey: 'asset-tileset-1:2:1',
          selectedPaletteIndex: 0,
          zoom: 2,
          showGrid: true,
          showAttributeOverlay: true,
        },
      });

      const element = createBackgroundWorkspace(options);
      const viewport = element.querySelector<HTMLElement>('#section-bg-canvas');

      viewport?.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', cancelable: true }),
      );
      expect(options.onCellsChange).toHaveBeenCalled();
      const calledCells = vi.mocked(options.onCellsChange).mock.calls[0]?.[1];
      expect(calledCells?.[10]).toEqual({
        logicalKey: 'asset-tileset-1:2:1',
        tileX: 2,
        tileY: 1,
      });
    });

    it('erases cell on Delete / Backspace key', () => {
      const map = createEmptyBackgroundMap({ id: 'bg-test' });
      const initialCells = [...map.cells];
      initialCells[5] = {
        logicalKey: 'asset-1:0:0',
        tileX: 0,
        tileY: 0,
      };

      const options = createMockBackgroundWorkspaceOptions({
        maps: [{ ...map, cells: initialCells }],
        activeMapId: 'bg-test',
        state: {
          selectedMapId: 'bg-test',
          selectedCellIndex: 5,
          activeTool: 'pencil',
          selectedTileKey: null,
          selectedPaletteIndex: 0,
          zoom: 2,
          showGrid: true,
          showAttributeOverlay: true,
        },
      });

      const element = createBackgroundWorkspace(options);
      const viewport = element.querySelector<HTMLElement>('#section-bg-canvas');

      viewport?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', cancelable: true }),
      );
      expect(options.onCellsChange).toHaveBeenCalled();
      const resultCells = vi.mocked(options.onCellsChange).mock.calls[0]?.[1];
      expect(resultCells?.[5]).toBeNull();
    });

    it('switches palette and tools via shortcut keys', () => {
      const options = createMockBackgroundWorkspaceOptions();
      const element = createBackgroundWorkspace(options);
      const viewport = element.querySelector<HTMLElement>('#section-bg-canvas');

      // Key '2' selects subpalette 1
      viewport?.dispatchEvent(
        new KeyboardEvent('keydown', { key: '2', cancelable: true }),
      );
      expect(options.onStateChange).toHaveBeenCalledWith({
        selectedPaletteIndex: 1,
      });

      // Key 'E' switches to erase
      viewport?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'e', cancelable: true }),
      );
      expect(options.onStateChange).toHaveBeenCalledWith({
        activeTool: 'erase',
      });

      // Key 'I' switches to picker
      viewport?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'i', cancelable: true }),
      );
      expect(options.onStateChange).toHaveBeenCalledWith({
        activeTool: 'picker',
      });

      // Key 'P' switches to pencil
      viewport?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', cancelable: true }),
      );
      expect(options.onStateChange).toHaveBeenCalledWith({
        activeTool: 'pencil',
      });
    });
  });
});
