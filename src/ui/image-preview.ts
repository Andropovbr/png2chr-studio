import {
  COLLISION_COLUMNS,
  COLLISION_ROWS,
  countCollisionCells,
} from '../core/collision-encoder';
import { t } from '../i18n';
import type { PreviewTool } from './types';

interface ImagePreviewOptions {
  readonly image: ImageData | null;
  readonly collisionCells: Uint8Array | null;
  readonly paletteAssignments: Uint8Array | null;
  readonly paletteRegionSize: number | null;
  readonly showPaletteNumbers: boolean;
  readonly selectedPaletteRegion: number | null;
  readonly activeTool: PreviewTool;
  readonly onActiveToolChange: (tool: PreviewTool) => void;
  readonly onCollisionChange: (cells: Uint8Array) => void;
  readonly onPaletteRegionSelect: (regionIndex: number) => void;
}

function drawPreview(
  context: CanvasRenderingContext2D,
  image: ImageData,
  cells: Uint8Array | null,
  keyboardIndex: number | null = null,
  paletteAssignments: Uint8Array | null = null,
  paletteRegionSize: number | null = null,
  showPaletteNumbers = false,
  selectedPaletteRegion: number | null = null,
): void {
  context.putImageData(image, 0, 0);
  if (cells !== null) {
    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index] === 0) continue;
      const column = index % COLLISION_COLUMNS;
      const row = Math.floor(index / COLLISION_COLUMNS);
      context.fillStyle = 'rgb(255 57 82 / 55%)';
      context.fillRect(column * 8, row * 8, 8, 8);
      context.strokeStyle = 'rgb(255 255 255 / 80%)';
      context.lineWidth = 0.75;
      context.beginPath();
      context.moveTo(column * 8 + 2, row * 8 + 2);
      context.lineTo(column * 8 + 6, row * 8 + 6);
      context.moveTo(column * 8 + 6, row * 8 + 2);
      context.lineTo(column * 8 + 2, row * 8 + 6);
      context.stroke();
    }

    context.strokeStyle = 'rgb(255 255 255 / 28%)';
    context.lineWidth = 0.5;
    context.beginPath();
    for (let column = 1; column < COLLISION_COLUMNS; column += 1) {
      context.moveTo(column * 8, 0);
      context.lineTo(column * 8, COLLISION_ROWS * 8);
    }
    for (let row = 1; row < COLLISION_ROWS; row += 1) {
      context.moveTo(0, row * 8);
      context.lineTo(COLLISION_COLUMNS * 8, row * 8);
    }
    context.stroke();

    if (keyboardIndex !== null) {
      const column = keyboardIndex % COLLISION_COLUMNS;
      const row = Math.floor(keyboardIndex / COLLISION_COLUMNS);
      context.strokeStyle = '#ffe36e';
      context.lineWidth = 2;
      context.strokeRect(column * 8 + 1, row * 8 + 1, 6, 6);
    }
  }

  if (
    showPaletteNumbers &&
    paletteAssignments !== null &&
    paletteRegionSize !== null
  ) {
    const regionColumns = image.width / paletteRegionSize;
    paletteAssignments.forEach((paletteIndex, regionIndex) => {
      const column = regionIndex % regionColumns;
      const row = Math.floor(regionIndex / regionColumns);
      const centerX = column * paletteRegionSize + paletteRegionSize / 2;
      const centerY = row * paletteRegionSize + paletteRegionSize / 2;
      context.font = `bold ${String(Math.max(6, paletteRegionSize * 0.6))}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = 3;
      context.strokeStyle = 'rgb(0 0 0 / 90%)';
      context.strokeText(String(paletteIndex), centerX, centerY);
      context.fillStyle = '#ffffff';
      context.fillText(String(paletteIndex), centerX, centerY);
    });
  }

  if (
    selectedPaletteRegion !== null &&
    paletteAssignments !== null &&
    paletteRegionSize !== null &&
    selectedPaletteRegion >= 0 &&
    selectedPaletteRegion < paletteAssignments.length
  ) {
    const regionColumns = image.width / paletteRegionSize;
    const column = selectedPaletteRegion % regionColumns;
    const row = Math.floor(selectedPaletteRegion / regionColumns);
    const x = column * paletteRegionSize;
    const y = row * paletteRegionSize;
    context.fillStyle = 'rgb(255 227 110 / 14%)';
    context.fillRect(x, y, paletteRegionSize, paletteRegionSize);
    context.strokeStyle = '#ffe36e';
    context.lineWidth = 2;
    context.strokeRect(
      x + 1,
      y + 1,
      paletteRegionSize - 2,
      paletteRegionSize - 2,
    );
  }
}

function collisionEditor(
  canvas: HTMLCanvasElement,
  image: ImageData,
  initialCells: Uint8Array,
  onChange: (cells: Uint8Array) => void,
  paletteAssignments: Uint8Array | null,
  paletteRegionSize: number | null,
  showPaletteNumbers: boolean,
  selectedPaletteRegion: number | null,
  activeTool: PreviewTool,
  onActiveToolChange: (tool: PreviewTool) => void,
  onPaletteRegionSelect: (regionIndex: number) => void,
): HTMLElement {
  const editor = document.createElement('div');
  editor.className = 'collision-editor';
  const heading = document.createElement('h3');
  heading.textContent = t('collisionEditorTitle');
  const hint = document.createElement('p');
  hint.className = 'muted collision-hint';
  hint.textContent = t('collisionEditorHint');
  const toolbar = document.createElement('div');
  toolbar.className = 'collision-toolbar';
  const paletteButton = document.createElement('button');
  paletteButton.type = 'button';
  paletteButton.className = 'button collision-tool';
  paletteButton.textContent = t('collisionEditPalette');
  const solidButton = document.createElement('button');
  solidButton.type = 'button';
  solidButton.className = 'button collision-tool';
  solidButton.textContent = t('collisionPaintSolid');
  const eraseButton = document.createElement('button');
  eraseButton.type = 'button';
  eraseButton.className = 'button collision-tool';
  eraseButton.textContent = t('collisionErase');
  const toolButtons: readonly [HTMLButtonElement, PreviewTool][] = [
    [paletteButton, 'palette'],
    [solidButton, 'paint-collision'],
    [eraseButton, 'erase-collision'],
  ];
  toolButtons.forEach(([button, tool]) => {
    const active = activeTool === tool;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => {
      onActiveToolChange(tool);
    });
  });
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'button secondary-button';
  clearButton.textContent = t('collisionClearAll');
  const status = document.createElement('output');
  status.className = 'collision-status';

  let cells = initialCells.slice();
  let pointerStartIndex: number | null = null;
  let changed = false;
  let keyboardIndex = 0;
  let keyboardFocused = false;
  const context = canvas.getContext('2d');

  const updateStatus = (index: number): void => {
    status.textContent = t('collisionCellStatus', {
      column: index % COLLISION_COLUMNS,
      row: Math.floor(index / COLLISION_COLUMNS),
      state:
        cells[index] === 0 ? t('collisionCellFree') : t('collisionCellSolid'),
      count: countCollisionCells(cells),
    });
  };
  const redraw = (): void => {
    if (context !== null) {
      drawPreview(
        context,
        image,
        cells,
        keyboardFocused ? keyboardIndex : null,
        paletteAssignments,
        paletteRegionSize,
        showPaletteNumbers,
        selectedPaletteRegion,
      );
    }
    updateStatus(keyboardIndex);
  };
  const cellFromPointer = (event: PointerEvent): number => {
    const bounds = canvas.getBoundingClientRect();
    const column = Math.min(
      COLLISION_COLUMNS - 1,
      Math.max(
        0,
        Math.floor(
          ((event.clientX - bounds.left) / bounds.width) * COLLISION_COLUMNS,
        ),
      ),
    );
    const row = Math.min(
      COLLISION_ROWS - 1,
      Math.max(
        0,
        Math.floor(
          ((event.clientY - bounds.top) / bounds.height) * COLLISION_ROWS,
        ),
      ),
    );
    return row * COLLISION_COLUMNS + column;
  };
  const paint = (index: number): void => {
    keyboardIndex = index;
    const paintValue = activeTool === 'erase-collision' ? 0 : 1;
    if (cells[index] !== paintValue) {
      cells[index] = paintValue;
      changed = true;
    }
    redraw();
  };
  const paletteRegionFromCell = (cellIndex: number): number => {
    if (paletteRegionSize === null) return 0;
    const cellColumn = cellIndex % COLLISION_COLUMNS;
    const cellRow = Math.floor(cellIndex / COLLISION_COLUMNS);
    const pixelX = cellColumn * 8;
    const pixelY = cellRow * 8;
    const regionColumns = image.width / paletteRegionSize;
    return (
      Math.floor(pixelY / paletteRegionSize) * regionColumns +
      Math.floor(pixelX / paletteRegionSize)
    );
  };
  const commit = (): void => {
    if (changed) {
      changed = false;
      onChange(cells.slice());
    }
  };

  clearButton.addEventListener('click', () => {
    if (countCollisionCells(cells) !== 0) {
      cells = new Uint8Array(cells.length);
      redraw();
      onChange(cells.slice());
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerStartIndex = cellFromPointer(event);
    canvas.setPointerCapture(event.pointerId);
    if (activeTool !== 'palette') paint(pointerStartIndex);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    const index = cellFromPointer(event);
    if (pointerStartIndex !== null && activeTool !== 'palette') {
      paint(index);
    } else {
      keyboardIndex = index;
      redraw();
    }
  });
  canvas.addEventListener('pointerup', () => {
    if (
      activeTool === 'palette' &&
      pointerStartIndex !== null &&
      paletteRegionSize !== null
    ) {
      onPaletteRegionSelect(paletteRegionFromCell(pointerStartIndex));
    } else {
      commit();
    }
    pointerStartIndex = null;
  });
  canvas.addEventListener('pointercancel', () => {
    pointerStartIndex = null;
    commit();
  });
  canvas.addEventListener('keydown', (event) => {
    keyboardFocused = true;
    const movements: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -COLLISION_COLUMNS,
      ArrowDown: COLLISION_COLUMNS,
    };
    const movement = movements[event.key];
    if (movement !== undefined) {
      const next = keyboardIndex + movement;
      keyboardIndex = Math.min(cells.length - 1, Math.max(0, next));
      redraw();
      event.preventDefault();
    } else if (event.key === ' ' || event.key === 'Enter') {
      if (activeTool === 'palette' && paletteRegionSize !== null) {
        onPaletteRegionSelect(paletteRegionFromCell(keyboardIndex));
      } else {
        paint(keyboardIndex);
        commit();
      }
      event.preventDefault();
    }
  });
  canvas.addEventListener('blur', () => {
    keyboardFocused = false;
    redraw();
  });

  toolbar.append(paletteButton, solidButton, eraseButton, clearButton);
  editor.append(heading, hint, toolbar, status);
  redraw();
  return editor;
}

export function createImagePreview(options: ImagePreviewOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel preview-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('previewTitle');
  section.append(heading);

  if (options.image === null) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('previewEmpty');
    section.append(empty);
    return section;
  }

  const frame = document.createElement('div');
  frame.className = 'preview-frame checkerboard';
  const canvas = document.createElement('canvas');
  canvas.width = options.image.width;
  canvas.height = options.image.height;
  canvas.setAttribute(
    'role',
    options.collisionCells === null ? 'img' : 'application',
  );
  canvas.setAttribute(
    'aria-label',
    options.collisionCells === null
      ? t('previewCanvasLabel')
      : t('collisionCanvasLabel'),
  );
  if (options.collisionCells !== null) {
    canvas.className = 'collision-canvas';
    canvas.tabIndex = 0;
  }
  const context = canvas.getContext('2d');
  if (context !== null) {
    drawPreview(
      context,
      options.image,
      options.collisionCells,
      null,
      options.paletteAssignments,
      options.paletteRegionSize,
      options.showPaletteNumbers,
      options.selectedPaletteRegion,
    );
  }
  frame.append(canvas);
  section.append(frame);
  if (options.collisionCells !== null) {
    section.append(
      collisionEditor(
        canvas,
        options.image,
        options.collisionCells,
        options.onCollisionChange,
        options.paletteAssignments,
        options.paletteRegionSize,
        options.showPaletteNumbers,
        options.selectedPaletteRegion,
        options.activeTool,
        options.onActiveToolChange,
        options.onPaletteRegionSelect,
      ),
    );
  } else if (options.paletteRegionSize !== null) {
    const previewImage = options.image;
    const paletteRegionSize = options.paletteRegionSize;
    canvas.className = 'palette-selection-canvas';
    canvas.addEventListener('click', (event) => {
      const bounds = canvas.getBoundingClientRect();
      const pixelX = Math.min(
        previewImage.width - 1,
        Math.max(
          0,
          Math.floor(
            ((event.clientX - bounds.left) / bounds.width) * previewImage.width,
          ),
        ),
      );
      const pixelY = Math.min(
        previewImage.height - 1,
        Math.max(
          0,
          Math.floor(
            ((event.clientY - bounds.top) / bounds.height) *
              previewImage.height,
          ),
        ),
      );
      const regionColumns = previewImage.width / paletteRegionSize;
      options.onPaletteRegionSelect(
        Math.floor(pixelY / paletteRegionSize) * regionColumns +
          Math.floor(pixelX / paletteRegionSize),
      );
    });
  }
  return section;
}
