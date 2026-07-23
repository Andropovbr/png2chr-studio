import type { PlayfieldEncodingError } from '../core/playfield-encoder';
import type { InesRomError } from '../core/ines-rom';
import type { NesPaletteSet } from '../core/nes-palette';
import type { ImageAnalysisError, IndexedImage, Tile } from '../core/types';
import type { TranslationKey, TranslationVariables } from '../i18n';

export interface DisplayError {
  readonly key: TranslationKey;
  readonly variables?: TranslationVariables;
  readonly colors?: readonly string[];
}

export type ProjectMode = 'tileset' | 'playfield';
export type PreviewTool = 'palette' | 'paint-collision' | 'erase-collision';
export type SourceKind = 'png' | 'chr' | 'nes';

export interface ProjectView {
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
  readonly previewTool: PreviewTool;
  readonly paletteSet: NesPaletteSet;
  readonly paletteAssignments: Uint8Array;
  readonly pixelOverrides: Uint8Array;
  readonly activePaletteIndex: number;
  readonly activeColorIndex: number;
  readonly showPaletteNumbers: boolean;
  readonly zoomedPaletteRegion: number | null;
  readonly paletteColorTarget: {
    readonly paletteIndex: number;
    readonly colorIndex: number;
  };
  readonly error: DisplayError | null;
  readonly loading: boolean;
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
