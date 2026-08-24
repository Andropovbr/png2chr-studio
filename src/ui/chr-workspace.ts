import type {
  AnimationModel,
  AnimationProjectModel,
} from '../core/animation-model';
import {
  analyzeBaseChrOccupancy,
  classifyChrSlots,
  collectChrHighlightTileIndices,
  buildPhysicalTileReferenceIndex,
  calculateTileUsageDiagnostics,
  calculateChrUsageHeatmapSummary,
  createPatternTableSlots,
  encodePatternTableSlots,
  NES_CHR_ROM_SIZE,
  NES_CHR_ROM_TILE_COUNT,
  NES_PATTERN_TABLE_SIZE,
  NES_PATTERN_TABLE_TILE_COUNT,
  type ChrHeatmapBucket,
  type ChrHighlightScope,
  type ChrSlotClassification,
  type ChrSlotOccupancy,
  type ChrTileUsageDiagnostic,
  type ChrUsageHeatmapSummary,
  type SpritePatternTable,
} from '../core/chr-pattern-table';
import {
  createDefaultNesPaletteSet,
  NES_MASTER_PALETTE,
  type NesPaletteSet,
} from '../core/nes-palette';
import {
  findPaletteDefinition,
  resolveActivePaletteSet,
  type PaletteDefinition,
} from '../core/palette-manager';
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
  readonly playfieldNametable?: Uint8Array | null;
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
  readonly previewPalette?: string;
  readonly onPreviewPaletteChange?: (palette: string) => void;
  readonly highlightScope?: ChrHighlightScope;
  readonly onHighlightScopeChange?: (scope: ChrHighlightScope) => void;
  readonly selectedAnimationId?: string | null;
  readonly onSelectAnimation?: (animationId: string) => void;
  readonly selectedFrameIndex?: number | null;
  readonly onSelectFrame?: (frameIndex: number) => void;
  readonly selectedEntity?: string | null;
  readonly onSelectEntity?: (entity: string) => void;
  readonly heatmapEnabled?: boolean;
  readonly onToggleHeatmap?: (enabled: boolean) => void;
  readonly paletteSet?: NesPaletteSet;
  readonly palettes?: readonly PaletteDefinition[];
  readonly activeSpritePaletteSlots?: readonly (string | null)[];
  readonly loading?: boolean;
  readonly error?: DisplayError | null;
  readonly onNavigateToWorkspace?: (workspace: WorkspaceView) => void;
  readonly onNavigateToAnimation?: (
    animationId: string,
    frameIndex: number,
  ) => void;
  readonly onNavigateToPlayfield?: (column: number, row: number) => void;
  readonly onNavigateToTileset?: (tileIndex: number) => void;
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

export interface ChrPreviewPaletteOption {
  readonly id: string;
  readonly label: string;
  readonly group: 'grayscale' | 'background' | 'sprite' | 'custom';
  readonly colors: readonly {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
  }[];
}

export function resolveChrPreviewPaletteColors(
  previewPaletteId = 'grayscale',
  paletteSet?: NesPaletteSet,
  palettes?: readonly PaletteDefinition[],
  activeSpritePaletteSlots?: readonly (string | null)[],
): readonly {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}[] {
  if (!previewPaletteId || previewPaletteId === 'grayscale') {
    return NEUTRAL_NES_GRAYSCALE;
  }

  const defaultPalettes = paletteSet ?? createDefaultNesPaletteSet();

  if (previewPaletteId.startsWith('bg-')) {
    const bgIndex = parseInt(previewPaletteId.slice(3), 10);
    if (!Number.isNaN(bgIndex) && bgIndex >= 0 && bgIndex < 4) {
      const palette = defaultPalettes[bgIndex];
      if (palette) {
        return palette.map(
          (code) => NES_MASTER_PALETTE[code] ?? { red: 0, green: 0, blue: 0 },
        );
      }
    }
    return NEUTRAL_NES_GRAYSCALE;
  }

  if (previewPaletteId.startsWith('sp-')) {
    const spIndex = parseInt(previewPaletteId.slice(3), 10);
    if (!Number.isNaN(spIndex) && spIndex >= 0 && spIndex < 4) {
      const slotPalId = activeSpritePaletteSlots?.[spIndex];
      const def = findPaletteDefinition(palettes, slotPalId);
      if (def) {
        return def.colors.map(
          (code) => NES_MASTER_PALETTE[code] ?? { red: 0, green: 0, blue: 0 },
        );
      }
      const activeSet = resolveActivePaletteSet(
        palettes ?? [],
        activeSpritePaletteSlots ?? [],
        defaultPalettes,
      );
      const slotPal = activeSet[spIndex];
      if (slotPal) {
        return slotPal.map(
          (code) => NES_MASTER_PALETTE[code] ?? { red: 0, green: 0, blue: 0 },
        );
      }
    }
    return NEUTRAL_NES_GRAYSCALE;
  }

  // Check if previewPaletteId matches a specific palette definition ID
  const def = findPaletteDefinition(palettes, previewPaletteId);
  if (def) {
    return def.colors.map(
      (code) => NES_MASTER_PALETTE[code] ?? { red: 0, green: 0, blue: 0 },
    );
  }

  return NEUTRAL_NES_GRAYSCALE;
}

export function getChrPreviewPaletteOptions(
  paletteSet?: NesPaletteSet,
  palettes?: readonly PaletteDefinition[],
  activeSpritePaletteSlots?: readonly (string | null)[],
): readonly ChrPreviewPaletteOption[] {
  const options: ChrPreviewPaletteOption[] = [
    {
      id: 'grayscale',
      label: t('chrWorkspacePaletteGrayscale'),
      group: 'grayscale',
      colors: NEUTRAL_NES_GRAYSCALE,
    },
  ];

  const defaultPalettes = paletteSet ?? createDefaultNesPaletteSet();

  // Background Palettes (BG 0..3)
  for (let i = 0; i < 4; i += 1) {
    const bgCodes = defaultPalettes[i];
    const bgColors = bgCodes
      ? bgCodes.map(
          (code) => NES_MASTER_PALETTE[code] ?? { red: 0, green: 0, blue: 0 },
        )
      : NEUTRAL_NES_GRAYSCALE;

    options.push({
      id: `bg-${String(i)}`,
      label: t('chrWorkspacePaletteBg', { index: i }),
      group: 'background',
      colors: bgColors,
    });
  }

  // Sprite Palettes (SP 0..3)
  for (let i = 0; i < 4; i += 1) {
    const slotPalId = activeSpritePaletteSlots?.[i];
    const def = findPaletteDefinition(palettes, slotPalId);
    const spLabel = def
      ? `${t('chrWorkspacePaletteSp', { index: i })}: ${def.name}`
      : t('chrWorkspacePaletteSp', { index: i });

    const spColors = resolveChrPreviewPaletteColors(
      `sp-${String(i)}`,
      paletteSet,
      palettes,
      activeSpritePaletteSlots,
    );

    options.push({
      id: `sp-${String(i)}`,
      label: spLabel,
      group: 'sprite',
      colors: spColors,
    });
  }

  // Custom Palettes (if any palette definitions in `palettes` are not assigned to active slots)
  const activeIds = new Set(
    (activeSpritePaletteSlots ?? []).filter((id): id is string => Boolean(id)),
  );
  (palettes ?? []).forEach((pal) => {
    if (!activeIds.has(pal.id)) {
      options.push({
        id: pal.id,
        label: pal.name,
        group: 'custom',
        colors: pal.colors.map(
          (code) => NES_MASTER_PALETTE[code] ?? { red: 0, green: 0, blue: 0 },
        ),
      });
    }
  });

  return options;
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

function getBucketLabelKey(bucket: ChrHeatmapBucket): string {
  switch (bucket) {
    case 'unused':
      return 'chrWorkspaceHeatmapBucketUnused';
    case 'single':
      return 'chrWorkspaceHeatmapBucketSingle';
    case 'moderate':
      return 'chrWorkspaceHeatmapBucketModerate';
    case 'high':
      return 'chrWorkspaceHeatmapBucketHigh';
    case 'very-high':
      return 'chrWorkspaceHeatmapBucketVeryHigh';
  }
}

function createPatternTableView(
  patternTable: SpritePatternTable,
  finalChrBytes: Uint8Array,
  activeSpritePatternTable: SpritePatternTable,
  zoom: number,
  selectedTileIndex: number | null,
  previewColors: readonly {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
  }[],
  classifications: readonly ChrSlotClassification[],
  highlightedIndices: ReadonlySet<number>,
  highlightScope: ChrHighlightScope,
  highlightScopeLabel: string,
  usageDiagnostics: readonly ChrTileUsageDiagnostic[],
  heatmapEnabled: boolean,
  onSelectTile?: (tileIndex: number | null) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'chr-pt-view-card';
  card.setAttribute('data-pattern-table', String(patternTable));

  // Calculate PT-specific occupancy metrics from classifications
  const startPhysical = patternTable * NES_PATTERN_TABLE_TILE_COUNT;
  const ptClassifications = classifications.slice(
    startPhysical,
    startPhysical + NES_PATTERN_TABLE_TILE_COUNT,
  );
  const occupiedCount = ptClassifications.filter(
    (c) => c.occupancy !== 'empty',
  ).length;
  const freeCount = NES_PATTERN_TABLE_TILE_COUNT - occupiedCount;
  const ptRange = patternTable === 0 ? '$0000..$0FFF' : '$1000..$1FFF';

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
  subtitle.textContent = t('chrWorkspacePtUtilization', {
    range: ptRange,
    occupied: occupiedCount,
    free: freeCount,
  });

  titleGroup.append(title, subtitle);

  const headerBadges = document.createElement('div');
  headerBadges.className = 'chr-pt-header-badges';

  const occupancyBadge = document.createElement('span');
  occupancyBadge.className = `chr-pt-occupancy-badge${occupiedCount === NES_PATTERN_TABLE_TILE_COUNT ? ' is-full' : ''}`;
  occupancyBadge.textContent = `${String(occupiedCount)} / ${String(NES_PATTERN_TABLE_TILE_COUNT)}`;
  occupancyBadge.title = t('chrWorkspacePtOccupancy', {
    occupied: occupiedCount,
  });

  const role = document.createElement('span');
  const isSprite = activeSpritePatternTable === patternTable;
  role.className = `chr-pt-role-badge${isSprite ? ' is-sprite-pt' : ''}`;
  role.textContent = isSprite
    ? t('chrWorkspacePtRoleSprite')
    : t('chrWorkspacePtRoleBackground');

  headerBadges.append(occupancyBadge, role);
  header.append(titleGroup, headerBadges);

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

  renderPatternTableToCanvas(
    canvas,
    finalChrBytes,
    patternTable,
    previewColors,
  );

  const hasActiveHighlight =
    highlightScope !== 'none' && highlightedIndices.size > 0;

  const gridOverlay = document.createElement('div');
  let gridOverlayClass = 'chr-pt-grid-overlay';
  if (hasActiveHighlight) gridOverlayClass += ' has-highlight';
  if (heatmapEnabled) gridOverlayClass += ' has-heatmap';
  gridOverlay.className = gridOverlayClass;
  gridOverlay.setAttribute('role', 'grid');
  gridOverlay.setAttribute(
    'aria-label',
    patternTable === 0 ? t('chrWorkspacePt0Title') : t('chrWorkspacePt1Title'),
  );

  for (
    let localIndex = 0;
    localIndex < NES_PATTERN_TABLE_TILE_COUNT;
    localIndex += 1
  ) {
    const physicalIndex = startPhysical + localIndex;
    const isSlotSelected = selectedTileIndex === physicalIndex;
    const isHighlighted = highlightedIndices.has(physicalIndex);
    const isDimmed = hasActiveHighlight && !isHighlighted;
    const row = Math.floor(localIndex / 16);
    const col = localIndex % 16;
    const hexLocal = localIndex.toString(16).toUpperCase().padStart(2, '0');
    const addrHex = (patternTable * 0x1000 + localIndex * 16)
      .toString(16)
      .toUpperCase()
      .padStart(4, '0');

    const classification = classifications[physicalIndex] ?? {
      occupancy: 'empty',
    };
    const occupancy = classification.occupancy;
    let occupancyLabel = t('chrWorkspaceSlotOccupancyEmpty');
    if (occupancy === 'project') {
      occupancyLabel = t('chrWorkspaceSlotOccupancyProject');
    } else if (occupancy === 'base') {
      occupancyLabel = t('chrWorkspaceSlotOccupancyBase');
    } else if (occupancy === 'reserved') {
      occupancyLabel = t('chrWorkspaceSlotOccupancyReserved');
    }

    const diag = usageDiagnostics[physicalIndex];
    const bucket = diag?.bucket ?? 'unused';
    const refCount = diag?.referenceCount ?? 0;

    let slotClass = `chr-tile-slot is-occupancy-${occupancy}`;
    if (isHighlighted) slotClass += ' is-highlighted';
    if (isDimmed) slotClass += ' is-dimmed';
    if (isSlotSelected) slotClass += ' is-selected';

    const slot = document.createElement('div');
    slot.className = slotClass;
    slot.tabIndex = 0;
    slot.setAttribute('data-physical-index', String(physicalIndex));
    slot.setAttribute('data-local-index', String(localIndex));
    slot.setAttribute('data-pattern-table', String(patternTable));
    slot.setAttribute('data-occupancy', occupancy);
    slot.setAttribute('data-heatmap-bucket', bucket);
    slot.setAttribute('data-ref-count', String(refCount));
    slot.setAttribute('data-highlighted', isHighlighted ? 'true' : 'false');
    slot.setAttribute('data-row', String(row));
    slot.setAttribute('data-col', String(col));
    slot.setAttribute('role', 'gridcell');
    slot.setAttribute('aria-selected', String(isSlotSelected));

    const stateAndHighlight = isHighlighted
      ? `${occupancyLabel} · ${t('chrWorkspaceSlotHighlighted', { scope: highlightScopeLabel })}`
      : occupancyLabel;

    const bucketKey = getBucketLabelKey(bucket) as
      | 'chrWorkspaceHeatmapBucketUnused'
      | 'chrWorkspaceHeatmapBucketSingle'
      | 'chrWorkspaceHeatmapBucketModerate'
      | 'chrWorkspaceHeatmapBucketHigh'
      | 'chrWorkspaceHeatmapBucketVeryHigh';
    const bucketText = t(bucketKey);

    if (heatmapEnabled) {
      if (refCount > 0) {
        const countBadge = document.createElement('span');
        countBadge.className = `chr-slot-ref-badge bucket-${bucket}`;
        countBadge.textContent = refCount >= 100 ? '99+' : String(refCount);
        countBadge.setAttribute('aria-hidden', 'true');
        slot.append(countBadge);
      }

      slot.setAttribute(
        'aria-label',
        t('chrWorkspaceTileHeatmapAriaLabel', {
          pt: patternTable,
          hex: hexLocal,
          id: physicalIndex,
          state: stateAndHighlight,
          refs: refCount,
          bucket: bucketText,
        }),
      );
      slot.title = t('chrWorkspaceTileHeatmapTooltip', {
        pt: patternTable,
        hex: hexLocal,
        id: physicalIndex,
        state: stateAndHighlight,
        refs: refCount,
        bucket: bucketText,
        addr: addrHex,
      });
    } else {
      slot.setAttribute(
        'aria-label',
        t('chrWorkspaceTileAriaLabel', {
          pt: patternTable,
          hex: hexLocal,
          id: physicalIndex,
          state: stateAndHighlight,
        }),
      );
      slot.title = t('chrWorkspaceTileTooltip', {
        pt: patternTable,
        hex: hexLocal,
        id: physicalIndex,
        state: stateAndHighlight,
        addr: addrHex,
      });
    }

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

function resolveAnimationEntityName(
  selectedEntity?: string | null,
  animation?: { readonly name: string; readonly entity?: string } | null,
): string | null {
  const custom = selectedEntity?.trim();
  if (custom && custom.length > 0) return custom;
  const animEntity = animation?.entity?.trim();
  if (animEntity && animEntity.length > 0) return animEntity;
  if (animation?.name.includes('_')) {
    const prefix = animation.name.split('_')[0]?.trim();
    if (prefix && prefix.length > 0) return prefix;
  }
  return null;
}
function createViewerPanel(
  options: ChrWorkspaceOptions,
  metrics: ComputedChrMetrics,
  zoom: number,
  previewColors: readonly {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
  }[],
  classifications: readonly ChrSlotClassification[],
  highlightedIndices: ReadonlySet<number>,
  highlightScope: ChrHighlightScope,
  highlightScopeLabel: string,
  targetAnim: AnimationModel | null,
  activeFrameIndex: number,
  activeEntity: string | null,
  uniqueEntities: readonly string[],
  usageDiagnostics: readonly ChrTileUsageDiagnostic[],
  heatmapSummary: ChrUsageHeatmapSummary,
  heatmapEnabled: boolean,
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

  // Controls container (Palette + Highlight + Heatmap + Legend + Zoom)
  const toolbarControls = document.createElement('div');
  toolbarControls.className = 'chr-viewer-toolbar-controls';

  // Palette selector
  const paletteControls = document.createElement('div');
  paletteControls.className = 'chr-palette-controls';

  const paletteLabel = document.createElement('label');
  paletteLabel.className = 'chr-palette-label';
  paletteLabel.textContent = t('chrWorkspacePaletteLabel');
  paletteLabel.htmlFor = 'chr-palette-select-input';

  const paletteSelect = document.createElement('select');
  paletteSelect.id = 'chr-palette-select-input';
  paletteSelect.className = 'chr-palette-select';
  paletteSelect.setAttribute('aria-label', t('chrWorkspacePaletteLabel'));

  const paletteOptions = getChrPreviewPaletteOptions(
    options.paletteSet,
    options.palettes,
    options.activeSpritePaletteSlots,
  );
  const selectedPaletteId = options.previewPalette ?? 'grayscale';

  const groupMap = new Map<string, HTMLOptGroupElement>();
  const getOptGroup = (
    groupKey: string,
    groupLabel: string,
  ): HTMLOptGroupElement => {
    let groupEl = groupMap.get(groupKey);
    if (!groupEl) {
      groupEl = document.createElement('optgroup');
      groupEl.label = groupLabel;
      groupMap.set(groupKey, groupEl);
      paletteSelect.append(groupEl);
    }
    return groupEl;
  };

  paletteOptions.forEach((opt) => {
    const optEl = document.createElement('option');
    optEl.value = opt.id;
    optEl.textContent = opt.label;
    if (opt.id === selectedPaletteId) {
      optEl.selected = true;
    }

    if (opt.group === 'grayscale') {
      paletteSelect.append(optEl);
    } else if (opt.group === 'background') {
      const groupEl = getOptGroup(
        'background',
        t('chrWorkspacePaletteGroupBg'),
      );
      groupEl.append(optEl);
    } else if (opt.group === 'sprite') {
      const groupEl = getOptGroup('sprite', t('chrWorkspacePaletteGroupSp'));
      groupEl.append(optEl);
    } else {
      const groupEl = getOptGroup(
        'custom',
        t('chrWorkspacePaletteCustomGroup'),
      );
      groupEl.append(optEl);
    }
  });

  paletteSelect.addEventListener('change', () => {
    if (options.onPreviewPaletteChange) {
      options.onPreviewPaletteChange(paletteSelect.value);
    }
  });

  const swatches = document.createElement('div');
  swatches.className = 'chr-palette-swatches';
  swatches.setAttribute('aria-hidden', 'true');
  previewColors.forEach((col) => {
    const swatch = document.createElement('span');
    swatch.className = 'chr-palette-swatch';
    swatch.style.backgroundColor = `rgb(${String(col.red)}, ${String(col.green)}, ${String(col.blue)})`;
    swatches.append(swatch);
  });

  paletteControls.append(paletteLabel, paletteSelect, swatches);

  // Highlight controls
  const highlightControls = document.createElement('div');
  highlightControls.className = 'chr-highlight-controls';

  const highlightLabel = document.createElement('label');
  highlightLabel.className = 'chr-highlight-label';
  highlightLabel.textContent = t('chrWorkspaceHighlightLabel');
  highlightLabel.htmlFor = 'chr-highlight-select-input';

  const highlightSelect = document.createElement('select');
  highlightSelect.id = 'chr-highlight-select-input';
  highlightSelect.className = 'chr-highlight-select';
  highlightSelect.setAttribute('aria-label', t('chrWorkspaceHighlightLabel'));

  const scopes: readonly {
    readonly scope: ChrHighlightScope;
    readonly label: string;
  }[] = [
    { scope: 'none', label: t('chrWorkspaceHighlightScopeNone') },
    ...(options.mode === 'animation'
      ? ([
          {
            scope: 'frame',
            label: t('chrWorkspaceHighlightScopeFrame', {
              info: `#${String(activeFrameIndex)}`,
            }),
          },
          {
            scope: 'animation',
            label: t('chrWorkspaceHighlightScopeAnimation', {
              name: targetAnim?.name ?? 'Active',
            }),
          },
          ...(uniqueEntities.length > 0
            ? [
                {
                  scope: 'entity' as const,
                  label: t('chrWorkspaceHighlightScopeEntity', {
                    name: activeEntity ?? 'Entity',
                  }),
                },
              ]
            : []),
        ] as const)
      : []),
    ...(options.baseChr
      ? [{ scope: 'base' as const, label: t('chrWorkspaceHighlightScopeBase') }]
      : []),
    { scope: 'all', label: t('chrWorkspaceHighlightScopeAll') },
  ];

  scopes.forEach((s) => {
    const optionEl = document.createElement('option');
    optionEl.value = s.scope;
    optionEl.textContent = s.label;
    if (s.scope === highlightScope) {
      optionEl.selected = true;
    }
    highlightSelect.append(optionEl);
  });

  highlightSelect.addEventListener('change', () => {
    if (options.onHighlightScopeChange) {
      options.onHighlightScopeChange(
        highlightSelect.value as ChrHighlightScope,
      );
    }
  });

  highlightControls.append(highlightLabel, highlightSelect);
  // Sub-selectors when animation scope is active
  if (
    options.mode === 'animation' &&
    options.animationModel &&
    options.animationModel.animations.length > 0
  ) {
    if (highlightScope === 'frame' || highlightScope === 'animation') {
      const animSelect = document.createElement('select');
      animSelect.className = 'chr-highlight-anim-select';
      animSelect.setAttribute(
        'aria-label',
        t('chrWorkspaceHighlightAnimLabel'),
      );

      for (const anim of options.animationModel.animations) {
        const opt = document.createElement('option');
        opt.value = anim.id ?? anim.name;
        opt.textContent = anim.name;
        if (
          (targetAnim?.id && anim.id === targetAnim.id) ||
          anim.name === targetAnim?.name
        ) {
          opt.selected = true;
        }
        animSelect.append(opt);
      }

      animSelect.addEventListener('change', () => {
        if (options.onSelectAnimation) {
          options.onSelectAnimation(animSelect.value);
        }
      });

      highlightControls.append(animSelect);
    }

    if (
      highlightScope === 'frame' &&
      targetAnim &&
      targetAnim.frames.length > 0
    ) {
      const frameSelect = document.createElement('select');
      frameSelect.className = 'chr-highlight-frame-select';
      frameSelect.setAttribute(
        'aria-label',
        t('chrWorkspaceHighlightFrameLabel'),
      );

      targetAnim.frames.forEach((_, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = t('chrWorkspaceHighlightFrameOption', { index: idx });
        if (idx === activeFrameIndex) {
          opt.selected = true;
        }
        frameSelect.append(opt);
      });

      frameSelect.addEventListener('change', () => {
        if (options.onSelectFrame) {
          options.onSelectFrame(Number(frameSelect.value));
        }
      });

      highlightControls.append(frameSelect);
    }

    if (highlightScope === 'entity' && uniqueEntities.length > 1) {
      const entitySelect = document.createElement('select');
      entitySelect.className = 'chr-highlight-entity-select';
      entitySelect.setAttribute(
        'aria-label',
        t('chrWorkspaceHighlightEntityLabel'),
      );
      uniqueEntities.forEach((ent) => {
        const optionEl = document.createElement('option');
        optionEl.value = ent;
        optionEl.textContent = ent;
        if (ent === activeEntity) {
          optionEl.selected = true;
        }
        entitySelect.append(optionEl);
      });
      entitySelect.addEventListener('change', () => {
        if (options.onSelectEntity) {
          options.onSelectEntity(entitySelect.value);
        }
      });
      highlightControls.append(entitySelect);
    }
  }

  // Highlight Summary Badge (when highlighting is active)
  if (highlightScope !== 'none' && highlightedIndices.size > 0) {
    let pt0Count = 0;
    let pt1Count = 0;
    highlightedIndices.forEach((idx) => {
      if (idx < NES_PATTERN_TABLE_TILE_COUNT) {
        pt0Count += 1;
      } else {
        pt1Count += 1;
      }
    });
    const summaryBadge = document.createElement('span');
    summaryBadge.className = 'chr-highlight-summary';
    const totalCount = highlightedIndices.size;
    summaryBadge.textContent =
      totalCount === 1
        ? t('chrWorkspaceHighlightSummarySingle', {
            count: totalCount,
            pt0: pt0Count,
            pt1: pt1Count,
          })
        : t('chrWorkspaceHighlightSummary', {
            count: totalCount,
            pt0: pt0Count,
            pt1: pt1Count,
          });
    highlightControls.append(summaryBadge);
  }

  // Heatmap View Controls
  const heatmapControls = document.createElement('div');
  heatmapControls.className = 'chr-heatmap-controls';

  const heatmapLabel = document.createElement('span');
  heatmapLabel.className = 'chr-heatmap-label';
  heatmapLabel.textContent = t('chrWorkspaceHeatmapLabel');

  const heatmapSegmented = document.createElement('div');
  heatmapSegmented.className = 'segmented-control chr-heatmap-segmented';
  heatmapSegmented.setAttribute('role', 'group');
  heatmapSegmented.setAttribute('aria-label', t('chrWorkspaceHeatmapToggle'));

  const normalBtn = document.createElement('button');
  normalBtn.type = 'button';
  normalBtn.className = `segmented-button${!heatmapEnabled ? ' is-active' : ''}`;
  normalBtn.setAttribute('aria-pressed', String(!heatmapEnabled));
  normalBtn.textContent = t('chrWorkspaceHeatmapOff');
  normalBtn.addEventListener('click', () => {
    if (heatmapEnabled && options.onToggleHeatmap) {
      options.onToggleHeatmap(false);
    }
  });

  const heatmapBtn = document.createElement('button');
  heatmapBtn.type = 'button';
  heatmapBtn.className = `segmented-button${heatmapEnabled ? ' is-active' : ''}`;
  heatmapBtn.setAttribute('aria-pressed', String(heatmapEnabled));
  heatmapBtn.textContent = t('chrWorkspaceHeatmapOn');
  heatmapBtn.addEventListener('click', () => {
    if (!heatmapEnabled && options.onToggleHeatmap) {
      options.onToggleHeatmap(true);
    }
  });

  heatmapSegmented.append(normalBtn, heatmapBtn);
  heatmapControls.append(heatmapLabel, heatmapSegmented);

  // Occupancy / Heatmap Legend
  const legend = document.createElement('div');
  legend.className = 'chr-occupancy-legend';
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', t('chrWorkspaceLegendTitle'));

  const legendItems: readonly { key: ChrSlotOccupancy; label: string }[] = [
    { key: 'project', label: t('chrWorkspaceLegendProject') },
    { key: 'base', label: t('chrWorkspaceLegendBase') },
    { key: 'empty', label: t('chrWorkspaceLegendEmpty') },
  ];

  legendItems.forEach((item) => {
    const itemEl = document.createElement('span');
    itemEl.className = `chr-legend-item is-${item.key}`;
    const indicator = document.createElement('span');
    indicator.className = 'chr-legend-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'chr-legend-label';
    label.textContent = item.label;
    itemEl.append(indicator, label);
    legend.append(itemEl);
  });

  let activeLegend: HTMLElement = legend;
  if (heatmapEnabled) {
    const heatmapLegend = document.createElement('div');
    heatmapLegend.className = 'chr-heatmap-legend';
    heatmapLegend.setAttribute('role', 'group');
    heatmapLegend.setAttribute(
      'aria-label',
      t('chrWorkspaceHeatmapLegendTitle'),
    );

    const buckets: readonly { key: ChrHeatmapBucket; label: string }[] = [
      { key: 'unused', label: t('chrWorkspaceHeatmapBucketUnused') },
      { key: 'single', label: t('chrWorkspaceHeatmapBucketSingle') },
      { key: 'moderate', label: t('chrWorkspaceHeatmapBucketModerate') },
      { key: 'high', label: t('chrWorkspaceHeatmapBucketHigh') },
      { key: 'very-high', label: t('chrWorkspaceHeatmapBucketVeryHigh') },
    ];

    buckets.forEach((b) => {
      const itemEl = document.createElement('span');
      itemEl.className = `chr-heatmap-legend-item is-${b.key}`;

      const indicator = document.createElement('span');
      indicator.className = 'chr-heatmap-legend-indicator';
      indicator.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'chr-heatmap-legend-label';
      label.textContent = b.label;

      itemEl.append(indicator, label);
      heatmapLegend.append(itemEl);
    });
    activeLegend = heatmapLegend;
  }

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

  toolbarControls.append(
    paletteControls,
    highlightControls,
    heatmapControls,
    activeLegend,
    zoomControls,
  );
  toolbar.append(titleGroup, toolbarControls);

  const ptContainer = document.createElement('div');
  ptContainer.className = 'chr-pattern-tables-container';

  const selectedTileIndex = options.selectedTileIndex ?? null;

  const pt0Card = createPatternTableView(
    0,
    metrics.finalChrBytes,
    metrics.activeSpritePatternTable,
    zoom,
    selectedTileIndex,
    previewColors,
    classifications,
    highlightedIndices,
    highlightScope,
    highlightScopeLabel,
    usageDiagnostics,
    heatmapEnabled,
    options.onSelectTile,
  );
  const pt1Card = createPatternTableView(
    1,
    metrics.finalChrBytes,
    metrics.activeSpritePatternTable,
    zoom,
    selectedTileIndex,
    previewColors,
    classifications,
    highlightedIndices,
    highlightScope,
    highlightScopeLabel,
    usageDiagnostics,
    heatmapEnabled,
    options.onSelectTile,
  );

  ptContainer.append(pt0Card, pt1Card);

  if (heatmapEnabled) {
    const summaryBar = document.createElement('div');
    summaryBar.className = 'chr-heatmap-summary-bar';
    const maxHex =
      heatmapSummary.mostReferencedTileIndex !== null
        ? heatmapSummary.mostReferencedTileIndex
            .toString(16)
            .toUpperCase()
            .padStart(2, '0')
        : '—';
    summaryBar.textContent = t('chrWorkspaceHeatmapSummaryBar', {
      referenced: heatmapSummary.referencedTileCount,
      occupied: metrics.totalOccupiedTiles,
      reused: heatmapSummary.reusedTileCount,
      unreferenced: heatmapSummary.unreferencedOccupiedTileCount,
      maxHex,
      maxRefs: heatmapSummary.maxReferenceCount,
      ratio: heatmapSummary.averageReuseRatio,
    });
    viewerPanel.append(toolbar, summaryBar, ptContainer);
  } else {
    viewerPanel.append(toolbar, ptContainer);
  }

  return viewerPanel;
}

function createProgressBar(
  value: number,
  max: number,
  label: string,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'progress-bar-container';

  const track = document.createElement('div');
  track.className = 'progress-bar-track';

  const fill = document.createElement('div');
  fill.className = 'progress-bar-fill';
  const percentage = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  fill.style.width = `${percentage.toFixed(1)}%`;

  track.append(fill);
  container.append(track);

  container.setAttribute('role', 'progressbar');
  container.setAttribute('aria-valuenow', String(value));
  container.setAttribute('aria-valuemin', '0');
  container.setAttribute('aria-valuemax', String(max));
  container.setAttribute('aria-label', label);

  return container;
}

export function createChrWorkspace(
  options: ChrWorkspaceOptions,
): ChrWorkspaceElement {
  const workspace = document.createElement('div');
  workspace.className = 'chr-workspace';
  let diagnostics: HTMLElement | null = null;
  if (options.loading) {
    diagnostics = document.createElement('div');
    diagnostics.className = 'loading-banner';
    diagnostics.textContent = t('loadingStatus');
    workspace.append(diagnostics);
  } else if (options.error) {
    diagnostics = document.createElement('div');
    diagnostics.className = 'error-banner';
    diagnostics.textContent = t(options.error.key, options.error.variables);
    workspace.append(diagnostics);
  }

  const metrics = computeMetrics(options);
  const zoom = options.zoom ?? 2;
  const highlightScope = options.highlightScope ?? 'none';
  const heatmapEnabled = options.heatmapEnabled ?? false;

  // Resolve palette colors for rendering preview
  const previewColors = resolveChrPreviewPaletteColors(
    options.previewPalette,
    options.paletteSet,
    options.palettes,
    options.activeSpritePaletteSlots,
  );

  // Compute classifications for all 512 physical slots
  const classifications = classifyChrSlots({
    finalChrBytes: metrics.finalChrBytes,
    mode: options.mode,
    animationModel: options.animationModel,
    baseChr: options.baseChr,
    destinationPatternTable: options.destinationPatternTable,
    tiles: options.tiles,
    deduplicationEnabled: options.deduplicationEnabled,
    flipDeduplicationEnabled: options.flipDeduplicationEnabled,
  });

  // Calculate pre-indexed physical tile references & usage diagnostics
  const referenceIndex = buildPhysicalTileReferenceIndex({
    mode: options.mode,
    animationModel: options.animationModel,
    playfieldNametable: options.playfieldNametable,
    destinationPatternTable: options.destinationPatternTable,
    tiles: options.tiles,
    deduplicationEnabled: options.deduplicationEnabled,
    flipDeduplicationEnabled: options.flipDeduplicationEnabled,
  });

  const usageDiagnostics = calculateTileUsageDiagnostics({
    referenceIndex,
  });

  const heatmapSummary = calculateChrUsageHeatmapSummary(
    usageDiagnostics,
    classifications,
  );

  // 1. Introduction Panel (#section-chr-intro)
  const introPanel = document.createElement('section');
  introPanel.className = 'panel chr-intro-panel';
  introPanel.id = 'section-chr-intro';

  const headerGroup = document.createElement('div');
  headerGroup.className = 'chr-header-group';

  const introTitle = document.createElement('h2');
  introTitle.textContent = t('chrWorkspaceTitle');

  const introHint = document.createElement('p');
  introHint.className = 'muted';
  introHint.textContent = t('chrWorkspaceHint');

  headerGroup.append(introTitle, introHint);

  const baseStatusBadge = document.createElement('div');
  baseStatusBadge.className = 'chr-base-status-badge';
  if (options.baseChr) {
    const baseOccupancy = analyzeBaseChrOccupancy(options.baseChr);
    baseStatusBadge.textContent = t('chrWorkspaceBaseChrLoaded', {
      name: options.baseChrName ?? 'base.chr',
      size: options.baseChr.length,
      slots: baseOccupancy.fileTileSlots,
      occupied: baseOccupancy.occupiedTiles,
    });
  } else {
    baseStatusBadge.textContent = t('chrWorkspaceNoBaseChr');
  }

  introPanel.append(headerGroup, baseStatusBadge);

  // Animation contextual targeting
  const animList = options.animationModel?.animations ?? [];
  const targetAnim =
    options.selectedAnimationId !== null &&
    options.selectedAnimationId !== undefined
      ? (animList.find((a) => a.id === options.selectedAnimationId) ??
        animList[0] ??
        null)
      : (animList[0] ?? null);

  const activeFrameIndex = Math.max(0, options.selectedFrameIndex ?? 0);
  const activeEntity = resolveAnimationEntityName(
    options.selectedEntity,
    targetAnim,
  );

  const uniqueEntities = Array.from(
    new Set(
      animList
        .map((a) => resolveAnimationEntityName(null, a))
        .filter((ent): ent is string => ent !== null && ent.length > 0),
    ),
  );

  // Collect highlighted indices
  const highlightedIndices = collectChrHighlightTileIndices({
    scope: highlightScope,
    mode: options.mode,
    animationModel: options.animationModel,
    selectedAnimationId: targetAnim?.id ?? null,
    selectedFrameIndex: activeFrameIndex,
    selectedEntity: activeEntity,
    classifications,
  });

  let highlightScopeLabel = t('chrWorkspaceHighlightScopeNone');
  if (highlightScope === 'frame') {
    highlightScopeLabel = t('chrWorkspaceHighlightScopeFrame', {
      info: `#${String(activeFrameIndex)}`,
    });
  } else if (highlightScope === 'animation') {
    highlightScopeLabel = t('chrWorkspaceHighlightScopeAnimation', {
      name: targetAnim?.name ?? 'Active',
    });
  } else if (highlightScope === 'entity') {
    highlightScopeLabel = t('chrWorkspaceHighlightScopeEntity', {
      name: activeEntity ?? 'Entity',
    });
  } else if (highlightScope === 'base') {
    highlightScopeLabel = t('chrWorkspaceHighlightScopeBase');
  } else if (highlightScope === 'all') {
    highlightScopeLabel = t('chrWorkspaceHighlightScopeAll');
  }

  // 2. Pattern Tables Viewer Panel (#section-chr-viewer)
  const viewerPanel = createViewerPanel(
    options,
    metrics,
    zoom,
    previewColors,
    classifications,
    highlightedIndices,
    highlightScope,
    highlightScopeLabel,
    targetAnim,
    activeFrameIndex,
    activeEntity,
    uniqueEntities,
    usageDiagnostics,
    heatmapSummary,
    heatmapEnabled,
  );

  // Contextual Tile Inspector (#section-chr-tile-inspector)
  const isSelectedTileHighlighted =
    options.selectedTileIndex !== null &&
    options.selectedTileIndex !== undefined &&
    highlightedIndices.has(options.selectedTileIndex);

  const selectedReferences =
    options.selectedTileIndex !== null &&
    options.selectedTileIndex !== undefined
      ? (referenceIndex.get(options.selectedTileIndex) ?? [])
      : [];

  const selectedDiagnostic =
    options.selectedTileIndex !== null &&
    options.selectedTileIndex !== undefined
      ? (usageDiagnostics[options.selectedTileIndex] ?? null)
      : null;

  const tileInspector = createChrTileInspector({
    selectedTileIndex: options.selectedTileIndex ?? null,
    finalChrBytes: metrics.finalChrBytes,
    mode: options.mode,
    animationModel: options.animationModel,
    baseChr: options.baseChr,
    baseChrName: options.baseChrName,
    destinationPatternTable: options.destinationPatternTable,
    tiles: options.tiles,
    colors: previewColors,
    isHighlighted: isSelectedTileHighlighted,
    highlightScopeLabel: highlightScope !== 'none' ? highlightScopeLabel : null,
    references: selectedReferences,
    diagnostic: selectedDiagnostic,
    heatmapEnabled,
    onNavigateToReference: (ref) => {
      if (ref.type === 'animation') {
        if (options.onNavigateToAnimation) {
          options.onNavigateToAnimation(ref.animationId, ref.frameIndex);
        } else if (options.onNavigateToWorkspace) {
          options.onNavigateToWorkspace('animation');
        }
      } else if (ref.type === 'playfield') {
        if (options.onNavigateToPlayfield) {
          options.onNavigateToPlayfield(ref.column, ref.row);
        } else if (options.onNavigateToWorkspace) {
          options.onNavigateToWorkspace('playfield');
        }
      } else {
        if (options.onNavigateToTileset) {
          options.onNavigateToTileset(ref.tileIndex);
        } else if (options.onNavigateToWorkspace) {
          options.onNavigateToWorkspace('tileset');
        }
      }
    },
    onDeselect: () => {
      if (options.onSelectTile) {
        options.onSelectTile(null);
      }
    },
  });

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

  // Auto-focus / visibility scroll for selected slot
  if (
    options.selectedTileIndex !== null &&
    options.selectedTileIndex !== undefined
  ) {
    const slotEl = viewerPanel.querySelector(
      `[data-physical-index="${String(options.selectedTileIndex)}"]`,
    );
    if (slotEl && typeof slotEl.scrollIntoView === 'function') {
      slotEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

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
