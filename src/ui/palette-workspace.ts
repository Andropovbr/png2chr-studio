import {
  exportBackgroundPaletteBinary,
  exportFullPpuPaletteBinary,
  exportSpritePaletteBinary,
  generateCa65PaletteExport,
  generateCPaletteExport,
} from '../core/palette-exporters';
import {
  findPaletteUsageReferences,
  type ActivePaletteSlots,
  type DualBankPaletteState,
  type PaletteDefinition,
  type PaletteDiagnosticFact,
  type PaletteTarget,
  type PaletteUsageSearchContext,
} from '../core/palette-manager';
import { t } from '../i18n';
import {
  createPaletteManagerPanel,
  type PaletteLibraryFilter,
} from './palette-manager-panel';
import type { DisplayError } from './types';

export interface PaletteWorkspaceOptions {
  readonly palettes: readonly PaletteDefinition[];
  readonly universalBackgroundColor: number;
  readonly activeBackgroundSlots: ActivePaletteSlots;
  readonly activeSpriteSlots: ActivePaletteSlots;
  readonly usageContext: PaletteUsageSearchContext;
  readonly diagnostics: readonly PaletteDiagnosticFact[];
  readonly selectedPaletteId: string | null;
  readonly filter: PaletteLibraryFilter;
  readonly loading?: boolean;
  readonly error?: DisplayError | null;
  readonly onCreatePalette: (name?: string) => void;
  readonly onUpdatePaletteName: (paletteId: string, name: string) => void;
  readonly onUpdatePaletteColor: (
    paletteId: string,
    colorSlotIndex: number,
    colorCode: number,
  ) => void;
  readonly onUpdatePaletteTarget: (
    paletteId: string,
    target: PaletteTarget,
  ) => void;
  readonly onUpdateUniversalBackgroundColor: (colorCode: number) => void;
  readonly onDuplicatePalette: (paletteId: string) => void;
  readonly onDeletePalette: (paletteId: string) => void;
  readonly onAssignBackgroundSlot: (
    slotIndex: 0 | 1 | 2 | 3,
    paletteId: string | null,
  ) => void;
  readonly onAssignSpriteSlot: (
    slotIndex: 0 | 1 | 2 | 3,
    paletteId: string | null,
  ) => void;
  readonly onSelectPalette: (paletteId: string | null) => void;
  readonly onFilterChange: (filter: PaletteLibraryFilter) => void;
  readonly onDownloadBytes?: (bytes: Uint8Array, fileName: string) => void;
  readonly onDownloadText?: (text: string, fileName: string) => void;
}

export type PaletteWorkspaceElement = HTMLElement & {
  readonly diagnosticsElement: HTMLElement | null;
};

export function createPaletteWorkspace(
  options: PaletteWorkspaceOptions,
): PaletteWorkspaceElement {
  const workspace = document.createElement('div');
  workspace.className = 'workspace palette-workspace';

  let diagnosticsElement: HTMLElement | null = null;
  if (options.error !== null && options.error !== undefined) {
    const errorSection = document.createElement('section');
    errorSection.className = 'panel error-panel palette-error-panel';
    const heading = document.createElement('h2');
    heading.textContent = t('errorTitle');
    const message = document.createElement('p');
    message.textContent = t(options.error.key, options.error.variables);
    errorSection.append(heading, message);
    diagnosticsElement = errorSection;
  }

  const managerPanel = createPaletteManagerPanel({
    palettes: options.palettes,
    universalBackgroundColor: options.universalBackgroundColor,
    activeBackgroundSlots: options.activeBackgroundSlots,
    activeSpriteSlots: options.activeSpriteSlots,
    usageContext: options.usageContext,
    diagnostics: options.diagnostics,
    selectedPaletteId: options.selectedPaletteId,
    filter: options.filter,
    onCreatePalette: options.onCreatePalette,
    onUpdatePaletteName: options.onUpdatePaletteName,
    onUpdatePaletteColor: options.onUpdatePaletteColor,
    onUpdatePaletteTarget: options.onUpdatePaletteTarget,
    onUpdateUniversalBackgroundColor: options.onUpdateUniversalBackgroundColor,
    onDuplicatePalette: options.onDuplicatePalette,
    onDeletePalette: options.onDeletePalette,
    onAssignBackgroundSlot: options.onAssignBackgroundSlot,
    onAssignSpriteSlot: options.onAssignSpriteSlot,
    onSelectPalette: options.onSelectPalette,
    onFilterChange: options.onFilterChange,
  });
  managerPanel.id = 'section-palettes-intro';

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
  for (const palette of options.palettes) {
    totalReferences += findPaletteUsageReferences(
      palette.id,
      options.usageContext,
    ).length;
  }
  const activeCount = [
    ...options.activeBackgroundSlots,
    ...options.activeSpriteSlots,
  ].filter((slot): slot is string => slot !== null).length;
  const statsText = document.createElement('p');
  statsText.className = 'palette-export-stats';
  statsText.textContent = t('paletteWorkspaceStats', {
    count: options.palettes.length,
    active: activeCount,
    references: totalReferences,
  });

  const exportActions = document.createElement('div');
  exportActions.className = 'export-actions';
  const paletteState: DualBankPaletteState = {
    palettes: options.palettes,
    universalBackgroundColor: options.universalBackgroundColor,
    activeBackgroundSlots: options.activeBackgroundSlots,
    activeSpriteSlots: options.activeSpriteSlots,
  };
  const cExport = generateCPaletteExport(paletteState, {
    symbolBase: 'project_palette',
  });
  const asmExport = generateCa65PaletteExport(paletteState, {
    symbolBase: 'project_palette',
  });
  const createExportButton = (
    exportId: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary-button';
    button.setAttribute('data-palette-export', exportId);
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  };
  if (options.onDownloadBytes) {
    exportActions.append(
      createExportButton(
        'background-pal',
        t('paletteWorkspaceDownloadBackgroundPal'),
        () => {
          options.onDownloadBytes?.(
            exportBackgroundPaletteBinary(paletteState),
            'project.pal',
          );
        },
      ),
      createExportButton(
        'sprite-pal',
        t('paletteWorkspaceDownloadSpritePal'),
        () => {
          options.onDownloadBytes?.(
            exportSpritePaletteBinary(paletteState),
            'project_sprites.pal',
          );
        },
      ),
      createExportButton(
        'full-pal',
        t('paletteWorkspaceDownloadFullPal'),
        () => {
          options.onDownloadBytes?.(
            exportFullPpuPaletteBinary(paletteState),
            'project_ppu.pal',
          );
        },
      ),
    );
  }
  if (options.onDownloadText) {
    exportActions.append(
      createExportButton(
        'c-header',
        t('paletteWorkspaceDownloadCHeader'),
        () => {
          options.onDownloadText?.(cExport.header, cExport.headerFileName);
        },
      ),
      createExportButton(
        'c-source',
        t('paletteWorkspaceDownloadCSource'),
        () => {
          options.onDownloadText?.(cExport.source, cExport.sourceFileName);
        },
      ),
      createExportButton(
        'asm-include',
        t('paletteWorkspaceDownloadAsmInclude'),
        () => {
          options.onDownloadText?.(
            asmExport.include,
            asmExport.includeFileName,
          );
        },
      ),
      createExportButton(
        'asm-source',
        t('paletteWorkspaceDownloadAsmSource'),
        () => {
          options.onDownloadText?.(asmExport.source, asmExport.sourceFileName);
        },
      ),
    );
  }
  exportSection.append(exportHeader, statsText, exportActions);
  workspace.append(managerPanel, exportSection);

  return Object.assign(workspace, { diagnosticsElement });
}
