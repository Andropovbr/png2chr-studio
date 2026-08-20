import type { DisplayError, PreviewTool } from './types';

export interface AnimationWorkspaceState {
  /** Presentation state projected onto the animation editor at render time. */
  readonly collapsedAnimationIds: readonly string[];
  readonly configCollapsed: boolean;
  readonly paletteCollapsed: boolean;
  readonly mappingCollapsed: boolean;
}

export interface WorkspaceState {
  /** Transient interaction state. It is intentionally absent from ProjectView. */
  readonly previewTool: PreviewTool;
  readonly showPaletteNumbers: boolean;
  readonly zoomedPaletteRegion: number | null;
  readonly paletteColorTarget: {
    readonly paletteIndex: number;
    readonly colorIndex: number;
  };
  readonly quantizationCollapsed: boolean;
  readonly animation: AnimationWorkspaceState;
}

export interface DerivedStatus {
  /** Async/validation status derived while loading or processing project data. */
  readonly error: DisplayError | null;
  readonly loading: boolean;
}

export function createWorkspaceState(
  paletteIndex = 0,
  colorIndex = 1,
): WorkspaceState {
  return {
    previewTool: 'palette',
    showPaletteNumbers: false,
    zoomedPaletteRegion: null,
    paletteColorTarget: { paletteIndex, colorIndex },
    quantizationCollapsed: false,
    animation: {
      collapsedAnimationIds: [],
      configCollapsed: false,
      paletteCollapsed: false,
      mappingCollapsed: true,
    },
  };
}

export function createDerivedStatus(
  error: DisplayError | null = null,
): DerivedStatus {
  return { error, loading: false };
}
