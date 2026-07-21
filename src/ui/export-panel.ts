import { t } from '../i18n';

interface ExportPanelOptions {
  readonly chrName: string;
  readonly nametableName: string;
  readonly attributeTableName: string;
  readonly tileCount: number;
  readonly originalTileCount: number;
  readonly deduplicationEnabled: boolean;
  readonly playfieldMode: boolean;
  readonly chr: Uint8Array | null;
  readonly nametable: Uint8Array | null;
  readonly attributeTable: Uint8Array | null;
  readonly onDownload: (bytes: Uint8Array, fileName: string) => void;
}

function downloadButton(
  label: string,
  bytes: Uint8Array | null,
  fileName: string,
  onDownload: (bytes: Uint8Array, fileName: string) => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button primary-button';
  button.disabled = bytes === null;
  button.textContent = label;
  button.addEventListener('click', () => {
    if (bytes !== null) {
      onDownload(bytes, fileName);
    }
  });
  return button;
}

export function createExportPanel(options: ExportPanelOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel export-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('exportTitle');
  const description = document.createElement('p');

  if (options.chr === null) {
    description.textContent = t('exportUnavailable');
  } else if (options.playfieldMode && options.nametable === null) {
    description.textContent = t('playfieldExportIncomplete');
  } else if (options.playfieldMode) {
    description.textContent = t('playfieldExportReady', {
      count: options.tileCount,
    });
  } else {
    description.textContent = options.deduplicationEnabled
      ? t('exportReadyDeduplicated', {
          count: options.tileCount,
          total: options.originalTileCount,
        })
      : t('exportReady', { count: options.tileCount });
  }

  const actions = document.createElement('div');
  actions.className = 'export-actions';
  actions.append(
    downloadButton(
      t('downloadChr', { name: options.chrName }),
      options.chr,
      options.chrName,
      options.onDownload,
    ),
  );

  if (options.playfieldMode) {
    actions.append(
      downloadButton(
        t('downloadNametable', { name: options.nametableName }),
        options.nametable,
        options.nametableName,
        options.onDownload,
      ),
      downloadButton(
        t('downloadAttributeTable', { name: options.attributeTableName }),
        options.attributeTable,
        options.attributeTableName,
        options.onDownload,
      ),
    );
    const note = document.createElement('small');
    note.textContent = t('attributeTablePaletteNote');
    section.append(heading, description, actions, note);
  } else {
    section.append(heading, description, actions);
  }

  return section;
}
