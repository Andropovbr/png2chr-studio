import './style.css';

import { encodeChr } from './core/chr-encoder';
import { analyzeImage } from './core/image-analysis';
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
  type DisplayError,
  type ProjectView,
} from './ui/types';
import { downloadBytes } from './utils/download';
import { toChrFileName } from './utils/file-name';

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
  chr: null,
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
  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  workspace.append(
    createImageInput(
      project.fileName,
      project.width,
      project.height,
      project.loading,
      (file) => void loadFile(file),
    ),
    createImagePreview(project.sourceImage),
    createDiagnostics({
      width: project.width,
      height: project.height,
      indexedImage: project.indexedImage,
      tileCount: project.tiles.length,
      chrSize: project.chr?.length ?? null,
      error: project.error,
    }),
    createTileGrid(project.tiles, project.indexedImage),
    createExportPanel(
      outputName,
      project.tiles.length,
      project.chr !== null,
      () => {
        if (project.chr !== null) {
          downloadBytes(project.chr, outputName);
        }
      },
    ),
  );
  app.replaceChildren(createHeader(), workspace);
}

function setProjectError(error: DisplayError): void {
  project = {
    ...project,
    indexedImage: null,
    tiles: [],
    chr: null,
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
  project = {
    fileName: file.name,
    width: null,
    height: null,
    sourceImage: null,
    indexedImage: null,
    tiles: [],
    chr: null,
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
      chr: encodeChr(tiles),
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
