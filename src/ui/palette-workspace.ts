import {
  encodeNesBackgroundPalettes,
  type NesPaletteSet,
} from '../core/nes-palette';
import {
  findPaletteUsageReferences,
  type PaletteDefinition,
} from '../core/palette-manager';
import { t } from '../i18n';
import { createPaletteManagerPanel } from './palette-manager-panel';
import type { AnimationItemSetting, DisplayError } from './types';

export interface PaletteWorkspaceOptions {
  readonly palettes: readonly PaletteDefinition[];
  readonly activeSpritePaletteSlots: readonly (string | null)[];
  readonly animations: readonly AnimationItemSetting[];
  readonly paletteSet: NesPaletteSet;
  readonly loading?: boolean;
  readonly error?: DisplayError | null;
  readonly onCreatePalette: (name?: string) => void;
  readonly onUpdatePaletteName: (paletteId: string, name: string) => void;
  readonly onUpdatePaletteColor: (
    paletteId: string,
    colorSlotIndex: number,
    colorCode: number,
  ) => void;
  readonly onDuplicatePalette: (paletteId: string) => void;
  readonly onDeletePalette: (paletteId: string) => void;
  readonly onUpdateActiveSlot: (
    slotIndex: 0 | 1 | 2 | 3,
    paletteId: string | null,
  ) => void;
  readonly onDownloadBytes?: (bytes: Uint8Array, fileName: string) => void;
}

export type PaletteWorkspaceElement = HTMLElement & {
  readonly diagnosticsElement: HTMLElement | null;
};

export function createPaletteWorkspace(
  options: PaletteWorkspaceOptions,
): PaletteWorkspaceElement {
  const workspace = document.createElement('div');
  workspace.className = 'workspace palette-workspace';

  let diagnostics: HTMLElement | null = null;
  if (options.error !== null && options.error !== undefined) {
    const errorSection = document.createElement('section');
    errorSection.className = 'panel error-panel palette-error-panel';
    const heading = document.createElement('h2');
    heading.textContent = t('errorTitle');
    const message = document.createElement('p');
    message.textContent = t(options.error.key, options.error.variables);
    errorSection.append(heading, message);
    diagnostics = errorSection;
  }

  // 1. Palettes Manager Panel (includes Header, Active Slots, and Palette Definitions)
  const managerPanel = createPaletteManagerPanel({
    palettes: options.palettes,
    activeSpritePaletteSlots: options.activeSpritePaletteSlots,
    animations: options.animations,
    onCreatePalette: options.onCreatePalette,
    onUpdatePaletteName: options.onUpdatePaletteName,
    onUpdatePaletteColor: options.onUpdatePaletteColor,
    onDuplicatePalette: options.onDuplicatePalette,
    onDeletePalette: options.onDeletePalette,
    onUpdateActiveSlot: options.onUpdateActiveSlot,
  });
  managerPanel.id = 'section-palettes-intro';

  // Mark internal sections with anchors for navigation
  const slotsSection = managerPanel.querySelector('.active-slots-section');
  if (slotsSection) {
    slotsSection.id = 'section-active-slots';
  }
  const definitionsSection = managerPanel.querySelector(
    '.palette-definitions-section',
  );
  if (definitionsSection) {
    definitionsSection.id = 'section-palette-definitions';
  }

  // 2. Export / Statistics Panel
  const exportSection = document.createElement('section');
  exportSection.className = 'panel palette-export-panel';
  exportSection.id = 'section-palette-export';

  const exportHeader = document.createElement('div');
  exportHeader.className = 'palette-export-header';
  const exportTitle = document.createElement('h3');
  exportTitle.textContent = t('paletteWorkspaceExportTitle');
  const exportHint = document.createElement('p');
  exportHint.className = 'muted';
  exportHint.textContent = t('paletteWorkspaceExportHint');
  exportHeader.append(exportTitle, exportHint);

  let totalReferences = 0;
  options.palettes.forEach((palette) => {
    const refs = findPaletteUsageReferences(
      palette.id,
      options.animations,
      options.activeSpritePaletteSlots,
    );
    totalReferences += refs.length;
  });

  const activeCount = options.activeSpritePaletteSlots.filter(
    (slot): slot is string => typeof slot === 'string' && slot.trim() !== '',
  ).length;

  const statsText = document.createElement('p');
  statsText.className = 'palette-export-stats';
  statsText.textContent = t('paletteWorkspaceStats', {
    count: options.palettes.length,
    active: activeCount,
    references: totalReferences,
  });

  const exportActions = document.createElement('div');
  exportActions.className = 'export-actions';

  if (options.onDownloadBytes) {
    const onDownload = options.onDownloadBytes;
    const downloadPalBtn = document.createElement('button');
    downloadPalBtn.type = 'button';
    downloadPalBtn.className = 'button secondary-button';
    downloadPalBtn.textContent = t('paletteWorkspaceDownloadPal');
    downloadPalBtn.addEventListener('click', () => {
      onDownload(
        encodeNesBackgroundPalettes(options.paletteSet),
        'project.pal',
      );
    });
    exportActions.append(downloadPalBtn);
  }

  exportSection.append(exportHeader, statsText, exportActions);

  workspace.append(managerPanel, exportSection);

  const result = workspace as unknown as PaletteWorkspaceElement;
  Object.defineProperty(result, 'diagnosticsElement', {
    value: diagnostics,
    enumerable: true,
  });
  return result;
}
