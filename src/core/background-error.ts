/**
 * Structured domain errors for Background, Nametable and Attribute Table operations.
 * Part of Milestone 8: Background Pipeline (Issue #108).
 */

export type BackgroundModelErrorCode =
  | 'invalid-dimensions'
  | 'invalid-cell-count'
  | 'invalid-palette-assignment-count'
  | 'invalid-palette-index'
  | 'invalid-pattern-table'
  | 'invalid-cell-reference'
  | 'invalid-tile-index'
  | 'unresolved-logical-tile'
  | 'invalid-map-name'
  | 'invalid-map-id'
  | 'duplicate-map-id'
  | 'duplicate-map-name'
  | 'background-capacity-overflow';

export class BackgroundModelError extends Error {
  public constructor(
    public readonly code: BackgroundModelErrorCode,
    public readonly details: Readonly<Record<string, number | string>> = {},
  ) {
    super(code);
    this.name = 'BackgroundModelError';
  }
}
