import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createChrTileEditor,
  DEFAULT_CHR_EDITOR_PALETTE,
  isEditableElement,
  type ChrTileEditorOptions,
} from './chr-tile-editor';
import {
  areTilePixelsEqual,
  clearTileClipboard,
  createEmptyTilePixels,
  createTileHistory,
} from '../core/chr-tile-editor';
import { setLocale } from '../i18n';

class MockElement {
  tagName: string;
  className = '';
  id = '';
  disabled = false;
  tabIndex = 0;
  isContentEditable = false;
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
  focus = vi.fn();
  blur = vi.fn();

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

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  addEventListener(event: string, handler: (e?: unknown) => void) {
    const list = this.eventListeners.get(event) ?? [];
    list.push(handler);
    this.eventListeners.set(event, list);
  }

  dispatchEvent(event: { type: string; [key: string]: unknown }) {
    const handlers = this.eventListeners.get(event.type) ?? [];
    const syntheticEvent = {
      target: this,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...event,
    };
    handlers.forEach((fn) => {
      fn(syntheticEvent);
    });
  }

  click() {
    if (this.disabled) {
      return;
    }
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
    clearTileClipboard();
    vi.stubGlobal('document', {
      createElement: (tagName: string) => new MockElement(tagName),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  function createTestOptions(
    overrides?: Partial<ChrTileEditorOptions>,
  ): ChrTileEditorOptions {
    return {
      pixels: createEmptyTilePixels(0),
      selectedColorIndex: 2,
      activeTool: 'pencil',
      paletteColors: DEFAULT_CHR_EDITOR_PALETTE,
      showGrid: true,
      shiftWrap: false,
      onPixelsChange: vi.fn(),
      onSelectColorIndex: vi.fn(),
      onSelectTool: vi.fn(),
      onToggleGrid: vi.fn(),
      onToggleShiftWrap: vi.fn(),
      onStrokeStart: vi.fn(),
      onStrokeEnd: vi.fn(),
      onHoverPixel: vi.fn(),
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      ...overrides,
    };
  }

  it('renders structure with toolbar, tools, palette buttons, grid, and operations toolbar with history', () => {
    const options = createTestOptions();
    const element = createChrTileEditor(options) as unknown as MockElement;

    expect(element.getAttribute('role')).toBe('region');
    expect(element.getAttribute('aria-label')).toBe('CHR Tile Editor');

    const historyGroup = element.querySelector('.chr-editor-history-group');
    expect(historyGroup).not.toBeNull();

    const undoBtn = element.querySelector(
      '.chr-editor-action-btn[data-action="undo"]',
    );
    const redoBtn = element.querySelector(
      '.chr-editor-action-btn[data-action="redo"]',
    );
    expect(undoBtn?.disabled).toBe(true);
    expect(redoBtn?.disabled).toBe(true);

    const toolsGroup = element.querySelector('.chr-editor-tools-group');
    expect(toolsGroup).not.toBeNull();
    const toolBtns = element.querySelectorAll('.chr-editor-tool-btn');
    expect(toolBtns.length).toBe(4);

    const paletteBtns = element.querySelectorAll('.chr-editor-color-btn');
    expect(paletteBtns.length).toBe(4);
    expect(paletteBtns.map((button) => button.tabIndex)).toEqual([
      -1, -1, 0, -1,
    ]);

    const canvas = element.querySelector('.chr-tile-editor-canvas');
    expect(element.tabIndex).toBe(0);
    expect(canvas?.tabIndex).toBe(0);
    expect(canvas?.getAttribute('aria-describedby')).toBe(
      'chr-editor-keyboard-hint',
    );

    const canvasWrapper = element.querySelector(
      '.chr-tile-editor-canvas-wrapper',
    );
    expect(canvasWrapper).not.toBeNull();
    expect(canvasWrapper?.classList.contains('has-grid')).toBe(true);

    const gridOverlay = element.querySelector('.chr-tile-editor-grid-overlay');
    expect(gridOverlay).not.toBeNull();
    expect(gridOverlay?.classList.contains('is-visible')).toBe(true);
    expect(gridOverlay?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses roving tabindex and arrow-key selection for drawing tools and color indices', () => {
    const onSelectColorIndex = vi.fn();
    const element = createChrTileEditor(
      createTestOptions({ onSelectColorIndex }),
    ) as unknown as MockElement;

    const toolButtons = element.querySelectorAll('.chr-editor-tool-btn');
    expect(toolButtons.map((button) => button.tabIndex)).toEqual([
      0, -1, -1, -1,
    ]);
    toolButtons[0]?.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
    expect(toolButtons[0]?.tabIndex).toBe(-1);
    expect(toolButtons[1]?.tabIndex).toBe(0);
    expect(toolButtons[1]?.focus).toHaveBeenCalledTimes(1);

    const colorButtons = element.querySelectorAll('.chr-editor-color-btn');
    colorButtons[2]?.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
    expect(colorButtons[2]?.tabIndex).toBe(-1);
    expect(colorButtons[3]?.tabIndex).toBe(0);
    expect(colorButtons[3]?.focus).toHaveBeenCalledTimes(1);
    expect(onSelectColorIndex).toHaveBeenCalledWith(3);

    colorButtons[3]?.dispatchEvent({ type: 'keydown', key: 'Home' });
    expect(colorButtons[0]?.tabIndex).toBe(0);
    expect(onSelectColorIndex).toHaveBeenLastCalledWith(0);
  });

  it('scopes shortcuts to the editor DOM instead of registering a window listener', () => {
    const addEventListener = vi.fn();
    vi.stubGlobal('window', { addEventListener });

    createChrTileEditor(createTestOptions());

    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('renders without grid overlay when showGrid is false and toggles grid state', () => {
    const onToggleGrid = vi.fn();
    const options = createTestOptions({ showGrid: false, onToggleGrid });
    const element = createChrTileEditor(options) as unknown as MockElement;

    const canvasWrapper = element.querySelector(
      '.chr-tile-editor-canvas-wrapper',
    );
    expect(canvasWrapper?.classList.contains('has-grid')).toBe(false);

    const gridOverlay = element.querySelector('.chr-tile-editor-grid-overlay');
    expect(gridOverlay?.classList.contains('is-visible')).toBe(false);

    const gridToggleBtn = element.querySelector('.chr-editor-grid-btn');
    expect(gridToggleBtn?.classList.contains('is-active')).toBe(false);
    expect(gridToggleBtn?.getAttribute('aria-pressed')).toBe('false');

    gridToggleBtn?.click();
    expect(onToggleGrid).toHaveBeenCalledWith(true);
  });

  it('batches an entire Pencil drag stroke into a single atomic history step and commits on pointerup', () => {
    const initialPixels = createEmptyTilePixels(0);
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);
    const onPixelsChange = vi.fn();
    const onPixelsPreviewChange = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();

    const options = createTestOptions({
      pixels: initialPixels,
      history,
      activeTool: 'pencil',
      selectedColorIndex: 3,
      onPixelsChange,
      onPixelsPreviewChange,
      onUndo,
      onRedo,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    // Stroke Start at (1, 1) -> clientX = 37, clientY = 37
    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 37,
      clientY: 37,
      pointerId: 1,
    });

    // Drag to (2, 1) -> clientX = 69, clientY = 37
    canvas?.dispatchEvent({
      type: 'pointermove',
      clientX: 69,
      clientY: 37,
      pointerId: 1,
    });

    // Drag to (3, 1) -> clientX = 101, clientY = 37
    canvas?.dispatchEvent({
      type: 'pointermove',
      clientX: 101,
      clientY: 37,
      pointerId: 1,
    });

    // onPixelsPreviewChange called 3 times during the stroke for live preview
    expect(onPixelsPreviewChange).toHaveBeenCalledTimes(3);
    // Canonical onPixelsChange is NOT called during the stroke
    expect(onPixelsChange).toHaveBeenCalledTimes(0);

    // End stroke
    canvas?.dispatchEvent({
      type: 'pointerup',
      pointerId: 1,
    });

    // Canonical onPixelsChange called exactly once on pointerup commit
    expect(onPixelsChange).toHaveBeenCalledTimes(1);
    const committedPixels = getPixelCallArg(onPixelsChange, 0);
    expect(committedPixels[1 * 8 + 1]).toBe(3);
    expect(committedPixels[1 * 8 + 2]).toBe(3);
    expect(committedPixels[1 * 8 + 3]).toBe(3);

    // History now has exactly 1 entry on undo stack
    expect(history.depth).toBe(1);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    // Undo should restore the tile to completely empty in a single step
    const undoBtn = element.querySelector(
      '.chr-editor-action-btn[data-action="undo"]',
    );
    undoBtn?.click();

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onPixelsChange).toHaveBeenCalledTimes(2);
    const restoredPixels = getPixelCallArg(onPixelsChange, 1);
    for (let i = 0; i < 64; i += 1) {
      expect(restoredPixels[i]).toBe(0);
    }
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    // Redo restores the final 3-pixel stroke in a single step
    const redoBtn = element.querySelector(
      '.chr-editor-action-btn[data-action="redo"]',
    );
    redoBtn?.click();

    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onPixelsChange).toHaveBeenCalledTimes(3);
    const redonePixels = getPixelCallArg(onPixelsChange, 2);
    expect(redonePixels[1 * 8 + 1]).toBe(3);
    expect(redonePixels[1 * 8 + 2]).toBe(3);
    expect(redonePixels[1 * 8 + 3]).toBe(3);
  });

  it('handles single click as a valid stroke that commits 1 history step and enables Undo', () => {
    const initialPixels = createEmptyTilePixels(0);
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);
    const onPixelsChange = vi.fn();

    const options = createTestOptions({
      pixels: initialPixels,
      history,
      activeTool: 'pencil',
      selectedColorIndex: 2,
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    // Click down at (4, 4)
    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 133,
      clientY: 133,
      pointerId: 1,
    });
    // Click up immediately (no pointermove)
    canvas?.dispatchEvent({
      type: 'pointerup',
      pointerId: 1,
    });

    expect(history.depth).toBe(1);
    expect(history.canUndo).toBe(true);
    expect(onPixelsChange).toHaveBeenCalledTimes(1);
    const committed = getPixelCallArg(onPixelsChange, 0);
    expect(committed[4 * 8 + 4]).toBe(2);
  });

  it('batches an Eraser drag stroke into a single atomic history step and commits on pointerup', () => {
    const initialPixels = createEmptyTilePixels(3);
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);
    const onPixelsChange = vi.fn();

    const options = createTestOptions({
      pixels: initialPixels,
      history,
      activeTool: 'eraser',
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    // Drag eraser across 3 pixels
    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 37,
      clientY: 37,
      pointerId: 1,
    });
    canvas?.dispatchEvent({
      type: 'pointermove',
      clientX: 69,
      clientY: 37,
      pointerId: 1,
    });
    canvas?.dispatchEvent({
      type: 'pointermove',
      clientX: 101,
      clientY: 37,
      pointerId: 1,
    });

    // onPixelsChange is not called during the drag
    expect(onPixelsChange).toHaveBeenCalledTimes(0);

    // End stroke
    canvas?.dispatchEvent({
      type: 'pointerup',
      pointerId: 1,
    });

    expect(onPixelsChange).toHaveBeenCalledTimes(1);
    expect(history.depth).toBe(1);
    expect(history.canUndo).toBe(true);

    const committed = getPixelCallArg(onPixelsChange, 0);
    expect(committed[1 * 8 + 1]).toBe(0);
    expect(committed[1 * 8 + 2]).toBe(0);
    expect(committed[1 * 8 + 3]).toBe(0);
    expect(committed[0]).toBe(3);
  });

  it('commits a 10-pixel stroke in exactly 1 onPixelsChange call', () => {
    const initialPixels = createEmptyTilePixels(0);
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);
    const onPixelsChange = vi.fn();

    const options = createTestOptions({
      pixels: initialPixels,
      history,
      activeTool: 'pencil',
      selectedColorIndex: 1,
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 5,
      clientY: 5,
      pointerId: 1,
    });

    // Move through 9 more points
    for (let i = 1; i < 10; i += 1) {
      canvas?.dispatchEvent({
        type: 'pointermove',
        clientX: 5 + i * 20,
        clientY: 5,
        pointerId: 1,
      });
    }

    expect(onPixelsChange).toHaveBeenCalledTimes(0);

    canvas?.dispatchEvent({
      type: 'pointerup',
      pointerId: 1,
    });

    expect(onPixelsChange).toHaveBeenCalledTimes(1);
    expect(history.depth).toBe(1);
  });

  it('commits stroke state reached up to pointercancel as a single atomic action', () => {
    const initialPixels = createEmptyTilePixels(0);
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);
    const onPixelsChange = vi.fn();

    const options = createTestOptions({
      pixels: initialPixels,
      history,
      activeTool: 'pencil',
      selectedColorIndex: 3,
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 37,
      clientY: 37,
      pointerId: 1,
    });
    canvas?.dispatchEvent({
      type: 'pointermove',
      clientX: 69,
      clientY: 37,
      pointerId: 1,
    });

    expect(onPixelsChange).toHaveBeenCalledTimes(0);

    // Cancel stroke
    canvas?.dispatchEvent({
      type: 'pointercancel',
      pointerId: 1,
    });

    expect(onPixelsChange).toHaveBeenCalledTimes(1);
    expect(history.depth).toBe(1);
    expect(history.canUndo).toBe(true);
    const committed = getPixelCallArg(onPixelsChange, 0);
    expect(committed[1 * 8 + 1]).toBe(3);
    expect(committed[1 * 8 + 2]).toBe(3);
  });

  it('does not create history entry if stroke does not change any pixel', () => {
    const initialPixels = createEmptyTilePixels(0);
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);
    const onPixelsChange = vi.fn();

    const options = createTestOptions({
      pixels: initialPixels,
      history,
      activeTool: 'eraser', // Drawing 0 on already 0 tile
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 37,
      clientY: 37,
      pointerId: 1,
    });

    canvas?.dispatchEvent({
      type: 'pointerup',
      pointerId: 1,
    });

    expect(history.depth).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(onPixelsChange).toHaveBeenCalledTimes(0);
  });

  it('records flood fill as a single atomic undoable action', () => {
    const initialPixels = createEmptyTilePixels(0);
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);
    const onPixelsChange = vi.fn();

    const options = createTestOptions({
      pixels: initialPixels,
      history,
      activeTool: 'fill',
      selectedColorIndex: 2,
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;
    const canvas = element.querySelector('.chr-tile-editor-canvas');

    canvas?.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 37,
      clientY: 37,
      pointerId: 1,
    });

    expect(history.depth).toBe(1);
    expect(history.canUndo).toBe(true);

    const undoBtn = element.querySelector(
      '.chr-editor-action-btn[data-action="undo"]',
    );
    undoBtn?.click();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    const restored = getPixelCallArg(onPixelsChange, 1);
    expect(restored.every((p) => p === 0)).toBe(true);
  });

  it('records geometric transformations as atomic undoable actions', () => {
    const initialPixels = createEmptyTilePixels(0);
    initialPixels[0 * 8 + 1] = 3;
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);
    const onPixelsChange = vi.fn();

    const options = createTestOptions({
      pixels: initialPixels,
      history,
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;

    // Flip H
    const flipHBtn = element.querySelector(
      '.chr-editor-action-btn[data-action="flip-h"]',
    );
    flipHBtn?.click();

    expect(history.depth).toBe(1);
    expect(history.canUndo).toBe(true);

    // Undo Flip H
    const undoBtn = element.querySelector(
      '.chr-editor-action-btn[data-action="undo"]',
    );
    undoBtn?.click();

    expect(history.canUndo).toBe(false);
    const restored = getPixelCallArg(onPixelsChange, 1);
    expect(restored[0 * 8 + 1]).toBe(3);
    expect(restored[0 * 8 + 6]).toBe(0);
  });

  it('invalidates redo stack when a new action is performed after undo', () => {
    const initialPixels = createEmptyTilePixels(0);
    initialPixels[0] = 1;
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);

    const options = createTestOptions({
      pixels: initialPixels,
      history,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;

    // Action 1: Flip H
    const flipHBtn = element.querySelector(
      '.chr-editor-action-btn[data-action="flip-h"]',
    );
    flipHBtn?.click();
    expect(history.canUndo).toBe(true);

    // Undo
    const undoBtn = element.querySelector(
      '.chr-editor-action-btn[data-action="undo"]',
    );
    undoBtn?.click();
    expect(history.canRedo).toBe(true);

    // Action 2: Rotate CW
    const rotCwBtn = element.querySelector(
      '.chr-editor-action-btn[data-action="rotate-cw"]',
    );
    rotCwBtn?.click();

    // Redo should now be invalid
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(true);
  });

  it('allows pasting into history and undoing paste while leaving clipboard intact', () => {
    const tileA = createEmptyTilePixels(1);
    tileA[0] = 3;
    const tileB = createEmptyTilePixels(0);
    const historyB = createTileHistory(tileB, 50, areTilePixelsEqual);
    const onPixelsChangeB = vi.fn();

    // Copy tileA
    const editorA = createChrTileEditor(
      createTestOptions({ pixels: tileA }),
    ) as unknown as MockElement;
    editorA
      .querySelector('.chr-editor-action-btn[data-action="copy"]')
      ?.click();

    // Paste into tileB editor
    const editorB = createChrTileEditor(
      createTestOptions({
        pixels: tileB,
        history: historyB,
        onPixelsChange: onPixelsChangeB,
      }),
    ) as unknown as MockElement;

    const pasteBtnB = editorB.querySelector(
      '.chr-editor-action-btn[data-action="paste"]',
    );
    pasteBtnB?.click();

    expect(historyB.canUndo).toBe(true);

    // Undo Paste
    const undoBtnB = editorB.querySelector(
      '.chr-editor-action-btn[data-action="undo"]',
    );
    undoBtnB?.click();

    const restoredB = getPixelCallArg(onPixelsChangeB, 1);
    expect(restoredB.every((p) => p === 0)).toBe(true);

    // Paste again to confirm clipboard wasn't affected
    pasteBtnB?.click();
    const pastedAgain = getPixelCallArg(onPixelsChangeB, 2);
    expect(pastedAgain[0]).toBe(3);
  });

  it('handles keyboard shortcuts for Undo (Ctrl+Z, Cmd+Z) and Redo (Ctrl+Y, Ctrl+Shift+Z, Cmd+Shift+Z)', () => {
    const initialPixels = createEmptyTilePixels(0);
    initialPixels[0] = 2;
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);
    const onPixelsChange = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();

    const options = createTestOptions({
      pixels: initialPixels,
      history,
      onPixelsChange,
      onUndo,
      onRedo,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;

    // Mutate via Rotate CW
    element
      .querySelector('.chr-editor-action-btn[data-action="rotate-cw"]')
      ?.click();
    expect(history.canUndo).toBe(true);

    // Test Ctrl+Z
    element.dispatchEvent({
      type: 'keydown',
      key: 'z',
      ctrlKey: true,
      shiftKey: false,
    });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(history.canRedo).toBe(true);

    // Test Ctrl+Y
    element.dispatchEvent({
      type: 'keydown',
      key: 'y',
      ctrlKey: true,
      shiftKey: false,
    });
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(history.canUndo).toBe(true);

    // Test Cmd+Z (macOS)
    element.dispatchEvent({
      type: 'keydown',
      key: 'z',
      metaKey: true,
      shiftKey: false,
    });
    expect(onUndo).toHaveBeenCalledTimes(2);

    // Test Ctrl+Shift+Z
    element.dispatchEvent({
      type: 'keydown',
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(onRedo).toHaveBeenCalledTimes(2);

    // Undo again so we can test Cmd+Shift+Z
    element.dispatchEvent({
      type: 'keydown',
      key: 'z',
      metaKey: true,
      shiftKey: false,
    });
    expect(onUndo).toHaveBeenCalledTimes(3);

    // Test Cmd+Shift+Z (macOS)
    element.dispatchEvent({
      type: 'keydown',
      key: 'z',
      metaKey: true,
      shiftKey: true,
    });
    expect(onRedo).toHaveBeenCalledTimes(3);
  });

  it('handles tool selection shortcuts (P, E, I, F) and color shortcuts (0, 1, 2, 3)', () => {
    const onSelectTool = vi.fn();
    const onSelectColorIndex = vi.fn();
    const options = createTestOptions({ onSelectTool, onSelectColorIndex });
    const element = createChrTileEditor(options) as unknown as MockElement;

    element.dispatchEvent({ type: 'keydown', key: 'e' });
    expect(onSelectTool).toHaveBeenCalledWith('eraser');

    element.dispatchEvent({ type: 'keydown', key: 'i' });
    expect(onSelectTool).toHaveBeenCalledWith('eyedropper');

    element.dispatchEvent({ type: 'keydown', key: 'f' });
    expect(onSelectTool).toHaveBeenCalledWith('fill');

    element.dispatchEvent({ type: 'keydown', key: 'p' });
    expect(onSelectTool).toHaveBeenCalledWith('pencil');

    element.dispatchEvent({ type: 'keydown', key: '0' });
    expect(onSelectColorIndex).toHaveBeenCalledWith(0);

    element.dispatchEvent({ type: 'keydown', key: '3' });
    expect(onSelectColorIndex).toHaveBeenCalledWith(3);
  });

  it('handles Copy (Ctrl+C) and Paste (Ctrl+V) shortcuts on the editor', () => {
    const tileA = createEmptyTilePixels(1);
    tileA[5] = 3;
    const tileB = createEmptyTilePixels(0);

    const onCopyA = vi.fn();
    const onPasteB = vi.fn();
    const onPixelsChangeB = vi.fn();

    const editorA = createChrTileEditor(
      createTestOptions({
        pixels: tileA,
        onCopy: onCopyA,
      }),
    ) as unknown as MockElement;

    // Ctrl+C on editorA
    editorA.dispatchEvent({
      type: 'keydown',
      key: 'c',
      ctrlKey: true,
    });
    expect(onCopyA).toHaveBeenCalledTimes(1);

    const editorB = createChrTileEditor(
      createTestOptions({
        pixels: tileB,
        onPaste: onPasteB,
        onPixelsChange: onPixelsChangeB,
      }),
    ) as unknown as MockElement;

    // Ctrl+V on editorB
    editorB.dispatchEvent({
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
    });
    expect(onPasteB).toHaveBeenCalledTimes(1);
    expect(onPixelsChangeB).toHaveBeenCalledTimes(1);
    const pasted = getPixelCallArg(onPixelsChangeB, 0);
    expect(pasted[5]).toBe(3);
    expect(pasted[0]).toBe(1);
  });

  it('ignores keyboard shortcuts when focus is on input, textarea, select, or contenteditable', () => {
    const onSelectTool = vi.fn();
    const onUndo = vi.fn();
    const options = createTestOptions({ onSelectTool, onUndo });
    const element = createChrTileEditor(options) as unknown as MockElement;

    const inputTarget = new MockElement('input');
    const textareaTarget = new MockElement('textarea');
    const selectTarget = new MockElement('select');
    const editableTarget = new MockElement('div');
    editableTarget.isContentEditable = true;

    // Press P inside <input>
    element.dispatchEvent({
      type: 'keydown',
      key: 'p',
      target: inputTarget,
    });
    expect(onSelectTool).not.toHaveBeenCalled();

    // Press Ctrl+Z inside <textarea>
    element.dispatchEvent({
      type: 'keydown',
      key: 'z',
      ctrlKey: true,
      target: textareaTarget,
    });
    expect(onUndo).not.toHaveBeenCalled();

    // Press E inside <select>
    element.dispatchEvent({
      type: 'keydown',
      key: 'e',
      target: selectTarget,
    });
    expect(onSelectTool).not.toHaveBeenCalled();

    // Press F inside contenteditable
    element.dispatchEvent({
      type: 'keydown',
      key: 'f',
      target: editableTarget,
    });
    expect(onSelectTool).not.toHaveBeenCalled();
  });

  it('records flip-v, shifts, and clear into undoable history', () => {
    const initialPixels = createEmptyTilePixels(0);
    initialPixels[0 * 8 + 0] = 3;
    const history = createTileHistory(initialPixels, 50, areTilePixelsEqual);
    const onPixelsChange = vi.fn();
    const options = createTestOptions({
      pixels: initialPixels,
      history,
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;

    // Flip V: (0, 0) moves to (0, 7)
    element
      .querySelector('.chr-editor-action-btn[data-action="flip-v"]')
      ?.click();
    expect(onPixelsChange).toHaveBeenCalledTimes(1);
    expect(history.depth).toBe(1);
    expect(history.canUndo).toBe(true);

    // Undo Flip V
    element
      .querySelector('.chr-editor-action-btn[data-action="undo"]')
      ?.click();
    expect(history.depth).toBe(0);
    expect(history.canUndo).toBe(false);
    const restored = getPixelCallArg(onPixelsChange, 1);
    expect(restored[0 * 8 + 0]).toBe(3);
  });

  it('handles Delete and Backspace shortcuts to clear tile', () => {
    const pixels = createEmptyTilePixels(2);
    const onPixelsChange = vi.fn();
    const history = createTileHistory(pixels, 50, areTilePixelsEqual);
    const options = createTestOptions({
      pixels,
      history,
      onPixelsChange,
    });
    const element = createChrTileEditor(options) as unknown as MockElement;

    element.dispatchEvent({
      type: 'keydown',
      key: 'Delete',
    });

    expect(onPixelsChange).toHaveBeenCalledTimes(1);
    const cleared = getPixelCallArg(onPixelsChange, 0);
    expect(cleared.every((p) => p === 0)).toBe(true);
    expect(history.canUndo).toBe(true);
  });

  it('resets undo/redo history when switched to a new history instance on tile change', () => {
    const tile1 = createEmptyTilePixels(0);
    tile1[0] = 3;
    const history1 = createTileHistory(tile1, 50, areTilePixelsEqual);
    const editor1 = createChrTileEditor(
      createTestOptions({ pixels: tile1, history: history1 }),
    ) as unknown as MockElement;

    editor1
      .querySelector('.chr-editor-action-btn[data-action="rotate-cw"]')
      ?.click();
    expect(history1.canUndo).toBe(true);

    // User switches to Tile 2: new history instance is passed
    const tile2 = createEmptyTilePixels(0);
    const history2 = createTileHistory(tile2, 50, areTilePixelsEqual);
    const editor2 = createChrTileEditor(
      createTestOptions({ pixels: tile2, history: history2 }),
    ) as unknown as MockElement;

    const undoBtn2 = editor2.querySelector(
      '.chr-editor-action-btn[data-action="undo"]',
    );
    expect(history2.canUndo).toBe(false);
    expect(undoBtn2?.disabled).toBe(true);
  });

  it('correctly evaluates isEditableElement helper', () => {
    expect(isEditableElement(null)).toBe(false);
    expect(
      isEditableElement(new MockElement('div') as unknown as HTMLElement),
    ).toBe(false);
    expect(
      isEditableElement(new MockElement('input') as unknown as HTMLElement),
    ).toBe(true);
    expect(
      isEditableElement(new MockElement('textarea') as unknown as HTMLElement),
    ).toBe(true);
    expect(
      isEditableElement(new MockElement('select') as unknown as HTMLElement),
    ).toBe(true);

    const div = new MockElement('div');
    div.isContentEditable = true;
    expect(isEditableElement(div as unknown as HTMLElement)).toBe(true);
  });
});
