import {
  COLLISION_TYPES,
  createEmptyCollisionMap,
} from '../core/collision-encoder';
import { normalizeProjectAssetId } from '../core/asset-identity';
import { resolveProjectPaletteState } from '../core/palette-manager';
import {
  CURRENT_PROJECT_FORMAT_VERSION,
  type ProjectAnimationItemConfig,
  type ProjectAnimationSettingsConfig,
  type ProjectAssetReference,
  type ProjectPlayfieldConfig,
  type ProjectTilesetConfig,
  type StudioProject,
} from '../core/project';
import type {
  ProjectGraphicsAsset,
  ProjectGraphicsConfiguration,
} from '../core/project-graphics';
import { DEFAULT_RANDOM_PLAYFIELD_FEATURES } from '../core/random-playfield';
import type { SourceKind, ProjectView, AnimationSettings } from './types';

export type ImageDataEncoder = (image: ImageData) => string;

function buildActiveAssetReference(
  project: ProjectView,
  preserved: ProjectAssetReference | null | undefined,
  encodeImageData: ImageDataEncoder,
): ProjectAssetReference | null {
  if (project.fileName === null) return preserved ?? null;

  const fallbackKind =
    project.mode === 'playfield' ? 'playfield-image' : 'tileset-image';
  return {
    id: normalizeProjectAssetId(project.assetId ?? preserved?.id, fallbackKind),
    path: preserved?.path ?? project.fileName,
    name: project.fileName,
    sourceKind: project.sourceKind ?? preserved?.sourceKind,
    dataUrl:
      project.sourceImage !== null
        ? encodeImageData(project.sourceImage)
        : preserved?.dataUrl,
  };
}

function buildActiveTileset(
  project: ProjectView,
  encodeImageData: ImageDataEncoder,
): ProjectTilesetConfig {
  const asset = buildActiveAssetReference(
    project,
    project.tileset?.asset,
    encodeImageData,
  );
  return {
    assetId: asset?.id ?? null,
    asset,
    paletteAssignments:
      project.paletteAssignments.length > 0
        ? Array.from(project.paletteAssignments)
        : undefined,
    pixelOverrides:
      project.pixelOverrides.length > 0
        ? Array.from(project.pixelOverrides)
        : undefined,
  };
}

function buildActivePlayfield(
  project: ProjectView,
  encodeImageData: ImageDataEncoder,
): ProjectPlayfieldConfig {
  const asset = buildActiveAssetReference(
    project,
    project.playfield?.asset,
    encodeImageData,
  );
  return {
    assetId: asset?.id ?? null,
    asset,
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
}

function buildAnimation(
  project: ProjectView,
  encodeImageData: ImageDataEncoder,
  encodeBytes: (bytes: Uint8Array) => string,
): ProjectAnimationSettingsConfig {
  const animations: ProjectAnimationItemConfig[] =
    project.animation.animations.map((animation) => ({
      id: animation.id,
      name: animation.name,
      entity: animation.entity ?? 'entity',
      assetId: animation.source?.assetId ?? animation.asset?.id ?? null,
      asset:
        animation.source !== null
          ? {
              id: normalizeProjectAssetId(
                animation.source.assetId ?? animation.asset?.id,
                'spritesheet',
                animation.id,
              ),
              path: animation.asset?.path ?? animation.source.fileName,
              name: animation.source.fileName,
              sourceKind: 'png',
              dataUrl: encodeImageData(animation.source.sourceImage),
            }
          : (animation.asset ?? null),
      paletteId: animation.paletteId ?? null,
      paletteIndex: animation.paletteIndex ?? null,
      quantizationMode: animation.quantizationMode ?? 'median-cut',
      ditheringMode: animation.ditheringMode ?? 'none',
      frameWidth: animation.frameWidth,
      frameHeight: animation.frameHeight,
      originX: animation.originX,
      originY: animation.originY,
      playback: animation.playback,
      allowHorizontalFlip: animation.allowHorizontalFlip,
      allowVerticalFlip: animation.allowVerticalFlip,
      ...(animation.flipH !== undefined ? { flipH: animation.flipH } : {}),
      ...(animation.flipV !== undefined ? { flipV: animation.flipV } : {}),
      defaultDuration: animation.defaultDuration,
      ...(animation.pixelOverrides &&
      Object.keys(animation.pixelOverrides).length > 0
        ? { pixelOverrides: animation.pixelOverrides }
        : {}),
      frameIndices: [...animation.frameIndices],
      frameDurations: [...animation.frameDurations],
      ...(animation.framePalettes !== undefined
        ? { framePalettes: [...animation.framePalettes] }
        : {}),
      ...(animation.framePaletteIds !== undefined
        ? { framePaletteIds: [...animation.framePaletteIds] }
        : {}),
    }));

  const preservedDestination = project.animation.destinationChrAsset;
  const destinationChr =
    project.animation.destinationChrName !== null
      ? {
          id: normalizeProjectAssetId(
            project.animation.destinationChrAssetId ?? preservedDestination?.id,
            'base-chr',
          ),
          path:
            preservedDestination?.path ?? project.animation.destinationChrName,
          name: project.animation.destinationChrName,
          sourceKind: 'chr' as const,
          dataUrl:
            project.animation.destinationChr.length > 0
              ? `data:application/octet-stream;base64,${encodeBytes(project.animation.destinationChr)}`
              : preservedDestination?.dataUrl,
        }
      : (preservedDestination ?? null);

  return {
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
    destinationChr,
    animations,
  };
}

function upsertGraphicsAsset(
  graphics: ProjectGraphicsConfiguration,
  asset: ProjectGraphicsAsset,
): ProjectGraphicsConfiguration {
  const existingIndex = graphics.assets.findIndex(
    (item) => item.id === asset.id,
  );
  const assets =
    existingIndex < 0
      ? [...graphics.assets, asset]
      : graphics.assets.map((item, index) =>
          index === existingIndex ? asset : item,
        );
  return { ...graphics, assets };
}

function synchronizeRuntimeGraphicsCatalog(
  project: ProjectView,
  tileset: ProjectTilesetConfig | undefined,
  playfield: ProjectPlayfieldConfig | undefined,
  animation: ProjectAnimationSettingsConfig,
): ProjectGraphicsConfiguration {
  let graphics = project.graphics;
  const pngAsset = (
    id: string,
    kind: 'tileset-image' | 'playfield-image' | 'spritesheet',
    name: string,
    source: ProjectGraphicsAsset['source'],
    paletteBank: 'background' | 'sprite',
    paletteAssignments?: readonly number[],
    pixelOverrides?: ProjectGraphicsAsset['logicalTiles']['pixelOverrides'],
  ) => {
    const decoding =
      source?.sourceKind === 'chr' || source?.sourceKind === 'nes'
        ? ('nes-2bpp' as const)
        : ('png-indexed' as const);
    graphics = upsertGraphicsAsset(graphics, {
      id,
      kind,
      name,
      source,
      logicalTiles: {
        decoding,
        quantization:
          decoding === 'png-indexed' ? project.quantizationSettings : null,
        paletteBank,
        ...(paletteAssignments ? { paletteAssignments } : {}),
        ...(pixelOverrides ? { pixelOverrides } : {}),
      },
    });
  };
  if (tileset?.asset?.id) {
    pngAsset(
      tileset.asset.id,
      'tileset-image',
      tileset.asset.name ?? 'Tileset Image',
      tileset.asset,
      'background',
      tileset.paletteAssignments,
      tileset.pixelOverrides
        ? { kind: 'indexed-image', values: tileset.pixelOverrides }
        : undefined,
    );
  }
  if (playfield?.asset?.id) {
    pngAsset(
      playfield.asset.id,
      'playfield-image',
      playfield.asset.name ?? 'Playfield Image',
      playfield.asset,
      'background',
      playfield.paletteAssignments,
      playfield.pixelOverrides
        ? { kind: 'indexed-image', values: playfield.pixelOverrides }
        : undefined,
    );
  }
  for (const map of project.backgrounds?.maps ?? []) {
    const id = map.assetId ?? map.asset?.id;
    if (!id || graphics.assets.some((asset) => asset.id === id)) continue;
    graphics = upsertGraphicsAsset(graphics, {
      id,
      kind: 'background-image',
      name: map.asset?.name ?? map.name,
      source: map.asset ?? null,
      logicalTiles: {
        decoding: 'png-indexed',
        quantization: project.quantizationSettings,
        paletteBank: 'background',
        paletteAssignments: map.paletteAssignments,
      },
    });
  }
  for (const item of animation.animations) {
    if (!item.asset?.id) continue;
    pngAsset(
      item.asset.id,
      'spritesheet',
      item.asset.name ?? item.name,
      item.asset,
      'sprite',
      undefined,
      item.pixelOverrides
        ? { kind: 'sparse-tiles', values: item.pixelOverrides }
        : undefined,
    );
  }
  return graphics;
}

/** Runtime-to-persistence projection used by application save boundary. */
export function buildStudioProjectFromRuntime(
  projectName: string,
  project: ProjectView,
  encodeImageData: ImageDataEncoder,
  encodeBytes: (bytes: Uint8Array) => string,
): StudioProject {
  const paletteState = resolveProjectPaletteState(project);
  const tileset =
    project.mode === 'tileset'
      ? buildActiveTileset(project, encodeImageData)
      : (project.tileset ?? { asset: null });
  const playfield =
    project.mode === 'playfield'
      ? buildActivePlayfield(project, encodeImageData)
      : (project.playfield ?? {
          asset: null,
          randomPlayfieldFeatures: [...DEFAULT_RANDOM_PLAYFIELD_FEATURES],
        });
  const animation = buildAnimation(project, encodeImageData, encodeBytes);

  return {
    formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
    graphics: synchronizeRuntimeGraphicsCatalog(
      project,
      tileset,
      playfield,
      animation,
    ),
    name: projectName,
    mode: project.mode,
    settings: {
      deduplicationEnabled: project.deduplicationEnabled,
      flipDeduplicationEnabled: project.flipDeduplicationEnabled,
      quantization: project.quantizationSettings,
    },
    palette: {
      universalBackgroundColor: paletteState.universalBackgroundColor,
      palettes: paletteState.palettes,
      activeBackgroundSlots: paletteState.activeBackgroundSlots,
      activeSpriteSlots: paletteState.activeSpriteSlots,
      paletteSet: project.paletteSet,
      activePaletteIndex: project.activePaletteIndex,
      activeColorIndex: project.activeColorIndex,
      activeSpritePaletteSlots: paletteState.activeSpriteSlots,
    },
    chrRegions: project.chrRegions ?? [],
    tileset,
    playfield,
    backgrounds: project.backgrounds ?? { activeMapId: null, maps: [] },
    animation,
    scenePreview: project.scenePreview ?? { instances: [] },
  };
}

export interface RestoredRuntimeSource {
  readonly assetId: string | null;
  readonly fileName: string | null;
  readonly sourceKind: SourceKind | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly sourceImage: ImageData | null;
  readonly indexedImage: ProjectView['indexedImage'];
  readonly tiles: ProjectView['tiles'];
  readonly paletteAssignments: Uint8Array;
  readonly pixelOverrides: Uint8Array;
  readonly collisionCells: Uint8Array;
}

/** Persistence-to-runtime projection used after application asset reconstruction. */
export function restoreProjectView(
  loaded: StudioProject,
  source: RestoredRuntimeSource,
  animation: AnimationSettings,
): ProjectView {
  return {
    graphics: loaded.graphics,
    ...source,
    mode: loaded.mode,
    deduplicationEnabled: loaded.settings.deduplicationEnabled,
    flipDeduplicationEnabled: loaded.settings.flipDeduplicationEnabled,
    activeCollisionType:
      loaded.playfield?.activeCollisionType ?? COLLISION_TYPES.solid,
    randomPlayfieldFeatures: loaded.playfield?.randomPlayfieldFeatures
      ? [...loaded.playfield.randomPlayfieldFeatures]
      : [...DEFAULT_RANDOM_PLAYFIELD_FEATURES],
    universalBackgroundColor: loaded.palette.universalBackgroundColor,
    paletteSet: loaded.palette.paletteSet,
    palettes: loaded.palette.palettes,
    activeBackgroundSlots: loaded.palette.activeBackgroundSlots,
    activeSpriteSlots: loaded.palette.activeSpriteSlots,
    activeSpritePaletteSlots: loaded.palette.activeSpriteSlots,
    activePaletteIndex: loaded.palette.activePaletteIndex ?? 0,
    activeColorIndex: loaded.palette.activeColorIndex ?? 1,
    tileset: loaded.tileset,
    playfield: loaded.playfield,
    chrRegions: loaded.chrRegions ?? [],
    animation,
    scenePreview: loaded.scenePreview ?? { instances: [] },
    backgrounds: loaded.backgrounds ?? { activeMapId: null, maps: [] },
    quantizationSettings: loaded.settings.quantization,
  };
}

/** Clears only active source working data while preserving unrelated project domains. */
export function beginGraphicsSourceImport(
  current: ProjectView,
  fileName: string,
  sourceKind: SourceKind | null,
): ProjectView {
  const assetKind =
    current.mode === 'playfield' ? 'playfield-image' : 'tileset-image';
  const assetId =
    current.mode === 'animation'
      ? (current.assetId ?? null)
      : normalizeProjectAssetId(current.assetId, assetKind);
  const asset: ProjectAssetReference | null =
    current.mode === 'animation' || sourceKind === null
      ? null
      : {
          id: assetId ?? undefined,
          path: fileName,
          name: fileName,
          sourceKind,
        };
  const collisionCells = createEmptyCollisionMap();

  return {
    ...current,
    assetId,
    fileName,
    sourceKind,
    width: null,
    height: null,
    sourceImage: null,
    indexedImage: null,
    tiles: [],
    collisionCells,
    paletteAssignments: new Uint8Array(),
    pixelOverrides: new Uint8Array(),
    ...(current.mode === 'tileset'
      ? { tileset: { assetId: asset?.id ?? null, asset } }
      : {}),
    ...(current.mode === 'playfield'
      ? {
          playfield: {
            ...current.playfield,
            assetId: asset?.id ?? null,
            asset,
            collisionCells: Array.from(collisionCells),
          },
        }
      : {}),
  };
}
