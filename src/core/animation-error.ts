/**
 * Structured domain errors for animation and metasprite CHR operations.
 */

export type AnimationModelErrorCode =
  | 'invalid-name'
  | 'invalid-symbol-prefix'
  | 'invalid-frame-dimensions'
  | 'invalid-frame-grid'
  | 'invalid-frame-selection'
  | 'duplicate-frame-selection'
  | 'no-selected-frames'
  | 'invalid-frame-duration'
  | 'invalid-animation-direction'
  | 'duplicate-animation-name'
  | 'duplicate-animation-identifier'
  | 'invalid-playback'
  | 'invalid-origin'
  | 'invalid-sprite-palette'
  | 'invalid-pattern-table'
  | 'invalid-destination-chr'
  | 'destination-capacity-overflow'
  | 'pattern-table-capacity-overflow'
  | 'chr-capacity-overflow'
  | 'tile-index-overflow';

export class AnimationModelError extends Error {
  public constructor(
    public readonly code: AnimationModelErrorCode,
    public readonly details: Readonly<Record<string, number | string>> = {},
  ) {
    super(code);
    this.name = 'AnimationModelError';
  }
}
