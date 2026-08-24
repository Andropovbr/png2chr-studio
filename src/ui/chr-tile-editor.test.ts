import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createChrTileEditor,
  DEFAULT_CHR_EDITOR_PALETTE,
  type ChrTileEditorOptions,
} from './chr-tile-editor';
import { createEmptyTilePixels } from '../core/chr-tile-editor';
import { setLocale } from '../i18n';

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
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();

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
      toggle: (cls: string, force?: boolean) => {
        const has = this.classList.contains(cls);
        const shouldHave = force ?? !has;
        if (shouldHave) {
          this.classList.add(cls);
        } else {
          this.classList.remove(cls);
        }
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
            const hasAttr =
              val !== undefined
                ? el.getAttribute(attr) === val
                : el.getAttribute(attr) !== null;
            if (!hasAttr) return false;
          }
        }
      }

      if (selector.startsWith('.')) {
        const classPart = selector.split('[')[0] ?? '';
        const classes = classPart.split('.').filter(Boolean);
        return classes.every((cls) => el.classList.contains(cls));
      }
      if (selector.startsWith('[')) {
        return true;
      }
      if (selector.startsWith('#')) {
        return el.id === selector.slice(1);
      }
      const tagPart = selector.split('[')[0] ?? '';
      return el.tagName.toLowerCase() === tagPart.toLowerCase();
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
      return {
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: vi.fn(),
      };
    }
    return null;
  }
}

describe('ChrTileEditor component', () => {
  beforeEach(() => {
    setLocale('en');
    vi.stubGlobal('document', {
      createElement: (tagName: string) => new MockElement(tagName),
    });
  });

  function createTestOptions(
    overrides?: Partial<ChrTileEditorOptions>,
  ): ChrTileEditorOptions {
    return {
      pixels: createEmptyTilePixels(0),
      selectedColorIndex: 2,
      activeTool: 'pencil',
      paletteColors: DEFAULT_CHR_EDITOR_PALETTE,
      showGrid: true,
      onPixelsChange: vi.fn(),
      onSelectColorIndex: vi.fn(),
      onSelectTool: vi.fn(),
      onToggleGrid: vi.fn(),
      onStrokeStart: vi.fn(),
      onStrokeEnd: vi.fn(),
      onHoverPixel: vi.fn(),
      ...overrides,
    };
  }

  it('renders structure with toolbar, 4 tools, 4 palette buttons, grid button and canvas', () => {
    const options = createTestOptions();
    const element = createChrTileEditor(options) as unknown as MockElement;

    expect(element.getAttribute('role')).toBe('region');
    expect(element.getAttribute('aria-label')).toBe('CHR Tile Editor');

    const toolsGroup = element.querySelector('.chr-editor-tools-group');
    expect(toolsGroup).not.toBeNull();

    const toolBtns = element.querySelectorAll('.chr-editor-tool-btn');
    expect(toolBtns.length).toBe(4);

    const activePencilBtn = element.querySelector(
      '.chr-editor-tool-btn[data-tool="pencil"]',
    );
    expect(activePencilBtn?.classList.contains('is-active')).toBe(true);
    expect(activePencilBtn?.getAttribute('aria-pressed')).toBe('true');

    const paletteBtns = element.querySelectorAll('.chr-editor-color-btn');
    expect(paletteBtns.length).toBe(4);

    const activeColorBtn = element.querySelector(
      '.chr-editor-color-btn[data-color-index="2"]',
    );
    expect(activeColorBtn?.classList.contains('is-active')).toBe(true);
    expect(activeColorBtn?.getAttribute('aria-checked')).toBe('true');

    const gridBtn = element.querySelector('.chr-editor-grid-btn');
    expect(gridBtn?.classList.contains('is-active')).toBe(true);

    const canvas = element.querySelector('.chr-tile-editor-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.classList.contains('has-grid')).toBe(true);
  });

  it('invokes onSelectTool when clicking tool buttons', () => {
    const onSelectTool = vi.fn();
    const options = createTestOptions({ onSelectTool });
    const element = createChrTileEditor(options) as unknown as MockElement;

    const eraserBtn = element.querySelector(
      '.chr-editor-tool-btn[data-tool="eraser"]',
    );
    eraserBtn?.click();
    expect(onSelectTool).toHaveBeenCalledWith('eraser');

    const fillBtn = element.querySelector(
      '.chr-editor-tool-btn[data-tool="fill"]',
    );
    fillBtn?.click();
    expect(onSelectTool).toHaveBeenCalledWith('fill');
  });

  it('invokes onSelectColorIndex when clicking color index buttons', () => {
    const onSelectColorIndex = vi.fn();
    const options = createTestOptions({ onSelectColorIndex });
    const element = createChrTileEditor(options) as unknown as MockElement;

    const color1Btn = element.querySelector(
      '.chr-editor-color-btn[data-color-index="1"]',
    );
    color1Btn?.click();
    expect(onSelectColorIndex).toHaveBeenCalledWith(1);

    const color3Btn = element.querySelector(
      '.chr-editor-color-btn[data-color-index="3"]',
    );
    color3Btn?.click();
    expect(onSelectColorIndex).toHaveBeenCalledWith(3);
  });

  it('invokes onToggleGrid when clicking the grid button', () => {
    const onToggleGrid = vi.fn();
    const options = createTestOptions({ showGrid: true, onToggleGrid });
    const element = createChrTileEditor(options) as unknown as MockElement;

    const gridBtn = element.querySelector('.chr-editor-grid-btn');
    gridBtn?.click();
    expect(onToggleGrid).toHaveBeenCalledWith(false);
  });

  function getPixelCallArg(
    fn: { mock: { calls: unknown[][] } },
    callIndex: number,
    argIndex = 0,
  ): Uint8Array {
    const call = fn.mock.calls[callIndex];
    if (!call || call.length <= argIndex) {
      throw new Error(
        `Expected call at index ${String(callIndex)} with arg at ${String(argIndex)}`,
      );
    }
    const arg = call[argIndex];
    if (!(arg instanceof Uint8Array)) {
      throw new Error(
        `Expected Uint8Array at call ${String(callIndex)} arg ${String(argIndex)}`,
      );
    }
    return arg;
  }

  it('handles pencil drawing on pointerdown and drag stroke', () => {
    const onPixelsChange = vi.fn();
    const onStrokeStart = vi.fn();
    const onStrokeEnd = vi.fn();
    const options = createTestOptions({
      activeTool: 'pencil',
      selectedColorIndex: 3,
      onPixelsChange,
      onStrokeStart,
      onStrokeEnd,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    // Click at pixel (2, 3): clientX = 2 * (256/8) + 10 = 74, clientY = 3 * (256/8) + 10 = 106
    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 74,
      clientY: 106,
      pointerId: 1,
    });

    expect(onStrokeStart).toHaveBeenCalledTimes(1);
    expect(onPixelsChange).toHaveBeenCalledTimes(1);
    const updatedPixels = getPixelCallArg(onPixelsChange, 0);
    expect(updatedPixels[3 * 8 + 2]).toBe(3);

    // Drag to pixel (3, 3): clientX = 3 * 32 + 10 = 106, clientY = 106
    canvas?.dispatchEvent({
      type: 'pointermove',
      clientX: 106,
      clientY: 106,
      pointerId: 1,
    });

    expect(onPixelsChange).toHaveBeenCalledTimes(2);
    const dragPixels = getPixelCallArg(onPixelsChange, 1);
    expect(dragPixels[3 * 8 + 3]).toBe(3);

    // Dragging over the same pixel again does not fire duplicate change
    canvas?.dispatchEvent({
      type: 'pointermove',
      clientX: 108,
      clientY: 108,
      pointerId: 1,
    });
    expect(onPixelsChange).toHaveBeenCalledTimes(2);

    // Release stroke
    canvas?.dispatchEvent({
      type: 'pointerup',
      pointerId: 1,
    });
    expect(onStrokeEnd).toHaveBeenCalledTimes(1);
  });

  it('handles eraser tool writing color index 0', () => {
    const pixels = createEmptyTilePixels(2);
    const onPixelsChange = vi.fn();
    const options = createTestOptions({
      pixels,
      activeTool: 'eraser',
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    // Click at pixel (4, 4): clientX = 4 * 32 + 5 = 133, clientY = 4 * 32 + 5 = 133
    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 133,
      clientY: 133,
      pointerId: 1,
    });

    expect(onPixelsChange).toHaveBeenCalledTimes(1);
    const updated = getPixelCallArg(onPixelsChange, 0);
    expect(updated[4 * 8 + 4]).toBe(0);
  });

  it('handles eyedropper tool picking color index without modifying tile', () => {
    const pixels = createEmptyTilePixels(0);
    pixels[5 * 8 + 2] = 3;
    const onSelectColorIndex = vi.fn();
    const onPixelsChange = vi.fn();
    const options = createTestOptions({
      pixels,
      activeTool: 'eyedropper',
      onSelectColorIndex,
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    // Click at pixel (2, 5): clientX = 2 * 32 + 5 = 69, clientY = 5 * 32 + 5 = 165
    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 69,
      clientY: 165,
      pointerId: 1,
    });

    expect(onSelectColorIndex).toHaveBeenCalledWith(3);
    expect(onPixelsChange).not.toHaveBeenCalled();
  });

  it('handles flood fill tool filling contiguous area', () => {
    const pixels = createEmptyTilePixels(0);
    // Create a 2x2 box of color 1
    pixels[1 * 8 + 1] = 1;
    pixels[1 * 8 + 2] = 1;
    pixels[2 * 8 + 1] = 1;
    pixels[2 * 8 + 2] = 1;

    const onPixelsChange = vi.fn();
    const options = createTestOptions({
      pixels,
      activeTool: 'fill',
      selectedColorIndex: 2,
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    // Click at (1, 1): clientX = 1 * 32 + 5 = 37, clientY = 1 * 32 + 5 = 37
    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 37,
      clientY: 37,
      pointerId: 1,
    });

    expect(onPixelsChange).toHaveBeenCalledTimes(1);
    const filled = getPixelCallArg(onPixelsChange, 0);
    expect(filled[1 * 8 + 1]).toBe(2);
    expect(filled[2 * 8 + 2]).toBe(2);
    expect(filled[0 * 8 + 0]).toBe(0);
  });

  it('updates coordinates readout and fires onHoverPixel on move', () => {
    const onHoverPixel = vi.fn();
    const options = createTestOptions({ onHoverPixel });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');
    const coordsDisplay = element.querySelector('.chr-tile-editor-coords');

    // Move to (4, 6): clientX = 4 * 32 + 5 = 133, clientY = 6 * 32 + 5 = 197
    canvas?.dispatchEvent({
      type: 'pointermove',
      clientX: 133,
      clientY: 197,
      pointerId: 1,
    });

    expect(coordsDisplay?.textContent).toBe('X: 4, Y: 6');
    expect(onHoverPixel).toHaveBeenCalledWith({ x: 4, y: 6 });

    // Leave canvas
    canvas?.dispatchEvent({
      type: 'pointerleave',
      pointerId: 1,
    });

    expect(coordsDisplay?.textContent).toBe('—');
    expect(onHoverPixel).toHaveBeenCalledWith(null);
  });
});
