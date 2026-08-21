import { encodeChr } from '../core/chr-encoder';
import { padChrRom } from '../core/chr-rom';
import {
  countCollisionCells,
  encodeCollisionMap,
  type CollisionType,
} from '../core/collision-encoder';
import {
  encodeNesBackgroundPalettes,
  mapImageToNesPalettes,
  PLAYFIELD_PALETTE_REGION_SIZE,
  renderNesPaletteImage,
  TILESET_PALETTE_REGION_SIZE,
  type NesPaletteSet,
} from '../core/nes-palette';
import {
  encodePlayfield,
  PlayfieldEncodingError,
} from '../core/playfield-encoder';
import type { RandomPlayfieldFeature } from '../core/random-playfield';
import { deduplicateTiles } from '../core/tile-deduplication';
import { extractTiles } from '../core/tile-extraction';
import type { IndexedImage, Tile } from '../core/types';
import type { QuantizationSettings } from '../core/quantization-settings';
import { t } from '../i18n';
import { createDiagnostics } from './diagnostics';
import { createExportPanel } from './export-panel';
import { mountImageEditingPanels } from './image-editing-workspace';
import { createImageInput } from './image-input';
import { createImagePreview } from './image-preview';
import { createPaletteEditor, type PaletteColorTarget } from './palette-editor';
import {
  createQuantizationPanel,
  type QuantizationPreview,
} from './quantization-panel';
import { createTileGrid } from './tile-grid';
import {
  displayErrorFromPlayfield,
  type DisplayError,
  type PreviewTool,
  type ProjectMode,
} from './types';
import {
  toAttributeTableFileName,
  toChrFileName,
  toCollisionMapFileName,
  toNametableFileName,
  toPaletteFileName,
} from '../utils/file-name';

export interface PlayfieldWorkspaceOptions {
  readonly fileName: string | null;
  readonly sourceKind: 'png' | 'chr' | 'nes' | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly sourceImage: ImageData | null;
  readonly indexedImage: IndexedImage | null;
  readonly tiles: readonly Tile[];
  readonly deduplicationEnabled: boolean;
  readonly collisionCells: Uint8Array;
  readonly activeCollisionType: CollisionType;
  readonly randomPlayfieldFeatures: readonly RandomPlayfieldFeature[];
  readonly paletteSet: NesPaletteSet;
  readonly paletteAssignments: Uint8Array;
  readonly pixelOverrides: Uint8Array;
  readonly activePaletteIndex: number;
  readonly activeColorIndex: number;
  readonly quantizationSettings: QuantizationSettings;
  readonly quantizationPreviews: readonly QuantizationPreview[];
  readonly quantizationPreviewsLoading: boolean;
  readonly quantizationCollapsed: boolean;
  readonly showPaletteNumbers: boolean;
  readonly previewTool: PreviewTool;
  readonly zoomedPaletteRegion: number | null;
  readonly paletteColorTarget: PaletteColorTarget;
  readonly loading: boolean;
  readonly error: DisplayError | null;
  readonly onModeChange: (mode: ProjectMode) => void;
  readonly onFile: (file: File) => void;
  readonly onRandomPlayfieldFeaturesChange: (
    features: readonly RandomPlayfieldFeature[],
  ) => void;
  readonly onGeneratePlayfield: () => void;
  readonly onToggleQuantizationCollapse: () => void;
  readonly onQuantizationSettingsChange: (
    settings: QuantizationSettings,
  ) => void;
  readonly onActiveToolChange: (tool: PreviewTool) => void;
  readonly onCollisionChange: (cells: Uint8Array) => void;
  readonly onCollisionTypeChange: (type: CollisionType) => void;
  readonly onPaletteRegionSelect: (regionIndex: number) => void;
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
    paletteAssignments: Uint8Array,
  ) => void;
  readonly onDeduplicationChange: (enabled: boolean) => void;
  readonly onDownloadBytes: (bytes: Uint8Array, fileName: string) => void;
}

export interface PlayfieldWorkspaceElement extends HTMLElement {
  readonly diagnosticsElement: HTMLElement;
}

export function createPlayfieldWorkspace(
  options: PlayfieldWorkspaceOptions,
): PlayfieldWorkspaceElement {
  const outputName =
    options.fileName === null
      ? t('defaultOutputName')
      : toChrFileName(options.fileName);
  const nametableName =
    options.fileName === null
      ? t('defaultNametableName')
      : toNametableFileName(options.fileName);
  const attributeTableName =
    options.fileName === null
      ? t('defaultAttributeTableName')
      : toAttributeTableFileName(options.fileName);
  const collisionMapName =
    options.fileName === null
      ? t('defaultCollisionMapName')
      : toCollisionMapFileName(options.fileName);
  const paletteName =
    options.fileName === null
      ? t('defaultPaletteName')
      : toPaletteFileName(options.fileName);

  const regionSize =
    options.indexedImage?.width === 256 && options.indexedImage.height === 240
      ? PLAYFIELD_PALETTE_REGION_SIZE
      : TILESET_PALETTE_REGION_SIZE;

  const mappedImage =
    options.indexedImage === null
      ? null
      : mapImageToNesPalettes(
          options.indexedImage,
          options.paletteSet,
          options.paletteAssignments,
          regionSize,
          options.pixelOverrides,
          false,
          options.quantizationSettings.colorDistanceMode,
        );

  const mappedTiles =
    mappedImage === null
      ? []
      : extractTiles(mappedImage).slice(0, options.tiles.length);

  let visibleTiles = options.deduplicationEnabled
    ? deduplicateTiles(mappedTiles)
    : mappedTiles;

  let nametable: Uint8Array | null = null;
  let attributeTable: Uint8Array | null = null;
  let conversionError = options.error;

  if (mappedImage !== null) {
    try {
      const playfield = encodePlayfield(
        mappedImage,
        mappedTiles,
        options.deduplicationEnabled,
        options.paletteAssignments,
      );
      visibleTiles = playfield.chrTiles;
      nametable = playfield.nametable;
      attributeTable = playfield.attributeTable;
    } catch (error: unknown) {
      if (error instanceof PlayfieldEncodingError) {
        conversionError = displayErrorFromPlayfield(error);
      }
    }
  }

  const chr = mappedImage === null ? null : padChrRom(encodeChr(visibleTiles));

  const workspaceElement = document.createElement(
    'div',
  ) as unknown as PlayfieldWorkspaceElement;
  workspaceElement.className = 'workspace';

  const editingWorkspace = document.createElement('div');
  editingWorkspace.className = 'playfield-editing-workspace';

  const projectImageInput = createImageInput(
    options.fileName,
    options.width,
    options.height,
    options.loading,
    'playfield',
    options.randomPlayfieldFeatures,
    options.onModeChange,
    options.onRandomPlayfieldFeaturesChange,
    options.onFile,
    options.onGeneratePlayfield,
  );
  projectImageInput.id = 'section-image';

  const imagePreview = createImagePreview({
    image:
      mappedImage === null
        ? options.sourceImage
        : new ImageData(
            renderNesPaletteImage(
              mappedImage,
              options.paletteSet,
              options.paletteAssignments,
              regionSize,
            ),
            mappedImage.width,
            mappedImage.height,
          ),
    collisionCells:
      options.indexedImage !== null ? options.collisionCells : null,
    paletteAssignments:
      options.indexedImage === null ? null : options.paletteAssignments,
    paletteRegionSize: options.indexedImage === null ? null : regionSize,
    showPaletteNumbers: options.showPaletteNumbers,
    selectedPaletteRegion: options.zoomedPaletteRegion,
    activeTool: options.previewTool,
    activeCollisionType: options.activeCollisionType,
    onActiveToolChange: options.onActiveToolChange,
    onCollisionChange: options.onCollisionChange,
    onCollisionTypeChange: options.onCollisionTypeChange,
    onPaletteRegionSelect: options.onPaletteRegionSelect,
  });

  const paletteEditor = createPaletteEditor({
    image: options.indexedImage,
    paletteSet: options.paletteSet,
    assignments: options.paletteAssignments,
    regionSize,
    activePaletteIndex: options.activePaletteIndex,
    activeColorIndex: options.activeColorIndex,
    showPaletteNumbers: options.showPaletteNumbers,
    zoomedRegionIndex: options.zoomedPaletteRegion,
    colorTarget: options.paletteColorTarget,
    onActivePaletteChange: options.onActivePaletteChange,
    onActiveColorChange: options.onActiveColorChange,
    onShowPaletteNumbersChange: options.onShowPaletteNumbersChange,
    onZoomedRegionChange: options.onZoomedRegionChange,
    onColorTargetChange: options.onColorTargetChange,
    onPaletteColorChange: options.onPaletteColorChange,
    pixelOverrides: options.pixelOverrides,
    colorDistanceMode: options.quantizationSettings.colorDistanceMode,
    onPixelOverridesChange: options.onPixelOverridesChange,
  });

  mountImageEditingPanels(
    'playfield',
    (preview, editor) => {
      editingWorkspace.append(preview, editor);
    },
    imagePreview,
    paletteEditor,
  );

  const quantizationPanel = createQuantizationPanel({
    sourceImage: options.sourceImage,
    pngActive: options.sourceKind === 'png',
    settings: options.quantizationSettings,
    previews: options.quantizationPreviews,
    previewsLoading: options.quantizationPreviewsLoading,
    isCollapsed: options.quantizationCollapsed,
    onToggleCollapse: options.onToggleQuantizationCollapse,
    onSettingsChange: options.onQuantizationSettingsChange,
  });
  quantizationPanel.id = 'section-quantization';

  const noop = (): void => {
    // no-op
  };

  const tileGrid = createTileGrid(
    visibleTiles,
    options.indexedImage,
    mappedTiles.length,
    options.deduplicationEnabled,
    options.onDeduplicationChange,
    false,
    false,
    noop,
    options.paletteSet,
    options.paletteAssignments,
    regionSize,
  );
  tileGrid.id = 'section-tiles';

  const exportPanel = createExportPanel({
    chrName: outputName,
    nametableName,
    attributeTableName,
    collisionMapName,
    paletteName,
    tileCount: visibleTiles.length,
    originalTileCount: mappedTiles.length,
    deduplicationEnabled: options.deduplicationEnabled,
    flipDeduplicationEnabled: false,
    playfieldMode: true,
    chr,
    nametable,
    attributeTable,
    collisionMap:
      nametable !== null ? encodeCollisionMap(options.collisionCells) : null,
    palette: encodeNesBackgroundPalettes(options.paletteSet),
    collisionCellCount: countCollisionCells(options.collisionCells),
    onDownload: options.onDownloadBytes,
  });
  exportPanel.id = 'section-export';

  const diagnosticsOptions = {
    width: options.width,
    height: options.height,
    indexedImage: mappedImage,
    tileCount: visibleTiles.length,
    chrSize: chr?.length ?? null,
    playfieldMode: true,
    nametableSize: nametable?.length ?? null,
    attributeTableSize: attributeTable?.length ?? null,
    error: conversionError,
  };

  const inlineDiagnostics = createDiagnostics(diagnosticsOptions);
  const hostDiagnostics = createDiagnostics(diagnosticsOptions);

  workspaceElement.append(
    projectImageInput,
    quantizationPanel,
    editingWorkspace,
    inlineDiagnostics,
    tileGrid,
    exportPanel,
  );

  Object.defineProperty(workspaceElement, 'diagnosticsElement', {
    value: hostDiagnostics,
    enumerable: true,
  });

  return workspaceElement;
}
