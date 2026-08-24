import type { AnimationProjectModel } from '../core/animation-model';
import {
  analyzeBaseChrOccupancy,
  createPatternTableSlots,
  encodePatternTableSlots,
  NES_CHR_ROM_SIZE,
  NES_CHR_ROM_TILE_COUNT,
  NES_PATTERN_TABLE_SIZE,
  NES_PATTERN_TABLE_TILE_COUNT,
  type SpritePatternTable,
} from '../core/chr-pattern-table';
import {
  deduplicateTiles,
  deduplicateTilesConsideringFlips,
} from '../core/tile-deduplication';
import { encodeChr } from '../core/chr-encoder';
import { padChrRom } from '../core/chr-rom';
import type { Tile } from '../core/types';
import { t } from '../i18n';
import { createChrTileInspector } from './chr-tile-inspector';
import type { DisplayError, ProjectMode } from './types';
import type { WorkspaceView } from './workspace-state';

export const CHR_ZOOM_LEVELS = [1, 2, 3, 4, 8] as const;
export type ChrZoomLevel = (typeof CHR_ZOOM_LEVELS)[number];

export const NEUTRAL_NES_GRAYSCALE = [
  { red: 15, green: 22, blue: 32 }, // 0: background tone
  { red: 116, green: 116, blue: 116 }, // 1: NES $00
  { red: 188, green: 188, blue: 188 }, // 2: NES $10
  { red: 255, green: 255, blue: 255 }, // 3: NES $30
] as const;

export interface ChrWorkspaceOptions {
  readonly mode: ProjectMode;
  readonly animationModel: AnimationProjectModel | null;
  readonly baseChr: Uint8Array | null;
  readonly baseChrName: string | null;
  readonly patternTable: SpritePatternTable;
  readonly destinationPatternTable: SpritePatternTable;
  readonly tiles: readonly Tile[];
  readonly deduplicationEnabled: boolean;
  readonly flipDeduplicationEnabled: boolean;
  readonly zoom?: number;
  readonly onZoomChange?: (zoom: number) => void;
  readonly selectedTileIndex?: number | null;
  readonly onSelectTile?: (tileIndex: number | null) => void;
  readonly loading?: boolean;
  readonly error?: DisplayError | null;
  readonly onNavigateToWorkspace?: (workspace: WorkspaceView) => void;
  readonly onDownloadBytes?: (bytes: Uint8Array, fileName: string) => void;
  readonly onDownloadText?: (text: string, fileName: string) => void;
}

export type ChrWorkspaceElement = HTMLElement & {
  readonly diagnosticsElement: HTMLElement | null;
  readonly tileInspectorElement: HTMLElement | null;
};

interface ComputedChrMetrics {
  readonly physicalCapacityTiles: number;
  readonly totalOccupiedTiles: number;
  readonly totalFreeTiles: number;
  readonly pt0OccupiedTiles: number;
  readonly pt0BaseTiles: number;
  readonly pt1OccupiedTiles: number;
  readonly pt1BaseTiles: number;
  readonly activeSpritePatternTable: SpritePatternTable;
  readonly spritePtOccupiedTiles: number;
  readonly spritePtRemainingTiles: number;
  readonly reusedDestinationTiles: number;
  readonly reusedImportedTiles: number;
  readonly newTileCount: number;
  readonly deduplicationSavings: number;
  readonly finalChrBytes: Uint8Array;
  readonly outputFileName: string;
}

function computeMetrics(options: ChrWorkspaceOptions): ComputedChrMetrics {
  if (options.mode === 'animation' && options.animationModel !== null) {
    const stats = options.animationModel.chr;
    const pt0Occupied = stats.patternTableFinalTileCounts[0];
    const pt1Occupied = stats.patternTableFinalTileCounts[1];
    const totalOccupied = stats.finalTileCount;
    const pt0Base = stats.baseOccupancy.patternTables[0].occupiedTiles;
    const pt1Base = stats.baseOccupancy.patternTables[1].occupiedTiles;
    const spritePt = stats.patternTable;
    const spriteOccupied = stats.patternTableFinalTileCount;
    const spriteRemaining = Math.max(
      0,
      NES_PATTERN_TABLE_TILE_COUNT - spriteOccupied,
    );

    return {
      physicalCapacityTiles: NES_CHR_ROM_TILE_COUNT,
      totalOccupiedTiles: totalOccupied,
      totalFreeTiles: Math.max(0, NES_CHR_ROM_TILE_COUNT - totalOccupied),
      pt0OccupiedTiles: pt0Occupied,
      pt0BaseTiles: pt0Base,
      pt1OccupiedTiles: pt1Occupied,
      pt1BaseTiles: pt1Base,
      activeSpritePatternTable: spritePt,
      spritePtOccupiedTiles: spriteOccupied,
      spritePtRemainingTiles: spriteRemaining,
      reusedDestinationTiles: stats.reusedDestinationTiles,
      reusedImportedTiles: stats.reusedImportedTiles,
      newTileCount: stats.newTileCount,
      deduplicationSavings:
        stats.reusedDestinationTiles + stats.reusedImportedTiles,
      finalChrBytes: options.animationModel.finalChr,
      outputFileName: stats.output,
    };
  }

  // Tileset or Playfield mode
  const baseOccupancy =
    options.baseChr && options.baseChr.length > 0
      ? analyzeBaseChrOccupancy(
          options.baseChr,
          options.destinationPatternTable,
        )
      : null;

  const deduplicated = options.flipDeduplicationEnabled
    ? deduplicateTilesConsideringFlips(options.tiles)
    : options.deduplicationEnabled
      ? deduplicateTiles(options.tiles)
      : options.tiles;

  const totalOccupied = Math.min(
    NES_CHR_ROM_TILE_COUNT,
    deduplicated.length + (baseOccupancy?.occupiedTiles ?? 0),
  );
  const pt0Occupied = Math.min(NES_PATTERN_TABLE_TILE_COUNT, totalOccupied);
  const pt1Occupied = Math.max(
    0,
    Math.min(
      NES_PATTERN_TABLE_TILE_COUNT,
      totalOccupied - NES_PATTERN_TABLE_TILE_COUNT,
    ),
  );
  const spritePt = options.patternTable;
  const spriteOccupied = spritePt === 0 ? pt0Occupied : pt1Occupied;
  const spriteRemaining = Math.max(
    0,
    NES_PATTERN_TABLE_TILE_COUNT - spriteOccupied,
  );
  const savings = Math.max(0, options.tiles.length - deduplicated.length);

  let finalChrBytes: Uint8Array;
  if (options.baseChr && options.baseChr.length > 0) {
    const slots = createPatternTableSlots(
      options.baseChr,
      options.destinationPatternTable,
    );
    let insertIndex = 0;
    for (const tile of deduplicated) {
      while (insertIndex < slots.length && slots[insertIndex]?.tile !== null) {
        insertIndex += 1;
      }
      if (insertIndex < slots.length) {
        slots[insertIndex] = {
          physicalTileIndex: insertIndex,
          tile,
          source: 'imported',
        };
        insertIndex += 1;
      }
    }
    finalChrBytes = encodePatternTableSlots(slots);
  } else {
    finalChrBytes = padChrRom(encodeChr(deduplicated));
  }

  return {
    physicalCapacityTiles: NES_CHR_ROM_TILE_COUNT,
    totalOccupiedTiles: totalOccupied,
    totalFreeTiles: Math.max(0, NES_CHR_ROM_TILE_COUNT - totalOccupied),
    pt0OccupiedTiles: pt0Occupied,
    pt0BaseTiles: baseOccupancy?.patternTables[0].occupiedTiles ?? 0,
    pt1OccupiedTiles: pt1Occupied,
    pt1BaseTiles: baseOccupancy?.patternTables[1].occupiedTiles ?? 0,
    activeSpritePatternTable: spritePt,
    spritePtOccupiedTiles: spriteOccupied,
    spritePtRemainingTiles: spriteRemaining,
    reusedDestinationTiles: baseOccupancy?.occupiedTiles ?? 0,
    reusedImportedTiles: savings,
    newTileCount: deduplicated.length,
    deduplicationSavings: savings,
    finalChrBytes,
    outputFileName: 'output.chr',
  };
}

export function renderPatternTableToCanvas(
  canvas: HTMLCanvasElement,
  chrBytes: Uint8Array,
  patternTable: SpritePatternTable,
  colors: readonly {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
  }[] = NEUTRAL_NES_GRAYSCALE,
): void {
  const context = canvas.getContext('2d');
  if (context === null) {
    return;
  }

  const imageData = context.createImageData(128, 128);
  const data = imageData.data;
  const startByte = patternTable * NES_PATTERN_TABLE_SIZE;

  for (
    let localIndex = 0;
    localIndex < NES_PATTERN_TABLE_TILE_COUNT;
    localIndex += 1
  ) {
    const tileByteOffset = startByte + localIndex * 16;
    const tileBytes =
      chrBytes.length >= tileByteOffset + 16
        ? chrBytes.subarray(tileByteOffset, tileByteOffset + 16)
        : new Uint8Array(16);

    const tileCol = localIndex % 16;
    const tileRow = Math.floor(localIndex / 16);
    const startX = tileCol * 8;
    const startY = tileRow * 8;

    for (let py = 0; py < 8; py += 1) {
      const plane0 = tileBytes[py] ?? 0;
      const plane1 = tileBytes[py + 8] ?? 0;

      for (let px = 0; px < 8; px += 1) {
        const bit = 7 - px;
        const colorVal = ((plane0 >> bit) & 1) | (((plane1 >> bit) & 1) << 1);
        const fallbackColor = colors[0] ?? { red: 0, green: 0, blue: 0 };
        const color = colors[colorVal] ?? fallbackColor;

        const pixelOffset = ((startY + py) * 128 + (startX + px)) * 4;
        data[pixelOffset] = color.red;
        data[pixelOffset + 1] = color.green;
        data[pixelOffset + 2] = color.blue;
        data[pixelOffset + 3] = 255;
      }
    }
  }

  context.putImageData(imageData, 0, 0);
}

function createPatternTableView(
  patternTable: SpritePatternTable,
  finalChrBytes: Uint8Array,
  activeSpritePt: SpritePatternTable,
  zoom: number,
  selectedTileIndex: number | null,
  onSelectTile?: (tileIndex: number | null) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'chr-pt-view-card';
  card.setAttribute('data-pattern-table', String(patternTable));

  // Header
  const header = document.createElement('div');
  header.className = 'chr-pt-view-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'chr-pt-view-title-group';

  const title = document.createElement('h4');
  title.textContent =
    patternTable === 0 ? t('chrWorkspacePt0Title') : t('chrWorkspacePt1Title');

  const subtitle = document.createElement('span');
  subtitle.className = 'chr-pt-view-subtitle';
  subtitle.textContent =
    patternTable === 0
      ? t('chrWorkspacePt0Subtitle')
      : t('chrWorkspacePt1Subtitle');

  titleGroup.append(title, subtitle);

  const role = document.createElement('span');
  const isSprite = activeSpritePt === patternTable;
  role.className = `chr-pt-role-badge${isSprite ? ' is-sprite-pt' : ''}`;
  role.textContent = isSprite
    ? t('chrWorkspacePtRoleSprite')
    : t('chrWorkspacePtRoleBackground');

  header.append(titleGroup, role);

  // Canvas and Overlay
  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'chr-pt-canvas-wrapper';

  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'chr-pt-canvas-container';
  canvasContainer.style.width = `${String(128 * zoom)}px`;
  canvasContainer.style.height = `${String(128 * zoom)}px`;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  canvas.className = 'chr-pt-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    patternTable === 0 ? t('chrWorkspacePt0Title') : t('chrWorkspacePt1Title'),
  );

  renderPatternTableToCanvas(canvas, finalChrBytes, patternTable);

  const gridOverlay = document.createElement('div');
  gridOverlay.className = 'chr-pt-grid-overlay';
  gridOverlay.setAttribute('role', 'grid');
  gridOverlay.setAttribute(
    'aria-label',
    patternTable === 0 ? t('chrWorkspacePt0Title') : t('chrWorkspacePt1Title'),
  );

  const startPhysical = patternTable * NES_PATTERN_TABLE_TILE_COUNT;
  for (
    let localIndex = 0;
    localIndex < NES_PATTERN_TABLE_TILE_COUNT;
    localIndex += 1
  ) {
    const physicalIndex = startPhysical + localIndex;
    const isSlotSelected = selectedTileIndex === physicalIndex;
    const row = Math.floor(localIndex / 16);
    const col = localIndex % 16;
    const hexLocal = localIndex.toString(16).toUpperCase().padStart(2, '0');
    const addrHex = (patternTable * 0x1000 + localIndex * 16)
      .toString(16)
      .toUpperCase()
      .padStart(4, '0');

    const slot = document.createElement('div');
    slot.className = `chr-tile-slot${isSlotSelected ? ' is-selected' : ''}`;
    slot.tabIndex = 0;
    slot.setAttribute('data-physical-index', String(physicalIndex));
    slot.setAttribute('data-local-index', String(localIndex));
    slot.setAttribute('data-pattern-table', String(patternTable));
    slot.setAttribute('data-row', String(row));
    slot.setAttribute('data-col', String(col));
    slot.setAttribute('role', 'gridcell');
    slot.setAttribute('aria-selected', String(isSlotSelected));
    slot.setAttribute(
      'aria-label',
      t('chrWorkspaceTileAriaLabel', {
        pt: patternTable,
        hex: hexLocal,
        id: physicalIndex,
      }),
    );
    slot.title = t('chrWorkspaceTileTooltip', {
      pt: patternTable,
      hex: hexLocal,
      id: physicalIndex,
      addr: addrHex,
    });

    slot.addEventListener('click', () => {
      if (onSelectTile) {
        onSelectTile(physicalIndex);
      }
    });

    slot.addEventListener('keydown', (e?: KeyboardEvent) => {
      if (e?.key === 'Enter' || e?.key === ' ') {
        if (typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        if (onSelectTile) {
          onSelectTile(physicalIndex);
        }
      } else if (e?.key === 'Escape') {
        if (typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        if (onSelectTile) {
          onSelectTile(null);
        }
      }
    });

    gridOverlay.append(slot);
  }

  canvasContainer.append(canvas, gridOverlay);
  canvasWrapper.append(canvasContainer);
  card.append(header, canvasWrapper);
  return card;
}

function createViewerPanel(
  options: ChrWorkspaceOptions,
  metrics: ComputedChrMetrics,
  zoom: number,
): HTMLElement {
  const viewerPanel = document.createElement('section');
  viewerPanel.className = 'panel chr-viewer-panel';
  viewerPanel.id = 'section-chr-viewer';

  const toolbar = document.createElement('div');
  toolbar.className = 'chr-viewer-toolbar';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'chr-viewer-title-group';

  const heading = document.createElement('h3');
  heading.textContent = t('chrWorkspaceViewerTitle');

  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('chrWorkspaceViewerHint');

  titleGroup.append(heading, hint);

  // Zoom controls
  const zoomControls = document.createElement('div');
  zoomControls.className = 'chr-zoom-controls';

  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'chr-zoom-label';
  zoomLabel.textContent = t('chrWorkspaceZoomLabel');

  const segmented = document.createElement('div');
  segmented.className = 'segmented-control chr-zoom-segmented';
  segmented.setAttribute('role', 'group');
  segmented.setAttribute('aria-label', t('chrWorkspaceZoomLabel'));

  CHR_ZOOM_LEVELS.forEach((level) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `segmented-button${zoom === level ? ' is-active' : ''}`;
    btn.setAttribute('aria-pressed', String(zoom === level));
    btn.textContent = `${String(level)}×`;
    btn.addEventListener('click', () => {
      if (options.onZoomChange) {
        options.onZoomChange(level);
      }
    });
    segmented.append(btn);
  });

  zoomControls.append(zoomLabel, segmented);
  toolbar.append(titleGroup, zoomControls);

  const ptContainer = document.createElement('div');
  ptContainer.className = 'chr-pattern-tables-container';

  const selectedTileIndex = options.selectedTileIndex ?? null;

  const pt0Card = createPatternTableView(
    0,
    metrics.finalChrBytes,
    metrics.activeSpritePatternTable,
    zoom,
    selectedTileIndex,
    options.onSelectTile,
  );
  const pt1Card = createPatternTableView(
    1,
    metrics.finalChrBytes,
    metrics.activeSpritePatternTable,
    zoom,
    selectedTileIndex,
    options.onSelectTile,
  );

  ptContainer.append(pt0Card, pt1Card);
  viewerPanel.append(toolbar, ptContainer);

  return viewerPanel;
}

function createProgressBar(
  value: number,
  max: number,
  label: string,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'chr-progress-container';

  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  const barTrack = document.createElement('div');
  barTrack.className = 'chr-progress-track';
  barTrack.setAttribute('role', 'progressbar');
  barTrack.setAttribute('aria-valuenow', String(value));
  barTrack.setAttribute('aria-valuemin', '0');
  barTrack.setAttribute('aria-valuemax', String(max));
  barTrack.setAttribute('aria-label', label);

  const barFill = document.createElement('div');
  barFill.className = 'chr-progress-fill';
  barFill.style.width = `${String(percent)}%`;

  if (percent >= 90) {
    barFill.classList.add('is-high-occupancy');
  }

  barTrack.append(barFill);
  container.append(barTrack);
  return container;
}

export function createChrWorkspace(
  options: ChrWorkspaceOptions,
): ChrWorkspaceElement {
  const workspace = document.createElement('div');
  workspace.className = 'workspace chr-workspace';

  let diagnostics: HTMLElement | null = null;
  if (options.error !== null && options.error !== undefined) {
    const errorSection = document.createElement('section');
    errorSection.className = 'panel error-panel chr-error-panel';
    const heading = document.createElement('h2');
    heading.textContent = t('errorTitle');
    const message = document.createElement('p');
    message.textContent = t(options.error.key, options.error.variables);
    errorSection.append(heading, message);
    diagnostics = errorSection;
  }

  const metrics = computeMetrics(options);
  const zoom = options.zoom ?? 2;

  // 1. Overview Panel (#section-chr-intro)
  const introPanel = document.createElement('section');
  introPanel.className = 'panel chr-intro-panel';
  introPanel.id = 'section-chr-intro';

  const headerGroup = document.createElement('div');
  headerGroup.className = 'chr-header-group';

  const heading = document.createElement('h2');
  heading.textContent = t('chrWorkspaceTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('chrWorkspaceHint');
  headerGroup.append(heading, hint);

  const baseStatus = document.createElement('div');
  baseStatus.className = 'chr-base-status-badge';
  if (options.baseChr && options.baseChr.length > 0) {
    baseStatus.textContent = t('chrWorkspaceBaseChrLoaded', {
      name: options.baseChrName ?? 'base.chr',
      size: options.baseChr.length,
      slots: options.baseChr.length / 16,
      occupied: metrics.pt0BaseTiles + metrics.pt1BaseTiles,
    });
  } else {
    baseStatus.textContent = t('chrWorkspaceNoBaseChr');
  }

  introPanel.append(headerGroup, baseStatus);

  // 2. Pattern Tables Viewer Panel (#section-chr-viewer)
  const viewerPanel = createViewerPanel(options, metrics, zoom);

  // 3. Physical Occupancy & Pattern Tables Panel (#section-chr-occupancy)
  const occupancyPanel = document.createElement('section');
  occupancyPanel.className = 'panel chr-occupancy-panel';
  occupancyPanel.id = 'section-chr-occupancy';

  const occupancyTitle = document.createElement('h3');
  occupancyTitle.textContent = t('chrWorkspaceOccupancyTitle');

  const totalPercent = Math.round(
    (metrics.totalOccupiedTiles / metrics.physicalCapacityTiles) * 100,
  );
  const totalStats = document.createElement('div');
  totalStats.className = 'chr-total-occupancy-stats';

  const totalLabel = document.createElement('strong');
  totalLabel.className = 'chr-total-occupancy-label';
  totalLabel.textContent = t('chrWorkspaceTotalOccupancy', {
    occupied: metrics.totalOccupiedTiles,
    capacity: metrics.physicalCapacityTiles,
    percent: totalPercent,
  });

  const totalDetails = document.createElement('span');
  totalDetails.className = 'chr-total-occupancy-details muted';
  totalDetails.textContent = `${t('chrWorkspaceFreeTiles', { count: metrics.totalFreeTiles })} · ${t('chrWorkspaceRomSize', { bytes: NES_CHR_ROM_SIZE })}`;

  const totalBar = createProgressBar(
    metrics.totalOccupiedTiles,
    metrics.physicalCapacityTiles,
    t('chrWorkspaceTotalOccupancy', {
      occupied: metrics.totalOccupiedTiles,
      capacity: metrics.physicalCapacityTiles,
      percent: totalPercent,
    }),
  );

  totalStats.append(totalLabel, totalDetails, totalBar);

  // PT0 & PT1 Cards Grid
  const ptGrid = document.createElement('div');
  ptGrid.className = 'chr-pt-grid';

  // PT0 Card
  const pt0Card = document.createElement('div');
  pt0Card.className = 'chr-pt-card';
  const pt0Header = document.createElement('div');
  pt0Header.className = 'chr-pt-card-header';
  const pt0Title = document.createElement('h4');
  pt0Title.textContent = t('chrWorkspacePt0Title');
  const pt0Role = document.createElement('span');
  pt0Role.className = `chr-pt-role-badge${metrics.activeSpritePatternTable === 0 ? ' is-sprite-pt' : ''}`;
  pt0Role.textContent =
    metrics.activeSpritePatternTable === 0
      ? t('chrWorkspacePtRoleSprite')
      : t('chrWorkspacePtRoleBackground');
  pt0Header.append(pt0Title, pt0Role);

  const pt0Stats = document.createElement('p');
  pt0Stats.className = 'chr-pt-card-stats';
  pt0Stats.textContent = `${t('chrWorkspacePtOccupancy', { occupied: metrics.pt0OccupiedTiles })} (${String(NES_PATTERN_TABLE_SIZE)} bytes)`;

  const pt0Bar = createProgressBar(
    metrics.pt0OccupiedTiles,
    NES_PATTERN_TABLE_TILE_COUNT,
    t('chrWorkspacePt0Title'),
  );

  const pt0BaseInfo = document.createElement('span');
  pt0BaseInfo.className = 'chr-pt-base-info muted';
  pt0BaseInfo.textContent = t('chrWorkspacePtBaseCount', {
    count: metrics.pt0BaseTiles,
  });

  pt0Card.append(pt0Header, pt0Stats, pt0Bar, pt0BaseInfo);

  // PT1 Card
  const pt1Card = document.createElement('div');
  pt1Card.className = 'chr-pt-card';
  const pt1Header = document.createElement('div');
  pt1Header.className = 'chr-pt-card-header';
  const pt1Title = document.createElement('h4');
  pt1Title.textContent = t('chrWorkspacePt1Title');
  const pt1Role = document.createElement('span');
  pt1Role.className = `chr-pt-role-badge${metrics.activeSpritePatternTable === 1 ? ' is-sprite-pt' : ''}`;
  pt1Role.textContent =
    metrics.activeSpritePatternTable === 1
      ? t('chrWorkspacePtRoleSprite')
      : t('chrWorkspacePtRoleBackground');
  pt1Header.append(pt1Title, pt1Role);

  const pt1Stats = document.createElement('p');
  pt1Stats.className = 'chr-pt-card-stats';
  pt1Stats.textContent = `${t('chrWorkspacePtOccupancy', { occupied: metrics.pt1OccupiedTiles })} (${String(NES_PATTERN_TABLE_SIZE)} bytes)`;

  const pt1Bar = createProgressBar(
    metrics.pt1OccupiedTiles,
    NES_PATTERN_TABLE_TILE_COUNT,
    t('chrWorkspacePt1Title'),
  );

  const pt1BaseInfo = document.createElement('span');
  pt1BaseInfo.className = 'chr-pt-base-info muted';
  pt1BaseInfo.textContent = t('chrWorkspacePtBaseCount', {
    count: metrics.pt1BaseTiles,
  });

  pt1Card.append(pt1Header, pt1Stats, pt1Bar, pt1BaseInfo);

  ptGrid.append(pt0Card, pt1Card);
  occupancyPanel.append(occupancyTitle, totalStats, ptGrid);

  // 4. Sprite Capacity & OAM Indexes Panel (#section-chr-sprite-context)
  const spriteContextPanel = document.createElement('section');
  spriteContextPanel.className = 'panel chr-sprite-context-panel';
  spriteContextPanel.id = 'section-chr-sprite-context';

  const spriteContextTitle = document.createElement('h3');
  spriteContextTitle.textContent = t('chrWorkspaceSpriteContextTitle');

  const oamExplain = document.createElement('p');
  oamExplain.className = 'chr-oam-explain';
  oamExplain.textContent = t('chrWorkspaceOamIndexExplain');

  const spritePtActiveText = document.createElement('p');
  spritePtActiveText.className = 'chr-sprite-active-pt';
  spritePtActiveText.textContent = t('chrWorkspaceActiveSpritePt', {
    table: metrics.activeSpritePatternTable,
    address: metrics.activeSpritePatternTable === 0 ? '0000' : '1000',
  });

  const spriteCapText = document.createElement('p');
  spriteCapText.className = 'chr-sprite-capacity-stats';
  spriteCapText.textContent = t('chrWorkspaceSpriteCapacity', {
    occupied: metrics.spritePtOccupiedTiles,
    remaining: metrics.spritePtRemainingTiles,
  });

  const spriteBar = createProgressBar(
    metrics.spritePtOccupiedTiles,
    NES_PATTERN_TABLE_TILE_COUNT,
    t('chrWorkspaceSpriteContextTitle'),
  );

  spriteContextPanel.append(
    spriteContextTitle,
    oamExplain,
    spritePtActiveText,
    spriteCapText,
    spriteBar,
  );

  // 5. Tiles & Reuse Breakdown Panel (#section-chr-tiles-reuse)
  const reusePanel = document.createElement('section');
  reusePanel.className = 'panel chr-reuse-panel';
  reusePanel.id = 'section-chr-tiles-reuse';

  const reuseTitle = document.createElement('h3');
  reuseTitle.textContent = t('chrWorkspaceReuseTitle');

  const metricList = document.createElement('dl');
  metricList.className = 'metrics chr-reuse-metrics';

  const addMetric = (label: string, value: string): void => {
    const item = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    item.append(dt, dd);
    metricList.append(item);
  };

  addMetric(
    t('chrWorkspaceBaseTilesCount'),
    String(metrics.reusedDestinationTiles),
  );
  addMetric(
    t('chrWorkspaceReusedTilesCount'),
    String(metrics.reusedImportedTiles),
  );
  addMetric(t('chrWorkspaceNewTilesCount'), String(metrics.newTileCount));
  addMetric(
    t('chrWorkspaceSavedDeduplication'),
    String(metrics.deduplicationSavings),
  );

  reusePanel.append(reuseTitle, metricList);

  // 6. CHR Export & Links Panel (#section-chr-export)
  const exportPanel = document.createElement('section');
  exportPanel.className = 'panel chr-export-panel';
  exportPanel.id = 'section-chr-export';

  const exportHeader = document.createElement('div');
  exportHeader.className = 'chr-export-header';
  const exportTitle = document.createElement('h3');
  exportTitle.textContent = t('chrWorkspaceExportTitle');
  exportHeader.append(exportTitle);

  const actions = document.createElement('div');
  actions.className = 'export-actions';

  if (options.onDownloadBytes) {
    const onDownloadBytes = options.onDownloadBytes;
    const downloadChrBtn = document.createElement('button');
    downloadChrBtn.type = 'button';
    downloadChrBtn.className = 'button primary-button';
    downloadChrBtn.textContent = t('chrWorkspaceDownloadChr');
    downloadChrBtn.addEventListener('click', () => {
      onDownloadBytes(metrics.finalChrBytes, metrics.outputFileName);
    });
    actions.append(downloadChrBtn);
  }

  if (options.onNavigateToWorkspace) {
    const nav = options.onNavigateToWorkspace;
    const gotoAnimBtn = document.createElement('button');
    gotoAnimBtn.type = 'button';
    gotoAnimBtn.className = 'button secondary-button';
    gotoAnimBtn.textContent = t('chrWorkspaceGoToAnimation');
    gotoAnimBtn.addEventListener('click', () => {
      nav('animation');
    });

    const gotoPalettesBtn = document.createElement('button');
    gotoPalettesBtn.type = 'button';
    gotoPalettesBtn.className = 'button secondary-button';
    gotoPalettesBtn.textContent = t('chrWorkspaceGoToPalettes');
    gotoPalettesBtn.addEventListener('click', () => {
      nav('palette');
    });

    actions.append(gotoAnimBtn, gotoPalettesBtn);
  }

  // Contextual Tile Inspector (#section-chr-tile-inspector)
  const tileInspector = createChrTileInspector({
    selectedTileIndex: options.selectedTileIndex ?? null,
    finalChrBytes: metrics.finalChrBytes,
    mode: options.mode,
    animationModel: options.animationModel,
    baseChr: options.baseChr,
    baseChrName: options.baseChrName,
    destinationPatternTable: options.destinationPatternTable,
    tiles: options.tiles,
    onDeselect: () => {
      if (options.onSelectTile) {
        options.onSelectTile(null);
      }
    },
  });

  exportPanel.append(exportHeader, actions);

  workspace.append(
    introPanel,
    viewerPanel,
    tileInspector,
    occupancyPanel,
    spriteContextPanel,
    reusePanel,
    exportPanel,
  );

  const result = workspace as unknown as ChrWorkspaceElement;
  Object.defineProperties(result, {
    diagnosticsElement: {
      value: diagnostics,
      enumerable: true,
    },
    tileInspectorElement: {
      value: tileInspector,
      enumerable: true,
    },
  });
  return result;
}
