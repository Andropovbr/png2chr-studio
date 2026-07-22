import {
  assignPalettePreservingPixelIndices,
  mapImageToNesPalettes,
  NES_MASTER_PALETTE,
  type NesPaletteSet,
} from '../core/nes-palette';
import type { IndexedImage } from '../core/types';
import { t } from '../i18n';

export interface PaletteColorTarget {
  readonly paletteIndex: number;
  readonly colorIndex: number;
}

interface PaletteEditorOptions {
  readonly image: IndexedImage | null;
  readonly paletteSet: NesPaletteSet;
  readonly assignments: Uint8Array;
  readonly regionSize: number;
  readonly activePaletteIndex: number;
  readonly activeColorIndex: number;
  readonly showPaletteNumbers: boolean;
  readonly zoomedRegionIndex: number | null;
  readonly colorTarget: PaletteColorTarget;
  readonly pixelOverrides: Uint8Array;
  readonly onActivePaletteChange: (paletteIndex: number) => void;
  readonly onActiveColorChange: (colorIndex: number) => void;
  readonly onShowPaletteNumbersChange: (show: boolean) => void;
  readonly onZoomedRegionChange: (regionIndex: number | null) => void;
  readonly onColorTargetChange: (target: PaletteColorTarget) => void;
  readonly onPaletteColorChange: (
    paletteIndex: number,
    colorIndex: number,
    colorCode: number,
  ) => void;
  readonly onPixelOverridesChange: (
    pixelOverrides: Uint8Array,
    assignments: Uint8Array,
  ) => void;
}

function hexadecimal(code: number): string {
  return `$${code.toString(16).toUpperCase().padStart(2, '0')}`;
}

function cssColor(code: number): string {
  const color = NES_MASTER_PALETTE[code] ?? { red: 0, green: 0, blue: 0 };
  return `rgb(${String(color.red)} ${String(color.green)} ${String(color.blue)})`;
}

function createPaletteRows(options: PaletteEditorOptions): HTMLElement {
  const rows = document.createElement('div');
  rows.className = 'nes-palette-rows';

  options.paletteSet.forEach((palette, paletteIndex) => {
    const row = document.createElement('div');
    row.className = 'nes-palette-row';
    const label = document.createElement('strong');
    label.textContent = t('nesPaletteName', { index: paletteIndex });
    const swatches = document.createElement('div');
    swatches.className = 'nes-palette-swatches';

    palette.forEach((colorCode, colorIndex) => {
      const targetPalette = paletteIndex;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nes-palette-swatch';
      button.style.backgroundColor = cssColor(colorCode);
      button.classList.toggle(
        'is-selected',
        options.colorTarget.paletteIndex === targetPalette &&
          options.colorTarget.colorIndex === colorIndex,
      );
      button.setAttribute(
        'aria-label',
        t('nesPaletteSlotLabel', {
          palette: paletteIndex,
          slot: colorIndex,
          code: hexadecimal(colorCode),
        }),
      );
      button.title = hexadecimal(colorCode);
      button.addEventListener('click', () => {
        options.onColorTargetChange({
          paletteIndex: targetPalette,
          colorIndex,
        });
      });
      swatches.append(button);
    });
    row.append(label, swatches);
    rows.append(row);
  });
  return rows;
}

function createMasterPalette(options: PaletteEditorOptions): HTMLElement {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'nes-master-palette';
  const legend = document.createElement('legend');
  legend.textContent = t('nesMasterPaletteTitle');
  const target = document.createElement('p');
  target.className = 'nes-color-target';
  const targetCode =
    options.paletteSet[options.colorTarget.paletteIndex]?.[
      options.colorTarget.colorIndex
    ] ?? 0x0f;
  target.textContent = t('nesColorEditTarget', {
    palette: options.colorTarget.paletteIndex,
    color: options.colorTarget.colorIndex,
    code: hexadecimal(targetCode),
  });
  const grid = document.createElement('div');
  grid.className = 'nes-color-grid';

  NES_MASTER_PALETTE.forEach((_color, colorCode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nes-color-button';
    button.style.backgroundColor = cssColor(colorCode);
    button.title = hexadecimal(colorCode);
    button.setAttribute(
      'aria-label',
      t('nesColorButton', { code: hexadecimal(colorCode) }),
    );
    button.addEventListener('click', () => {
      options.onPaletteColorChange(
        options.colorTarget.paletteIndex,
        options.colorTarget.colorIndex,
        colorCode,
      );
    });
    grid.append(button);
  });
  fieldset.append(legend, target, grid);
  return fieldset;
}

function drawAssignmentCanvas(
  canvas: HTMLCanvasElement,
  image: IndexedImage,
  paletteSet: NesPaletteSet,
  assignments: Uint8Array,
  regionSize: number,
  pixelOverrides: Uint8Array,
  showPaletteNumbers: boolean,
  keyboardPixelIndex: number,
): void {
  const context = canvas.getContext('2d');
  if (context === null) {
    return;
  }
  const mapped = mapImageToNesPalettes(
    image,
    paletteSet,
    assignments,
    regionSize,
    pixelOverrides,
  );
  const preview = context.createImageData(image.width, image.height);
  const regionColumns = image.width / regionSize;

  mapped.pixels.forEach((colorIndex, pixelIndex) => {
    const x = pixelIndex % image.width;
    const y = Math.floor(pixelIndex / image.width);
    const regionIndex =
      Math.floor(y / regionSize) * regionColumns + Math.floor(x / regionSize);
    const paletteIndex = assignments[regionIndex] ?? 0;
    const colorCode = paletteSet[paletteIndex]?.[colorIndex] ?? 0x0f;
    const color = NES_MASTER_PALETTE[colorCode] ?? {
      red: 0,
      green: 0,
      blue: 0,
    };
    const target = pixelIndex * 4;
    preview.data[target] = color.red;
    preview.data[target + 1] = color.green;
    preview.data[target + 2] = color.blue;
    preview.data[target + 3] = 255;
  });
  context.putImageData(preview, 0, 0);

  assignments.forEach((paletteIndex, regionIndex) => {
    const column = regionIndex % regionColumns;
    const row = Math.floor(regionIndex / regionColumns);
    context.strokeStyle = 'rgb(255 255 255 / 42%)';
    context.lineWidth = 0.5;
    context.strokeRect(
      column * regionSize,
      row * regionSize,
      regionSize,
      regionSize,
    );

    if (showPaletteNumbers) {
      const centerX = column * regionSize + regionSize / 2;
      const centerY = row * regionSize + regionSize / 2;
      const fontSize = Math.max(6, Math.floor(regionSize * 0.6));
      context.font = `bold ${String(fontSize)}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = Math.max(2, fontSize / 3);
      context.strokeStyle = 'rgb(0 0 0 / 90%)';
      context.strokeText(String(paletteIndex), centerX, centerY);
      context.fillStyle = '#ffffff';
      context.fillText(String(paletteIndex), centerX, centerY);
    }
  });

  context.strokeStyle = '#ffe36e';
  const pixelColumn = keyboardPixelIndex % image.width;
  const pixelRow = Math.floor(keyboardPixelIndex / image.width);
  context.lineWidth = 1;
  context.strokeRect(pixelColumn, pixelRow, 1, 1);
}

function drawZoomCanvas(
  canvas: HTMLCanvasElement,
  image: IndexedImage,
  paletteSet: NesPaletteSet,
  assignments: Uint8Array,
  regionSize: number,
  pixelOverrides: Uint8Array,
  regionIndex: number,
): void {
  const context = canvas.getContext('2d');
  if (context === null) return;
  const mapped = mapImageToNesPalettes(
    image,
    paletteSet,
    assignments,
    regionSize,
    pixelOverrides,
  );
  const regionColumns = image.width / regionSize;
  const regionColumn = regionIndex % regionColumns;
  const regionRow = Math.floor(regionIndex / regionColumns);
  const scale = canvas.width / regionSize;
  const paletteIndex = assignments[regionIndex] ?? 0;
  const palette = paletteSet[paletteIndex] ?? paletteSet[0];

  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < regionSize; y += 1) {
    for (let x = 0; x < regionSize; x += 1) {
      const sourceX = regionColumn * regionSize + x;
      const sourceY = regionRow * regionSize + y;
      const pixelIndex = sourceY * image.width + sourceX;
      const colorIndex = mapped.pixels[pixelIndex] ?? 0;
      context.fillStyle = cssColor(palette[colorIndex] ?? 0x0f);
      context.fillRect(x * scale, y * scale, scale, scale);
      context.strokeStyle = 'rgb(255 255 255 / 18%)';
      context.lineWidth = 1;
      context.strokeRect(x * scale, y * scale, scale, scale);
    }
  }
}

function createAssignmentEditor(
  options: PaletteEditorOptions,
  image: IndexedImage,
): HTMLElement {
  const editor = document.createElement('div');
  editor.className = 'palette-assignment-editor';
  const heading = document.createElement('h3');
  heading.textContent = t('paletteRegionsTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('paletteRegionsHint', { size: options.regionSize });

  const toolbar = document.createElement('div');
  toolbar.className = 'palette-application-toolbar';
  options.paletteSet.forEach((palette, paletteIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button palette-application-button';
    button.classList.toggle(
      'is-active',
      paletteIndex === options.activePaletteIndex,
    );
    button.setAttribute(
      'aria-pressed',
      String(paletteIndex === options.activePaletteIndex),
    );
    const label = document.createElement('span');
    label.textContent = t('nesPaletteName', { index: paletteIndex });
    const preview = document.createElement('span');
    preview.className = 'palette-button-swatches';
    palette.forEach((colorCode) => {
      const swatch = document.createElement('span');
      swatch.style.backgroundColor = cssColor(colorCode);
      preview.append(swatch);
    });
    button.append(label, preview);
    button.addEventListener('click', () => {
      options.onActivePaletteChange(paletteIndex);
    });
    toolbar.append(button);
  });

  const colorBrush = document.createElement('fieldset');
  colorBrush.className = 'palette-color-brush';
  const colorBrushLegend = document.createElement('legend');
  colorBrushLegend.textContent = t('paletteColorBrushTitle');
  const colorBrushSwatches = document.createElement('div');
  colorBrushSwatches.className = 'palette-color-brush-swatches';
  const activePalette =
    options.paletteSet[options.activePaletteIndex] ?? options.paletteSet[0];
  activePalette.forEach((colorCode, colorIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'palette-color-brush-button';
    button.classList.toggle(
      'is-selected',
      colorIndex === options.activeColorIndex,
    );
    button.style.backgroundColor = cssColor(colorCode);
    button.setAttribute(
      'aria-label',
      t('paletteColorBrushLabel', {
        index: colorIndex,
        code: hexadecimal(colorCode),
      }),
    );
    button.addEventListener('click', () => {
      options.onActiveColorChange(colorIndex);
    });
    colorBrushSwatches.append(button);
  });
  const activeBrushStatus = document.createElement('p');
  activeBrushStatus.className = 'active-palette-brush-status';
  activeBrushStatus.textContent = t('paletteActiveBrush', {
    palette: options.activePaletteIndex,
    color: options.activeColorIndex,
    code: hexadecimal(activePalette[options.activeColorIndex] ?? 0x0f),
  });
  colorBrush.append(colorBrushLegend, colorBrushSwatches, activeBrushStatus);

  const overlayControl = document.createElement('label');
  overlayControl.className = 'palette-overlay-control';
  const overlayCheckbox = document.createElement('input');
  overlayCheckbox.type = 'checkbox';
  overlayCheckbox.checked = options.showPaletteNumbers;
  overlayCheckbox.addEventListener('change', () => {
    options.onShowPaletteNumbersChange(overlayCheckbox.checked);
  });
  const overlayText = document.createElement('span');
  overlayText.textContent = t('paletteShowNumbers');
  overlayControl.append(overlayCheckbox, overlayText);

  const frame = document.createElement('div');
  frame.className = 'preview-frame checkerboard palette-preview-frame';
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.className = 'palette-assignment-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', t('paletteCanvasLabel'));
  frame.append(canvas);
  const status = document.createElement('output');
  status.className = 'palette-region-status';

  const regionColumns = image.width / options.regionSize;
  const assignments = options.assignments.slice();
  const pixelOverrides = options.pixelOverrides.slice();
  let keyboardPixelIndex = 0;
  let paintingAction: 'paint' | 'replace' | null = null;
  let changed = false;
  let redrawZoom = (): void => undefined;

  const updateStatus = (): void => {
    status.textContent = t('palettePixelPaintStatus', {
      column: keyboardPixelIndex % image.width,
      row: Math.floor(keyboardPixelIndex / image.width),
      color: options.activeColorIndex,
      palette: options.activePaletteIndex,
    });
  };
  const redraw = (): void => {
    drawAssignmentCanvas(
      canvas,
      image,
      options.paletteSet,
      assignments,
      options.regionSize,
      pixelOverrides,
      options.showPaletteNumbers,
      keyboardPixelIndex,
    );
    updateStatus();
    redrawZoom();
  };
  const pixelFromPointer = (event: PointerEvent): number => {
    const bounds = canvas.getBoundingClientRect();
    const column = Math.min(
      image.width - 1,
      Math.max(
        0,
        Math.floor(
          ((event.clientX - bounds.left) / bounds.width) * image.width,
        ),
      ),
    );
    const row = Math.min(
      image.height - 1,
      Math.max(
        0,
        Math.floor(
          ((event.clientY - bounds.top) / bounds.height) * image.height,
        ),
      ),
    );
    return row * image.width + column;
  };
  const regionFromPixel = (pixelIndex: number): number => {
    const pixelColumn = pixelIndex % image.width;
    const pixelRow = Math.floor(pixelIndex / image.width);
    return (
      Math.floor(pixelRow / options.regionSize) * regionColumns +
      Math.floor(pixelColumn / options.regionSize)
    );
  };
  const assignActivePalette = (pixelIndex: number): void => {
    const regionIndex = regionFromPixel(pixelIndex);
    if (assignments[regionIndex] !== options.activePaletteIndex) {
      const preserved = assignPalettePreservingPixelIndices(
        image,
        options.paletteSet,
        assignments,
        options.regionSize,
        pixelOverrides,
        regionIndex,
        options.activePaletteIndex,
      );
      assignments.set(preserved.assignments);
      pixelOverrides.set(preserved.pixelOverrides);
      changed = true;
    }
  };
  const paint = (pixelIndex: number): void => {
    keyboardPixelIndex = pixelIndex;
    if (pixelOverrides[pixelIndex] !== options.activeColorIndex) {
      pixelOverrides[pixelIndex] = options.activeColorIndex;
      changed = true;
    }
    assignActivePalette(pixelIndex);
    redraw();
  };
  const replaceMatchingColor = (pixelIndex: number): void => {
    keyboardPixelIndex = pixelIndex;
    const mapped = mapImageToNesPalettes(
      image,
      options.paletteSet,
      assignments,
      options.regionSize,
      pixelOverrides,
    );
    const matchingColorIndex = mapped.pixels[pixelIndex] ?? 0;
    const regionIndex = regionFromPixel(pixelIndex);
    const regionColumn = regionIndex % regionColumns;
    const regionRow = Math.floor(regionIndex / regionColumns);
    const startX = regionColumn * options.regionSize;
    const startY = regionRow * options.regionSize;
    for (let y = startY; y < startY + options.regionSize; y += 1) {
      for (let x = startX; x < startX + options.regionSize; x += 1) {
        const candidateIndex = y * image.width + x;
        if (
          mapped.pixels[candidateIndex] === matchingColorIndex &&
          pixelOverrides[candidateIndex] !== options.activeColorIndex
        ) {
          pixelOverrides[candidateIndex] = options.activeColorIndex;
          changed = true;
        }
      }
    }
    assignActivePalette(pixelIndex);
    redraw();
  };
  const commit = (): void => {
    if (changed) {
      changed = false;
      options.onPixelOverridesChange(
        pixelOverrides.slice(),
        assignments.slice(),
      );
    }
  };

  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
  canvas.addEventListener('pointerdown', (event) => {
    const pixelIndex = pixelFromPointer(event);
    if (event.button === 1) {
      options.onZoomedRegionChange(regionFromPixel(pixelIndex));
      event.preventDefault();
      return;
    }
    if (event.button !== 0 && event.button !== 2) return;
    paintingAction = event.button === 2 ? 'replace' : 'paint';
    canvas.setPointerCapture(event.pointerId);
    if (paintingAction === 'replace') replaceMatchingColor(pixelIndex);
    else paint(pixelIndex);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    const index = pixelFromPointer(event);
    if (paintingAction === 'paint') {
      paint(index);
    } else if (paintingAction === 'replace') {
      replaceMatchingColor(index);
    } else {
      keyboardPixelIndex = index;
      redraw();
    }
  });
  canvas.addEventListener('pointerup', () => {
    paintingAction = null;
    commit();
  });
  canvas.addEventListener('pointercancel', () => {
    paintingAction = null;
    commit();
  });
  canvas.addEventListener('keydown', (event) => {
    const columns = image.width;
    const itemCount = image.pixels.length;
    const movements: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };
    const movement = movements[event.key];
    if (movement !== undefined) {
      keyboardPixelIndex = Math.min(
        itemCount - 1,
        Math.max(0, keyboardPixelIndex + movement),
      );
      redraw();
      event.preventDefault();
    } else if (event.key === ' ' || event.key === 'Enter') {
      paint(keyboardPixelIndex);
      commit();
      event.preventDefault();
    }
  });

  let zoomEditor: HTMLElement | null = null;
  const zoomRegionIndex = options.zoomedRegionIndex;
  if (
    zoomRegionIndex !== null &&
    zoomRegionIndex >= 0 &&
    zoomRegionIndex < assignments.length
  ) {
    zoomEditor = document.createElement('section');
    zoomEditor.className = 'palette-zoom-editor';
    const zoomHeader = document.createElement('div');
    zoomHeader.className = 'palette-zoom-header';
    const zoomTitle = document.createElement('h3');
    zoomTitle.textContent = t('paletteZoomTitle', {
      column: zoomRegionIndex % regionColumns,
      row: Math.floor(zoomRegionIndex / regionColumns),
    });
    const zoomRegionColumn = zoomRegionIndex % regionColumns;
    const zoomRegionRow = Math.floor(zoomRegionIndex / regionColumns);
    const regionStartX = zoomRegionColumn * options.regionSize;
    const regionStartY = zoomRegionRow * options.regionSize;
    const zoomDetails = document.createElement('p');
    zoomDetails.className = 'palette-zoom-details';
    zoomDetails.textContent = t('paletteZoomDetails', {
      size: options.regionSize,
      startX: regionStartX,
      endX: regionStartX + options.regionSize - 1,
      startY: regionStartY,
      endY: regionStartY + options.regionSize - 1,
      tileStartX: Math.floor(regionStartX / 8),
      tileEndX: Math.floor((regionStartX + options.regionSize - 1) / 8),
      tileStartY: Math.floor(regionStartY / 8),
      tileEndY: Math.floor((regionStartY + options.regionSize - 1) / 8),
      palette: assignments[zoomRegionIndex] ?? 0,
    });
    const closeZoom = document.createElement('button');
    closeZoom.type = 'button';
    closeZoom.className = 'button';
    closeZoom.textContent = t('paletteZoomClose');
    closeZoom.addEventListener('click', () => {
      options.onZoomedRegionChange(null);
    });
    zoomHeader.append(zoomTitle, closeZoom);
    const zoomHint = document.createElement('p');
    zoomHint.className = 'muted';
    zoomHint.textContent = t('paletteZoomHint');
    const zoomCanvas = document.createElement('canvas');
    const zoomScale = options.regionSize === 16 ? 20 : 28;
    zoomCanvas.width = options.regionSize * zoomScale;
    zoomCanvas.height = options.regionSize * zoomScale;
    zoomCanvas.className = 'palette-zoom-canvas';
    zoomCanvas.tabIndex = 0;
    zoomCanvas.setAttribute('role', 'application');
    zoomCanvas.setAttribute('aria-label', t('paletteZoomCanvasLabel'));
    const zoomPixelFromPointer = (event: PointerEvent): number => {
      const bounds = zoomCanvas.getBoundingClientRect();
      const localColumn = Math.min(
        options.regionSize - 1,
        Math.max(
          0,
          Math.floor(
            ((event.clientX - bounds.left) / bounds.width) * options.regionSize,
          ),
        ),
      );
      const localRow = Math.min(
        options.regionSize - 1,
        Math.max(
          0,
          Math.floor(
            ((event.clientY - bounds.top) / bounds.height) * options.regionSize,
          ),
        ),
      );
      return (
        (zoomRegionRow * options.regionSize + localRow) * image.width +
        zoomRegionColumn * options.regionSize +
        localColumn
      );
    };
    let zoomPaintingAction: 'paint' | 'replace' | null = null;
    zoomCanvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });
    zoomCanvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      zoomPaintingAction = event.button === 2 ? 'replace' : 'paint';
      zoomCanvas.setPointerCapture(event.pointerId);
      const pixelIndex = zoomPixelFromPointer(event);
      if (zoomPaintingAction === 'replace') replaceMatchingColor(pixelIndex);
      else paint(pixelIndex);
      event.preventDefault();
    });
    zoomCanvas.addEventListener('pointermove', (event) => {
      if (zoomPaintingAction === null) return;
      const pixelIndex = zoomPixelFromPointer(event);
      if (zoomPaintingAction === 'replace') replaceMatchingColor(pixelIndex);
      else paint(pixelIndex);
    });
    zoomCanvas.addEventListener('pointerup', () => {
      zoomPaintingAction = null;
      commit();
    });
    zoomCanvas.addEventListener('pointercancel', () => {
      zoomPaintingAction = null;
      commit();
    });
    redrawZoom = (): void => {
      drawZoomCanvas(
        zoomCanvas,
        image,
        options.paletteSet,
        assignments,
        options.regionSize,
        pixelOverrides,
        zoomRegionIndex,
      );
    };
    const zoomBody = document.createElement('div');
    zoomBody.className = 'palette-zoom-body';
    const zoomControls = document.createElement('div');
    zoomControls.className = 'palette-zoom-controls';
    zoomControls.append(toolbar, colorBrush);
    zoomBody.append(zoomCanvas, zoomControls);
    zoomEditor.append(zoomHeader, zoomDetails, zoomHint, zoomBody);
  }

  editor.append(heading, hint, overlayControl);
  if (zoomEditor !== null) {
    editor.append(zoomEditor);
  } else {
    const emptyZoom = document.createElement('p');
    emptyZoom.className = 'empty-message';
    emptyZoom.textContent = t('paletteZoomEmpty');
    editor.append(emptyZoom);
  }
  redraw();
  return editor;
}

export function createPaletteEditor(
  options: PaletteEditorOptions,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel palette-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('paletteEditorTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('paletteEditorHint');
  section.append(heading, hint);

  if (options.image === null) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('paletteEditorEmpty');
    section.append(empty);
  } else {
    section.append(createAssignmentEditor(options, options.image));
  }
  section.append(createPaletteRows(options), createMasterPalette(options));
  return section;
}
