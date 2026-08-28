import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAnimationProjectModel } from '../core/animation-model';
import { createDefaultNesPaletteSet } from '../core/nes-palette';
import {
  resolveEffectivePaletteColors,
  resolveEffectiveSpritePaletteIndex,
  resolveSpritePaletteSlot,
  type PaletteDefinition,
} from '../core/palette-manager';
import { renderIndexedImageWithPalette } from '../core/animation-palette';
import type { IndexedImage } from '../core/types';
import {
  createAnimationEditor,
  resolveAnimationSetting,
  type AnimationEditorOptions,
} from './animation-editor';
import {
  createScenePreviewPlaybackSession,
  disposeScenePreviewPanels,
} from './scene-preview-panel';
import type { AnimationItemSetting, AnimationSettings } from './types';
import { setLocale } from '../i18n';

class MockElement {
  tagName: string;
  className = '';
  hidden = false;
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
  tabIndex = -1;
  width = 0;
  height = 0;
  style: Record<string, string> = {};
  capturedPointerIds = new Set<number>();

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

  removeEventListener(event: string, handler: (e?: unknown) => void) {
    const list = this.eventListeners.get(event) ?? [];
    this.eventListeners.set(
      event,
      list.filter((candidate) => candidate !== handler),
    );
  }

  dispatchEvent(event: { type: string }) {
    const handlers = this.eventListeners.get(event.type) ?? [];
    handlers.forEach((fn) => {
      fn(event);
    });
  }

  focus() {
    const mockDocument = (
      globalThis as unknown as {
        document: { activeElement?: MockElement };
      }
    ).document;
    mockDocument.activeElement = this;
  }

  setPointerCapture(pointerId: number) {
    this.capturedPointerIds.add(pointerId);
  }

  hasPointerCapture(pointerId: number) {
    return this.capturedPointerIds.has(pointerId);
  }

  releasePointerCapture(pointerId: number) {
    this.capturedPointerIds.delete(pointerId);
  }

  click() {
    const handlers = this.eventListeners.get('click') ?? [];
    handlers.forEach((fn) => {
      fn({
        stopPropagation: () => {
          /* no-op */
        },
      });
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
        save: noop,
        restore: noop,
        scale: noop,
        translate: noop,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        imageSmoothingEnabled: false,
        setLineDash: noop,
      };
    }
    return null;
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: this.width || 256,
      height: this.height || 240,
    };
  }
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

function singleTileImage(): IndexedImage {
  const pixels = new Uint8Array(64);
  pixels[0] = 1;
  return {
    width: 8,
    height: 8,
    pixels,
    colors: [null, null, null, null],
    transparentIndex: 0,
    colorCount: 4,
  };
}

function createSampleRawImage(width = 8, height = 8) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = 0x00;
    data[i * 4 + 1] = 0x00;
    data[i * 4 + 2] = 0x00;
    data[i * 4 + 3] = 0xff;
  }
  return { width, height, data };
}

function createSampleAnimation(
  id: string,
  name: string,
  entity = 'hero',
): AnimationItemSetting {
  const img = singleTileImage();
  return {
    id,
    entity,
    name,
    source: {
      fileName: `${name}.png`,
      sourceImage: createSampleRawImage(8, 8) as unknown as ImageData,
      indexedImage: img,
    },
    paletteId: null,
    paletteIndex: 0,
    quantizationMode: 'median-cut',
    ditheringMode: 'none',
    frameWidth: 8,
    frameHeight: 8,
    originX: 0,
    originY: 0,
    playback: 'loop',
    allowHorizontalFlip: false,
    allowVerticalFlip: false,
    defaultDuration: 8,
    frameIndices: [0],
    frameDurations: [8],
    framePalettes: [null],
  };
}

describe('animation mapping identity', () => {
  it('resolves raw settings by stable id when the model name is composite', () => {
    const setting = createSampleAnimation('anim-walk', 'walk', 'hero');
    const model = buildAnimationProjectModel({
      name: 'hero',
      animations: [
        {
          id: setting.id,
          name: 'hero_walk',
          image: singleTileImage(),
          frameWidth: setting.frameWidth,
          frameHeight: setting.frameHeight,
          frameIndices: setting.frameIndices,
          frameDuration: setting.defaultDuration,
        },
      ],
    });
    const animation = model.animations[0];

    expect(animation?.name).toBe('hero_walk');
    expect(animation?.id).toBe('anim-walk');
    expect(animation && resolveAnimationSetting([setting], animation)).toBe(
      setting,
    );
  });
});

describe('Animation Editor Split Architecture', () => {
  beforeEach(() => {
    setLocale('en');
    (
      globalThis as unknown as {
        document: unknown;
        ImageData: unknown;
        window: unknown;
        MutationObserver: unknown;
      }
    ).document = {
      createElement: (tagName: string) => new MockElement(tagName),
      body: new MockElement('body'),
      activeElement: null,
    };
    (globalThis as unknown as { ImageData: unknown }).ImageData = MockImageData;
    (
      globalThis as unknown as {
        requestAnimationFrame: (fn: () => void) => number;
        cancelAnimationFrame: (id: number) => void;
      }
    ).requestAnimationFrame = () => 1;
    (
      globalThis as unknown as {
        cancelAnimationFrame: (id: number) => void;
      }
    ).cancelAnimationFrame = () => {
      /* no-op */
    };
    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver =
      class {
        observe() {
          /* no-op */
        }
        disconnect() {
          /* no-op */
        }
      };
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: () => {
        /* no-op */
      },
      removeEventListener: () => {
        /* no-op */
      },
      setTimeout: () => 1,
      clearTimeout: () => {
        /* no-op */
      },
    };
  });

  const basePaletteSet = createDefaultNesPaletteSet();
  const palettes: readonly PaletteDefinition[] = basePaletteSet.map(
    (colors, index) => ({
      id: `pal_${String(index)}`,
      name: `Sprite ${String(index)}`,
      colors,
      target: 'sprite',
    }),
  );

  function createOptions(
    overrides: Partial<AnimationEditorOptions> = {},
  ): AnimationEditorOptions {
    const anim1 = createSampleAnimation('anim-1', 'idle', 'hero');
    const anim2 = createSampleAnimation('anim-2', 'walk', 'hero');

    const settings: AnimationSettings = {
      name: 'hero',
      symbolPrefix: 'hero',
      destinationChr: new Uint8Array(8192),
      destinationChrName: null,
      patternTable: 0,
      destinationPatternTable: 0,
      flipDeduplication: false,
      defaultPaletteIndex: 0,
      spritePalette: 0,
      spriteColorIndex: 0,
      colorIndices: new Uint8Array(4),
      quantizationMode: 'median-cut',
      ditheringMode: 'none',
      animations: [anim1, anim2],
    };

    const model = buildAnimationProjectModel({
      name: 'hero',
      animations: [
        {
          id: anim1.id,
          name: 'hero_idle',
          image: singleTileImage(),
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 8,
        },
        {
          id: anim2.id,
          name: 'hero_walk',
          image: singleTileImage(),
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 8,
        },
      ],
    });

    return {
      settings,
      selectedAnimationId: 'anim-1',
      activeTab: 'frames',
      model,
      modelError: null,
      spritePaletteSet: basePaletteSet,
      palettes,
      activeSpriteSlots: [
        palettes[0]?.id ?? null,
        palettes[1]?.id ?? null,
        palettes[2]?.id ?? null,
        palettes[3]?.id ?? null,
      ],
      onSelectAnimation: vi.fn(),
      onSelectTab: vi.fn(),
      onSettingsChange: vi.fn(),
      onAddAnimation: vi.fn(),
      onDuplicateAnimation: vi.fn(),
      onRemoveAnimation: vi.fn(),
      onToggleMappingCollapse: vi.fn(),
      onToggleConfigCollapse: vi.fn(),
      onTogglePaletteCollapse: vi.fn(),
      onAddSceneInstance: vi.fn(),
      onRemoveSceneInstance: vi.fn(),
      onReorderSceneInstance: vi.fn(),
      onUpdateSceneInstance: vi.fn(),
      onSetTilePixel: vi.fn(),
      onResetTileOverride: vi.fn(),
      onUpdateAnimation: vi.fn(),
      onAnimationSourceFile: vi.fn(),
      onFrameDetection: vi.fn(),
      onFrameToggle: vi.fn(),
      onFrameMove: vi.fn(),
      onFrameDurationChange: vi.fn(),
      onFramePaletteChange: vi.fn(),
      onApplyDefaultDurationToAll: vi.fn(),
      onFrameRemoveFromAnimation: vi.fn(),
      onSpritePaletteSelectionChange: vi.fn(),
      onDestinationFile: vi.fn(),
      onDestinationClear: vi.fn(),
      onDownloadBytes: vi.fn(),
      onDownloadText: vi.fn(),
      ...overrides,
    };
  }

  it('renders all section panels in proper order including list and selected editor', () => {
    const options = createOptions();
    const panels = createAnimationEditor(options);

    const ids = panels.map((p) => p.id);
    expect(ids).toEqual([
      'section-asset',
      'section-palettes',
      'section-animations',
      'section-animation-editor',
      'section-mapping',
      'section-export',
    ]);

    expect(
      panels.some((panel) => panel.classList.contains('scene-preview-panel')),
    ).toBe(false);
  });

  it('renders animation list panel with compact cards for all animations', () => {
    const options = createOptions();
    const panels = createAnimationEditor(options);
    const listPanel = panels.find((p) => p.id === 'section-animations');
    expect(listPanel).toBeDefined();
    const mockList = listPanel as unknown as MockElement;

    const cards = mockList.querySelectorAll('.animation-list-card');
    expect(cards.length).toBe(2);

    // First card is selected
    expect(cards[0]?.classList.contains('is-selected')).toBe(true);
    expect(cards[0]?.querySelector('.animation-selected-badge')).not.toBeNull();
    expect(cards[0]?.querySelector('.animation-select-btn')).toBeNull();

    // Second card is not selected and has select button
    expect(cards[1]?.classList.contains('is-selected')).toBe(false);
    expect(cards[1]?.querySelector('.animation-selected-badge')).toBeNull();
    const selectBtn = cards[1]?.querySelector('.animation-select-btn');
    expect(selectBtn).not.toBeNull();

    // Clicking select button calls onSelectAnimation with 'anim-2'
    selectBtn?.click();
    expect(options.onSelectAnimation).toHaveBeenCalledWith('anim-2');
  });

  it('only renders the selected animation editor, not expanding all animations simultaneously', () => {
    const options = createOptions({ selectedAnimationId: 'anim-2' });
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find((p) => p.id === 'section-animation-editor');
    expect(editorPanel).toBeDefined();
    const mockEditor = editorPanel as unknown as MockElement;

    // Header title indicates selected animation
    expect(mockEditor.textContent).toContain('hero_walk');
    expect(mockEditor.textContent).not.toContain('hero_idle');

    // Exactly one sticky preview is present in the workspace
    const stickyPreviews = mockEditor.querySelectorAll(
      '.animation-sticky-preview',
    );
    expect(stickyPreviews.length).toBe(1);

    // Preview canvas is for the selected animation
    const canvas = stickyPreviews[0]?.querySelector(
      '.animation-preview-canvas',
    );
    expect(canvas?.getAttribute('aria-label')).toContain('walk');
  });

  it('renders contextual tabs and triggers onSelectTab when clicked', () => {
    const onSelectTab = vi.fn();
    const options = createOptions({ onSelectTab, activeTab: 'frames' });
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find((p) => p.id === 'section-animation-editor');
    expect(editorPanel).toBeDefined();
    const mockEditor = editorPanel as unknown as MockElement;

    const tabButtons = mockEditor.querySelectorAll('.animation-tab-btn');
    expect(tabButtons.length).toBe(4);

    // Active tab button has is-active class
    expect(tabButtons[0]?.classList.contains('is-active')).toBe(true);
    expect(tabButtons[1]?.classList.contains('is-active')).toBe(false);
    expect(tabButtons[2]?.classList.contains('is-active')).toBe(false);
    expect(tabButtons[3]?.classList.contains('is-active')).toBe(false);

    // Clicking pixels tab triggers onSelectTab('pixels')
    tabButtons[1]?.click();
    expect(onSelectTab).toHaveBeenCalledWith('pixels');

    // Clicking mapping tab triggers onSelectTab('mapping')
    tabButtons[2]?.click();
    expect(onSelectTab).toHaveBeenCalledWith('mapping');

    // Clicking scene tab triggers onSelectTab('scene')
    tabButtons[3]?.click();
    expect(onSelectTab).toHaveBeenCalledWith('scene');
  });

  it('renders frame grid and order list when activeTab is frames', () => {
    const options = createOptions({ activeTab: 'frames' });
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find((p) => p.id === 'section-animation-editor');
    expect(editorPanel).toBeDefined();
    const mockEditor = editorPanel as unknown as MockElement;

    expect(mockEditor.querySelector('.animation-card-fields')).not.toBeNull();
    expect(
      mockEditor.querySelector('.animation-card-grid-container'),
    ).not.toBeNull();
    expect(mockEditor.querySelector('.animation-order-group')).not.toBeNull();
    expect(
      mockEditor.querySelector('.animation-tile-pixel-section'),
    ).toBeNull();
    expect(mockEditor.querySelector('.animation-selected-mapping')).toBeNull();
  });

  it('renders tile pixel editor when activeTab is pixels', () => {
    const options = createOptions({ activeTab: 'pixels' });
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find((p) => p.id === 'section-animation-editor');
    expect(editorPanel).toBeDefined();
    const mockEditor = editorPanel as unknown as MockElement;

    expect(mockEditor.querySelector('.animation-card-fields')).toBeNull();
    expect(
      mockEditor.querySelector('.animation-tile-pixel-section'),
    ).not.toBeNull();
    expect(mockEditor.querySelector('.animation-selected-mapping')).toBeNull();
  });

  it('renders metasprite mapping when activeTab is mapping', () => {
    const options = createOptions({ activeTab: 'mapping' });
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find((p) => p.id === 'section-animation-editor');
    expect(editorPanel).toBeDefined();
    const mockEditor = editorPanel as unknown as MockElement;

    expect(mockEditor.querySelector('.animation-card-fields')).toBeNull();
    expect(
      mockEditor.querySelector('.animation-tile-pixel-section'),
    ).toBeNull();
    expect(
      mockEditor.querySelector('.animation-selected-mapping'),
    ).not.toBeNull();
  });

  it('wires up animation list add, duplicate, and remove actions', () => {
    const onAddAnimation = vi.fn();
    const onDuplicateAnimation = vi.fn();
    const onRemoveAnimation = vi.fn();

    const options = createOptions({
      onAddAnimation,
      onDuplicateAnimation,
      onRemoveAnimation,
    });
    const panels = createAnimationEditor(options);
    const listPanel = panels.find((p) => p.id === 'section-animations');
    expect(listPanel).toBeDefined();
    const mockList = listPanel as unknown as MockElement;

    // Add button
    const addBtn = mockList.querySelector('.animation-list-header button');
    addBtn?.click();
    expect(onAddAnimation).toHaveBeenCalled();

    // Duplicate button on first card
    const card = mockList.querySelectorAll('.animation-list-card')[0];
    expect(card).toBeDefined();
    const buttons =
      card?.querySelectorAll('.animation-list-card-actions button') ?? [];
    const dupBtn = buttons.find(
      (b) =>
        b.textContent.includes('Duplicate') ||
        b.textContent.includes('Duplicar'),
    );
    dupBtn?.click();
    expect(onDuplicateAnimation).toHaveBeenCalledWith('anim-1');

    // Remove button on first card
    const removeBtn = buttons.find(
      (b) =>
        b.textContent.includes('Remove') || b.textContent.includes('Remover'),
    );
    removeBtn?.click();
    expect(onRemoveAnimation).toHaveBeenCalledWith('anim-1');
  });

  it('triggers onUpdateAnimation when editing properties fields in selected animation', () => {
    const onUpdateAnimation = vi.fn();
    const options = createOptions({ onUpdateAnimation, activeTab: 'frames' });
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find((p) => p.id === 'section-animation-editor');
    expect(editorPanel).toBeDefined();
    const mockEditor = editorPanel as unknown as MockElement;

    const inputs = mockEditor.querySelectorAll('.animation-card-fields input');
    const nameInput = inputs.find((i) => i.value === 'idle');
    expect(nameInput).toBeDefined();

    if (nameInput) {
      nameInput.value = 'idle_run';
      nameInput.dispatchEvent({ type: 'change' });
      expect(onUpdateAnimation).toHaveBeenCalledWith('anim-1', {
        name: 'idle_run',
      });
    }
  });

  it('renders high-confidence frame detection with applied status', () => {
    const animWithHighConfidence = {
      ...createSampleAnimation('anim-1', 'idle', 'hero'),
      frameWidth: 16,
      frameHeight: 16,
      frameDetection: {
        recommendedWidth: 16,
        recommendedHeight: 16,
        confidence: 'high' as const,
        candidates: [],
      },
    };
    const options = createOptions({
      settings: {
        ...createOptions().settings,
        animations: [animWithHighConfidence],
      },
      selectedAnimationId: 'anim-1',
      activeTab: 'frames',
    });
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find((p) => p.id === 'section-animation-editor');
    expect(editorPanel).toBeDefined();
    const mockEditor = editorPanel as unknown as MockElement;

    const detectionCard = mockEditor.querySelector('.animation-detection-card');
    expect(detectionCard).not.toBeNull();

    const confidenceBadge = mockEditor.querySelector(
      '.animation-detection-badge',
    );
    expect(confidenceBadge).not.toBeNull();
    expect(confidenceBadge?.classList.contains('badge-confidence-high')).toBe(
      true,
    );

    const appliedStatus = mockEditor.querySelector(
      '.animation-detection-applied-status',
    );
    expect(appliedStatus).not.toBeNull();
    expect(
      mockEditor.querySelector('.animation-apply-detection-btn'),
    ).toBeNull();
  });

  it('renders medium/low-confidence detection with suggestion and apply button when custom dimensions differ', () => {
    const onUpdateAnimation = vi.fn();
    const animWithMediumConfidence = {
      ...createSampleAnimation('anim-1', 'idle', 'hero'),
      frameWidth: 24,
      frameHeight: 24,
      frameDetection: {
        recommendedWidth: 16,
        recommendedHeight: 16,
        confidence: 'medium' as const,
        candidates: [],
      },
    };
    const options = createOptions({
      settings: {
        ...createOptions().settings,
        animations: [animWithMediumConfidence],
      },
      selectedAnimationId: 'anim-1',
      activeTab: 'frames',
      onUpdateAnimation,
    });
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find((p) => p.id === 'section-animation-editor');
    expect(editorPanel).toBeDefined();
    const mockEditor = editorPanel as unknown as MockElement;

    const confidenceBadge = mockEditor.querySelector(
      '.animation-detection-badge',
    );
    expect(confidenceBadge).not.toBeNull();
    expect(confidenceBadge?.classList.contains('badge-confidence-medium')).toBe(
      true,
    );

    const customStatus = mockEditor.querySelector(
      '.animation-detection-custom-status',
    );
    expect(customStatus).not.toBeNull();

    const suggestedInfo = mockEditor.querySelector(
      '.animation-detection-suggested-info',
    );
    expect(suggestedInfo).not.toBeNull();

    const applyBtn = mockEditor.querySelector('.animation-apply-detection-btn');
    expect(applyBtn).not.toBeNull();

    applyBtn?.click();
    expect(onUpdateAnimation).toHaveBeenCalledWith('anim-1', {
      frameWidth: 16,
      frameHeight: 16,
    });
  });

  it('triggers onFrameDetection when clicking retry detect button', () => {
    const onFrameDetection = vi.fn();
    const anim = {
      ...createSampleAnimation('anim-1', 'idle', 'hero'),
      frameDetection: {
        recommendedWidth: 8,
        recommendedHeight: 8,
        confidence: 'low' as const,
        candidates: [],
      },
    };
    const options = createOptions({
      settings: {
        ...createOptions().settings,
        animations: [anim],
      },
      selectedAnimationId: 'anim-1',
      activeTab: 'frames',
      onFrameDetection,
    });
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find((p) => p.id === 'section-animation-editor');
    expect(editorPanel).toBeDefined();
    const mockEditor = editorPanel as unknown as MockElement;

    const detectBtn = mockEditor.querySelector('.animation-detect-btn');
    expect(detectBtn).not.toBeNull();
    detectBtn?.click();
    expect(onFrameDetection).toHaveBeenCalledWith('anim-1');
  });

  it('renders Scene Preview subworkspace with persistent canvas, instance list, and contextual inspector when activeTab is scene', () => {
    const onSelectSceneInstance = vi.fn();
    const onUpdateSceneInstance = vi.fn();
    const onDuplicateSceneInstance = vi.fn();
    const onRemoveSceneInstance = vi.fn();

    const options = createOptions({
      activeTab: 'scene',
      selectedSceneInstanceId: 'inst-1',
      scenePreview: {
        instances: [
          {
            id: 'inst-1',
            animationId: 'anim-1',
            entityId: 'hero',
            animationName: 'idle',
            x: 100,
            y: 120,
            visible: true,
            name: 'Hero Player',
          },
          {
            id: 'inst-2',
            animationId: 'anim-2',
            entityId: 'hero',
            animationName: 'walk',
            x: 150,
            y: 120,
            visible: false,
            name: 'Hero Ghost',
          },
        ],
      },
      onSelectSceneInstance,
      onUpdateSceneInstance,
      onDuplicateSceneInstance,
      onRemoveSceneInstance,
    });

    const panels = createAnimationEditor(options);
    const editorPanel = panels.find((p) => p.id === 'section-animation-editor');
    expect(editorPanel).toBeDefined();
    const mockEditor = editorPanel as unknown as MockElement;

    // Canvas is rendered
    const canvas = mockEditor.querySelector('.scene-preview-canvas');
    expect(canvas).not.toBeNull();

    // Instances list is rendered with 2 cards
    const instanceCards = mockEditor.querySelectorAll(
      '.scene-preview-instance-card',
    );
    expect(instanceCards.length).toBe(2);
    expect(instanceCards[0]?.classList.contains('is-selected')).toBe(true);
    expect(instanceCards[1]?.classList.contains('is-selected')).toBe(false);
    const focusTargets = mockEditor.querySelectorAll(
      '.scene-preview-instance-focus-target',
    );
    expect(focusTargets.length).toBe(2);
    expect(focusTargets[0]?.tagName).toBe('BUTTON');
    expect(focusTargets[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(focusTargets[0]?.getAttribute('aria-label')).toContain(
      'Hero Player, X 100, Y 120, layer 1 of 2',
    );
    expect(
      instanceCards[0]
        ?.querySelector('.scene-preview-vis-btn')
        ?.getAttribute('aria-label'),
    ).toContain('Hero Player');

    // Inspector is rendered for inst-1
    const inspector = mockEditor.querySelector(
      '.scene-preview-inspector-wrapper',
    );
    expect(inspector).not.toBeNull();
    expect(inspector?.querySelector('input')?.value).toBe('Hero Player');

    // Clicking second card selects inst-2
    instanceCards[1]?.click();
    expect(onSelectSceneInstance).toHaveBeenCalledWith('inst-2');

    // Toggle visibility on card 1
    const visBtn = instanceCards[0]?.querySelector('.scene-preview-vis-btn');
    visBtn?.click();
    expect(onUpdateSceneInstance).toHaveBeenCalledWith('inst-1', {
      visible: false,
    });

    // Inspector duplicate button (now operating on inst-2)
    const duplicateBtn = mockEditor.querySelector(
      '.scene-preview-inspector-actions button',
    );
    duplicateBtn?.click();
    expect(onDuplicateSceneInstance).toHaveBeenCalledWith('inst-2');
  });

  it('preserves transient playback across Scene subworkspace rerenders', () => {
    const playbackSession = createScenePreviewPlaybackSession();
    const base = createOptions();
    const baseAnimation = base.settings.animations[0];
    expect(baseAnimation).toBeDefined();
    if (baseAnimation === undefined) return;
    const animation: AnimationItemSetting = {
      ...baseAnimation,
      frameIndices: [0, 0],
      frameDurations: [1, 1],
    };
    const instance = {
      id: 'persistent-playback',
      animationId: animation.id,
      entityId: animation.entity ?? 'hero',
      animationName: animation.name,
      x: 0,
      y: 0,
      visible: true,
    };
    const options = createOptions({
      activeTab: 'scene',
      settings: { ...base.settings, animations: [animation] },
      scenePreview: { instances: [instance] },
      scenePreviewPlaybackSession: playbackSession,
    });

    createAnimationEditor(options);
    playbackSession.advance([instance], [animation], 1);
    expect(
      playbackSession.playbackStates.get(instance.id)?.currentFrameIndex,
    ).toBe(1);

    const firstRerender = createAnimationEditor(options);
    const firstEditor = firstRerender.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    firstEditor.querySelector('.scene-preview-toolbar button')?.click();

    const secondRerender = createAnimationEditor(options);
    const secondEditor = secondRerender.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    expect(playbackSession.playing).toBe(false);
    expect(
      playbackSession.playbackStates.get(instance.id)?.currentFrameIndex,
    ).toBe(1);
    expect(
      secondEditor.querySelector('.scene-preview-toolbar button')?.textContent,
    ).toBe('Play');
  });

  it('cancels Scene RAF and removes pointer listeners during explicit teardown', () => {
    const cancelAnimationFrame = vi.fn();
    const addEventListener = vi.fn(
      (event: string, handler: EventListener): void => {
        void event;
        void handler;
      },
    );
    const removeEventListener = vi.fn(
      (event: string, handler: EventListener): void => {
        void event;
        void handler;
      },
    );
    (
      globalThis as unknown as {
        requestAnimationFrame: (fn: () => void) => number;
        cancelAnimationFrame: (id: number) => void;
        window: unknown;
      }
    ).requestAnimationFrame = () => 42;
    (
      globalThis as unknown as {
        cancelAnimationFrame: (id: number) => void;
      }
    ).cancelAnimationFrame = cancelAnimationFrame;
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener,
      removeEventListener,
    };

    const panels = createAnimationEditor(createOptions({ activeTab: 'scene' }));
    const body = (globalThis as unknown as { document: { body: MockElement } })
      .document.body;
    body.append(...(panels as unknown as MockElement[]));

    disposeScenePreviewPanels(body as unknown as ParentNode);
    disposeScenePreviewPanels(body as unknown as ParentNode);

    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    expect(addEventListener).not.toHaveBeenCalled();
    expect(removeEventListener).not.toHaveBeenCalled();
    const canvas = body.querySelector('.scene-preview-canvas');
    expect(canvas?.eventListeners.get('pointerdown')).toEqual([]);
    expect(canvas?.eventListeners.get('pointermove')).toEqual([]);
    expect(canvas?.eventListeners.get('pointerup')).toEqual([]);
    expect(canvas?.eventListeners.get('pointercancel')).toEqual([]);
  });

  it('previews canvas dragging locally and commits one project update on pointerup', () => {
    const onUpdateSceneInstance = vi.fn();
    const instance = {
      id: 'dragged-instance',
      animationId: 'anim-1',
      entityId: 'hero',
      animationName: 'idle',
      x: 0,
      y: 0,
      visible: true,
    };
    const panels = createAnimationEditor(
      createOptions({
        activeTab: 'scene',
        selectedSceneInstanceId: instance.id,
        scenePreview: { instances: [instance] },
        onUpdateSceneInstance,
      }),
    );
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const canvas = editor.querySelector('.scene-preview-canvas');

    canvas?.dispatchEvent({
      type: 'pointerdown',
      clientX: 1,
      clientY: 1,
      button: 0,
      pointerId: 7,
      preventDefault: vi.fn(),
    } as unknown as { type: string });
    canvas?.dispatchEvent({
      type: 'pointermove',
      clientX: 20,
      clientY: 30,
      pointerId: 7,
      preventDefault: vi.fn(),
    } as unknown as { type: string });
    expect(onUpdateSceneInstance).not.toHaveBeenCalled();

    canvas?.dispatchEvent({
      type: 'pointerup',
      pointerId: 7,
    } as unknown as { type: string });
    expect(onUpdateSceneInstance).toHaveBeenCalledOnce();
    expect(onUpdateSceneInstance).toHaveBeenCalledWith(instance.id, {
      anchorX: 19,
      anchorY: 29,
      x: 19,
      y: 29,
    });
  });

  it('moves a focused Scene instance by keyboard using canonical anchor coordinates', () => {
    const base = createOptions();
    const baseAnimation = base.settings.animations[0];
    expect(baseAnimation).toBeDefined();
    if (baseAnimation === undefined) return;
    const animation = {
      ...baseAnimation,
      originX: 4,
      originY: 6,
    };
    const instance = {
      id: 'keyboard-instance',
      animationId: animation.id,
      entityId: 'hero',
      animationName: animation.name,
      x: 10,
      y: 20,
      anchorX: 14,
      anchorY: 26,
      visible: true,
      name: 'Keyboard Hero',
    };
    const onUpdateSceneInstance = vi.fn();
    const panels = createAnimationEditor(
      createOptions({
        activeTab: 'scene',
        settings: { ...base.settings, animations: [animation] },
        selectedSceneInstanceId: instance.id,
        scenePreview: { instances: [instance] },
        onUpdateSceneInstance,
      }),
    );
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const card = editor.querySelector('.scene-preview-instance-focus-target');
    const preventDefault = vi.fn();

    card?.dispatchEvent({
      type: 'keydown',
      key: 'ArrowRight',
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      target: card,
      preventDefault,
    } as unknown as { type: string });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onUpdateSceneInstance).toHaveBeenCalledWith(instance.id, {
      anchorX: 15,
      anchorY: 26,
      x: 11,
      y: 20,
    });
  });

  it('deletes and reorders focused Scene instances with scoped shortcuts', () => {
    const instances = [
      {
        id: 'back',
        animationId: 'anim-1',
        entityId: 'hero',
        animationName: 'idle',
        x: 0,
        y: 0,
        visible: true,
      },
      {
        id: 'front',
        animationId: 'anim-2',
        entityId: 'hero',
        animationName: 'walk',
        x: 8,
        y: 0,
        visible: true,
      },
    ];
    const onRemoveSceneInstance = vi.fn();
    const onReorderSceneInstance = vi.fn();
    const panels = createAnimationEditor(
      createOptions({
        activeTab: 'scene',
        selectedSceneInstanceId: 'back',
        scenePreview: { instances },
        onRemoveSceneInstance,
        onReorderSceneInstance,
      }),
    );
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const cards = editor.querySelectorAll(
      '.scene-preview-instance-focus-target',
    );
    const backCard = cards[0];

    backCard?.dispatchEvent({
      type: 'keydown',
      key: 'ArrowUp',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      target: backCard,
      preventDefault: vi.fn(),
    } as unknown as { type: string });
    expect(onReorderSceneInstance).toHaveBeenCalledWith('back', 'forward');

    backCard?.dispatchEvent({
      type: 'keydown',
      key: 'Delete',
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      target: backCard,
      preventDefault: vi.fn(),
    } as unknown as { type: string });
    expect(onRemoveSceneInstance).toHaveBeenCalledWith('back');
  });

  it('preserves instance-card focus across a keyboard movement rerender', async () => {
    const instance = {
      id: 'focus-instance',
      animationId: 'anim-1',
      entityId: 'hero',
      animationName: 'idle',
      x: 0,
      y: 0,
      visible: true,
    };
    let rerenderedEditor: MockElement | null = null;
    const onUpdateSceneInstance = vi.fn(
      (_instanceId: string, patch: Partial<typeof instance>) => {
        const nextInstance = { ...instance, ...patch };
        const panels = createAnimationEditor({
          ...options,
          scenePreview: { instances: [nextInstance] },
        });
        rerenderedEditor = panels.find(
          (panel) => panel.id === 'section-animation-editor',
        ) as unknown as MockElement;
      },
    );
    const options = createOptions({
      activeTab: 'scene',
      selectedSceneInstanceId: instance.id,
      scenePreview: { instances: [instance] },
      onUpdateSceneInstance,
    });
    const panels = createAnimationEditor(options);
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const card = editor.querySelector('.scene-preview-instance-focus-target');

    card?.dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      target: card,
      preventDefault: vi.fn(),
    } as unknown as { type: string });
    await Promise.resolve();

    const focused = (
      globalThis as unknown as { document: { activeElement: MockElement } }
    ).document.activeElement;
    expect(rerenderedEditor).not.toBeNull();
    expect(focused.getAttribute('data-scene-instance-id')).toBe(instance.id);
  });

  it('does not run Scene shortcuts from text, number, or select controls', () => {
    const onUpdateSceneInstance = vi.fn();
    const onRemoveSceneInstance = vi.fn();
    const panels = createAnimationEditor(
      createOptions({
        activeTab: 'scene',
        selectedSceneInstanceId: 'scoped',
        scenePreview: {
          instances: [
            {
              id: 'scoped',
              animationId: 'anim-1',
              entityId: 'hero',
              animationName: 'idle',
              x: 0,
              y: 0,
              visible: true,
            },
          ],
        },
        onUpdateSceneInstance,
        onRemoveSceneInstance,
      }),
    );
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const card = editor.querySelector('.scene-preview-instance-focus-target');

    for (const tagName of ['input', 'textarea', 'select']) {
      const control = new MockElement(tagName);
      card?.dispatchEvent({
        type: 'keydown',
        key: tagName === 'select' ? 'Delete' : 'ArrowLeft',
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        target: control,
        preventDefault: vi.fn(),
      } as unknown as { type: string });
    }

    expect(onUpdateSceneInstance).not.toHaveBeenCalled();
    expect(onRemoveSceneInstance).not.toHaveBeenCalled();
  });

  it('uses the same anchor-aware position patch for pointer and keyboard movement', () => {
    const instance = {
      id: 'parity-instance',
      animationId: 'anim-1',
      entityId: 'hero',
      animationName: 'idle',
      x: 0,
      y: 0,
      visible: true,
    };
    const pointerUpdate = vi.fn();
    const pointerPanels = createAnimationEditor(
      createOptions({
        activeTab: 'scene',
        selectedSceneInstanceId: instance.id,
        scenePreview: { instances: [instance] },
        onUpdateSceneInstance: pointerUpdate,
      }),
    );
    const pointerEditor = pointerPanels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const canvas = pointerEditor.querySelector('.scene-preview-canvas');
    canvas?.dispatchEvent({
      type: 'pointerdown',
      clientX: 0,
      clientY: 0,
      button: 0,
      pointerId: 3,
      preventDefault: vi.fn(),
    } as unknown as { type: string });
    canvas?.dispatchEvent({
      type: 'pointermove',
      clientX: 1,
      clientY: 0,
      pointerId: 3,
      preventDefault: vi.fn(),
    } as unknown as { type: string });
    canvas?.dispatchEvent({
      type: 'pointerup',
      pointerId: 3,
    } as unknown as { type: string });

    const keyboardUpdate = vi.fn();
    const keyboardPanels = createAnimationEditor(
      createOptions({
        activeTab: 'scene',
        selectedSceneInstanceId: instance.id,
        scenePreview: { instances: [instance] },
        onUpdateSceneInstance: keyboardUpdate,
      }),
    );
    const keyboardEditor = keyboardPanels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const card = keyboardEditor.querySelector(
      '.scene-preview-instance-focus-target',
    );
    card?.dispatchEvent({
      type: 'keydown',
      key: 'ArrowRight',
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      target: card,
      preventDefault: vi.fn(),
    } as unknown as { type: string });

    expect(pointerUpdate.mock.calls[0]?.[1]).toEqual(
      keyboardUpdate.mock.calls[0]?.[1],
    );
  });

  it('shows invalid animation warnings for a dangling scene reference', () => {
    const panels = createAnimationEditor(
      createOptions({
        activeTab: 'scene',
        selectedSceneInstanceId: 'dangling-instance',
        scenePreview: {
          instances: [
            {
              id: 'dangling-instance',
              animationId: 'deleted-animation',
              entityId: 'hero',
              animationName: 'deleted',
              x: 0,
              y: 0,
              visible: true,
            },
          ],
        },
      }),
    );
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const warnings = editor.querySelectorAll(
      '.scene-preview-invalid-animation-warning',
    );

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.textContent).toContain('Invalid animation "deleted"');
  });

  it('stores animation and frame palette selections by logical palette ID', () => {
    const onUpdateAnimation = vi.fn();
    const onFramePaletteChange = vi.fn();
    const base = createOptions();
    const animation: AnimationItemSetting = {
      ...createSampleAnimation('anim-1', 'idle', 'hero'),
      paletteId: 'pal_1',
      paletteIndex: null,
      framePaletteIds: [null],
    };
    const options = createOptions({
      settings: { ...base.settings, animations: [animation] },
      selectedAnimationId: animation.id,
      onUpdateAnimation,
      onFramePaletteChange,
    });

    const panels = createAnimationEditor(options);
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const paletteSelect = editor.querySelector('.animation-palette-select');
    expect(paletteSelect?.textContent).toContain('Sprite 1 — SPR Slot 1');
    expect(paletteSelect?.value).toBe('pal_1');
    if (paletteSelect) {
      paletteSelect.value = 'pal_2';
      paletteSelect.dispatchEvent({ type: 'change' });
    }
    expect(onUpdateAnimation).toHaveBeenCalledWith(animation.id, {
      paletteId: 'pal_2',
      paletteIndex: null,
    });

    const frameSelect = editor.querySelector('.animation-frame-palette-input');
    if (frameSelect) {
      frameSelect.value = 'pal_3';
      frameSelect.dispatchEvent({ type: 'change' });
    }
    expect(onFramePaletteChange).toHaveBeenCalledWith(
      animation.id,
      0,
      null,
      'pal_3',
    );
  });

  it('keeps palette identity and preview colors when the logical palette moves from SPR 0 to SPR 3', () => {
    const base = createOptions();
    const paletteId = base.palettes[0]?.id ?? null;
    const animation: AnimationItemSetting = {
      ...createSampleAnimation('anim-1', 'idle', 'hero'),
      paletteId,
      paletteIndex: null,
    };
    const slotsAtZero = [paletteId, null, null, null] as const;
    const frameOverridePaletteId = base.palettes[1]?.id ?? null;
    const slotsAtThree = [
      null,
      frameOverridePaletteId,
      null,
      paletteId,
    ] as const;
    const colorsBefore = resolveEffectivePaletteColors(
      animation.paletteId,
      base.palettes,
      0,
      base.spritePaletteSet,
    );
    const colorsAfter = resolveEffectivePaletteColors(
      animation.paletteId,
      base.palettes,
      3,
      base.spritePaletteSet,
    );

    expect(colorsAfter).toEqual(colorsBefore);
    expect(
      resolveSpritePaletteSlot(paletteId, slotsAtZero, base.palettes).slotIndex,
    ).toBe(0);
    expect(
      resolveSpritePaletteSlot(paletteId, slotsAtThree, base.palettes)
        .slotIndex,
    ).toBe(3);

    const physicalPaletteIndex = resolveEffectiveSpritePaletteIndex(
      paletteId,
      slotsAtThree,
      base.palettes,
      0,
    );
    const frameOverridePaletteIndex = resolveEffectiveSpritePaletteIndex(
      frameOverridePaletteId,
      slotsAtThree,
      base.palettes,
      physicalPaletteIndex,
    );
    const twoFrameImage: IndexedImage = {
      ...singleTileImage(),
      width: 16,
      pixels: new Uint8Array(128).fill(1),
    };
    const hardwareModel = buildAnimationProjectModel({
      name: 'hero',
      animations: [
        {
          id: animation.id,
          name: animation.name,
          image: twoFrameImage,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0, 1],
          frameDuration: 8,
          paletteIndex: physicalPaletteIndex,
          framePalettes: [null, frameOverridePaletteIndex],
        },
      ],
    });
    expect(
      (hardwareModel.animations[0]?.frames[0]?.sprites[0]?.attributes ?? 0) &
        0x03,
    ).toBe(3);
    expect(
      (hardwareModel.animations[0]?.frames[1]?.sprites[0]?.attributes ?? 0) &
        0x03,
    ).toBe(1);

    const panels = createAnimationEditor(
      createOptions({
        settings: { ...base.settings, animations: [animation] },
        selectedAnimationId: animation.id,
        activeSpriteSlots: slotsAtThree,
      }),
    );
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    expect(editor.querySelector('.animation-palette-select')?.value).toBe(
      paletteId,
    );
    expect(
      editor.querySelector('.animation-palette-slot-badge')?.textContent,
    ).toBe('SPR 3');

    const imageWithTransparentPixel = singleTileImage();
    imageWithTransparentPixel.pixels[0] = 0;
    const rendered = renderIndexedImageWithPalette(
      imageWithTransparentPixel,
      colorsAfter,
    );
    expect(rendered.data[3]).toBe(0);
  });

  it('marks a valid but unassigned logical sprite palette without changing its ID', () => {
    const base = createOptions();
    const paletteId = base.palettes[1]?.id ?? null;
    const animation: AnimationItemSetting = {
      ...createSampleAnimation('anim-1', 'idle', 'hero'),
      paletteId,
      paletteIndex: null,
    };
    const panels = createAnimationEditor(
      createOptions({
        settings: { ...base.settings, animations: [animation] },
        selectedAnimationId: animation.id,
        activeSpriteSlots: [null, null, null, null],
      }),
    );
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const badge = editor.querySelector('.animation-palette-slot-badge');
    expect(editor.querySelector('.animation-palette-select')?.value).toBe(
      paletteId,
    );
    expect(badge?.classList.contains('is-unassigned')).toBe(true);
    expect(badge?.textContent).toBe('No active slot');
  });

  it('shows one capacity alert only when five distinct visible sprite palettes are simultaneous', () => {
    const base = createOptions();
    const palettes: readonly PaletteDefinition[] = Array.from(
      { length: 5 },
      (_, index) => ({
        id: `scene_pal_${String(index)}`,
        name: `Scene Palette ${String(index)}`,
        colors: [0x0f, 0x01 + index, 0x11 + index, 0x21 + index],
        target: 'sprite',
      }),
    );
    const animations = palettes.map((palette, index) => ({
      ...createSampleAnimation(
        `scene_anim_${String(index)}`,
        `idle_${String(index)}`,
        `entity_${String(index)}`,
      ),
      paletteId: palette.id,
    }));
    const instances = animations.map((animation, index) => ({
      id: `scene_inst_${String(index)}`,
      animationId: animation.id,
      entityId: animation.entity ?? '',
      animationName: animation.name,
      x: index * 8,
      y: 0,
      visible: true,
    }));
    const options = createOptions({
      activeTab: 'scene',
      settings: { ...base.settings, animations },
      palettes,
      activeSpriteSlots: [
        palettes[0]?.id ?? null,
        palettes[1]?.id ?? null,
        palettes[2]?.id ?? null,
        palettes[3]?.id ?? null,
      ],
      scenePreview: { instances },
    });

    const panels = createAnimationEditor(options);
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const alerts = editor.querySelectorAll(
      '.scene-preview-palette-capacity-alert',
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.hidden).toBe(false);
    expect(alerts[0]?.textContent).toContain('requires 5 distinct');
    expect(alerts[0]?.textContent).toContain('limit of 4');

    const fourPalettePanels = createAnimationEditor(
      createOptions({
        activeTab: 'scene',
        settings: { ...base.settings, animations },
        palettes,
        activeSpriteSlots: [
          palettes[0]?.id ?? null,
          palettes[1]?.id ?? null,
          palettes[2]?.id ?? null,
          palettes[3]?.id ?? null,
        ],
        scenePreview: { instances: instances.slice(0, 4) },
      }),
    );
    const fourPaletteEditor = fourPalettePanels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    expect(
      fourPaletteEditor.querySelector('.scene-preview-palette-capacity-alert')
        ?.hidden,
    ).toBe(true);
  });

  it('keeps a hidden scene palette badge available for a later frame override', () => {
    const base = createOptions();
    const animation: AnimationItemSetting = {
      ...createSampleAnimation('scene-override', 'idle', 'hero'),
      paletteId: null,
      frameIndices: [0, 0],
      frameDurations: [1, 1],
      framePaletteIds: [null, base.palettes[0]?.id ?? null],
    };
    const panels = createAnimationEditor(
      createOptions({
        activeTab: 'scene',
        settings: { ...base.settings, animations: [animation] },
        scenePreview: {
          instances: [
            {
              id: 'scene-inst-override',
              animationId: animation.id,
              entityId: 'hero',
              animationName: 'idle',
              x: 0,
              y: 0,
              visible: true,
            },
          ],
        },
      }),
    );
    const editor = panels.find(
      (panel) => panel.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const badge = editor
      .querySelectorAll('span')
      .find(
        (element) =>
          element.getAttribute('data-scene-palette-instance') ===
          'scene-inst-override',
      );
    expect(badge).toBeDefined();
    expect(badge?.hidden).toBe(true);
  });

  it('renders collapsible preview with toggle button and triggers onTogglePreviewCollapse', () => {
    const onTogglePreviewCollapse = vi.fn();

    // 1. Expanded state
    const optionsExpanded = createOptions({
      previewCollapsed: false,
      onTogglePreviewCollapse,
    });
    const panelsExpanded = createAnimationEditor(optionsExpanded);
    const editorExpanded = panelsExpanded.find(
      (p) => p.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const previewExpanded = editorExpanded.querySelector(
      '.animation-sticky-preview',
    );
    expect(previewExpanded).not.toBeNull();
    expect(previewExpanded?.classList.contains('is-collapsed')).toBe(false);

    const toggleBtn = previewExpanded?.querySelector(
      '.preview-collapse-toggle',
    );
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn?.textContent).toBe('[-]');
    toggleBtn?.click();
    expect(onTogglePreviewCollapse).toHaveBeenCalledTimes(1);

    // 2. Collapsed state
    const optionsCollapsed = createOptions({
      previewCollapsed: true,
      onTogglePreviewCollapse,
    });
    const panelsCollapsed = createAnimationEditor(optionsCollapsed);
    const editorCollapsed = panelsCollapsed.find(
      (p) => p.id === 'section-animation-editor',
    ) as unknown as MockElement;
    const previewCollapsed = editorCollapsed.querySelector(
      '.animation-sticky-preview',
    );
    expect(previewCollapsed).not.toBeNull();
    expect(previewCollapsed?.classList.contains('is-collapsed')).toBe(true);
    expect(previewCollapsed?.textContent).toContain('Preview:');

    const toggleBtnCollapsed = previewCollapsed?.querySelector(
      '.preview-collapse-toggle',
    );
    expect(toggleBtnCollapsed?.textContent).toBe('[+]');
    toggleBtnCollapsed?.click();
    expect(onTogglePreviewCollapse).toHaveBeenCalledTimes(2);
  });

  it('keeps preview in a dedicated layout column instead of overlaying editor content', () => {
    const options = createOptions();
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find(
      (p) => p.id === 'section-animation-editor',
    ) as unknown as MockElement;

    const layout = editorPanel.querySelector('.animation-selected-layout');
    expect(layout).not.toBeNull();

    const mainCol = layout?.querySelector('.animation-selected-main');
    const previewCol = layout?.querySelector('.animation-selected-preview-col');
    expect(mainCol).not.toBeNull();
    expect(previewCol).not.toBeNull();

    // Preview element is child of previewCol
    const preview = previewCol?.querySelector('.animation-sticky-preview');
    expect(preview).not.toBeNull();
  });

  it('groups export downloads into primary and responsive secondary grid', () => {
    const onDownloadBytes = vi.fn();
    const onDownloadText = vi.fn();
    const options = createOptions({ onDownloadBytes, onDownloadText });
    const panels = createAnimationEditor(options);
    const exportPanel = panels.find(
      (p) => p.id === 'section-export',
    ) as unknown as MockElement;
    expect(exportPanel).not.toBeNull();

    const primaryGroup = exportPanel.querySelector('.export-actions-primary');
    expect(primaryGroup).not.toBeNull();
    const primaryBtns = primaryGroup?.querySelectorAll('button') ?? [];
    expect(primaryBtns.length).toBe(1);

    const secondaryGrid = exportPanel.querySelector(
      '.export-actions-secondary-grid',
    );
    expect(secondaryGrid).not.toBeNull();
    const secondaryBtns = secondaryGrid?.querySelectorAll('button') ?? [];
    expect(secondaryBtns.length).toBe(6);

    // Total 7 download buttons
    const allBtns = exportPanel.querySelectorAll('.export-actions button');
    expect(allBtns.length).toBe(7);
  });

  it('renders Inspect in CHR button on metasprite mapping cells and invokes onInspectInChr', () => {
    const onInspectInChr = vi.fn();
    const options = createOptions({
      activeTab: 'mapping',
      onInspectInChr,
    });
    const panels = createAnimationEditor(options);
    const editorPanel = panels.find(
      (p) => p.id === 'section-animation-editor',
    ) as unknown as MockElement;
    expect(editorPanel).not.toBeNull();

    const inspectBtn = editorPanel.querySelector('.animation-inspect-chr-btn');
    expect(inspectBtn).not.toBeNull();
    inspectBtn?.click();

    expect(onInspectInChr).toHaveBeenCalled();
  });
});
