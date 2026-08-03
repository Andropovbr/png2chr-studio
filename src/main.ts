import './style.css';

import {
  AnimationModelError,
  buildAnimationProjectModel,
} from './core/animation-model';
import type {
  AnimationDefinitionInput,
  AnimationProjectModel,
} from './core/animation-model';
import { sanitizeCIdentifier } from './core/animation-exporters';
import { encodeChr } from './core/chr-encoder';
import {
  ChrDecodingError,
  chrTilesToIndexedImage,
  decodeChr,
} from './core/chr-decoder';
import {
  COLLISION_TYPES,
  countCollisionCells,
  createEmptyCollisionMap,
  encodeCollisionMap,
} from './core/collision-encoder';
import { analyzeImage } from './core/image-analysis';
import { extractNromChr, InesRomError } from './core/ines-rom';
import {
  createDefaultNesPaletteSet,
  createPaletteAssignments,
  createPixelOverrides,
  encodeNesBackgroundPalettes,
  mapImageToNesPalettes,
  NES_MASTER_PALETTE,
  PLAYFIELD_PALETTE_REGION_SIZE,
  renderNesPaletteImage,
  setNesPaletteColor,
  TILESET_PALETTE_REGION_SIZE,
} from './core/nes-palette';
import {
  encodePlayfield,
  PlayfieldEncodingError,
} from './core/playfield-encoder';
import {
  DEFAULT_RANDOM_PLAYFIELD_FEATURES,
  generateRandomPlayfield,
} from './core/random-playfield';
import {
  deduplicateTiles,
  deduplicateTilesConsideringFlips,
} from './core/tile-deduplication';
import { extractTiles } from './core/tile-extraction';
import { ImageAnalysisError, type IndexedImage } from './core/types';
import { getLocale, subscribeToLocale, t } from './i18n';
import { createDiagnostics } from './ui/diagnostics';
import { createAnimationEditor } from './ui/animation-editor';
import { createExportPanel } from './ui/export-panel';
import { createHeader } from './ui/header';
import { createImageInput } from './ui/image-input';
import { createImagePreview } from './ui/image-preview';
import { createPaletteEditor } from './ui/palette-editor';
import { createTileGrid } from './ui/tile-grid';
import {
  displayErrorFromAnalysis,
  displayErrorFromInes,
  displayErrorFromPlayfield,
  type DisplayError,
  type AnimationSettings,
  type ProjectMode,
  type ProjectView,
} from './ui/types';
import { downloadBytes, downloadText } from './utils/download';
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

function createDefaultAnimationSettings(): AnimationSettings {
  return {
    name: 'player',
    frameWidth: 16,
    frameHeight: 16,
    selectionTarget: 'idle',
    idleFrames: [],
    movementFrames: [],
    idleDuration: 12,
    movementDuration: 6,
    idleFrameDurations: [],
    movementFrameDurations: [],
    flipDeduplication: true,
    spritePalette: 0,
    originX: 0,
    originY: 0,
    destinationChrName: null,
    destinationChr: new Uint8Array(),
  };
}

let requestId = 0;
let project: ProjectView = {
  fileName: null,
  sourceKind: null,
  width: null,
  height: null,
  sourceImage: null,
  indexedImage: null,
  tiles: [],
  mode: 'tileset',
  deduplicationEnabled: false,
  flipDeduplicationEnabled: false,
  collisionCells: createEmptyCollisionMap(),
  activeCollisionType: COLLISION_TYPES.solid,
  randomPlayfieldFeatures: [...DEFAULT_RANDOM_PLAYFIELD_FEATURES],
  paletteSet: createDefaultNesPaletteSet(),
  paletteAssignments: new Uint8Array(),
  previewTool: 'palette',
  pixelOverrides: new Uint8Array(),
  activePaletteIndex: 0,
  activeColorIndex: 1,
  showPaletteNumbers: false,
  zoomedPaletteRegion: null,
  paletteColorTarget: { paletteIndex: 0, colorIndex: 1 },
  animation: createDefaultAnimationSettings(),
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

function changeMode(mode: ProjectMode): void {
  if (
    mode !== 'tileset' &&
    (project.sourceKind === 'chr' || project.sourceKind === 'nes')
  ) {
    project = {
      ...project,
      fileName: null,
      sourceKind: null,
      width: null,
      height: null,
      sourceImage: null,
      indexedImage: null,
      tiles: [],
      mode,
      deduplicationEnabled: mode === 'playfield',
      flipDeduplicationEnabled: false,
      collisionCells: createEmptyCollisionMap(),
      activeCollisionType: COLLISION_TYPES.solid,
      paletteAssignments: new Uint8Array(),
      pixelOverrides: new Uint8Array(),
      zoomedPaletteRegion: null,
      error: null,
    };
    render();
    return;
  }
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
}

function createProjectImageInput(): HTMLElement {
  return createImageInput(
    project.fileName,
    project.width,
    project.height,
    project.loading,
    project.mode,
    project.randomPlayfieldFeatures,
    changeMode,
    (randomPlayfieldFeatures) => {
      project = { ...project, randomPlayfieldFeatures };
      render();
    },
    (file) => void loadFile(file),
    generatePlayfield,
  );
}

function toggleAnimationFrame(frameIndex: number): void {
  const animation = project.animation;
  const inIdle = animation.idleFrames.includes(frameIndex);
  const inMovement = animation.movementFrames.includes(frameIndex);
  const idleFrames: number[] = [];
  const idleFrameDurations: number[] = [];
  animation.idleFrames.forEach((index, order) => {
    if (index === frameIndex) return;
    idleFrames.push(index);
    idleFrameDurations.push(
      animation.idleFrameDurations[order] ?? animation.idleDuration,
    );
  });
  const movementFrames: number[] = [];
  const movementFrameDurations: number[] = [];
  animation.movementFrames.forEach((index, order) => {
    if (index === frameIndex) return;
    movementFrames.push(index);
    movementFrameDurations.push(
      animation.movementFrameDurations[order] ?? animation.movementDuration,
    );
  });
  const alreadyInTarget =
    animation.selectionTarget === 'idle' ? inIdle : inMovement;
  if (!alreadyInTarget) {
    if (animation.selectionTarget === 'idle') {
      idleFrames.push(frameIndex);
      idleFrameDurations.push(animation.idleDuration);
    } else {
      movementFrames.push(frameIndex);
      movementFrameDurations.push(animation.movementDuration);
    }
  }
  project = {
    ...project,
    animation: {
      ...animation,
      idleFrames,
      movementFrames,
      idleFrameDurations,
      movementFrameDurations,
    },
    error: null,
  };
  render();
}

function moveAnimationFrame(
  category: 'idle' | 'movement',
  frameIndex: number,
  direction: -1 | 1,
): void {
  const key = category === 'idle' ? 'idleFrames' : 'movementFrames';
  const durationKey =
    category === 'idle' ? 'idleFrameDurations' : 'movementFrameDurations';
  const frames = [...project.animation[key]];
  const durations = [...project.animation[durationKey]];
  const current = frames.indexOf(frameIndex);
  const target = current + direction;
  if (current < 0 || target < 0 || target >= frames.length) return;
  [frames[current], frames[target]] = [
    frames[target] ?? 0,
    frames[current] ?? 0,
  ];
  [durations[current], durations[target]] = [
    durations[target] ??
      (category === 'idle'
        ? project.animation.idleDuration
        : project.animation.movementDuration),
    durations[current] ??
      (category === 'idle'
        ? project.animation.idleDuration
        : project.animation.movementDuration),
  ];
  project = {
    ...project,
    animation: {
      ...project.animation,
      [key]: frames,
      [durationKey]: durations,
    },
  };
  render();
}

function setAnimationFrameDuration(
  category: 'idle' | 'movement',
  frameIndex: number,
  duration: number,
): void {
  const frameKey = category === 'idle' ? 'idleFrames' : 'movementFrames';
  const durationKey =
    category === 'idle' ? 'idleFrameDurations' : 'movementFrameDurations';
  const order = project.animation[frameKey].indexOf(frameIndex);
  if (order < 0) return;
  const durations = [...project.animation[durationKey]];
  durations[order] = duration;
  project = {
    ...project,
    animation: { ...project.animation, [durationKey]: durations },
  };
  render();
}

async function loadAnimationDestination(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0 || bytes.length % 16 !== 0 || bytes.length > 4096) {
      throw new RangeError('Invalid animation destination CHR.');
    }
    project = {
      ...project,
      animation: {
        ...project.animation,
        destinationChrName: file.name,
        destinationChr: bytes,
      },
      error: null,
    };
  } catch {
    project = {
      ...project,
      error: { key: 'animationErrorDestination' },
    };
  }
  render();
}

function renderAnimationWorkspace(): void {
  const workspace = document.createElement('div');
  workspace.className = 'workspace animation-workspace';
  let mappedImage: IndexedImage | null = null;
  let previewImage: ImageData | null = project.sourceImage;
  let model: AnimationProjectModel | null = null;
  let modelError: AnimationModelError | null = null;

  if (project.indexedImage !== null) {
    const assignments = new Uint8Array(project.paletteAssignments.length).fill(
      project.animation.spritePalette,
    );
    mappedImage = mapImageToNesPalettes(
      project.indexedImage,
      project.paletteSet,
      assignments,
      TILESET_PALETTE_REGION_SIZE,
      project.pixelOverrides,
    );
    const previewPixels = renderNesPaletteImage(
      mappedImage,
      project.paletteSet,
      assignments,
      TILESET_PALETTE_REGION_SIZE,
    );
    mappedImage.pixels.forEach((colorIndex, pixelIndex) => {
      if (colorIndex === 0) previewPixels[pixelIndex * 4 + 3] = 0;
    });
    previewImage = new ImageData(
      previewPixels,
      mappedImage.width,
      mappedImage.height,
    );
    try {
      const definitions: AnimationDefinitionInput[] = [];
      if (project.animation.idleFrames.length > 0) {
        definitions.push({
          name: 'idle',
          category: 'idle' as const,
          frameIndices: project.animation.idleFrames,
          frameDuration: project.animation.idleDuration,
          frameDurations: project.animation.idleFrameDurations,
        });
      }
      if (project.animation.movementFrames.length > 0) {
        definitions.push({
          name: 'movement',
          category: 'movement' as const,
          frameIndices: project.animation.movementFrames,
          frameDuration: project.animation.movementDuration,
          frameDurations: project.animation.movementFrameDurations,
        });
      }
      const safeName = sanitizeCIdentifier(project.animation.name);
      model = buildAnimationProjectModel({
        name: project.animation.name,
        sourceImageName: project.fileName ?? 'sprites.png',
        image: mappedImage,
        frameWidth: project.animation.frameWidth,
        frameHeight: project.animation.frameHeight,
        animations: definitions,
        baseChr: project.animation.destinationChr,
        chrOutputName: `${safeName}.chr`,
        capacityTiles: 256,
        flipDeduplication: project.animation.flipDeduplication,
        spritePalette: project.animation.spritePalette,
        originX: project.animation.originX,
        originY: project.animation.originY,
      });
    } catch (error: unknown) {
      if (error instanceof AnimationModelError) modelError = error;
      else throw error;
    }
  }

  const editorOptions = {
    image: previewImage,
    settings: project.animation,
    model,
    modelError,
    paletteSet: project.paletteSet,
    paletteColorTarget: project.paletteColorTarget,
    onSettingsChange: (animation: AnimationSettings) => {
      project = { ...project, animation, error: null };
      render();
    },
    onFrameToggle: toggleAnimationFrame,
    onFrameMove: moveAnimationFrame,
    onFrameDurationChange: setAnimationFrameDuration,
    onSpritePaletteSelectionChange: (
      paletteIndex: number,
      colorIndex: number,
    ) => {
      project = {
        ...project,
        animation: { ...project.animation, spritePalette: paletteIndex },
        paletteColorTarget: { paletteIndex, colorIndex },
        error: null,
      };
      render();
    },
    onPaletteColorChange: (
      paletteIndex: number,
      colorIndex: number,
      colorCode: number,
    ) => {
      project = {
        ...project,
        paletteSet: setNesPaletteColor(
          project.paletteSet,
          paletteIndex,
          colorIndex,
          colorCode,
        ),
        paletteColorTarget: { paletteIndex, colorIndex },
        error: null,
      };
      render();
    },
    onDestinationFile: (file: File) => void loadAnimationDestination(file),
    onDestinationClear: () => {
      project = {
        ...project,
        animation: {
          ...project.animation,
          destinationChrName: null,
          destinationChr: new Uint8Array(),
        },
        error: null,
      };
      render();
    },
    onDownloadBytes: downloadBytes,
    onDownloadText: downloadText,
  };
  workspace.append(
    createProjectImageInput(),
    ...createAnimationEditor(editorOptions),
  );
  if (project.error !== null) {
    const error = document.createElement('section');
    error.className = 'panel error-panel animation-error-panel';
    const heading = document.createElement('h2');
    heading.textContent = t('errorTitle');
    const message = document.createElement('p');
    message.textContent = t(project.error.key, project.error.variables);
    error.append(heading, message);
    workspace.append(error);
  }
  app.replaceChildren(createHeader(), workspace);
}

function render(): void {
  document.documentElement.lang = getLocale();
  document.title = t('appTitle');
  if (project.mode === 'animation') {
    renderAnimationWorkspace();
    return;
  }
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
  const mappedTiles =
    mappedImage === null
      ? []
      : extractTiles(mappedImage).slice(0, project.tiles.length);
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
      activeCollisionType: project.activeCollisionType,
      onActiveToolChange: (previewTool) => {
        project = { ...project, previewTool };
        render();
      },
      onCollisionChange: (collisionCells) => {
        project = { ...project, collisionCells };
        render();
      },
      onCollisionTypeChange: (activeCollisionType) => {
        project = {
          ...project,
          activeCollisionType,
          previewTool: 'paint-collision',
        };
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
    createProjectImageInput(),
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
  const lowerCaseName = file.name.toLowerCase();
  const isChrFile = lowerCaseName.endsWith('.chr');
  const isNesFile = lowerCaseName.endsWith('.nes');
  const isPngFile = lowerCaseName.endsWith('.png');
  if ((isChrFile || isNesFile) && project.mode !== 'tileset') {
    project = {
      ...project,
      error: { key: 'chrTilesetOnly' },
      loading: false,
    };
    render();
    return;
  }

  const activeRequest = ++requestId;
  const mode = project.mode;
  const deduplicationEnabled = project.deduplicationEnabled;
  const flipDeduplicationEnabled = project.flipDeduplicationEnabled;
  const paletteSet = project.paletteSet;
  const activePaletteIndex = project.activePaletteIndex;
  const paletteColorTarget = project.paletteColorTarget;
  const activeColorIndex = project.activeColorIndex;
  const showPaletteNumbers = project.showPaletteNumbers;
  const randomPlayfieldFeatures = project.randomPlayfieldFeatures;
  const animation = project.animation;
  project = {
    fileName: file.name,
    sourceKind: isChrFile
      ? 'chr'
      : isNesFile
        ? 'nes'
        : isPngFile
          ? 'png'
          : null,
    width: null,
    height: null,
    sourceImage: null,
    indexedImage: null,
    tiles: [],
    mode,
    deduplicationEnabled,
    flipDeduplicationEnabled,
    collisionCells: createEmptyCollisionMap(),
    activeCollisionType: COLLISION_TYPES.solid,
    randomPlayfieldFeatures,
    paletteSet,
    paletteAssignments: new Uint8Array(),
    previewTool: 'palette',
    pixelOverrides: new Uint8Array(),
    activePaletteIndex,
    activeColorIndex,
    showPaletteNumbers,
    zoomedPaletteRegion: null,
    paletteColorTarget,
    animation,
    error: null,
    loading: true,
  };
  render();

  if (!isChrFile && !isNesFile && (!isPngFile || file.type !== 'image/png')) {
    setProjectError({ key: 'invalidFileType' });
    return;
  }

  if (isChrFile || isNesFile) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (activeRequest === requestId) {
        setProjectError({ key: isNesFile ? 'nesReadFailed' : 'chrReadFailed' });
      }
      return;
    }
    if (activeRequest !== requestId) return;

    try {
      const chrBytes = isNesFile ? extractNromChr(bytes).chr : bytes;
      const tiles = decodeChr(chrBytes);
      const previewColors = paletteSet[0].map(
        (colorCode) =>
          NES_MASTER_PALETTE[colorCode] ?? { red: 0, green: 0, blue: 0 },
      );
      const indexedImage = chrTilesToIndexedImage(tiles, previewColors);
      const paletteAssignments = assignmentsForImage(indexedImage, 'tileset');
      const pixelOverrides = indexedImage.pixels.slice();
      project = {
        ...project,
        width: indexedImage.width,
        height: indexedImage.height,
        indexedImage,
        tiles,
        paletteAssignments,
        pixelOverrides,
        error: null,
        loading: false,
      };
      render();
    } catch (error: unknown) {
      if (error instanceof InesRomError) {
        setProjectError(displayErrorFromInes(error));
      } else {
        setProjectError({
          key:
            error instanceof ChrDecodingError && error.code === 'empty-file'
              ? 'emptyChrFile'
              : 'invalidChrSize',
        });
      }
    }
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
  const indexedImage = generateRandomPlayfield(Math.random, {
    features: project.randomPlayfieldFeatures,
  });
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
    sourceKind: 'png',
    width: indexedImage.width,
    height: indexedImage.height,
    sourceImage: indexedImageToImageData(indexedImage),
    indexedImage,
    tiles: extractTiles(mappedImage),
    mode: 'playfield',
    deduplicationEnabled: true,
    flipDeduplicationEnabled: false,
    collisionCells: createEmptyCollisionMap(),
    activeCollisionType: COLLISION_TYPES.solid,
    randomPlayfieldFeatures: project.randomPlayfieldFeatures,
    paletteSet,
    paletteAssignments,
    previewTool: 'palette',
    pixelOverrides,
    activePaletteIndex: 0,
    activeColorIndex: 1,
    showPaletteNumbers: false,
    zoomedPaletteRegion: null,
    paletteColorTarget: { paletteIndex: 0, colorIndex: 1 },
    animation: project.animation,
    error: null,
    loading: false,
  };
  render();
}

subscribeToLocale(render);
render();
