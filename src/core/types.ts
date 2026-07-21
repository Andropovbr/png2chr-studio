export interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface RawImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface IndexedImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly colors: readonly (RgbColor | null)[];
  readonly transparentIndex: 0 | null;
  readonly colorCount: number;
}

export interface Tile {
  readonly id: number;
  readonly column: number;
  readonly row: number;
  readonly pixels: Uint8Array;
}

export type ImageAnalysisErrorCode =
  | 'invalid-dimensions'
  | 'invalid-pixel-data'
  | 'partial-transparency'
  | 'too-many-colors';

interface ImageAnalysisErrorDetails {
  readonly pixelIndex?: number;
  readonly colorCount?: number;
  readonly colors?: readonly RgbColor[];
  readonly hasTransparency?: boolean;
}

export class ImageAnalysisError extends Error {
  public constructor(
    public readonly code: ImageAnalysisErrorCode,
    public readonly details: ImageAnalysisErrorDetails = {},
  ) {
    super(code);
    this.name = 'ImageAnalysisError';
  }
}
