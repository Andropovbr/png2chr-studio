import type { DisplayError, PreviewTool } from './types';
import type { ChrDrawingTool } from './chr-tile-editor';
import type { PaletteLibraryFilter } from './palette-manager-panel';

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
  | 'tileset'
  | 'playfield'
  | 'background'
  | 'animation'
  | 'palette'
  | 'chr'
  | 'deliver';

export type ChrHighlightScope =
  'none' | 'frame' | 'animation' | 'entity' | 'base' | 'all';

export type BackgroundTool = 'pencil' | 'picker' | 'erase' | 'palette';

export interface BackgroundWorkspaceState {
  readonly selectedMapId?: string | null;
  readonly selectedCellIndex: number | null;
  readonly activeTool: BackgroundTool;
  readonly selectedTileKey: string | null;
  readonly selectedPaletteIndex: number;
  readonly zoom: number;
  readonly showGrid: boolean;
  readonly showAttributeOverlay: boolean;
}

export interface ChrWorkspaceState {
  readonly zoom: number;
  readonly selectedTileIndex: number | null;
  readonly previewPalette?: string;
  readonly highlightScope?: ChrHighlightScope;
  readonly highlightedAssetId?: string | null;
  readonly selectedAnimationId?: string | null;
  readonly selectedFrameIndex?: number | null;
  readonly selectedEntity?: string | null;
  readonly heatmapEnabled?: boolean;
  readonly editorTool: ChrDrawingTool;
  readonly editorColorIndex: number;
  readonly editorShowGrid: boolean;
  readonly editorShiftWrap: boolean;
}

export interface PaletteWorkspaceState {
  readonly selectedPaletteId: string | null;
  readonly filter: PaletteLibraryFilter;
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
  readonly background: BackgroundWorkspaceState;
  readonly palette: PaletteWorkspaceState;
  readonly chr: ChrWorkspaceState;
}

export type RelatedResourceNavigation =
  | {
      readonly workspace: 'animation';
      readonly animationId: string;
      readonly frameIndex: number;
    }
  | { readonly workspace: 'palette'; readonly paletteId: string }
  | {
      readonly workspace: 'chr';
      readonly animationId: string;
      readonly frameIndex: number;
      readonly entity: string;
      readonly physicalTileIndex: number | null;
      readonly assetId: string | null;
    };

/** Selects an existing related workspace using transient navigation state. */
export function navigateToRelatedResource(
  workspace: WorkspaceState,
  target: RelatedResourceNavigation,
): WorkspaceState {
  if (target.workspace === 'animation') {
    return {
      ...workspace,
      activeWorkspace: 'animation',
      animation: {
        ...workspace.animation,
        selectedAnimationId: target.animationId,
        selectedFrameIndex: target.frameIndex,
        activeTab: 'frames',
      },
    };
  }
  if (target.workspace === 'palette') {
    return {
      ...workspace,
      activeWorkspace: 'palette',
      palette: { ...workspace.palette, selectedPaletteId: target.paletteId },
    };
  }
  return {
    ...workspace,
    activeWorkspace: 'chr',
    chr: {
      ...workspace.chr,
      selectedTileIndex: target.physicalTileIndex,
      selectedAnimationId: target.animationId,
      selectedFrameIndex: target.frameIndex,
      selectedEntity: target.entity,
      highlightedAssetId: target.assetId,
      highlightScope: 'frame',
    },
  };
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
    background: {
      selectedMapId: null,
      selectedCellIndex: null,
      activeTool: 'pencil',
      selectedTileKey: null,
      selectedPaletteIndex: 0,
      zoom: 2,
      showGrid: true,
      showAttributeOverlay: true,
    },
    palette: {
      selectedPaletteId: null,
      filter: 'all',
    },
    chr: {
      zoom: 2,
      selectedTileIndex: null,
      previewPalette: 'grayscale',
      highlightScope: 'none',
      highlightedAssetId: null,
      selectedAnimationId: null,
      selectedFrameIndex: 0,
      selectedEntity: null,
      heatmapEnabled: false,
      editorTool: 'pencil',
      editorColorIndex: 1,
      editorShowGrid: true,
      editorShiftWrap: false,
    },
  };
}

export function createDerivedStatus(
  error: DisplayError | null = null,
): DerivedStatus {
  return { error, loading: false };
}
