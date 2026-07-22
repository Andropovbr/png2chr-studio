import './style.css';

import { encodeChr } from './core/chr-encoder';
import {
  countCollisionCells,
  createEmptyCollisionMap,
  encodeCollisionMap,
} from './core/collision-encoder';
import { analyzeImage } from './core/image-analysis';
import {
  createDefaultNesPaletteSet,
  createPaletteAssignments,
  createPixelOverrides,
  encodeNesBackgroundPalettes,
  mapImageToNesPalettes,
  PLAYFIELD_PALETTE_REGION_SIZE,
  renderNesPaletteImage,
  setNesPaletteColor,
  TILESET_PALETTE_REGION_SIZE,
} from './core/nes-palette';
import {
  encodePlayfield,
  PlayfieldEncodingError,
} from './core/playfield-encoder';
import { generateRandomPlayfield } from './core/random-playfield';
import {
  deduplicateTiles,
  deduplicateTilesConsideringFlips,
} from './core/tile-deduplication';
import { extractTiles } from './core/tile-extraction';
import { ImageAnalysisError, type IndexedImage } from './core/types';
import { getLocale, subscribeToLocale, t } from './i18n';
import { createDiagnostics } from './ui/diagnostics';
import { createExportPanel } from './ui/export-panel';
import { createHeader } from './ui/header';
import { createImageInput } from './ui/image-input';
import { createImagePreview } from './ui/image-preview';
import { createPaletteEditor } from './ui/palette-editor';
import { createTileGrid } from './ui/tile-grid';
import {
  displayErrorFromAnalysis,
  displayErrorFromPlayfield,
  type DisplayError,
  type ProjectView,
} from './ui/types';
import { downloadBytes } from './utils/download';
import {
  toAttributeTableFileName,
  toChrFileName,
  toCollisionMapFileName,
  toNametableFileName,
  toPaletteFileName,
} from './utils/file-name';

const appElement = document.querySelector<HTMLElement>('#app');
if (appElement === null) {
  throw new Error('Application root element was not found.');
}
const app: HTMLElement = appElement;

let requestId = 0;
let project: ProjectView = {
  fileName: null,
  width: null,
  height: null,
  sourceImage: null,
  indexedImage: null,
  tiles: [],
  mode: 'tileset',
  deduplicationEnabled: false,
  flipDeduplicationEnabled: false,
  collisionCells: createEmptyCollisionMap(),
  paletteSet: createDefaultNesPaletteSet(),
  paletteAssignments: new Uint8Array(),
  previewTool: 'palette',
  pixelOverrides: new Uint8Array(),
  activePaletteIndex: 0,
  activeColorIndex: 1,
  showPaletteNumbers: false,
  zoomedPaletteRegion: null,
  paletteColorTarget: { paletteIndex: 0, colorIndex: 1 },
  error: null,
  loading: false,
};

function paletteRegionSize(
  mode: ProjectView['mode'],
  image: IndexedImage | null,
): number {
  return mode === 'playfield' && image?.width === 256 && image.height === 240
    ? PLAYFIELD_PALETTE_REGION_SIZE
    : TILESET_PALETTE_REGION_SIZE;
}

function assignmentsForImage(
  image: IndexedImage,
  mode: ProjectView['mode'],
): Uint8Array {
  return createPaletteAssignments(
    image.width,
    image.height,
    paletteRegionSize(mode, image),
  );
}

function render(): void {
  document.documentElement.lang = getLocale();
  document.title = t('appTitle');
  const outputName =
    project.fileName === null
      ? t('defaultOutputName')
      : toChrFileName(project.fileName);
  const nametableName =
    project.fileName === null
      ? t('defaultNametableName')
      : toNametableFileName(project.fileName);
  const attributeTableName =
    project.fileName === null
      ? t('defaultAttributeTableName')
      : toAttributeTableFileName(project.fileName);
  const collisionMapName =
    project.fileName === null
      ? t('defaultCollisionMapName')
      : toCollisionMapFileName(project.fileName);
  const paletteName =
    project.fileName === null
      ? t('defaultPaletteName')
      : toPaletteFileName(project.fileName);
  const regionSize = paletteRegionSize(project.mode, project.indexedImage);
  const mappedImage =
    project.indexedImage === null
      ? null
      : mapImageToNesPalettes(
          project.indexedImage,
          project.paletteSet,
          project.paletteAssignments,
          regionSize,
          project.pixelOverrides,
        );
  const mappedTiles = mappedImage === null ? [] : extractTiles(mappedImage);
  let visibleTiles = project.deduplicationEnabled
    ? project.mode === 'tileset' && project.flipDeduplicationEnabled
      ? deduplicateTilesConsideringFlips(mappedTiles)
      : deduplicateTiles(mappedTiles)
    : mappedTiles;
  let nametable: Uint8Array | null = null;
  let attributeTable: Uint8Array | null = null;
  let conversionError = project.error;

  if (project.mode === 'playfield' && mappedImage !== null) {
    try {
      const playfield = encodePlayfield(
        mappedImage,
        mappedTiles,
        project.deduplicationEnabled,
        project.paletteAssignments,
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

  const chr = mappedImage === null ? null : encodeChr(visibleTiles);
  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  const editingWorkspace = document.createElement('div');
  editingWorkspace.className = 'playfield-editing-workspace';
  editingWorkspace.append(
    createImagePreview({
      image:
        mappedImage === null
          ? project.sourceImage
          : new ImageData(
              renderNesPaletteImage(
                mappedImage,
                project.paletteSet,
                project.paletteAssignments,
                regionSize,
              ),
              mappedImage.width,
              mappedImage.height,
            ),
      collisionCells:
        project.mode === 'playfield' && project.indexedImage !== null
          ? project.collisionCells
          : null,
      paletteAssignments:
        project.indexedImage === null ? null : project.paletteAssignments,
      paletteRegionSize: project.indexedImage === null ? null : regionSize,
      showPaletteNumbers: project.showPaletteNumbers,
      selectedPaletteRegion: project.zoomedPaletteRegion,
      activeTool: project.previewTool,
      onActiveToolChange: (previewTool) => {
        project = { ...project, previewTool };
        render();
      },
      onCollisionChange: (collisionCells) => {
        project = { ...project, collisionCells };
        render();
      },
      onPaletteRegionSelect: (zoomedPaletteRegion) => {
        project = { ...project, zoomedPaletteRegion };
        render();
      },
    }),
    createPaletteEditor({
      image: project.indexedImage,
      paletteSet: project.paletteSet,
      assignments: project.paletteAssignments,
      regionSize,
      activePaletteIndex: project.activePaletteIndex,
      activeColorIndex: project.activeColorIndex,
      showPaletteNumbers: project.showPaletteNumbers,
      zoomedRegionIndex: project.zoomedPaletteRegion,
      colorTarget: project.paletteColorTarget,
      onActivePaletteChange: (activePaletteIndex) => {
        project = { ...project, activePaletteIndex };
        render();
      },
      onActiveColorChange: (activeColorIndex) => {
        project = { ...project, activeColorIndex };
        render();
      },
      onShowPaletteNumbersChange: (showPaletteNumbers) => {
        project = { ...project, showPaletteNumbers };
        render();
      },
      onZoomedRegionChange: (zoomedPaletteRegion) => {
        project = { ...project, zoomedPaletteRegion };
        render();
      },
      onColorTargetChange: (paletteColorTarget) => {
        project = { ...project, paletteColorTarget };
        render();
      },
      onPaletteColorChange: (paletteIndex, colorIndex, colorCode) => {
        project = {
          ...project,
          paletteSet: setNesPaletteColor(
            project.paletteSet,
            paletteIndex,
            colorIndex,
            colorCode,
          ),
        };
        render();
      },
      pixelOverrides: project.pixelOverrides,
      onPixelOverridesChange: (pixelOverrides, paletteAssignments) => {
        project = { ...project, pixelOverrides, paletteAssignments };
        render();
      },
    }),
  );
  workspace.append(
    createImageInput(
      project.fileName,
      project.width,
      project.height,
      project.loading,
      project.mode,
      (mode) => {
        const paletteAssignments =
          project.indexedImage === null
            ? new Uint8Array()
            : assignmentsForImage(project.indexedImage, mode);
        project = {
          ...project,
          mode,
          deduplicationEnabled:
            mode === 'playfield' ? true : project.deduplicationEnabled,
          flipDeduplicationEnabled:
            mode === 'playfield' ? false : project.flipDeduplicationEnabled,
          paletteAssignments,
          zoomedPaletteRegion: null,
        };
        render();
      },
      (file) => void loadFile(file),
      generatePlayfield,
    ),
    editingWorkspace,
    createDiagnostics({
      width: project.width,
      height: project.height,
      indexedImage: mappedImage,
      tileCount: visibleTiles.length,
      chrSize: chr?.length ?? null,
      playfieldMode: project.mode === 'playfield',
      nametableSize: nametable?.length ?? null,
      attributeTableSize: attributeTable?.length ?? null,
      error: conversionError,
    }),
    createTileGrid(
      visibleTiles,
      project.indexedImage,
      mappedTiles.length,
      project.deduplicationEnabled,
      (enabled) => {
        project = {
          ...project,
          deduplicationEnabled: enabled,
          flipDeduplicationEnabled: enabled
            ? project.flipDeduplicationEnabled
            : false,
        };
        render();
      },
      project.mode === 'tileset',
      project.flipDeduplicationEnabled,
      (enabled) => {
        project = { ...project, flipDeduplicationEnabled: enabled };
        render();
      },
      project.paletteSet,
      project.paletteAssignments,
      regionSize,
    ),
    createExportPanel({
      chrName: outputName,
      nametableName,
      attributeTableName,
      collisionMapName,
      paletteName,
      tileCount: visibleTiles.length,
      originalTileCount: mappedTiles.length,
      deduplicationEnabled: project.deduplicationEnabled,
      flipDeduplicationEnabled: project.flipDeduplicationEnabled,
      playfieldMode: project.mode === 'playfield',
      chr,
      nametable,
      attributeTable,
      collisionMap:
        project.mode === 'playfield' && nametable !== null
          ? encodeCollisionMap(project.collisionCells)
          : null,
      palette: encodeNesBackgroundPalettes(project.paletteSet),
      collisionCellCount: countCollisionCells(project.collisionCells),
      onDownload: downloadBytes,
    }),
  );
  app.replaceChildren(createHeader(), workspace);
}

function setProjectError(error: DisplayError): void {
  project = {
    ...project,
    indexedImage: null,
    tiles: [],
    error,
    loading: false,
  };
  render();
}

async function decodeImage(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) {
      throw new Error('Canvas 2D is unavailable.');
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function loadFile(file: File): Promise<void> {
  const activeRequest = ++requestId;
  const mode = project.mode;
  const deduplicationEnabled = project.deduplicationEnabled;
  const flipDeduplicationEnabled = project.flipDeduplicationEnabled;
  const paletteSet = project.paletteSet;
  const activePaletteIndex = project.activePaletteIndex;
  const paletteColorTarget = project.paletteColorTarget;
  const activeColorIndex = project.activeColorIndex;
  const showPaletteNumbers = project.showPaletteNumbers;
  project = {
    fileName: file.name,
    width: null,
    height: null,
    sourceImage: null,
    indexedImage: null,
    tiles: [],
    mode,
    deduplicationEnabled,
    flipDeduplicationEnabled,
    collisionCells: createEmptyCollisionMap(),
    paletteSet,
    paletteAssignments: new Uint8Array(),
    previewTool: 'palette',
    pixelOverrides: new Uint8Array(),
    activePaletteIndex,
    activeColorIndex,
    showPaletteNumbers,
    zoomedPaletteRegion: null,
    paletteColorTarget,
    error: null,
    loading: true,
  };
  render();

  if (file.type !== 'image/png' || !file.name.toLowerCase().endsWith('.png')) {
    setProjectError({ key: 'invalidFileType' });
    return;
  }

  let imageData: ImageData;
  try {
    imageData = await decodeImage(file);
  } catch {
    if (activeRequest === requestId) {
      setProjectError({ key: 'imageDecodeFailed' });
    }
    return;
  }

  if (activeRequest !== requestId) {
    return;
  }

  project = {
    ...project,
    width: imageData.width,
    height: imageData.height,
    sourceImage: imageData,
  };

  try {
    const indexedImage = analyzeImage(imageData);
    const paletteAssignments = assignmentsForImage(indexedImage, mode);
    const pixelOverrides = createPixelOverrides(
      indexedImage.width,
      indexedImage.height,
    );
    const mappedImage = mapImageToNesPalettes(
      indexedImage,
      paletteSet,
      paletteAssignments,
      paletteRegionSize(mode, indexedImage),
      pixelOverrides,
    );
    const tiles = extractTiles(mappedImage);
    project = {
      ...project,
      indexedImage,
      tiles,
      paletteAssignments,
      pixelOverrides,
      error: null,
      loading: false,
    };
    render();
  } catch (error: unknown) {
    setProjectError(
      error instanceof ImageAnalysisError
        ? displayErrorFromAnalysis(error)
        : { key: 'invalidPixelData' },
    );
  }
}

function indexedImageToImageData(image: IndexedImage): ImageData {
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let index = 0; index < image.pixels.length; index += 1) {
    const color = image.colors[image.pixels[index] ?? 0] ?? {
      red: 0,
      green: 0,
      blue: 0,
    };
    const target = index * 4;
    rgba[target] = color.red;
    rgba[target + 1] = color.green;
    rgba[target + 2] = color.blue;
    rgba[target + 3] = 255;
  }
  return new ImageData(rgba, image.width, image.height);
}

function generatePlayfield(): void {
  requestId += 1;
  const indexedImage = generateRandomPlayfield();
  const paletteAssignments = assignmentsForImage(indexedImage, 'playfield');
  const paletteSet = createDefaultNesPaletteSet();
  const pixelOverrides = createPixelOverrides(
    indexedImage.width,
    indexedImage.height,
  );
  const mappedImage = mapImageToNesPalettes(
    indexedImage,
    paletteSet,
    paletteAssignments,
    PLAYFIELD_PALETTE_REGION_SIZE,
    pixelOverrides,
  );
  project = {
    fileName: 'random-playfield.png',
    width: indexedImage.width,
    height: indexedImage.height,
    sourceImage: indexedImageToImageData(indexedImage),
    indexedImage,
    tiles: extractTiles(mappedImage),
    mode: 'playfield',
    deduplicationEnabled: true,
    flipDeduplicationEnabled: false,
    collisionCells: createEmptyCollisionMap(),
    paletteSet,
    paletteAssignments,
    previewTool: 'palette',
    pixelOverrides,
    activePaletteIndex: 0,
    activeColorIndex: 1,
    showPaletteNumbers: false,
    zoomedPaletteRegion: null,
    paletteColorTarget: { paletteIndex: 0, colorIndex: 1 },
    error: null,
    loading: false,
  };
  render();
}

subscribeToLocale(render);
render();
