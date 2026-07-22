import {
  COLLISION_COLUMNS,
  COLLISION_ROWS,
  countCollisionCells,
} from '../core/collision-encoder';
import { t } from '../i18n';

interface ImagePreviewOptions {
  readonly image: ImageData | null;
  readonly collisionCells: Uint8Array | null;
  readonly onCollisionChange: (cells: Uint8Array) => void;
}

type PaintValue = 0 | 1;

function drawPreview(
  context: CanvasRenderingContext2D,
  image: ImageData,
  cells: Uint8Array | null,
  keyboardIndex: number | null = null,
): void {
  context.putImageData(image, 0, 0);
  if (cells === null) {
    return;
  }

  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] !== 0) {
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

function collisionEditor(
  canvas: HTMLCanvasElement,
  image: ImageData,
  initialCells: Uint8Array,
  onChange: (cells: Uint8Array) => void,
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
  const solidButton = document.createElement('button');
  solidButton.type = 'button';
  solidButton.className = 'button collision-tool is-active';
  solidButton.textContent = t('collisionPaintSolid');
  solidButton.setAttribute('aria-pressed', 'true');
  const eraseButton = document.createElement('button');
  eraseButton.type = 'button';
  eraseButton.className = 'button collision-tool';
  eraseButton.textContent = t('collisionErase');
  eraseButton.setAttribute('aria-pressed', 'false');
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'button secondary-button';
  clearButton.textContent = t('collisionClearAll');
  const status = document.createElement('output');
  status.className = 'collision-status';

  let cells = initialCells.slice();
  let paintValue: PaintValue = 1;
  let painting = false;
  let changed = false;
  let keyboardIndex = 0;
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
      drawPreview(context, image, cells, keyboardIndex);
    }
    updateStatus(keyboardIndex);
  };
  const setPaintValue = (value: PaintValue): void => {
    paintValue = value;
    solidButton.classList.toggle('is-active', value === 1);
    eraseButton.classList.toggle('is-active', value === 0);
    solidButton.setAttribute('aria-pressed', String(value === 1));
    eraseButton.setAttribute('aria-pressed', String(value === 0));
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
    if (cells[index] !== paintValue) {
      cells[index] = paintValue;
      changed = true;
    }
    redraw();
  };
  const commit = (): void => {
    if (changed) {
      changed = false;
      onChange(cells.slice());
    }
  };

  solidButton.addEventListener('click', () => {
    setPaintValue(1);
  });
  eraseButton.addEventListener('click', () => {
    setPaintValue(0);
  });
  clearButton.addEventListener('click', () => {
    if (countCollisionCells(cells) !== 0) {
      cells = new Uint8Array(cells.length);
      redraw();
      onChange(cells.slice());
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    painting = true;
    canvas.setPointerCapture(event.pointerId);
    paint(cellFromPointer(event));
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    const index = cellFromPointer(event);
    if (painting) {
      paint(index);
    } else {
      keyboardIndex = index;
      redraw();
    }
  });
  canvas.addEventListener('pointerup', () => {
    painting = false;
    commit();
  });
  canvas.addEventListener('pointercancel', () => {
    painting = false;
    commit();
  });
  canvas.addEventListener('keydown', (event) => {
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
      paint(keyboardIndex);
      commit();
      event.preventDefault();
    }
  });

  toolbar.append(solidButton, eraseButton, clearButton);
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
    drawPreview(context, options.image, options.collisionCells);
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
      ),
    );
  }
  return section;
}
