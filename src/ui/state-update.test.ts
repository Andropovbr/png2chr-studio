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
        collapsedAnimationIds: ['anim-id'],
      },
    }));

    expect(result.marksProjectDirty).toBe(false);
    expect(serializeProject(project)).toBe(serializedBefore);
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
});
