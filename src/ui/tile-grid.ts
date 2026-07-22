import type { IndexedImage, Tile } from '../core/types';
import { t } from '../i18n';

function renderTile(
  canvas: HTMLCanvasElement,
  tile: Tile,
  image: IndexedImage,
): void {
  const context = canvas.getContext('2d');
  if (context === null) {
    return;
  }

  const pixels = context.createImageData(8, 8);
  tile.pixels.forEach((colorIndex, pixelIndex) => {
    const target = pixelIndex * 4;
    const color = image.colors[colorIndex];
    const transparent = image.transparentIndex === colorIndex;
    pixels.data[target] = color?.red ?? 0;
    pixels.data[target + 1] = color?.green ?? 0;
    pixels.data[target + 2] = color?.blue ?? 0;
    pixels.data[target + 3] = transparent ? 0 : 255;
  });
  context.putImageData(pixels, 0, 0);
}

export function createTileGrid(
  tiles: readonly Tile[],
  image: IndexedImage | null,
  originalTileCount: number,
  deduplicationEnabled: boolean,
  onDeduplicationChange: (enabled: boolean) => void,
  allowFlipDeduplication: boolean,
  flipDeduplicationEnabled: boolean,
  onFlipDeduplicationChange: (enabled: boolean) => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel tiles-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('tilesTitle');

  const toolbar = document.createElement('div');
  toolbar.className = 'tile-toolbar';
  const controls = document.createElement('div');
  controls.className = 'deduplication-controls';
  const checkboxLabel = document.createElement('label');
  checkboxLabel.className = 'checkbox-control';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = deduplicationEnabled;
  checkbox.disabled = originalTileCount === 0;
  checkbox.addEventListener('change', () => {
    onDeduplicationChange(checkbox.checked);
  });
  const checkboxText = document.createElement('span');
  checkboxText.textContent = t('deduplicateTiles');
  checkboxLabel.append(checkbox, checkboxText);
  controls.append(checkboxLabel);

  if (allowFlipDeduplication) {
    const flipLabel = document.createElement('label');
    flipLabel.className = 'checkbox-control';
    const flipCheckbox = document.createElement('input');
    flipCheckbox.type = 'checkbox';
    flipCheckbox.checked = flipDeduplicationEnabled;
    flipCheckbox.disabled = originalTileCount === 0 || !deduplicationEnabled;
    flipCheckbox.addEventListener('change', () => {
      onFlipDeduplicationChange(flipCheckbox.checked);
    });
    const flipText = document.createElement('span');
    flipText.textContent = t('deduplicateFlippedTiles');
    flipLabel.append(flipCheckbox, flipText);
    controls.append(flipLabel);
  }

  const hint = document.createElement('small');
  hint.textContent =
    originalTileCount === 0
      ? t('deduplicationHint')
      : t('tileVisibilitySummary', {
          visible: tiles.length,
          total: originalTileCount,
        });
  toolbar.append(controls, hint);
  section.append(heading, toolbar);

  if (tiles.length === 0 || image === null) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('tilesEmpty');
    section.append(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  tiles.forEach((tile) => {
    const card = document.createElement('article');
    card.className = 'tile-card';
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    canvas.className = 'tile-canvas checkerboard';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t('tileCanvasLabel', { id: tile.id }));
    renderTile(canvas, tile, image);

    const ids = document.createElement('div');
    ids.className = 'tile-ids';
    const decimal = document.createElement('span');
    decimal.textContent = t('tileDecimalId', { id: tile.id });
    const hexadecimal = document.createElement('strong');
    hexadecimal.textContent = t('tileHexId', {
      id: tile.id.toString(16).toUpperCase().padStart(2, '0'),
    });
    ids.append(decimal, hexadecimal);
    const position = document.createElement('small');
    position.textContent = t('tilePosition', {
      column: tile.column,
      row: tile.row,
    });
    card.append(canvas, ids, position);
    grid.append(card);
  });
  section.append(grid);
  return section;
}
