import { describe, expect, it, vi } from 'vitest';

import { mountImageEditingPanels } from './image-editing-workspace';

interface TestPanel {
  id: string;
  onPixelOverridesChange?: () => void;
}

describe('image editing workspace composition', () => {
  it.each(['tileset', 'playfield'] as const)(
    'mounts the existing Palette Editor in %s mode with its navigation id',
    (mode) => {
      const mountedPanels: TestPanel[] = [];
      const onPixelOverridesChange = vi.fn();
      const imagePreview: TestPanel = { id: '' };
      const paletteEditor: TestPanel = {
        id: '',
        onPixelOverridesChange,
      };

      const mounted = mountImageEditingPanels(
        mode,
        (...panels) => mountedPanels.push(...panels),
        imagePreview,
        paletteEditor,
      );

      expect(mounted).toBe(true);
      expect(mountedPanels).toEqual([imagePreview, paletteEditor]);
      expect(mountedPanels[1]).toBe(paletteEditor);
      expect(paletteEditor.id).toBe('section-palettes');

      mountedPanels[1]?.onPixelOverridesChange?.();
      expect(onPixelOverridesChange).toHaveBeenCalledOnce();
    },
  );

  it('does not change Animation mode composition', () => {
    const mountedPanels: TestPanel[] = [];
    const paletteEditor: TestPanel = { id: '' };

    const mounted = mountImageEditingPanels(
      'animation',
      (...panels) => mountedPanels.push(...panels),
      { id: '' },
      paletteEditor,
    );

    expect(mounted).toBe(false);
    expect(mountedPanels).toEqual([]);
    expect(paletteEditor.id).toBe('');
  });
});
