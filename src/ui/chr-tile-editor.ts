/**
 * Interactive 8x8 NES CHR Tile Pixel Editor Component.
 * Purely controlled UI component for pixel editing, drawing tools,
 * color index selection, geometric transformations, shifts, and clipboard actions.
 */

import {
  clearTile,
  copyTileToClipboard,
  flipTileHorizontal,
  flipTileVertical,
  floodFillTile,
  hasClipboardTile,
  pasteTileFromClipboard,
  rotateTile90,
  setTilePixel,
  shiftTile,
  validateTilePixels,
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
  readonly ariaLabel?: string;
}

export function createChrTileEditor(
  options: ChrTileEditorOptions,
): HTMLElement {
  validateTilePixels(options.pixels);

  const container = document.createElement('div');
  container.className = 'chr-tile-editor';
  container.setAttribute('role', 'region');
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

  // --- 2. Secondary Operations Toolbar (Transform, Shift & Clipboard) ---
  const actionsToolbar = document.createElement('div');
  actionsToolbar.className =
    'chr-tile-editor-toolbar chr-tile-editor-actions-toolbar';

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
      options.onPixelsChange?.(next);
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
      options.onPixelsChange?.(next);
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
    options.onPixelsChange?.(next);
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

  copyBtn.addEventListener('click', () => {
    const copied = copyTileToClipboard(options.pixels);
    pasteBtn.disabled = false;
    pasteBtn.removeAttribute('aria-disabled');
    options.onCopy?.(copied);
  });

  pasteBtn.addEventListener('click', () => {
    const pasted = pasteTileFromClipboard();
    if (pasted) {
      options.onPixelsChange?.(pasted);
      options.onPaste?.(pasted);
    }
  });

  actionsGroup.append(clearBtn, copyBtn, pasteBtn);

  actionsToolbar.append(transformGroup, shiftGroup, actionsGroup);
  container.append(toolbar, actionsToolbar);

  // --- 3. Main Canvas Container ---
  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'chr-tile-editor-canvas-container';

  const canvas = document.createElement('canvas');
  canvas.className = `chr-tile-editor-canvas${showGrid ? ' has-grid' : ''}`;
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('chrEditorCanvasAriaLabel'));

  // Render 8x8 pixels onto canvas
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    const imgData = ctx.createImageData(TILE_SIZE, TILE_SIZE);
    for (let i = 0; i < PIXELS_PER_TILE; i += 1) {
      const cIdx = options.pixels[i] ?? 0;
      const rgb = paletteColors[cIdx] ?? { red: 0, green: 0, blue: 0 };
      const offset = i * 4;
      imgData.data[offset] = rgb.red;
      imgData.data[offset + 1] = rgb.green;
      imgData.data[offset + 2] = rgb.blue;
      imgData.data[offset + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  canvasContainer.append(canvas);

  // --- 4. Status / Coordinates Bar ---
  const statusBar = document.createElement('div');
  statusBar.className = 'chr-tile-editor-status-bar';

  const coordsDisplay = document.createElement('span');
  coordsDisplay.className = 'chr-tile-editor-coords';
  coordsDisplay.textContent = '—';

  statusBar.append(coordsDisplay);
  container.append(canvasContainer, statusBar);

  // --- 5. Pointer Interaction ---
  let isDragging = false;
  let lastPixel: { x: number; y: number } | null = null;

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
        const next = setTilePixel(options.pixels, px, py, selectedColorIndex);
        options.onPixelsChange?.(next);
        break;
      }
      case 'eraser': {
        const next = setTilePixel(options.pixels, px, py, 0);
        options.onPixelsChange?.(next);
        break;
      }
      case 'eyedropper': {
        const picked = options.pixels[py * TILE_SIZE + px] ?? 0;
        options.onSelectColorIndex?.(picked);
        break;
      }
      case 'fill': {
        const next = floodFillTile(options.pixels, px, py, selectedColorIndex);
        options.onPixelsChange?.(next);
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

  return container;
}
