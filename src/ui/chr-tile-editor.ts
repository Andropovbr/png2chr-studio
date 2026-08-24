/**
 * Interactive 8x8 NES CHR Tile Pixel Editor Component.
 * Purely controlled UI component for pixel editing, drawing tools,
 * color index selection, and pointer stroke interaction.
 */

import {
  floodFillTile,
  setTilePixel,
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
  readonly onPixelsChange?: (pixels: Uint8Array) => void;
  readonly onSelectColorIndex?: (colorIndex: number) => void;
  readonly onSelectTool?: (tool: ChrDrawingTool) => void;
  readonly onToggleGrid?: (showGrid: boolean) => void;
  readonly onStrokeStart?: () => void;
  readonly onStrokeEnd?: () => void;
  readonly onHoverPixel?: (coord: { x: number; y: number } | null) => void;
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

  // --- 1. Toolbar ---
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
      if (options.onSelectTool) {
        options.onSelectTool(id);
      }
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
      if (options.onSelectColorIndex) {
        options.onSelectColorIndex(colorIdx);
      }
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
    if (options.onToggleGrid) {
      options.onToggleGrid(!showGrid);
    }
  });

  toolbar.append(toolsGroup, paletteGroup, gridToggleBtn);
  container.append(toolbar);

  // --- 2. Main Canvas Container ---
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

  // --- 3. Status / Coordinates Bar ---
  const statusBar = document.createElement('div');
  statusBar.className = 'chr-tile-editor-status-bar';

  const coordsDisplay = document.createElement('span');
  coordsDisplay.className = 'chr-tile-editor-coords';
  coordsDisplay.textContent = '—';

  statusBar.append(coordsDisplay);
  container.append(canvasContainer, statusBar);

  // --- 4. Pointer Interaction ---
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
        if (options.onPixelsChange) {
          options.onPixelsChange(next);
        }
        break;
      }
      case 'eraser': {
        const next = setTilePixel(options.pixels, px, py, 0);
        if (options.onPixelsChange) {
          options.onPixelsChange(next);
        }
        break;
      }
      case 'eyedropper': {
        const picked = options.pixels[py * TILE_SIZE + px] ?? 0;
        if (options.onSelectColorIndex) {
          options.onSelectColorIndex(picked);
        }
        break;
      }
      case 'fill': {
        const next = floodFillTile(options.pixels, px, py, selectedColorIndex);
        if (options.onPixelsChange) {
          options.onPixelsChange(next);
        }
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

    if (options.onStrokeStart) {
      options.onStrokeStart();
    }

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

    if (options.onStrokeEnd) {
      options.onStrokeEnd();
    }
  };

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('pointerleave', () => {
    if (!isDragging) {
      coordsDisplay.textContent = '—';
      if (options.onHoverPixel) {
        options.onHoverPixel(null);
      }
    }
  });

  return container;
}
