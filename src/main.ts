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
  createDefaultPaletteDefinitions,
  generatePaletteId,
  duplicatePaletteDefinition,
  resolveActivePaletteSet,
  type PaletteDefinition,
} from './core/palette-manager';
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
import { ImageAnalysisError, type IndexedImage, type Tile } from './core/types';
import { quantizeImageToNes } from './core/image-quantization';
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
import {
  QUANTIZATION_MODES,
  loadQuantizationSettings,
  saveQuantizationSettings,
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
import { createStickyNav } from './ui/sticky-nav';
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
        collapsed: false,
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
  previewTool: 'palette',
  pixelOverrides: new Uint8Array(),
  activePaletteIndex: 0,
  activeColorIndex: 1,
  showPaletteNumbers: false,
  zoomedPaletteRegion: null,
  paletteColorTarget: { paletteIndex: 0, colorIndex: 1 },
  animation: createDefaultAnimationSettings(),
  scenePreview: { instances: [] },
  quantizationSettings: loadQuantizationSettings(settingsStorage),
  error: null,
  loading: false,
};

let projectName = t('defaultProjectName');
let projectDirty = false;

function markDirty(): void {
  projectDirty = true;
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
              fileName: matchingFile.name,
              sourceImage: imageData,
              indexedImage,
            };
            detection = detectFrameGrid(imageData);
          } catch {
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
              fileName: anim.asset.name ?? anim.asset.path,
              sourceImage: imageData,
              indexedImage,
            };
            detection = detectFrameGrid(imageData);
          } catch {
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
          collapsed: false,
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
        previewTool: 'palette',
        pixelOverrides: new Uint8Array(),
        activePaletteIndex: loaded.palette.activePaletteIndex ?? 0,
        activeColorIndex: loaded.palette.activeColorIndex ?? 1,
        showPaletteNumbers: false,
        zoomedPaletteRegion: null,
        paletteColorTarget: {
          paletteIndex: loaded.palette.activePaletteIndex ?? 0,
          colorIndex: loaded.palette.activeColorIndex ?? 1,
        },
        animation,
        scenePreview: loaded.scenePreview ?? { instances: [] },
        quantizationSettings: loaded.settings.quantization,
        error: missingError,
        loading: false,
      };
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
      } catch {
        // file decode failed
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
      } catch {
        // file decode failed
      }
    }

    project = {
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
      previewTool: 'palette',
      pixelOverrides,
      activePaletteIndex: loaded.palette.activePaletteIndex ?? 0,
      activeColorIndex: loaded.palette.activeColorIndex ?? 1,
      showPaletteNumbers: false,
      zoomedPaletteRegion: null,
      paletteColorTarget: {
        paletteIndex: loaded.palette.activePaletteIndex ?? 0,
        colorIndex: loaded.palette.activeColorIndex ?? 1,
      },
      animation: createDefaultAnimationSettings(),
      scenePreview: loaded.scenePreview ?? { instances: [] },
      quantizationSettings: loaded.settings.quantization,
      error: missingError,
      loading: false,
    };
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
      projectName = name;
      projectDirty = true;
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
    isCollapsed: project.quantizationCollapsed ?? false,
    onToggleCollapse: () => {
      project = {
        ...project,
        quantizationCollapsed: !(project.quantizationCollapsed ?? false),
      };
      render();
    },
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
    entity: original.entity ?? 'entity',
    quantizationMode: original.quantizationMode ?? 'median-cut',
    ditheringMode: original.ditheringMode ?? 'none',
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

function toggleAnimationConfigCollapse(): void {
  project = {
    ...project,
    animation: {
      ...project.animation,
      configCollapsed: !(project.animation.configCollapsed ?? false),
    },
  };
  render();
}

function toggleAnimationPaletteCollapse(): void {
  project = {
    ...project,
    animation: {
      ...project.animation,
      paletteCollapsed: !(project.animation.paletteCollapsed ?? false),
    },
  };
  render();
}

function updateAnimation(
  animId: string,
  patch: Partial<AnimationItemSetting>,
): void {
  markDirty();
  const manualDimensions = 'frameWidth' in patch || 'frameHeight' in patch;
  const resolvedPatch =
    manualDimensions && !('frameDetection' in patch)
      ? { ...patch, frameDetection: null }
      : patch;
  project = {
    ...project,
    animation: {
      ...project.animation,
      animations: project.animation.animations.map((a) => {
        if (a.id !== animId) return a;
        const updated = { ...a, ...resolvedPatch };
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
    error: null,
  };
  render();
}

function addSceneInstance(instance: ScenePreviewInstance): void {
  markDirty();
  const currentInstances = project.scenePreview?.instances ?? [];
  project = {
    ...project,
    scenePreview: {
      instances: [...currentInstances, instance],
    },
  };
  render();
}

function removeSceneInstance(instanceId: string): void {
  markDirty();
  const currentInstances = project.scenePreview?.instances ?? [];
  project = {
    ...project,
    scenePreview: {
      instances: currentInstances.filter((inst) => inst.id !== instanceId),
    },
  };
  render();
}

function updateSceneInstance(
  instanceId: string,
  patch: Partial<ScenePreviewInstance>,
): void {
  markDirty();
  const currentInstances = project.scenePreview?.instances ?? [];
  project = {
    ...project,
    scenePreview: {
      instances: currentInstances.map((inst) =>
        inst.id === instanceId ? { ...inst, ...patch } : inst,
      ),
    },
  };
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
  markDirty();
  project = {
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
    error: null,
  };
  render();
}

function resetTile(
  animationId: string,
  tileX: number,
  tileY: number,
): void {
  markDirty();
  project = {
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
    error: null,
  };
  render();
}

async function loadAnimationSourceFile(
  animId: string,
  file: File,
): Promise<void> {
  cacheAssetFile(file);
  markDirty();
  try {
    const targetAnim = project.animation.animations.find(
      (a) => a.id === animId,
    );
    const quantMode = targetAnim?.quantizationMode ?? 'median-cut';
    const dithMode = targetAnim?.ditheringMode ?? 'none';
    const imageData = await decodeImage(file);
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
  const validDurations = anim.frameDurations.slice(0, validIndices.length);
  const validPalettes = (anim.framePalettes ?? []).slice(
    0,
    validIndices.length,
  );
  updateAnimation(animId, {
    frameDetection: detection,
    frameWidth: width,
    frameHeight: height,
    frameIndices: validIndices,
    frameDurations: validDurations,
    framePalettes: validPalettes,
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
  paletteId?: string | null,
): void {
  markDirty();
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
          ? project.palettes[paletteIndex]?.id ?? null
          : null;

    return {
      ...anim,
      framePalettes,
      framePaletteIds,
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
  cacheAssetFile(file);
  markDirty();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0 || bytes.length % 16 !== 0 || bytes.length > 8192) {
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
        const entityName =
          anim.entity?.trim() !== '' && anim.entity
            ? anim.entity.trim()
            : 'entity';
        const compositeName = `${entityName}_${anim.name}`;
        definitions.push({
          id: anim.id,
          name: compositeName,
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
        project.animation.animations[0]?.entity ?? project.animation.name;
      model = buildAnimationProjectModel({
        name: primaryEntity,
        symbolPrefix: primaryEntity,
        animations: definitions,
        defaultPaletteIndex: project.animation.defaultPaletteIndex,
        quantizationMode: project.animation.quantizationMode,
        baseChr: project.animation.destinationChr,
        patternTable: project.animation.patternTable,
        destinationPatternTable: project.animation.destinationPatternTable,
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
    palettes: project.palettes,
    activeSpritePaletteSlots: project.activeSpritePaletteSlots,
    colorDistanceMode: project.quantizationSettings.colorDistanceMode,
    scenePreview: project.scenePreview,
    onSettingsChange: (animation: AnimationSettings) => {
      project = { ...project, animation, error: null };
      render();
    },
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
    onToggleConfigCollapse: toggleAnimationConfigCollapse,
    onTogglePaletteCollapse: toggleAnimationPaletteCollapse,
    onAddSceneInstance: addSceneInstance,
    onRemoveSceneInstance: removeSceneInstance,
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
    onCreatePalette: (name) => {
      const currentPalettes =
        project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
      const newDef: PaletteDefinition = {
        id: generatePaletteId(),
        name: name ?? `Palette ${String(currentPalettes.length + 1)}`,
        colors: [0x0f, 0x00, 0x10, 0x30],
      };
      project = {
        ...project,
        palettes: [...currentPalettes, newDef],
      };
      projectDirty = true;
      render();
    },
    onUpdatePaletteName: (paletteId, name) => {
      const currentPalettes =
        project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
      project = {
        ...project,
        palettes: currentPalettes.map((p) =>
          p.id === paletteId ? { ...p, name } : p,
        ),
      };
      projectDirty = true;
      render();
    },
    onUpdatePaletteColorDef: (paletteId, colorSlotIndex, nesColor) => {
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
      project = {
        ...project,
        palettes: updatedPalettes,
        paletteSet: resolveActivePaletteSet(
          updatedPalettes,
          slots,
          project.paletteSet,
        ),
      };
      projectDirty = true;
      render();
    },
    onDuplicatePalette: (paletteId) => {
      const currentPalettes =
        project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
      const source = currentPalettes.find((p) => p.id === paletteId);
      if (source) {
        const dup = duplicatePaletteDefinition(source);
        project = {
          ...project,
          palettes: [...currentPalettes, dup],
        };
        projectDirty = true;
        render();
      }
    },
    onDeletePalette: (paletteId) => {
      const currentPalettes =
        project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
      const currentSlots =
        project.activeSpritePaletteSlots ??
        currentPalettes.slice(0, 4).map((p) => p.id);
      const newSlots = currentSlots.map((id) => (id === paletteId ? null : id));
      const updatedPalettes = currentPalettes.filter((p) => p.id !== paletteId);
      project = {
        ...project,
        palettes: updatedPalettes,
        activeSpritePaletteSlots: newSlots,
        paletteSet: resolveActivePaletteSet(
          updatedPalettes,
          newSlots,
          project.paletteSet,
        ),
      };
      projectDirty = true;
      render();
    },
    onUpdateActiveSlot: (slotIndex, paletteId) => {
      const currentPalettes =
        project.palettes ?? createDefaultPaletteDefinitions(project.paletteSet);
      const currentSlots = [
        ...(project.activeSpritePaletteSlots ??
          currentPalettes.slice(0, 4).map((p) => p.id)),
      ];
      currentSlots[slotIndex] = paletteId;
      project = {
        ...project,
        activeSpritePaletteSlots: currentSlots,
        paletteSet: resolveActivePaletteSet(
          currentPalettes,
          currentSlots,
          project.paletteSet,
        ),
      };
      projectDirty = true;
      render();
    },
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
  const nav = createStickyNav({
    mode: 'animation',
    fileName: project.fileName,
    onModeChange: (m) => {
      changeMode(m);
    },
  });
  app.replaceChildren(createProjectHeader(), nav, workspace);
}

function render(): void {
  document.documentElement.lang = getLocale();
  document.title = `${projectName}${projectDirty ? ' *' : ''} - ${t('appTitle')}`;
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
  const projectImageInput = createProjectImageInput();
  projectImageInput.id = 'section-image';
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
  );
  const paletteEditor = createPaletteEditor({
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
  });
  paletteEditor.id = 'section-palettes';
  const quantizationPanel = createProjectQuantizationPanel();
  quantizationPanel.id = 'section-quantization';
  const tileGrid = createTileGrid(
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
  });
  exportPanel.id = 'section-export';
  workspace.append(
    projectImageInput,
    quantizationPanel,
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
    tileGrid,
    exportPanel,
  );
  const nav = createStickyNav({
    mode: project.mode,
    fileName: project.fileName,
    quantizationMode: project.quantizationSettings.quantizationMode,
    onQuantizationModeChange: (quantizationMode) => {
      void changeQuantizationSettings({
        ...project.quantizationSettings,
        quantizationMode,
      });
    },
    onModeChange: (m) => {
      changeMode(m);
    },
  });
  app.replaceChildren(createProjectHeader(), nav, workspace);
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

  markDirty();
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
                  collapsed: false,
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
