import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateCAnimationExport,
  generateCa65AnimationExport,
  serializeAnimationMetadata,
} from '../core/animation-exporters';
import {
  buildAnimationProjectModel,
  type AnimationProjectModel,
} from '../core/animation-model';
import { padChrRom } from '../core/chr-rom';
import {
  createDefaultNesPaletteSet,
  encodeNesBackgroundPalettes,
} from '../core/nes-palette';
import { createDefaultPaletteDefinitions } from '../core/palette-manager';
import type { IndexedImage } from '../core/types';
import {
  createDeliveryWorkspace,
  type DeliveryWorkspaceOptions,
} from './delivery-workspace';
import type { ChrSlotClassification } from '../core/chr-pattern-table';

class MockElement {
  public tagName: string;
  public id = '';
  public className = '';
  private _textContent = '';
  public innerHTML = '';
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public dataset: Record<string, string> = {};
  private readonly listeners = new Map<string, ((event?: unknown) => void)[]>();
  private readonly attributes = new Map<string, string>();

  public get textContent(): string {
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this.children.map((c) => c.textContent).join('');
  }

  public set textContent(val: string) {
    this._textContent = val;
  }

  public constructor(tagName = 'DIV') {
    this.tagName = tagName.toUpperCase();
  }

  public get classList() {
    return {
      add: (...names: string[]) => {
        const set = new Set(this.className.split(' ').filter(Boolean));
        names.forEach((n) => set.add(n));
        this.className = Array.from(set).join(' ');
      },
      remove: (...names: string[]) => {
        const set = new Set(this.className.split(' ').filter(Boolean));
        names.forEach((n) => set.delete(n));
        this.className = Array.from(set).join(' ');
      },
      contains: (name: string) =>
        this.className.split(' ').filter(Boolean).includes(name),
      toggle: (name: string, force?: boolean) => {
        const set = new Set(this.className.split(' ').filter(Boolean));
        if (force === true || (force === undefined && !set.has(name))) {
          set.add(name);
        } else {
          set.delete(name);
        }
        this.className = Array.from(set).join(' ');
      },
    };
  }

  public appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  public append(
    ...children: (MockElement | string | null | undefined)[]
  ): void {
    children.forEach((c) => {
      if (c === null || c === undefined) return;
      if (typeof c === 'string') {
        const textNode = new MockElement();
        textNode.textContent = c;
        textNode.parentElement = this;
        this.children.push(textNode);
      } else {
        c.parentElement = this;
        this.children.push(c);
      }
    });
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public addEventListener(
    type: string,
    listener: (event?: unknown) => void,
  ): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)?.push(listener);
  }

  public dispatchEvent(event: { type: string }): boolean {
    const list = this.listeners.get(event.type);
    if (list) {
      list.forEach((fn) => {
        fn(event);
      });
    }
    return true;
  }

  public click(): void {
    this.dispatchEvent({ type: 'click' });
  }

  public querySelector(selector: string): MockElement | null {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this.classList.contains(cls)) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    } else if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (this.id === id) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  public querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this.classList.contains(cls)) results.push(this);
      for (const child of this.children) {
        results.push(...child.querySelectorAll(selector));
      }
    } else if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (this.id === id) results.push(this);
      for (const child of this.children) {
        results.push(...child.querySelectorAll(selector));
      }
    }
    return results;
  }
}

function createSampleIndexedImage(w = 16, h = 16): IndexedImage {
  return {
    width: w,
    height: h,
    pixels: new Uint8Array(w * h).fill(1),
    colors: [
      { red: 0, green: 0, blue: 0 },
      { red: 255, green: 0, blue: 0 },
      { red: 0, green: 255, blue: 0 },
      { red: 0, green: 0, blue: 255 },
    ],
    colorCount: 4,
    transparentIndex: 0,
  };
}

function createSampleAnimationModel(): AnimationProjectModel {
  const img = createSampleIndexedImage(16, 16);
  return buildAnimationProjectModel({
    name: 'Hero',
    symbolPrefix: 'hero',
    animations: [
      {
        id: 'a1',
        name: 'Hero_idle',
        image: img,
        sourceImageName: 'hero.png',
        frameWidth: 16,
        frameHeight: 16,
        originX: 8,
        originY: 16,
        playback: 'loop',
        frameIndices: [0],
        frameDuration: 8,
      },
    ],
  });
}

function createOptions(
  overrides?: Partial<DeliveryWorkspaceOptions>,
): DeliveryWorkspaceOptions {
  const paletteSet = createDefaultNesPaletteSet();
  const palettes = createDefaultPaletteDefinitions(paletteSet);
  return {
    mode: 'tileset',
    projectName: 'Demo Project',
    fileName: 'demo_graphics.png',
    width: 128,
    height: 128,
    indexedImage: createSampleIndexedImage(128, 128),
    tileCount: 256,
    originalTileCount: 256,
    deduplicationEnabled: true,
    flipDeduplicationEnabled: false,
    chr: new Uint8Array(4096).fill(0xaa),
    nametable: null,
    attributeTable: null,
    collisionMap: null,
    paletteSet,
    palettes,
    activeSpritePaletteSlots: palettes.slice(0, 4).map((p) => p.id),
    animationModel: null,
    animationModelError: null,
    error: null,
    onDownloadBytes: vi.fn(),
    onDownloadText: vi.fn(),
    onNavigateWorkspace: vi.fn(),
    ...overrides,
  };
}

describe('Delivery Workspace', () => {
  beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tagName: string) => new MockElement(tagName),
    };
  });

  it('renders readiness and artifacts for Tileset mode with exact byte downloads', () => {
    const onDownloadBytes = vi.fn();
    const options = createOptions({
      mode: 'tileset',
      fileName: 'tiles.png',
      chr: new Uint8Array(4096).fill(0x55),
      onDownloadBytes,
    });

    const el = createDeliveryWorkspace(options);
    const mockEl = el as unknown as MockElement;

    // Readiness status is ready
    const statusCard = mockEl.querySelector('.delivery-status-card');
    expect(statusCard).not.toBeNull();
    expect(statusCard?.classList.contains('status-ready')).toBe(true);

    // Artifacts rendered: CHR and Palette
    const artifactCards = mockEl.querySelectorAll('.delivery-artifact-card');
    expect(artifactCards.length).toBe(2);

    // Download CHR button
    const chrBtn = artifactCards[0]?.querySelector('.delivery-download-btn');
    chrBtn?.click();
    expect(onDownloadBytes).toHaveBeenCalledWith(
      new Uint8Array(4096).fill(0x55),
      'tiles.chr',
    );

    // Download Palette button
    const palBtn = artifactCards[1]?.querySelector('.delivery-download-btn');
    palBtn?.click();
    expect(onDownloadBytes).toHaveBeenCalledWith(
      encodeNesBackgroundPalettes(options.paletteSet),
      'tiles.pal',
    );
  });

  it('renders readiness and 5 production artifacts for Playfield mode', () => {
    const onDownloadBytes = vi.fn();
    const nametable = new Uint8Array(960).fill(0x01);
    const attributeTable = new Uint8Array(64).fill(0x55);
    const collisionMap = new Uint8Array(480).fill(0x02);
    const chr = new Uint8Array(4096).fill(0x33);

    const options = createOptions({
      mode: 'playfield',
      fileName: 'stage1.png',
      chr,
      nametable,
      attributeTable,
      collisionMap,
      onDownloadBytes,
    });

    const el = createDeliveryWorkspace(options);
    const mockEl = el as unknown as MockElement;

    // Readiness status is ready
    const statusCard = mockEl.querySelector('.delivery-status-card');
    expect(statusCard?.classList.contains('status-ready')).toBe(true);

    // 5 Artifacts: CHR, Palette, Nametable, Attribute Table, Collision Map
    const artifactCards = mockEl.querySelectorAll('.delivery-artifact-card');
    expect(artifactCards.length).toBe(5);

    // Nametable download
    const namBtn = artifactCards[2]?.querySelector('.delivery-download-btn');
    namBtn?.click();
    expect(onDownloadBytes).toHaveBeenCalledWith(nametable, 'stage1.nam');

    // Attribute Table download
    const atrBtn = artifactCards[3]?.querySelector('.delivery-download-btn');
    atrBtn?.click();
    expect(onDownloadBytes).toHaveBeenCalledWith(attributeTable, 'stage1.atr');

    // Collision Map download
    const colBtn = artifactCards[4]?.querySelector('.delivery-download-btn');
    colBtn?.click();
    expect(onDownloadBytes).toHaveBeenCalledWith(collisionMap, 'stage1.col');
  });

  it('renders all production artifacts for Animation mode with byte-for-byte exact data', () => {
    const onDownloadBytes = vi.fn();
    const onDownloadText = vi.fn();
    const model = createSampleAnimationModel();
    const cExport = generateCAnimationExport(model);
    const asmExport = generateCa65AnimationExport(model);
    const jsonText = serializeAnimationMetadata(model);
    const exportedChr = padChrRom(model.finalChr);

    const options = createOptions({
      mode: 'animation',
      fileName: 'hero.png',
      animationModel: model,
      onDownloadBytes,
      onDownloadText,
    });

    const el = createDeliveryWorkspace(options);
    const mockEl = el as unknown as MockElement;

    // 7 Artifacts: CHR, Palette, JSON, C Header, C Source, ASM Include, ASM Source
    const artifactCards = mockEl.querySelectorAll('.delivery-artifact-card');
    expect(artifactCards.length).toBe(7);

    // Download CHR (padded 8 KiB)
    artifactCards[0]?.querySelector('.delivery-download-btn')?.click();
    expect(onDownloadBytes).toHaveBeenCalledWith(
      exportedChr,
      model.chr.output || `${model.symbolBase}.chr`,
    );

    // Download Palette
    artifactCards[1]?.querySelector('.delivery-download-btn')?.click();
    expect(onDownloadBytes).toHaveBeenCalledWith(
      encodeNesBackgroundPalettes(options.paletteSet),
      `${model.symbolBase}.pal`,
    );

    // Download JSON metadata
    artifactCards[2]?.querySelector('.delivery-download-btn')?.click();
    expect(onDownloadText).toHaveBeenCalledWith(
      jsonText,
      `${model.symbolBase}.json`,
    );

    // Download C Header
    artifactCards[3]?.querySelector('.delivery-download-btn')?.click();
    expect(onDownloadText).toHaveBeenCalledWith(
      cExport.header,
      cExport.headerFileName,
    );

    // Download C Source
    artifactCards[4]?.querySelector('.delivery-download-btn')?.click();
    expect(onDownloadText).toHaveBeenCalledWith(
      cExport.source,
      cExport.sourceFileName,
    );

    // Download ASM Include
    artifactCards[5]?.querySelector('.delivery-download-btn')?.click();
    expect(onDownloadText).toHaveBeenCalledWith(
      asmExport.include,
      asmExport.includeFileName,
    );

    // Download ASM Source
    artifactCards[6]?.querySelector('.delivery-download-btn')?.click();
    expect(onDownloadText).toHaveBeenCalledWith(
      asmExport.source,
      asmExport.sourceFileName,
    );
  });

  it('handles blocking errors and provides navigation action link', () => {
    const onNavigateWorkspace = vi.fn();
    const options = createOptions({
      mode: 'playfield',
      error: {
        key: 'invalidDimensions',
        variables: { width: 100, height: 100 },
      },
      onNavigateWorkspace,
    });

    const el = createDeliveryWorkspace(options);
    const mockEl = el as unknown as MockElement;

    // Status card is error
    const statusCard = mockEl.querySelector('.delivery-status-card');
    expect(statusCard?.classList.contains('status-error')).toBe(true);

    // Diagnostic item with action link
    const diagAction = mockEl.querySelector('.delivery-diag-action');
    expect(diagAction).not.toBeNull();
    diagAction?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('playfield');
  });

  it('wires workspace navigation shortcut buttons', () => {
    const onNavigateWorkspace = vi.fn();
    const options = createOptions({ onNavigateWorkspace });

    const el = createDeliveryWorkspace(options);
    const mockEl = el as unknown as MockElement;

    const shortcutBtns = mockEl.querySelectorAll('.delivery-link-btn');
    expect(shortcutBtns.length).toBe(5);

    // Click Tileset shortcut
    shortcutBtns[0]?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('tileset');

    // Click Playfield shortcut
    shortcutBtns[1]?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('playfield');

    // Click Animation shortcut
    shortcutBtns[2]?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('animation');

    // Click Palette shortcut
    shortcutBtns[3]?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('palette');

    // Click CHR shortcut
    shortcutBtns[4]?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('chr');
  });

  it('renders CHR region overlap and reservation diagnostics with navigation to CHR workspace', () => {
    const onNavigateWorkspace = vi.fn();
    const classifications: ChrSlotClassification[] = Array.from(
      { length: 512 },
      (_, i) => ({
        physicalIndex: i,
        localIndex: i % 256,
        patternTable: i < 256 ? 0 : 1,
        occupancy: i === 32 ? 'base' : 'empty',
      }),
    );

    const options = createOptions({
      chrRegions: [
        {
          id: 'reg1',
          name: 'Player Area',
          patternTable: 0,
          startTile: 0,
          endTile: 31,
          kind: 'region',
        },
        {
          id: 'reg2',
          name: 'Enemy Area',
          patternTable: 0,
          startTile: 16,
          endTile: 47,
          kind: 'region',
        },
        {
          id: 'res-fx',
          name: 'Runtime FX',
          patternTable: 0,
          startTile: 32,
          endTile: 48,
          kind: 'reservation',
        },
      ],
      chrSlotClassifications: classifications,
      onNavigateWorkspace,
    });

    const el = createDeliveryWorkspace(options);
    const mockEl = el as unknown as MockElement;

    // Diagnostics items rendered
    const diagItems = mockEl.querySelectorAll('.delivery-diag-item');
    expect(diagItems.length).toBeGreaterThan(0);

    // Overlap diagnostic should be present
    const overlapDiag = diagItems.find((item) =>
      item.textContent.includes('Player Area'),
    );
    expect(overlapDiag).toBeDefined();
    expect(overlapDiag?.textContent).toContain('Enemy Area');

    // Reservation occupied diagnostic should be present
    const resOccupiedDiag = diagItems.find((item) =>
      item.textContent.includes('Runtime FX'),
    );
    expect(resOccupiedDiag).toBeDefined();

    // Clicking action button on region diagnostic navigates to 'chr'
    const actionBtn = overlapDiag?.querySelector('.delivery-diag-action');
    expect(actionBtn).not.toBeNull();
    actionBtn?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('chr');
  });
});
