import './style.css';

import { encodeChr } from './core/chr-encoder';
import { analyzeImage } from './core/image-analysis';
import {
  encodePlayfield,
  PlayfieldEncodingError,
} from './core/playfield-encoder';
import { deduplicateTiles } from './core/tile-deduplication';
import { extractTiles } from './core/tile-extraction';
import { ImageAnalysisError } from './core/types';
import { getLocale, subscribeToLocale, t } from './i18n';
import { createDiagnostics } from './ui/diagnostics';
import { createExportPanel } from './ui/export-panel';
import { createHeader } from './ui/header';
import { createImageInput } from './ui/image-input';
import { createImagePreview } from './ui/image-preview';
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
  toNametableFileName,
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
  error: null,
  loading: false,
};

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
  let visibleTiles = project.deduplicationEnabled
    ? deduplicateTiles(project.tiles)
    : project.tiles;
  let nametable: Uint8Array | null = null;
  let attributeTable: Uint8Array | null = null;
  let conversionError = project.error;

  if (project.mode === 'playfield' && project.indexedImage !== null) {
    try {
      const playfield = encodePlayfield(
        project.indexedImage,
        project.tiles,
        project.deduplicationEnabled,
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

  const chr = project.indexedImage === null ? null : encodeChr(visibleTiles);
  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  workspace.append(
    createImageInput(
      project.fileName,
      project.width,
      project.height,
      project.loading,
      project.mode,
      (mode) => {
        project = {
          ...project,
          mode,
          deduplicationEnabled:
            mode === 'playfield' ? true : project.deduplicationEnabled,
        };
        render();
      },
      (file) => void loadFile(file),
    ),
    createImagePreview(project.sourceImage),
    createDiagnostics({
      width: project.width,
      height: project.height,
      indexedImage: project.indexedImage,
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
      project.tiles.length,
      project.deduplicationEnabled,
      (enabled) => {
        project = { ...project, deduplicationEnabled: enabled };
        render();
      },
    ),
    createExportPanel({
      chrName: outputName,
      nametableName,
      attributeTableName,
      tileCount: visibleTiles.length,
      originalTileCount: project.tiles.length,
      deduplicationEnabled: project.deduplicationEnabled,
      playfieldMode: project.mode === 'playfield',
      chr,
      nametable,
      attributeTable,
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
  project = {
    fileName: file.name,
    width: null,
    height: null,
    sourceImage: null,
    indexedImage: null,
    tiles: [],
    mode,
    deduplicationEnabled,
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
    const tiles = extractTiles(indexedImage);
    project = {
      ...project,
      indexedImage,
      tiles,
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

subscribeToLocale(render);
render();
