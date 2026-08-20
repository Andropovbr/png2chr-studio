import {
  calculateTileCoordinates,
  extractTileFromIndexedImage,
  hasTileOverride,
  PIXELS_PER_TILE,
  TILE_SIZE,
  type TilePixelOverrides,
} from '../core/pixel-overrides';
import {
  NES_MASTER_PALETTE,
  type NesPalette,
  type NesPaletteSet,
} from '../core/nes-palette';
import { t } from '../i18n';
import type { IndexedImage } from '../core/types';

export interface TilePixelEditorOptions {
  readonly animationId: string;
  readonly animationName: string;
  readonly entityName?: string;
  readonly frameIndex: number;
  readonly tileCol: number;
  readonly tileRow: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly indexedImage: IndexedImage;
  readonly paletteSet?: NesPaletteSet;
  readonly effectivePaletteIndex?: number;
  readonly effectivePalette?: NesPalette;
  readonly overrides?: TilePixelOverrides;
  readonly onSetPixel: (
    animationId: string,
    tileX: number,
    tileY: number,
    pixelX: number,
    pixelY: number,
    colorIndex: number,
  ) => void;
  readonly onResetTile: (
    animationId: string,
    tileX: number,
    tileY: number,
  ) => void;
}

export function createTilePixelEditor(
  options: TilePixelEditorOptions,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'tile-pixel-editor-container';

  const frameCols = Math.floor(options.indexedImage.width / options.frameWidth);
  const sourceX = (options.frameIndex % frameCols) * options.frameWidth;
  const sourceY = Math.floor(options.frameIndex / frameCols) * options.frameHeight;

  const { tileX, tileY } = calculateTileCoordinates(
    sourceX,
    sourceY,
    options.tileCol,
    options.tileRow,
  );

  const isOverridden = hasTileOverride(options.overrides, tileX, tileY);

  // Header & Info
  const header = document.createElement('div');
  header.className = 'tile-pixel-editor-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'tile-pixel-editor-title-group';

  const title = document.createElement('h4');
  title.className = 'tile-pixel-editor-title';
  title.textContent = `${t('tilePixelEditorTitle')} — Tile (${String(options.tileCol)}, ${String(options.tileRow)})`;

  if (isOverridden) {
    const badge = document.createElement('span');
    badge.className = 'status-badge tile-pixel-modified-badge';
    badge.textContent = t('tilePixelModified');
    title.append(' ', badge);
  }

  const meta = document.createElement('span');
  meta.className = 'tile-pixel-editor-meta';
  meta.textContent = `${options.entityName ?? 'entity'}_${options.animationName} · Frame #${String(options.frameIndex)} · Tile Pos (${String(tileX)}, ${String(tileY)})`;

  titleGroup.append(title, meta);

  // Reset button
  const btnReset = document.createElement('button');
  btnReset.type = 'button';
  btnReset.className = 'button secondary-button tile-pixel-reset-btn';
  btnReset.textContent = t('tilePixelReset');
  btnReset.title = t('tilePixelResetHint');
  btnReset.disabled = !isOverridden;
  btnReset.addEventListener('click', () => {
    options.onResetTile(options.animationId, tileX, tileY);
  });

  header.append(titleGroup, btnReset);
  container.append(header);

  // Main Editor Body
  const body = document.createElement('div');
  body.className = 'tile-pixel-editor-body';

  // 8x8 Zoomed Canvas
  const CANVAS_DISPLAY_SIZE = 192; // 8x8 * 24px scale
  const canvas = document.createElement('canvas');
  canvas.className = 'tile-pixel-editor-canvas';
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  canvas.style.width = `${String(CANVAS_DISPLAY_SIZE)}px`;
  canvas.style.height = `${String(CANVAS_DISPLAY_SIZE)}px`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('tilePixelEditorTitle'));

  // Active Index Selector (0, 1, 2, 3)
  let activeIndex = 1;
  const paletteIndices = [0, 1, 2, 3] as const;
  const subPalette =
    options.effectivePalette ??
    options.paletteSet?.[options.effectivePaletteIndex ?? 0] ??
    [0x0f, 0x00, 0x10, 0x30];

  const paletteSelector = document.createElement('div');
  paletteSelector.className = 'tile-pixel-palette-selector';

  const selectorLabel = document.createElement('span');
  selectorLabel.className = 'tile-pixel-palette-label';
  selectorLabel.textContent = t('tilePixelActiveIndex');
  paletteSelector.append(selectorLabel);

  const indexButtonsGroup = document.createElement('div');
  indexButtonsGroup.className = 'tile-pixel-index-buttons';

  paletteIndices.forEach((idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tile-pixel-index-btn${idx === activeIndex ? ' is-active' : ''}`;

    const colorCode = subPalette[idx];
    const nesRgb = NES_MASTER_PALETTE[colorCode] ?? { red: 0, green: 0, blue: 0 };

    const swatch = document.createElement('span');
    swatch.className = 'tile-pixel-swatch';
    if (idx === 0) {
      swatch.style.backgroundColor = 'transparent';
      swatch.classList.add('is-transparent');
    } else {
      swatch.style.backgroundColor = `rgb(${String(nesRgb.red)}, ${String(nesRgb.green)}, ${String(nesRgb.blue)})`;
    }

    const label = document.createElement('span');
    label.className = 'tile-pixel-index-num';
    label.textContent = idx === 0 ? '0 (BG)' : String(idx);

    btn.append(swatch, label);
    btn.addEventListener('click', () => {
      activeIndex = idx;
      indexButtonsGroup
        .querySelectorAll('.tile-pixel-index-btn')
        .forEach((b, bIdx) => {
          b.classList.toggle('is-active', bIdx === idx);
        });
    });

    indexButtonsGroup.append(btn);
  });

  paletteSelector.append(indexButtonsGroup);

  // Extract current pixels with overrides applied
  const currentTilePixels = extractTileFromIndexedImage(
    options.indexedImage,
    tileX,
    tileY,
    options.overrides,
  );

  // Render 8x8 Canvas
  const drawTile = (): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    ctx.imageSmoothingEnabled = false;

    const imgData = ctx.createImageData(TILE_SIZE, TILE_SIZE);
    for (let i = 0; i < PIXELS_PER_TILE; i += 1) {
      const pIndex = currentTilePixels[i] ?? 0;
      const offset = i * 4;
      if (pIndex === 0) {
        // Transparent / Dark backdrop in canvas
        imgData.data[offset] = 16;
        imgData.data[offset + 1] = 16;
        imgData.data[offset + 2] = 24;
        imgData.data[offset + 3] = 255;
      } else {
        const colorCode = subPalette[pIndex as 0 | 1 | 2 | 3];
        const nesRgb = NES_MASTER_PALETTE[colorCode] ?? { red: 0, green: 0, blue: 0 };
        imgData.data[offset] = nesRgb.red;
        imgData.data[offset + 1] = nesRgb.green;
        imgData.data[offset + 2] = nesRgb.blue;
        imgData.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  };

  drawTile();

  // Pointer Interaction (Click & Drag Painting)
  let isPainting = false;

  const paintPixelAtEvent = (e: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * TILE_SIZE);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * TILE_SIZE);

    if (px >= 0 && px < TILE_SIZE && py >= 0 && py < TILE_SIZE) {
      const offset = py * TILE_SIZE + px;
      if (currentTilePixels[offset] !== activeIndex) {
        currentTilePixels[offset] = activeIndex;
        drawTile();
        options.onSetPixel(
          options.animationId,
          tileX,
          tileY,
          px,
          py,
          activeIndex,
        );
      }
    }
  };

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      // Left click: Paint
      isPainting = true;
      paintPixelAtEvent(e);
    } else if (e.button === 2) {
      // Right click: Eyedropper / Pick existing index
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = Math.floor(((e.clientX - rect.left) / rect.width) * TILE_SIZE);
      const py = Math.floor(((e.clientY - rect.top) / rect.height) * TILE_SIZE);
      if (px >= 0 && px < TILE_SIZE && py >= 0 && py < TILE_SIZE) {
        const picked = currentTilePixels[py * TILE_SIZE + px] ?? 0;
        activeIndex = picked;
        indexButtonsGroup
          .querySelectorAll('.tile-pixel-index-btn')
          .forEach((b, bIdx) => {
            b.classList.toggle('is-active', bIdx === picked);
          });
      }
    }
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (isPainting) {
      paintPixelAtEvent(e);
    }
  });

  window.addEventListener('mouseup', () => {
    isPainting = false;
  });

  body.append(canvas, paletteSelector);
  container.append(body);

  return container;
}
