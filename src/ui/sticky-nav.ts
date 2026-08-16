import {
  QUANTIZATION_MODES,
  type QuantizationMode,
} from '../core/quantization-settings';
import { t, type TranslationKey } from '../i18n';
import type { ProjectMode } from './types';

interface StickyNavOptions {
  readonly mode: ProjectMode;
  readonly fileName: string | null;
  readonly quantizationMode: QuantizationMode;
  readonly onQuantizationModeChange: (mode: QuantizationMode) => void;
}

const QUANTIZATION_LABELS: Record<QuantizationMode, TranslationKey> = {
  nearest: 'quantizationNearest',
  'median-cut': 'quantizationMedianCut',
  'k-means': 'quantizationKMeans',
};

export function createStickyNav(options: StickyNavOptions): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'sticky-nav';
  nav.setAttribute('aria-label', t('navigationLabel'));

  const sections = document.createElement('div');
  sections.className = 'sticky-nav-sections';

  const links: readonly (readonly [string, string])[] =
    options.mode === 'animation'
      ? [
          ['#section-quantization', t('navigationImage')],
          ['#section-asset', t('navigationAsset')],
          ['#section-palettes', t('navigationPalettes')],
          ['#section-animations', t('navigationAnimations')],
          ['#section-mapping', t('navigationMapping')],
          ['#section-export', t('navigationExport')],
        ]
      : [
          ['#section-image', t('navigationImage')],
          ['#section-palettes', t('navigationPalettes')],
          ['#section-tiles', t('navigationTiles')],
          ['#section-export', t('navigationExport')],
        ];

  links.forEach(([href, label]) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.className = 'sticky-nav-link';
    anchor.textContent = label;
    sections.append(anchor);
  });

  const quick = document.createElement('div');
  quick.className = 'sticky-nav-quick';

  if (options.fileName !== null) {
    const file = document.createElement('span');
    file.className = 'sticky-nav-file';
    file.textContent = t('navigationImageValue', { name: options.fileName });
    file.title = options.fileName;
    quick.append(file);
  }

  const segmented = document.createElement('div');
  segmented.className = 'quantization-segmented';
  segmented.setAttribute('role', 'group');
  segmented.setAttribute('aria-label', t('quantizationModeLabel'));
  QUANTIZATION_MODES.forEach((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segmented-button';
    button.classList.toggle('is-active', options.quantizationMode === mode);
    button.setAttribute(
      'aria-pressed',
      String(options.quantizationMode === mode),
    );
    button.textContent = t(QUANTIZATION_LABELS[mode]);
    button.addEventListener('click', () => {
      options.onQuantizationModeChange(mode);
    });
    segmented.append(button);
  });
  quick.append(segmented);

  nav.append(sections, quick);
  return nav;
}