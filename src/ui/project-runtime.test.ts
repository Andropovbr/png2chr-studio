import { describe, expect, it } from 'vitest';
import { createEmptyBackgroundMap } from '../core/background-model';
import { createEmptyCollisionMap } from '../core/collision-encoder';
import { createLogicalTileKey } from '../core/asset-identity';
import { compileProjectGraphics } from '../core/project-graphics-compiler';
import { decodeProjectGraphicsAssets } from '../core/project-graphics-assets';
import {
  createDefaultProject,
  deserializeProject,
  serializeProject,
  type StudioProject,
} from '../core/project';
import { extractLogicalAnimationFrames } from '../core/metasprite-extraction';
import type { IndexedImage } from '../core/types';
import type { AnimationSettings } from './types';
import {
  beginGraphicsSourceImport,
  buildStudioProjectFromRuntime,
  resolveAnimationRuntimeAsset,
  restoreProjectView,
  type RestoredRuntimeSource,
} from './project-runtime';
import {
  compileRuntimeProjectGraphics,
  createRuntimeAnimationDemands,
  recoverGeneratedLegacyChrEnvelope,
} from './project-graphics-runtime';
import { legacyNesSurvivor } from './fixtures/legacy-nes-survivor';

const encodeImage = (): string => 'data:image/png;base64,runtime-image';
const encodeBytes = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => String(byte)).join('-');

function indexedAnimation(seed: number): IndexedImage {
  return {
    width: 8,
    height: 8,
    pixels: new Uint8Array(64).fill(seed),
    colors: [
      { red: 0, green: 0, blue: 0 },
      { red: 255, green: 255, blue: 255 },
    ],
    transparentIndex: 0,
    colorCount: 2,
  };
}

function indexedAnimationStrip(tileCount: number, seed: number): IndexedImage {
  const pixels = new Uint8Array(8 * tileCount * 8);
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    for (let pixelIndex = 0; pixelIndex < 64; pixelIndex += 1) {
      const bit = (tileIndex + seed) >> (pixelIndex % 6);
      pixels[tileIndex * 64 + pixelIndex] = (bit & 1) === 0 ? 1 : 2;
    }
  }
  return {
    width: 8,
    height: tileCount * 8,
    pixels,
    colors: [
      { red: 0, green: 0, blue: 0 },
      { red: 255, green: 255, blue: 255 },
      { red: 128, green: 128, blue: 128 },
    ],
    transparentIndex: 0,
    colorCount: 3,
  };
}

function nonEmptyChrTileCount(bytes: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += 16) {
    if (bytes.subarray(offset, offset + 16).some((byte) => byte !== 0)) {
      count += 1;
    }
  }
  return count;
}

function firstDifferingPhysicalSlots(
  left: Uint8Array,
  right: Uint8Array,
  limit = 8,
): readonly number[] {
  const slots: number[] = [];
  for (let slot = 0; slot < 512 && slots.length < limit; slot += 1) {
    const offset = slot * 16;
    if (
      !left
        .subarray(offset, offset + 16)
        .every((byte, index) => byte === right[offset + index])
    ) {
      slots.push(slot);
    }
  }
  return slots;
}

function sameChrBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function decodeEmbeddedBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function createAnimationRuntime(project: StudioProject): AnimationSettings {
  const animation = project.animation;
  if (!animation) throw new Error('Expected animation fixture.');

  return {
    name: animation.name,
    symbolPrefix: animation.symbolPrefix,
    defaultPaletteIndex: animation.defaultPaletteIndex,
    quantizationMode: animation.quantizationMode,
    ditheringMode: animation.ditheringMode,
    animations: animation.animations.map((item) => ({
      ...item,
      asset: item.asset,
      source: null,
    })),
    flipDeduplication: animation.flipDeduplication,
    spritePalette: animation.spritePalette,
    spriteColorIndex: animation.spriteColorIndex,
    colorIndices: new Uint8Array(),
    destinationChrAsset: animation.destinationChr,
    destinationChrAssetId: animation.destinationChr?.id ?? null,
    destinationChrName:
      animation.destinationChr?.name ?? animation.destinationChr?.path ?? null,
    destinationChr: new Uint8Array(),
    patternTable: animation.patternTable,
    destinationPatternTable: animation.destinationPatternTable,
  };
}

function restoreAnimationSourcesFromCatalog(
  project: StudioProject,
  images: readonly IndexedImage[],
  destinationChr: Uint8Array = new Uint8Array(),
): AnimationSettings {
  return {
    ...createAnimationRuntime(project),
    destinationChr,
    animations: (project.animation?.animations ?? []).map(
      (animation, index) => {
        const resolved = resolveAnimationRuntimeAsset(project, animation);
        if (resolved.asset === null || resolved.assetId === null) {
          throw new Error('Expected canonical Animation asset source.');
        }
        return {
          ...animation,
          asset: resolved.asset,
          source: {
            assetId: resolved.assetId,
            fileName: resolved.asset.name ?? resolved.asset.path,
            sourceImage: {
              width: (images[index] ?? indexedAnimation(1)).width,
              height: (images[index] ?? indexedAnimation(1)).height,
              data: new Uint8ClampedArray(
                (images[index] ?? indexedAnimation(1)).width *
                  (images[index] ?? indexedAnimation(1)).height *
                  4,
              ),
            } as ImageData,
            indexedImage: images[index] ?? indexedAnimation(1),
          },
        };
      },
    ),
  };
}

function createRuntimeSource(project: StudioProject): RestoredRuntimeSource {
  const asset =
    project.mode === 'playfield'
      ? project.playfield?.asset
      : project.mode === 'tileset'
        ? project.tileset?.asset
        : null;
  const persistedAssignments =
    project.mode === 'playfield'
      ? project.playfield?.paletteAssignments
      : project.tileset?.paletteAssignments;
  const persistedOverrides =
    project.mode === 'playfield'
      ? project.playfield?.pixelOverrides
      : project.tileset?.pixelOverrides;

  return {
    assetId: asset?.id ?? null,
    fileName: asset?.name ?? asset?.path ?? null,
    sourceKind: asset?.sourceKind ?? null,
    width: null,
    height: null,
    sourceImage: null,
    indexedImage: null,
    tiles: [],
    paletteAssignments: new Uint8Array(persistedAssignments ?? []),
    pixelOverrides: new Uint8Array(persistedOverrides ?? []),
    collisionCells: new Uint8Array(
      project.playfield?.collisionCells ?? createEmptyCollisionMap(),
    ),
  };
}

function createCompleteProject(mode: StudioProject['mode']): StudioProject {
  const base = createDefaultProject('Runtime State', mode);
  const mapOne = {
    ...createEmptyBackgroundMap({
      id: 'bg-overworld',
      name: 'Overworld',
      assetId: 'asset-bg-overworld',
    }),
    asset: {
      id: 'asset-bg-overworld',
      path: 'backgrounds/overworld.png',
      name: 'overworld.png',
      sourceKind: 'png' as const,
      dataUrl: 'data:image/png;base64,background',
    },
  };
  const mapTwo = createEmptyBackgroundMap({
    id: 'bg-castle',
    name: 'Castle',
    patternTable: 1,
  });
  const animation = base.animation;
  if (!animation) throw new Error('Expected default animation.');
  const animationItem = animation.animations[0];
  if (!animationItem) throw new Error('Expected default animation item.');

  return {
    ...base,
    mode,
    tileset: {
      assetId: 'asset-tileset-stable',
      asset: {
        id: 'asset-tileset-stable',
        path: 'graphics/tiles.png',
        name: 'tiles.png',
        sourceKind: 'png',
        dataUrl: 'data:image/png;base64,tiles',
      },
      paletteAssignments: [0, 1],
      pixelOverrides: [2, 3],
    },
    playfield: {
      assetId: 'asset-playfield-stable',
      asset: {
        id: 'asset-playfield-stable',
        path: 'graphics/level.png',
        name: 'level.png',
        sourceKind: 'png',
        dataUrl: 'data:image/png;base64,level',
      },
      collisionCells: Array.from(createEmptyCollisionMap(), (_, index) =>
        index === 0 ? 3 : 0,
      ),
      activeCollisionType: 3,
      randomPlayfieldFeatures: ['platforms'],
      paletteAssignments: [2, 1],
      pixelOverrides: [1, 2],
    },
    chrRegions: [
      {
        id: 'region-ui',
        name: 'UI Tiles',
        patternTable: 0,
        startTile: 16,
        endTile: 31,
        kind: 'region',
      },
      {
        id: 'reservation-engine',
        name: 'Engine Reserved',
        patternTable: 1,
        startTile: 224,
        endTile: 255,
        kind: 'reservation',
      },
    ],
    backgrounds: {
      activeMapId: mapTwo.id,
      maps: [mapOne, mapTwo],
    },
    animation: {
      ...animation,
      destinationChr: {
        id: 'asset-base-chr-stable',
        path: 'graphics/base.chr',
        name: 'base.chr',
        sourceKind: 'chr',
        dataUrl: 'data:application/octet-stream;base64,base',
      },
      animations: [
        {
          ...animationItem,
          id: 'anim-hero-idle',
          entity: 'hero',
          assetId: 'asset-hero-stable',
          asset: {
            id: 'asset-hero-stable',
            path: 'sprites/hero.png',
            name: 'hero.png',
            sourceKind: 'png',
            dataUrl: 'data:image/png;base64,hero',
          },
        },
      ],
    },
    scenePreview: {
      instances: [
        {
          id: 'scene-hero',
          animationId: 'anim-hero-idle',
          entityId: 'hero',
          animationName: 'idle',
          x: 24,
          y: 32,
          anchorX: 24,
          anchorY: 32,
          visible: true,
        },
      ],
    },
  };
}

function roundTripRuntime(project: StudioProject): StudioProject {
  const runtime = restoreProjectView(
    project,
    createRuntimeSource(project),
    createAnimationRuntime(project),
  );
  const serialized = serializeProject(
    buildStudioProjectFromRuntime(
      project.name,
      runtime,
      encodeImage,
      encodeBytes,
    ),
  );
  const loaded = deserializeProject(serialized);
  if (!loaded.success) throw new Error(loaded.error.message);
  return loaded.project;
}

describe('runtime project persistence boundary', () => {
  it.each(['tileset', 'playfield', 'animation'] as const)(
    'preserves every project-owned domain when active mode is %s',
    (mode) => {
      const original = createCompleteProject(mode);
      const loaded = roundTripRuntime(original);

      expect(loaded.backgrounds?.maps.slice(0, 2)).toEqual(
        original.backgrounds?.maps,
      );
      const migratedMap = loaded.backgrounds?.maps[2];
      expect(migratedMap).toMatchObject({
        id: 'background-playfield-default',
        assetId: 'asset-playfield-stable',
        collision: { activeType: 3 },
        procedural: { features: ['platforms'] },
      });
      expect(loaded.chrRegions).toEqual(original.chrRegions);
      expect(loaded.animation).toEqual(original.animation);
      expect(loaded.scenePreview).toEqual(original.scenePreview);
      expect(loaded.palette).toEqual(original.palette);
      expect(loaded.tileset?.asset?.id).toBe('asset-tileset-stable');
      expect(loaded.playfield?.asset?.id).toBe('asset-playfield-stable');
      expect(loaded.animation?.animations[0]?.asset?.id).toBe(
        'asset-hero-stable',
      );
      expect(loaded.graphics.assets.map((asset) => asset.id)).toEqual(
        expect.arrayContaining([
          'asset-tileset-stable',
          'asset-playfield-stable',
          'asset-hero-stable',
          'asset-bg-overworld',
        ]),
      );
      expect(loaded.backgrounds?.maps.map((map) => map.id)).toEqual([
        'bg-overworld',
        'bg-castle',
        'background-playfield-default',
      ]);
    },
  );

  it.each(['tileset', 'playfield'] as const)(
    '%s import clears only intended source working state',
    (mode) => {
      const persisted = createCompleteProject(mode);
      const runtime = restoreProjectView(
        persisted,
        createRuntimeSource(persisted),
        createAnimationRuntime(persisted),
      );
      const imported = beginGraphicsSourceImport(
        runtime,
        `${mode}-replacement.png`,
        'png',
      );

      expect(imported.backgrounds).toBe(runtime.backgrounds);
      expect(imported.chrRegions).toBe(runtime.chrRegions);
      expect(imported.animation).toBe(runtime.animation);
      expect(imported.scenePreview).toBe(runtime.scenePreview);
      expect(imported.palettes).toBe(runtime.palettes);
      expect(imported.activeBackgroundSlots).toBe(
        runtime.activeBackgroundSlots,
      );
      expect(imported.activeSpriteSlots).toBe(runtime.activeSpriteSlots);
      expect(imported.fileName).toBe(`${mode}-replacement.png`);
      expect(imported.paletteAssignments).toHaveLength(0);
      expect(imported.pixelOverrides).toHaveLength(0);
      expect(
        mode === 'tileset'
          ? imported.tileset?.asset?.id
          : imported.playfield?.asset?.id,
      ).toBe(
        mode === 'tileset' ? 'asset-tileset-stable' : 'asset-playfield-stable',
      );
    },
  );

  it('keeps missing decoded asset references and stable IDs on repeated runtime round-trips', () => {
    const first = roundTripRuntime(createCompleteProject('tileset'));
    const second = roundTripRuntime(first);

    expect(second.tileset?.asset).toEqual(first.tileset?.asset);
    expect(second.animation?.destinationChr).toEqual(
      first.animation?.destinationChr,
    );
    expect(second.animation?.animations[0]?.asset).toEqual(
      first.animation?.animations[0]?.asset,
    );
    expect(second.backgrounds?.maps.map((map) => map.id)).toEqual(
      first.backgrounds?.maps.map((map) => map.id),
    );
  });

  it('keeps explicit Base CHR policy and compiled placement coherent after load and runtime projection', () => {
    const baseBytes = new Uint8Array(8192);
    for (let slot = 0; slot < 21; slot += 1) {
      baseBytes[slot * 16] = 0x80;
    }
    const dataUrl = `data:application/octet-stream;base64,${btoa(
      String.fromCharCode(...baseBytes),
    )}`;
    const initial = createDefaultProject('Loaded animation', 'animation');
    const firstAnimation = initial.animation?.animations[0];
    if (!firstAnimation) {
      throw new Error('Expected default animation.');
    }
    const assetIds = ['asset-hero', 'asset-enemy'] as const;
    const persisted: StudioProject = {
      ...initial,
      graphics: {
        ...initial.graphics,
        baseChr: {
          assetId: 'asset-base',
          source: {
            path: 'game.chr',
            name: 'game.chr',
            sourceKind: 'chr',
            dataUrl,
          },
          byteLength: 8192,
          shortFilePatternTable: 0,
          slotPolicies: [
            {
              startSlot: 0,
              endSlot: 20,
              occupancy: 'occupied',
              writability: 'locked',
              ownerAssetId: 'asset-base',
              provenance: 'imported-base-chr',
            },
            {
              startSlot: 21,
              endSlot: 511,
              occupancy: 'available',
              writability: 'writable',
              ownerAssetId: null,
              provenance: 'none',
            },
          ],
        },
        assets: [
          ...assetIds.map((id) => ({
            id,
            kind: 'spritesheet' as const,
            name: id,
            source: null,
            logicalTiles: {
              decoding: 'png-indexed' as const,
              quantization: null,
              paletteBank: 'sprite' as const,
            },
          })),
          {
            id: 'asset-detached',
            kind: 'spritesheet' as const,
            name: 'Detached',
            source: null,
            logicalTiles: {
              decoding: 'png-indexed' as const,
              quantization: null,
              paletteBank: 'sprite' as const,
            },
          },
        ],
        renderContexts: [
          {
            id: 'context-sprites',
            name: 'Sprites',
            backgroundPatternTable: 1,
            spriteMode: '8x8',
            spritePatternTable: 0,
            mapIds: [],
            animationIds: ['anim-hero', 'anim-enemy'],
          },
        ],
      },
      animation: {
        ...initial.animation,
        patternTable: 0,
        destinationChr: {
          id: 'asset-base',
          path: 'game.chr',
          name: 'game.chr',
          sourceKind: 'chr',
          dataUrl,
        },
        animations: assetIds.map((assetId, index) => ({
          ...firstAnimation,
          id: index === 0 ? 'anim-hero' : 'anim-enemy',
          name: assetId,
          assetId,
          asset: null,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDurations: [8],
        })),
      },
    };
    const loadedResult = deserializeProject(serializeProject(persisted));
    expect(loadedResult.success).toBe(true);
    if (!loadedResult.success) return;
    const loaded = loadedResult.project;
    expect(loaded.graphics.baseChr.slotPolicies).toEqual(
      persisted.graphics.baseChr.slotPolicies,
    );

    const runtimeImages = assetIds.map((_, index) =>
      indexedAnimation(index + 1),
    );
    const runtime = restoreProjectView(loaded, createRuntimeSource(loaded), {
      ...createAnimationRuntime(loaded),
      destinationChr: baseBytes,
      animations: (loaded.animation?.animations ?? []).map(
        (animation, index) => ({
          ...animation,
          source: {
            assetId: animation.assetId ?? undefined,
            fileName: `${animation.id}.png`,
            sourceImage: {
              width: 8,
              height: 8,
              data: new Uint8ClampedArray(8 * 8 * 4),
            } as ImageData,
            indexedImage: runtimeImages[index] ?? indexedAnimation(1),
          },
        }),
      ),
    });
    expect(recoverGeneratedLegacyChrEnvelope(runtime, [])).toBe(runtime);
    const decoded = decodeProjectGraphicsAssets(
      runtime.graphics,
      runtime.animation.animations.flatMap((animation) =>
        animation.source?.indexedImage && animation.source.assetId
          ? [
              {
                assetId: animation.source.assetId,
                indexedImage: animation.source.indexedImage,
              },
            ]
          : [],
      ),
      new Set(assetIds),
    );
    expect(decoded.success).toBe(true);
    if (!decoded.success) return;
    const compiled = compileProjectGraphics({
      graphics: runtime.graphics,
      decodedAssets: decoded.assets,
      backgroundMaps: [],
      animationDemands: runtime.animation.animations.flatMap((animation) =>
        animation.source?.indexedImage && animation.source.assetId
          ? [
              {
                animationId: animation.id,
                frames: extractLogicalAnimationFrames({
                  image: animation.source.indexedImage,
                  pixelOverrides: animation.pixelOverrides,
                  frameIndices: animation.frameIndices,
                  defaultDuration: animation.defaultDuration,
                  frameDurations: animation.frameDurations,
                  framePalettes: animation.framePalettes,
                  paletteIndex: animation.paletteIndex,
                  frameWidth: animation.frameWidth,
                  frameHeight: animation.frameHeight,
                  originX: animation.originX,
                  originY: animation.originY,
                  assetId: animation.source.assetId,
                }),
                flipDeduplication: runtime.animation.flipDeduplication,
              },
            ]
          : [],
      ),
      baseChrBytes: runtime.animation.destinationChr,
      chrRegions: runtime.chrRegions,
    });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    expect(
      compiled.allocationManifest.filter((slot) => slot.state === 'base-chr'),
    ).toHaveLength(21);
    expect(
      compiled.allocationManifest.filter((slot) => slot.state === 'project'),
    ).toHaveLength(2);
    expect(
      compiled.logicalTilePlacements.map((placement) => placement.physicalSlot),
    ).toEqual([21, 22]);
    expect(createLogicalTileKey('asset-hero', 0, 0)).toBe(
      compiled.logicalTilePlacements[0]?.logicalKey,
    );
  });

  it('recovers a proven generated legacy CHR envelope through the real catalog-backed Animation load path', () => {
    const initial = createDefaultProject(
      'Legacy generated envelope',
      'animation',
    );
    const first = initial.animation?.animations[0];
    if (!first) throw new Error('Expected default Animation.');
    const assetIds = ['asset-hero', 'asset-enemy'] as const;
    const canonical: StudioProject = {
      ...initial,
      graphics: {
        ...initial.graphics,
        assets: assetIds.map((id) => ({
          id,
          kind: 'spritesheet' as const,
          name: id,
          source: {
            path: `${id}.png`,
            name: `${id}.png`,
            sourceKind: 'png' as const,
            dataUrl: `data:image/png;base64,${id}`,
          },
          logicalTiles: {
            decoding: 'png-indexed' as const,
            quantization: initial.settings.quantization,
            paletteBank: 'sprite' as const,
          },
        })),
        renderContexts: [
          {
            id: 'sprites',
            name: 'Sprites',
            backgroundPatternTable: 1,
            spriteMode: '8x8',
            spritePatternTable: 0,
            mapIds: [],
            animationIds: ['anim-hero', 'anim-enemy'],
          },
        ],
      },
      animation: {
        ...initial.animation,
        patternTable: 0,
        animations: assetIds.map((assetId, index) => ({
          ...first,
          id: index === 0 ? 'anim-hero' : 'anim-enemy',
          name: assetId,
          assetId,
          asset: null,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDurations: [8],
        })),
      },
    };
    const canonicalResult = deserializeProject(serializeProject(canonical));
    expect(canonicalResult.success).toBe(true);
    if (!canonicalResult.success) return;

    const images = assetIds.map((_, index) => indexedAnimation(index + 1));
    const noBaseRuntime = restoreProjectView(
      canonicalResult.project,
      createRuntimeSource(canonicalResult.project),
      restoreAnimationSourcesFromCatalog(canonicalResult.project, images),
    );
    const noBaseCompilation = compileRuntimeProjectGraphics(noBaseRuntime, []);
    expect(noBaseCompilation.kind).toBe('compiled');
    if (noBaseCompilation.kind !== 'compiled') return;
    const generatedEnvelope = noBaseCompilation.compiled.finalChr;

    const legacyRaw = JSON.parse(serializeProject(canonical)) as Record<
      string,
      unknown
    >;
    legacyRaw.formatVersion = 1;
    delete legacyRaw.graphics;
    const legacyAnimation = legacyRaw.animation as Record<string, unknown>;
    legacyAnimation.destinationChr = {
      id: 'asset-legacy-output',
      path: 'legacy-output.chr',
      name: 'legacy-output.chr',
      sourceKind: 'chr',
      dataUrl: `data:application/octet-stream;base64,${btoa(
        String.fromCharCode(...generatedEnvelope),
      )}`,
    };
    legacyAnimation.animations = assetIds.map((assetId, index) => ({
      ...first,
      id: index === 0 ? 'anim-hero' : 'anim-enemy',
      name: assetId,
      assetId,
      asset: {
        id: assetId,
        path: `${assetId}.png`,
        name: `${assetId}.png`,
        sourceKind: 'png',
        dataUrl: `data:image/png;base64,${assetId}`,
      },
      frameWidth: 8,
      frameHeight: 8,
      frameIndices: [0],
      frameDurations: [8],
    }));
    const migrated = deserializeProject(JSON.stringify(legacyRaw));
    expect(migrated.success).toBe(true);
    if (!migrated.success) return;
    const loadedResult = deserializeProject(serializeProject(migrated.project));
    expect(loadedResult.success).toBe(true);
    if (!loadedResult.success) return;
    const loaded = loadedResult.project;
    for (const animation of loaded.animation?.animations ?? []) {
      const resolved = resolveAnimationRuntimeAsset(loaded, animation);
      expect(resolved.assetId).toBe(animation.assetId);
      expect(resolved.asset?.id).toBe(animation.assetId);
      const withoutCompatibilityAlias = { ...animation, asset: null };
      expect(
        resolveAnimationRuntimeAsset(loaded, withoutCompatibilityAlias),
      ).toEqual(resolved);
    }

    const runtime = restoreProjectView(
      loaded,
      createRuntimeSource(loaded),
      restoreAnimationSourcesFromCatalog(loaded, images, generatedEnvelope),
    );
    const blocked = compileRuntimeProjectGraphics(runtime, []);
    expect(blocked.kind).toBe('failed-compilation');
    const recovered = recoverGeneratedLegacyChrEnvelope(runtime, []);
    expect(recovered.graphics.baseChr.assetId).toBeNull();
    expect(recovered.animation.destinationChr).toHaveLength(0);

    const ambiguousRuntime = {
      ...runtime,
      animation: {
        ...runtime.animation,
        destinationChr: Uint8Array.from(generatedEnvelope, (byte, index) =>
          index === 0 ? byte ^ 0xff : byte,
        ),
      },
    };
    expect(recoverGeneratedLegacyChrEnvelope(ambiguousRuntime, [])).toBe(
      ambiguousRuntime,
    );

    const compiled = compileRuntimeProjectGraphics(recovered, []);
    expect(compiled.kind).toBe('compiled');
    if (compiled.kind !== 'compiled') return;
    expect(compiled.compiled.finalChr).toEqual(generatedEnvelope);
    expect(
      compiled.compiled.allocationManifest.filter(
        (slot) => slot.state === 'project',
      ),
    ).toHaveLength(2);
    expect(compiled.compiled.logicalTilePlacements[0]?.physicalSlot).toBe(0);
  });

  it('diagnoses a legacy generated envelope whose historical physical layout differs from canonical placement', () => {
    const initial = createDefaultProject(
      'Historical generated layout',
      'animation',
    );
    const first = initial.animation?.animations[0];
    if (!first) throw new Error('Expected default Animation.');
    const assetIds = ['asset-hero', 'asset-enemy'] as const;
    const tileCounts = [11, 10] as const;
    const canonical: StudioProject = {
      ...initial,
      graphics: {
        ...initial.graphics,
        assets: assetIds.map((id) => ({
          id,
          kind: 'spritesheet' as const,
          name: id,
          source: {
            path: `${id}.png`,
            name: `${id}.png`,
            sourceKind: 'png' as const,
            dataUrl: `data:image/png;base64,${id}`,
          },
          logicalTiles: {
            decoding: 'png-indexed' as const,
            quantization: initial.settings.quantization,
            paletteBank: 'sprite' as const,
          },
        })),
        renderContexts: [
          {
            id: 'sprites',
            name: 'Sprites',
            backgroundPatternTable: 1,
            spriteMode: '8x8',
            spritePatternTable: 0,
            mapIds: [],
            animationIds: ['anim-hero', 'anim-enemy'],
          },
        ],
      },
      animation: {
        ...initial.animation,
        patternTable: 0,
        flipDeduplication: false,
        animations: assetIds.map((assetId, index) => ({
          ...first,
          id: index === 0 ? 'anim-hero' : 'anim-enemy',
          name: assetId,
          assetId,
          asset: null,
          frameWidth: 8,
          frameHeight: (tileCounts[index] ?? 0) * 8,
          frameIndices: [0],
          frameDurations: [8],
        })),
      },
    };
    const canonicalResult = deserializeProject(serializeProject(canonical));
    expect(canonicalResult.success).toBe(true);
    if (!canonicalResult.success) return;
    const images = tileCounts.map((count, index) =>
      indexedAnimationStrip(count, index * 11 + 1),
    );
    const noBaseRuntime = restoreProjectView(
      canonicalResult.project,
      createRuntimeSource(canonicalResult.project),
      restoreAnimationSourcesFromCatalog(canonicalResult.project, images),
    );
    const noBaseCompilation = compileRuntimeProjectGraphics(noBaseRuntime, []);
    expect(noBaseCompilation.kind).toBe('compiled');
    if (noBaseCompilation.kind !== 'compiled') return;
    expect(noBaseCompilation.compiled.logicalTilePlacements).toHaveLength(21);

    const legacyEnvelope = new Uint8Array(8192);
    for (const [
      index,
      placement,
    ] of noBaseCompilation.compiled.logicalTilePlacements.entries()) {
      const sourceOffset = placement.physicalSlot * 16;
      legacyEnvelope.set(
        noBaseCompilation.compiled.finalChr.slice(
          sourceOffset,
          sourceOffset + 16,
        ),
        (128 + index) * 16,
      );
    }
    const legacyRaw = JSON.parse(serializeProject(canonical)) as Record<
      string,
      unknown
    >;
    legacyRaw.formatVersion = 1;
    delete legacyRaw.graphics;
    const legacyAnimation = legacyRaw.animation as Record<string, unknown>;
    legacyAnimation.destinationChr = {
      id: 'asset-legacy-output',
      path: 'game.chr',
      name: 'game.chr',
      sourceKind: 'chr',
      dataUrl: `data:application/octet-stream;base64,${btoa(
        String.fromCharCode(...legacyEnvelope),
      )}`,
    };
    legacyAnimation.animations = assetIds.map((assetId, index) => ({
      ...first,
      id: index === 0 ? 'anim-hero' : 'anim-enemy',
      name: assetId,
      assetId,
      asset: {
        id: assetId,
        path: `${assetId}.png`,
        name: `${assetId}.png`,
        sourceKind: 'png',
        dataUrl: `data:image/png;base64,${assetId}`,
      },
      frameWidth: 8,
      frameHeight: (tileCounts[index] ?? 0) * 8,
      frameIndices: [0],
      frameDurations: [8],
    }));
    const migrated = deserializeProject(JSON.stringify(legacyRaw));
    expect(migrated.success).toBe(true);
    if (!migrated.success) return;
    const loadedResult = deserializeProject(serializeProject(migrated.project));
    expect(loadedResult.success).toBe(true);
    if (!loadedResult.success) return;
    const loaded = loadedResult.project;
    const baseSource = loaded.graphics.baseChr.source;
    if (baseSource?.dataUrl === undefined) {
      throw new Error('Expected embedded legacy destination envelope.');
    }
    const loadedEnvelope = decodeEmbeddedBytes(baseSource.dataUrl);
    const runtime = restoreProjectView(
      loaded,
      createRuntimeSource(loaded),
      restoreAnimationSourcesFromCatalog(loaded, images, loadedEnvelope),
    );
    const candidate = {
      ...runtime,
      graphics: {
        ...runtime.graphics,
        baseChr: createDefaultProject().graphics.baseChr,
      },
      animation: {
        ...runtime.animation,
        destinationChr: new Uint8Array(),
        destinationChrAssetId: null,
        destinationChrAsset: null,
        destinationChrName: null,
      },
    };
    const candidateCompilation = compileRuntimeProjectGraphics(candidate, []);
    const candidateFailures =
      candidateCompilation.kind === 'failed-compilation'
        ? candidateCompilation.result.failures.map((failure) => failure.code)
        : [];
    const basePolicy = runtime.graphics.baseChr.slotPolicies[0];
    if (basePolicy === undefined) {
      throw new Error('Expected unknown legacy Base CHR policy.');
    }
    const diagnostics = {
      isLegacyUnknownBaseChr:
        runtime.graphics.baseChr.byteLength === null &&
        basePolicy.occupancy === 'unknown' &&
        basePolicy.writability === 'locked',
      destinationChrLength: runtime.animation.destinationChr.length,
      destinationChrName: runtime.animation.destinationChrName,
      destinationChrAssetId: runtime.animation.destinationChrAssetId,
      noBaseStatus: candidateCompilation.kind,
      noBaseFailures: candidateFailures,
      projectPlacements:
        candidateCompilation.kind === 'compiled'
          ? candidateCompilation.compiled.logicalTilePlacements.length
          : 0,
      legacyNonEmptyTiles: nonEmptyChrTileCount(
        runtime.animation.destinationChr,
      ),
      noBaseNonEmptyTiles:
        candidateCompilation.kind === 'compiled'
          ? nonEmptyChrTileCount(candidateCompilation.compiled.finalChr)
          : 0,
      sameBytes:
        candidateCompilation.kind === 'compiled' &&
        sameChrBytes(
          candidateCompilation.compiled.finalChr,
          runtime.animation.destinationChr,
        ),
      firstDifferingSlots:
        candidateCompilation.kind === 'compiled'
          ? firstDifferingPhysicalSlots(
              candidateCompilation.compiled.finalChr,
              runtime.animation.destinationChr,
            )
          : [],
      demands: createRuntimeAnimationDemands(runtime).map((demand) => ({
        animationId: demand.animationId,
        spriteCount: demand.frames[0]?.sprites.length ?? 0,
      })),
      placements:
        candidateCompilation.kind === 'compiled'
          ? candidateCompilation.compiled.logicalTilePlacements.map(
              (placement) => ({
                logicalKey: placement.logicalKey,
                physicalSlot: placement.physicalSlot,
              }),
            )
          : [],
    };

    expect(diagnostics).toMatchObject({
      isLegacyUnknownBaseChr: true,
      destinationChrLength: 8192,
      destinationChrName: 'game.chr',
      destinationChrAssetId: 'asset-legacy-output',
      noBaseStatus: 'compiled',
      noBaseFailures: [],
      projectPlacements: 21,
      legacyNonEmptyTiles: 21,
      noBaseNonEmptyTiles: 21,
      sameBytes: false,
      firstDifferingSlots: [0, 1, 2, 3, 4, 5, 6, 7],
      demands: [
        { animationId: 'anim-hero', spriteCount: 11 },
        { animationId: 'anim-enemy', spriteCount: 10 },
      ],
    });
    expect(diagnostics.placements).toHaveLength(21);
    const recovered = recoverGeneratedLegacyChrEnvelope(runtime, []);
    expect(recovered).not.toBe(runtime);
    expect(recovered.graphics.baseChr.assetId).toBeNull();
    expect(recovered.animation.destinationChr).toHaveLength(0);
    const ambiguousExternal = {
      ...runtime,
      animation: {
        ...runtime.animation,
        destinationChr: Uint8Array.from(loadedEnvelope, (byte) => byte ^ 0xff),
        destinationChrName: 'external-base.chr',
      },
    };
    expect(recoverGeneratedLegacyChrEnvelope(ambiguousExternal, [])).toBe(
      ambiguousExternal,
    );
    expect(compileRuntimeProjectGraphics(ambiguousExternal, []).kind).toBe(
      'failed-compilation',
    );
    const recoveredCompilation = compileRuntimeProjectGraphics(recovered, []);
    expect(recoveredCompilation.kind).toBe('compiled');
    if (recoveredCompilation.kind !== 'compiled') return;
    const placementSlots = new Set(
      recoveredCompilation.compiled.logicalTilePlacements.map(
        (placement) => placement.physicalSlot,
      ),
    );
    const manifestProjectSlots = new Set(
      recoveredCompilation.compiled.allocationManifest
        .filter((slot) => slot.state === 'project')
        .map((slot) => slot.physicalSlot),
    );
    expect(manifestProjectSlots).toEqual(placementSlots);
    const animationMappingSlots = new Set(
      recoveredCompilation.compiled.logicalTilePlacements
        .filter((placement) =>
          placement.usages.some((usage) => usage.kind === 'animation'),
        )
        .map((placement) => placement.physicalSlot),
    );
    expect(animationMappingSlots).toEqual(placementSlots);
  });

  it('recovers the loaded NES Survivor v1 envelope without treating its stale tile as Base CHR', () => {
    const initial = createDefaultProject('NES Survivor', 'animation');
    const template = initial.animation?.animations[0];
    if (!template) throw new Error('Expected default Animation.');
    const destinationChr = new Uint8Array(8192);
    destinationChr.set(
      Uint8Array.from(atob(legacyNesSurvivor.destinationChrPrefix), (char) =>
        char.charCodeAt(0),
      ),
    );
    const legacyRaw = JSON.parse(serializeProject(initial)) as Record<
      string,
      unknown
    >;
    legacyRaw.formatVersion = 1;
    delete legacyRaw.graphics;
    const animation = legacyRaw.animation as Record<string, unknown>;
    animation.patternTable = 0;
    animation.destinationPatternTable = 0;
    animation.flipDeduplication = true;
    animation.destinationChr = {
      id: 'asset-base-chr-default',
      path: 'game.chr',
      name: 'game.chr',
      sourceKind: 'chr',
      dataUrl: `data:application/octet-stream;base64,${btoa(
        String.fromCharCode(...destinationChr),
      )}`,
    };
    animation.animations = legacyNesSurvivor.animations.map((fixture) => ({
      ...template,
      id: fixture.id,
      name: fixture.name,
      entity: fixture.entity,
      assetId: fixture.assetId,
      asset: {
        id: fixture.assetId,
        path: fixture.fileName,
        name: fixture.fileName,
        sourceKind: 'png',
        dataUrl: `data:image/png;base64,${fixture.id}`,
      },
      frameWidth: fixture.frameWidth,
      frameHeight: fixture.frameHeight,
      frameIndices: fixture.frameIndices,
      frameDurations: fixture.frameIndices.map(() => 12),
    }));

    const deserialized = deserializeProject(JSON.stringify(legacyRaw));
    expect(deserialized.success).toBe(true);
    if (!deserialized.success) return;
    const loaded = deserialized.project;
    expect(loaded.animation?.flipDeduplication).toBe(true);
    const runtimeImages = legacyNesSurvivor.animations.map((fixture) => ({
      width: fixture.width,
      height: fixture.height,
      pixels: Uint8Array.from(atob(fixture.pixels), (char) =>
        char.charCodeAt(0),
      ),
      colors: [
        { red: 0, green: 0, blue: 0 },
        { red: 85, green: 85, blue: 85 },
        { red: 170, green: 170, blue: 170 },
        { red: 255, green: 255, blue: 255 },
      ],
      transparentIndex: 0 as const,
      colorCount: 4,
    }));
    expect(runtimeImages.map((image) => image.pixels.length)).toEqual(
      runtimeImages.map((image) => image.width * image.height),
    );
    const restoredAnimation = restoreAnimationSourcesFromCatalog(
      loaded,
      runtimeImages,
      destinationChr,
    );
    expect(
      restoredAnimation.animations.map((item) => item.source?.assetId),
    ).toEqual(legacyNesSurvivor.animations.map((fixture) => fixture.assetId));
    expect(
      restoredAnimation.animations.every((item) => item.source?.indexedImage),
    ).toBe(true);

    const runtime = restoreProjectView(
      loaded,
      createRuntimeSource(loaded),
      restoredAnimation,
    );
    const unknownPolicy = runtime.graphics.baseChr.slotPolicies[0];
    expect(runtime.graphics.baseChr.byteLength).toBeNull();
    expect(unknownPolicy).toMatchObject({
      occupancy: 'unknown',
      writability: 'locked',
      provenance: 'pending-source',
    });
    expect(
      runtime.graphics.renderContexts.flatMap(
        (context) => context.animationIds,
      ),
    ).toEqual(legacyNesSurvivor.animations.map((fixture) => fixture.id));
    expect(createRuntimeAnimationDemands(runtime)).toHaveLength(5);
    expect(compileRuntimeProjectGraphics(runtime, []).kind).toBe(
      'failed-compilation',
    );

    const recovered = recoverGeneratedLegacyChrEnvelope(runtime, []);
    expect(recovered).not.toBe(runtime);
    expect(recovered.graphics.baseChr.assetId).toBeNull();
    expect(recovered.animation.destinationChr).toHaveLength(0);
    const compiled = compileRuntimeProjectGraphics(recovered, []);
    expect(compiled.kind).toBe('compiled');
    if (compiled.kind !== 'compiled') return;
    expect(compiled.compiled.logicalTilePlacements).toHaveLength(35);
    expect(
      compiled.compiled.allocationManifest.filter(
        (entry) => entry.state === 'project',
      ),
    ).toHaveLength(20);
    expect(
      new Set(
        compiled.compiled.logicalTilePlacements.map(
          (placement) => placement.physicalSlot,
        ),
      ),
    ).toEqual(
      new Set(
        compiled.compiled.allocationManifest
          .filter((entry) => entry.state === 'project')
          .map((entry) => entry.physicalSlot),
      ),
    );

    const ambiguous = {
      ...runtime,
      animation: {
        ...runtime.animation,
        destinationChr: Uint8Array.from(destinationChr),
      },
    };
    ambiguous.animation.destinationChr = Uint8Array.from(
      destinationChr,
      (byte) => byte ^ 0xff,
    );
    expect(recoverGeneratedLegacyChrEnvelope(ambiguous, [])).toBe(ambiguous);
  });

  it('reports a referenced Animation without a runtime source instead of dropping its demand', () => {
    const persisted = createCompleteProject('animation');
    const loadedResult = deserializeProject(serializeProject(persisted));
    expect(loadedResult.success).toBe(true);
    if (!loadedResult.success) return;
    const runtime = restoreProjectView(
      loadedResult.project,
      createRuntimeSource(loadedResult.project),
      createAnimationRuntime(loadedResult.project),
    );
    const result = compileRuntimeProjectGraphics(runtime, []);
    expect(result.kind).toBe('failed-compilation');
    if (result.kind !== 'failed-compilation') return;
    expect(result.result.failures[0]?.code).toBe(
      'unresolved-render-context-consumer',
    );
  });

  it('preserves unique generated Background Map IDs across runtime round-trip', () => {
    const original = createCompleteProject('animation');
    const firstMap = createEmptyBackgroundMap({ name: 'Generated One' });
    const secondMap = createEmptyBackgroundMap({ name: 'Generated Two' });
    const withGeneratedMaps: StudioProject = {
      ...original,
      backgrounds: {
        activeMapId: secondMap.id,
        maps: [firstMap, secondMap],
      },
    };

    const loaded = roundTripRuntime(withGeneratedMaps);
    const originalIds = [firstMap.id, secondMap.id];
    const loadedIds = loaded.backgrounds?.maps.map((map) => map.id);

    expect(new Set(originalIds)).toHaveLength(2);
    expect(loadedIds).toEqual([...originalIds, 'background-playfield-default']);
    expect(loaded.backgrounds?.activeMapId).toBe(secondMap.id);
  });
});
