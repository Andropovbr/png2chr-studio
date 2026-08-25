import './style.css';

import {
  AnimationModelError,
  buildAnimationProjectModel,
} from './core/animation-model';
import { mapAnimationImageToNesPalette } from './core/animation-palette';
import type {
  AnimationDefinitionInput,
  AnimationProjectModel,
} from './core/animation-model';
import { normalizeCIdentifier } from './core/c-identifier';
import {
  ChrDecodingError,
  chrTilesToIndexedImage,
  decodeChr,
} from './core/chr-decoder';
import {
  COLLISION_TYPES,
  createEmptyCollisionMap,
  encodeCollisionMap,
} from './core/collision-encoder';
import {
  decideFrameDimensions,
  detectFrameGrid,
  type FrameDetectionResult,
} from './core/frame-detection';
import { analyzeImage, imageHasTransparency } from './core/image-analysis';
import { extractNromChr, InesRomError } from './core/ines-rom';
import {
  setTilePixelOverride,
  resetTileOverride,
} from './core/pixel-overrides';
import {
  applyChrTileEdit,
  extractTilePixelsFromChr,
  resolveTileEditOrigin,
} from './core/chr-project-integration';
import {
  areTilePixelsEqual,
  cloneTilePixels,
  createTileHistory,
  type TileHistory,
} from './core/chr-tile-editor';
import {
  createDefaultNesPaletteSet,
  createPaletteAssignments,
  createPixelOverrides,
  mapImageToNesPalettes,
  NES_MASTER_PALETTE,
  PLAYFIELD_PALETTE_REGION_SIZE,
  setNesPaletteColor,
  TILESET_PALETTE_REGION_SIZE,
} from './core/nes-palette';
import {
  createDefaultPaletteDefinitions,
  generatePaletteId,
  duplicatePaletteDefinition,
  resolveActivePaletteSet,
  type PaletteDefinition,
} from './core/palette-manager';
import {
  DEFAULT_RANDOM_PLAYFIELD_FEATURES,
  generateRandomPlayfield,
} from './core/random-playfield';
import { extractTiles } from './core/tile-extraction';
import { ImageAnalysisError, type IndexedImage, type Tile } from './core/types';
import { quantizeImageToNes } from './core/image-quantization';
import { readAndDecodePng, type PngLoadFailure } from './core/png-load';
import {
  deserializeProject,
  findMissingAssets,
  serializeProject,
  type ProjectAnimationItemConfig,
  type ProjectAnimationSettingsConfig,
  type ProjectPlayfieldConfig,
  type ProjectTilesetConfig,
  type ScenePreviewInstance,
  type StudioProject,
} from './core/project';
import { generateInstanceId } from './core/scene-preview';
import {
  QUANTIZATION_MODES,
  loadQuantizationSettings,
  saveQuantizationSettings,
  type QuantizationSettings,
} from './core/quantization-settings';
import { getLocale, subscribeToLocale, t } from './i18n';
import { createAppShell } from './ui/app-shell';
import {
  createAnimationEditor,
  type AnimationEditorOptions,
} from './ui/animation-editor';
import { createHeader } from './ui/header';
import { createInspector } from './ui/inspector';
import type { QuantizationPreview } from './ui/quantization-panel';
import { encodeChr } from './core/chr-encoder';
import { padChrRom } from './core/chr-rom';
import { encodePlayfield } from './core/playfield-encoder';
import {
  deduplicateTiles,
  deduplicateTilesConsideringFlips,
} from './core/tile-deduplication';
import { createSidebar } from './ui/sidebar';
import { createTilesetWorkspace } from './ui/tileset-workspace';
import { createPlayfieldWorkspace } from './ui/playfield-workspace';
import { createPaletteWorkspace } from './ui/palette-workspace';
import { createChrWorkspace } from './ui/chr-workspace';
import {
  classifyChrSlots,
  composeChrWithAllocatedTiles,
} from './core/chr-pattern-table';
import { createDeliveryWorkspace } from './ui/delivery-workspace';
import {
  applyDerivedStatusUpdate,
  applyProjectUpdate,
  applyWorkspaceUpdate,
  type StateUpdater,
} from './ui/state-update';
import {
  displayErrorFromAnalysis,
  displayErrorFromInes,
  type DisplayError,
  type AnimationItemSetting,
  type AnimationSettings,
  type AnimationSourceData,
  type ProjectMode,
  type ProjectView,
} from './ui/types';
import {
  createDerivedStatus,
  createWorkspaceState,
  type DerivedStatus,
  type WorkspaceState,
} from './ui/workspace-state';
import { downloadBytes, downloadText } from './utils/download';
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
        entity: 'entity',
        source: null,
        paletteId: defaultInitialPalettes[0]?.id ?? null,
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
      },
    ],
    flipDeduplication: true,
    spritePalette: 0,
    spriteColorIndex: 1,
    colorIndices: new Uint8Array(),
    destinationChrName: null,
    destinationChr: new Uint8Array(),
    patternTable: 0,
    destinationPatternTable: 0,
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
const defaultInitialPalettes = createDefaultPaletteDefinitions();

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
  palettes: defaultInitialPalettes,
  activeSpritePaletteSlots: defaultInitialPalettes.map((p) => p.id),
  paletteAssignments: new Uint8Array(),
  pixelOverrides: new Uint8Array(),
  activePaletteIndex: 0,
  activeColorIndex: 1,
  animation: createDefaultAnimationSettings(),
  scenePreview: { instances: [] },
  quantizationSettings: loadQuantizationSettings(settingsStorage),
};

let projectName = t('defaultProjectName');
let projectDirty = false;
let workspace: WorkspaceState = createWorkspaceState(
  project.activePaletteIndex,
  project.activeColorIndex,
  project.mode,
);
let derivedStatus: DerivedStatus = createDerivedStatus();

class PngLoadError extends Error {
  constructor(readonly failure: PngLoadFailure) {
    super(failure);
  }
}

function updateProject(updater: StateUpdater<ProjectView>): void {
  const result = applyProjectUpdate(project, updater);
  project = result.value;
  if (result.marksProjectDirty) projectDirty = true;
}

function updateProjectName(name: string): void {
  if (name === projectName) return;
  projectName = name;
  projectDirty = true;
}

function updateWorkspace(updater: StateUpdater<WorkspaceState>): void {
  workspace = applyWorkspaceUpdate(workspace, updater).value;
}

function setDerivedStatus(updater: StateUpdater<DerivedStatus>): void {
  derivedStatus = applyDerivedStatusUpdate(derivedStatus, updater).value;
}

function resetTransientState(error: DisplayError | null = null): void {
  workspace = createWorkspaceState(
    project.activePaletteIndex,
    project.activeColorIndex,
    project.mode,
  );
  derivedStatus = createDerivedStatus(error);
}

const assetFileCache = new Map<string, File>();

function cacheAssetFile(file: File): void {
  assetFileCache.set(file.name.toLowerCase(), file);
  assetFileCache.set(file.name, file);
}

function findMatchingAssetFile(
  assetRef: { path: string; name?: string } | null | undefined,
): File | undefined {
  if (!assetRef?.path) return undefined;
  const fileName =
    assetRef.name ?? assetRef.path.split('/').pop() ?? assetRef.path;
  return (
    assetFileCache.get(fileName.toLowerCase()) ??
    assetFileCache.get(assetRef.path.toLowerCase()) ??
    assetFileCache.get(fileName)
  );
}

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

async function decodeDataUrl(dataUrl: string): Promise<ImageData> {
  return new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject(new Error('Canvas 2D unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, img.width, img.height));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => {
      reject(new Error('Failed to load image from dataUrl'));
    };
    img.src = dataUrl;
  });
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
  const binary = atob(cleanBase64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function buildCurrentStudioProject(): StudioProject {
  const tileset: ProjectTilesetConfig = {
    asset:
      project.fileName !== null && project.mode === 'tileset'
        ? {
            id: project.assetId ?? undefined,
            path: project.fileName,
            name: project.fileName,
            sourceKind: project.sourceKind ?? undefined,
            dataUrl:
              project.sourceImage !== null
                ? imageDataToDataUrl(project.sourceImage)
                : undefined,
          }
        : null,
    paletteAssignments:
      project.paletteAssignments.length > 0
        ? Array.from(project.paletteAssignments)
        : undefined,
    pixelOverrides:
      project.pixelOverrides.length > 0
        ? Array.from(project.pixelOverrides)
        : undefined,
  };

  const playfield: ProjectPlayfieldConfig = {
    asset:
      project.fileName !== null && project.mode === 'playfield'
        ? {
            id: project.assetId ?? undefined,
            path: project.fileName,
            name: project.fileName,
            sourceKind: project.sourceKind ?? 'png',
            dataUrl:
              project.sourceImage !== null
                ? imageDataToDataUrl(project.sourceImage)
                : undefined,
          }
        : null,
    collisionCells: Array.from(project.collisionCells),
    activeCollisionType: project.activeCollisionType,
    randomPlayfieldFeatures: [...project.randomPlayfieldFeatures],
    paletteAssignments:
      project.paletteAssignments.length > 0
        ? Array.from(project.paletteAssignments)
        : undefined,
    pixelOverrides:
      project.pixelOverrides.length > 0
        ? Array.from(project.pixelOverrides)
        : undefined,
  };

  const animations: ProjectAnimationItemConfig[] =
    project.animation.animations.map((anim) => ({
      id: anim.id,
      name: anim.name,
      entity: anim.entity ?? 'entity',
      asset:
        anim.source !== null
          ? {
              id: anim.source.assetId ?? undefined,
              path: anim.source.fileName,
              name: anim.source.fileName,
              sourceKind: 'png',
              dataUrl: imageDataToDataUrl(anim.source.sourceImage),
            }
          : null,
      paletteId: anim.paletteId ?? null,
      paletteIndex: anim.paletteIndex ?? null,
      quantizationMode: anim.quantizationMode ?? 'median-cut',
      ditheringMode: anim.ditheringMode ?? 'none',
      frameWidth: anim.frameWidth,
      frameHeight: anim.frameHeight,
      originX: anim.originX,
      originY: anim.originY,
      playback: anim.playback,
      allowHorizontalFlip: anim.allowHorizontalFlip,
      allowVerticalFlip: anim.allowVerticalFlip,
      ...(anim.flipH !== undefined ? { flipH: anim.flipH } : {}),
      ...(anim.flipV !== undefined ? { flipV: anim.flipV } : {}),
      defaultDuration: anim.defaultDuration,
      ...(anim.pixelOverrides && Object.keys(anim.pixelOverrides).length > 0
        ? { pixelOverrides: anim.pixelOverrides }
        : {}),
      frameIndices: [...anim.frameIndices],
      frameDurations: [...anim.frameDurations],
      ...(anim.framePalettes !== undefined
        ? { framePalettes: [...anim.framePalettes] }
        : {}),
      ...(anim.framePaletteIds !== undefined
        ? { framePaletteIds: [...anim.framePaletteIds] }
        : {}),
    }));

  const animation: ProjectAnimationSettingsConfig = {
    name: project.animation.name,
    symbolPrefix: project.animation.symbolPrefix,
    defaultPaletteIndex: project.animation.defaultPaletteIndex,
    quantizationMode: project.animation.quantizationMode,
    ditheringMode: project.animation.ditheringMode,
    flipDeduplication: project.animation.flipDeduplication,
    spritePalette: project.animation.spritePalette,
    spriteColorIndex: project.animation.spriteColorIndex,
    patternTable: project.animation.patternTable,
    destinationPatternTable: project.animation.destinationPatternTable,
    destinationChr:
      project.animation.destinationChrName !== null
        ? {
            id: project.animation.destinationChrAssetId ?? undefined,
            path: project.animation.destinationChrName,
            name: project.animation.destinationChrName,
            sourceKind: 'chr',
            dataUrl:
              project.animation.destinationChr.length > 0
                ? `data:application/octet-stream;base64,${uint8ArrayToBase64(project.animation.destinationChr)}`
                : undefined,
          }
        : null,
    animations,
  };

  return {
    formatVersion: 1,
    name: projectName,
    mode: project.mode,
    settings: {
      deduplicationEnabled: project.deduplicationEnabled,
      flipDeduplicationEnabled: project.flipDeduplicationEnabled,
      quantization: project.quantizationSettings,
    },
    palette: {
      paletteSet: project.paletteSet,
      activePaletteIndex: project.activePaletteIndex,
      activeColorIndex: project.activeColorIndex,
      palettes: project.palettes,
      activeSpritePaletteSlots: project.activeSpritePaletteSlots,
    },
    tileset,
    playfield,
    animation,
    scenePreview: project.scenePreview ?? { instances: [] },
  };
}

function handleSaveProject(): void {
  const current = buildCurrentStudioProject();
  const json = serializeProject(current);
  const baseName = normalizeCIdentifier(projectName) || 'project';
  downloadText(json, `${baseName}.p2c.json`);
  projectDirty = false;
  render();
}

function handleSaveProjectAs(): void {
  const newName = window.prompt(t('saveProjectAsPrompt'), projectName);
  if (newName !== null && newName.trim() !== '') {
    projectName = newName.trim();
    handleSaveProject();
  }
}

function handleNewProject(): void {
  const newName = window.prompt(t('newProjectPrompt'), t('defaultProjectName'));
  if (newName === null) return;
  projectName = newName.trim() || t('defaultProjectName');
  projectDirty = false;
  quantizationPreviewKey = null;
  quantizationPreviews = [];
  quantizationPreviewsLoading = false;
  quantizationPreviewCache.clear();
  resetAllTileHistories();
  const defaultPalettes = createDefaultPaletteDefinitions();
  project = {
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
    palettes: defaultPalettes,
    activeSpritePaletteSlots: defaultPalettes.map((p) => p.id),
    paletteAssignments: new Uint8Array(),
    pixelOverrides: new Uint8Array(),
    activePaletteIndex: 0,
    activeColorIndex: 1,
    animation: createDefaultAnimationSettings(),
    quantizationSettings: loadQuantizationSettings(settingsStorage),
  };
  resetTransientState();
  render();
}

async function loadProjectFile(
  file: File,
  companionFiles: File[] = [],
): Promise<void> {
  cacheAssetFile(file);
  for (const companion of companionFiles) {
    cacheAssetFile(companion);
  }

  quantizationPreviewKey = null;
  quantizationPreviews = [];
  quantizationPreviewsLoading = false;
  quantizationPreviewCache.clear();
  resetAllTileHistories();

  try {
    const text = await file.text();
    const result = deserializeProject(text);
    if (!result.success) {
      if (result.error.code === 'unsupported-format-version') {
        const ver = result.error.details?.formatVersion;
        const versionStr =
          typeof ver === 'number' || typeof ver === 'string'
            ? String(ver)
            : 'unknown';
        setProjectError({
          key: 'projectUnsupportedVersion',
          variables: { version: versionStr },
        });
      } else {
        setProjectError({
          key: 'projectInvalidJson',
        });
      }
      return;
    }

    const loaded = result.project;
    projectName = loaded.name;
    projectDirty = false;

    const hasAsset = (path: string): boolean => {
      const fileName = path.split('/').pop() ?? path;
      return (
        assetFileCache.has(fileName.toLowerCase()) ||
        assetFileCache.has(path.toLowerCase())
      );
    };

    const missing = findMissingAssets(loaded, hasAsset);
    const missingError: DisplayError | null =
      missing.length > 0
        ? {
            key: 'projectMissingAssetsWarning',
            variables: {
              details: missing
                .map((m) => `${m.name} (${m.expectedPath})`)
                .join(', '),
            },
          }
        : null;

    if (loaded.mode === 'animation') {
      const animSettings = loaded.animation;
      const reconstructedAnimations: AnimationItemSetting[] = [];
      let restoredPngError: DisplayError | null = null;

      for (const anim of animSettings?.animations ?? []) {
        let source: AnimationSourceData | null = null;
        let detection: FrameDetectionResult | null = null;
        const matchingFile = findMatchingAssetFile(anim.asset);
        const quantMode =
          anim.quantizationMode ??
          animSettings?.quantizationMode ??
          'median-cut';
        const dithMode =
          anim.ditheringMode ?? animSettings?.ditheringMode ?? 'none';

        if (matchingFile) {
          try {
            const imageData = await decodeImage(matchingFile);
            const indexedImage = quantizePngSource(imageData, 'animation', {
              quantizationMode: quantMode,
              ditheringMode: dithMode,
              colorDistanceMode: loaded.settings.quantization.colorDistanceMode,
            });
            source = {
              assetId: anim.asset?.id,
              fileName: matchingFile.name,
              sourceImage: imageData,
              indexedImage,
            };
            detection = detectFrameGrid(imageData);
          } catch (error: unknown) {
            console.error('Project animation PNG load failed', {
              fileName: matchingFile.name,
              error,
            });
            restoredPngError ??=
              error instanceof PngLoadError
                ? displayPngLoadError(error.failure)
                : { key: 'imageProcessingFailed' };
            source = null;
          }
        } else if (anim.asset?.dataUrl) {
          try {
            const imageData = await decodeDataUrl(anim.asset.dataUrl);
            const indexedImage = quantizePngSource(imageData, 'animation', {
              quantizationMode: quantMode,
              ditheringMode: dithMode,
              colorDistanceMode: loaded.settings.quantization.colorDistanceMode,
            });
            source = {
              assetId: anim.asset.id,
              fileName: anim.asset.name ?? anim.asset.path,
              sourceImage: imageData,
              indexedImage,
            };
            detection = detectFrameGrid(imageData);
          } catch (error: unknown) {
            console.error('Embedded project animation PNG load failed', error);
            restoredPngError ??= { key: 'imageDecodeFailed' };
            source = null;
          }
        }

        const totalFrames = source
          ? Math.floor(source.sourceImage.width / anim.frameWidth) *
            Math.floor(source.sourceImage.height / anim.frameHeight)
          : 0;
        const frameIndices =
          anim.frameIndices.length > 0
            ? [...anim.frameIndices]
            : totalFrames > 0
              ? Array.from({ length: totalFrames }, (_, i) => i)
              : [];
        const frameDurations =
          anim.frameDurations.length > 0
            ? [...anim.frameDurations]
            : Array.from(
                { length: frameIndices.length },
                () => anim.defaultDuration,
              );
        const framePalettes = anim.framePalettes
          ? [...anim.framePalettes]
          : Array.from({ length: frameIndices.length }, () => null);
        const framePaletteIds = anim.framePaletteIds
          ? [...anim.framePaletteIds]
          : undefined;

        reconstructedAnimations.push({
          id: anim.id,
          name: anim.name,
          entity: anim.entity ?? 'entity',
          source,
          paletteId: anim.paletteId ?? null,
          paletteIndex: anim.paletteIndex ?? null,
          framePaletteIds,
          quantizationMode: quantMode,
          ditheringMode: dithMode,
          frameWidth: anim.frameWidth,
          frameHeight: anim.frameHeight,
          originX: anim.originX,
          originY: anim.originY,
          playback: anim.playback,
          allowHorizontalFlip: anim.allowHorizontalFlip,
          allowVerticalFlip: anim.allowVerticalFlip,
          flipH: anim.flipH ?? false,
          flipV: anim.flipV ?? false,
          defaultDuration: anim.defaultDuration,
          frameIndices,
          frameDurations,
          framePalettes,
          pixelOverrides: anim.pixelOverrides,
          frameDetection: detection,
        });
      }

      let destinationChr = new Uint8Array();
      if (animSettings?.destinationChr) {
        const chrFile = findMatchingAssetFile(animSettings.destinationChr);
        if (chrFile) {
          try {
            destinationChr = new Uint8Array(await chrFile.arrayBuffer());
          } catch {
            destinationChr = new Uint8Array();
          }
        } else if (animSettings.destinationChr.dataUrl) {
          try {
            destinationChr = base64ToUint8Array(
              animSettings.destinationChr.dataUrl,
            );
          } catch {
            destinationChr = new Uint8Array();
          }
        }
      }

      const animation: AnimationSettings = {
        ...createDefaultAnimationSettings(),
        name: animSettings?.name ?? 'entity',
        symbolPrefix: animSettings?.symbolPrefix ?? 'entity',
        defaultPaletteIndex: animSettings?.defaultPaletteIndex ?? 0,
        quantizationMode: animSettings?.quantizationMode ?? 'median-cut',
        ditheringMode: animSettings?.ditheringMode ?? 'none',
        flipDeduplication: animSettings?.flipDeduplication ?? true,
        spritePalette: animSettings?.spritePalette ?? 0,
        spriteColorIndex: animSettings?.spriteColorIndex ?? 1,
        patternTable: animSettings?.patternTable ?? 0,
        destinationPatternTable: animSettings?.destinationPatternTable ?? 0,
        destinationChrAssetId: animSettings?.destinationChr?.id ?? null,
        destinationChrName:
          animSettings?.destinationChr?.name ??
          animSettings?.destinationChr?.path ??
          null,
        destinationChr,
        animations:
          reconstructedAnimations.length > 0
            ? reconstructedAnimations
            : createDefaultAnimationSettings().animations,
      };

      project = {
        assetId: null,
        fileName: null,
        sourceKind: null,
        width: null,
        height: null,
        sourceImage: null,
        indexedImage: null,
        tiles: [],
        mode: 'animation',
        deduplicationEnabled: loaded.settings.deduplicationEnabled,
        flipDeduplicationEnabled: loaded.settings.flipDeduplicationEnabled,
        collisionCells: createEmptyCollisionMap(),
        activeCollisionType: COLLISION_TYPES.solid,
        randomPlayfieldFeatures: [...DEFAULT_RANDOM_PLAYFIELD_FEATURES],
        paletteSet: loaded.palette.paletteSet,
        palettes:
          loaded.palette.palettes ??
          createDefaultPaletteDefinitions(loaded.palette.paletteSet),
        activeSpritePaletteSlots:
          loaded.palette.activeSpritePaletteSlots ??
          (
            loaded.palette.palettes ??
            createDefaultPaletteDefinitions(loaded.palette.paletteSet)
          ).map((p) => p.id),
        paletteAssignments: new Uint8Array(),
        pixelOverrides: new Uint8Array(),
        activePaletteIndex: loaded.palette.activePaletteIndex ?? 0,
        activeColorIndex: loaded.palette.activeColorIndex ?? 1,
        chrRegions: loaded.chrRegions ?? [],
        animation,
        scenePreview: loaded.scenePreview ?? { instances: [] },
        quantizationSettings: loaded.settings.quantization,
      };
      resetTransientState(restoredPngError ?? missingError);
      render();
      return;
    }

    // Tileset and Playfield modes
    const isPlayfield = loaded.mode === 'playfield';
    const assetRef = isPlayfield
      ? loaded.playfield?.asset
      : loaded.tileset?.asset;
    const matchingFile = findMatchingAssetFile(assetRef);

    let sourceImage: ImageData | null = null;
    let indexedImage: IndexedImage | null = null;
    let tiles: readonly Tile[] = [];
    let width: number | null = null;
    let height: number | null = null;
    let restoredPngError: DisplayError | null = null;

    const collisionCells =
      isPlayfield && loaded.playfield?.collisionCells
        ? new Uint8Array(loaded.playfield.collisionCells)
        : createEmptyCollisionMap();
    let paletteAssignments = (
      isPlayfield
        ? loaded.playfield?.paletteAssignments
        : loaded.tileset?.paletteAssignments
    )
      ? new Uint8Array(
          (isPlayfield
            ? loaded.playfield?.paletteAssignments
            : loaded.tileset?.paletteAssignments) ?? [],
        )
      : new Uint8Array();
    let pixelOverrides = (
      isPlayfield
        ? loaded.playfield?.pixelOverrides
        : loaded.tileset?.pixelOverrides
    )
      ? new Uint8Array(
          (isPlayfield
            ? loaded.playfield?.pixelOverrides
            : loaded.tileset?.pixelOverrides) ?? [],
        )
      : new Uint8Array();

    if (matchingFile) {
      const lowerName = matchingFile.name.toLowerCase();
      const isChr = lowerName.endsWith('.chr');
      const isNes = lowerName.endsWith('.nes');
      try {
        if (isChr || isNes) {
          const rawBuffer = new Uint8Array(await matchingFile.arrayBuffer());
          const chrBytes = isNes ? extractNromChr(rawBuffer).chr : rawBuffer;
          const decodedTiles = decodeChr(chrBytes);
          const previewColors = loaded.palette.paletteSet[0].map(
            (c) => NES_MASTER_PALETTE[c] ?? { red: 0, green: 0, blue: 0 },
          );
          indexedImage = chrTilesToIndexedImage(decodedTiles, previewColors);
          sourceImage = null;
          width = indexedImage.width;
          height = indexedImage.height;
          if (paletteAssignments.length === 0) {
            paletteAssignments = new Uint8Array(
              assignmentsForImage(indexedImage, 'tileset'),
            );
          }
          if (pixelOverrides.length === 0) {
            pixelOverrides = new Uint8Array(indexedImage.pixels);
          }
          tiles = decodedTiles;
        } else {
          sourceImage = await decodeImage(matchingFile);
          width = sourceImage.width;
          height = sourceImage.height;
          indexedImage = quantizePngSource(
            sourceImage,
            loaded.mode,
            loaded.settings.quantization,
          );
          if (paletteAssignments.length === 0) {
            paletteAssignments = new Uint8Array(
              assignmentsForImage(indexedImage, loaded.mode),
            );
          }
          if (pixelOverrides.length === 0) {
            pixelOverrides = new Uint8Array(indexedImage.pixels.length);
          }
          const regionSize = paletteRegionSize(loaded.mode, indexedImage);
          const mapped = mapImageToNesPalettes(
            indexedImage,
            loaded.palette.paletteSet,
            paletteAssignments,
            regionSize,
            pixelOverrides,
            false,
            loaded.settings.quantization.colorDistanceMode,
          );
          tiles = extractTiles(mapped);
        }
      } catch (error: unknown) {
        if (!isChr && !isNes) {
          console.error('Project PNG load failed', {
            fileName: matchingFile.name,
            error,
          });
          restoredPngError =
            error instanceof PngLoadError
              ? displayPngLoadError(error.failure)
              : { key: 'imageProcessingFailed' };
        }
      }
    } else if (assetRef?.dataUrl) {
      const lowerName = (assetRef.name ?? assetRef.path).toLowerCase();
      const isChr = lowerName.endsWith('.chr');
      const isNes = lowerName.endsWith('.nes');
      try {
        if (isChr || isNes) {
          const rawBuffer = base64ToUint8Array(assetRef.dataUrl);
          const chrBytes = isNes ? extractNromChr(rawBuffer).chr : rawBuffer;
          const decodedTiles = decodeChr(chrBytes);
          const previewColors = loaded.palette.paletteSet[0].map(
            (c) => NES_MASTER_PALETTE[c] ?? { red: 0, green: 0, blue: 0 },
          );
          indexedImage = chrTilesToIndexedImage(decodedTiles, previewColors);
          sourceImage = null;
          width = indexedImage.width;
          height = indexedImage.height;
          if (paletteAssignments.length === 0) {
            paletteAssignments = new Uint8Array(
              assignmentsForImage(indexedImage, 'tileset'),
            );
          }
          if (pixelOverrides.length === 0) {
            pixelOverrides = new Uint8Array(indexedImage.pixels);
          }
          tiles = decodedTiles;
        } else {
          sourceImage = await decodeDataUrl(assetRef.dataUrl);
          width = sourceImage.width;
          height = sourceImage.height;
          indexedImage = quantizePngSource(
            sourceImage,
            loaded.mode,
            loaded.settings.quantization,
          );
          if (paletteAssignments.length === 0) {
            paletteAssignments = new Uint8Array(
              assignmentsForImage(indexedImage, loaded.mode),
            );
          }
          if (pixelOverrides.length === 0) {
            pixelOverrides = new Uint8Array(indexedImage.pixels.length);
          }
          const regionSize = paletteRegionSize(loaded.mode, indexedImage);
          const mapped = mapImageToNesPalettes(
            indexedImage,
            loaded.palette.paletteSet,
            paletteAssignments,
            regionSize,
            pixelOverrides,
            false,
            loaded.settings.quantization.colorDistanceMode,
          );
          tiles = extractTiles(mapped);
        }
      } catch (error: unknown) {
        if (!isChr && !isNes) {
          console.error('Embedded project PNG load failed', error);
          restoredPngError = { key: 'imageDecodeFailed' };
        }
      }
    }

    project = {
      assetId: assetRef?.id ?? null,
      fileName: assetRef?.name ?? assetRef?.path ?? null,
      sourceKind: assetRef?.sourceKind ?? 'png',
      width,
      height,
      sourceImage,
      indexedImage,
      tiles,
      mode: loaded.mode,
      deduplicationEnabled: loaded.settings.deduplicationEnabled,
      flipDeduplicationEnabled: loaded.settings.flipDeduplicationEnabled,
      collisionCells,
      activeCollisionType:
        loaded.playfield?.activeCollisionType ?? COLLISION_TYPES.solid,
      randomPlayfieldFeatures: loaded.playfield?.randomPlayfieldFeatures
        ? [...loaded.playfield.randomPlayfieldFeatures]
        : [...DEFAULT_RANDOM_PLAYFIELD_FEATURES],
      paletteSet: loaded.palette.paletteSet,
      palettes:
        loaded.palette.palettes ??
        createDefaultPaletteDefinitions(loaded.palette.paletteSet),
      activeSpritePaletteSlots:
        loaded.palette.activeSpritePaletteSlots ??
        (
          loaded.palette.palettes ??
          createDefaultPaletteDefinitions(loaded.palette.paletteSet)
        ).map((p) => p.id),
      paletteAssignments,
      pixelOverrides,
      activePaletteIndex: loaded.palette.activePaletteIndex ?? 0,
      activeColorIndex: loaded.palette.activeColorIndex ?? 1,
      chrRegions: loaded.chrRegions ?? [],
      animation: createDefaultAnimationSettings(),
      scenePreview: loaded.scenePreview ?? { instances: [] },
      quantizationSettings: loaded.settings.quantization,
    };
    resetTransientState(restoredPngError ?? missingError);
    render();
  } catch {
    setProjectError({ key: 'projectInvalidJson' });
  }
}

function createProjectHeader(): HTMLElement {
  return createHeader({
    projectName,
    isDirty: projectDirty,
    onProjectNameChange: (name) => {
      updateProjectName(name);
      render();
    },
    onNewProject: handleNewProject,
    onOpenProject: (file, companionFiles) => {
      void loadProjectFile(file, companionFiles);
    },
    onSaveProject: handleSaveProject,
    onSaveProjectAs: handleSaveProjectAs,
  });
}

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
    updateProject({ ...project, quantizationSettings: settings });
    render();
    return;
  }
  updateProject({ ...project, quantizationSettings: settings });
  setDerivedStatus({ ...derivedStatus, loading: true });
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
    updateProject({
      ...project,
      indexedImage,
      tiles: extractTiles(mappedImage),
      paletteAssignments: assignments,
      pixelOverrides,
      animation,
    });
    setDerivedStatus({ error: null, loading: false });
  } catch (error: unknown) {
    setDerivedStatus({
      loading: false,
      error:
        error instanceof ImageAnalysisError
          ? displayErrorFromAnalysis(error)
          : { key: 'invalidPixelData' },
    });
  }
  render();
}

function changeMode(mode: ProjectMode): void {
  resetAllTileHistories();
  if (
    mode !== 'tileset' &&
    (project.sourceKind === 'chr' || project.sourceKind === 'nes')
  ) {
    updateProject({
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
    });
    updateWorkspace({
      ...workspace,
      activeWorkspace: mode,
      zoomedPaletteRegion: null,
    });
    setDerivedStatus({ ...derivedStatus, error: null });
    render();
    return;
  }
  const paletteAssignments =
    project.indexedImage === null
      ? new Uint8Array()
      : assignmentsForImage(project.indexedImage, mode);
  updateProject({
    ...project,
    mode,
    deduplicationEnabled:
      mode === 'playfield' ? true : project.deduplicationEnabled,
    flipDeduplicationEnabled:
      mode === 'playfield' ? false : project.flipDeduplicationEnabled,
    paletteAssignments,
  });
  updateWorkspace({
    ...workspace,
    activeWorkspace: mode,
    zoomedPaletteRegion: null,
  });
  if (project.sourceKind === 'png' && project.sourceImage !== null) {
    void changeQuantizationSettings(project.quantizationSettings);
  } else {
    render();
  }
}

function addAnimation(): void {
  const count = project.animation.animations.length + 1;
  const newId = generateAnimationId();
  const lastAnim =
    project.animation.animations[project.animation.animations.length - 1];
  const newAnim: AnimationItemSetting = {
    id: newId,
    name: `anim_${String(count)}`,
    entity: lastAnim?.entity ?? 'entity',
    source: null,
    paletteId: lastAnim?.paletteId ?? project.palettes?.[0]?.id ?? null,
    paletteIndex: null,
    quantizationMode: lastAnim?.quantizationMode ?? 'median-cut',
    ditheringMode: lastAnim?.ditheringMode ?? 'none',
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
  };
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations: [...project.animation.animations, newAnim],
    },
  });
  updateWorkspace({
    ...workspace,
    animation: {
      ...workspace.animation,
      selectedAnimationId: newId,
    },
  });
  setDerivedStatus({ ...derivedStatus, error: null });
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
    entity: original.entity ?? 'entity',
    quantizationMode: original.quantizationMode ?? 'median-cut',
    ditheringMode: original.ditheringMode ?? 'none',
    frameIndices: [...original.frameIndices],
    frameDurations: [...original.frameDurations],
    framePalettes: original.framePalettes
      ? [...original.framePalettes]
      : undefined,
    framePaletteIds: original.framePaletteIds
      ? [...original.framePaletteIds]
      : undefined,
    pixelOverrides: original.pixelOverrides
      ? { ...original.pixelOverrides }
      : undefined,
  };
  const list = [...project.animation.animations];
  list.splice(index + 1, 0, copy);
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations: list,
    },
  });
  updateWorkspace({
    ...workspace,
    animation: {
      ...workspace.animation,
      selectedAnimationId: newId,
    },
  });
  setDerivedStatus({ ...derivedStatus, error: null });
  render();
}

function removeAnimation(animId: string): void {
  if (project.animation.animations.length <= 1) return;
  const remaining = project.animation.animations.filter((a) => a.id !== animId);
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations: remaining,
    },
  });
  if (
    workspace.animation.selectedAnimationId === animId ||
    !remaining.some((a) => a.id === workspace.animation.selectedAnimationId)
  ) {
    updateWorkspace({
      ...workspace,
      animation: {
        ...workspace.animation,
        selectedAnimationId: remaining[0]?.id ?? null,
      },
    });
  }
  setDerivedStatus({ ...derivedStatus, error: null });
  render();
}

function selectAnimation(animationId: string): void {
  updateWorkspace({
    ...workspace,
    animation: {
      ...workspace.animation,
      selectedAnimationId: animationId,
    },
  });
  render();
}

function selectAnimationTab(
  tab: 'frames' | 'pixels' | 'mapping' | 'scene',
): void {
  updateWorkspace({
    ...workspace,
    animation: {
      ...workspace.animation,
      activeTab: tab,
    },
  });
  render();
}

function toggleAnimationCollapse(animId: string): void {
  updateWorkspace({
    ...workspace,
    animation: {
      ...workspace.animation,
      collapsedAnimationIds: (
        workspace.animation.collapsedAnimationIds ?? []
      ).includes(animId)
        ? (workspace.animation.collapsedAnimationIds ?? []).filter(
            (id) => id !== animId,
          )
        : [...(workspace.animation.collapsedAnimationIds ?? []), animId],
    },
  });
  render();
}

function toggleAnimationConfigCollapse(): void {
  updateWorkspace({
    ...workspace,
    animation: {
      ...workspace.animation,
      configCollapsed: !workspace.animation.configCollapsed,
    },
  });
  render();
}

function toggleAnimationPaletteCollapse(): void {
  updateWorkspace({
    ...workspace,
    animation: {
      ...workspace.animation,
      paletteCollapsed: !workspace.animation.paletteCollapsed,
    },
  });
  render();
}

function toggleAnimationPreviewCollapse(): void {
  updateWorkspace({
    ...workspace,
    animation: {
      ...workspace.animation,
      previewCollapsed: !workspace.animation.previewCollapsed,
    },
  });
  render();
}

function updateAnimation(
  animId: string,
  patch: Partial<AnimationItemSetting>,
): void {
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations: project.animation.animations.map((a) => {
        if (a.id !== animId) return a;
        let updated = { ...a, ...patch };
        if (
          (patch.frameWidth !== undefined || patch.frameHeight !== undefined) &&
          updated.source !== null &&
          updated.frameWidth > 0 &&
          updated.frameHeight > 0
        ) {
          const totalFrames =
            Math.floor(updated.source.sourceImage.width / updated.frameWidth) *
            Math.floor(updated.source.sourceImage.height / updated.frameHeight);
          const validIndices = updated.frameIndices.filter(
            (idx) => idx < totalFrames,
          );
          const frameIndices =
            validIndices.length > 0
              ? validIndices
              : Array.from({ length: Math.max(1, totalFrames) }, (_, i) => i);
          const frameDurations = updated.frameDurations.slice(
            0,
            frameIndices.length,
          );
          const framePalettes = (updated.framePalettes ?? []).slice(
            0,
            frameIndices.length,
          );
          updated = {
            ...updated,
            frameIndices,
            frameDurations:
              frameDurations.length === frameIndices.length
                ? frameDurations
                : Array.from(
                    { length: frameIndices.length },
                    () => updated.defaultDuration,
                  ),
            framePalettes:
              framePalettes.length === frameIndices.length
                ? framePalettes
                : Array.from({ length: frameIndices.length }, () => null),
          };
        }
        if (
          (patch.quantizationMode !== undefined ||
            patch.ditheringMode !== undefined) &&
          updated.source !== null
        ) {
          const quantMode = updated.quantizationMode ?? 'median-cut';
          const dithMode = updated.ditheringMode ?? 'none';
          const reindexed = quantizePngSource(
            updated.source.sourceImage,
            'animation',
            {
              quantizationMode: quantMode,
              ditheringMode: dithMode,
              colorDistanceMode: project.quantizationSettings.colorDistanceMode,
            },
          );
          return {
            ...updated,
            source: {
              ...updated.source,
              indexedImage: reindexed,
            },
          };
        }
        return updated;
      }),
    },
  });
  setDerivedStatus({ ...derivedStatus, error: null });
  render();
}

function addSceneInstance(instance: ScenePreviewInstance): void {
  const currentInstances = project.scenePreview?.instances ?? [];
  updateProject({
    ...project,
    scenePreview: {
      instances: [...currentInstances, instance],
    },
  });
  updateWorkspace({
    ...workspace,
    animation: {
      ...workspace.animation,
      selectedSceneInstanceId: instance.id,
    },
  });
  render();
}

function removeSceneInstance(instanceId: string): void {
  const currentInstances = project.scenePreview?.instances ?? [];
  const remaining = currentInstances.filter((inst) => inst.id !== instanceId);
  updateProject({
    ...project,
    scenePreview: {
      instances: remaining,
    },
  });
  if (workspace.animation.selectedSceneInstanceId === instanceId) {
    updateWorkspace({
      ...workspace,
      animation: {
        ...workspace.animation,
        selectedSceneInstanceId: remaining[0]?.id ?? null,
      },
    });
  }
  render();
}

function duplicateSceneInstance(instanceId: string): void {
  const currentInstances = project.scenePreview?.instances ?? [];
  const target = currentInstances.find((inst) => inst.id === instanceId);
  if (!target) return;
  const clone: ScenePreviewInstance = {
    ...target,
    id: generateInstanceId(),
    name: target.name ? `${target.name} (Copy)` : undefined,
    x: Math.min(256, target.x + 8),
    y: Math.min(240, target.y + 8),
  };
  updateProject({
    ...project,
    scenePreview: {
      instances: [...currentInstances, clone],
    },
  });
  updateWorkspace({
    ...workspace,
    animation: {
      ...workspace.animation,
      selectedSceneInstanceId: clone.id,
    },
  });
  render();
}

function updateSceneInstance(
  instanceId: string,
  patch: Partial<ScenePreviewInstance>,
): void {
  const currentInstances = project.scenePreview?.instances ?? [];
  updateProject({
    ...project,
    scenePreview: {
      instances: currentInstances.map((inst) =>
        inst.id === instanceId ? { ...inst, ...patch } : inst,
      ),
    },
  });
  render();
}

function setTilePixel(
  animationId: string,
  tileX: number,
  tileY: number,
  pixelX: number,
  pixelY: number,
  colorIndex: number,
): void {
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations: project.animation.animations.map((a) => {
        if (a.id !== animationId) return a;
        const nextOverrides = setTilePixelOverride(
          a.pixelOverrides,
          tileX,
          tileY,
          pixelX,
          pixelY,
          colorIndex,
        );
        return {
          ...a,
          pixelOverrides: nextOverrides,
        };
      }),
    },
  });
  setDerivedStatus({ ...derivedStatus, error: null });
  render();
}

function resetTile(animationId: string, tileX: number, tileY: number): void {
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations: project.animation.animations.map((a) => {
        if (a.id !== animationId) return a;
        const nextOverrides = resetTileOverride(a.pixelOverrides, tileX, tileY);
        return {
          ...a,
          pixelOverrides: nextOverrides,
        };
      }),
    },
  });
  setDerivedStatus({ ...derivedStatus, error: null });
  render();
}

const chrTileHistoryMap = new Map<string, TileHistory<Uint8Array>>();

export function resetAllTileHistories(): void {
  chrTileHistoryMap.clear();
}

function getActiveTileHistory(
  physicalIndex: number | null,
  initialPixels: Uint8Array,
): TileHistory<Uint8Array> | undefined {
  if (physicalIndex === null || physicalIndex < 0 || physicalIndex >= 512) {
    return undefined;
  }
  const historyKey = `${project.mode}:${String(physicalIndex)}`;
  let history = chrTileHistoryMap.get(historyKey);
  if (!history) {
    history = createTileHistory(
      cloneTilePixels(initialPixels),
      50,
      areTilePixelsEqual,
    );
    chrTileHistoryMap.set(historyKey, history);
  }
  return history;
}

function captureChrEditorFocusSelector(): string | null {
  const activeElement = document.activeElement as HTMLElement | null;
  if (!activeElement?.closest('.chr-tile-editor')) return null;
  const tool = activeElement.getAttribute('data-tool');
  if (tool) return `[data-tool="${tool}"]`;
  const colorIndex = activeElement.getAttribute('data-color-index');
  if (colorIndex) return `[data-color-index="${colorIndex}"]`;
  const action = activeElement.getAttribute('data-action');
  if (action) return `[data-action="${action}"]`;
  if (activeElement.classList.contains('chr-editor-grid-btn')) {
    return '.chr-editor-grid-btn';
  }
  if (activeElement.classList.contains('chr-tile-editor-canvas')) {
    return '.chr-tile-editor-canvas';
  }
  return '.chr-tile-editor';
}

function restoreChrEditorFocus(selector: string | null): void {
  if (!selector) return;
  queueMicrotask(() => {
    const editor = document.querySelector<HTMLElement>('.chr-tile-editor');
    const target =
      selector === '.chr-tile-editor'
        ? editor
        : editor?.querySelector<HTMLElement>(selector);
    if (target instanceof HTMLButtonElement && target.disabled) {
      editor?.focus();
      return;
    }
    target?.focus();
  });
}

function handleChrTileEdit(physicalIndex: number, newPixels: Uint8Array): void {
  const { model: animModel } = resolveAnimationProjectModel(project);

  let playfieldNametable: Uint8Array | null = null;
  if (project.mode === 'playfield' && project.tiles.length > 0) {
    const regionSize = paletteRegionSize(
      project.mode,
      project.indexedImage ?? {
        width: 256,
        height: 240,
        pixels: new Uint8Array(256 * 240),
        colors: [],
        transparentIndex: 0,
        colorCount: 4,
      },
    );
    const mappedImage = mapImageToNesPalettes(
      project.indexedImage ?? {
        width: 256,
        height: 240,
        pixels: new Uint8Array(256 * 240),
        colors: [],
        transparentIndex: 0,
        colorCount: 4,
      },
      project.paletteSet,
      project.paletteAssignments,
      regionSize,
      project.pixelOverrides,
      false,
      project.quantizationSettings.colorDistanceMode,
    );
    const mappedTiles = extractTiles(mappedImage);
    try {
      const encodedPlayfield = encodePlayfield(
        mappedImage,
        mappedTiles,
        project.deduplicationEnabled,
        project.paletteAssignments,
      );
      playfieldNametable = encodedPlayfield.nametable;
    } catch {
      playfieldNametable = null;
    }
  }

  const destPt = project.animation.destinationPatternTable;

  const target = resolveTileEditOrigin({
    physicalIndex,
    mode: project.mode,
    animationModel: animModel,
    animations: project.animation.animations,
    selectedAnimationId:
      workspace.chr.selectedAnimationId ??
      workspace.animation.selectedAnimationId ??
      null,
    baseChr:
      project.animation.destinationChr.length > 0
        ? project.animation.destinationChr
        : null,
    baseChrName: project.animation.destinationChrName,
    destinationPatternTable: destPt,
    tiles: project.tiles,
    playfieldNametable,
    deduplicationEnabled: project.deduplicationEnabled,
    flipDeduplicationEnabled: project.flipDeduplicationEnabled,
  });

  const regionSize = project.indexedImage
    ? paletteRegionSize(project.mode, project.indexedImage)
    : 8;

  const result = applyChrTileEdit({
    physicalIndex,
    newPixels,
    target,
    mode: project.mode,
    animations: project.animation.animations,
    baseChr:
      project.animation.destinationChr.length > 0
        ? project.animation.destinationChr
        : null,
    baseChrName: project.animation.destinationChrName,
    destinationPatternTable: destPt,
    indexedImage: project.indexedImage,
    pixelOverrides: project.pixelOverrides,
    paletteSet: project.paletteSet,
    paletteAssignments: project.paletteAssignments,
    paletteRegionSize: regionSize,
    colorDistanceMode: project.quantizationSettings.colorDistanceMode,
  });

  if (!result.success) {
    console.error('Failed to apply CHR tile edit', result.errorMessage);
    return;
  }

  let nextProject = project;

  if (result.updatedAnimations) {
    nextProject = {
      ...nextProject,
      animation: {
        ...nextProject.animation,
        animations: result.updatedAnimations,
      },
    };
  }

  if (result.updatedDestinationChr) {
    nextProject = {
      ...nextProject,
      animation: {
        ...nextProject.animation,
        destinationChr: result.updatedDestinationChr,
        destinationChrName:
          result.updatedDestinationChrName ??
          nextProject.animation.destinationChrName,
        destinationPatternTable:
          result.updatedDestinationPatternTable ??
          nextProject.animation.destinationPatternTable,
      },
    };
  }

  if (result.updatedPixelOverrides) {
    nextProject = {
      ...nextProject,
      pixelOverrides: result.updatedPixelOverrides,
      tiles: result.updatedTiles ?? nextProject.tiles,
    };
  }

  updateProject(nextProject);
  setDerivedStatus({ ...derivedStatus, error: null });
  render();
}

async function loadAnimationSourceFile(
  animId: string,
  file: File,
): Promise<void> {
  cacheAssetFile(file);
  const pngLoad = await readAndDecodePng(file, decodePngBlob);
  if (!pngLoad.success) {
    console.error('Animation PNG load failed', {
      fileName: file.name,
      failure: pngLoad.failure,
    });
    setDerivedStatus({
      ...derivedStatus,
      error: displayPngLoadError(pngLoad.failure),
    });
    render();
    return;
  }

  try {
    const targetAnim = project.animation.animations.find(
      (a) => a.id === animId,
    );
    const quantMode = targetAnim?.quantizationMode ?? 'median-cut';
    const dithMode = targetAnim?.ditheringMode ?? 'none';
    const imageData = pngLoad.image;
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
    const detection = detectFrameGrid(imageData);
    const animations = project.animation.animations.map((anim) => {
      if (anim.id !== animId) return anim;
      const { width, height } = decideFrameDimensions(
        anim.frameWidth,
        anim.frameHeight,
        detection,
      );
      const columns = Math.floor(imageData.width / width);
      const rows = Math.floor(imageData.height / height);
      const totalFrames = columns * rows;
      const validIndices = anim.frameIndices.filter((idx) => idx < totalFrames);
      const validDurations = anim.frameDurations.slice(0, validIndices.length);
      const validPalettes = (anim.framePalettes ?? []).slice(
        0,
        validIndices.length,
      );

      const frameIndices =
        validIndices.length > 0
          ? validIndices
          : Array.from({ length: totalFrames }, (_, i) => i);
      const frameDurations =
        validDurations.length > 0
          ? validDurations
          : Array.from(
              { length: frameIndices.length },
              () => anim.defaultDuration,
            );
      const framePalettes =
        validPalettes.length > 0
          ? validPalettes
          : Array.from({ length: frameIndices.length }, () => null);

      return {
        ...anim,
        source,
        quantizationMode: quantMode,
        ditheringMode: dithMode,
        frameWidth: width,
        frameHeight: height,
        frameDetection: detection,
        frameIndices,
        frameDurations,
        framePalettes,
      };
    });
    updateProject({
      ...project,
      animation: {
        ...project.animation,
        animations,
      },
    });
    setDerivedStatus({ ...derivedStatus, error: null });
  } catch (error: unknown) {
    console.error('Animation PNG processing failed', {
      fileName: file.name,
      error,
    });
    setDerivedStatus({
      ...derivedStatus,
      error:
        error instanceof ImageAnalysisError
          ? displayErrorFromAnalysis(error)
          : { key: 'imageProcessingFailed' },
    });
  }
  render();
}

function reDetectAnimationFrames(animId: string): void {
  const anim = project.animation.animations.find((a) => a.id === animId);
  if (anim === undefined) return;
  if (anim.source === null) return;
  const detection = detectFrameGrid(anim.source.sourceImage);
  const { width, height } = decideFrameDimensions(
    anim.frameWidth,
    anim.frameHeight,
    detection,
  );
  const columns = Math.floor(anim.source.sourceImage.width / width);
  const rows = Math.floor(anim.source.sourceImage.height / height);
  const totalFrames = columns * rows;
  const validIndices = anim.frameIndices.filter((idx) => idx < totalFrames);
  const frameIndices =
    validIndices.length > 0
      ? validIndices
      : Array.from({ length: Math.max(1, totalFrames) }, (_, i) => i);
  const validDurations = anim.frameDurations.slice(0, frameIndices.length);
  const validPalettes = (anim.framePalettes ?? []).slice(
    0,
    frameIndices.length,
  );
  updateAnimation(animId, {
    frameDetection: detection,
    frameWidth: width,
    frameHeight: height,
    frameIndices,
    frameDurations:
      validDurations.length === frameIndices.length
        ? validDurations
        : Array.from(
            { length: frameIndices.length },
            () => anim.defaultDuration,
          ),
    framePalettes:
      validPalettes.length === frameIndices.length
        ? validPalettes
        : Array.from({ length: frameIndices.length }, () => null),
  });
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
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
  });
  setDerivedStatus({ ...derivedStatus, error: null });
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
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
  });
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
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
  });
  render();
}

function setAnimationFramePalette(
  animId: string,
  frameOrderIndex: number,
  paletteIndex: number | null,
  paletteId?: string | null,
): void {
  const animations = project.animation.animations.map((anim) => {
    if (anim.id !== animId) return anim;
    const framePalettes = [...(anim.framePalettes ?? [])];
    while (framePalettes.length < anim.frameIndices.length) {
      framePalettes.push(null);
    }
    framePalettes[frameOrderIndex] = paletteIndex;

    const framePaletteIds = [...(anim.framePaletteIds ?? [])];
    while (framePaletteIds.length < anim.frameIndices.length) {
      framePaletteIds.push(null);
    }
    framePaletteIds[frameOrderIndex] =
      paletteId !== undefined
        ? paletteId
        : paletteIndex !== null && project.palettes
          ? (project.palettes[paletteIndex]?.id ?? null)
          : null;

    return {
      ...anim,
      framePalettes,
      framePaletteIds,
    };
  });
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
  });
  setDerivedStatus({ ...derivedStatus, error: null });
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
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
  });
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
  updateProject({
    ...project,
    animation: {
      ...project.animation,
      animations,
    },
  });
  setDerivedStatus({ ...derivedStatus, error: null });
  render();
}

async function loadAnimationDestination(file: File): Promise<void> {
  cacheAssetFile(file);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0 || bytes.length % 16 !== 0 || bytes.length > 8192) {
      throw new RangeError('Invalid animation destination CHR.');
    }
    updateProject({
      ...project,
      animation: {
        ...project.animation,
        destinationChrName: file.name,
        destinationChr: bytes,
      },
    });
    setDerivedStatus({ ...derivedStatus, error: null });
  } catch {
    setDerivedStatus({
      ...derivedStatus,
      error: { key: 'animationErrorDestination' },
    });
  }
  render();
}

function createNewProjectPalette(name?: string): void {
  const currentPalettes =
    project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
  const newDef: PaletteDefinition = {
    id: generatePaletteId(),
    name: name ?? `Palette ${String(currentPalettes.length + 1)}`,
    colors: [0x0f, 0x00, 0x10, 0x30],
  };
  updateProject({
    ...project,
    palettes: [...currentPalettes, newDef],
  });
  render();
}

function updateProjectPaletteName(paletteId: string, name: string): void {
  const currentPalettes =
    project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
  updateProject({
    ...project,
    palettes: currentPalettes.map((p) =>
      p.id === paletteId ? { ...p, name } : p,
    ),
  });
  render();
}

function updateProjectPaletteColor(
  paletteId: string,
  colorSlotIndex: number,
  nesColor: number,
): void {
  const currentPalettes =
    project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
  const updatedPalettes = currentPalettes.map((p) => {
    if (p.id !== paletteId) return p;
    const newColors: [number, number, number, number] = [...p.colors];
    newColors[colorSlotIndex] = nesColor & 0x3f;
    return { ...p, colors: newColors };
  });
  const slots =
    project.activeSpritePaletteSlots ??
    updatedPalettes.slice(0, 4).map((p) => p.id);
  updateProject({
    ...project,
    palettes: updatedPalettes,
    paletteSet: resolveActivePaletteSet(
      updatedPalettes,
      slots,
      project.paletteSet,
    ),
  });
  render();
}

function duplicateProjectPalette(paletteId: string): void {
  const currentPalettes =
    project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
  const source = currentPalettes.find((p) => p.id === paletteId);
  if (source) {
    const dup = duplicatePaletteDefinition(source);
    updateProject({
      ...project,
      palettes: [...currentPalettes, dup],
    });
    render();
  }
}

function deleteProjectPalette(paletteId: string): void {
  const currentPalettes =
    project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
  const currentSlots =
    project.activeSpritePaletteSlots ??
    currentPalettes.slice(0, 4).map((p) => p.id);
  const newSlots = currentSlots.map((id) => (id === paletteId ? null : id));
  const updatedPalettes = currentPalettes.filter((p) => p.id !== paletteId);
  const updatedAnimations = project.animation.animations.map((anim) => {
    const nextPaletteId = anim.paletteId === paletteId ? null : anim.paletteId;
    const nextFramePaletteIds = anim.framePaletteIds?.map((id) =>
      id === paletteId ? null : id,
    );
    return {
      ...anim,
      paletteId: nextPaletteId,
      ...(nextFramePaletteIds ? { framePaletteIds: nextFramePaletteIds } : {}),
    };
  });
  updateProject({
    ...project,
    palettes: updatedPalettes,
    activeSpritePaletteSlots: newSlots,
    paletteSet: resolveActivePaletteSet(
      updatedPalettes,
      newSlots,
      project.paletteSet,
    ),
    animation: {
      ...project.animation,
      animations: updatedAnimations,
    },
  });
  render();
}

function updateActiveSpritePaletteSlot(
  slotIndex: 0 | 1 | 2 | 3,
  paletteId: string | null,
): void {
  const currentPalettes =
    project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
  const currentSlots = [
    ...(project.activeSpritePaletteSlots ??
      currentPalettes.slice(0, 4).map((p) => p.id)),
  ];
  currentSlots[slotIndex] = paletteId;
  updateProject({
    ...project,
    activeSpritePaletteSlots: currentSlots,
    paletteSet: resolveActivePaletteSet(
      currentPalettes,
      currentSlots,
      project.paletteSet,
    ),
  });
  render();
}

function resolveAnimationProjectModel(prj: ProjectView): {
  model: AnimationProjectModel | null;
  modelError: AnimationModelError | null;
} {
  let model: AnimationProjectModel | null = null;
  let modelError: AnimationModelError | null = null;

  if (prj.mode !== 'animation') {
    return { model: null, modelError: null };
  }

  try {
    const definitions: AnimationDefinitionInput[] = [];
    for (const anim of prj.animation.animations) {
      if (anim.source !== null && anim.frameIndices.length > 0) {
        const entityName =
          anim.entity?.trim() !== '' && anim.entity
            ? anim.entity.trim()
            : 'entity';
        const compositeName = `${entityName}_${anim.name}`;
        definitions.push({
          id: anim.id,
          name: compositeName,
          entity: entityName,
          sourceImageName: anim.source.fileName,
          image: anim.source.indexedImage,
          paletteIndex: anim.paletteIndex ?? null,
          quantizationMode: anim.quantizationMode ?? 'median-cut',
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
          pixelOverrides: anim.pixelOverrides,
        });
      }
    }

    if (definitions.length > 0) {
      const primaryEntity =
        prj.animation.animations[0]?.entity ?? prj.animation.name;
      model = buildAnimationProjectModel({
        name: primaryEntity,
        symbolPrefix: primaryEntity,
        animations: definitions,
        defaultPaletteIndex: prj.animation.defaultPaletteIndex,
        quantizationMode: prj.animation.quantizationMode,
        baseChr: prj.animation.destinationChr,
        patternTable: prj.animation.patternTable,
        destinationPatternTable: prj.animation.destinationPatternTable,
        flipDeduplication: prj.animation.flipDeduplication,
        spritePalette: prj.animation.spritePalette,
        chrRegions: prj.chrRegions,
      });
    }
  } catch (error: unknown) {
    if (error instanceof AnimationModelError) modelError = error;
    else throw error;
  }

  return { model, modelError };
}

function renderAnimationWorkspace(): void {
  const workspaceElement = document.createElement('div');
  workspaceElement.className = 'workspace animation-workspace';
  const { model, modelError } = resolveAnimationProjectModel(project);

  const selectedAnimationId =
    workspace.animation.selectedAnimationId !== undefined &&
    workspace.animation.selectedAnimationId !== null &&
    project.animation.animations.some(
      (a) => a.id === workspace.animation.selectedAnimationId,
    )
      ? workspace.animation.selectedAnimationId
      : (project.animation.animations[0]?.id ?? null);

  const animationEditorSettings: AnimationSettings = {
    ...project.animation,
    animations: project.animation.animations.map((animation) => ({
      ...animation,
      collapsed: (workspace.animation.collapsedAnimationIds ?? []).includes(
        animation.id,
      ),
    })),
    configCollapsed: workspace.animation.configCollapsed,
    paletteCollapsed: workspace.animation.paletteCollapsed,
    mappingCollapsed: workspace.animation.mappingCollapsed,
  };
  const editorOptions: AnimationEditorOptions = {
    settings: animationEditorSettings,
    selectedAnimationId,
    selectedSceneInstanceId: workspace.animation.selectedSceneInstanceId,
    activeTab: workspace.animation.activeTab ?? 'frames',
    previewCollapsed: workspace.animation.previewCollapsed,
    configCollapsed: workspace.animation.configCollapsed,
    paletteCollapsed: workspace.animation.paletteCollapsed,
    model,
    modelError,
    paletteSet: project.paletteSet,
    palettes: project.palettes,
    activeSpritePaletteSlots: project.activeSpritePaletteSlots,
    colorDistanceMode: project.quantizationSettings.colorDistanceMode,
    scenePreview: project.scenePreview,
    onSelectAnimation: selectAnimation,
    onSelectTab: selectAnimationTab,
    onSelectSceneInstance: (id: string | null) => {
      updateWorkspace({
        ...workspace,
        animation: {
          ...workspace.animation,
          selectedSceneInstanceId: id,
        },
      });
      render();
    },
    onSettingsChange: (animation: AnimationSettings) => {
      updateProject({
        ...project,
        animation: {
          ...project.animation,
          flipDeduplication: animation.flipDeduplication,
          patternTable: animation.patternTable,
          destinationPatternTable: animation.destinationPatternTable,
        },
      });
      setDerivedStatus({ ...derivedStatus, error: null });
      render();
    },
    onDefaultPaletteIndexChange: (defaultPaletteIndex: number) => {
      updateProject({
        ...project,
        animation: {
          ...project.animation,
          defaultPaletteIndex,
        },
      });
      setDerivedStatus({ ...derivedStatus, error: null });
      render();
    },
    onAddAnimation: addAnimation,
    onDuplicateAnimation: duplicateAnimation,
    onRemoveAnimation: removeAnimation,
    onToggleAnimationCollapse: toggleAnimationCollapse,
    onTogglePreviewCollapse: toggleAnimationPreviewCollapse,
    onToggleMappingCollapse: () => {
      updateWorkspace({
        ...workspace,
        animation: {
          ...workspace.animation,
          mappingCollapsed: !workspace.animation.mappingCollapsed,
        },
      });
      render();
    },
    onToggleConfigCollapse: toggleAnimationConfigCollapse,
    onTogglePaletteCollapse: toggleAnimationPaletteCollapse,
    onAddSceneInstance: addSceneInstance,
    onRemoveSceneInstance: removeSceneInstance,
    onDuplicateSceneInstance: duplicateSceneInstance,
    onUpdateSceneInstance: updateSceneInstance,
    onSetTilePixel: setTilePixel,
    onResetTileOverride: resetTile,
    onUpdateAnimation: updateAnimation,
    onAnimationSourceFile: (animId: string, file: File) => {
      void loadAnimationSourceFile(animId, file);
    },
    onFrameDetection: reDetectAnimationFrames,
    onFrameToggle: toggleAnimationFrame,
    onFrameMove: moveAnimationFrame,
    onFrameDurationChange: setAnimationFrameDuration,
    onFramePaletteChange: setAnimationFramePalette,
    onApplyDefaultDurationToAll: applyDefaultDurationToAll,
    onFrameRemoveFromAnimation: removeFrameFromAnimation,
    onCreatePalette: createNewProjectPalette,
    onUpdatePaletteName: updateProjectPaletteName,
    onUpdatePaletteColorDef: updateProjectPaletteColor,
    onDuplicatePalette: duplicateProjectPalette,
    onDeletePalette: deleteProjectPalette,
    onUpdateActiveSlot: updateActiveSpritePaletteSlot,
    onSpritePaletteSelectionChange: (
      paletteIndex: number,
      colorIndex: number,
    ) => {
      updateProject({
        ...project,
        animation: {
          ...project.animation,
          spritePalette: paletteIndex,
          spriteColorIndex: colorIndex,
        },
      });
      setDerivedStatus({ ...derivedStatus, error: null });
      render();
    },
    onPaletteColorChange: (
      paletteIndex: number,
      colorIndex: number,
      colorCode: number,
    ) => {
      updateProject({
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
      });
      setDerivedStatus({ ...derivedStatus, error: null });
      render();
    },
    onDestinationFile: (file: File) => void loadAnimationDestination(file),
    onDestinationClear: () => {
      updateProject({
        ...project,
        animation: {
          ...project.animation,
          destinationChrName: null,
          destinationChr: new Uint8Array(),
        },
      });
      setDerivedStatus({ ...derivedStatus, error: null });
      render();
    },
    onInspectInChr: (physicalTileIndex) => {
      updateWorkspace({
        ...workspace,
        activeWorkspace: 'chr',
        chr: { ...workspace.chr, selectedTileIndex: physicalTileIndex },
      });
      render();
    },
    onDownloadBytes: downloadBytes,
    onDownloadText: downloadText,
  };

  workspaceElement.append(...createAnimationEditor(editorOptions));
  let errorElement: HTMLElement | null = null;
  if (derivedStatus.error !== null) {
    const error = document.createElement('section');
    error.className = 'panel error-panel animation-error-panel';
    const heading = document.createElement('h2');
    heading.textContent = t('errorTitle');
    const message = document.createElement('p');
    message.textContent = t(
      derivedStatus.error.key,
      derivedStatus.error.variables,
    );
    error.append(heading, message);
    errorElement = error;
  }
  const sidebar = createSidebar({
    activeWorkspace: 'animation',
    fileName: project.fileName,
    onWorkspaceChange: (view) => {
      updateWorkspace({ ...workspace, activeWorkspace: view });
      if (view !== 'palette' && view !== 'chr' && view !== 'deliver') {
        changeMode(view);
      } else {
        render();
      }
    },
  });
  const inspector = createInspector();
  const shell = createAppShell({
    header: createProjectHeader(),
    sidebar,
    workspace: workspaceElement,
    inspector,
    diagnostics: errorElement,
  });
  app.replaceChildren(shell);
}

function renderTilesetWorkspace(): void {
  ensureQuantizationPreviews();
  const workspaceElement = createTilesetWorkspace({
    fileName: project.fileName,
    sourceKind: project.sourceKind,
    width: project.width,
    height: project.height,
    sourceImage: project.sourceImage,
    indexedImage: project.indexedImage,
    tiles: project.tiles,
    deduplicationEnabled: project.deduplicationEnabled,
    flipDeduplicationEnabled: project.flipDeduplicationEnabled,
    paletteSet: project.paletteSet,
    paletteAssignments: project.paletteAssignments,
    pixelOverrides: project.pixelOverrides,
    activePaletteIndex: project.activePaletteIndex,
    activeColorIndex: project.activeColorIndex,
    quantizationSettings: project.quantizationSettings,
    quantizationPreviews,
    quantizationPreviewsLoading,
    quantizationCollapsed: workspace.quantizationCollapsed,
    showPaletteNumbers: workspace.showPaletteNumbers,
    previewTool: workspace.previewTool,
    zoomedPaletteRegion: workspace.zoomedPaletteRegion,
    paletteColorTarget: workspace.paletteColorTarget,
    loading: derivedStatus.loading,
    error: derivedStatus.error,
    onModeChange: changeMode,
    onFile: (file) => void loadFile(file),
    onToggleQuantizationCollapse: () => {
      updateWorkspace({
        ...workspace,
        quantizationCollapsed: !workspace.quantizationCollapsed,
      });
      render();
    },
    onQuantizationSettingsChange: (settings) =>
      void changeQuantizationSettings(settings),
    onActiveToolChange: (previewTool) => {
      updateWorkspace({ ...workspace, previewTool });
      render();
    },
    onPaletteRegionSelect: (zoomedPaletteRegion) => {
      updateWorkspace({ ...workspace, zoomedPaletteRegion });
      render();
    },
    onActivePaletteChange: (activePaletteIndex) => {
      updateProject({ ...project, activePaletteIndex });
      render();
    },
    onActiveColorChange: (activeColorIndex) => {
      updateProject({ ...project, activeColorIndex });
      render();
    },
    onShowPaletteNumbersChange: (showPaletteNumbers) => {
      updateWorkspace({ ...workspace, showPaletteNumbers });
      render();
    },
    onZoomedRegionChange: (zoomedPaletteRegion) => {
      updateWorkspace({ ...workspace, zoomedPaletteRegion });
      render();
    },
    onColorTargetChange: (paletteColorTarget) => {
      updateWorkspace({ ...workspace, paletteColorTarget });
      render();
    },
    onPaletteColorChange: (paletteIndex, colorIndex, colorCode) => {
      updateProject({
        ...project,
        paletteSet: setNesPaletteColor(
          project.paletteSet,
          paletteIndex,
          colorIndex,
          colorCode,
        ),
      });
      render();
    },
    onPixelOverridesChange: (pixelOverrides, paletteAssignments) => {
      updateProject({ ...project, pixelOverrides, paletteAssignments });
      render();
    },
    onDeduplicationChange: (enabled) => {
      updateProject({
        ...project,
        deduplicationEnabled: enabled,
        flipDeduplicationEnabled: enabled
          ? project.flipDeduplicationEnabled
          : false,
      });
      render();
    },
    onFlipDeduplicationChange: (enabled) => {
      updateProject({ ...project, flipDeduplicationEnabled: enabled });
      render();
    },
    onInspectInChr: (physicalTileIndex) => {
      updateWorkspace({
        ...workspace,
        activeWorkspace: 'chr',
        chr: { ...workspace.chr, selectedTileIndex: physicalTileIndex },
      });
      render();
    },
    onDownloadBytes: downloadBytes,
  });

  const sidebar = createSidebar({
    activeWorkspace: 'tileset',
    fileName: project.fileName,
    quantizationMode: project.quantizationSettings.quantizationMode,
    onQuantizationModeChange: (quantizationMode) => {
      void changeQuantizationSettings({
        ...project.quantizationSettings,
        quantizationMode,
      });
    },
    onWorkspaceChange: (view) => {
      updateWorkspace({ ...workspace, activeWorkspace: view });
      if (view !== 'palette' && view !== 'chr' && view !== 'deliver') {
        changeMode(view);
      } else {
        render();
      }
    },
  });
  const inspector = createInspector();
  const shell = createAppShell({
    header: createProjectHeader(),
    sidebar,
    workspace: workspaceElement,
    inspector,
    diagnostics: workspaceElement.diagnosticsElement,
  });
  app.replaceChildren(shell);
}

function renderPlayfieldWorkspace(): void {
  ensureQuantizationPreviews();
  const workspaceElement = createPlayfieldWorkspace({
    fileName: project.fileName,
    sourceKind: project.sourceKind,
    width: project.width,
    height: project.height,
    sourceImage: project.sourceImage,
    indexedImage: project.indexedImage,
    tiles: project.tiles,
    deduplicationEnabled: project.deduplicationEnabled,
    collisionCells: project.collisionCells,
    activeCollisionType: project.activeCollisionType,
    randomPlayfieldFeatures: project.randomPlayfieldFeatures,
    paletteSet: project.paletteSet,
    paletteAssignments: project.paletteAssignments,
    pixelOverrides: project.pixelOverrides,
    activePaletteIndex: project.activePaletteIndex,
    activeColorIndex: project.activeColorIndex,
    quantizationSettings: project.quantizationSettings,
    quantizationPreviews,
    quantizationPreviewsLoading,
    quantizationCollapsed: workspace.quantizationCollapsed,
    showPaletteNumbers: workspace.showPaletteNumbers,
    previewTool: workspace.previewTool,
    zoomedPaletteRegion: workspace.zoomedPaletteRegion,
    paletteColorTarget: workspace.paletteColorTarget,
    loading: derivedStatus.loading,
    error: derivedStatus.error,
    onModeChange: changeMode,
    onFile: (file) => void loadFile(file),
    onRandomPlayfieldFeaturesChange: (randomPlayfieldFeatures) => {
      updateProject({ ...project, randomPlayfieldFeatures });
      render();
    },
    onGeneratePlayfield: generatePlayfield,
    onToggleQuantizationCollapse: () => {
      updateWorkspace({
        ...workspace,
        quantizationCollapsed: !workspace.quantizationCollapsed,
      });
      render();
    },
    onQuantizationSettingsChange: (settings) =>
      void changeQuantizationSettings(settings),
    onActiveToolChange: (previewTool) => {
      updateWorkspace({ ...workspace, previewTool });
      render();
    },
    onCollisionChange: (collisionCells) => {
      updateProject({ ...project, collisionCells });
      render();
    },
    onCollisionTypeChange: (activeCollisionType) => {
      updateProject({
        ...project,
        activeCollisionType,
      });
      updateWorkspace({ ...workspace, previewTool: 'paint-collision' });
      render();
    },
    onPaletteRegionSelect: (zoomedPaletteRegion) => {
      updateWorkspace({ ...workspace, zoomedPaletteRegion });
      render();
    },
    onActivePaletteChange: (activePaletteIndex) => {
      updateProject({ ...project, activePaletteIndex });
      render();
    },
    onActiveColorChange: (activeColorIndex) => {
      updateProject({ ...project, activeColorIndex });
      render();
    },
    onShowPaletteNumbersChange: (showPaletteNumbers) => {
      updateWorkspace({ ...workspace, showPaletteNumbers });
      render();
    },
    onZoomedRegionChange: (zoomedPaletteRegion) => {
      updateWorkspace({ ...workspace, zoomedPaletteRegion });
      render();
    },
    onColorTargetChange: (paletteColorTarget) => {
      updateWorkspace({ ...workspace, paletteColorTarget });
      render();
    },
    onPaletteColorChange: (paletteIndex, colorIndex, colorCode) => {
      updateProject({
        ...project,
        paletteSet: setNesPaletteColor(
          project.paletteSet,
          paletteIndex,
          colorIndex,
          colorCode,
        ),
      });
      render();
    },
    onPixelOverridesChange: (pixelOverrides, paletteAssignments) => {
      updateProject({ ...project, pixelOverrides, paletteAssignments });
      render();
    },
    onDeduplicationChange: (enabled) => {
      updateProject({
        ...project,
        deduplicationEnabled: enabled,
      });
      render();
    },
    onInspectInChr: (physicalTileIndex) => {
      updateWorkspace({
        ...workspace,
        activeWorkspace: 'chr',
        chr: { ...workspace.chr, selectedTileIndex: physicalTileIndex },
      });
      render();
    },
    onDownloadBytes: downloadBytes,
  });

  const sidebar = createSidebar({
    activeWorkspace: 'playfield',
    fileName: project.fileName,
    quantizationMode: project.quantizationSettings.quantizationMode,
    onQuantizationModeChange: (quantizationMode) => {
      void changeQuantizationSettings({
        ...project.quantizationSettings,
        quantizationMode,
      });
    },
    onWorkspaceChange: (view) => {
      updateWorkspace({ ...workspace, activeWorkspace: view });
      if (view !== 'palette' && view !== 'chr' && view !== 'deliver') {
        changeMode(view);
      } else {
        render();
      }
    },
  });
  const inspector = createInspector();
  const shell = createAppShell({
    header: createProjectHeader(),
    sidebar,
    workspace: workspaceElement,
    inspector,
    diagnostics: workspaceElement.diagnosticsElement,
  });
  app.replaceChildren(shell);
}

function renderPaletteWorkspace(): void {
  const palettes =
    project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
  const activeSpritePaletteSlots =
    project.activeSpritePaletteSlots ?? palettes.slice(0, 4).map((p) => p.id);

  const workspaceElement = createPaletteWorkspace({
    palettes,
    activeSpritePaletteSlots,
    animations: project.animation.animations,
    paletteSet: project.paletteSet,
    loading: derivedStatus.loading,
    error: derivedStatus.error,
    onCreatePalette: createNewProjectPalette,
    onUpdatePaletteName: updateProjectPaletteName,
    onUpdatePaletteColor: updateProjectPaletteColor,
    onDuplicatePalette: duplicateProjectPalette,
    onDeletePalette: deleteProjectPalette,
    onUpdateActiveSlot: updateActiveSpritePaletteSlot,
    onDownloadBytes: downloadBytes,
  });

  const sidebar = createSidebar({
    activeWorkspace: 'palette',
    fileName: project.fileName,
    onWorkspaceChange: (view) => {
      updateWorkspace({ ...workspace, activeWorkspace: view });
      if (view !== 'palette' && view !== 'chr' && view !== 'deliver') {
        changeMode(view);
      } else {
        render();
      }
    },
  });
  const inspector = createInspector();
  const shell = createAppShell({
    header: createProjectHeader(),
    sidebar,
    workspace: workspaceElement,
    inspector,
    diagnostics: workspaceElement.diagnosticsElement,
  });
  app.replaceChildren(shell);
}

function renderChrWorkspace(): void {
  const { model: animModel } = resolveAnimationProjectModel(project);
  const manualChr =
    project.animation.destinationChr.length > 0
      ? project.animation.destinationChr
      : null;
  const manualChrName = project.animation.destinationChrName;
  const destinationPatternTable = project.animation.destinationPatternTable;

  let playfieldNametable: Uint8Array | null = null;
  if (project.mode === 'playfield' && project.indexedImage !== null) {
    const regionSize =
      project.indexedImage.width === 256 && project.indexedImage.height === 240
        ? PLAYFIELD_PALETTE_REGION_SIZE
        : TILESET_PALETTE_REGION_SIZE;
    const mappedImage = mapImageToNesPalettes(
      project.indexedImage,
      project.paletteSet,
      project.paletteAssignments,
      regionSize,
      project.pixelOverrides,
      false,
      project.quantizationSettings.colorDistanceMode,
    );
    const mappedTiles = extractTiles(mappedImage).slice(
      0,
      project.tiles.length,
    );
    try {
      const encodedPlayfield = encodePlayfield(
        mappedImage,
        mappedTiles,
        project.deduplicationEnabled,
        project.paletteAssignments,
      );
      playfieldNametable = encodedPlayfield.nametable;
    } catch {
      playfieldNametable = null;
    }
  }

  const selectedPhysicalTile = workspace.chr.selectedTileIndex;
  const projectedTiles = project.flipDeduplicationEnabled
    ? deduplicateTilesConsideringFlips(project.tiles)
    : project.deduplicationEnabled
      ? deduplicateTiles(project.tiles)
      : project.tiles;
  const currentFinalChr =
    animModel?.finalChr ??
    (manualChr
      ? composeChrWithAllocatedTiles(
          manualChr,
          destinationPatternTable,
          projectedTiles,
          project.chrRegions,
        )
      : project.chrRegions && project.chrRegions.length > 0
        ? composeChrWithAllocatedTiles(
            new Uint8Array(8192),
            0,
            projectedTiles,
            project.chrRegions,
          )
        : project.tiles.length > 0
          ? padChrRom(encodeChr(projectedTiles))
          : new Uint8Array(8192));

  const tileHistory =
    selectedPhysicalTile !== null &&
    selectedPhysicalTile >= 0 &&
    selectedPhysicalTile < 512
      ? getActiveTileHistory(
          selectedPhysicalTile,
          extractTilePixelsFromChr(currentFinalChr, selectedPhysicalTile),
        )
      : undefined;

  const workspaceElement = createChrWorkspace({
    mode: project.mode,
    animationModel: animModel,
    playfieldNametable,
    baseChr: manualChr,
    baseChrName: manualChrName,
    patternTable:
      project.mode === 'animation' ? project.animation.patternTable : 0,
    destinationPatternTable,
    tiles: project.tiles,
    deduplicationEnabled: project.deduplicationEnabled,
    flipDeduplicationEnabled: project.flipDeduplicationEnabled,
    chrRegions: project.chrRegions,
    zoom: workspace.chr.zoom,
    onZoomChange: (zoom) => {
      updateWorkspace({
        ...workspace,
        chr: { ...workspace.chr, zoom },
      });
      render();
    },
    selectedTileIndex: workspace.chr.selectedTileIndex,
    onSelectTile: (selectedTileIndex) => {
      updateWorkspace({
        ...workspace,
        chr: { ...workspace.chr, selectedTileIndex },
      });
      render();
    },
    previewPalette: workspace.chr.previewPalette ?? 'grayscale',
    onPreviewPaletteChange: (previewPalette) => {
      updateWorkspace({
        ...workspace,
        chr: { ...workspace.chr, previewPalette },
      });
      render();
    },
    highlightScope: workspace.chr.highlightScope ?? 'none',
    onHighlightScopeChange: (highlightScope) => {
      updateWorkspace({
        ...workspace,
        chr: { ...workspace.chr, highlightScope },
      });
      render();
    },
    selectedAnimationId:
      workspace.chr.selectedAnimationId ??
      workspace.animation.selectedAnimationId ??
      animModel?.animations[0]?.id ??
      null,
    onSelectAnimation: (selectedAnimationId) => {
      updateWorkspace({
        ...workspace,
        chr: { ...workspace.chr, selectedAnimationId, selectedFrameIndex: 0 },
      });
      render();
    },
    selectedFrameIndex:
      workspace.chr.selectedFrameIndex ??
      workspace.animation.selectedFrameIndex ??
      0,
    onSelectFrame: (selectedFrameIndex) => {
      updateWorkspace({
        ...workspace,
        chr: { ...workspace.chr, selectedFrameIndex },
      });
      render();
    },
    selectedEntity: workspace.chr.selectedEntity ?? null,
    onSelectEntity: (selectedEntity) => {
      updateWorkspace({
        ...workspace,
        chr: { ...workspace.chr, selectedEntity },
      });
      render();
    },
    heatmapEnabled: workspace.chr.heatmapEnabled ?? false,
    onToggleHeatmap: (heatmapEnabled) => {
      updateWorkspace({
        ...workspace,
        chr: { ...workspace.chr, heatmapEnabled },
      });
      render();
    },
    paletteSet: project.paletteSet,
    palettes: project.palettes,
    activeSpritePaletteSlots: project.activeSpritePaletteSlots,
    loading: derivedStatus.loading,
    error: derivedStatus.error,
    onNavigateToWorkspace: (view) => {
      updateWorkspace({ ...workspace, activeWorkspace: view });
      if (view !== 'palette' && view !== 'chr' && view !== 'deliver') {
        changeMode(view);
      } else {
        render();
      }
    },
    onNavigateToAnimation: (animationId, frameIndex) => {
      updateWorkspace({
        ...workspace,
        activeWorkspace: 'animation',
        animation: {
          ...workspace.animation,
          selectedAnimationId: animationId,
          selectedFrameIndex: frameIndex,
        },
      });
      changeMode('animation');
    },
    onNavigateToPlayfield: (column, row) => {
      updateWorkspace({
        ...workspace,
        activeWorkspace: 'playfield',
        zoomedPaletteRegion: Math.floor(row / 2) * 16 + Math.floor(column / 2),
      });
      changeMode('playfield');
    },
    onNavigateToTileset: () => {
      updateWorkspace({
        ...workspace,
        activeWorkspace: 'tileset',
      });
      changeMode('tileset');
    },
    onDownloadBytes: downloadBytes,
    onDownloadText: downloadText,
    history: tileHistory,
    editorState: {
      activeTool: workspace.chr.editorTool,
      selectedColorIndex: workspace.chr.editorColorIndex,
      showGrid: workspace.chr.editorShowGrid,
      shiftWrap: workspace.chr.editorShiftWrap,
    },
    onEditorStateChange: (editorState) => {
      const focusSelector = captureChrEditorFocusSelector();
      updateWorkspace({
        ...workspace,
        chr: {
          ...workspace.chr,
          editorTool: editorState.activeTool,
          editorColorIndex: editorState.selectedColorIndex,
          editorShowGrid: editorState.showGrid,
          editorShiftWrap: editorState.shiftWrap,
        },
      });
      render();
      restoreChrEditorFocus(focusSelector);
    },
    onTilePixelsChange: (physicalIndex, newPixels) => {
      const focusSelector = captureChrEditorFocusSelector();
      handleChrTileEdit(physicalIndex, newPixels);
      restoreChrEditorFocus(focusSelector);
    },
    onUpdateChrRegions: (chrRegions) => {
      updateProject({
        ...project,
        chrRegions,
      });
      render();
    },
  });

  const sidebar = createSidebar({
    activeWorkspace: 'chr',
    fileName: project.fileName,
    onWorkspaceChange: (view) => {
      updateWorkspace({ ...workspace, activeWorkspace: view });
      if (view !== 'palette' && view !== 'chr' && view !== 'deliver') {
        changeMode(view);
      } else {
        render();
      }
    },
  });
  const inspector = createInspector();
  const shell = createAppShell({
    header: createProjectHeader(),
    sidebar,
    workspace: workspaceElement,
    inspector,
    diagnostics: workspaceElement.diagnosticsElement,
  });
  app.replaceChildren(shell);
}

function renderDeliveryWorkspace(): void {
  const { model: animModel, modelError: animModelError } =
    resolveAnimationProjectModel(project);

  const tiles = project.tiles;
  const deduplicated = deduplicateTiles(tiles);
  const flipDeduplicated = deduplicateTilesConsideringFlips(tiles);
  const activeDeduplicatedTiles = project.flipDeduplicationEnabled
    ? flipDeduplicated
    : deduplicated;
  const tileCount =
    project.mode === 'playfield' ||
    project.deduplicationEnabled ||
    project.flipDeduplicationEnabled
      ? activeDeduplicatedTiles.length
      : tiles.length;

  const originalTileCount = tiles.length;
  let chr: Uint8Array | null = null;
  let nametable: Uint8Array | null = null;
  let attributeTable: Uint8Array | null = null;
  let collisionMap: Uint8Array | null = null;

  if (
    project.mode !== 'animation' &&
    (tiles.length > 0 || project.animation.destinationChr.length > 0)
  ) {
    const tilesToEncode =
      project.mode === 'playfield' ||
      project.deduplicationEnabled ||
      project.flipDeduplicationEnabled
        ? activeDeduplicatedTiles
        : tiles;
    chr =
      project.animation.destinationChr.length > 0
        ? composeChrWithAllocatedTiles(
            project.animation.destinationChr,
            project.animation.destinationPatternTable,
            tilesToEncode,
            project.chrRegions,
          )
        : project.chrRegions && project.chrRegions.length > 0
          ? composeChrWithAllocatedTiles(
              new Uint8Array(8192),
              0,
              tilesToEncode,
              project.chrRegions,
            )
          : padChrRom(encodeChr(tilesToEncode));

    if (project.mode === 'playfield' && project.indexedImage !== null) {
      const regionSize = PLAYFIELD_PALETTE_REGION_SIZE;
      const mappedImage = mapImageToNesPalettes(
        project.indexedImage,
        project.paletteSet,
        project.paletteAssignments,
        regionSize,
        project.pixelOverrides,
        false,
        project.quantizationSettings.colorDistanceMode,
      );
      const mappedTiles = extractTiles(mappedImage).slice(
        0,
        project.tiles.length,
      );
      try {
        const encodedPlayfield = encodePlayfield(
          mappedImage,
          mappedTiles,
          project.deduplicationEnabled,
          project.paletteAssignments,
        );
        nametable = encodedPlayfield.nametable;
        attributeTable = encodedPlayfield.attributeTable;
      } catch {
        nametable = null;
        attributeTable = null;
      }
      try {
        collisionMap = encodeCollisionMap(project.collisionCells);
      } catch {
        collisionMap = null;
      }
    }
  }

  const palettes =
    project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
  const activeSpritePaletteSlots =
    project.activeSpritePaletteSlots ?? palettes.slice(0, 4).map((p) => p.id);

  const classifications = classifyChrSlots({
    finalChrBytes: animModel?.finalChr ?? chr ?? new Uint8Array(8192),
    mode: project.mode,
    animationModel: animModel,
    baseChr: project.animation.destinationChr,
    destinationPatternTable: project.animation.destinationPatternTable,
    tiles: project.tiles,
    deduplicationEnabled: project.deduplicationEnabled,
    flipDeduplicationEnabled: project.flipDeduplicationEnabled,
    chrRegions: project.chrRegions,
  });

  const workspaceElement = createDeliveryWorkspace({
    mode: project.mode,
    projectName,
    fileName: project.fileName,
    width: project.width,
    height: project.height,
    indexedImage: project.indexedImage,
    tileCount,
    originalTileCount,
    deduplicationEnabled: project.deduplicationEnabled,
    flipDeduplicationEnabled: project.flipDeduplicationEnabled,
    chr,
    nametable,
    attributeTable,
    collisionMap,
    paletteSet: project.paletteSet,
    palettes,
    activeSpritePaletteSlots,
    animationModel: animModel,
    animationModelError: animModelError,
    error: derivedStatus.error,
    chrRegions: project.chrRegions,
    chrSlotClassifications: classifications,
    onDownloadBytes: downloadBytes,
    onDownloadText: downloadText,
    onNavigateWorkspace: (view) => {
      updateWorkspace({ ...workspace, activeWorkspace: view });
      if (view !== 'palette' && view !== 'chr' && view !== 'deliver') {
        changeMode(view);
      } else {
        render();
      }
    },
  });

  const sidebar = createSidebar({
    activeWorkspace: 'deliver',
    fileName: project.fileName,
    onWorkspaceChange: (view) => {
      updateWorkspace({ ...workspace, activeWorkspace: view });
      if (view !== 'palette' && view !== 'chr' && view !== 'deliver') {
        changeMode(view);
      } else {
        render();
      }
    },
  });
  const inspector = createInspector();
  const shell = createAppShell({
    header: createProjectHeader(),
    sidebar,
    workspace: workspaceElement,
    inspector,
  });
  app.replaceChildren(shell);
}

function render(): void {
  document.documentElement.lang = getLocale();
  document.title = `${projectName}${projectDirty ? ' *' : ''} - ${t('appTitle')}`;
  if (workspace.activeWorkspace === 'palette') {
    renderPaletteWorkspace();
  } else if (workspace.activeWorkspace === 'chr') {
    renderChrWorkspace();
  } else if (workspace.activeWorkspace === 'deliver') {
    renderDeliveryWorkspace();
  } else if (project.mode === 'animation') {
    renderAnimationWorkspace();
  } else if (project.mode === 'playfield') {
    renderPlayfieldWorkspace();
  } else {
    renderTilesetWorkspace();
  }
}

function setProjectError(error: DisplayError): void {
  project = {
    ...project,
    indexedImage: null,
    tiles: [],
  };
  setDerivedStatus({ error, loading: false });
  render();
}

function displayPngLoadError(failure: PngLoadFailure): DisplayError {
  return {
    key: failure === 'read-failed' ? 'imageReadFailed' : 'imageDecodeFailed',
  };
}

async function decodePngBlob(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
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

async function decodeImage(file: File): Promise<ImageData> {
  const result = await readAndDecodePng(file, decodePngBlob);
  if (result.success) return result.image;
  throw new PngLoadError(result.failure);
}

async function loadFile(file: File): Promise<void> {
  cacheAssetFile(file);
  const lowerCaseName = file.name.toLowerCase();
  const isProjectFile =
    lowerCaseName.endsWith('.p2c') ||
    lowerCaseName.endsWith('.p2c.json') ||
    (lowerCaseName.endsWith('.json') &&
      !lowerCaseName.endsWith('.metadata.json'));

  if (isProjectFile) {
    await loadProjectFile(file);
    return;
  }

  const isChrFile = lowerCaseName.endsWith('.chr');
  const isNesFile = lowerCaseName.endsWith('.nes');
  const isPngFile = lowerCaseName.endsWith('.png');
  if ((isChrFile || isNesFile) && project.mode !== 'tileset') {
    setDerivedStatus({ error: { key: 'chrTilesetOnly' }, loading: false });
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
  const paletteColorTarget = workspace.paletteColorTarget;
  const activeColorIndex = project.activeColorIndex;
  const showPaletteNumbers = workspace.showPaletteNumbers;
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
  updateProject({
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
    pixelOverrides: new Uint8Array(),
    activePaletteIndex,
    activeColorIndex,
    animation,
    quantizationSettings,
  });
  updateWorkspace({
    ...workspace,
    previewTool: 'palette',
    showPaletteNumbers,
    zoomedPaletteRegion: null,
    paletteColorTarget,
  });
  setDerivedStatus({ error: null, loading: true });
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
      updateProject({
        ...project,
        width: indexedImage.width,
        height: indexedImage.height,
        indexedImage,
        tiles,
        paletteAssignments,
        pixelOverrides,
      });
      setDerivedStatus({ error: null, loading: false });
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

  const pngLoad = await readAndDecodePng(file, decodePngBlob);
  if (!pngLoad.success) {
    console.error('PNG load failed', {
      fileName: file.name,
      failure: pngLoad.failure,
    });
    if (activeRequest === requestId) {
      setProjectError(displayPngLoadError(pngLoad.failure));
    }
    return;
  }
  const imageData = pngLoad.image;

  if (activeRequest !== requestId) {
    return;
  }

  updateProject({
    ...project,
    width: imageData.width,
    height: imageData.height,
    sourceImage: imageData,
  });

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
      const detection = detectFrameGrid(imageData);
      const defaultFrames = decideFrameDimensions(16, 16, detection);
      const sourceData: AnimationSourceData = {
        fileName: file.name,
        sourceImage: imageData,
        indexedImage,
      };
      const animations = animation.animations.map((anim, idx) => {
        if (idx === 0 && anim.source === null) {
          const { width, height } = decideFrameDimensions(
            anim.frameWidth,
            anim.frameHeight,
            detection,
          );
          return {
            ...anim,
            source: sourceData,
            frameWidth: width,
            frameHeight: height,
            frameDetection: detection,
          };
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
                  frameWidth: defaultFrames.width,
                  frameHeight: defaultFrames.height,
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
                  frameDetection: detection,
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
    updateProject({
      ...project,
      indexedImage,
      tiles,
      paletteAssignments,
      pixelOverrides,
      animation: nextAnimation,
    });
    setDerivedStatus({ error: null, loading: false });
    render();
  } catch (error: unknown) {
    console.error('PNG processing failed', { fileName: file.name, error });
    setProjectError(
      error instanceof ImageAnalysisError
        ? displayErrorFromAnalysis(error)
        : { key: 'imageProcessingFailed' },
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
  updateProject({
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
    pixelOverrides,
    activePaletteIndex: 0,
    activeColorIndex: 1,
    animation: project.animation,
    quantizationSettings: project.quantizationSettings,
  });
  resetTransientState();
  render();
}

subscribeToLocale(render);
render();
