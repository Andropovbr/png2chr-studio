import './style.css';

import {
  AnimationModelError,
  buildAnimationProjectModel,
  DEFAULT_ANIMATION_CHR_CAPACITY_TILES,
} from './core/animation-model';
import { mapAnimationImageToNesPalette } from './core/animation-palette';
import type {
  AnimationDefinitionInput,
  AnimationProjectModel,
} from './core/animation-model';
import { encodeChr } from './core/chr-encoder';
import { padChrRom } from './core/chr-rom';
import { normalizeCIdentifier } from './core/c-identifier';
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
import { analyzeImage, imageHasTransparency } from './core/image-analysis';
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
import { quantizeImageToNes } from './core/image-quantization';
import {
  QUANTIZATION_MODES,
  loadQuantizationSettings,
  saveQuantizationSettings,
  type QuantizationMode,
  type QuantizationSettings,
} from './core/quantization-settings';
import { getLocale, subscribeToLocale, t } from './i18n';
import { createDiagnostics } from './ui/diagnostics';
import {
  createAnimationEditor,
  type AnimationEditorOptions,
} from './ui/animation-editor';
import { createExportPanel } from './ui/export-panel';
import { createHeader } from './ui/header';
import { createImageInput } from './ui/image-input';
import { createImagePreview } from './ui/image-preview';
import { createPaletteEditor } from './ui/palette-editor';
import {
  createQuantizationPanel,
  type QuantizationPreview,
} from './ui/quantization-panel';
import { createTileGrid } from './ui/tile-grid';
import {
  displayErrorFromAnalysis,
  displayErrorFromInes,
  displayErrorFromPlayfield,
  type DisplayError,
  type AnimationItemSetting,
  type AnimationSettings,
  type AnimationSourceData,
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
import type {
  QuantizationPreviewRequest,
  QuantizationPreviewResponse,
} from './workers/quantization-preview-worker';

const appElement = document.querySelector<HTMLElement>('#app');
if (appElement === null) {
  throw new Error('Application root element was not found.');
}
const app: HTMLElement = appElement;

function generateAnimationId(): string {
  return `anim-${Math.random().toString(36).slice(2, 9)}`;
}

function createDefaultAnimationSettings(): AnimationSettings {
  const initialId = generateAnimationId();
  return {
    name: 'soldier',
    symbolPrefix: 'soldier',
    defaultPaletteIndex: 0,
    quantizationMode: 'median-cut',
    ditheringMode: 'none',
    animations: [
      {
        id: initialId,
        name: 'idle',
        source: null,
        paletteIndex: null,
        frameWidth: 16,
        frameHeight: 16,
        originX: 0,
        originY: 0,
        playback: 'loop',
        allowHorizontalFlip: false,
        allowVerticalFlip: false,
        flipH: false,
        flipV: false,
        defaultDuration: 12,
        frameIndices: [],
        frameDurations: [],
        framePalettes: [],
        collapsed: false,
      },
    ],
    flipDeduplication: true,
    spritePalette: 0,
    spriteColorIndex: 1,
    colorIndices: new Uint8Array(),
    destinationChrName: null,
    destinationChr: new Uint8Array(),
    mappingCollapsed: true,
  };
}

let requestId = 0;
let quantizationTaskId = 0;
let quantizationPreviewRequestId = 0;
let quantizationPreviewWorker: Worker | null = null;
let quantizationPreviewKey: string | null = null;
let quantizationPreviews: readonly QuantizationPreview[] = [];
let quantizationPreviewsLoading = false;
const quantizationPreviewCache = new Map<
  string,
  readonly QuantizationPreview[]
>();
const settingsStorage =
  typeof localStorage === 'undefined' ? null : localStorage;
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
  quantizationSettings: loadQuantizationSettings(settingsStorage),
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

function quantizationColorLimit(mode: ProjectMode, image: ImageData): number {
  if (mode === 'animation' && imageHasTransparency(image)) return 3;
  return mode === 'animation' ? 4 : 13;
}

function quantizePngSource(
  image: ImageData,
  mode: ProjectMode,
  settings: QuantizationSettings,
): IndexedImage {
  const reduced = quantizeImageToNes(
    image,
    NES_MASTER_PALETTE,
    quantizationColorLimit(mode, image),
    settings,
  );
  return analyzeImage(reduced.image);
}

function previewCacheKey(): string | null {
  if (project.sourceImage === null || project.sourceKind !== 'png') return null;
  return [
    requestId,
    project.mode,
    project.sourceImage.width,
    project.sourceImage.height,
    project.quantizationSettings.ditheringMode,
    project.quantizationSettings.colorDistanceMode,
  ].join(':');
}

function ensureQuantizationPreviews(): void {
  const key = previewCacheKey();
  const source = project.sourceImage;
  if (key === null || source === null || key === quantizationPreviewKey) {
    return;
  }
  const cached = quantizationPreviewCache.get(key);
  if (cached !== undefined) {
    quantizationPreviewKey = key;
    quantizationPreviews = cached;
    quantizationPreviewsLoading = false;
    return;
  }
  if (quantizationPreviewsLoading) return;
  quantizationPreviewKey = key;
  quantizationPreviews = [];
  quantizationPreviewsLoading = true;
  const id = ++quantizationPreviewRequestId;
  quantizationPreviewWorker ??= new Worker(
    new URL('./workers/quantization-preview-worker.ts', import.meta.url),
    { type: 'module' },
  );
  quantizationPreviewWorker.onmessage = (
    event: MessageEvent<QuantizationPreviewResponse>,
  ) => {
    const response = event.data;
    if (response.id !== quantizationPreviewRequestId) return;
    quantizationPreviewsLoading = false;
    if ('error' in response) {
      quantizationPreviews = [];
    } else {
      quantizationPreviews = response.previews.map(({ mode, data }) => ({
        mode,
        image: new ImageData(
          new Uint8ClampedArray(data),
          response.width,
          response.height,
        ),
      }));
      quantizationPreviewCache.set(key, quantizationPreviews);
    }
    render();
  };
  const request: QuantizationPreviewRequest = {
    id,
    width: source.width,
    height: source.height,
    data: source.data.slice().buffer,
    availableColors: NES_MASTER_PALETTE,
    maximumColors: quantizationColorLimit(project.mode, source),
    settings: project.quantizationSettings,
    modes: QUANTIZATION_MODES,
  };
  quantizationPreviewWorker.postMessage(request, [request.data]);
}

async function changeQuantizationSettings(
  settings: QuantizationSettings,
): Promise<void> {
  saveQuantizationSettings(settingsStorage, settings);
  const task = ++quantizationTaskId;
  quantizationPreviewRequestId += 1;
  quantizationPreviewKey = null;
  quantizationPreviews = [];
  quantizationPreviewsLoading = false;
  const source = project.sourceImage;
  if (source === null || project.sourceKind !== 'png') {
    project = { ...project, quantizationSettings: settings };
    render();
    return;
  }
  project = { ...project, quantizationSettings: settings, loading: true };
  render();
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
  if (task !== quantizationTaskId) return;
  try {
    const indexedImage = quantizePngSource(source, project.mode, settings);
    let assignments =
      project.paletteAssignments.length ===
      assignmentsForImage(indexedImage, project.mode).length
        ? project.paletteAssignments
        : assignmentsForImage(indexedImage, project.mode);
    const pixelOverrides =
      project.pixelOverrides.length === indexedImage.pixels.length
        ? project.pixelOverrides
        : createPixelOverrides(indexedImage.width, indexedImage.height);
    let animation = project.animation;
    let mappedImage: IndexedImage;
    if (project.mode === 'animation') {
      const updatedAnimations = project.animation.animations.map((anim) => {
        if (anim.source === null) return anim;
        const reindexed = quantizePngSource(
          anim.source.sourceImage,
          'animation',
          {
            quantizationMode: project.animation.quantizationMode,
            ditheringMode: project.animation.ditheringMode,
            colorDistanceMode: settings.colorDistanceMode,
          },
        );
        return {
          ...anim,
          source: {
            ...anim.source,
            indexedImage: reindexed,
          },
        };
      });
      const mapping = mapAnimationImageToNesPalette(
        indexedImage,
        project.paletteSet,
        project.animation.spritePalette,
        TILESET_PALETTE_REGION_SIZE,
        undefined,
        settings.colorDistanceMode,
      );
      mappedImage = mapping.image;
      assignments = mapping.assignments;
      animation = {
        ...project.animation,
        animations: updatedAnimations,
        colorIndices: mapping.colorIndices,
      };
    } else {
      mappedImage = mapImageToNesPalettes(
        indexedImage,
        project.paletteSet,
        assignments,
        paletteRegionSize(project.mode, indexedImage),
        pixelOverrides,
        false,
        settings.colorDistanceMode,
      );
    }
    project = {
      ...project,
      indexedImage,
      tiles: extractTiles(mappedImage),
      paletteAssignments: assignments,
      pixelOverrides,
      animation,
      loading: false,
      error: null,
    };
  } catch (error: unknown) {
    project = {
      ...project,
      loading: false,
      error:
        error instanceof ImageAnalysisError
          ? displayErrorFromAnalysis(error)
          : { key: 'invalidPixelData' },
    };
  }
  render();
}

function createProjectQuantizationPanel(): HTMLElement {
  ensureQuantizationPreviews();
  return createQuantizationPanel({
    sourceImage: project.sourceImage,
    pngActive: project.sourceKind === 'png',
    settings: project.quantizationSettings,
    previews: quantizationPreviews,
    previewsLoading: quantizationPreviewsLoading,
    onSettingsChange: (settings) => void changeQuantizationSettings(settings),
  });
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
  if (project.sourceKind === 'png' && project.sourceImage !== null) {
    void changeQuantizationSettings(project.quantizationSettings);
  } else {
    render();
  }
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

function addAnimation(): void {
  const count = project.animation.animations.length + 1;
  const newId = generateAnimationId();
  const lastAnim =
    project.animation.animations[project.animation.animations.length - 1];
  const newAnim: AnimationItemSetting = {
    id: newId,
    name: `anim_${String(count)}`,
    source: null,
    paletteIndex: null,
    frameWidth: lastAnim?.frameWidth ?? 16,
    frameHeight: lastAnim?.frameHeight ?? 16,
    originX: lastAnim?.originX ?? 0,
    originY: lastAnim?.originY ?? 0,
    playback: 'loop',
    allowHorizontalFlip: false,
    allowVerticalFlip: false,
    flipH: false,
    flipV: false,
    defaultDuration: 12,
    frameIndices: [],
    frameDurations: [],
    framePalettes: [],
    collapsed: false,
  };
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations: [...project.animation.animations, newAnim],
    },
    error: null,
  };
  render();
}

function duplicateAnimation(animId: string): void {
  const index = project.animation.animations.findIndex((a) => a.id === animId);
  if (index < 0) return;
  const original = project.animation.animations[index];
  if (original === undefined) return;
  const newId = generateAnimationId();
  const copy: AnimationItemSetting = {
    ...original,
    id: newId,
    name: `${original.name}_copy`,
    frameIndices: [...original.frameIndices],
    frameDurations: [...original.frameDurations],
    framePalettes: [...(original.framePalettes ?? [])],
    collapsed: false,
  };
  const list = [...project.animation.animations];
  list.splice(index + 1, 0, copy);
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations: list,
    },
    error: null,
  };
  render();
}

function removeAnimation(animId: string): void {
  if (project.animation.animations.length <= 1) return;
  const remaining = project.animation.animations.filter((a) => a.id !== animId);
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations: remaining,
    },
    error: null,
  };
  render();
}

function toggleAnimationCollapse(animId: string): void {
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations: project.animation.animations.map((a) =>
        a.id === animId ? { ...a, collapsed: !a.collapsed } : a,
      ),
    },
  };
  render();
}

function updateAnimation(
  animId: string,
  patch: Partial<AnimationItemSetting>,
): void {
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations: project.animation.animations.map((a) =>
        a.id === animId ? { ...a, ...patch } : a,
      ),
    },
    error: null,
  };
  render();
}

function setGlobalAnimationQuantizationMode(mode: QuantizationMode): void {
  const animations = project.animation.animations.map((anim) => {
    if (anim.source === null) {
      return {
        ...anim,
        quantizationMode: mode,
      };
    }
    const reindexed = quantizePngSource(anim.source.sourceImage, 'animation', {
      quantizationMode: mode,
      ditheringMode: project.animation.ditheringMode,
      colorDistanceMode: project.quantizationSettings.colorDistanceMode,
    });
    return {
      ...anim,
      quantizationMode: mode,
      source: {
        ...anim.source,
        indexedImage: reindexed,
      },
    };
  });
  project = {
    ...project,
    animation: {
      ...project.animation,
      quantizationMode: mode,
      animations,
    },
    error: null,
  };
  render();
}

async function loadAnimationSourceFile(
  animId: string,
  file: File,
): Promise<void> {
  try {
    const imageData = await decodeImage(file);
    const quantMode = project.animation.quantizationMode;
    const dithMode = project.animation.ditheringMode;
    const indexedImage = quantizePngSource(imageData, 'animation', {
      quantizationMode: quantMode,
      ditheringMode: dithMode,
      colorDistanceMode: project.quantizationSettings.colorDistanceMode,
    });
    const source: AnimationSourceData = {
      fileName: file.name,
      sourceImage: imageData,
      indexedImage,
    };
    const animations = project.animation.animations.map((anim) => {
      if (anim.id !== animId) return anim;
      const columns = Math.floor(imageData.width / anim.frameWidth);
      const rows = Math.floor(imageData.height / anim.frameHeight);
      const totalFrames = columns * rows;
      const validIndices = anim.frameIndices.filter((idx) => idx < totalFrames);
      const validDurations = anim.frameDurations.slice(0, validIndices.length);
      const validPalettes = (anim.framePalettes ?? []).slice(
        0,
        validIndices.length,
      );
      return {
        ...anim,
        source,
        quantizationMode: quantMode,
        ditheringMode: dithMode,
        frameIndices: validIndices,
        frameDurations: validDurations,
        framePalettes: validPalettes,
      };
    });
    project = {
      ...project,
      animation: {
        ...project.animation,
        animations,
      },
      error: null,
    };
  } catch {
    project = {
      ...project,
      error: { key: 'invalidPixelData' },
    };
  }
  render();
}

function toggleAnimationFrame(animId: string, frameIndex: number): void {
  const animations = project.animation.animations.map((anim) => {
    if (anim.id !== animId) return anim;
    const existsIndex = anim.frameIndices.indexOf(frameIndex);
    if (existsIndex >= 0) {
      const nextFrames = anim.frameIndices.filter((_, i) => i !== existsIndex);
      const nextDurations = anim.frameDurations.filter(
        (_, i) => i !== existsIndex,
      );
      const nextPalettes = (anim.framePalettes ?? []).filter(
        (_, i) => i !== existsIndex,
      );
      return {
        ...anim,
        frameIndices: nextFrames,
        frameDurations: nextDurations,
        framePalettes: nextPalettes,
      };
    }
    return {
      ...anim,
      frameIndices: [...anim.frameIndices, frameIndex],
      frameDurations: [...anim.frameDurations, anim.defaultDuration],
      framePalettes: [...(anim.framePalettes ?? []), null],
    };
  });
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
    error: null,
  };
  render();
}

function moveAnimationFrame(
  animId: string,
  frameIndex: number,
  direction: -1 | 1,
): void {
  const animations = project.animation.animations.map((anim) => {
    if (anim.id !== animId) return anim;
    const current = anim.frameIndices.indexOf(frameIndex);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= anim.frameIndices.length) {
      return anim;
    }
    const frames = [...anim.frameIndices];
    const durations = [...anim.frameDurations];
    const palettes = [...(anim.framePalettes ?? [])];
    while (palettes.length < frames.length) {
      palettes.push(null);
    }
    [frames[current], frames[target]] = [
      frames[target] ?? 0,
      frames[current] ?? 0,
    ];
    [durations[current], durations[target]] = [
      durations[target] ?? anim.defaultDuration,
      durations[current] ?? anim.defaultDuration,
    ];
    [palettes[current], palettes[target]] = [
      palettes[target] ?? null,
      palettes[current] ?? null,
    ];
    return {
      ...anim,
      frameIndices: frames,
      frameDurations: durations,
      framePalettes: palettes,
    };
  });
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
  };
  render();
}

function setAnimationFrameDuration(
  animId: string,
  frameIndex: number,
  duration: number,
): void {
  const animations = project.animation.animations.map((anim) => {
    if (anim.id !== animId) return anim;
    const order = anim.frameIndices.indexOf(frameIndex);
    if (order < 0) return anim;
    const durations = [...anim.frameDurations];
    durations[order] = duration;
    return {
      ...anim,
      frameDurations: durations,
    };
  });
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
  };
  render();
}

function setAnimationFramePalette(
  animId: string,
  frameOrderIndex: number,
  paletteIndex: number | null,
): void {
  const animations = project.animation.animations.map((anim) => {
    if (anim.id !== animId) return anim;
    const framePalettes = [...(anim.framePalettes ?? [])];
    while (framePalettes.length < anim.frameIndices.length) {
      framePalettes.push(null);
    }
    framePalettes[frameOrderIndex] = paletteIndex;
    return {
      ...anim,
      framePalettes,
    };
  });
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
    error: null,
  };
  render();
}

function applyDefaultDurationToAll(animId: string): void {
  const animations = project.animation.animations.map((anim) => {
    if (anim.id !== animId) return anim;
    const durations = anim.frameIndices.map(() => anim.defaultDuration);
    return {
      ...anim,
      frameDurations: durations,
    };
  });
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
  };
  render();
}

function removeFrameFromAnimation(animId: string, frameIndex: number): void {
  const animations = project.animation.animations.map((anim) => {
    if (anim.id !== animId) return anim;
    const order = anim.frameIndices.indexOf(frameIndex);
    if (order < 0) return anim;
    const frameIndices = anim.frameIndices.filter((_, i) => i !== order);
    const frameDurations = anim.frameDurations.filter((_, i) => i !== order);
    const framePalettes = (anim.framePalettes ?? []).filter(
      (_, i) => i !== order,
    );
    return {
      ...anim,
      frameIndices,
      frameDurations,
      framePalettes,
    };
  });
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
    error: null,
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
  let model: AnimationProjectModel | null = null;
  let modelError: AnimationModelError | null = null;

  try {
    const definitions: AnimationDefinitionInput[] = [];
    for (const anim of project.animation.animations) {
      if (anim.source !== null && anim.frameIndices.length > 0) {
        definitions.push({
          name: anim.name,
          sourceImageName: anim.source.fileName,
          image: anim.source.indexedImage,
          paletteIndex: anim.paletteIndex ?? null,
          quantizationMode: project.animation.quantizationMode,
          frameWidth: anim.frameWidth,
          frameHeight: anim.frameHeight,
          originX: anim.originX,
          originY: anim.originY,
          playback: anim.playback,
          allowHorizontalFlip: anim.allowHorizontalFlip,
          allowVerticalFlip: anim.allowVerticalFlip,
          flipH: anim.allowHorizontalFlip,
          flipV: anim.allowVerticalFlip,
          frameIndices: anim.frameIndices,
          frameDuration: anim.defaultDuration,
          frameDurations: anim.frameDurations,
          framePalettes: anim.framePalettes,
        });
      }
    }

    if (definitions.length > 0) {
      model = buildAnimationProjectModel({
        name: project.animation.name,
        symbolPrefix: project.animation.symbolPrefix,
        animations: definitions,
        defaultPaletteIndex: project.animation.defaultPaletteIndex,
        quantizationMode: project.animation.quantizationMode,
        baseChr: project.animation.destinationChr,
        capacityTiles: DEFAULT_ANIMATION_CHR_CAPACITY_TILES,
        flipDeduplication: project.animation.flipDeduplication,
        spritePalette: project.animation.spritePalette,
      });
    }
  } catch (error: unknown) {
    if (error instanceof AnimationModelError) modelError = error;
    else throw error;
  }

  const editorOptions: AnimationEditorOptions = {
    settings: project.animation,
    model,
    modelError,
    paletteSet: project.paletteSet,
    colorDistanceMode: project.quantizationSettings.colorDistanceMode,
    onSettingsChange: (animation: AnimationSettings) => {
      project = { ...project, animation, error: null };
      render();
    },
    onGlobalQuantizationModeChange: setGlobalAnimationQuantizationMode,
    onDefaultPaletteIndexChange: (defaultPaletteIndex: number) => {
      project = {
        ...project,
        animation: {
          ...project.animation,
          defaultPaletteIndex,
        },
        error: null,
      };
      render();
    },
    onAddAnimation: addAnimation,
    onDuplicateAnimation: duplicateAnimation,
    onRemoveAnimation: removeAnimation,
    onToggleAnimationCollapse: toggleAnimationCollapse,
    onToggleMappingCollapse: () => {
      project = {
        ...project,
        animation: {
          ...project.animation,
          mappingCollapsed: !(project.animation.mappingCollapsed ?? true),
        },
      };
      render();
    },
    onUpdateAnimation: updateAnimation,
    onAnimationSourceFile: (animId: string, file: File) => {
      void loadAnimationSourceFile(animId, file);
    },
    onFrameToggle: toggleAnimationFrame,
    onFrameMove: moveAnimationFrame,
    onFrameDurationChange: setAnimationFrameDuration,
    onFramePaletteChange: setAnimationFramePalette,
    onApplyDefaultDurationToAll: applyDefaultDurationToAll,
    onFrameRemoveFromAnimation: removeFrameFromAnimation,
    onSpritePaletteSelectionChange: (
      paletteIndex: number,
      colorIndex: number,
    ) => {
      project = {
        ...project,
        animation: {
          ...project.animation,
          spritePalette: paletteIndex,
          spriteColorIndex: colorIndex,
        },
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
        animation: {
          ...project.animation,
          spritePalette: paletteIndex,
          spriteColorIndex: colorIndex,
        },
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

  workspace.append(...createAnimationEditor(editorOptions));
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
          false,
          project.quantizationSettings.colorDistanceMode,
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

  const chr = mappedImage === null ? null : padChrRom(encodeChr(visibleTiles));
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
      colorDistanceMode: project.quantizationSettings.colorDistanceMode,
      onPixelOverridesChange: (pixelOverrides, paletteAssignments) => {
        project = { ...project, pixelOverrides, paletteAssignments };
        render();
      },
    }),
  );
  workspace.append(
    createProjectImageInput(),
    createProjectQuantizationPanel(),
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
  quantizationPreviewRequestId += 1;
  quantizationPreviewKey = null;
  quantizationPreviews = [];
  quantizationPreviewsLoading = false;
  quantizationPreviewCache.clear();
  const mode = project.mode;
  const deduplicationEnabled = project.deduplicationEnabled;
  const flipDeduplicationEnabled = project.flipDeduplicationEnabled;
  const paletteSet = project.paletteSet;
  const activePaletteIndex = project.activePaletteIndex;
  const paletteColorTarget = project.paletteColorTarget;
  const activeColorIndex = project.activeColorIndex;
  const showPaletteNumbers = project.showPaletteNumbers;
  const randomPlayfieldFeatures = project.randomPlayfieldFeatures;
  const sourceSymbolPrefix = normalizeCIdentifier(
    file.name.replace(/\.[^.]*$/, ''),
  );
  const animation =
    mode === 'animation' && isPngFile
      ? {
          ...project.animation,
          symbolPrefix: sourceSymbolPrefix || 'asset',
        }
      : project.animation;
  const quantizationSettings = project.quantizationSettings;
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
    quantizationSettings,
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
    const indexedImage = quantizePngSource(
      imageData,
      mode,
      quantizationSettings,
    );
    const paletteAssignments = assignmentsForImage(indexedImage, mode);
    const pixelOverrides = createPixelOverrides(
      indexedImage.width,
      indexedImage.height,
    );
    let nextAnimation = animation;
    let mappedImage: IndexedImage;
    if (mode === 'animation') {
      const sourceData: AnimationSourceData = {
        fileName: file.name,
        sourceImage: imageData,
        indexedImage,
      };
      const animations = animation.animations.map((anim, idx) => {
        if (idx === 0 && anim.source === null) {
          return { ...anim, source: sourceData };
        }
        return anim;
      });
      nextAnimation = {
        ...animation,
        animations:
          animations.length === 0
            ? [
                {
                  id: generateAnimationId(),
                  name: 'idle',
                  source: sourceData,
                  paletteIndex: null,
                  frameWidth: 16,
                  frameHeight: 16,
                  originX: 0,
                  originY: 0,
                  playback: 'loop',
                  allowHorizontalFlip: false,
                  allowVerticalFlip: false,
                  flipH: false,
                  flipV: false,
                  defaultDuration: 12,
                  frameIndices: [],
                  frameDurations: [],
                  framePalettes: [],
                  collapsed: false,
                },
              ]
            : animations,
      };
      mappedImage = indexedImage;
    } else {
      mappedImage = mapImageToNesPalettes(
        indexedImage,
        paletteSet,
        paletteAssignments,
        paletteRegionSize(mode, indexedImage),
        pixelOverrides,
        false,
        quantizationSettings.colorDistanceMode,
      );
    }
    const tiles = extractTiles(mappedImage);
    project = {
      ...project,
      indexedImage,
      tiles,
      paletteAssignments,
      pixelOverrides,
      animation: nextAnimation,
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
  quantizationPreviewRequestId += 1;
  quantizationPreviewKey = null;
  quantizationPreviews = [];
  quantizationPreviewsLoading = false;
  quantizationPreviewCache.clear();
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
    false,
    project.quantizationSettings.colorDistanceMode,
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
    quantizationSettings: project.quantizationSettings,
    error: null,
    loading: false,
  };
  render();
}

subscribeToLocale(render);
render();
