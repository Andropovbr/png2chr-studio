import {
  BACKGROUND_HEIGHT_TILES,
  BACKGROUND_WIDTH_TILES,
  BACKGROUND_PALETTE_COLUMNS,
  type BackgroundMapCell,
  type BackgroundMapDefinition,
  type BackgroundPatternTable,
  type BackgroundMapReconciliationFact,
} from '../core/background-model';
import type { SpritePatternTable } from '../core/chr-pattern-table';
import { type ProjectAsset, type ProjectAssetId } from '../core/asset-identity';
import { NES_MASTER_PALETTE, type NesPaletteSet } from '../core/nes-palette';
import {
  findPaletteDefinition,
  resolveActiveBackgroundPaletteSet,
  type ActivePaletteSlots,
  type PaletteDefinition,
} from '../core/palette-manager';
import type { Tile } from '../core/types';
import { t } from '../i18n';
import type {
  BackgroundTool,
  BackgroundWorkspaceState,
} from './workspace-state';

export interface BackgroundWorkspaceOptions {
  readonly maps: readonly BackgroundMapDefinition[];
  readonly activeMapId: string | null;
  readonly palettes: readonly PaletteDefinition[];
  readonly activeBackgroundSlots: ActivePaletteSlots;
  readonly universalBackgroundColor: number;
  readonly availableAssets?: readonly ProjectAsset[];
  readonly assetTilesMap?: ReadonlyMap<ProjectAssetId, readonly Tile[]>;
  /** Read-only placement and bytes supplied by project graphics compiler. */
  readonly compiledModel?: {
    readonly patternTable: SpritePatternTable;
    readonly nametable: Uint8Array;
    readonly finalChr: Uint8Array;
  } | null;
  readonly reconciliationFacts?: readonly BackgroundMapReconciliationFact[];
  readonly state: BackgroundWorkspaceState;
  readonly onSelectMap: (mapId: string) => void;
  readonly onAddMap: () => void;
  readonly onNewMapFromFile?: (file: File) => void;
  readonly onGenerateTestScreen?: () => void;
  readonly onDeleteMap: (mapId: string) => void;
  readonly onRenameMap: (mapId: string, name: string) => void;
  readonly onPatternTableChange: (
    mapId: string,
    patternTable: BackgroundPatternTable,
  ) => void;
  readonly onAssetChange: (
    mapId: string,
    assetId: ProjectAssetId | null,
  ) => void;
  readonly onCellsChange: (
    mapId: string,
    cells: readonly (BackgroundMapCell | null)[],
  ) => void;
  readonly onPaletteAssignmentsChange: (
    mapId: string,
    paletteAssignments: readonly number[],
  ) => void;
  readonly onStateChange: (
    stateUpdate: Partial<BackgroundWorkspaceState>,
  ) => void;
  readonly onNavigateToChrTile?: (tileIndex: number) => void;
}

export interface BackgroundWorkspaceElement extends HTMLElement {
  readonly diagnosticsElement: HTMLElement;
}

const NES_SCREEN_WIDTH_PX = 256;
const NES_SCREEN_HEIGHT_PX = 240;
const TILE_SIZE = 8;
const BLOCK_SIZE = 16;
const TOTAL_CELLS = BACKGROUND_WIDTH_TILES * BACKGROUND_HEIGHT_TILES; // 960

export function resolveBackgroundPaletteSet(
  options: BackgroundWorkspaceOptions,
): NesPaletteSet {
  return resolveActiveBackgroundPaletteSet(
    options.palettes,
    options.activeBackgroundSlots,
    options.universalBackgroundColor,
  );
}

export function createBackgroundWorkspace(
  options: BackgroundWorkspaceOptions,
): BackgroundWorkspaceElement {
  const container = document.createElement(
    'div',
  ) as unknown as BackgroundWorkspaceElement;
  container.className = 'workspace background-workspace';
  container.id = 'background-workspace';

  const activeMap =
    options.maps.find((m) => m.id === options.activeMapId) ??
    options.maps[0] ??
    null;

  // 1. Diagnostics element
  const diagnosticsHost = document.createElement('div');
  diagnosticsHost.className = 'background-diagnostics-container';
  renderDiagnostics(diagnosticsHost, options.reconciliationFacts ?? []);

  Object.defineProperty(container, 'diagnosticsElement', {
    value: diagnosticsHost,
    enumerable: true,
  });

  // 2. Toolbar (Map select, New, Delete, Rename, Pattern Table, Asset select)
  const toolbar = createToolbar(options, activeMap);
  container.append(toolbar);

  if (!activeMap) {
    const emptyState = document.createElement('div');
    emptyState.className = 'background-empty-workspace panel';

    const content = document.createElement('div');
    content.className = 'background-empty-content';

    const h3 = document.createElement('h3');
    h3.textContent = t('backgroundNoMapSelected');

    const p = document.createElement('p');
    p.textContent = t('backgroundCreateFirstMap');

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'btn btn-primary';
    createBtn.id = 'bg-empty-create-btn';
    createBtn.textContent = t('backgroundNewMap');
    createBtn.addEventListener('click', () => {
      options.onAddMap();
    });

    content.append(h3, p, createBtn);
    emptyState.append(content);
    container.append(emptyState);
    return container;
  }

  // 3. Workspace Layout Grid (Left: Tools & Tile Browser, Center: Canvas, Right: Inspector & Diagnostics)
  const layout = document.createElement('div');
  layout.className = 'background-workspace-layout';

  const leftPanel = createLeftPanel(options, activeMap);
  const centerPanel = createCenterPanel(options, activeMap);
  const rightPanel = createRightPanel(options, activeMap);

  layout.append(leftPanel, centerPanel, rightPanel);
  container.append(layout);

  return container;
}

// -----------------------------------------------------------------------------
// Toolbar Component
// -----------------------------------------------------------------------------

function createToolbar(
  options: BackgroundWorkspaceOptions,
  activeMap: BackgroundMapDefinition | null,
): HTMLElement {
  const toolbar = document.createElement('header');
  toolbar.className = 'background-toolbar panel';
  toolbar.id = 'section-bg-toolbar';

  const toolbarGroupLeft = document.createElement('div');
  toolbarGroupLeft.className =
    'background-toolbar-group background-toolbar-left';

  // Map Selector
  const mapSelectLabel = document.createElement('label');
  mapSelectLabel.className = 'form-label';
  mapSelectLabel.htmlFor = 'bg-map-select';
  mapSelectLabel.textContent = t('backgroundMapSelect');

  const mapSelect = document.createElement('select');
  mapSelect.id = 'bg-map-select';
  mapSelect.className = 'form-control bg-map-select';
  mapSelect.setAttribute('aria-label', t('backgroundMapSelect'));

  options.maps.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name || m.id;
    if (activeMap?.id === m.id) {
      opt.selected = true;
      mapSelect.value = m.id;
    }
    mapSelect.append(opt);
  });

  mapSelect.addEventListener('change', () => {
    options.onSelectMap(mapSelect.value);
  });

  toolbarGroupLeft.append(mapSelectLabel, mapSelect);

  // New Map Button
  const newMapBtn = document.createElement('button');
  newMapBtn.type = 'button';
  newMapBtn.className = 'btn btn-secondary';
  newMapBtn.id = 'bg-new-map-btn';
  newMapBtn.textContent = `+ ${t('backgroundNewMap')}`;
  newMapBtn.addEventListener('click', () => {
    options.onAddMap();
  });
  toolbarGroupLeft.append(newMapBtn);

  if (options.onNewMapFromFile || options.onGenerateTestScreen) {
    const workflowGroup = document.createElement('div');
    workflowGroup.className =
      'contextual-file-actions background-workflow-actions';

    if (options.onNewMapFromFile) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.png,image/png';
      input.id = 'bg-new-screen-png-input';
      input.className = 'visually-hidden';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) options.onNewMapFromFile?.(file);
        input.value = '';
      });
      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.className = 'btn btn-secondary contextual-file-action';
      label.textContent = t('backgroundNewFromPng');
      workflowGroup.append(input, label);
    }

    if (options.onGenerateTestScreen) {
      const generateButton = document.createElement('button');
      generateButton.type = 'button';
      generateButton.className = 'btn btn-secondary contextual-file-action';
      generateButton.id = 'bg-generate-test-screen-btn';
      generateButton.textContent = t('backgroundGenerateTestScreen');
      generateButton.addEventListener('click', options.onGenerateTestScreen);
      workflowGroup.append(generateButton);
    }
    toolbarGroupLeft.append(workflowGroup);
  }

  if (activeMap) {
    // Delete Map Button
    const deleteMapBtn = document.createElement('button');
    deleteMapBtn.type = 'button';
    deleteMapBtn.className = 'btn btn-danger btn-sm';
    deleteMapBtn.id = 'bg-delete-map-btn';
    deleteMapBtn.textContent = t('backgroundDeleteMap');
    deleteMapBtn.addEventListener('click', () => {
      if (window.confirm(t('backgroundDeleteMapConfirm'))) {
        options.onDeleteMap(activeMap.id);
      }
    });
    toolbarGroupLeft.append(deleteMapBtn);

    // Map Name Input
    const nameLabel = document.createElement('label');
    nameLabel.className = 'form-label';
    nameLabel.htmlFor = 'bg-map-name-input';
    nameLabel.textContent = t('backgroundMapName');

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'bg-map-name-input';
    nameInput.className = 'form-control bg-map-name-input';
    nameInput.value = activeMap.name;
    nameInput.placeholder = t('backgroundMapName');
    nameInput.addEventListener('change', () => {
      options.onRenameMap(activeMap.id, nameInput.value.trim() || activeMap.id);
    });

    toolbarGroupLeft.append(nameLabel, nameInput);
  }

  toolbar.append(toolbarGroupLeft);

  if (activeMap) {
    const toolbarGroupRight = document.createElement('div');
    toolbarGroupRight.className =
      'background-toolbar-group background-toolbar-right';

    // Pattern Table Selector (PT0 / PT1)
    const ptGroup = document.createElement('div');
    ptGroup.className = 'background-pt-group form-group';
    ptGroup.setAttribute('role', 'radiogroup');
    ptGroup.setAttribute('aria-label', t('backgroundPatternTableLabel'));

    const ptLabel = document.createElement('span');
    ptLabel.className = 'form-label';
    ptLabel.textContent = t('backgroundPatternTableLabel');
    ptGroup.append(ptLabel);

    const pt0Btn = document.createElement('button');
    pt0Btn.type = 'button';
    pt0Btn.className = `btn btn-sm ${activeMap.patternTable === 0 ? 'btn-primary is-active' : 'btn-secondary'}`;
    pt0Btn.id = 'bg-pt0-btn';
    pt0Btn.textContent = t('backgroundPatternTable0');
    pt0Btn.setAttribute('aria-pressed', String(activeMap.patternTable === 0));
    pt0Btn.addEventListener('click', () => {
      if (activeMap.patternTable !== 0) {
        options.onPatternTableChange(activeMap.id, 0);
      }
    });

    const pt1Btn = document.createElement('button');
    pt1Btn.type = 'button';
    pt1Btn.className = `btn btn-sm ${activeMap.patternTable === 1 ? 'btn-primary is-active' : 'btn-secondary'}`;
    pt1Btn.id = 'bg-pt1-btn';
    pt1Btn.textContent = t('backgroundPatternTable1');
    pt1Btn.setAttribute('aria-pressed', String(activeMap.patternTable === 1));
    pt1Btn.addEventListener('click', () => {
      if (activeMap.patternTable !== 1) {
        options.onPatternTableChange(activeMap.id, 1);
      }
    });

    ptGroup.append(pt0Btn, pt1Btn);
    toolbarGroupRight.append(ptGroup);

    // Source Asset Selector
    const assetGroup = document.createElement('div');
    assetGroup.className = 'background-asset-group form-group';

    const assetLabel = document.createElement('label');
    assetLabel.className = 'form-label';
    assetLabel.htmlFor = 'bg-asset-select';
    assetLabel.textContent = t('backgroundAssetLabel');

    const assetSelect = document.createElement('select');
    assetSelect.id = 'bg-asset-select';
    assetSelect.className = 'form-control bg-asset-select';
    assetSelect.setAttribute('aria-label', t('backgroundAssetLabel'));

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = t('backgroundAssetNone');
    if (!activeMap.assetId) {
      noneOpt.selected = true;
    }
    assetSelect.append(noneOpt);

    (options.availableAssets ?? []).forEach((asset) => {
      const opt = document.createElement('option');
      opt.value = asset.id;
      const assetKind: string = asset.kind;
      const assetName = asset.name ?? asset.id;
      opt.textContent = `${assetName} (${assetKind})`;
      if (activeMap.assetId === asset.id) {
        opt.selected = true;
      }
      assetSelect.append(opt);
    });

    assetSelect.addEventListener('change', () => {
      const selectedId = assetSelect.value || null;
      options.onAssetChange(activeMap.id, selectedId);
    });

    assetGroup.append(assetLabel, assetSelect);
    toolbarGroupRight.append(assetGroup);

    toolbar.append(toolbarGroupRight);
  }

  return toolbar;
}

// -----------------------------------------------------------------------------
// Left Panel: Tools, Palette Painting, and Source Tile Browser
// -----------------------------------------------------------------------------

function createLeftPanel(
  options: BackgroundWorkspaceOptions,
  activeMap: BackgroundMapDefinition,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'background-left-panel';

  // 1. Tools Section
  const toolsSection = document.createElement('section');
  toolsSection.className = 'background-tools-panel panel';
  toolsSection.id = 'section-bg-tools';

  const toolsHeading = document.createElement('h3');
  toolsHeading.className = 'panel-title';
  toolsHeading.textContent = 'Tools';
  toolsSection.append(toolsHeading);

  const toolsGroup = document.createElement('div');
  toolsGroup.className = 'background-tools-group';
  toolsGroup.setAttribute('role', 'radiogroup');
  toolsGroup.setAttribute('aria-label', 'Editing Tools');

  const tools: readonly [BackgroundTool, string, string][] = [
    ['pencil', t('backgroundToolPencil'), '✏️'],
    ['picker', t('backgroundToolPicker'), '🔍'],
    ['erase', t('backgroundToolErase'), '🧹'],
    ['palette', t('backgroundToolPalette'), '🎨'],
  ];

  tools.forEach(([toolId, label, icon]) => {
    const isCurrent = options.state.activeTool === toolId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn-tool${isCurrent ? ' is-active' : ''}`;
    btn.id = `bg-tool-${toolId}`;
    btn.setAttribute('aria-pressed', String(isCurrent));
    btn.title = label;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'tool-icon';
    iconSpan.textContent = icon;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tool-name';
    nameSpan.textContent = label;
    btn.append(iconSpan, document.createTextNode(' '), nameSpan);

    btn.addEventListener('click', () => {
      options.onStateChange({ activeTool: toolId });
    });
    toolsGroup.append(btn);
  });

  toolsSection.append(toolsGroup);

  // 2. Subpalette Selection Section (0..3)
  const paletteSection = document.createElement('div');
  paletteSection.className = 'background-subpalette-picker';

  const paletteHeading = document.createElement('h4');
  paletteHeading.className = 'subpanel-title';
  paletteHeading.textContent = t('backgroundSubpaletteLabel');
  paletteSection.append(paletteHeading);

  const swatchesContainer = document.createElement('div');
  swatchesContainer.className = 'background-subpalette-swatches';
  swatchesContainer.setAttribute('role', 'radiogroup');
  swatchesContainer.setAttribute('aria-label', t('backgroundSubpaletteLabel'));
  const paletteSet = resolveBackgroundPaletteSet(options);

  for (let pIdx = 0; pIdx < 4; pIdx += 1) {
    const isSelected = options.state.selectedPaletteIndex === pIdx;
    const swatchBox = document.createElement('button');
    swatchBox.type = 'button';
    swatchBox.className = `background-subpalette-box${isSelected ? ' is-selected' : ''}`;
    swatchBox.id = `bg-subpalette-${String(pIdx)}`;
    swatchBox.setAttribute('aria-pressed', String(isSelected));
    const paletteId = options.activeBackgroundSlots[pIdx] ?? null;
    const definition = findPaletteDefinition(options.palettes, paletteId);
    const paletteStatus =
      definition?.name ??
      (paletteId === null
        ? t('paletteManagerSlotEmpty')
        : t('paletteManagerMissingPalette', { paletteId }));
    const paletteLabel = `BG ${String(pIdx)} — ${paletteStatus}`;
    swatchBox.setAttribute('aria-label', paletteLabel);
    swatchBox.title = paletteLabel;
    swatchBox.setAttribute(
      'data-palette-status',
      definition ? 'assigned' : paletteId === null ? 'empty' : 'dangling',
    );
    if (definition === null) swatchBox.classList.add('is-unassigned');

    // Render 4 colors of this subpalette
    const subPalette = paletteSet[pIdx];
    const miniRow = document.createElement('div');
    miniRow.className = 'subpalette-color-row';

    if (subPalette) {
      subPalette.forEach((colorIdx, colorSlot) => {
        const color = NES_MASTER_PALETTE[colorIdx] ?? {
          red: 0,
          green: 0,
          blue: 0,
        };
        const colorPip = document.createElement('span');
        colorPip.className = `color-pip pip-${String(colorSlot)}`;
        colorPip.style.backgroundColor = `rgb(${String(color.red)}, ${String(color.green)}, ${String(color.blue)})`;
        miniRow.append(colorPip);
      });
    }

    const labelSpan = document.createElement('span');
    labelSpan.className = 'subpalette-num';
    labelSpan.textContent = paletteLabel;

    swatchBox.append(labelSpan, miniRow);

    swatchBox.addEventListener('click', () => {
      options.onStateChange({ selectedPaletteIndex: pIdx });
    });

    swatchesContainer.append(swatchBox);
  }

  paletteSection.append(swatchesContainer);
  toolsSection.append(paletteSection);
  panel.append(toolsSection);

  // 3. Source Asset Tile Browser
  const browserSection = createTileBrowserSection(options, activeMap);
  panel.append(browserSection);

  return panel;
}

// -----------------------------------------------------------------------------
// Source Tile Browser Section
// -----------------------------------------------------------------------------

function createTileBrowserSection(
  options: BackgroundWorkspaceOptions,
  activeMap: BackgroundMapDefinition,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'background-tile-browser-panel panel';
  section.id = 'section-bg-tiles';

  const heading = document.createElement('h3');
  heading.className = 'panel-title';
  heading.textContent = t('backgroundTileBrowserTitle');
  section.append(heading);

  const tiles = activeMap.assetId
    ? (options.assetTilesMap?.get(activeMap.assetId) ?? [])
    : [];

  if (!activeMap.assetId || tiles.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-hint';
    emptyMsg.textContent = t('backgroundTileBrowserEmpty');
    section.append(emptyMsg);
    return section;
  }

  const browserGrid = document.createElement('div');
  browserGrid.className = 'background-tile-grid';
  browserGrid.setAttribute('role', 'grid');
  browserGrid.setAttribute('aria-label', t('backgroundTileBrowserTitle'));
  const paletteSet = resolveBackgroundPaletteSet(options);

  // Render tile items
  tiles.forEach((tile, index) => {
    const tileKey = `${activeMap.assetId ?? ''}:${String(tile.column)}:${String(tile.row)}`;
    const isSelected = options.state.selectedTileKey === tileKey;

    const tileItem = document.createElement('button');
    tileItem.type = 'button';
    tileItem.className = `background-tile-item${isSelected ? ' is-selected' : ''}`;
    tileItem.id = `bg-browser-tile-${String(index)}`;
    tileItem.setAttribute('role', 'gridcell');
    tileItem.setAttribute('aria-selected', String(isSelected));
    tileItem.setAttribute('tabindex', isSelected ? '0' : '-1');
    tileItem.title = `Tile (${String(tile.column)}, ${String(tile.row)}) - #${String(index)}`;

    // Mini 8x8 Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    canvas.className = 'mini-tile-canvas';
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const imgData = ctx.createImageData(8, 8);
      const subPalette =
        paletteSet[options.state.selectedPaletteIndex] ?? paletteSet[0];

      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const pixelIndex = tile.pixels[y * 8 + x] ?? 0;
          const colorCode = subPalette[pixelIndex] ?? 0;
          const color = NES_MASTER_PALETTE[colorCode] ?? {
            red: 0,
            green: 0,
            blue: 0,
          };
          const outIdx = (y * 8 + x) * 4;
          imgData.data[outIdx] = color.red;
          imgData.data[outIdx + 1] = color.green;
          imgData.data[outIdx + 2] = color.blue;
          imgData.data[outIdx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    tileItem.append(canvas);

    tileItem.addEventListener('click', () => {
      options.onStateChange({
        selectedTileKey: tileKey,
        activeTool: 'pencil',
      });
    });

    // Keyboard navigation (Arrow keys roving tabindex)
    tileItem.addEventListener('keydown', (e) => {
      let nextIndex = -1;
      const columns = 8;
      if (e.key === 'ArrowRight') nextIndex = index + 1;
      else if (e.key === 'ArrowLeft') nextIndex = index - 1;
      else if (e.key === 'ArrowDown') nextIndex = index + columns;
      else if (e.key === 'ArrowUp') nextIndex = index - columns;

      if (nextIndex >= 0 && nextIndex < tiles.length) {
        e.preventDefault();
        const nextElem = browserGrid.querySelector<HTMLButtonElement>(
          `#bg-browser-tile-${String(nextIndex)}`,
        );
        nextElem?.focus();
        const nextTile = tiles[nextIndex];
        if (nextTile) {
          options.onStateChange({
            selectedTileKey: `${activeMap.assetId ?? ''}:${String(nextTile.column)}:${String(nextTile.row)}`,
          });
        }
      }
    });

    browserGrid.append(tileItem);
  });

  section.append(browserGrid);
  return section;
}

// -----------------------------------------------------------------------------
// Center Panel: Canvas & View Options
// -----------------------------------------------------------------------------

function createCenterPanel(
  options: BackgroundWorkspaceOptions,
  activeMap: BackgroundMapDefinition,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'background-center-panel';

  const viewToolbar = document.createElement('div');
  viewToolbar.className = 'background-view-controls panel';

  // Zoom controls
  const zoomGroup = document.createElement('div');
  zoomGroup.className = 'view-control-group';

  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'control-label';
  zoomLabel.textContent = t('backgroundZoom');
  zoomGroup.append(zoomLabel);

  [1, 2, 3, 4].forEach((z) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn-sm ${options.state.zoom === z ? 'btn-primary is-active' : 'btn-secondary'}`;
    btn.id = `bg-zoom-${String(z)}x`;
    btn.textContent = `${String(z)}x`;
    btn.setAttribute('aria-pressed', String(options.state.zoom === z));
    btn.addEventListener('click', () => {
      options.onStateChange({ zoom: z });
    });
    zoomGroup.append(btn);
  });

  viewToolbar.append(zoomGroup);

  // Grid toggle
  const gridToggleLabel = document.createElement('label');
  gridToggleLabel.className = 'form-checkbox-label';
  const gridCheckbox = document.createElement('input');
  gridCheckbox.type = 'checkbox';
  gridCheckbox.id = 'bg-grid-checkbox';
  gridCheckbox.checked = options.state.showGrid;
  gridCheckbox.addEventListener('change', () => {
    options.onStateChange({ showGrid: gridCheckbox.checked });
  });
  gridToggleLabel.append(
    gridCheckbox,
    document.createTextNode(` ${t('backgroundShowGrid')}`),
  );
  viewToolbar.append(gridToggleLabel);

  // Attribute Overlay toggle
  const attrToggleLabel = document.createElement('label');
  attrToggleLabel.className = 'form-checkbox-label';
  const attrCheckbox = document.createElement('input');
  attrCheckbox.type = 'checkbox';
  attrCheckbox.id = 'bg-attr-checkbox';
  attrCheckbox.checked = options.state.showAttributeOverlay;
  attrCheckbox.addEventListener('change', () => {
    options.onStateChange({ showAttributeOverlay: attrCheckbox.checked });
  });
  attrToggleLabel.append(
    attrCheckbox,
    document.createTextNode(` ${t('backgroundShowAttributeOverlay')}`),
  );
  viewToolbar.append(attrToggleLabel);

  panel.append(viewToolbar);

  // Canvas viewport container
  const canvasViewport = document.createElement('section');
  canvasViewport.className = 'background-canvas-viewport panel';
  canvasViewport.id = 'section-bg-canvas';
  canvasViewport.setAttribute('tabindex', '0');
  canvasViewport.setAttribute('role', 'application');
  canvasViewport.setAttribute('aria-label', t('backgroundCanvasTitle'));

  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = `background-canvas-wrapper zoom-${String(options.state.zoom)}x`;
  canvasWrapper.style.width = `${String(NES_SCREEN_WIDTH_PX * options.state.zoom)}px`;
  canvasWrapper.style.height = `${String(NES_SCREEN_HEIGHT_PX * options.state.zoom)}px`;

  const canvas = document.createElement('canvas');
  canvas.width = NES_SCREEN_WIDTH_PX;
  canvas.height = NES_SCREEN_HEIGHT_PX;
  canvas.className = 'background-screen-canvas';
  canvas.id = 'background-screen-canvas';

  // Render compiled preview onto canvas
  renderBackgroundScreen(canvas, options, activeMap);

  // Overlays (grid, attribute table lines & numbers, selection)
  const overlaySvg = createOverlaySvg(options, activeMap);

  canvasWrapper.append(canvas, overlaySvg);
  canvasViewport.append(canvasWrapper);
  panel.append(canvasViewport);

  // Setup Pointer & Keyboard interaction on Canvas
  attachCanvasInteractions(canvasViewport, canvas, options, activeMap);

  return panel;
}

// -----------------------------------------------------------------------------
// Canvas Rendering Helper
// -----------------------------------------------------------------------------

function renderBackgroundScreen(
  canvas: HTMLCanvasElement,
  options: BackgroundWorkspaceOptions,
  activeMap: BackgroundMapDefinition,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const model = options.compiledModel;
  const paletteSet = resolveBackgroundPaletteSet(options);
  const imgData = ctx.createImageData(
    NES_SCREEN_WIDTH_PX,
    NES_SCREEN_HEIGHT_PX,
  );

  // Fill default background color
  const defaultBgIdx = options.universalBackgroundColor;
  const defaultBg = NES_MASTER_PALETTE[defaultBgIdx] ?? {
    red: 0,
    green: 0,
    blue: 0,
  };
  for (let i = 0; i < imgData.data.length; i += 4) {
    imgData.data[i] = defaultBg.red;
    imgData.data[i + 1] = defaultBg.green;
    imgData.data[i + 2] = defaultBg.blue;
    imgData.data[i + 3] = 255;
  }

  if (model?.finalChr.length === 8192) {
    const ptOffset = model.patternTable * 4096;

    for (let row = 0; row < BACKGROUND_HEIGHT_TILES; row += 1) {
      for (let col = 0; col < BACKGROUND_WIDTH_TILES; col += 1) {
        const cellIndex = row * BACKGROUND_WIDTH_TILES + col;
        const localTileIndex = model.nametable[cellIndex] ?? 0;
        const quadrantIndex =
          Math.floor(row / 2) * BACKGROUND_PALETTE_COLUMNS +
          Math.floor(col / 2);
        const paletteIndex = activeMap.paletteAssignments[quadrantIndex] ?? 0;
        const subPalette = paletteSet[paletteIndex];

        // 16 bytes for this tile
        const tileByteOffset = ptOffset + localTileIndex * 16;

        for (let py = 0; py < 8; py += 1) {
          const plane0 = model.finalChr[tileByteOffset + py] ?? 0;
          const plane1 = model.finalChr[tileByteOffset + py + 8] ?? 0;

          for (let px = 0; px < 8; px += 1) {
            const shift = 7 - px;
            const bit0 = (plane0 >> shift) & 1;
            const bit1 = (plane1 >> shift) & 1;
            const colorIndex = (bit1 << 1) | bit0;

            const nesColorCode = subPalette
              ? (subPalette[colorIndex] ?? defaultBgIdx)
              : defaultBgIdx;
            const color = NES_MASTER_PALETTE[nesColorCode] ?? defaultBg;
            const targetX = col * 8 + px;
            const targetY = row * 8 + py;
            const pixelPos = (targetY * NES_SCREEN_WIDTH_PX + targetX) * 4;

            imgData.data[pixelPos] = color.red;
            imgData.data[pixelPos + 1] = color.green;
            imgData.data[pixelPos + 2] = color.blue;
            imgData.data[pixelPos + 3] = 255;
          }
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// -----------------------------------------------------------------------------
// SVG Overlay for Grid, Attribute Table, and Selection
// -----------------------------------------------------------------------------

function createOverlaySvg(
  options: BackgroundWorkspaceOptions,
  activeMap: BackgroundMapDefinition,
): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute(
    'viewBox',
    `0 0 ${String(NES_SCREEN_WIDTH_PX)} ${String(NES_SCREEN_HEIGHT_PX)}`,
  );
  svg.setAttribute('class', 'background-canvas-overlay-svg');
  svg.setAttribute('aria-hidden', 'true');

  // 1. 8x8 Grid lines
  if (options.state.showGrid) {
    const gridGroup = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'g',
    );
    gridGroup.setAttribute('class', 'grid-8x8-lines');

    for (let col = 1; col < BACKGROUND_WIDTH_TILES; col += 1) {
      const line = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'line',
      );
      line.setAttribute('x1', String(col * TILE_SIZE));
      line.setAttribute('y1', '0');
      line.setAttribute('x2', String(col * TILE_SIZE));
      line.setAttribute('y2', String(NES_SCREEN_HEIGHT_PX));
      line.setAttribute('stroke', 'rgba(255, 255, 255, 0.15)');
      line.setAttribute('stroke-width', '0.5');
      gridGroup.append(line);
    }
    for (let row = 1; row < BACKGROUND_HEIGHT_TILES; row += 1) {
      const line = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'line',
      );
      line.setAttribute('x1', '0');
      line.setAttribute('y1', String(row * TILE_SIZE));
      line.setAttribute('x2', String(NES_SCREEN_WIDTH_PX));
      line.setAttribute('y2', String(row * TILE_SIZE));
      line.setAttribute('stroke', 'rgba(255, 255, 255, 0.15)');
      line.setAttribute('stroke-width', '0.5');
      gridGroup.append(line);
    }
    svg.append(gridGroup);
  }

  // 2. 16x16 Attribute Table Overlay lines & subpalette badges
  if (options.state.showAttributeOverlay) {
    const attrGroup = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'g',
    );
    attrGroup.setAttribute('class', 'grid-16x16-attribute-overlay');

    // 16x16 block grid lines
    for (let col = 1; col < BACKGROUND_PALETTE_COLUMNS; col += 1) {
      const line = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'line',
      );
      line.setAttribute('x1', String(col * BLOCK_SIZE));
      line.setAttribute('y1', '0');
      line.setAttribute('x2', String(col * BLOCK_SIZE));
      line.setAttribute('y2', String(NES_SCREEN_HEIGHT_PX));
      line.setAttribute('stroke', 'rgba(0, 220, 255, 0.45)');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '2,2');
      attrGroup.append(line);
    }
    for (let row = 1; row < 15; row += 1) {
      const line = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'line',
      );
      line.setAttribute('x1', '0');
      line.setAttribute('y1', String(row * BLOCK_SIZE));
      line.setAttribute('x2', String(NES_SCREEN_WIDTH_PX));
      line.setAttribute('y2', String(row * BLOCK_SIZE));
      line.setAttribute('stroke', 'rgba(0, 220, 255, 0.45)');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '2,2');
      attrGroup.append(line);
    }

    // Subpalette text numbers (0..3) in each 16x16 block
    for (let by = 0; by < 15; by += 1) {
      for (let bx = 0; bx < BACKGROUND_PALETTE_COLUMNS; bx += 1) {
        const quadrantIndex = by * BACKGROUND_PALETTE_COLUMNS + bx;
        const pal = activeMap.paletteAssignments[quadrantIndex] ?? 0;

        const text = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'text',
        );
        text.setAttribute('x', String(bx * BLOCK_SIZE + 3));
        text.setAttribute('y', String(by * BLOCK_SIZE + 10));
        text.setAttribute('fill', 'rgba(0, 220, 255, 0.75)');
        text.setAttribute('font-size', '6');
        text.setAttribute('font-family', 'monospace');
        text.setAttribute('font-weight', 'bold');
        text.textContent = String(pal);
        attrGroup.append(text);
      }
    }
    svg.append(attrGroup);
  }

  // 3. Selection Cursor (8x8 cell or 16x16 attribute block)
  if (options.state.selectedCellIndex !== null) {
    const selIdx = options.state.selectedCellIndex;
    const selX = (selIdx % BACKGROUND_WIDTH_TILES) * TILE_SIZE;
    const selY = Math.floor(selIdx / BACKGROUND_WIDTH_TILES) * TILE_SIZE;

    const selRect = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'rect',
    );
    selRect.setAttribute('x', String(selX));
    selRect.setAttribute('y', String(selY));
    selRect.setAttribute('width', String(TILE_SIZE));
    selRect.setAttribute('height', String(TILE_SIZE));
    selRect.setAttribute('fill', 'none');
    selRect.setAttribute('stroke', '#ffcc00');
    selRect.setAttribute('stroke-width', '1.5');
    selRect.setAttribute('class', 'canvas-selection-box');
    svg.append(selRect);

    // If palette tool active, also highlight the 16x16 block
    if (options.state.activeTool === 'palette') {
      const blockX =
        Math.floor((selIdx % BACKGROUND_WIDTH_TILES) / 2) * BLOCK_SIZE;
      const blockY =
        Math.floor(Math.floor(selIdx / BACKGROUND_WIDTH_TILES) / 2) *
        BLOCK_SIZE;
      const blockRect = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'rect',
      );
      blockRect.setAttribute('x', String(blockX));
      blockRect.setAttribute('y', String(blockY));
      blockRect.setAttribute('width', String(BLOCK_SIZE));
      blockRect.setAttribute('height', String(BLOCK_SIZE));
      blockRect.setAttribute('fill', 'rgba(0, 220, 255, 0.15)');
      blockRect.setAttribute('stroke', '#00dcff');
      blockRect.setAttribute('stroke-width', '1.5');
      svg.append(blockRect);
    }
  }

  return svg;
}

// -----------------------------------------------------------------------------
// Canvas Interaction Handling (Pointer Events & Keyboard)
// -----------------------------------------------------------------------------

function attachCanvasInteractions(
  viewport: HTMLElement,
  canvas: HTMLCanvasElement,
  options: BackgroundWorkspaceOptions,
  activeMap: BackgroundMapDefinition,
): void {
  let isPointerDown = false;
  let lastAppliedCell = -1;

  // Working copy of cells / paletteAssignments for gesture atomicity
  let workingCells: (BackgroundMapCell | null)[] = [...activeMap.cells];
  let workingPalette: number[] = [...activeMap.paletteAssignments];
  let cellsModified = false;
  let paletteModified = false;

  const getCellCoordsFromEvent = (
    e: MouseEvent,
  ): { col: number; row: number; cellIndex: number } | null => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = NES_SCREEN_WIDTH_PX / rect.width;
    const scaleY = NES_SCREEN_HEIGHT_PX / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    if (
      x < 0 ||
      x >= NES_SCREEN_WIDTH_PX ||
      y < 0 ||
      y >= NES_SCREEN_HEIGHT_PX
    ) {
      return null;
    }

    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    const cellIndex = row * BACKGROUND_WIDTH_TILES + col;
    return { col, row, cellIndex };
  };

  const applyToolAtCell = (cellIndex: number): void => {
    if (cellIndex < 0 || cellIndex >= TOTAL_CELLS) return;
    const col = cellIndex % BACKGROUND_WIDTH_TILES;
    const row = Math.floor(cellIndex / BACKGROUND_WIDTH_TILES);

    options.onStateChange({ selectedCellIndex: cellIndex });

    if (options.state.activeTool === 'pencil') {
      if (options.state.selectedTileKey) {
        const parts = options.state.selectedTileKey.split(':');
        const tileX = parseInt(parts[1] ?? '0', 10);
        const tileY = parseInt(parts[2] ?? '0', 10);
        const cellValue: BackgroundMapCell = {
          logicalKey: options.state.selectedTileKey,
          tileX,
          tileY,
        };
        workingCells[cellIndex] = cellValue;
        cellsModified = true;
      }
    } else if (options.state.activeTool === 'erase') {
      workingCells[cellIndex] = null;
      cellsModified = true;
    } else if (options.state.activeTool === 'picker') {
      const cell = activeMap.cells[cellIndex];
      if (cell) {
        options.onStateChange({
          selectedTileKey: cell.logicalKey,
          activeTool: 'pencil',
        });
      }
    } else {
      const quadrantIndex =
        Math.floor(row / 2) * BACKGROUND_PALETTE_COLUMNS + Math.floor(col / 2);
      workingPalette[quadrantIndex] = options.state.selectedPaletteIndex;
      paletteModified = true;
    }
  };

  canvas.addEventListener('pointerdown', (e) => {
    viewport.focus();
    isPointerDown = true;
    workingCells = [...activeMap.cells];
    workingPalette = [...activeMap.paletteAssignments];
    cellsModified = false;
    paletteModified = false;

    const coords = getCellCoordsFromEvent(e);
    if (coords) {
      lastAppliedCell = coords.cellIndex;
      applyToolAtCell(coords.cellIndex);
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!isPointerDown) return;
    const coords = getCellCoordsFromEvent(e);
    if (coords && coords.cellIndex !== lastAppliedCell) {
      lastAppliedCell = coords.cellIndex;
      applyToolAtCell(coords.cellIndex);
    }
  });

  const finishGesture = (): void => {
    if (!isPointerDown) return;
    isPointerDown = false;
    lastAppliedCell = -1;

    if (cellsModified) {
      options.onCellsChange(activeMap.id, workingCells);
      cellsModified = false;
    }
    if (paletteModified) {
      options.onPaletteAssignmentsChange(activeMap.id, workingPalette);
      paletteModified = false;
    }
  };

  window.addEventListener('pointerup', finishGesture);
  window.addEventListener('pointercancel', finishGesture);

  // Keyboard navigation on Canvas Viewport
  viewport.addEventListener('keydown', (e) => {
    const currentIdx = options.state.selectedCellIndex ?? 0;
    let col = currentIdx % BACKGROUND_WIDTH_TILES;
    let row = Math.floor(currentIdx / BACKGROUND_WIDTH_TILES);
    let handled = false;

    if (e.key === 'ArrowRight') {
      col = Math.min(BACKGROUND_WIDTH_TILES - 1, col + 1);
      handled = true;
    } else if (e.key === 'ArrowLeft') {
      col = Math.max(0, col - 1);
      handled = true;
    } else if (e.key === 'ArrowDown') {
      row = Math.min(BACKGROUND_HEIGHT_TILES - 1, row + 1);
      handled = true;
    } else if (e.key === 'ArrowUp') {
      row = Math.max(0, row - 1);
      handled = true;
    } else if (e.key === ' ' || e.key === 'Enter') {
      // Apply current tool
      workingCells = [...activeMap.cells];
      workingPalette = [...activeMap.paletteAssignments];
      cellsModified = false;
      paletteModified = false;
      applyToolAtCell(currentIdx);
      options.onCellsChange(activeMap.id, workingCells);
      options.onPaletteAssignmentsChange(activeMap.id, workingPalette);
      handled = true;
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      workingCells = [...activeMap.cells];
      workingCells[currentIdx] = null;
      options.onCellsChange(activeMap.id, workingCells);
      handled = true;
    } else if (['1', '2', '3', '4'].includes(e.key)) {
      const p = parseInt(e.key, 10) - 1;
      options.onStateChange({ selectedPaletteIndex: p });
      handled = true;
    } else if (e.key.toLowerCase() === 'g') {
      options.onStateChange({ showGrid: !options.state.showGrid });
      handled = true;
    } else if (e.key.toLowerCase() === 'a') {
      options.onStateChange({
        showAttributeOverlay: !options.state.showAttributeOverlay,
      });
      handled = true;
    } else if (e.key.toLowerCase() === 'p') {
      options.onStateChange({ activeTool: 'pencil' });
      handled = true;
    } else if (e.key.toLowerCase() === 'e') {
      options.onStateChange({ activeTool: 'erase' });
      handled = true;
    } else if (e.key.toLowerCase() === 'i') {
      options.onStateChange({ activeTool: 'picker' });
      handled = true;
    }

    if (handled) {
      e.preventDefault();
      const newCellIndex = row * BACKGROUND_WIDTH_TILES + col;
      if (newCellIndex !== currentIdx) {
        options.onStateChange({ selectedCellIndex: newCellIndex });
      }
    }
  });
}

// -----------------------------------------------------------------------------
// Right Panel: Inspector & Diagnostics
// -----------------------------------------------------------------------------

function createRightPanel(
  options: BackgroundWorkspaceOptions,
  activeMap: BackgroundMapDefinition,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'background-right-panel';

  // 1. Inspector Section
  const inspectorSection = document.createElement('section');
  inspectorSection.className = 'background-inspector-panel panel';
  inspectorSection.id = 'section-bg-inspector';

  const inspectorHeading = document.createElement('h3');
  inspectorHeading.className = 'panel-title';
  inspectorHeading.textContent = t('backgroundInspectorTitle');
  inspectorSection.append(inspectorHeading);

  const selIndex = options.state.selectedCellIndex;
  const inspectorContent = document.createElement('div');
  inspectorContent.className = 'background-inspector-content';

  if (selIndex !== null && selIndex >= 0 && selIndex < TOTAL_CELLS) {
    const col = selIndex % BACKGROUND_WIDTH_TILES;
    const row = Math.floor(selIndex / BACKGROUND_WIDTH_TILES);
    const cell = activeMap.cells[selIndex];
    const quadrantIndex =
      Math.floor(row / 2) * BACKGROUND_PALETTE_COLUMNS + Math.floor(col / 2);
    const paletteIndex = activeMap.paletteAssignments[quadrantIndex] ?? 0;
    const paletteId = options.activeBackgroundSlots[paletteIndex] ?? null;
    const paletteDefinition = findPaletteDefinition(
      options.palettes,
      paletteId,
    );

    const dl = document.createElement('dl');
    dl.className = 'inspector-props-list';

    const dtCoords = document.createElement('dt');
    dtCoords.textContent = `${t('backgroundCellCoords')}:`;
    const ddCoords = document.createElement('dd');
    ddCoords.id = 'bg-inspect-coords';
    ddCoords.textContent = `Col ${String(col)}, Row ${String(row)} (#${String(selIndex)})`;

    const dtPixels = document.createElement('dt');
    dtPixels.textContent = 'Pixels:';
    const ddPixels = document.createElement('dd');
    ddPixels.textContent = `X: ${String(col * 8)}px, Y: ${String(row * 8)}px`;

    const dtLogical = document.createElement('dt');
    dtLogical.textContent = `${t('backgroundLogicalTile')}:`;
    const ddLogical = document.createElement('dd');
    ddLogical.id = 'bg-inspect-logical-key';
    ddLogical.textContent = cell ? cell.logicalKey : t('backgroundEmptyCell');

    const dtSubpalette = document.createElement('dt');
    dtSubpalette.textContent = `${t('backgroundSubpaletteLabel')}:`;
    const ddSubpalette = document.createElement('dd');
    ddSubpalette.id = 'bg-inspect-subpalette';
    ddSubpalette.textContent = `BG ${String(paletteIndex)} — ${
      paletteDefinition?.name ??
      (paletteId === null
        ? t('paletteManagerSlotEmpty')
        : t('paletteManagerMissingPalette', { paletteId }))
    }`;

    const dtBlock = document.createElement('dt');
    dtBlock.textContent = `${t('backgroundAttributeBlock')}:`;
    const ddBlock = document.createElement('dd');
    ddBlock.textContent = `Block (${String(Math.floor(col / 2))}, ${String(Math.floor(row / 2))}) - Q#${String(quadrantIndex)}`;

    dl.append(
      dtCoords,
      ddCoords,
      dtPixels,
      ddPixels,
      dtLogical,
      ddLogical,
      dtSubpalette,
      ddSubpalette,
      dtBlock,
      ddBlock,
    );

    // Physical Mapping Information (from compiled model if compiled)
    if (options.compiledModel) {
      const localTile = options.compiledModel.nametable[selIndex] ?? 0;
      const physicalTile = options.compiledModel.patternTable * 256 + localTile;

      const physicalDt = document.createElement('dt');
      physicalDt.textContent = t('backgroundPhysicalTile') + ':';
      const physicalDd = document.createElement('dd');
      physicalDd.id = 'bg-inspect-physical-tile';
      physicalDd.textContent = `PT${String(options.compiledModel.patternTable)} #${String(localTile)} (CHR Slot #${String(physicalTile)})`;

      dl.append(physicalDt, physicalDd);

      if (options.onNavigateToChrTile) {
        const navBtn = document.createElement('button');
        navBtn.type = 'button';
        navBtn.className = 'btn btn-secondary btn-sm bg-nav-chr-btn';
        navBtn.id = 'bg-inspect-nav-chr-btn';
        navBtn.textContent = `🔎 ${t('backgroundInspectInChr')}`;
        navBtn.addEventListener('click', () => {
          options.onNavigateToChrTile?.(physicalTile);
        });
        inspectorContent.append(dl, navBtn);
      } else {
        inspectorContent.append(dl);
      }
    } else {
      inspectorContent.append(dl);
    }
  } else {
    const noSel = document.createElement('p');
    noSel.className = 'empty-hint';
    noSel.textContent = 'Click on any canvas cell to inspect details.';
    inspectorContent.append(noSel);
  }

  inspectorSection.append(inspectorContent);
  panel.append(inspectorSection);

  // 2. Diagnostics Section
  const diagSection = document.createElement('section');
  diagSection.className = 'background-diagnostics-panel panel';
  const diagHeading = document.createElement('h3');
  diagHeading.className = 'panel-title';
  diagHeading.textContent = 'Diagnostics';
  diagSection.append(diagHeading);

  const diagList = document.createElement('div');
  diagList.className = 'background-diagnostics-list';
  renderDiagnostics(diagList, options.reconciliationFacts ?? []);

  diagSection.append(diagList);
  panel.append(diagSection);

  return panel;
}

// -----------------------------------------------------------------------------
// Diagnostics List Renderer
// -----------------------------------------------------------------------------

function renderDiagnostics(
  host: HTMLElement,
  facts: readonly BackgroundMapReconciliationFact[],
): void {
  host.replaceChildren();

  if (facts.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'diagnostic-item is-ok';
    ok.textContent = '✓ No background diagnostics or errors found.';
    host.append(ok);
    return;
  }

  facts.forEach((fact) => {
    const item = document.createElement('div');
    item.className = `diagnostic-item is-${fact.severity}`;
    item.textContent = `${fact.severity.toUpperCase()}: ${fact.message}`;
    host.append(item);
  });
}
