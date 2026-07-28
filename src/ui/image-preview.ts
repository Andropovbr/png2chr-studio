import {
  COLLISION_COLUMNS,
  COLLISION_ROWS,
  COLLISION_TYPES,
  PAINTABLE_COLLISION_TYPES,
  countCollisionCells,
} from '../core/collision-encoder';
import { t } from '../i18n';
import type {
  CollisionType,
  CollisionTypeName,
} from '../core/collision-encoder';
import type { TranslationKey } from '../i18n';
import type { PreviewTool } from './types';

interface ImagePreviewOptions {
  readonly image: ImageData | null;
  readonly collisionCells: Uint8Array | null;
  readonly paletteAssignments: Uint8Array | null;
  readonly paletteRegionSize: number | null;
  readonly showPaletteNumbers: boolean;
  readonly selectedPaletteRegion: number | null;
  readonly activeTool: PreviewTool;
  readonly activeCollisionType: CollisionType;
  readonly onActiveToolChange: (tool: PreviewTool) => void;
  readonly onCollisionTypeChange: (type: CollisionType) => void;
  readonly onCollisionChange: (cells: Uint8Array) => void;
  readonly onPaletteRegionSelect: (regionIndex: number) => void;
}

const COLLISION_PRESENTATION: Record<
  CollisionTypeName,
  {
    readonly color: string;
    readonly symbol: string;
    readonly label: TranslationKey;
  }
> = {
  none: { color: 'rgb(0 0 0 / 0%)', symbol: '', label: 'collisionCellFree' },
  solid: {
    color: 'rgb(255 57 82 / 58%)',
    symbol: 'X',
    label: 'collisionTypeSolid',
  },
  damage: {
    color: 'rgb(255 145 61 / 65%)',
    symbol: '!',
    label: 'collisionTypeDamage',
  },
  ladder: {
    color: 'rgb(71 211 151 / 62%)',
    symbol: 'H',
    label: 'collisionTypeLadder',
  },
  moveUp: {
    color: 'rgb(48 190 174 / 62%)',
    symbol: '↑',
    label: 'collisionTypeMoveUp',
  },
  water: {
    color: 'rgb(42 127 255 / 62%)',
    symbol: '~',
    label: 'collisionTypeWater',
  },
  oneWay: {
    color: 'rgb(175 105 255 / 62%)',
    symbol: '↑',
    label: 'collisionTypeOneWay',
  },
  ice: {
    color: 'rgb(105 220 255 / 64%)',
    symbol: '*',
    label: 'collisionTypeIce',
  },
  conveyorLeft: {
    color: 'rgb(255 210 64 / 64%)',
    symbol: '←',
    label: 'collisionTypeConveyorLeft',
  },
  conveyorRight: {
    color: 'rgb(255 210 64 / 64%)',
    symbol: '→',
    label: 'collisionTypeConveyorRight',
  },
  moveDown: {
    color: 'rgb(48 190 174 / 62%)',
    symbol: '↓',
    label: 'collisionTypeMoveDown',
  },
};

function collisionNameFromValue(value: number): CollisionTypeName {
  const entry = Object.entries(COLLISION_TYPES).find(
    ([, typeValue]) => typeValue === value,
  );
  return (entry?.[0] as CollisionTypeName | undefined) ?? 'none';
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
      const presentation =
        COLLISION_PRESENTATION[
          collisionNameFromValue(cells[index] ?? COLLISION_TYPES.none)
        ];
      context.fillStyle = presentation.color;
      context.fillRect(column * 8, row * 8, 8, 8);
      context.font = 'bold 7px monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = 2;
      context.strokeStyle = 'rgb(0 0 0 / 85%)';
      context.strokeText(presentation.symbol, column * 8 + 4, row * 8 + 4);
      context.fillStyle = '#ffffff';
      context.fillText(presentation.symbol, column * 8 + 4, row * 8 + 4);
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
  activeCollisionType: CollisionType,
  onActiveToolChange: (tool: PreviewTool) => void,
  onCollisionTypeChange: (type: CollisionType) => void,
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
  const paintButton = document.createElement('button');
  paintButton.type = 'button';
  paintButton.className = 'button collision-tool';
  paintButton.textContent = t('collisionPaint');
  const eraseButton = document.createElement('button');
  eraseButton.type = 'button';
  eraseButton.className = 'button collision-tool';
  eraseButton.textContent = t('collisionErase');
  const toolButtons: readonly [HTMLButtonElement, PreviewTool][] = [
    [paletteButton, 'palette'],
    [paintButton, 'paint-collision'],
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
  const typeControl = document.createElement('label');
  typeControl.className = 'collision-type-control';
  const typeLabel = document.createElement('span');
  typeLabel.textContent = t('collisionTypeLabel');
  const typeSelect = document.createElement('select');
  PAINTABLE_COLLISION_TYPES.forEach((typeName) => {
    const typeValue = COLLISION_TYPES[typeName];
    const option = document.createElement('option');
    option.value = String(typeValue);
    option.selected = typeValue === activeCollisionType;
    option.textContent = t(COLLISION_PRESENTATION[typeName].label);
    typeSelect.append(option);
  });
  typeSelect.addEventListener('change', () => {
    onCollisionTypeChange(Number(typeSelect.value) as CollisionType);
  });
  typeControl.append(typeLabel, typeSelect);
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
      state: t(
        COLLISION_PRESENTATION[
          collisionNameFromValue(cells[index] ?? COLLISION_TYPES.none)
        ].label,
      ),
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
    const paintValue =
      activeTool === 'erase-collision'
        ? COLLISION_TYPES.none
        : activeCollisionType;
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

  const legend = document.createElement('div');
  legend.className = 'collision-legend';
  PAINTABLE_COLLISION_TYPES.forEach((typeName) => {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.background = COLLISION_PRESENTATION[typeName].color;
    swatch.textContent = COLLISION_PRESENTATION[typeName].symbol;
    item.append(swatch, t(COLLISION_PRESENTATION[typeName].label));
    legend.append(item);
  });
  toolbar.append(paletteButton, paintButton, eraseButton, clearButton);
  editor.append(heading, hint, typeControl, toolbar, legend, status);
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
        options.activeCollisionType,
        options.onActiveToolChange,
        options.onCollisionTypeChange,
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
