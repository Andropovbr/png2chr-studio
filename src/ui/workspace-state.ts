import type { DisplayError, PreviewTool } from './types';

export type AnimationWorkspaceTab = 'frames' | 'pixels' | 'mapping';

export interface AnimationWorkspaceState {
  /** Presentation and selection state projected onto the animation editor at render time. */
  readonly selectedAnimationId?: string | null;
  readonly activeTab?: AnimationWorkspaceTab;
  readonly collapsedAnimationIds?: readonly string[];
  readonly configCollapsed: boolean;
  readonly paletteCollapsed: boolean;
  readonly mappingCollapsed: boolean;
}

export type WorkspaceView =
  'tileset' | 'playfield' | 'animation' | 'palette' | 'chr';

export interface WorkspaceState {
  /** Transient interaction and navigation state. It is intentionally absent from ProjectView. */
  readonly activeWorkspace: WorkspaceView;
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
  activeWorkspace: WorkspaceView = 'tileset',
): WorkspaceState {
  return {
    activeWorkspace,
    previewTool: 'palette',
    showPaletteNumbers: false,
    zoomedPaletteRegion: null,
    paletteColorTarget: { paletteIndex, colorIndex },
    quantizationCollapsed: false,
    animation: {
      selectedAnimationId: null,
      activeTab: 'frames',
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
