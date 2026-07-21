import type { IndexedImage } from '../core/types';
import { t } from '../i18n';
import type { DisplayError } from './types';

interface DiagnosticsOptions {
  readonly width: number | null;
  readonly height: number | null;
  readonly indexedImage: IndexedImage | null;
  readonly tileCount: number;
  readonly chrSize: number | null;
  readonly playfieldMode: boolean;
  readonly nametableSize: number | null;
  readonly attributeTableSize: number | null;
  readonly error: DisplayError | null;
}

function metric(labelText: string, value: string): HTMLDivElement {
  const item = document.createElement('div');
  const label = document.createElement('dt');
  label.textContent = labelText;
  const result = document.createElement('dd');
  result.textContent = value;
  item.append(label, result);
  return item;
}

function colorToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export function createDiagnostics(options: DiagnosticsOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel diagnostics-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('diagnosticsTitle');

  const metrics = document.createElement('dl');
  metrics.className = 'metrics';
  const dimensions =
    options.width === null || options.height === null
      ? t('unavailableValue')
      : t('dimensionsValue', {
          width: options.width,
          height: options.height,
        });
  metrics.append(
    metric(t('dimensionsLabel'), dimensions),
    metric(
      t('colorCountLabel'),
      options.indexedImage === null
        ? (options.error?.variables?.count?.toString() ?? t('unavailableValue'))
        : options.indexedImage.colorCount.toString(),
    ),
    metric(t('tileCountLabel'), options.tileCount.toString()),
    metric(
      t('chrSizeLabel'),
      options.chrSize === null
        ? t('unavailableValue')
        : t('byteCount', { count: options.chrSize }),
    ),
  );
  if (options.playfieldMode) {
    metrics.append(
      metric(
        t('nametableSizeLabel'),
        options.nametableSize === null
          ? t('unavailableValue')
          : t('byteCount', { count: options.nametableSize }),
      ),
      metric(
        t('attributeTableSizeLabel'),
        options.attributeTableSize === null
          ? t('unavailableValue')
          : t('byteCount', { count: options.attributeTableSize }),
      ),
    );
  }
  section.append(heading, metrics);

  if (options.error !== null) {
    const alert = document.createElement('div');
    alert.className = 'error-message';
    alert.setAttribute('role', 'alert');
    const errorHeading = document.createElement('h3');
    errorHeading.textContent = t('errorTitle');
    const message = document.createElement('p');
    message.textContent = t(options.error.key, options.error.variables);
    alert.append(errorHeading, message);
    if (options.error.colors !== undefined) {
      const label = document.createElement('p');
      label.textContent = t('colorsFoundLabel');
      const colors = document.createElement('ul');
      colors.className = 'error-colors';
      options.error.colors.forEach((hex) => {
        const item = document.createElement('li');
        item.textContent = hex;
        colors.append(item);
      });
      alert.append(label, colors);
    }
    section.append(alert);
  }

  const mappingHeading = document.createElement('h3');
  mappingHeading.textContent = t('colorMappingTitle');
  const mapping = document.createElement('ol');
  mapping.className = 'color-mapping';
  for (let index = 0; index < 4; index += 1) {
    const item = document.createElement('li');
    const indexLabel = document.createElement('span');
    indexLabel.textContent = t('colorIndex', { index });
    const value = document.createElement('span');
    const color = options.indexedImage?.colors[index];
    if (options.indexedImage?.transparentIndex === index) {
      value.textContent = t('transparentColor');
      value.className = 'transparent-swatch';
    } else if (color === null || color === undefined) {
      value.textContent = t('unassignedColor');
      value.className = 'muted';
    } else {
      const hex = colorToHex(color.red, color.green, color.blue);
      const swatch = document.createElement('i');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = hex;
      value.append(swatch, hex);
    }
    item.append(indexLabel, value);
    mapping.append(item);
  }
  section.append(mappingHeading, mapping);
  return section;
}
