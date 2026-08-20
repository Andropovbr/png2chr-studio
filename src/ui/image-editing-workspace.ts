import type { ProjectMode } from './types';

interface MountablePanel {
  id: string;
}

export function mountImageEditingPanels<TPanel extends MountablePanel>(
  mode: ProjectMode,
  appendPanels: (imagePreview: TPanel, paletteEditor: TPanel) => void,
  imagePreview: TPanel,
  paletteEditor: TPanel,
): boolean {
  if (mode === 'animation') return false;

  paletteEditor.id = 'section-palettes';
  appendPanels(imagePreview, paletteEditor);
  return true;
}
