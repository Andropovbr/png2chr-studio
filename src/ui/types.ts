import type { PlayfieldEncodingError } from '../core/playfield-encoder';
import type { AnimationPlayback } from '../core/animation-model';
import type { ChrRegion } from '../core/chr-pattern-table';
import type { CollisionType } from '../core/collision-encoder';
import type { InesRomError } from '../core/ines-rom';
import type { NesPaletteSet } from '../core/nes-palette';
import type { PaletteDefinition } from '../core/palette-manager';
import type { RandomPlayfieldFeature } from '../core/random-playfield';
import type { ProjectMode } from '../core/project-mode';
import type { FrameDetectionResult } from '../core/frame-detection';
import type { ProjectScenePreviewConfig } from '../core/scene-preview';
import type { ImageAnalysisError, IndexedImage, Tile } from '../core/types';
import type { TranslationKey, TranslationVariables } from '../i18n';
import type {
  DitheringMode,
  QuantizationMode,
  QuantizationSettings,
} from '../core/quantization-settings';

export interface DisplayError {
  readonly key: TranslationKey;
  readonly variables?: TranslationVariables;
  readonly colors?: readonly string[];
}

export type { ProjectMode } from '../core/project-mode';
export type PreviewTool = 'palette' | 'paint-collision' | 'erase-collision';
export type SourceKind = 'png' | 'chr' | 'nes';

export interface AnimationSourceData {
  readonly assetId?: string;
  readonly fileName: string;
  readonly sourceImage: ImageData;
  readonly indexedImage: IndexedImage;
}

import type { TilePixelOverrides } from '../core/pixel-overrides';

export interface AnimationItemSetting {
  readonly id: string;
  readonly name: string;
  readonly entity?: string;
  readonly source: AnimationSourceData | null;
  readonly paletteId?: string | null;
  readonly paletteIndex?: number | null;
  readonly framePaletteIds?: readonly (string | null)[];
  readonly quantizationMode?: QuantizationMode;
  readonly ditheringMode?: DitheringMode;
  readonly pixelOverrides?: TilePixelOverrides;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly originX: number;
  readonly originY: number;
  readonly playback: AnimationPlayback;
  readonly allowHorizontalFlip: boolean;
  readonly allowVerticalFlip: boolean;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly defaultDuration: number;
  readonly frameIndices: readonly number[];
  readonly frameDurations: readonly number[];
  readonly framePalettes?: readonly (number | null)[];
  /** Optional presentation projection for the animation editor. Not persisted. */
  readonly collapsed?: boolean;
  /** Last automatic frame-grid detection result for this animation's source. */
  readonly frameDetection?: FrameDetectionResult | null;
}

export interface AnimationSettings {
  readonly name: string;
  readonly symbolPrefix: string;
  readonly defaultPaletteIndex: number;
  readonly quantizationMode: QuantizationMode;
  readonly ditheringMode: DitheringMode;
  readonly animations: readonly AnimationItemSetting[];
  readonly flipDeduplication: boolean;
  readonly spritePalette: number;
  readonly spriteColorIndex: number;
  readonly colorIndices: Uint8Array;
  readonly destinationChrAssetId?: string | null;
  readonly destinationChrName: string | null;
  readonly destinationChr: Uint8Array;
  /** Pattern table used by sprite OAM tile bytes (PPUCTRL bit 3). */
  readonly patternTable: 0 | 1;
  /** Placement for a base CHR shorter than 8 KiB. */
  readonly destinationPatternTable: 0 | 1;
  /** Optional presentation projections supplied to the animation editor. */
  readonly mappingCollapsed?: boolean;
  readonly configCollapsed?: boolean;
  readonly paletteCollapsed?: boolean;
  readonly quantizationCollapsed?: boolean;
}

export interface ProjectView {
  readonly assetId?: string | null;
  readonly fileName: string | null;
  readonly sourceKind: SourceKind | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly sourceImage: ImageData | null;
  readonly indexedImage: IndexedImage | null;
  readonly tiles: readonly Tile[];
  readonly mode: ProjectMode;
  readonly deduplicationEnabled: boolean;
  readonly flipDeduplicationEnabled: boolean;
  readonly collisionCells: Uint8Array;
  readonly activeCollisionType: CollisionType;
  readonly randomPlayfieldFeatures: readonly RandomPlayfieldFeature[];
  readonly paletteSet: NesPaletteSet;
  readonly palettes?: readonly PaletteDefinition[];
  readonly activeSpritePaletteSlots?: readonly (string | null)[];
  readonly paletteAssignments: Uint8Array;
  readonly pixelOverrides: Uint8Array;
  readonly activePaletteIndex: number;
  readonly activeColorIndex: number;
  readonly chrRegions?: readonly ChrRegion[];
  readonly animation: AnimationSettings;
  readonly scenePreview?: ProjectScenePreviewConfig;
  readonly quantizationSettings: QuantizationSettings;
}

export function displayErrorFromPlayfield(
  error: PlayfieldEncodingError,
): DisplayError {
  switch (error.code) {
    case 'invalid-playfield-dimensions':
      return { key: 'invalidPlayfieldDimensions' };
    case 'invalid-playfield-tiles':
      return { key: 'invalidPlayfieldTiles' };
    case 'too-many-playfield-tiles':
      return {
        key: 'tooManyPlayfieldTiles',
        variables: { count: error.tileCount ?? 0 },
      };
  }
}

export function displayErrorFromInes(error: InesRomError): DisplayError {
  switch (error.code) {
    case 'invalid-header':
      return { key: 'invalidNesHeader' };
    case 'nes2-unsupported':
      return { key: 'nes2Unsupported' };
    case 'mapper-unsupported':
      return {
        key: 'nesMapperUnsupported',
        variables: { mapper: error.mapper ?? 0 },
      };
    case 'prg-size-unsupported':
      return { key: 'nesPrgSizeUnsupported' };
    case 'chr-ram-unsupported':
      return { key: 'nesChrRamUnsupported' };
    case 'chr-size-unsupported':
      return { key: 'nesChrSizeUnsupported' };
    case 'truncated-rom':
      return { key: 'nesRomTruncated' };
  }
}

export function displayErrorFromAnalysis(
  error: ImageAnalysisError,
): DisplayError {
  switch (error.code) {
    case 'invalid-dimensions':
      return { key: 'invalidDimensions' };
    case 'invalid-pixel-data':
      return { key: 'invalidPixelData' };
    case 'partial-transparency':
      return { key: 'partialTransparency' };
    case 'too-many-colors':
      return {
        key: 'tooManyColors',
        variables: { count: error.details.colorCount ?? 0 },
        colors: error.details.colors?.map(
          ({ red, green, blue }) =>
            `#${[red, green, blue]
              .map((channel) => channel.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase()}`,
        ),
      };
  }
}
