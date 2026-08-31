import type {
  AnimationModel,
  AnimationProjectModel,
} from '../core/animation-model';
import {
  analyzeBaseChrOccupancy,
  buildChrSlotRegionIndex,
  composeChrWithAllocatedTiles,
  classifyChrSlots,
  collectChrHighlightTileIndices,
  collectReservedPhysicalTileIndices,
  buildPhysicalTileReferenceIndex,
  calculateTileUsageDiagnostics,
  calculateChrUsageHeatmapSummary,
  NES_CHR_ROM_SIZE,
  NES_CHR_ROM_TILE_COUNT,
  NES_PATTERN_TABLE_SIZE,
  NES_PATTERN_TABLE_TILE_COUNT,
  type ChrHeatmapBucket,
  type ChrHighlightScope,
  type ChrRegion,
  type ChrSlotClassification,
  type ChrSlotOccupancy,
  type ChrSlotRegionMembership,
  type ChrTileUsageDiagnostic,
  type ChrUsageHeatmapSummary,
  type SpritePatternTable,
} from '../core/chr-pattern-table';
import {
  analyzeChrOwnershipDiagnostics,
  buildChrAssetMappingIndex,
  calculateProjectChrOwnershipMetrics,
  formatChrOwnershipDiagnosticMessage,
  getPhysicalIndicesForAsset,
  type ChrAssetMappingIndex,
} from '../core/chr-asset-mapping';
import type { ProjectAsset, ProjectAssetId } from '../core/asset-identity';
import { NES_MASTER_PALETTE, type NesPalette } from '../core/nes-palette';
import {
  findPaletteDefinition,
  resolveActiveBackgroundPaletteSet,
  resolveActiveSpritePaletteSet,
  type ActivePaletteSlots,
  type PaletteDefinition,
} from '../core/palette-manager';
import {
  deduplicateTiles,
  deduplicateTilesConsideringFlips,
} from '../core/tile-deduplication';
import { encodeChr } from '../core/chr-encoder';
import { padChrRom } from '../core/chr-rom';
import type { TileHistory } from '../core/chr-tile-editor';
import type { ChrDrawingTool } from './chr-tile-editor';
import type { Tile } from '../core/types';
import type {
  CompiledChrSlotState,
  CompiledProjectGraphics,
} from '../core/project-graphics-compiler';
import { t } from '../i18n';
import { createChrRegionManagerPanel } from './chr-region-manager';
import { createChrTileInspector } from './chr-tile-inspector';
import type { DisplayError, ProjectMode } from './types';
import type { WorkspaceView } from './workspace-state';

export const CHR_ZOOM_LEVELS = [1, 2, 3, 4] as const;
export type ChrZoomLevel = (typeof CHR_ZOOM_LEVELS)[number];

export const NEUTRAL_NES_GRAYSCALE = [
  { red: 15, green: 22, blue: 32 }, // 0: background tone
  { red: 116, green: 116, blue: 116 }, // 1: NES $00
  { red: 188, green: 188, blue: 188 }, // 2: NES $10
  { red: 255, green: 255, blue: 255 }, // 3: NES $30
] as const;

export interface ChrWorkspaceOptions {
  readonly compiledGraphics?: CompiledProjectGraphics | null;
  /** False when compiler cannot establish project physical placement. */
  readonly placementAvailable?: boolean;
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
  readonly highlightedAssetId?: string | null;
  readonly onHighlightAssetIdChange?: (assetId: string | null) => void;
  readonly chrAssetMappingIndex?: ChrAssetMappingIndex;
  readonly activeAssets?: readonly ProjectAsset[];
  readonly activeAssetIds?: ReadonlySet<ProjectAssetId>;
  readonly selectedAnimationId?: string | null;
  readonly onSelectAnimation?: (animationId: string) => void;
  readonly selectedFrameIndex?: number | null;
  readonly onSelectFrame?: (frameIndex: number) => void;
  readonly selectedEntity?: string | null;
  readonly onSelectEntity?: (entity: string) => void;
  readonly heatmapEnabled?: boolean;
  readonly onToggleHeatmap?: (enabled: boolean) => void;
  readonly palettes: readonly PaletteDefinition[];
  readonly universalBackgroundColor: number;
  readonly activeBackgroundSlots: ActivePaletteSlots;
  readonly activeSpriteSlots: ActivePaletteSlots;
  readonly chrRegions?: readonly ChrRegion[];
  readonly loading?: boolean;
  readonly error?: DisplayError | null;
  readonly onNavigateToWorkspace?: (workspace: WorkspaceView) => void;
  readonly onNavigateToAnimation?: (
    animationId: string,
    frameIndex: number,
  ) => void;
  readonly onNavigateToPlayfield?: (column: number, row: number) => void;
  readonly onNavigateToBackground?: (mapId: string, cellIndex?: number) => void;
  readonly onNavigateToTileset?: (tileIndex: number) => void;
  readonly onDownloadBytes?: (bytes: Uint8Array, fileName: string) => void;
  readonly onDownloadText?: (text: string, fileName: string) => void;
  readonly onTilePixelsChange?: (
    physicalIndex: number,
    newPixels: Uint8Array,
  ) => void;
  readonly history?: TileHistory<Uint8Array>;
  readonly editorState?: {
    readonly activeTool: ChrDrawingTool;
    readonly selectedColorIndex: number;
    readonly showGrid: boolean;
    readonly shiftWrap: boolean;
  };
  readonly onEditorStateChange?: (state: {
    readonly activeTool: ChrDrawingTool;
    readonly selectedColorIndex: number;
    readonly showGrid: boolean;
    readonly shiftWrap: boolean;
  }) => void;
  readonly onUpdateChrRegions?: (regions: readonly ChrRegion[]) => void;
}

export type ChrWorkspaceElement = HTMLElement & {
  readonly diagnosticsElement: HTMLElement | null;
  readonly tileInspectorElement: HTMLElement | null;
  readonly regionManagerElement: HTMLElement | null;
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

function classifyCompiledManifestSlot(
  state: CompiledChrSlotState,
): ChrSlotOccupancy {
  if (state === 'project') return 'project';
  if (state === 'base-chr') return 'base';
  if (state === 'reserved') return 'reserved';
  return 'empty';
}

function isCompiledContentSlot(state: CompiledChrSlotState): boolean {
  const occupancy = classifyCompiledManifestSlot(state);
  return occupancy === 'project' || occupancy === 'base';
}

function computeMetrics(options: ChrWorkspaceOptions): ComputedChrMetrics {
  if (options.compiledGraphics) {
    const manifest = options.compiledGraphics.allocationManifest;
    const occupied = (patternTable: SpritePatternTable) =>
      manifest.filter(
        (slot) =>
          slot.patternTable === patternTable &&
          isCompiledContentSlot(slot.state),
      ).length;
    const base = (patternTable: SpritePatternTable) =>
      manifest.filter(
        (slot) =>
          slot.patternTable === patternTable && slot.state === 'base-chr',
      ).length;
    const pt0Occupied = occupied(0);
    const pt1Occupied = occupied(1);
    const spritePt = options.patternTable;
    const spriteOccupied = occupied(spritePt);
    return {
      physicalCapacityTiles: NES_CHR_ROM_TILE_COUNT,
      totalOccupiedTiles: pt0Occupied + pt1Occupied,
      totalFreeTiles: NES_CHR_ROM_TILE_COUNT - pt0Occupied - pt1Occupied,
      pt0OccupiedTiles: pt0Occupied,
      pt0BaseTiles: base(0),
      pt1OccupiedTiles: pt1Occupied,
      pt1BaseTiles: base(1),
      activeSpritePatternTable: spritePt,
      spritePtOccupiedTiles: spriteOccupied,
      spritePtRemainingTiles: NES_PATTERN_TABLE_TILE_COUNT - spriteOccupied,
      reusedDestinationTiles: 0,
      reusedImportedTiles: 0,
      newTileCount: 0,
      deduplicationSavings: 0,
      finalChrBytes: options.compiledGraphics.finalChr,
      outputFileName: 'project.chr',
    };
  }
  if (options.placementAvailable === false) {
    return {
      physicalCapacityTiles: NES_CHR_ROM_TILE_COUNT,
      totalOccupiedTiles: 0,
      totalFreeTiles: NES_CHR_ROM_TILE_COUNT,
      pt0OccupiedTiles: 0,
      pt0BaseTiles: 0,
      pt1OccupiedTiles: 0,
      pt1BaseTiles: 0,
      activeSpritePatternTable: options.patternTable,
      spritePtOccupiedTiles: 0,
      spritePtRemainingTiles: NES_PATTERN_TABLE_TILE_COUNT,
      reusedDestinationTiles: 0,
      reusedImportedTiles: 0,
      newTileCount: 0,
      deduplicationSavings: 0,
      finalChrBytes: padChrRom(options.baseChr ?? new Uint8Array()),
      outputFileName: 'project.chr',
    };
  }
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
    finalChrBytes = composeChrWithAllocatedTiles(
      options.baseChr,
      options.destinationPatternTable,
      deduplicated,
      options.chrRegions,
    );
  } else if (options.chrRegions && options.chrRegions.length > 0) {
    finalChrBytes = composeChrWithAllocatedTiles(
      new Uint8Array(NES_CHR_ROM_SIZE),
      0,
      deduplicated,
      options.chrRegions,
    );
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
  readonly group: 'grayscale' | 'background' | 'sprite';
  readonly colors: readonly ChrPreviewColor[];
}

export interface ChrPreviewColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha?: number;
}

export interface ChrPreviewPaletteContext {
  readonly bank: 'grayscale' | 'background' | 'sprite';
  readonly slotIndex: 0 | 1 | 2 | 3 | null;
  readonly paletteId: string | null;
  readonly paletteName: string | null;
  readonly colorCodes: NesPalette | null;
  readonly colors: readonly ChrPreviewColor[];
  readonly status: 'neutral' | 'assigned' | 'empty' | 'dangling';
  readonly transparentZero: boolean;
}

function parsePaletteSlot(value: string): 0 | 1 | 2 | 3 | null {
  const slot = Number(value);
  return slot === 0 || slot === 1 || slot === 2 || slot === 3 ? slot : null;
}

function mapPaletteCodesToPreviewColors(
  colorCodes: NesPalette,
  transparentZero: boolean,
): readonly ChrPreviewColor[] {
  return colorCodes.map((code, index) => {
    const color = NES_MASTER_PALETTE[code] ?? { red: 0, green: 0, blue: 0 };
    return {
      red: color.red,
      green: color.green,
      blue: color.blue,
      alpha: transparentZero && index === 0 ? 0 : 255,
    };
  });
}

export function resolveChrPreviewPaletteContext(
  previewPaletteId = 'grayscale',
  palettes: readonly PaletteDefinition[] = [],
  activeBackgroundSlots: ActivePaletteSlots = [null, null, null, null],
  activeSpriteSlots: ActivePaletteSlots = [null, null, null, null],
  universalBackgroundColor = 0x0f,
): ChrPreviewPaletteContext {
  if (!previewPaletteId || previewPaletteId === 'grayscale') {
    return {
      bank: 'grayscale',
      slotIndex: null,
      paletteId: null,
      paletteName: null,
      colorCodes: null,
      colors: NEUTRAL_NES_GRAYSCALE,
      status: 'neutral',
      transparentZero: false,
    };
  }

  if (previewPaletteId.startsWith('bg-')) {
    const slotIndex = parsePaletteSlot(previewPaletteId.slice(3));
    if (slotIndex === null) {
      return resolveChrPreviewPaletteContext();
    }
    const paletteId = activeBackgroundSlots[slotIndex];
    const definition = findPaletteDefinition(palettes, paletteId);
    const colorCodes = resolveActiveBackgroundPaletteSet(
      palettes,
      activeBackgroundSlots,
      universalBackgroundColor,
    )[slotIndex];
    return {
      bank: 'background',
      slotIndex,
      paletteId,
      paletteName: definition?.name ?? null,
      colorCodes,
      colors: mapPaletteCodesToPreviewColors(colorCodes, false),
      status:
        definition !== null
          ? 'assigned'
          : paletteId === null
            ? 'empty'
            : 'dangling',
      transparentZero: false,
    };
  }

  if (previewPaletteId.startsWith('sp-')) {
    const slotIndex = parsePaletteSlot(previewPaletteId.slice(3));
    if (slotIndex === null) {
      return resolveChrPreviewPaletteContext();
    }
    const paletteId = activeSpriteSlots[slotIndex];
    const definition = findPaletteDefinition(palettes, paletteId);
    const colorCodes = resolveActiveSpritePaletteSet(
      palettes,
      activeSpriteSlots,
      undefined,
      universalBackgroundColor,
    )[slotIndex];
    return {
      bank: 'sprite',
      slotIndex,
      paletteId,
      paletteName: definition?.name ?? null,
      colorCodes,
      colors: mapPaletteCodesToPreviewColors(colorCodes, true),
      status:
        definition !== null
          ? 'assigned'
          : paletteId === null
            ? 'empty'
            : 'dangling',
      transparentZero: true,
    };
  }

  return resolveChrPreviewPaletteContext();
}

export function resolveChrPreviewPaletteColors(
  previewPaletteId = 'grayscale',
  palettes: readonly PaletteDefinition[] = [],
  activeBackgroundSlots: ActivePaletteSlots = [null, null, null, null],
  activeSpriteSlots: ActivePaletteSlots = [null, null, null, null],
  universalBackgroundColor = 0x0f,
): readonly ChrPreviewColor[] {
  return resolveChrPreviewPaletteContext(
    previewPaletteId,
    palettes,
    activeBackgroundSlots,
    activeSpriteSlots,
    universalBackgroundColor,
  ).colors;
}

export function getChrPreviewPaletteOptions(
  palettes: readonly PaletteDefinition[] = [],
  activeBackgroundSlots: ActivePaletteSlots = [null, null, null, null],
  activeSpriteSlots: ActivePaletteSlots = [null, null, null, null],
  universalBackgroundColor = 0x0f,
): readonly ChrPreviewPaletteOption[] {
  const options: ChrPreviewPaletteOption[] = [
    {
      id: 'grayscale',
      label: t('chrWorkspacePaletteGrayscale'),
      group: 'grayscale',
      colors: NEUTRAL_NES_GRAYSCALE,
    },
  ];

  // Background Palettes (BG 0..3)
  for (let i = 0; i < 4; i += 1) {
    const context = resolveChrPreviewPaletteContext(
      `bg-${String(i)}`,
      palettes,
      activeBackgroundSlots,
      activeSpriteSlots,
      universalBackgroundColor,
    );
    const paletteStatus =
      context.paletteName ??
      (context.paletteId === null
        ? t('paletteManagerSlotEmpty')
        : t('paletteManagerMissingPalette', {
            paletteId: context.paletteId,
          }));

    options.push({
      id: `bg-${String(i)}`,
      label: `${t('chrWorkspacePaletteBg', { index: i })} — ${paletteStatus}`,
      group: 'background',
      colors: context.colors,
    });
  }

  // Sprite Palettes (SP 0..3)
  for (let i = 0; i < 4; i += 1) {
    const context = resolveChrPreviewPaletteContext(
      `sp-${String(i)}`,
      palettes,
      activeBackgroundSlots,
      activeSpriteSlots,
      universalBackgroundColor,
    );
    const paletteStatus =
      context.paletteName ??
      (context.paletteId === null
        ? t('paletteManagerSlotEmpty')
        : t('paletteManagerMissingPalette', {
            paletteId: context.paletteId,
          }));

    options.push({
      id: `sp-${String(i)}`,
      label: `${t('chrWorkspacePaletteSp', { index: i })} — ${paletteStatus}`,
      group: 'sprite',
      colors: context.colors,
    });
  }

  return options;
}

export function renderPatternTableToCanvas(
  canvas: HTMLCanvasElement,
  chrBytes: Uint8Array,
  patternTable: SpritePatternTable,
  colors: readonly ChrPreviewColor[] = NEUTRAL_NES_GRAYSCALE.map((color) => ({
    ...color,
    alpha: 255,
  })),
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
        const fallbackColor = colors[0] ?? {
          red: 0,
          green: 0,
          blue: 0,
          alpha: 255,
        };
        const color = colors[colorVal] ?? fallbackColor;

        const pixelOffset = ((startY + py) * 128 + (startX + px)) * 4;
        data[pixelOffset] = color.red;
        data[pixelOffset + 1] = color.green;
        data[pixelOffset + 2] = color.blue;
        data[pixelOffset + 3] = color.alpha ?? 255;
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
  previewColors: readonly ChrPreviewColor[],
  classifications: readonly ChrSlotClassification[],
  highlightedIndices: ReadonlySet<number>,
  highlightScope: ChrHighlightScope,
  highlightScopeLabel: string,
  usageDiagnostics: readonly ChrTileUsageDiagnostic[],
  heatmapEnabled: boolean,
  onSelectTile?: (tileIndex: number | null) => void,
  regionIndex?: readonly ChrSlotRegionMembership[],
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
    (classification) =>
      classification.occupancy === 'project' ||
      classification.occupancy === 'base',
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
  canvasContainer.setAttribute('data-zoom', String(zoom));

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  canvas.className = 'chr-pt-canvas';
  if (previewColors[0]?.alpha === 0) canvas.classList.add('checkerboard');
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
    (highlightScope !== 'none' || highlightScopeLabel.length > 0) &&
    highlightedIndices.size > 0;

  const gridOverlay = document.createElement('div');
  let gridOverlayClass = 'chr-pt-grid-overlay';
  if (hasActiveHighlight) gridOverlayClass += ' has-highlight';
  if (heatmapEnabled) gridOverlayClass += ' has-heatmap';
  gridOverlay.className = gridOverlayClass;
  gridOverlay.setAttribute('role', 'grid');
  gridOverlay.setAttribute('aria-rowcount', '16');
  gridOverlay.setAttribute('aria-colcount', '16');
  gridOverlay.setAttribute(
    'aria-label',
    patternTable === 0 ? t('chrWorkspacePt0Title') : t('chrWorkspacePt1Title'),
  );

  const isSelectedInThisTable =
    selectedTileIndex !== null &&
    selectedTileIndex >= startPhysical &&
    selectedTileIndex < startPhysical + NES_PATTERN_TABLE_TILE_COUNT;

  const initialFocusLocalIndex = isSelectedInThisTable
    ? selectedTileIndex - startPhysical
    : 0;

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

    const regionMembership = regionIndex?.[physicalIndex];
    const inRegion = regionMembership?.inRegion ?? false;
    const inReservation = regionMembership?.inReservation ?? false;
    const isRegionStart =
      Boolean(
        regionMembership?.regions.some((r) => r.startTile === localIndex),
      ) ||
      Boolean(
        regionMembership?.reservations.some((r) => r.startTile === localIndex),
      );
    const isRegionEnd =
      Boolean(
        regionMembership?.regions.some((r) => r.endTile === localIndex),
      ) ||
      Boolean(
        regionMembership?.reservations.some((r) => r.endTile === localIndex),
      );

    const diag = usageDiagnostics[physicalIndex];
    const bucket = diag?.bucket ?? 'unused';
    const refCount = diag?.referenceCount ?? 0;

    let slotClass = `chr-tile-slot is-occupancy-${occupancy}`;
    if (inRegion) slotClass += ' in-region';
    if (inReservation) slotClass += ' in-reservation';
    if (isRegionStart) slotClass += ' is-region-start';
    if (isRegionEnd) slotClass += ' is-region-end';
    if (isHighlighted) slotClass += ' is-highlighted';
    if (isDimmed) slotClass += ' is-dimmed';
    if (isSlotSelected) slotClass += ' is-selected';

    const slot = document.createElement('div');
    slot.className = slotClass;
    slot.tabIndex = localIndex === initialFocusLocalIndex ? 0 : -1;
    slot.setAttribute('data-physical-index', String(physicalIndex));
    slot.setAttribute('data-local-index', String(localIndex));
    slot.setAttribute('data-pattern-table', String(patternTable));
    slot.setAttribute('data-occupancy', occupancy);
    slot.setAttribute('data-in-region', inRegion ? 'true' : 'false');
    slot.setAttribute('data-in-reservation', inReservation ? 'true' : 'false');
    if (regionMembership?.regions.length) {
      slot.setAttribute(
        'data-region-names',
        regionMembership.regions.map((r) => r.name).join(', '),
      );
    }
    if (regionMembership?.reservations.length) {
      slot.setAttribute(
        'data-reservation-names',
        regionMembership.reservations.map((r) => r.name).join(', '),
      );
    }
    if (regionMembership?.primaryColor) {
      slot.style.setProperty(
        '--slot-region-color',
        regionMembership.primaryColor,
      );
    }
    slot.setAttribute('data-heatmap-bucket', bucket);
    slot.setAttribute('data-ref-count', String(refCount));
    slot.setAttribute('data-highlighted', isHighlighted ? 'true' : 'false');
    slot.setAttribute('data-row', String(row));
    slot.setAttribute('data-col', String(col));
    slot.setAttribute('role', 'gridcell');
    slot.setAttribute('aria-rowindex', String(row + 1));
    slot.setAttribute('aria-colindex', String(col + 1));
    slot.setAttribute('aria-selected', String(isSlotSelected));

    let regionTooltipSnippet = '';
    let reservationTooltipSnippet = '';
    let regionAriaSnippet = '';
    let reservationAriaSnippet = '';

    if (regionMembership?.regions.length) {
      const names = regionMembership.regions.map((r) => r.name).join(', ');
      regionTooltipSnippet = t('chrWorkspaceTileTooltipRegionPart', {
        name: names,
      });
      regionAriaSnippet = t('chrWorkspaceTileAriaRegionPart', { name: names });
    }
    if (regionMembership?.reservations.length) {
      const names = regionMembership.reservations.map((r) => r.name).join(', ');
      reservationTooltipSnippet = t('chrWorkspaceTileTooltipReservationPart', {
        name: names,
      });
      reservationAriaSnippet = t('chrWorkspaceTileAriaReservationPart', {
        name: names,
      });
    }

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
        `${t('chrWorkspaceTileHeatmapAriaLabel', {
          pt: patternTable,
          hex: hexLocal,
          id: physicalIndex,
          state: stateAndHighlight,
          refs: refCount,
          bucket: bucketText,
        })}${regionAriaSnippet}${reservationAriaSnippet}`,
      );
      slot.title = `${t('chrWorkspaceTileHeatmapTooltip', {
        pt: patternTable,
        hex: hexLocal,
        id: physicalIndex,
        state: stateAndHighlight,
        refs: refCount,
        bucket: bucketText,
        addr: addrHex,
      })}${regionTooltipSnippet}${reservationTooltipSnippet}`;
    } else {
      slot.setAttribute(
        'aria-label',
        `${t('chrWorkspaceTileAriaLabel', {
          pt: patternTable,
          hex: hexLocal,
          id: physicalIndex,
          state: stateAndHighlight,
        })}${regionAriaSnippet}${reservationAriaSnippet}`,
      );
      slot.title = `${t('chrWorkspaceTileTooltip', {
        pt: patternTable,
        hex: hexLocal,
        id: physicalIndex,
        state: stateAndHighlight,
        addr: addrHex,
      })}${regionTooltipSnippet}${reservationTooltipSnippet}`;
    }

    slot.addEventListener('click', () => {
      const allSlots = gridOverlay.querySelectorAll(
        '.chr-tile-slot',
      ) as unknown as HTMLElement[];
      allSlots.forEach((s) => {
        if (s !== slot && s.tabIndex === 0) {
          s.tabIndex = -1;
        }
      });
      slot.tabIndex = 0;
      if (onSelectTile) {
        onSelectTile(physicalIndex);
      }
    });

    slot.addEventListener('keydown', (e?: KeyboardEvent) => {
      if (!e) return;
      let targetLocalIndex: number;
      switch (e.key) {
        case 'ArrowLeft':
          targetLocalIndex =
            (localIndex - 1 + NES_PATTERN_TABLE_TILE_COUNT) %
            NES_PATTERN_TABLE_TILE_COUNT;
          break;
        case 'ArrowRight':
          targetLocalIndex = (localIndex + 1) % NES_PATTERN_TABLE_TILE_COUNT;
          break;
        case 'ArrowUp':
          targetLocalIndex =
            (localIndex - 16 + NES_PATTERN_TABLE_TILE_COUNT) %
            NES_PATTERN_TABLE_TILE_COUNT;
          break;
        case 'ArrowDown':
          targetLocalIndex = (localIndex + 16) % NES_PATTERN_TABLE_TILE_COUNT;
          break;
        case 'Home':
          targetLocalIndex = e.ctrlKey ? 0 : Math.floor(localIndex / 16) * 16;
          break;
        case 'End':
          targetLocalIndex = e.ctrlKey
            ? 255
            : Math.floor(localIndex / 16) * 16 + 15;
          break;
        case 'PageUp':
          targetLocalIndex = localIndex % 16;
          break;
        case 'PageDown':
          targetLocalIndex = 240 + (localIndex % 16);
          break;
        case 'Enter':
        case ' ':
          if (typeof e.preventDefault === 'function') {
            e.preventDefault();
          }
          if (onSelectTile) {
            onSelectTile(physicalIndex);
          }
          return;
        case 'Escape':
          if (typeof e.preventDefault === 'function') {
            e.preventDefault();
          }
          if (onSelectTile) {
            onSelectTile(null);
          }
          return;
        default:
          return;
      }

      if (typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      const targetSlot = gridOverlay.querySelector<HTMLElement>(
        `[data-local-index="${String(targetLocalIndex)}"]`,
      );
      if (targetSlot) {
        slot.tabIndex = -1;
        targetSlot.tabIndex = 0;
        if (typeof targetSlot.focus === 'function') {
          targetSlot.focus();
        }
        if (typeof targetSlot.scrollIntoView === 'function') {
          targetSlot.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
  previewColors: readonly ChrPreviewColor[],
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
  mappingIndex: ChrAssetMappingIndex,
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
    options.palettes,
    options.activeBackgroundSlots,
    options.activeSpriteSlots,
    options.universalBackgroundColor,
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
    } else {
      const groupEl = getOptGroup('sprite', t('chrWorkspacePaletteGroupSp'));
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
    if (col.alpha === 0) {
      swatch.classList.add('is-transparent');
      swatch.setAttribute('title', t('paletteManagerTransparent'));
    } else {
      swatch.style.backgroundColor = `rgb(${String(col.red)}, ${String(col.green)}, ${String(col.blue)})`;
    }
    swatches.append(swatch);
  });

  paletteControls.append(paletteLabel, paletteSelect, swatches);

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

  if (
    mappingIndex.physicalIndicesByAsset.size > 0 &&
    options.onHighlightAssetIdChange
  ) {
    const assetSelect = document.createElement('select');
    assetSelect.className = 'chr-highlight-asset-select';
    assetSelect.id = 'chr-highlight-asset-select-input';
    assetSelect.setAttribute(
      'aria-label',
      t('chrWorkspaceHighlightAssetLabel'),
    );

    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = t('chrWorkspaceAllAssetsOption');
    if (!options.highlightedAssetId) {
      allOpt.selected = true;
    }
    assetSelect.append(allOpt);

    for (const [
      assetId,
      slotIndices,
    ] of mappingIndex.physicalIndicesByAsset.entries()) {
      const opt = document.createElement('option');
      opt.value = assetId;
      const attr = mappingIndex.byPhysicalIndex.find(
        (slot) => slot.origin?.primaryAssetId === assetId,
      );
      const assetName = attr?.origin?.primaryAssetName ?? assetId;
      opt.textContent = `${assetName} (${String(slotIndices.size)})`;
      if (options.highlightedAssetId === assetId) {
        opt.selected = true;
      }
      assetSelect.append(opt);
    }

    assetSelect.addEventListener('change', () => {
      const val = assetSelect.value.trim() ? assetSelect.value : null;
      options.onHighlightAssetIdChange?.(val);
    });

    highlightControls.append(assetSelect);
  }

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

  if (
    (highlightScope !== 'none' || Boolean(options.highlightedAssetId)) &&
    highlightedIndices.size > 0
  ) {
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

  const heatmapControls = document.createElement('div');
  heatmapControls.className = 'chr-heatmap-controls';

  const heatmapLabel = document.createElement('span');
  heatmapLabel.className = 'chr-heatmap-label';
  heatmapLabel.textContent = t('chrWorkspaceHeatmapLabel');

  const heatmapSegmented = document.createElement('div');
  heatmapSegmented.className = 'segmented-control chr-heatmap-segmented';
  heatmapSegmented.setAttribute('role', 'group');
  heatmapSegmented.setAttribute('aria-label', t('chrWorkspaceHeatmapLabel'));

  const offBtn = document.createElement('button');
  offBtn.type = 'button';
  offBtn.className = `segmented-button${!heatmapEnabled ? ' is-active' : ''}`;
  offBtn.setAttribute('aria-pressed', String(!heatmapEnabled));
  offBtn.textContent = t('chrWorkspaceHeatmapOff');
  offBtn.addEventListener('click', () => {
    if (options.onToggleHeatmap) {
      options.onToggleHeatmap(false);
    }
  });

  const onBtn = document.createElement('button');
  onBtn.type = 'button';
  onBtn.className = `segmented-button${heatmapEnabled ? ' is-active' : ''}`;
  onBtn.setAttribute('aria-pressed', String(heatmapEnabled));
  onBtn.textContent = t('chrWorkspaceHeatmapOn');
  onBtn.addEventListener('click', () => {
    if (options.onToggleHeatmap) {
      options.onToggleHeatmap(true);
    }
  });

  heatmapSegmented.append(offBtn, onBtn);
  heatmapControls.append(heatmapLabel, heatmapSegmented);

  let activeLegend: HTMLElement;
  if (!heatmapEnabled) {
    const occupancyLegend = document.createElement('div');
    occupancyLegend.className = 'chr-legend chr-occupancy-legend';
    occupancyLegend.setAttribute('role', 'group');
    occupancyLegend.setAttribute('aria-label', t('chrWorkspaceLegendTitle'));

    const legendTitle = document.createElement('span');
    legendTitle.className = 'chr-legend-title';
    legendTitle.textContent = t('chrWorkspaceLegendTitle');
    occupancyLegend.append(legendTitle);

    const legendItems: readonly {
      readonly key: string;
      readonly label: string;
    }[] = [
      { key: 'project', label: t('chrWorkspaceLegendProject') },
      { key: 'base', label: t('chrWorkspaceLegendBase') },
      { key: 'reserved', label: t('chrWorkspaceLegendReserved') },
      { key: 'empty', label: t('chrWorkspaceLegendEmpty') },
      { key: 'region', label: t('chrWorkspaceLegendRegion') },
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
      occupancyLegend.append(itemEl);
    });
    activeLegend = occupancyLegend;
  } else {
    const heatmapLegend = document.createElement('div');
    heatmapLegend.className = 'chr-legend chr-heatmap-legend';
    heatmapLegend.setAttribute('role', 'group');
    heatmapLegend.setAttribute(
      'aria-label',
      t('chrWorkspaceHeatmapLegendTitle'),
    );

    const legendTitle = document.createElement('span');
    legendTitle.className = 'chr-legend-title';
    legendTitle.textContent = t('chrWorkspaceHeatmapLegendTitle');
    heatmapLegend.append(legendTitle);

    const buckets: readonly {
      readonly key: ChrHeatmapBucket;
      readonly label: string;
    }[] = [
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

  const viewGroup = document.createElement('div');
  viewGroup.className = 'chr-toolbar-group is-view-group';
  viewGroup.setAttribute('role', 'group');
  viewGroup.setAttribute('aria-label', t('chrWorkspaceViewGroupLabel'));
  viewGroup.append(zoomControls, paletteControls, heatmapControls);

  const contextGroup = document.createElement('div');
  contextGroup.className = 'chr-toolbar-group is-context-group';
  contextGroup.setAttribute('role', 'group');
  contextGroup.setAttribute('aria-label', t('chrWorkspaceContextGroupLabel'));
  contextGroup.append(highlightControls, activeLegend);

  toolbarControls.append(viewGroup, contextGroup);
  toolbar.append(titleGroup, toolbarControls);

  const ptContainer = document.createElement('div');
  ptContainer.className = 'chr-pattern-tables-container';

  const selectedTileIndex = options.selectedTileIndex ?? null;
  const regionIndex = buildChrSlotRegionIndex(options.chrRegions ?? []);

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
    regionIndex,
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
    regionIndex,
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

function createChrAssetMetricsPanel(
  options: ChrWorkspaceOptions,
  mappingIndex: ChrAssetMappingIndex,
  finalChrBytes: Uint8Array,
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel chr-asset-metrics-panel';
  panel.id = 'section-chr-asset-metrics';

  const reservedPhysicalIndices = collectReservedPhysicalTileIndices(
    options.chrRegions,
  );

  const ownershipMetrics = calculateProjectChrOwnershipMetrics({
    mappingIndex,
    activeAssets: options.activeAssets,
    reservedPhysicalIndices,
    finalChrBytes,
  });

  const ownershipDiagnostics = analyzeChrOwnershipDiagnostics({
    mappingIndex,
    activeAssets: options.activeAssets,
    activeAssetIds: options.activeAssetIds,
    reservedPhysicalIndices,
    expectedPatternTable: options.destinationPatternTable,
    chrRegions: options.chrRegions,
    mode: options.mode,
  });

  const header = document.createElement('div');
  header.className = 'chr-asset-metrics-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'chr-asset-metrics-title-group';

  const title = document.createElement('h3');
  title.textContent = t('chrAssetMetricsTitle');

  const subtitle = document.createElement('p');
  subtitle.className = 'chr-asset-metrics-subtitle muted';
  subtitle.textContent = t('chrAssetMetricsSubtitle');

  titleGroup.append(title, subtitle);
  header.append(titleGroup);
  panel.append(header);

  // 1. Per-Asset Metrics Grid
  const assetsContainer = document.createElement('div');
  assetsContainer.className = 'chr-asset-metrics-grid';

  if (ownershipMetrics.byAsset.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'muted chr-asset-metrics-empty';
    emptyMsg.textContent = t('chrAssetMetricsEmpty');
    assetsContainer.append(emptyMsg);
  } else {
    for (const assetMetric of ownershipMetrics.byAsset) {
      const card = document.createElement('div');
      card.className = 'chr-asset-metric-card';
      if (options.highlightedAssetId === assetMetric.assetId) {
        card.classList.add('is-highlighted');
      }

      const cardHeader = document.createElement('div');
      cardHeader.className = 'chr-asset-metric-card-header';

      const cardTitleGroup = document.createElement('div');
      cardTitleGroup.className = 'chr-asset-metric-name-group';

      const assetName = document.createElement('strong');
      assetName.className = 'chr-asset-metric-name';
      assetName.textContent = assetMetric.assetName ?? assetMetric.assetId;

      const assetId = document.createElement('code');
      assetId.className = 'chr-asset-metric-id muted';
      assetId.textContent = assetMetric.assetId;

      cardTitleGroup.append(assetName, assetId);
      cardHeader.append(cardTitleGroup);

      if (
        options.onHighlightAssetIdChange &&
        assetMetric.uniquePhysicalSlots > 0
      ) {
        const isHighlighted =
          options.highlightedAssetId === assetMetric.assetId;
        const highlightBtn = document.createElement('button');
        highlightBtn.type = 'button';
        highlightBtn.className = `button secondary-button chr-asset-highlight-btn${isHighlighted ? ' is-active' : ''}`;
        highlightBtn.textContent = isHighlighted
          ? t('chrTileInspectorClearHighlightAssetAction')
          : t('chrTileInspectorHighlightAssetAction');
        highlightBtn.setAttribute(
          'aria-pressed',
          isHighlighted ? 'true' : 'false',
        );
        highlightBtn.addEventListener('click', () => {
          options.onHighlightAssetIdChange?.(
            isHighlighted ? null : assetMetric.assetId,
          );
        });
        cardHeader.append(highlightBtn);
      }

      card.append(cardHeader);

      // Metric Chips List
      const chipsList = document.createElement('ul');
      chipsList.className = 'chr-asset-metric-chips';

      const addChip = (text: string, className?: string) => {
        const chip = document.createElement('li');
        chip.className = `chr-metric-chip ${className ?? ''}`;
        chip.textContent = text;
        chipsList.append(chip);
      };

      addChip(
        t('chrAssetMetricsUniqueSlots', {
          count: assetMetric.uniquePhysicalSlots,
        }),
        'chip-unique',
      );
      addChip(
        t('chrAssetMetricsOwnedSlots', {
          count: assetMetric.primaryOwnedSlots,
        }),
        'chip-owned',
      );
      addChip(
        t('chrAssetMetricsConsumedSlots', {
          count: assetMetric.consumedSlots,
        }),
        'chip-consumed',
      );

      if (assetMetric.sharedSlots > 0) {
        if (assetMetric.crossAssetSharedSlots > 0) {
          addChip(
            `${t('chrAssetMetricsSharedSlots', { count: assetMetric.sharedSlots })} (${t('chrAssetMetricsCrossAssetSharedSlots', { count: assetMetric.crossAssetSharedSlots })})`,
            'chip-shared',
          );
        } else {
          addChip(
            t('chrAssetMetricsSharedSlots', {
              count: assetMetric.sharedSlots,
            }),
            'chip-shared',
          );
        }
      }

      if (assetMetric.exclusiveSlots > 0) {
        addChip(
          t('chrAssetMetricsExclusiveSlots', {
            count: assetMetric.exclusiveSlots,
          }),
          'chip-exclusive',
        );
      }

      if (assetMetric.baseChrReusedSlots > 0) {
        addChip(
          t('chrAssetMetricsBaseChrReusedSlots', {
            count: assetMetric.baseChrReusedSlots,
          }),
          'chip-base-chr',
        );
      }

      if (assetMetric.manualMaterializedSlots > 0) {
        addChip(
          t('chrAssetMetricsManualMaterializedSlots', {
            count: assetMetric.manualMaterializedSlots,
          }),
          'chip-manual',
        );
      }

      addChip(
        t('chrAssetMetricsPt0Pt1Breakdown', {
          pt0: assetMetric.patternTableSlots[0],
          pt1: assetMetric.patternTableSlots[1],
        }),
        'chip-pt-breakdown',
      );

      card.append(chipsList);
      assetsContainer.append(card);
    }
  }

  panel.append(assetsContainer);

  // 2. Ownership & Mapping Integrity Diagnostics Section
  if (ownershipDiagnostics.length > 0) {
    const diagSection = document.createElement('div');
    diagSection.className = 'chr-ownership-diagnostics-section';

    const diagHeader = document.createElement('h4');
    diagHeader.className = 'chr-ownership-diagnostics-title';
    diagHeader.textContent = t('chrOwnershipDiagnosticsTitle');
    diagSection.append(diagHeader);

    const diagList = document.createElement('div');
    diagList.className = 'chr-ownership-diagnostics-list';

    for (const fact of ownershipDiagnostics) {
      const item = document.createElement('div');
      item.className = `chr-ownership-diag-item is-${fact.severity}`;

      const icon = document.createElement('span');
      icon.className = 'chr-diag-icon';
      icon.textContent = fact.severity === 'error' ? '❌' : '⚠️';

      const msg = document.createElement('span');
      msg.className = 'chr-diag-message';
      msg.textContent = formatChrOwnershipDiagnosticMessage(fact);

      item.append(icon, msg);

      const actions = document.createElement('div');
      actions.className = 'chr-diag-actions';

      if (
        options.onSelectTile &&
        fact.physicalIndex >= 0 &&
        fact.physicalIndex < 512
      ) {
        const inspectBtn = document.createElement('button');
        inspectBtn.type = 'button';
        inspectBtn.className = 'button secondary-button chr-diag-action-btn';
        inspectBtn.textContent = t('chrOwnershipDiagnosticsInspectSlot');
        inspectBtn.addEventListener('click', () => {
          options.onSelectTile?.(fact.physicalIndex);
        });
        actions.append(inspectBtn);
      }

      const targetAssetId =
        'primaryAssetId' in fact
          ? fact.primaryAssetId
          : 'assetId' in fact
            ? fact.assetId
            : undefined;
      if (options.onHighlightAssetIdChange && targetAssetId) {
        const highlightBtn = document.createElement('button');
        highlightBtn.type = 'button';
        highlightBtn.className = 'button secondary-button chr-diag-action-btn';
        highlightBtn.textContent = t('chrOwnershipDiagnosticsHighlightAsset');
        highlightBtn.addEventListener('click', () => {
          options.onHighlightAssetIdChange?.(targetAssetId);
        });
        actions.append(highlightBtn);
      }

      if (actions.children.length > 0) {
        item.append(actions);
      }

      diagList.append(item);
    }

    diagSection.append(diagList);
    panel.append(diagSection);
  }

  return panel;
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

  const previewPaletteContext = resolveChrPreviewPaletteContext(
    options.previewPalette,
    options.palettes,
    options.activeBackgroundSlots,
    options.activeSpriteSlots,
    options.universalBackgroundColor,
  );
  const previewColors = previewPaletteContext.colors;

  const classifications: readonly ChrSlotClassification[] =
    options.compiledGraphics
      ? options.compiledGraphics.allocationManifest.map((slot) => ({
          physicalIndex: slot.physicalSlot,
          localIndex: slot.localPatternTableIndex,
          patternTable: slot.patternTable,
          occupancy: classifyCompiledManifestSlot(slot.state),
        }))
      : options.placementAvailable === false
        ? Array.from(
            { length: NES_CHR_ROM_TILE_COUNT },
            (_, physicalIndex) => ({
              physicalIndex,
              localIndex: physicalIndex % NES_PATTERN_TABLE_TILE_COUNT,
              patternTable:
                physicalIndex < NES_PATTERN_TABLE_TILE_COUNT ? 0 : 1,
              occupancy: 'empty' as const,
            }),
          )
        : classifyChrSlots({
            finalChrBytes: metrics.finalChrBytes,
            mode: options.mode,
            animationModel: options.animationModel,
            baseChr: options.baseChr,
            destinationPatternTable: options.destinationPatternTable,
            tiles: options.tiles,
            deduplicationEnabled: options.deduplicationEnabled,
            flipDeduplicationEnabled: options.flipDeduplicationEnabled,
            chrRegions: options.chrRegions,
          });

  const mappingIndex =
    options.placementAvailable === false
      ? buildChrAssetMappingIndex()
      : (options.chrAssetMappingIndex ??
        buildChrAssetMappingIndex({
          mode: options.mode,
          animationModel: options.animationModel,
          playfieldNametable: options.playfieldNametable,
          destinationPatternTable: options.destinationPatternTable,
          tiles: options.tiles,
          baseChr: options.baseChr ?? undefined,
          deduplicationEnabled: options.deduplicationEnabled,
          flipDeduplicationEnabled: options.flipDeduplicationEnabled,
          chrRegions: options.chrRegions,
        }));

  const referenceIndex =
    options.placementAvailable === false
      ? buildPhysicalTileReferenceIndex({})
      : options.compiledGraphics
        ? buildPhysicalTileReferenceIndex({
            compiledBackgrounds: options.compiledGraphics.backgrounds,
            animationModel: options.animationModel,
          })
        : buildPhysicalTileReferenceIndex({
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

  let highlightedIndices = collectChrHighlightTileIndices({
    scope: highlightScope,
    mode: options.mode,
    animationModel: options.animationModel,
    selectedAnimationId: targetAnim?.id ?? null,
    selectedFrameIndex: activeFrameIndex,
    selectedEntity: activeEntity,
    classifications,
  });

  let highlightScopeLabel = t('chrWorkspaceHighlightScopeNone');
  if (options.highlightedAssetId) {
    const assetSlots = getPhysicalIndicesForAsset(
      options.highlightedAssetId,
      mappingIndex,
    );
    if (highlightScope === 'none' || highlightedIndices.size === 0) {
      highlightedIndices = assetSlots;
    } else {
      highlightedIndices = new Set([...highlightedIndices, ...assetSlots]);
    }
    const attr = mappingIndex.byPhysicalIndex.find(
      (s) => s.origin?.primaryAssetId === options.highlightedAssetId,
    );
    const assetDisplayName =
      attr?.origin?.primaryAssetName ?? options.highlightedAssetId;
    highlightScopeLabel = t('chrWorkspaceAssetHighlightScope', {
      name: assetDisplayName,
    });
  } else if (highlightScope === 'frame') {
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
    mappingIndex,
  );

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
    paletteContext: previewPaletteContext,
    isHighlighted: isSelectedTileHighlighted,
    highlightScopeLabel:
      highlightScope !== 'none' || Boolean(options.highlightedAssetId)
        ? highlightScopeLabel
        : null,
    highlightedAssetId: options.highlightedAssetId,
    onHighlightAssetId: options.onHighlightAssetIdChange,
    references: selectedReferences,
    diagnostic: selectedDiagnostic,
    heatmapEnabled,
    chrRegions: options.chrRegions,
    mappingIndex,
    history: options.history,
    editorState: options.editorState,
    onEditorStateChange: options.onEditorStateChange,
    onTilePixelsChange: options.onTilePixelsChange,
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
      } else if (ref.type === 'background') {
        if (options.onNavigateToBackground) {
          options.onNavigateToBackground(ref.mapId, ref.nametableIndex);
        } else if (options.onNavigateToWorkspace) {
          options.onNavigateToWorkspace('background');
        }
      } else {
        if (options.onNavigateToTileset) {
          options.onNavigateToTileset(ref.tileIndex);
        } else if (options.onNavigateToWorkspace) {
          options.onNavigateToWorkspace('tileset');
        }
      }
    },
    onNavigateToAnimation: options.onNavigateToAnimation,
    onNavigateToPlayfield: options.onNavigateToPlayfield,
    onNavigateToBackground: options.onNavigateToBackground,
    onNavigateToTileset: options.onNavigateToTileset,
    onDeselect: () => {
      if (options.onSelectTile) {
        options.onSelectTile(null);
      }
    },
  });

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

  if (options.onDownloadBytes && options.placementAvailable !== false) {
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

  const regionManagerPanel = createChrRegionManagerPanel({
    chrRegions: options.chrRegions,
    classifications,
    onUpdateChrRegions: options.onUpdateChrRegions,
  });

  const assetMetricsPanel = createChrAssetMetricsPanel(
    options,
    mappingIndex,
    metrics.finalChrBytes,
  );

  workspace.append(
    introPanel,
    viewerPanel,
    tileInspector,
    regionManagerPanel,
    assetMetricsPanel,
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
    const slotEl = viewerPanel.querySelector<HTMLElement>(
      `[data-physical-index="${String(options.selectedTileIndex)}"]`,
    );
    if (slotEl) {
      if (typeof slotEl.scrollIntoView === 'function') {
        slotEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      if (typeof slotEl.focus === 'function') {
        slotEl.focus();
      }
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
    regionManagerElement: {
      value: regionManagerPanel,
      enumerable: true,
    },
  });
  return result;
}
