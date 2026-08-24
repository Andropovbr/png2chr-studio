import { describe, expect, it } from 'vitest';

import { createDefaultProject, serializeProject } from '../core/project';
import {
  applyDerivedStatusUpdate,
  applyProjectUpdate,
  applyWorkspaceUpdate,
} from './state-update';
import { createDerivedStatus, createWorkspaceState } from './workspace-state';

describe('application state update boundaries', () => {
  it('marks a changed persistable project update dirty', () => {
    const current: { mode: string; deduplicate: boolean } = {
      mode: 'tileset',
      deduplicate: false,
    };
    const result = applyProjectUpdate(current, (project) => ({
      ...project,
      deduplicate: true,
    }));

    expect(result.value.deduplicate).toBe(true);
    expect(result.marksProjectDirty).toBe(true);
  });

  it('does not mark an identity project update dirty', () => {
    const current = { mode: 'tileset' } as const;
    const result = applyProjectUpdate(current, (project) => project);

    expect(result.value).toBe(current);
    expect(result.marksProjectDirty).toBe(false);
  });

  it('never marks workspace-only updates dirty', () => {
    const current: { previewTool: string } = { previewTool: 'palette' };
    const result = applyWorkspaceUpdate(current, () => ({
      previewTool: 'paint-collision',
    }));

    expect(result.value.previewTool).toBe('paint-collision');
    expect(result.marksProjectDirty).toBe(false);
  });

  it('keeps workspace-only changes out of serialized project data', () => {
    const project = createDefaultProject('Workspace boundary', 'animation');
    const serializedBefore = serializeProject(project);
    const current = createWorkspaceState();

    const result = applyWorkspaceUpdate(current, (workspace) => ({
      ...workspace,
      previewTool: 'paint-collision' as const,
      quantizationCollapsed: true,
      animation: {
        ...workspace.animation,
        selectedAnimationId: 'anim-1',
        activeTab: 'pixels' as const,
        collapsedAnimationIds: ['anim-id'],
      },
    }));

    expect(result.marksProjectDirty).toBe(false);
    expect(result.value.animation.selectedAnimationId).toBe('anim-1');
    expect(result.value.animation.activeTab).toBe('pixels');
    expect(serializeProject(project)).toBe(serializedBefore);
  });

  it('never marks workspace navigation updates dirty', () => {
    const current = createWorkspaceState(0, 1, 'tileset');
    const result = applyWorkspaceUpdate(current, (ws) => ({
      ...ws,
      activeWorkspace: 'animation' as const,
    }));

    expect(result.value.activeWorkspace).toBe('animation');
    expect(result.marksProjectDirty).toBe(false);
  });

  it('preserves project data and serialization across workspace navigation', () => {
    const project = createDefaultProject('Preservation test', 'tileset');
    const serializedOriginal = serializeProject(project);

    let workspace = createWorkspaceState(0, 1, 'tileset');

    // Navigate to playfield
    const navPlayfield = applyWorkspaceUpdate(workspace, (ws) => ({
      ...ws,
      activeWorkspace: 'playfield' as const,
    }));
    workspace = navPlayfield.value;
    expect(navPlayfield.marksProjectDirty).toBe(false);
    expect(serializeProject(project)).toBe(serializedOriginal);

    // Navigate to animation
    const navAnimation = applyWorkspaceUpdate(workspace, (ws) => ({
      ...ws,
      activeWorkspace: 'animation' as const,
    }));
    workspace = navAnimation.value;
    expect(navAnimation.marksProjectDirty).toBe(false);
    expect(serializeProject(project)).toBe(serializedOriginal);
  });

  it('never marks derived loading or error updates dirty', () => {
    const current = createDerivedStatus();
    const result = applyDerivedStatusUpdate(current, (status) => ({
      ...status,
      loading: true,
    }));

    expect(result.value.loading).toBe(true);
    expect(result.marksProjectDirty).toBe(false);
  });

  it('never marks CHR zoom, tile selection, or preview palette updates dirty', () => {
    const project = createDefaultProject('CHR test', 'animation');
    const serializedOriginal = serializeProject(project);
    const workspace = createWorkspaceState();

    expect(workspace.chr.selectedTileIndex).toBeNull();
    expect(workspace.chr.zoom).toBe(2);
    expect(workspace.chr.previewPalette).toBe('grayscale');

    const selectTile = applyWorkspaceUpdate(workspace, (ws) => ({
      ...ws,
      chr: {
        ...ws.chr,
        selectedTileIndex: 42,
      },
    }));

    expect(selectTile.marksProjectDirty).toBe(false);
    expect(selectTile.value.chr.selectedTileIndex).toBe(42);
    expect(serializeProject(project)).toBe(serializedOriginal);

    const changePalette = applyWorkspaceUpdate(selectTile.value, (ws) => ({
      ...ws,
      chr: {
        ...ws.chr,
        previewPalette: 'bg-1',
      },
    }));

    expect(changePalette.marksProjectDirty).toBe(false);
    expect(changePalette.value.chr.previewPalette).toBe('bg-1');
    expect(serializeProject(project)).toBe(serializedOriginal);

    const deselectTile = applyWorkspaceUpdate(changePalette.value, (ws) => ({
      ...ws,
      chr: {
        ...ws.chr,
        selectedTileIndex: null,
      },
    }));

    expect(deselectTile.marksProjectDirty).toBe(false);
    expect(deselectTile.value.chr.selectedTileIndex).toBeNull();
    expect(serializeProject(project)).toBe(serializedOriginal);
  });
});
