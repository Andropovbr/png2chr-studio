/**
 * Interactive 8x8 NES CHR Tile Pixel Editor Component.
 * Purely controlled UI component for pixel editing, drawing tools,
 * color index selection, geometric transformations, shifts, clipboard actions,
 * undo/redo history management, and keyboard shortcuts.
 */

import {
  areTilePixelsEqual,
  clearTile,
  cloneTilePixels,
  copyTileToClipboard,
  createTileHistory,
  flipTileHorizontal,
  flipTileVertical,
  floodFillTile,
  hasClipboardTile,
  pasteTileFromClipboard,
  rotateTile90,
  setTilePixel,
  shiftTile,
  validateTilePixels,
  type TileHistory,
  TILE_SIZE,
  PIXELS_PER_TILE,
} from '../core/chr-tile-editor';
import { t } from '../i18n';

export type ChrDrawingTool = 'pencil' | 'eraser' | 'eyedropper' | 'fill';

export interface ChrTileEditorRgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export const DEFAULT_CHR_EDITOR_PALETTE: readonly ChrTileEditorRgbColor[] = [
  { red: 0, green: 0, blue: 0 },
  { red: 116, green: 116, blue: 116 },
  { red: 188, green: 188, blue: 188 },
  { red: 255, green: 255, blue: 255 },
];

export interface ChrTileEditorOptions {
  readonly pixels: Uint8Array;
  readonly selectedColorIndex?: number;
  readonly activeTool?: ChrDrawingTool;
  readonly paletteColors?: readonly ChrTileEditorRgbColor[];
  readonly showGrid?: boolean;
  readonly shiftWrap?: boolean;
  readonly history?: TileHistory<Uint8Array>;
  readonly onPixelsChange?: (pixels: Uint8Array) => void;
  readonly onSelectColorIndex?: (colorIndex: number) => void;
  readonly onSelectTool?: (tool: ChrDrawingTool) => void;
  readonly onToggleGrid?: (showGrid: boolean) => void;
  readonly onToggleShiftWrap?: (shiftWrap: boolean) => void;
  readonly onStrokeStart?: () => void;
  readonly onStrokeEnd?: () => void;
  readonly onHoverPixel?: (coord: { x: number; y: number } | null) => void;
  readonly onCopy?: (copiedPixels: Uint8Array) => void;
  readonly onPaste?: (pastedPixels: Uint8Array) => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly ariaLabel?: string;
}

/**
 * Checks whether an event target is an editable form input/textarea/contenteditable.
 */
export function isEditableElement(target: EventTarget | null): boolean {
  if (!target) {
    return false;
  }
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
  };
  if (typeof el.tagName === 'string') {
    const tag = el.tagName.toLowerCase();
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      el.isContentEditable === true
    ) {
      return true;
    }
  }
  return false;
}

export function createChrTileEditor(
  options: ChrTileEditorOptions,
): HTMLElement {
  validateTilePixels(options.pixels);

  const container = document.createElement('div');
  container.className = 'chr-tile-editor';
  container.setAttribute('role', 'region');
  container.tabIndex = 0;
  container.setAttribute(
    'aria-label',
    options.ariaLabel ?? t('chrEditorTitle'),
  );

  const selectedColorIndex = options.selectedColorIndex ?? 1;
  const activeTool: ChrDrawingTool = options.activeTool ?? 'pencil';
  const paletteColors =
    options.paletteColors?.length === 4
      ? options.paletteColors
      : DEFAULT_CHR_EDITOR_PALETTE;
  const showGrid = options.showGrid ?? true;
  let shiftWrap = options.shiftWrap ?? false;

  // Undo / Redo History Instance
  const history: TileHistory<Uint8Array> =
    options.history ??
    createTileHistory(cloneTilePixels(options.pixels), 50, areTilePixelsEqual);

  const canvas = document.createElement('canvas');
  canvas.className = `chr-tile-editor-canvas${showGrid ? ' has-grid' : ''}`;
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('chrEditorCanvasAriaLabel'));

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
  }

  let currentPixels: Uint8Array = cloneTilePixels(options.pixels);

  const renderLocalCanvas = (pixels: Uint8Array): void => {
    currentPixels = pixels;
    if (!ctx) return;
    const imgData = ctx.createImageData(TILE_SIZE, TILE_SIZE);
    for (let i = 0; i < PIXELS_PER_TILE; i += 1) {
      const cIdx = pixels[i] ?? 0;
      const rgb = paletteColors[cIdx] ?? { red: 0, green: 0, blue: 0 };
      const offset = i * 4;
      imgData.data[offset] = rgb.red;
      imgData.data[offset + 1] = rgb.green;
      imgData.data[offset + 2] = rgb.blue;
      imgData.data[offset + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  };

  renderLocalCanvas(currentPixels);

  // --- 1. Primary Toolbar (Drawing & Palette) ---
  const toolbar = document.createElement('div');
  toolbar.className = 'chr-tile-editor-toolbar';

  // Tools Group
  const toolsGroup = document.createElement('div');
  toolsGroup.className = 'chr-editor-tools-group';
  toolsGroup.setAttribute('role', 'toolbar');
  toolsGroup.setAttribute('aria-label', t('chrEditorToolsLabel'));

  const tools: { id: ChrDrawingTool; labelKey: string; icon: string }[] = [
    { id: 'pencil', labelKey: 'chrEditorToolPencil', icon: '✏️' },
    { id: 'eraser', labelKey: 'chrEditorToolEraser', icon: '🧹' },
    { id: 'eyedropper', labelKey: 'chrEditorToolEyedropper', icon: '💉' },
    { id: 'fill', labelKey: 'chrEditorToolFill', icon: '🪣' },
  ];

  tools.forEach(({ id, labelKey, icon }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `button icon-button chr-editor-tool-btn${id === activeTool ? ' is-active' : ''}`;
    btn.setAttribute('data-tool', id);
    btn.setAttribute('aria-pressed', id === activeTool ? 'true' : 'false');
    btn.title = t(labelKey as Parameters<typeof t>[0]);
    btn.setAttribute('aria-label', t(labelKey as Parameters<typeof t>[0]));
    btn.textContent = icon;

    btn.addEventListener('click', () => {
      options.onSelectTool?.(id);
    });

    toolsGroup.append(btn);
  });

  // Palette Color Indices Group (0, 1, 2, 3)
  const paletteGroup = document.createElement('div');
  paletteGroup.className = 'chr-editor-palette-group';
  paletteGroup.setAttribute('role', 'radiogroup');
  paletteGroup.setAttribute('aria-label', t('chrEditorColorIndexSelector'));

  for (let colorIdx = 0; colorIdx < 4; colorIdx += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `button chr-editor-color-btn${colorIdx === selectedColorIndex ? ' is-active' : ''}`;
    btn.setAttribute('data-color-index', String(colorIdx));
    btn.setAttribute('role', 'radio');
    btn.setAttribute(
      'aria-checked',
      colorIdx === selectedColorIndex ? 'true' : 'false',
    );
    btn.setAttribute(
      'aria-label',
      t('chrEditorColorIndexLabel', { index: colorIdx }),
    );
    btn.title = t('chrEditorColorIndexLabel', { index: colorIdx });

    const swatch = document.createElement('span');
    swatch.className = 'chr-editor-color-swatch';
    const rgb = paletteColors[colorIdx] ?? { red: 0, green: 0, blue: 0 };
    swatch.style.backgroundColor = `rgb(${String(rgb.red)}, ${String(rgb.green)}, ${String(rgb.blue)})`;

    const label = document.createElement('span');
    label.className = 'chr-editor-color-num';
    label.textContent = String(colorIdx);

    btn.append(swatch, label);

    btn.addEventListener('click', () => {
      options.onSelectColorIndex?.(colorIdx);
    });

    paletteGroup.append(btn);
  }

  // Grid toggle button
  const gridToggleBtn = document.createElement('button');
  gridToggleBtn.type = 'button';
  gridToggleBtn.className = `button icon-button chr-editor-grid-btn${showGrid ? ' is-active' : ''}`;
  gridToggleBtn.setAttribute('aria-pressed', showGrid ? 'true' : 'false');
  gridToggleBtn.title = t('chrEditorGridToggle');
  gridToggleBtn.setAttribute('aria-label', t('chrEditorGridToggle'));
  gridToggleBtn.textContent = '⊞';
  gridToggleBtn.addEventListener('click', () => {
    options.onToggleGrid?.(!showGrid);
  });

  toolbar.append(toolsGroup, paletteGroup, gridToggleBtn);

  // --- 2. Secondary Operations Toolbar (History, Transform, Shift & Actions) ---
  const actionsToolbar = document.createElement('div');
  actionsToolbar.className =
    'chr-tile-editor-toolbar chr-tile-editor-actions-toolbar';

  // History Group (Undo, Redo)
  const historyGroup = document.createElement('div');
  historyGroup.className = 'chr-editor-history-group';
  historyGroup.setAttribute('role', 'toolbar');
  historyGroup.setAttribute('aria-label', t('chrEditorHistoryGroup'));

  // Undo button
  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className =
    'button icon-button chr-editor-action-btn chr-editor-undo-btn';
  undoBtn.setAttribute('data-action', 'undo');
  undoBtn.title = t('chrEditorUndo');
  undoBtn.setAttribute('aria-label', t('chrEditorUndo'));
  undoBtn.textContent = '↶';
  undoBtn.disabled = !history.canUndo;
  undoBtn.setAttribute('aria-disabled', history.canUndo ? 'false' : 'true');

  // Redo button
  const redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.className =
    'button icon-button chr-editor-action-btn chr-editor-redo-btn';
  redoBtn.setAttribute('data-action', 'redo');
  redoBtn.title = t('chrEditorRedo');
  redoBtn.setAttribute('aria-label', t('chrEditorRedo'));
  redoBtn.textContent = '↷';
  redoBtn.disabled = !history.canRedo;
  redoBtn.setAttribute('aria-disabled', history.canRedo ? 'false' : 'true');

  const updateHistoryButtons = (): void => {
    undoBtn.disabled = !history.canUndo;
    undoBtn.setAttribute('aria-disabled', history.canUndo ? 'false' : 'true');
    redoBtn.disabled = !history.canRedo;
    redoBtn.setAttribute('aria-disabled', history.canRedo ? 'false' : 'true');
  };

  const handleUndo = (): void => {
    if (!history.canUndo) return;
    const prev = history.undo();
    if (prev) {
      renderLocalCanvas(prev);
      updateHistoryButtons();
      options.onPixelsChange?.(cloneTilePixels(prev));
      options.onUndo?.();
    }
  };

  const handleRedo = (): void => {
    if (!history.canRedo) return;
    const next = history.redo();
    if (next) {
      renderLocalCanvas(next);
      updateHistoryButtons();
      options.onPixelsChange?.(cloneTilePixels(next));
      options.onRedo?.();
    }
  };

  const applyInstantAction = (nextPixels: Uint8Array): void => {
    if (!areTilePixelsEqual(currentPixels, nextPixels)) {
      history.pushState(cloneTilePixels(nextPixels));
      renderLocalCanvas(nextPixels);
      updateHistoryButtons();
      options.onPixelsChange?.(nextPixels);
    }
  };

  undoBtn.addEventListener('click', handleUndo);
  redoBtn.addEventListener('click', handleRedo);

  historyGroup.append(undoBtn, redoBtn);

  // Transform Group (Flip H, Flip V, Rotate CW, Rotate CCW)
  const transformGroup = document.createElement('div');
  transformGroup.className = 'chr-editor-transform-group';
  transformGroup.setAttribute('role', 'toolbar');
  transformGroup.setAttribute('aria-label', t('chrEditorTransformGroup'));

  const transformActions: {
    id: string;
    labelKey: string;
    icon: string;
    execute: () => Uint8Array;
  }[] = [
    {
      id: 'flip-h',
      labelKey: 'chrEditorFlipH',
      icon: '⇋',
      execute: () => flipTileHorizontal(options.pixels),
    },
    {
      id: 'flip-v',
      labelKey: 'chrEditorFlipV',
      icon: '⇅',
      execute: () => flipTileVertical(options.pixels),
    },
    {
      id: 'rotate-cw',
      labelKey: 'chrEditorRotateCw',
      icon: '↷',
      execute: () => rotateTile90(options.pixels, true),
    },
    {
      id: 'rotate-ccw',
      labelKey: 'chrEditorRotateCcw',
      icon: '↶',
      execute: () => rotateTile90(options.pixels, false),
    },
  ];

  transformActions.forEach(({ id, labelKey, icon, execute }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button icon-button chr-editor-action-btn';
    btn.setAttribute('data-action', id);
    btn.title = t(labelKey as Parameters<typeof t>[0]);
    btn.setAttribute('aria-label', t(labelKey as Parameters<typeof t>[0]));
    btn.textContent = icon;

    btn.addEventListener('click', () => {
      const next = execute();
      applyInstantAction(next);
    });

    transformGroup.append(btn);
  });

  // Shift Group (Up, Down, Left, Right, Wrap Toggle)
  const shiftGroup = document.createElement('div');
  shiftGroup.className = 'chr-editor-shift-group';
  shiftGroup.setAttribute('role', 'toolbar');
  shiftGroup.setAttribute('aria-label', t('chrEditorShiftGroup'));

  const shiftDirections: {
    dir: 'up' | 'down' | 'left' | 'right';
    id: string;
    labelKey: string;
    icon: string;
  }[] = [
    { dir: 'up', id: 'shift-up', labelKey: 'chrEditorShiftUp', icon: '↑' },
    {
      dir: 'down',
      id: 'shift-down',
      labelKey: 'chrEditorShiftDown',
      icon: '↓',
    },
    {
      dir: 'left',
      id: 'shift-left',
      labelKey: 'chrEditorShiftLeft',
      icon: '←',
    },
    {
      dir: 'right',
      id: 'shift-right',
      labelKey: 'chrEditorShiftRight',
      icon: '→',
    },
  ];

  shiftDirections.forEach(({ dir, id, labelKey, icon }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button icon-button chr-editor-action-btn';
    btn.setAttribute('data-action', id);
    btn.title = t(labelKey as Parameters<typeof t>[0]);
    btn.setAttribute('aria-label', t(labelKey as Parameters<typeof t>[0]));
    btn.textContent = icon;

    btn.addEventListener('click', () => {
      const next = shiftTile(options.pixels, dir, shiftWrap);
      applyInstantAction(next);
    });

    shiftGroup.append(btn);
  });

  // Wrap toggle
  const wrapBtn = document.createElement('button');
  wrapBtn.type = 'button';
  wrapBtn.className = `button icon-button chr-editor-action-btn chr-editor-wrap-btn${shiftWrap ? ' is-active' : ''}`;
  wrapBtn.setAttribute('data-action', 'wrap-toggle');
  wrapBtn.setAttribute('aria-pressed', shiftWrap ? 'true' : 'false');
  wrapBtn.title = t('chrEditorShiftWrap');
  wrapBtn.setAttribute('aria-label', t('chrEditorShiftWrap'));
  wrapBtn.textContent = '🔁';
  wrapBtn.addEventListener('click', () => {
    shiftWrap = !shiftWrap;
    wrapBtn.setAttribute('aria-pressed', shiftWrap ? 'true' : 'false');
    wrapBtn.classList.toggle('is-active', shiftWrap);
    options.onToggleShiftWrap?.(shiftWrap);
  });
  shiftGroup.append(wrapBtn);

  // Actions Group (Clear, Copy, Paste)
  const actionsGroup = document.createElement('div');
  actionsGroup.className = 'chr-editor-actions-group';
  actionsGroup.setAttribute('role', 'toolbar');
  actionsGroup.setAttribute('aria-label', t('chrEditorActionsGroup'));

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'button icon-button chr-editor-action-btn';
  clearBtn.setAttribute('data-action', 'clear');
  clearBtn.title = t('chrEditorClear');
  clearBtn.setAttribute('aria-label', t('chrEditorClear'));
  clearBtn.textContent = '🗑️';
  clearBtn.addEventListener('click', () => {
    const next = clearTile(options.pixels, 0);
    applyInstantAction(next);
  });

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'button icon-button chr-editor-action-btn';
  copyBtn.setAttribute('data-action', 'copy');
  copyBtn.title = t('chrEditorCopy');
  copyBtn.setAttribute('aria-label', t('chrEditorCopy'));
  copyBtn.textContent = '📋';

  // Paste button
  const pasteBtn = document.createElement('button');
  pasteBtn.type = 'button';
  pasteBtn.className = 'button icon-button chr-editor-action-btn';
  pasteBtn.setAttribute('data-action', 'paste');
  pasteBtn.title = t('chrEditorPaste');
  pasteBtn.setAttribute('aria-label', t('chrEditorPaste'));
  pasteBtn.textContent = '📥';
  const hasClipboard = hasClipboardTile();
  pasteBtn.disabled = !hasClipboard;
  if (!hasClipboard) {
    pasteBtn.setAttribute('aria-disabled', 'true');
  }

  const updatePasteButton = (): void => {
    const available = hasClipboardTile();
    pasteBtn.disabled = !available;
    pasteBtn.setAttribute('aria-disabled', available ? 'false' : 'true');
  };

  copyBtn.addEventListener('click', () => {
    const copied = copyTileToClipboard(options.pixels);
    updatePasteButton();
    options.onCopy?.(copied);
  });

  pasteBtn.addEventListener('click', () => {
    const pasted = pasteTileFromClipboard();
    if (pasted) {
      applyInstantAction(pasted);
      options.onPaste?.(pasted);
    }
  });

  actionsGroup.append(clearBtn, copyBtn, pasteBtn);

  actionsToolbar.append(historyGroup, transformGroup, shiftGroup, actionsGroup);
  container.append(toolbar, actionsToolbar);

  // --- 3. Main Canvas Container ---
  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'chr-tile-editor-canvas-container';

  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = `chr-tile-editor-canvas-wrapper${showGrid ? ' has-grid' : ''}`;

  const gridOverlay = document.createElement('div');
  gridOverlay.className = `chr-tile-editor-grid-overlay${showGrid ? ' is-visible' : ''}`;
  gridOverlay.setAttribute('aria-hidden', 'true');

  canvasWrapper.append(canvas, gridOverlay);
  canvasContainer.append(canvasWrapper);

  // --- 4. Status / Coordinates Bar ---
  const statusBar = document.createElement('div');
  statusBar.className = 'chr-tile-editor-status-bar';

  const coordsDisplay = document.createElement('span');
  coordsDisplay.className = 'chr-tile-editor-coords';
  coordsDisplay.textContent = '—';

  statusBar.append(coordsDisplay);
  container.append(canvasContainer, statusBar);

  // --- 5. Pointer Interaction (Batching Strokes into Atomic History Steps) ---
  let isDragging = false;
  let lastPixel: { x: number; y: number } | null = null;
  let strokeStartPixels: Uint8Array | null = null;
  let strokeCurrentPixels: Uint8Array = currentPixels;
  let strokeModified = false;

  const getCoordinates = (
    e: PointerEvent | MouseEvent,
  ): { px: number; py: number } => {
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * TILE_SIZE);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * TILE_SIZE);
    return { px, py };
  };

  const applyToolAt = (px: number, py: number): void => {
    if (px < 0 || px >= TILE_SIZE || py < 0 || py >= TILE_SIZE) {
      return;
    }

    switch (activeTool) {
      case 'pencil': {
        const next = setTilePixel(
          strokeCurrentPixels,
          px,
          py,
          selectedColorIndex,
        );
        if (!areTilePixelsEqual(strokeCurrentPixels, next)) {
          strokeCurrentPixels = next;
          strokeModified = true;
          renderLocalCanvas(next);
          options.onPixelsChange?.(next);
        }
        break;
      }
      case 'eraser': {
        const next = setTilePixel(strokeCurrentPixels, px, py, 0);
        if (!areTilePixelsEqual(strokeCurrentPixels, next)) {
          strokeCurrentPixels = next;
          strokeModified = true;
          renderLocalCanvas(next);
          options.onPixelsChange?.(next);
        }
        break;
      }
      case 'eyedropper': {
        const picked = currentPixels[py * TILE_SIZE + px] ?? 0;
        options.onSelectColorIndex?.(picked);
        break;
      }
      case 'fill': {
        const next = floodFillTile(currentPixels, px, py, selectedColorIndex);
        applyInstantAction(next);
        break;
      }
    }
  };

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    const { px, py } = getCoordinates(e);
    if (px < 0 || px >= TILE_SIZE || py < 0 || py >= TILE_SIZE) {
      return;
    }

    try {
      if (typeof canvas.setPointerCapture === 'function') {
        canvas.setPointerCapture(e.pointerId);
      }
    } catch {
      // Safe fallback in non-browser/test environments
    }

    isDragging = true;
    lastPixel = { x: px, y: py };
    strokeStartPixels = cloneTilePixels(currentPixels);
    strokeCurrentPixels = currentPixels;
    strokeModified = false;

    options.onStrokeStart?.();
    applyToolAt(px, py);
  });

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const { px, py } = getCoordinates(e);
    const inBounds = px >= 0 && px < TILE_SIZE && py >= 0 && py < TILE_SIZE;

    if (inBounds) {
      coordsDisplay.textContent = t('chrEditorCoordsLabel', { x: px, y: py });
      options.onHoverPixel?.({ x: px, y: py });

      if (isDragging && (activeTool === 'pencil' || activeTool === 'eraser')) {
        if (lastPixel?.x !== px || lastPixel.y !== py) {
          lastPixel = { x: px, y: py };
          applyToolAt(px, py);
        }
      }
    } else if (!isDragging) {
      coordsDisplay.textContent = '—';
      options.onHoverPixel?.(null);
    }
  });

  const endDrag = (e: PointerEvent): void => {
    if (!isDragging) return;
    isDragging = false;
    lastPixel = null;

    try {
      if (typeof canvas.releasePointerCapture === 'function') {
        canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Safe fallback
    }

    if (
      strokeModified &&
      strokeStartPixels &&
      !areTilePixelsEqual(strokeStartPixels, strokeCurrentPixels)
    ) {
      history.pushState(cloneTilePixels(strokeCurrentPixels));
      updateHistoryButtons();
    }
    strokeStartPixels = null;

    options.onStrokeEnd?.();
  };

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('pointerleave', () => {
    if (!isDragging) {
      coordsDisplay.textContent = '—';
      options.onHoverPixel?.(null);
    }
  });

  // --- 6. Keyboard Shortcuts Handler ---
  const handleKeyDown = (e: KeyboardEvent): void => {
    if (typeof container.isConnected === 'boolean' && !container.isConnected) {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown);
      }
      return;
    }
    if (isEditableElement(e.target)) {
      return;
    }

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const keyLower = e.key.toLowerCase();

    // 1. Undo: Ctrl+Z / Cmd+Z (without Shift)
    if (isCtrlOrCmd && keyLower === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }

    // 2. Redo: Ctrl+Y / Cmd+Y OR Ctrl+Shift+Z / Cmd+Shift+Z
    if (
      (isCtrlOrCmd && keyLower === 'y') ||
      (isCtrlOrCmd && e.shiftKey && keyLower === 'z')
    ) {
      e.preventDefault();
      handleRedo();
      return;
    }

    // 3. Copy: Ctrl+C / Cmd+C
    if (isCtrlOrCmd && keyLower === 'c') {
      e.preventDefault();
      const copied = copyTileToClipboard(currentPixels);
      updatePasteButton();
      options.onCopy?.(copied);
      return;
    }

    // 4. Paste: Ctrl+V / Cmd+V
    if (isCtrlOrCmd && keyLower === 'v') {
      e.preventDefault();
      const pasted = pasteTileFromClipboard();
      if (pasted) {
        applyInstantAction(pasted);
        options.onPaste?.(pasted);
      }
      return;
    }

    // Ignore further single-key shortcuts if Ctrl/Meta/Alt are held
    if (isCtrlOrCmd || e.altKey) {
      return;
    }

    // 5. Tool Shortcuts: P (pencil), E (eraser), I (eyedropper), F (fill)
    if (keyLower === 'p') {
      e.preventDefault();
      options.onSelectTool?.('pencil');
      return;
    }
    if (keyLower === 'e') {
      e.preventDefault();
      options.onSelectTool?.('eraser');
      return;
    }
    if (keyLower === 'i') {
      e.preventDefault();
      options.onSelectTool?.('eyedropper');
      return;
    }
    if (keyLower === 'f') {
      e.preventDefault();
      options.onSelectTool?.('fill');
      return;
    }

    // 6. Color Index Shortcuts: 0, 1, 2, 3
    if (e.key === '0' || e.key === '1' || e.key === '2' || e.key === '3') {
      e.preventDefault();
      options.onSelectColorIndex?.(Number(e.key));
      return;
    }

    // 7. Clear Shortcut: Delete / Backspace
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      applyInstantAction(clearTile(currentPixels, 0));
      return;
    }
  };

  container.addEventListener('keydown', handleKeyDown);
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown);
  }

  return container;
}
