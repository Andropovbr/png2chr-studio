import type { DisplayError, PreviewTool } from './types';

export type AnimationWorkspaceTab = 'frames' | 'pixels' | 'mapping' | 'scene';

export interface AnimationWorkspaceState {
  /** Presentation and selection state projected onto the animation editor at render time. */
  readonly selectedAnimationId?: string | null;
  readonly selectedFrameIndex?: number | null;
  readonly selectedSceneInstanceId?: string | null;
  readonly activeTab?: AnimationWorkspaceTab;
  readonly collapsedAnimationIds?: readonly string[];
  readonly configCollapsed: boolean;
  readonly paletteCollapsed: boolean;
  readonly mappingCollapsed: boolean;
  readonly previewCollapsed: boolean;
}

export type WorkspaceView =
  'tileset' | 'playfield' | 'animation' | 'palette' | 'chr' | 'deliver';

export type ChrHighlightScope =
  'none' | 'frame' | 'animation' | 'entity' | 'base' | 'all';

export interface ChrWorkspaceState {
  readonly zoom: number;
  readonly selectedTileIndex: number | null;
  readonly previewPalette?: string;
  readonly highlightScope?: ChrHighlightScope;
}

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
  readonly chr: ChrWorkspaceState;
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
      selectedFrameIndex: 0,
      activeTab: 'frames',
      collapsedAnimationIds: [],
      configCollapsed: false,
      paletteCollapsed: false,
      mappingCollapsed: true,
      previewCollapsed: false,
    },
    chr: {
      zoom: 2,
      selectedTileIndex: null,
      previewPalette: 'grayscale',
      highlightScope: 'none',
    },
  };
}

export function createDerivedStatus(
  error: DisplayError | null = null,
): DerivedStatus {
  return { error, loading: false };
}
