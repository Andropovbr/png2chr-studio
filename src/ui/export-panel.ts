import { t } from '../i18n';

export function createExportPanel(
  outputName: string,
  tileCount: number,
  originalTileCount: number,
  deduplicationEnabled: boolean,
  enabled: boolean,
  onDownload: () => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel export-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('exportTitle');
  const description = document.createElement('p');
  description.textContent = enabled
    ? deduplicationEnabled
      ? t('exportReadyDeduplicated', {
          count: tileCount,
          total: originalTileCount,
        })
      : t('exportReady', { count: tileCount })
    : t('exportUnavailable');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button primary-button';
  button.disabled = !enabled;
  button.textContent = t('downloadChr', { name: outputName });
  button.addEventListener('click', onDownload);
  section.append(heading, description, button);
  return section;
}
