import {
  DEFAULT_QUANTIZATION_SETTINGS,
  DITHERING_MODES,
  QUANTIZATION_MODES,
  type DitheringMode,
  type QuantizationMode,
  type QuantizationSettings,
} from '../core/quantization-settings';
import { COLOR_DISTANCE_MODES } from '../core/color-distance';
import { t, type TranslationKey } from '../i18n';
import { createCollapsiblePanel } from './collapsible';

export interface QuantizationPreview {
  readonly mode: QuantizationMode;
  readonly image: ImageData;
}

interface QuantizationPanelOptions {
  readonly sourceImage: ImageData | null;
  readonly pngActive: boolean;
  readonly settings: QuantizationSettings;
  readonly previews: readonly QuantizationPreview[];
  readonly previewsLoading: boolean;
  readonly isCollapsed?: boolean;
  readonly onToggleCollapse?: () => void;
  readonly onSettingsChange: (settings: QuantizationSettings) => void;
}

const QUANTIZATION_LABELS: Record<QuantizationMode, TranslationKey> = {
  nearest: 'quantizationNearest',
  'median-cut': 'quantizationMedianCut',
  'k-means': 'quantizationKMeans',
};

const QUANTIZATION_HINTS: Record<QuantizationMode, TranslationKey> = {
  nearest: 'quantizationNearestHint',
  'median-cut': 'quantizationMedianCutHint',
  'k-means': 'quantizationKMeansHint',
};

const DITHERING_LABELS: Record<DitheringMode, TranslationKey> = {
  none: 'ditheringNone',
  'floyd-steinberg': 'ditheringFloydSteinberg',
  atkinson: 'ditheringAtkinson',
  'bayer-4x4': 'ditheringBayer4',
  'bayer-8x8': 'ditheringBayer8',
};

function createSelect<T extends string>(
  choices: readonly T[],
  selected: T,
  labels: Record<T, TranslationKey>,
  onChange: (value: T) => void,
): HTMLSelectElement {
  const select = document.createElement('select');
  choices.forEach((choice) => {
    const option = document.createElement('option');
    option.value = choice;
    option.selected = choice === selected;
    option.textContent = t(labels[choice]);
    select.append(option);
  });
  select.addEventListener('change', () => {
    onChange(select.value as T);
  });
  return select;
}

function previewCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context?.putImageData(image, 0, 0);
  return canvas;
}

function comparisonCard(
  label: string,
  image: ImageData,
  active: boolean,
  onSelect?: () => void,
): HTMLElement {
  const card = document.createElement(
    onSelect === undefined ? 'div' : 'button',
  );
  card.className = 'quantization-preview-card';
  card.classList.toggle('is-active', active);
  if (card instanceof HTMLButtonElement) {
    card.type = 'button';
    card.setAttribute('aria-pressed', String(active));
    const select = onSelect;
    if (select !== undefined) {
      card.addEventListener('click', select);
    }
  }
  const title = document.createElement('strong');
  title.textContent = label;
  card.append(title, previewCanvas(image));
  return card;
}

export function createQuantizationPanel(
  options: QuantizationPanelOptions,
): HTMLElement {
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('quantizationHint');

  if (!options.pngActive || options.sourceImage === null) {
    const section = document.createElement('section');
    section.className = 'panel quantization-panel';
    const heading = document.createElement('h2');
    heading.textContent = t('quantizationTitle');
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('quantizationEmpty');
    section.append(heading, empty);
    return section;
  }

  const summary = `${t(
    QUANTIZATION_LABELS[options.settings.quantizationMode],
  )} · ${t(DITHERING_LABELS[options.settings.ditheringMode])}`;

  const content = document.createElement('div');
  content.className = 'quantization-content';

  const controls = document.createElement('div');
  controls.className = 'quantization-controls';
  const quantizationField = document.createElement('label');
  quantizationField.className = 'quantization-field';
  const quantizationLabel = document.createElement('span');
  quantizationLabel.textContent = t('quantizationModeLabel');
  const quantizationSelect = createSelect(
    QUANTIZATION_MODES,
    options.settings.quantizationMode,
    QUANTIZATION_LABELS,
    (quantizationMode) => {
      options.onSettingsChange({ ...options.settings, quantizationMode });
    },
  );
  const modeHint = document.createElement('small');
  modeHint.textContent = t(
    QUANTIZATION_HINTS[options.settings.quantizationMode],
  );
  quantizationField.append(quantizationLabel, quantizationSelect, modeHint);

  const ditheringField = document.createElement('label');
  ditheringField.className = 'quantization-field';
  const ditheringLabel = document.createElement('span');
  ditheringLabel.textContent = t('ditheringModeLabel');
  const ditheringSelect = createSelect(
    DITHERING_MODES,
    options.settings.ditheringMode,
    DITHERING_LABELS,
    (ditheringMode) => {
      options.onSettingsChange({ ...options.settings, ditheringMode });
    },
  );
  const ditheringHint = document.createElement('small');
  ditheringHint.textContent = t('ditheringHint');
  ditheringField.append(ditheringLabel, ditheringSelect, ditheringHint);
  controls.append(quantizationField, ditheringField);

  const advanced = document.createElement('details');
  advanced.className = 'quantization-advanced';
  const advancedSummary = document.createElement('summary');
  advancedSummary.textContent = t('quantizationAdvanced');
  const distanceField = document.createElement('label');
  distanceField.className = 'quantization-field';
  const distanceLabel = document.createElement('span');
  distanceLabel.textContent = t('colorDistanceLabel');
  const distanceSelect = createSelect(
    COLOR_DISTANCE_MODES,
    options.settings.colorDistanceMode,
    { rgb: 'colorDistanceRgb', perceptual: 'colorDistancePerceptual' },
    (colorDistanceMode) => {
      options.onSettingsChange({ ...options.settings, colorDistanceMode });
    },
  );
  distanceField.append(distanceLabel, distanceSelect);
  advanced.append(advancedSummary, distanceField);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button secondary-button quantization-reset';
  reset.textContent = t('quantizationReset');
  reset.disabled =
    JSON.stringify(options.settings) ===
    JSON.stringify(DEFAULT_QUANTIZATION_SETTINGS);
  reset.addEventListener('click', () => {
    options.onSettingsChange(DEFAULT_QUANTIZATION_SETTINGS);
  });

  const comparisonTitle = document.createElement('h3');
  comparisonTitle.textContent = t('quantizationComparisonTitle');
  const comparisonHint = document.createElement('p');
  comparisonHint.className = 'muted';
  comparisonHint.textContent = t('quantizationComparisonHint');
  const comparison = document.createElement('div');
  comparison.className = 'quantization-preview-grid';
  comparison.append(
    comparisonCard(t('quantizationOriginal'), options.sourceImage, false),
  );
  options.previews.forEach((preview) => {
    comparison.append(
      comparisonCard(
        t(QUANTIZATION_LABELS[preview.mode]),
        preview.image,
        preview.mode === options.settings.quantizationMode,
        () => {
          options.onSettingsChange({
            ...options.settings,
            quantizationMode: preview.mode,
          });
        },
      ),
    );
  });
  if (options.previewsLoading) {
    const loading = document.createElement('p');
    loading.className = 'muted quantization-preview-loading';
    loading.textContent = t('quantizationPreviewLoading');
    comparison.append(loading);
  }
  content.append(
    controls,
    advanced,
    reset,
    comparisonTitle,
    comparisonHint,
    comparison,
  );

  const isCollapsed = options.isCollapsed ?? false;
  return createCollapsiblePanel({
    panelClassName: 'quantization-panel',
    title: t('quantizationTitle'),
    summary,
    isCollapsed,
    onToggle: options.onToggleCollapse ?? (() => undefined),
    children: [hint, content],
  });
}
