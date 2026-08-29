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
  exportBackgroundPaletteBinary,
  exportFullPpuPaletteBinary,
  exportSpritePaletteBinary,
  generateCa65PaletteExport,
  generateCPaletteExport,
} from '../core/palette-exporters';
import { createDefaultDualBankPaletteState } from '../core/palette-manager';
import type { IndexedImage } from '../core/types';
import {
  createDeliveryWorkspace,
  convertNametableChrFactsToDeliveryItems,
  convertOamCapacityFactsToDeliveryItems,
  convertSceneVisibilityFactsToDeliveryItems,
  convertSpriteScanlineFactsToDeliveryItems,
  deduplicateDeliveryDiagnosticItems,
  type DeliveryWorkspaceOptions,
} from './delivery-workspace';
import type { ChrSlotClassification } from '../core/chr-pattern-table';
import type {
  ChrAssetMappingIndex,
  PhysicalSlotAttribution,
} from '../core/chr-asset-mapping';
import { analyzeSceneInstanceVisibility } from '../core/nes-sprite-diagnostics';
import { analyzeAnimationOamCapacity } from '../core/oam-diagnostics';
import { analyzeAnimationSpriteScanlinePressure } from '../core/nes-sprite-diagnostics';
import { setLocale } from '../i18n';
import { createEmptyBackgroundMap } from '../core/background-model';
import { buildBackgroundProjectModel } from '../core/chr-background-allocation';

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

function createOamPressureAnimationModel(): AnimationProjectModel {
  const base = createSampleAnimationModel();
  const sprite = base.animations[0]?.frames[0]?.sprites[0];
  if (sprite === undefined) {
    throw new Error('Expected sample animation to contain one sprite.');
  }
  return {
    ...base,
    animations: base.animations.map((animation) => ({
      ...animation,
      frames: animation.frames.map((frame) => ({
        ...frame,
        sprites: Array.from({ length: 33 }, () => sprite),
      })),
    })),
  };
}

function createScanlinePressureAnimationModel(
  spriteCount: number,
): AnimationProjectModel {
  const base = createSampleAnimationModel();
  const sprite = base.animations[0]?.frames[0]?.sprites[0];
  if (sprite === undefined) {
    throw new Error('Expected sample animation to contain one sprite.');
  }
  return {
    ...base,
    animations: base.animations.map((animation) => ({
      ...animation,
      frames: animation.frames.map((frame) => ({
        ...frame,
        sprites: Array.from({ length: spriteCount }, () => sprite),
      })),
    })),
  };
}

function createOptions(
  overrides?: Partial<DeliveryWorkspaceOptions>,
): DeliveryWorkspaceOptions {
  const paletteState = createDefaultDualBankPaletteState();
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
    backgroundPatternTable: 0,
    attributeTable: null,
    collisionMap: null,
    paletteState,
    animationModel: null,
    animationModelError: null,
    error: null,
    onDownloadBytes: vi.fn(),
    onDownloadText: vi.fn(),
    onNavigateWorkspace: vi.fn(),
    ...overrides,
  };
}

function setChrSlotOccupancy(
  classifications: ChrSlotClassification[],
  physicalIndex: number,
  occupancy: ChrSlotClassification['occupancy'],
): void {
  const classification = classifications[physicalIndex];
  if (classification === undefined) {
    throw new Error(
      `Missing CHR classification for slot ${String(physicalIndex)}.`,
    );
  }
  classifications[physicalIndex] = { ...classification, occupancy };
}

describe('Delivery Workspace', () => {
  beforeEach(() => {
    setLocale('en');
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tagName: string) => new MockElement(tagName),
    };
  });

  it('renders one OAM pressure diagnostic per affected animation frame', () => {
    const el = createDeliveryWorkspace(
      createOptions({
        mode: 'animation',
        animationModel: createOamPressureAnimationModel(),
        paletteAnimations: [],
      }),
    );
    const diagnostics = (el as unknown as MockElement).querySelectorAll(
      '.delivery-diag-item',
    );

    expect(
      diagnostics.filter(
        (item) =>
          item.textContent.includes('33') &&
          !item.textContent.includes('scanline'),
      ).length,
    ).toBe(1);
    expect(diagnostics[0]?.classList.contains('is-warning')).toBe(true);
  });

  it.each([
    [6, 'is-warning'],
    [8, 'is-warning'],
    [9, 'is-error'],
  ] as const)(
    'renders scanline pressure for %s concurrent sprites',
    (spriteCount, expectedClass) => {
      const el = createDeliveryWorkspace(
        createOptions({
          mode: 'animation',
          animationModel: createScanlinePressureAnimationModel(spriteCount),
          paletteAnimations: [],
        }),
      );
      const diagnostics = (el as unknown as MockElement).querySelectorAll(
        '.delivery-diag-item',
      );
      const scanlineDiagnostic = diagnostics.find((item) =>
        item.textContent.includes('scanline 0'),
      );

      expect(scanlineDiagnostic).toBeDefined();
      expect(scanlineDiagnostic?.textContent).toContain(
        `${String(spriteCount)} sprites`,
      );
      expect(scanlineDiagnostic?.classList.contains(expectedClass)).toBe(true);
    },
  );

  it('renders one warning for a fully offscreen Scene instance', () => {
    const animationModel = createSampleAnimationModel();
    const scenePreview = {
      instances: [
        {
          id: 'scene-hero',
          animationId: 'a1',
          entityId: 'hero',
          animationName: 'Hero_idle',
          x: 20,
          y: 240,
          visible: true,
          name: 'Hero One',
        },
      ],
    } as const;
    expect(
      analyzeSceneInstanceVisibility(
        scenePreview.instances,
        animationModel.animations,
      ),
    ).toHaveLength(1);
    const el = createDeliveryWorkspace(
      createOptions({
        mode: 'animation',
        animationModel,
        paletteAnimations: [],
        scenePreview,
      }),
    );
    const diagnostics = (el as unknown as MockElement).querySelectorAll(
      '.delivery-diag-item',
    );
    const offscreenDiagnostic = diagnostics.find((item) =>
      item.textContent.includes('every sprite outside the visible area'),
    );

    expect(offscreenDiagnostic).toBeDefined();
    expect(offscreenDiagnostic?.textContent).toContain('Hero One');
    expect(offscreenDiagnostic?.classList.contains('is-warning')).toBe(true);
  });

  it('renders coordinate wrapping as info while allowing partial clipping', () => {
    const el = createDeliveryWorkspace(
      createOptions({
        mode: 'animation',
        animationModel: createSampleAnimationModel(),
        paletteAnimations: [],
        scenePreview: {
          instances: [
            {
              id: 'scene-hero',
              animationId: 'a1',
              entityId: 'hero',
              animationName: 'Hero_idle',
              x: -1,
              y: 20,
              visible: true,
              name: 'Hero One',
            },
          ],
        },
      }),
    );
    const diagnostics = (el as unknown as MockElement).querySelectorAll(
      '.delivery-diag-item',
    );
    const wrapDiagnostics = diagnostics.filter((item) =>
      item.textContent.includes('outside the unsigned 8-bit range'),
    );

    expect(wrapDiagnostics).toHaveLength(1);
    expect(wrapDiagnostics[0]?.classList.contains('is-info')).toBe(true);
    expect(
      diagnostics.some((item) =>
        item.textContent.includes('every sprite outside the visible area'),
      ),
    ).toBe(false);
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

    // CHR plus 7 canonical palette artifacts.
    const artifactCards = mockEl.querySelectorAll('.delivery-artifact-card');
    expect(artifactCards.length).toBe(8);

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
      exportBackgroundPaletteBinary(options.paletteState),
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

    // 5 original artifacts plus 6 additional palette artifacts.
    const artifactCards = mockEl.querySelectorAll('.delivery-artifact-card');
    expect(artifactCards.length).toBe(11);

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

  it('integrates Nametable to CHR diagnostics using the selected Background Pattern Table', () => {
    const nametable = new Uint8Array(960).fill(1);
    nametable.set([2, 2], 31);
    nametable[65] = 3;
    const classifications: ChrSlotClassification[] = Array.from(
      { length: 512 },
      (_, physicalIndex) => ({
        physicalIndex,
        localIndex: physicalIndex % 256,
        patternTable: physicalIndex < 256 ? 0 : 1,
        occupancy: 'empty',
      }),
    );
    setChrSlotOccupancy(classifications, 1, 'project');
    setChrSlotOccupancy(classifications, 2, 'project');
    setChrSlotOccupancy(classifications, 3, 'project');
    setChrSlotOccupancy(classifications, 257, 'project');
    setChrSlotOccupancy(classifications, 258, 'reserved');

    const el = createDeliveryWorkspace(
      createOptions({
        mode: 'playfield',
        nametable,
        attributeTable: new Uint8Array(64),
        collisionMap: new Uint8Array(480),
        backgroundPatternTable: 1,
        chrSlotClassifications: classifications,
        chrRegions: [],
      }),
    ) as unknown as MockElement;
    const diagnostics = el.querySelectorAll('.delivery-diag-item');
    const reserved = diagnostics.find((item) =>
      item.textContent.includes('reserved CHR slots PT1:$02'),
    );
    const unallocated = diagnostics.find((item) =>
      item.textContent.includes('unallocated CHR slot PT1:$03'),
    );

    expect(reserved).toBeDefined();
    expect(reserved?.classList.contains('is-info')).toBe(true);
    expect(reserved?.textContent).toContain('column 31, row 0');
    expect(reserved?.textContent).toContain('column 0, row 1');
    expect(unallocated).toBeDefined();
    expect(unallocated?.classList.contains('is-warning')).toBe(true);
    expect(
      el
        .querySelector('.delivery-status-card')
        ?.classList.contains('status-warning'),
    ).toBe(true);
  });

  it.each(['tileset', 'animation'] as const)(
    'does not run Nametable to CHR validation in %s mode',
    (mode) => {
      const classifications: ChrSlotClassification[] = Array.from(
        { length: 512 },
        (_, physicalIndex) => ({
          physicalIndex,
          localIndex: physicalIndex % 256,
          patternTable: physicalIndex < 256 ? 0 : 1,
          occupancy: 'empty',
        }),
      );

      const el = createDeliveryWorkspace(
        createOptions({
          mode,
          nametable: new Uint8Array(960).fill(0),
          backgroundPatternTable: 0,
          chrSlotClassifications: classifications,
          chrRegions: [],
        }),
      ) as unknown as MockElement;

      expect(el.textContent).not.toContain('Nametable cell');
    },
  );

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

    // 7 original artifacts plus 6 additional palette artifacts.
    const artifactCards = mockEl.querySelectorAll('.delivery-artifact-card');
    expect(artifactCards.length).toBe(13);

    // Download CHR (padded 8 KiB)
    artifactCards[0]?.querySelector('.delivery-download-btn')?.click();
    expect(onDownloadBytes).toHaveBeenCalledWith(
      exportedChr,
      model.chr.output || `${model.symbolBase}.chr`,
    );

    // Download Palette
    artifactCards[1]?.querySelector('.delivery-download-btn')?.click();
    expect(onDownloadBytes).toHaveBeenCalledWith(
      exportBackgroundPaletteBinary(options.paletteState),
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
    expect(shortcutBtns.length).toBe(6);

    // Click Tileset shortcut
    shortcutBtns[0]?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('tileset');

    // Click Playfield shortcut
    shortcutBtns[1]?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('playfield');

    // Click Background shortcut
    shortcutBtns[2]?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('background');

    // Click Animation shortcut
    shortcutBtns[3]?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('animation');

    // Click Palette shortcut
    shortcutBtns[4]?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('palette');

    // Click CHR shortcut
    shortcutBtns[5]?.click();
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

  it('renders CHR Resource Accounting by Asset section and integrates ownership diagnostics', () => {
    const onNavigateWorkspace = vi.fn();

    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx < 256 ? 0 : 1,
        localIndex: idx % 256,
        origin:
          idx === 0
            ? {
                primaryAssetId: 'asset-hero',
                primaryAssetName: 'Hero Sheet',
                creationKind: 'extracted',
              }
            : idx === 10
              ? {
                  primaryAssetId: 'asset-orphan',
                  creationKind: 'extracted',
                }
              : undefined,
        usages:
          idx === 0
            ? [
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
              ]
            : [],
        usageCount: idx === 0 ? 1 : 0,
        isShared: false,
      }),
    );

    const mockMappingIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset: new Map([
        ['asset-hero', new Set([0])],
        ['asset-orphan', new Set([10])],
      ]),
      usagesByLogicalKey: new Map(),
    };

    const options = createOptions({
      chrAssetMappingIndex: mockMappingIndex,
      activeAssets: [
        {
          id: 'asset-hero',
          name: 'Hero Sheet',
          kind: 'spritesheet',
          reference: { id: 'asset-hero', path: '' },
        },
      ],
      onNavigateWorkspace,
    });

    const el = createDeliveryWorkspace(options);
    const mockEl = el as unknown as MockElement;

    // Resource accounting section should be present
    const resourcePanel = mockEl.querySelector('#section-delivery-chr-assets');
    expect(resourcePanel).not.toBeNull();

    const cards =
      resourcePanel?.querySelectorAll('.chr-asset-metric-card') ?? [];
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards[0]?.textContent).toContain('Hero Sheet');

    // Ownership diagnostic (orphan at index 10) should be included in diagnostics
    const diagItems = mockEl.querySelectorAll('.delivery-diag-item');
    const orphanDiag = diagItems.find((item) =>
      item.textContent.includes('PT0:$0A'),
    );
    expect(orphanDiag).toBeDefined();

    const fixBtn = orphanDiag?.querySelector('.delivery-diag-action');
    expect(fixBtn).not.toBeNull();
    fixBtn?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('chr');
  });

  it('aggregates palette diagnostics with existing readiness diagnostics', () => {
    const options = createOptions({
      mode: 'playfield',
      nametable: null,
      paletteState: {
        universalBackgroundColor: 0x0f,
        palettes: [
          {
            id: 'pal_valid',
            name: 'Valid',
            colors: [0x0f, 0x01, 0x11, 0x21],
            target: 'sprite',
          },
        ],
        activeBackgroundSlots: [null, null, null, null],
        activeSpriteSlots: ['pal_valid', null, null, null],
      },
      paletteAnimations: [
        {
          id: 'anim_boss',
          name: 'Boss Walk',
          paletteId: 'pal_missing',
        },
      ],
    });

    const el = createDeliveryWorkspace(options) as unknown as MockElement;
    const diagnostics = el.querySelectorAll('.delivery-diag-item');

    expect(
      diagnostics.some((item) => item.textContent.includes('pal_missing')),
    ).toBe(true);
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    expect(
      el
        .querySelector('.delivery-status-card')
        ?.classList.contains('status-error'),
    ).toBe(true);
  });

  it('does not create palette false positives for a large unused library or empty slots', () => {
    const palettes = Array.from({ length: 7 }, (_, index) => ({
      id: `pal_${String(index)}`,
      name: `Palette ${String(index)}`,
      colors: [0x0f, 0x01, 0x11, 0x21] as const,
      target: 'sprite' as const,
    }));
    const options = createOptions({
      paletteState: {
        universalBackgroundColor: 0x0f,
        palettes,
        activeBackgroundSlots: [null, null, null, null],
        activeSpriteSlots: ['pal_0', 'pal_1', 'pal_2', 'pal_3'],
      },
      paletteAnimations: [],
    });

    const el = createDeliveryWorkspace(options) as unknown as MockElement;
    expect(el.querySelectorAll('.delivery-diag-item')).toHaveLength(0);
    expect(
      el
        .querySelector('.delivery-status-card')
        ?.classList.contains('status-ready'),
    ).toBe(true);
  });

  it('downloads canonical Sprite, full PPU, C, and ca65 palette artifacts', () => {
    const onDownloadBytes = vi.fn();
    const onDownloadText = vi.fn();
    const options = createOptions({
      mode: 'tileset',
      fileName: 'tiles.png',
      onDownloadBytes,
      onDownloadText,
    });
    const element = createDeliveryWorkspace(options) as unknown as MockElement;
    const cards = element.querySelectorAll('.delivery-artifact-card');
    const findCard = (name: string): MockElement | undefined =>
      cards.find(
        (card) =>
          card.querySelector('.delivery-artifact-name')?.textContent === name,
      );

    findCard('tiles_sprites.pal')
      ?.querySelector('.delivery-download-btn')
      ?.click();
    findCard('tiles_ppu.pal')?.querySelector('.delivery-download-btn')?.click();
    findCard('tiles_palette.h')
      ?.querySelector('.delivery-download-btn')
      ?.click();
    findCard('tiles_palette.c')
      ?.querySelector('.delivery-download-btn')
      ?.click();
    findCard('tiles_palette.inc')
      ?.querySelector('.delivery-download-btn')
      ?.click();
    findCard('tiles_palette.s')
      ?.querySelector('.delivery-download-btn')
      ?.click();

    expect(onDownloadBytes).toHaveBeenNthCalledWith(
      1,
      exportSpritePaletteBinary(options.paletteState),
      'tiles_sprites.pal',
    );
    expect(onDownloadBytes).toHaveBeenNthCalledWith(
      2,
      exportFullPpuPaletteBinary(options.paletteState),
      'tiles_ppu.pal',
    );
    const c = generateCPaletteExport(options.paletteState, {
      symbolBase: 'tiles_palette',
    });
    const asm = generateCa65PaletteExport(options.paletteState, {
      symbolBase: 'tiles_palette',
    });
    expect(onDownloadText.mock.calls).toEqual([
      [c.header, c.headerFileName],
      [c.source, c.sourceFileName],
      [asm.include, asm.includeFileName],
      [asm.source, asm.sourceFileName],
    ]);
  });

  it('converts every milestone NES fact family to the correct Delivery target', () => {
    const animationModel = createOamPressureAnimationModel();
    const oamFacts = convertOamCapacityFactsToDeliveryItems(
      analyzeAnimationOamCapacity(animationModel),
    );
    const scanlineFacts = convertSpriteScanlineFactsToDeliveryItems(
      analyzeAnimationSpriteScanlinePressure(animationModel),
    );
    const visibilityFacts = convertSceneVisibilityFactsToDeliveryItems(
      analyzeSceneInstanceVisibility(
        [
          {
            id: 'scene-hero',
            animationId: 'a1',
            entityId: 'hero',
            animationName: 'Hero_idle',
            x: 20,
            y: 240,
            visible: true,
            name: 'Hero One',
          },
        ],
        animationModel.animations,
      ),
    );

    expect(oamFacts[0]).toMatchObject({
      level: 'warning',
      targetWorkspace: 'animation',
      actionLabel: 'Animation Workspace',
    });
    expect(scanlineFacts[0]).toMatchObject({ targetWorkspace: 'animation' });
    expect(visibilityFacts[0]).toMatchObject({ targetWorkspace: 'animation' });

    const nametableFacts = convertNametableChrFactsToDeliveryItems([
      {
        id: 'nametable-unallocated-tile:pt0:0-0',
        kind: 'nametable-unallocated-tile',
        severity: 'warning',
        patternTable: 0,
        startIndex: 0,
        endIndex: 0,
        startColumn: 0,
        startRow: 0,
        endColumn: 0,
        endRow: 0,
        count: 1,
        localTileIndices: [1],
        physicalTileIndices: [1],
      },
    ]);
    expect(nametableFacts[0]).toMatchObject({
      level: 'warning',
      targetWorkspace: 'chr',
      actionLabel: 'CHR Memory Workspace',
    });
  });

  it('deduplicates combined facts using highest severity in first-seen order', () => {
    const items = deduplicateDeliveryDiagnosticItems([
      { id: 'same', level: 'info', message: 'one' },
      { id: 'same', level: 'error', message: 'regression' },
      { level: 'warning', message: 'legacy' },
      { level: 'warning', message: 'legacy' },
    ]);

    expect(items).toEqual([
      { id: 'same', level: 'error', message: 'regression' },
      { level: 'warning', message: 'legacy' },
    ]);
  });

  it.each([
    ['info', 'status-ready'],
    ['warning', 'status-warning'],
    ['error', 'status-error'],
  ] as const)('maps %s-only diagnostics to %s readiness', (level, status) => {
    const el = createDeliveryWorkspace(
      createOptions({
        paletteDiagnostics: [
          {
            id: `palette-${level}`,
            kind: 'dangling-palette-reference',
            severity: level,
            paletteId: 'pal-test',
            referenceType: 'animation',
            referenceId: 'test',
          } as never,
        ],
      }),
    ) as unknown as MockElement;

    expect(
      el.querySelector('.delivery-status-card')?.classList.contains(status),
    ).toBe(true);
  });

  it.each([
    { label: 'Tileset', overrides: { mode: 'tileset', chr: null } },
    { label: 'Playfield', overrides: { mode: 'playfield', nametable: null } },
    {
      label: 'Animation',
      overrides: { mode: 'animation', animationModel: null },
    },
  ] as const)(
    'blocks $label readiness when its primary production model is absent',
    ({ overrides }) => {
      const el = createDeliveryWorkspace(
        createOptions(overrides),
      ) as unknown as MockElement;

      expect(
        el
          .querySelector('.delivery-status-card')
          ?.classList.contains('status-error'),
      ).toBe(true);
    },
  );

  it('integrates Attribute Table facts from compiled Background identity', () => {
    const baseMap = createEmptyBackgroundMap({ id: 'bg-stage' });
    const cells = [...baseMap.cells];
    cells[0] = {
      logicalKey: 'asset-playfield-default:0:0',
      tileX: 0,
      tileY: 0,
    };
    cells[1] = {
      logicalKey: 'asset-playfield-default:1:0',
      tileX: 1,
      tileY: 0,
    };
    const map = { ...baseMap, cells };
    const backgroundModel = buildBackgroundProjectModel({
      map,
      tileMap: new Map([
        [
          'asset-playfield-default:0:0',
          { id: 0, column: 0, row: 0, pixels: new Uint8Array(64) },
        ],
        [
          'asset-playfield-default:1:0',
          { id: 1, column: 1, row: 0, pixels: new Uint8Array(64).fill(1) },
        ],
      ]),
    });
    const onNavigateWorkspace = vi.fn();
    const el = createDeliveryWorkspace(
      createOptions({
        mode: 'playfield',
        nametable: new Uint8Array(960),
        attributeTable: new Uint8Array(64),
        collisionMap: new Uint8Array(480),
        backgroundModel,
        backgroundPaletteContexts: new Map([
          ['asset-playfield-default:0:0', 0],
          ['asset-playfield-default:1:0', 2],
        ]),
        onNavigateWorkspace,
      }),
    ) as unknown as MockElement;
    const diagnostic = el
      .querySelectorAll('.delivery-diag-item')
      .find((item) => item.textContent.includes('palette contexts 0, 2'));

    expect(diagnostic?.classList.contains('is-info')).toBe(true);
    expect(
      el
        .querySelector('.delivery-status-card')
        ?.classList.contains('status-ready'),
    ).toBe(true);
    diagnostic?.querySelector('.delivery-diag-action')?.click();
    expect(onNavigateWorkspace).toHaveBeenCalledWith('background');
  });

  it.each(['chr', 'nametable', 'attributeTable', 'collisionMap'] as const)(
    'blocks Playfield readiness when %s is absent',
    (field) => {
      const complete = createOptions({
        mode: 'playfield',
        chr: new Uint8Array(8192),
        nametable: new Uint8Array(960),
        attributeTable: new Uint8Array(64),
        collisionMap: new Uint8Array(480),
      });
      const el = createDeliveryWorkspace({
        ...complete,
        [field]: null,
      }) as unknown as MockElement;

      expect(
        el
          .querySelector('.delivery-status-card')
          ?.classList.contains('status-error'),
      ).toBe(true);
      expect(el.textContent).toContain('Required production artifacts');
    },
  );
});
