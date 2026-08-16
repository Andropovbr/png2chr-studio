import {
  generateCAnimationExport,
  generateCa65AnimationExport,
  serializeAnimationMetadata,
} from '../core/animation-exporters';
import { normalizeCIdentifier } from '../core/c-identifier';
import { padChrRom } from '../core/chr-rom';
import type {
  AnimationModelError,
  AnimationPlayback,
  AnimationProjectModel,
  MetaspriteTile,
} from '../core/animation-model';
import { renderAnimationToRawImageData } from '../core/animation-palette';
import type { ColorDistanceMode } from '../core/color-distance';
import {
  encodeNesBackgroundPalettes,
  NES_MASTER_PALETTE,
  type NesPaletteSet,
} from '../core/nes-palette';
import { analyzeImage, imageHasTransparency } from '../core/image-analysis';
import { quantizeImageToNes } from '../core/image-quantization';
import {
  QUANTIZATION_MODES,
  type QuantizationMode,
} from '../core/quantization-settings';
import type { RawImageData } from '../core/types';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { AnimationItemSetting, AnimationSettings } from './types';
import { createCollapsiblePanel } from './collapsible';

const QUANTIZATION_LABELS: Record<QuantizationMode, TranslationKey> = {
  nearest: 'quantizationNearest',
  'median-cut': 'quantizationMedianCut',
  'k-means': 'quantizationKMeans',
};

export interface AnimationEditorOptions {
  readonly settings: AnimationSettings;
  readonly model: AnimationProjectModel | null;
  readonly modelError: AnimationModelError | null;
  readonly paletteSet: NesPaletteSet;
  readonly colorDistanceMode?: ColorDistanceMode;
  readonly onSettingsChange: (settings: AnimationSettings) => void;
  readonly onGlobalQuantizationModeChange: (mode: QuantizationMode) => void;
  readonly onDefaultPaletteIndexChange: (index: number) => void;
  readonly onAddAnimation: () => void;
  readonly onDuplicateAnimation: (animationId: string) => void;
  readonly onRemoveAnimation: (animationId: string) => void;
  readonly onToggleAnimationCollapse: (animationId: string) => void;
  readonly onToggleMappingCollapse: () => void;
  readonly onToggleConfigCollapse: () => void;
  readonly onTogglePaletteCollapse: () => void;
  readonly onToggleQuantizationCollapse: () => void;
  readonly onUpdateAnimation: (
    animationId: string,
    patch: Partial<AnimationItemSetting>,
  ) => void;
  readonly onAnimationSourceFile: (animationId: string, file: File) => void;
  readonly onFrameToggle: (animationId: string, frameIndex: number) => void;
  readonly onFrameMove: (
    animationId: string,
    frameIndex: number,
    direction: -1 | 1,
  ) => void;
  readonly onFrameDurationChange: (
    animationId: string,
    frameIndex: number,
    duration: number,
  ) => void;
  readonly onFramePaletteChange: (
    animationId: string,
    frameOrderIndex: number,
    paletteIndex: number | null,
  ) => void;
  readonly onApplyDefaultDurationToAll: (animationId: string) => void;
  readonly onFrameRemoveFromAnimation: (
    animationId: string,
    frameIndex: number,
  ) => void;
  readonly onSpritePaletteSelectionChange: (
    paletteIndex: number,
    colorIndex: number,
  ) => void;
  readonly onPaletteColorChange: (
    paletteIndex: number,
    colorIndex: number,
    colorCode: number,
  ) => void;
  readonly onDestinationFile: (file: File) => void;
  readonly onDestinationClear: () => void;
  readonly onDownloadBytes: (bytes: Uint8Array, fileName: string) => void;
  readonly onDownloadText: (text: string, fileName: string) => void;
}

function numberInput(
  labelText: string,
  value: number,
  min: number,
  max: number,
  onChange: (value: number) => void,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'animation-field';
  const text = document.createElement('span');
  text.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  let committedValue = value;
  const commit = (): void => {
    const nextValue = Number(input.value);
    if (nextValue === committedValue) return;
    committedValue = nextValue;
    onChange(nextValue);
  };
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  label.append(text, input);
  return label;
}

function errorTranslation(error: AnimationModelError | null): TranslationKey {
  switch (error?.code) {
    case 'no-selected-frames':
    case 'invalid-frame-selection':
    case 'duplicate-frame-selection':
      return 'animationErrorNoFrames';
    case 'invalid-frame-dimensions':
      return 'animationErrorFrameDimensions';
    case 'invalid-frame-grid':
      return 'animationErrorFrameGrid';
    case 'invalid-name':
      return 'animationErrorName';
    case 'duplicate-animation-name':
      return 'animationErrorDuplicateName';
    case 'duplicate-animation-identifier':
      return 'animationErrorDuplicateIdentifier';
    case 'invalid-playback':
      return 'animationErrorInvalidPlayback';
    case 'invalid-symbol-prefix':
      return 'animationErrorSymbolPrefix';
    case 'invalid-frame-duration':
      return 'animationErrorDuration';
    case 'invalid-origin':
      return 'animationErrorOrigin';
    case 'invalid-destination-chr':
    case 'destination-capacity-overflow':
      return 'animationErrorDestination';
    case 'chr-capacity-overflow':
    case 'pattern-table-capacity-overflow':
    case 'tile-index-overflow':
      return 'animationErrorCapacity';
    default:
      return 'animationErrorGeneric';
  }
}

function cropCanvas(
  image: RawImageData | ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.imageRendering = 'pixelated';
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.imageSmoothingEnabled = false;
    const imgData =
      typeof ImageData !== 'undefined' && image instanceof ImageData
        ? image
        : new ImageData(
            new Uint8ClampedArray(image.data),
            image.width,
            image.height,
          );
    context.putImageData(imgData, -x, -y);
  }
  return canvas;
}

function hexadecimal(value: number): string {
  return `$${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function paletteCssColor(colorCode: number): string {
  const color = NES_MASTER_PALETTE[colorCode] ?? {
    red: 0,
    green: 0,
    blue: 0,
  };
  return `rgb(${String(color.red)} ${String(color.green)} ${String(color.blue)})`;
}

function createAnimationQuantizationPanel(
  options: AnimationEditorOptions,
): HTMLElement {
  const animationsWithSource = options.settings.animations.filter(
    (a) => a.source !== null,
  );

  if (animationsWithSource.length === 0) {
    const section = document.createElement('section');
    section.className = 'panel animation-quantization-panel';
    const heading = document.createElement('h2');
    heading.textContent = t('animationColorReductionTitle');
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'muted empty-message';
    emptyMsg.textContent = t('animationReductionNoSources');
    section.append(heading, emptyMsg);
    return section;
  }

  const content = document.createElement('div');
  content.className = 'animation-quantization-content';

  // Reference image selector
  const refContainer = document.createElement('div');
  refContainer.className = 'animation-reduction-ref-container';
  const refLabel = document.createElement('label');
  refLabel.className = 'animation-field';
  const refLabelText = document.createElement('span');
  refLabelText.textContent = t('animationReductionReferenceLabel');
  const refSelect = document.createElement('select');

  const defaultRefId = animationsWithSource[0]?.id ?? '';
  let activeRefId = defaultRefId;

  animationsWithSource.forEach((anim) => {
    const opt = document.createElement('option');
    opt.value = anim.id;
    opt.textContent = `${anim.name} — ${anim.source?.fileName ?? ''}`;
    refSelect.append(opt);
  });
  refSelect.value = activeRefId;

  refLabel.append(refLabelText, refSelect);
  refContainer.append(refLabel);
  content.append(refContainer);

  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'animation-reduction-cards';

  const renderCards = (refAnimId: string): void => {
    cardsContainer.replaceChildren();
    const targetAnim =
      animationsWithSource.find((a) => a.id === refAnimId) ??
      animationsWithSource[0];
    if (!targetAnim?.source) return;
    const targetSource = targetAnim.source;

    const activePaletteIndex =
      targetAnim.paletteIndex ?? options.settings.defaultPaletteIndex;

    QUANTIZATION_MODES.forEach((mode) => {
      const active = options.settings.quantizationMode === mode;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'quantization-preview-card animation-reduction-card';
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-pressed', String(active));

      const cardTitle = document.createElement('strong');
      cardTitle.textContent = t(QUANTIZATION_LABELS[mode]);

      const reduced = quantizeImageToNes(
        targetSource.sourceImage,
        NES_MASTER_PALETTE,
        imageHasTransparency(targetSource.sourceImage) ? 3 : 4,
        {
          quantizationMode: mode,
          ditheringMode: options.settings.ditheringMode,
          colorDistanceMode: options.colorDistanceMode ?? 'perceptual',
        },
      );
      const reducedIndexed = analyzeImage(reduced.image);
      const nesRaw = renderAnimationToRawImageData(
        reducedIndexed,
        options.paletteSet,
        activePaletteIndex,
      );
      const canvas = cropCanvas(nesRaw, 0, 0, nesRaw.width, nesRaw.height);
      canvas.className = 'animation-reduction-preview-canvas';

      card.append(cardTitle, canvas);
      card.addEventListener('click', () => {
        options.onGlobalQuantizationModeChange(mode);
      });
      cardsContainer.append(card);
    });
  };

  refSelect.addEventListener('change', () => {
    activeRefId = refSelect.value;
    renderCards(activeRefId);
  });

  renderCards(activeRefId);
  content.append(cardsContainer);

  const selectedLabel = t(
    QUANTIZATION_LABELS[options.settings.quantizationMode],
  );
  const status = document.createElement('p');
  status.className = 'animation-reduction-selected-label muted';
  status.textContent = t('animationColorReductionSelected', {
    mode: selectedLabel,
  });
  content.append(status);

  return createCollapsiblePanel({
    panelClassName: 'animation-quantization-panel',
    title: t('animationColorReductionTitle'),
    summary: selectedLabel,
    isCollapsed: options.settings.quantizationCollapsed ?? false,
    onToggle: options.onToggleQuantizationCollapse,
    children: [content],
  });
}

function createSpriteMasterPaletteDialog(
  options: AnimationEditorOptions,
): { dialog: HTMLDialogElement; openFor: (paletteIndex: number, colorIndex: number) => void } {
  const dialog = document.createElement('dialog');
  dialog.className = 'nes-master-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'nes-master-palette animation-sprite-master-palette';
  const legend = document.createElement('legend');
  legend.textContent = t('nesMasterPaletteTitle');
  const target = document.createElement('p');
  target.className = 'nes-color-target';
  const grid = document.createElement('div');
  grid.className = 'nes-color-grid';
  const closeButton = document.createElement('button');
  closeButton.type = 'submit';
  closeButton.className = 'button secondary-button';
  closeButton.textContent = t('nesMasterPaletteClose');

  const openFor = (paletteIndex: number, colorIndex: number): void => {
    const targetCode =
      options.paletteSet[paletteIndex]?.[colorIndex] ?? 0x0f;
    target.textContent = t('nesColorEditTarget', {
      palette: paletteIndex,
      color: colorIndex,
      code: hexadecimal(targetCode),
    });
    grid.replaceChildren();
    NES_MASTER_PALETTE.forEach((_color, colorCode) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nes-color-button';
      button.style.backgroundColor = paletteCssColor(colorCode);
      button.title = hexadecimal(colorCode);
      button.setAttribute(
        'aria-label',
        t('nesColorButton', { code: hexadecimal(colorCode) }),
      );
      button.addEventListener('click', () => {
        options.onPaletteColorChange(paletteIndex, colorIndex, colorCode);
        dialog.close();
      });
      grid.append(button);
    });
    if (!dialog.open) {
      dialog.showModal();
    }
  };

  fieldset.append(legend, target, grid);
  form.append(fieldset, closeButton);
  dialog.append(form);
  return { dialog, openFor };
}

function createSpritePaletteEditor(
  options: AnimationEditorOptions,
): HTMLElement {
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('animationSpritePalettesHint');

  const content = document.createElement('div');
  content.className = 'animation-palette-content';

  // Asset default palette selector
  const defaultPaletteGroup = document.createElement('div');
  defaultPaletteGroup.className = 'animation-default-palette-group';
  const defaultPaletteLabel = document.createElement('label');
  defaultPaletteLabel.className = 'animation-field';
  const defaultPaletteSpan = document.createElement('span');
  defaultPaletteSpan.textContent = t('animationDefaultPaletteLabel');
  const defaultPaletteSelect = document.createElement('select');
  for (let p = 0; p < 4; p += 1) {
    const opt = document.createElement('option');
    opt.value = String(p);
    opt.textContent = t('nesPaletteName', { index: p });
    defaultPaletteSelect.append(opt);
  }
  defaultPaletteSelect.value = String(options.settings.defaultPaletteIndex);
  defaultPaletteSelect.addEventListener('change', () => {
    options.onDefaultPaletteIndexChange(Number(defaultPaletteSelect.value));
  });
  defaultPaletteLabel.append(defaultPaletteSpan, defaultPaletteSelect);
  defaultPaletteGroup.append(defaultPaletteLabel);
  content.append(defaultPaletteGroup);

  const palettes = document.createElement('div');
  palettes.className = 'animation-sprite-palettes';
  const selectedColorIndex = Math.max(
    0,
    Math.min(3, options.settings.spriteColorIndex),
  );
  const masterPalette = createSpriteMasterPaletteDialog(options);

  options.paletteSet.forEach((palette, paletteIndex) => {
    const card = document.createElement('fieldset');
    card.className = 'animation-sprite-palette';
    card.classList.toggle(
      'is-selected',
      paletteIndex === options.settings.spritePalette,
    );
    const legend = document.createElement('legend');
    const paletteLabel = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'animation-sprite-palette';
    radio.checked = paletteIndex === options.settings.spritePalette;
    radio.addEventListener('change', () => {
      if (radio.checked) {
        options.onSpritePaletteSelectionChange(
          paletteIndex,
          selectedColorIndex,
        );
      }
    });
    paletteLabel.append(radio, t('nesPaletteName', { index: paletteIndex }));
    legend.append(paletteLabel);
    const swatches = document.createElement('div');
    swatches.className = 'animation-sprite-swatches';
    palette.forEach((colorCode, colorIndex) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'nes-palette-swatch';
      swatch.style.backgroundColor = paletteCssColor(colorCode);
      swatch.classList.toggle(
        'is-selected',
        paletteIndex === options.settings.spritePalette &&
          colorIndex === selectedColorIndex,
      );
      swatch.title = hexadecimal(colorCode);
      swatch.setAttribute(
        'aria-label',
        t('nesPaletteSlotLabel', {
          palette: paletteIndex,
          slot: colorIndex,
          code: hexadecimal(colorCode),
        }),
      );
      swatch.addEventListener('click', () => {
        options.onSpritePaletteSelectionChange(paletteIndex, colorIndex);
      });
      swatches.append(swatch);
    });
    card.append(legend, swatches);
    palettes.append(card);
  });

  const editMasterButton = document.createElement('button');
  editMasterButton.type = 'button';
  editMasterButton.className = 'button secondary-button';
  editMasterButton.textContent = t('nesMasterPaletteEdit');
  editMasterButton.addEventListener('click', () => {
    masterPalette.openFor(options.settings.spritePalette, selectedColorIndex);
  });

  content.append(palettes, editMasterButton);
  const panel = createCollapsiblePanel({
    panelClassName: 'animation-palette-panel',
    title: t('animationSpritePalettesTitle'),
    summary: t('nesPaletteName', {
      index: options.settings.spritePalette,
    }),
    isCollapsed: options.settings.paletteCollapsed ?? false,
    onToggle: options.onTogglePaletteCollapse,
    children: [hint, content],
  });
  panel.append(masterPalette.dialog);
  return panel;
}

function createConfiguration(options: AnimationEditorOptions): HTMLElement {
  const content = document.createElement('div');
  content.className = 'animation-config-content';

  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('animationEditorHint');

  const fields = document.createElement('div');
  fields.className = 'animation-fields';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'animation-field';
  const nameText = document.createElement('span');
  nameText.textContent = t('animationAssetSetName');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value =
    options.settings.name || options.settings.symbolPrefix || 'soldier';

  const symbolPreview = document.createElement('div');
  symbolPreview.className = 'animation-symbol-preview';
  const symbolPreviewTitle = document.createElement('strong');
  symbolPreviewTitle.textContent = t('animationSymbolPreviewTitle');
  const symbolPreviewCode = document.createElement('code');
  const updateSymbolPreview = (): void => {
    const symbolBase = normalizeCIdentifier(nameInput.value);
    symbolPreview.classList.toggle('is-invalid', symbolBase.length === 0);
    symbolPreviewCode.textContent = symbolBase
      ? [
          `${symbolBase}_sprites`,
          `${symbolBase}_frames`,
          `${symbolBase}_animations`,
          `${symbolBase}_animation_count`,
        ].join('\n')
      : t('animationSymbolPreviewInvalid');
  };
  nameInput.addEventListener('input', updateSymbolPreview);

  nameInput.addEventListener('change', () => {
    options.onSettingsChange({
      ...options.settings,
      name: nameInput.value,
      symbolPrefix: nameInput.value,
    });
  });
  nameLabel.append(nameText, nameInput);
  symbolPreview.append(symbolPreviewTitle, symbolPreviewCode);
  updateSymbolPreview();

  fields.append(nameLabel, symbolPreview);

  const flipLabel = document.createElement('label');
  flipLabel.className = 'checkbox-control animation-flip-control';
  const flipCheckbox = document.createElement('input');
  flipCheckbox.type = 'checkbox';
  flipCheckbox.checked = options.settings.flipDeduplication;
  flipCheckbox.addEventListener('change', () => {
    options.onSettingsChange({
      ...options.settings,
      flipDeduplication: flipCheckbox.checked,
    });
  });
  flipLabel.append(flipCheckbox, t('animationFlipDeduplication'));

  const patternTables = document.createElement('div');
  patternTables.className = 'animation-fields';
  const spritePatternTableLabel = document.createElement('label');
  spritePatternTableLabel.className = 'animation-field';
  const spritePatternTableText = document.createElement('span');
  spritePatternTableText.textContent = t('animationSpritePatternTable');
  const spritePatternTable = document.createElement('select');
  for (const table of [0, 1] as const) {
    const option = document.createElement('option');
    option.value = String(table);
    option.textContent = t('animationPatternTableOption', { table });
    option.selected = options.settings.patternTable === table;
    spritePatternTable.append(option);
  }
  spritePatternTable.addEventListener('change', () => {
    options.onSettingsChange({
      ...options.settings,
      patternTable: Number(spritePatternTable.value) as 0 | 1,
    });
  });
  spritePatternTableLabel.append(spritePatternTableText, spritePatternTable);

  const destinationPatternTableLabel = document.createElement('label');
  destinationPatternTableLabel.className = 'animation-field';
  const destinationPatternTableText = document.createElement('span');
  destinationPatternTableText.textContent = t(
    'animationDestinationPatternTable',
  );
  const destinationPatternTable = document.createElement('select');
  for (const table of [0, 1] as const) {
    const option = document.createElement('option');
    option.value = String(table);
    option.textContent = t('animationPatternTableOption', { table });
    option.selected = options.settings.destinationPatternTable === table;
    destinationPatternTable.append(option);
  }
  destinationPatternTable.addEventListener('change', () => {
    options.onSettingsChange({
      ...options.settings,
      destinationPatternTable: Number(destinationPatternTable.value) as 0 | 1,
    });
  });
  destinationPatternTableLabel.append(
    destinationPatternTableText,
    destinationPatternTable,
  );
  patternTables.append(spritePatternTableLabel, destinationPatternTableLabel);

  const transparencyHint = document.createElement('small');
  transparencyHint.textContent = t('animationTransparencyHint');

  const destination = document.createElement('fieldset');
  destination.className = 'animation-destination';
  const destinationLegend = document.createElement('legend');
  destinationLegend.textContent = t('animationDestinationTitle');
  const destinationInput = document.createElement('input');
  destinationInput.type = 'file';
  destinationInput.accept = '.chr,application/octet-stream';
  destinationInput.id = 'animation-destination-chr';
  destinationInput.className = 'visually-hidden';
  destinationInput.addEventListener('change', () => {
    const file = destinationInput.files?.[0];
    if (file !== undefined) options.onDestinationFile(file);
  });
  const destinationButton = document.createElement('label');
  destinationButton.htmlFor = destinationInput.id;
  destinationButton.className = 'button secondary-button';
  destinationButton.textContent = t('animationChooseDestination');
  const destinationStatus = document.createElement('small');
  destinationStatus.textContent =
    options.settings.destinationChrName === null
      ? t('animationNoDestination')
      : t('animationDestinationDetails', {
          name: options.settings.destinationChrName,
          tiles: options.settings.destinationChr.length / 16,
          bytes: options.settings.destinationChr.length,
        });
  destination.append(destinationLegend, destinationInput, destinationButton);
  if (options.settings.destinationChrName !== null) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'button secondary-button';
    clear.textContent = t('animationClearDestination');
    clear.addEventListener('click', options.onDestinationClear);
    destination.append(clear);
  }
  destination.append(destinationStatus);

  content.append(
    hint,
    fields,
    flipLabel,
    patternTables,
    transparencyHint,
    destination,
  );
  return createCollapsiblePanel({
    panelClassName: 'animation-config-panel',
    title: t('animationEditorTitle'),
    summary:
      options.settings.name || options.settings.symbolPrefix || 'soldier',
    isCollapsed: options.settings.configCollapsed ?? false,
    onToggle: options.onToggleConfigCollapse,
    children: [content],
  });
}

function createSingleAnimationPreview(
  options: AnimationEditorOptions,
  anim: AnimationItemSetting,
): HTMLElement {
  const stage = document.createElement('div');
  stage.className = 'animation-preview-stage';

  const nesImage = anim.source
    ? renderAnimationToRawImageData(
        anim.source.indexedImage,
        options.paletteSet,
        options.settings.spritePalette,
      )
    : null;

  if (
    nesImage === null ||
    anim.frameIndices.length === 0 ||
    anim.frameWidth <= 0 ||
    anim.frameHeight <= 0 ||
    nesImage.width % anim.frameWidth !== 0 ||
    nesImage.height % anim.frameHeight !== 0
  ) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('animationPreviewEmpty');
    stage.append(empty);
    return stage;
  }

  const frameColumns = nesImage.width / anim.frameWidth;
  const canvas = document.createElement('canvas');
  canvas.className = 'animation-preview-canvas';
  canvas.width = anim.frameWidth;
  canvas.height = anim.frameHeight;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${anim.name} preview`);

  const meta = document.createElement('strong');

  let previewVariant: 'original' | 'flipH' | 'flipV' = 'original';
  let colorMode: 'nes' | 'original' = 'nes';

  const viewControls = document.createElement('div');
  viewControls.className = 'animation-preview-variant-controls';

  const hasHFlip = anim.allowHorizontalFlip;
  const hasVFlip = anim.allowVerticalFlip;

  const btnNormal = document.createElement('button');
  btnNormal.type = 'button';
  btnNormal.className = 'button secondary-button is-selected';
  btnNormal.textContent = t('animationPreviewVariantOriginal');

  const btnFlipH = document.createElement('button');
  btnFlipH.type = 'button';
  btnFlipH.className = 'button secondary-button';
  btnFlipH.textContent = t('animationPreviewVariantFlipH');

  const btnFlipV = document.createElement('button');
  btnFlipV.type = 'button';
  btnFlipV.className = 'button secondary-button';
  btnFlipV.textContent = t('animationPreviewVariantFlipV');

  const updateVariantButtons = (): void => {
    btnNormal.classList.toggle('is-selected', previewVariant === 'original');
    btnFlipH.classList.toggle('is-selected', previewVariant === 'flipH');
    btnFlipV.classList.toggle('is-selected', previewVariant === 'flipV');
  };

  btnNormal.addEventListener('click', () => {
    previewVariant = 'original';
    updateVariantButtons();
    draw();
  });
  btnFlipH.addEventListener('click', () => {
    previewVariant = 'flipH';
    updateVariantButtons();
    draw();
  });
  btnFlipV.addEventListener('click', () => {
    previewVariant = 'flipV';
    updateVariantButtons();
    draw();
  });

  if (hasHFlip || hasVFlip) {
    viewControls.append(btnNormal);
    if (hasHFlip) viewControls.append(btnFlipH);
    if (hasVFlip) viewControls.append(btnFlipV);
  }

  const colorToggleGroup = document.createElement('div');
  colorToggleGroup.className = 'animation-preview-color-controls';
  const btnNesColor = document.createElement('button');
  btnNesColor.type = 'button';
  btnNesColor.className = 'button secondary-button is-selected';
  btnNesColor.textContent = t('animationPreviewModeNes');
  const btnOrigColor = document.createElement('button');
  btnOrigColor.type = 'button';
  btnOrigColor.className = 'button secondary-button';
  btnOrigColor.textContent = t('animationPreviewModeOriginal');

  const updateColorButtons = (): void => {
    btnNesColor.classList.toggle('is-selected', colorMode === 'nes');
    btnOrigColor.classList.toggle('is-selected', colorMode === 'original');
  };

  btnNesColor.addEventListener('click', () => {
    colorMode = 'nes';
    updateColorButtons();
    draw();
  });
  btnOrigColor.addEventListener('click', () => {
    colorMode = 'original';
    updateColorButtons();
    draw();
  });

  colorToggleGroup.append(btnNesColor, btnOrigColor);

  const controls = document.createElement('div');
  controls.className = 'animation-preview-controls';
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'button secondary-button';
  previous.textContent = '←';
  previous.setAttribute('aria-label', t('animationPreviewPrevious'));
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'button primary-button';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'button secondary-button';
  next.textContent = '→';
  next.setAttribute('aria-label', t('animationPreviewNext'));
  controls.append(previous, play, next);

  stage.append(canvas, meta);
  if (hasHFlip || hasVFlip) {
    stage.append(viewControls);
  }
  stage.append(colorToggleGroup, controls);

  let current = 0;
  let playing = true;
  let timer: number | null = null;

  const draw = (): void => {
    if (anim.frameIndices.length === 0) return;
    const sourceIndex = anim.frameIndices[current] ?? 0;
    const sourceX = (sourceIndex % frameColumns) * anim.frameWidth;
    const sourceY = Math.floor(sourceIndex / frameColumns) * anim.frameHeight;

    const effectivePalette =
      anim.framePalettes?.[current] ??
      anim.paletteIndex ??
      options.settings.defaultPaletteIndex;

    const nesFrameImage = anim.source
      ? renderAnimationToRawImageData(
          anim.source.indexedImage,
          options.paletteSet,
          effectivePalette,
        )
      : null;

    const activeImage =
      colorMode === 'nes'
        ? nesFrameImage
        : (anim.source?.sourceImage ?? nesFrameImage);

    if (activeImage === null) return;

    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, canvas.width, canvas.height);
    if (context !== null) {
      context.imageSmoothingEnabled = false;
      const frameCanvas = cropCanvas(
        activeImage,
        sourceX,
        sourceY,
        anim.frameWidth,
        anim.frameHeight,
      );
      context.save();
      context.imageSmoothingEnabled = false;
      if (previewVariant === 'flipH') {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      } else if (previewVariant === 'flipV') {
        context.translate(0, canvas.height);
        context.scale(1, -1);
      }
      context.drawImage(frameCanvas, 0, 0);
      context.restore();
    }
    const duration = anim.frameDurations[current] ?? anim.defaultDuration;
    const variantSuffix =
      previewVariant === 'flipH'
        ? ' [Flip H]'
        : previewVariant === 'flipV'
          ? ' [Flip V]'
          : '';
    meta.textContent = `${anim.name}${variantSuffix} · ${t(
      'animationFrameLabel',
      {
        index: sourceIndex,
      },
    )} · ${String(duration)} ${t('animationDurationUnit')} · ${t(
      'nesPaletteName',
      { index: effectivePalette },
    )}`;
    play.textContent = t(
      playing ? 'animationPreviewPause' : 'animationPreviewPlay',
    );
  };

  const stopTimer = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const schedule = (): void => {
    if (!playing || anim.frameIndices.length === 0) return;
    const duration = anim.frameDurations[current] ?? anim.defaultDuration;
    timer = window.setTimeout(
      () => {
        if (!canvas.isConnected) return;
        if (anim.playback === 'once') {
          if (current < anim.frameIndices.length - 1) {
            current += 1;
            draw();
            schedule();
          } else {
            playing = false;
            draw();
          }
        } else {
          current = (current + 1) % anim.frameIndices.length;
          draw();
          schedule();
        }
      },
      (duration * 1000) / 60,
    );
  };

  previous.addEventListener('click', () => {
    if (anim.frameIndices.length === 0) return;
    stopTimer();
    playing = false;
    current =
      (current - 1 + anim.frameIndices.length) % anim.frameIndices.length;
    draw();
  });

  next.addEventListener('click', () => {
    if (anim.frameIndices.length === 0) return;
    stopTimer();
    playing = false;
    current = (current + 1) % anim.frameIndices.length;
    draw();
  });

  play.addEventListener('click', () => {
    if (anim.frameIndices.length === 0) return;
    if (!playing) {
      if (anim.playback === 'once' && current >= anim.frameIndices.length - 1) {
        current = 0;
      }
      playing = true;
      draw();
      schedule();
    } else {
      playing = false;
      stopTimer();
      draw();
    }
  });

  draw();
  schedule();
  return stage;
}

function createAnimationCardFrameGrid(
  options: AnimationEditorOptions,
  anim: AnimationItemSetting,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'animation-card-grid-container';
  const heading = document.createElement('h4');
  heading.textContent = t('animationFrameGridTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('animationFrameGridHint');
  container.append(heading, hint);

  const effectiveAnimPalette =
    anim.paletteIndex ?? options.settings.defaultPaletteIndex;

  const nesImage = anim.source
    ? renderAnimationToRawImageData(
        anim.source.indexedImage,
        options.paletteSet,
        effectiveAnimPalette,
      )
    : null;

  if (
    nesImage === null ||
    anim.frameWidth <= 0 ||
    anim.frameHeight <= 0 ||
    nesImage.width % anim.frameWidth !== 0 ||
    nesImage.height % anim.frameHeight !== 0
  ) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent =
      nesImage === null ? t('animationNoSource') : t('animationErrorFrameGrid');
    container.append(empty);
    return container;
  }

  const columns = nesImage.width / anim.frameWidth;
  const rows = nesImage.height / anim.frameHeight;
  const grid = document.createElement('div');
  grid.className = 'animation-frame-grid';
  grid.style.gridTemplateColumns = `repeat(${String(Math.min(columns, 8))}, minmax(5rem, 1fr))`;

  for (let index = 0; index < columns * rows; index += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'animation-frame-button';

    const orderIndex = anim.frameIndices.indexOf(index);
    const isSelected = orderIndex >= 0;

    if (isSelected) {
      button.classList.add('is-active-target');
    }

    const sourceX = (index % columns) * anim.frameWidth;
    const sourceY = Math.floor(index / columns) * anim.frameHeight;
    const canvas = cropCanvas(
      nesImage,
      sourceX,
      sourceY,
      anim.frameWidth,
      anim.frameHeight,
    );
    const label = document.createElement('span');
    label.textContent = isSelected
      ? `${t('animationFrameLabel', { index })} (#${String(orderIndex + 1)})`
      : t('animationFrameLabel', { index });

    button.setAttribute('aria-pressed', String(isSelected));
    button.addEventListener('click', () => {
      options.onFrameToggle(anim.id, index);
    });
    button.append(canvas, label);
    grid.append(button);
  }
  container.append(grid);
  return container;
}

function createFrameOrderList(
  options: AnimationEditorOptions,
  anim: AnimationItemSetting,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'animation-order-group';
  const heading = document.createElement('h4');
  heading.textContent = t('animationSelectedFramesTitle');
  container.append(heading);

  if (anim.frameIndices.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('animationNoFrames');
    container.append(empty);
    return container;
  }

  const columns =
    anim.source && anim.frameWidth > 0
      ? Math.floor(anim.source.sourceImage.width / anim.frameWidth)
      : 1;

  const list = document.createElement('ol');
  anim.frameIndices.forEach((frameIndex, orderIndex) => {
    const item = document.createElement('li');

    const effectivePalette =
      anim.framePalettes?.[orderIndex] ??
      anim.paletteIndex ??
      options.settings.defaultPaletteIndex;

    const sourceX = (frameIndex % columns) * anim.frameWidth;
    const sourceY = Math.floor(frameIndex / columns) * anim.frameHeight;
    const nesFrameImage = anim.source
      ? renderAnimationToRawImageData(
          anim.source.indexedImage,
          options.paletteSet,
          effectivePalette,
        )
      : null;

    if (nesFrameImage) {
      const thumbCanvas = cropCanvas(
        nesFrameImage,
        sourceX,
        sourceY,
        anim.frameWidth,
        anim.frameHeight,
      );
      thumbCanvas.className = 'animation-frame-thumbnail';
      item.append(thumbCanvas);
    }

    const text = document.createElement('span');
    text.className = 'animation-frame-order-title';
    text.textContent = `#${String(orderIndex + 1)} (${t('animationFrameLabel', { index: frameIndex })})`;

    const duration = document.createElement('label');
    duration.className = 'animation-frame-duration';
    const durationText = document.createElement('span');
    durationText.textContent = t('animationDurationUnit');
    const durationInput = document.createElement('input');
    durationInput.type = 'number';
    durationInput.min = '1';
    durationInput.max = '255';
    durationInput.step = '1';
    durationInput.value = String(
      anim.frameDurations[orderIndex] ?? anim.defaultDuration,
    );
    let committedDuration = Number(durationInput.value);
    const commitDuration = (): void => {
      const nextDuration = Number(durationInput.value);
      if (nextDuration === committedDuration) return;
      committedDuration = nextDuration;
      options.onFrameDurationChange(anim.id, frameIndex, nextDuration);
    };
    durationInput.addEventListener('change', commitDuration);
    durationInput.addEventListener('blur', commitDuration);
    duration.append(durationInput, durationText);

    // Frame palette selector
    const framePaletteLabel = document.createElement('label');
    framePaletteLabel.className = 'animation-frame-palette-select';
    const framePaletteSelect = document.createElement('select');
    const frameDefaultOpt = document.createElement('option');
    frameDefaultOpt.value = '';
    frameDefaultOpt.textContent = t('animationFramePaletteDefault');
    framePaletteSelect.append(frameDefaultOpt);
    for (let p = 0; p < 4; p += 1) {
      const opt = document.createElement('option');
      opt.value = String(p);
      opt.textContent = t('nesPaletteName', { index: p });
      framePaletteSelect.append(opt);
    }
    const currentFramePalette = anim.framePalettes?.[orderIndex];
    framePaletteSelect.value =
      currentFramePalette === null || currentFramePalette === undefined
        ? ''
        : String(currentFramePalette);
    framePaletteSelect.addEventListener('change', () => {
      options.onFramePaletteChange(
        anim.id,
        orderIndex,
        framePaletteSelect.value === ''
          ? null
          : Number(framePaletteSelect.value),
      );
    });
    framePaletteLabel.append(framePaletteSelect);

    const actions = document.createElement('span');
    actions.className = 'animation-order-actions';
    const earlier = document.createElement('button');
    earlier.type = 'button';
    earlier.textContent = '↑';
    earlier.disabled = orderIndex === 0;
    earlier.setAttribute(
      'aria-label',
      t('animationMoveEarlier', { index: frameIndex }),
    );
    earlier.addEventListener('click', () => {
      options.onFrameMove(anim.id, frameIndex, -1);
    });
    const later = document.createElement('button');
    later.type = 'button';
    later.textContent = '↓';
    later.disabled = orderIndex === anim.frameIndices.length - 1;
    later.setAttribute(
      'aria-label',
      t('animationMoveLater', { index: frameIndex }),
    );
    later.addEventListener('click', () => {
      options.onFrameMove(anim.id, frameIndex, 1);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute(
      'aria-label',
      t('animationRemoveFrame', { index: frameIndex }),
    );
    remove.addEventListener('click', () => {
      options.onFrameRemoveFromAnimation(anim.id, frameIndex);
    });
    actions.append(earlier, later, remove);
    item.append(text, duration, framePaletteLabel, actions);
    list.append(item);
  });
  container.append(list);
  return container;
}

function createAnimationCard(
  options: AnimationEditorOptions,
  anim: AnimationItemSetting,
): HTMLElement {
  const card = document.createElement('section');
  card.className = 'animation-card';

  const isCollapsed = anim.collapsed === true;
  card.classList.toggle('is-collapsed', isCollapsed);

  // Card Header
  const header = document.createElement('header');
  header.className = 'animation-card-header';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'animation-collapse-toggle';
  toggleBtn.textContent = isCollapsed ? '▶' : '▼';
  toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
  toggleBtn.addEventListener('click', () => {
    options.onToggleAnimationCollapse(anim.id);
  });

  const summary = document.createElement('div');
  summary.className = 'animation-card-summary';
  const title = document.createElement('strong');
  title.textContent = anim.name;
  const details = document.createElement('span');
  details.className = 'animation-card-details';
  const playbackLabel =
    anim.playback === 'once'
      ? t('animationPlaybackOnce')
      : t('animationPlaybackLoop');
  const flips: string[] = [];
  if (anim.allowHorizontalFlip) {
    flips.push(t('animationFlipHLabel'));
  }
  if (anim.allowVerticalFlip) {
    flips.push(t('animationFlipVLabel'));
  }
  const flipSummary = flips.length > 0 ? ` · ${flips.join(', ')}` : '';
  const sourceName = anim.source ? anim.source.fileName : 'no source';
  details.textContent = `${sourceName} · ${String(anim.frameIndices.length)} frames · ${playbackLabel}${flipSummary}`;
  summary.append(title, details);
  summary.addEventListener('click', () => {
    options.onToggleAnimationCollapse(anim.id);
  });

  const actions = document.createElement('div');
  actions.className = 'animation-card-actions';

  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.className = 'button secondary-button';
  dupBtn.textContent = t('animationDuplicate');
  dupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    options.onDuplicateAnimation(anim.id);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'button secondary-button';
  removeBtn.textContent = t('animationRemove');
  removeBtn.disabled = options.settings.animations.length <= 1;
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    options.onRemoveAnimation(anim.id);
  });

  actions.append(dupBtn, removeBtn);
  header.append(toggleBtn, summary, actions);
  card.append(header);

  // Card Body
  if (!isCollapsed) {
    const body = document.createElement('div');
    body.className = 'animation-card-body';

    const fields = document.createElement('div');
    fields.className = 'animation-card-fields';

    // Name input
    const nameLabel = document.createElement('label');
    nameLabel.className = 'animation-field';
    const nameText = document.createElement('span');
    nameText.textContent = t('animationItemNameLabel');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = anim.name;
    nameInput.addEventListener('change', () => {
      options.onUpdateAnimation(anim.id, { name: nameInput.value });
    });
    nameLabel.append(nameText, nameInput);

    // Source PNG picker
    const sourceContainer = document.createElement('div');
    sourceContainer.className = 'animation-field animation-source-field';
    const sourceText = document.createElement('span');
    sourceText.textContent = t('animationSourceFileLabel');
    const sourceControls = document.createElement('div');
    sourceControls.className = 'animation-source-controls';

    const sourceInput = document.createElement('input');
    sourceInput.type = 'file';
    sourceInput.accept = '.png,image/png';
    sourceInput.id = `anim-file-${anim.id}`;
    sourceInput.className = 'visually-hidden';
    sourceInput.addEventListener('change', () => {
      const file = sourceInput.files?.[0];
      if (file !== undefined) {
        options.onAnimationSourceFile(anim.id, file);
      }
    });

    const sourceBtn = document.createElement('label');
    sourceBtn.htmlFor = sourceInput.id;
    sourceBtn.className = 'button secondary-button';
    sourceBtn.textContent = anim.source
      ? t('animationChangeSource')
      : t('animationChooseSource');

    const sourceBadge = document.createElement('span');
    sourceBadge.className = 'animation-source-badge';
    sourceBadge.textContent = anim.source ? anim.source.fileName : '—';

    sourceControls.append(sourceInput, sourceBtn, sourceBadge);
    sourceContainer.append(sourceText, sourceControls);

    // Animation Palette Selector
    const paletteField = document.createElement('label');
    paletteField.className = 'animation-field';
    const paletteFieldText = document.createElement('span');
    paletteFieldText.textContent = t('animationPaletteLabel');
    const paletteSelect = document.createElement('select');
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = t('animationPaletteInherit', {
      palette: t('nesPaletteName', {
        index: options.settings.defaultPaletteIndex,
      }),
    });
    paletteSelect.append(defaultOpt);
    for (let p = 0; p < 4; p += 1) {
      const opt = document.createElement('option');
      opt.value = String(p);
      opt.textContent = t('nesPaletteName', { index: p });
      paletteSelect.append(opt);
    }
    paletteSelect.value =
      anim.paletteIndex === null || anim.paletteIndex === undefined
        ? ''
        : String(anim.paletteIndex);
    paletteSelect.addEventListener('change', () => {
      options.onUpdateAnimation(anim.id, {
        paletteIndex:
          paletteSelect.value === '' ? null : Number(paletteSelect.value),
      });
    });
    paletteField.append(paletteFieldText, paletteSelect);

    // Frame width / height
    const widthField = numberInput(
      t('animationFrameWidthLabel'),
      anim.frameWidth,
      8,
      128,
      (frameWidth) => {
        options.onUpdateAnimation(anim.id, { frameWidth });
      },
    );

    const heightField = numberInput(
      t('animationFrameHeightLabel'),
      anim.frameHeight,
      8,
      128,
      (frameHeight) => {
        options.onUpdateAnimation(anim.id, { frameHeight });
      },
    );

    // Origin X / Y
    const originXField = numberInput(
      t('animationOriginX'),
      anim.originX,
      -128,
      127,
      (originX) => {
        options.onUpdateAnimation(anim.id, { originX });
      },
    );

    const originYField = numberInput(
      t('animationOriginY'),
      anim.originY,
      -128,
      127,
      (originY) => {
        options.onUpdateAnimation(anim.id, { originY });
      },
    );

    // Playback selector
    const playbackLabelElem = document.createElement('label');
    playbackLabelElem.className = 'animation-field';
    const playbackText = document.createElement('span');
    playbackText.textContent = t('animationPlaybackLabel');
    const playbackSelect = document.createElement('select');
    const optLoop = document.createElement('option');
    optLoop.value = 'loop';
    optLoop.textContent = t('animationPlaybackLoop');
    optLoop.selected = anim.playback === 'loop';
    const optOnce = document.createElement('option');
    optOnce.value = 'once';
    optOnce.textContent = t('animationPlaybackOnce');
    optOnce.selected = anim.playback === 'once';
    playbackSelect.append(optLoop, optOnce);
    playbackSelect.addEventListener('change', () => {
      options.onUpdateAnimation(anim.id, {
        playback: playbackSelect.value as AnimationPlayback,
      });
    });
    playbackLabelElem.append(playbackText, playbackSelect);

    // Default Duration with "Apply to all frames" button
    const durationContainer = document.createElement('div');
    durationContainer.className = 'animation-duration-group';
    const durationField = numberInput(
      t('animationDefaultDurationLabel'),
      anim.defaultDuration,
      1,
      255,
      (defaultDuration) => {
        options.onUpdateAnimation(anim.id, { defaultDuration });
      },
    );
    const applyAllBtn = document.createElement('button');
    applyAllBtn.type = 'button';
    applyAllBtn.className = 'button secondary-button animation-apply-all-btn';
    applyAllBtn.textContent = t('animationApplyDurationToAll');
    applyAllBtn.addEventListener('click', () => {
      options.onApplyDefaultDurationToAll(anim.id);
    });
    durationContainer.append(durationField, applyAllBtn);

    // Mirroring variants
    const mirrorFieldset = document.createElement('fieldset');
    mirrorFieldset.className = 'animation-mirror-variants';
    const mirrorLegend = document.createElement('legend');
    mirrorLegend.textContent = t('animationMirrorVariantsTitle');

    const flipHLabel = document.createElement('label');
    flipHLabel.className = 'checkbox-control';
    const flipHInput = document.createElement('input');
    flipHInput.type = 'checkbox';
    flipHInput.checked = anim.allowHorizontalFlip;
    flipHInput.addEventListener('change', () => {
      options.onUpdateAnimation(anim.id, {
        allowHorizontalFlip: flipHInput.checked,
        flipH: flipHInput.checked,
      });
    });
    flipHLabel.append(flipHInput, t('animationAllowHorizontalFlip'));

    const flipVLabel = document.createElement('label');
    flipVLabel.className = 'checkbox-control';
    const flipVInput = document.createElement('input');
    flipVInput.type = 'checkbox';
    flipVInput.checked = anim.allowVerticalFlip;
    flipVInput.addEventListener('change', () => {
      options.onUpdateAnimation(anim.id, {
        allowVerticalFlip: flipVInput.checked,
        flipV: flipVInput.checked,
      });
    });
    flipVLabel.append(flipVInput, t('animationAllowVerticalFlip'));
    mirrorFieldset.append(mirrorLegend, flipHLabel, flipVLabel);

    fields.append(
      nameLabel,
      sourceContainer,
      paletteField,
      widthField,
      heightField,
      originXField,
      originYField,
      playbackLabelElem,
      durationContainer,
      mirrorFieldset,
    );
    body.append(fields);

    // Spritesheet Frame Grid directly inside card
    body.append(createAnimationCardFrameGrid(options, anim));

    // Frame list and independent preview
    const split = document.createElement('div');
    split.className = 'animation-card-split';
    split.append(
      createFrameOrderList(options, anim),
      createSingleAnimationPreview(options, anim),
    );
    body.append(split);

    card.append(body);
  }

  return card;
}

function createAnimationListPanel(
  options: AnimationEditorOptions,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel animation-list-panel';

  const header = document.createElement('div');
  header.className = 'animation-list-header';
  const titleGroup = document.createElement('div');
  const heading = document.createElement('h2');
  heading.textContent = t('animationListTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('animationListHint');
  titleGroup.append(heading, hint);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'button primary-button';
  addBtn.textContent = t('animationAdd');
  addBtn.addEventListener('click', options.onAddAnimation);

  header.append(titleGroup, addBtn);
  section.append(header);

  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'animation-cards-list';
  options.settings.animations.forEach((anim) => {
    cardsContainer.append(createAnimationCard(options, anim));
  });
  section.append(cardsContainer);

  return section;
}

function flipLabel(sprite: MetaspriteTile): string {
  if (sprite.horizontalFlip && sprite.verticalFlip) {
    return t('animationTileCombinedFlip');
  }
  if (sprite.horizontalFlip) return t('animationTileHorizontalFlip');
  if (sprite.verticalFlip) return t('animationTileVerticalFlip');
  return t('animationTileNormal');
}

function createMapping(options: AnimationEditorOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel animation-mapping-panel';
  const isCollapsed = options.settings.mappingCollapsed ?? true;
  section.classList.toggle('is-collapsed', isCollapsed);

  const header = document.createElement('div');
  header.className = 'animation-mapping-header';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'animation-collapse-toggle';
  toggleBtn.textContent = isCollapsed ? '▶' : '▼';
  toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
  toggleBtn.setAttribute('aria-label', t('animationMappingCollapseToggle'));
  toggleBtn.addEventListener('click', () => {
    options.onToggleMappingCollapse();
  });

  const heading = document.createElement('h2');
  heading.textContent = t('animationMappingTitle');
  heading.style.cursor = 'pointer';
  heading.addEventListener('click', () => {
    options.onToggleMappingCollapse();
  });

  header.append(toggleBtn, heading);
  section.append(header);

  if (isCollapsed) {
    return section;
  }

  if (options.model === null) {
    const message = document.createElement('p');
    message.className =
      options.modelError === null ? 'empty-message' : 'error-message';
    message.textContent =
      options.modelError === null
        ? t('animationMappingEmpty')
        : t(errorTranslation(options.modelError));
    section.append(message);
    return section;
  }
  const model = options.model;
  model.animations.forEach((animation) => {
    const animSetting = options.settings.animations.find(
      (a) => a.name === animation.name,
    );
    if (!animSetting?.source) return;
    const animSource = animSetting.source;

    const animationSection = document.createElement('section');
    animationSection.className = 'animation-mapping-group';
    const title = document.createElement('h3');
    const flips: string[] = [];
    if (animation.allowHorizontalFlip) {
      flips.push(t('animationFlipHLabel'));
    }
    if (animation.allowVerticalFlip) {
      flips.push(t('animationFlipVLabel'));
    }
    const flipText = flips.length > 0 ? ` · ${flips.join(', ')}` : '';
    title.textContent = `${animation.name} · ${animation.sourceFile} · ${animation.playback === 'once' ? t('animationPlaybackOnce') : t('animationPlaybackLoop')}${flipText}`;
    animationSection.append(title);
    animation.frames.forEach((frame, frameOrder) => {
      const article = document.createElement('article');
      article.className = 'animation-frame-mapping';
      const frameTitle = document.createElement('h4');
      frameTitle.textContent = `${t('animationFrameLabel', {
        index: frame.sourceIndex,
      })} · #${String(frameOrder + 1)} · ${String(frame.duration)} ${t(
        'animationDurationUnit',
      )} · ${t('nesPaletteName', { index: frame.effectivePalette })}`;

      const frameImage = renderAnimationToRawImageData(
        animSource.indexedImage,
        options.paletteSet,
        frame.effectivePalette,
      );

      const grid = document.createElement('div');
      grid.className = 'animation-tile-map';
      grid.style.gridTemplateColumns = `repeat(${String(animation.widthTiles)}, minmax(5.5rem, 1fr))`;
      for (let row = 0; row < animation.heightTiles; row += 1) {
        for (let column = 0; column < animation.widthTiles; column += 1) {
          const cell = document.createElement('div');
          cell.className = 'animation-tile-cell';
          cell.append(
            cropCanvas(
              frameImage,
              frame.sourceX + column * 8,
              frame.sourceY + row * 8,
              8,
              8,
            ),
          );
          const sprite = frame.sprites.find(
            (candidate) =>
              candidate.sourceTileColumn === column &&
              candidate.sourceTileRow === row,
          );
          const details = document.createElement('span');
          if (sprite === undefined) {
            cell.classList.add('is-omitted');
            details.textContent = t('animationTileOmitted');
          } else {
            const reuseKey: TranslationKey =
              sprite.reuse === 'destination'
                ? 'animationReuseDestination'
                : sprite.reuse === 'imported'
                  ? 'animationReuseImported'
                  : 'animationReuseNew';
            details.textContent = `$${sprite.tile
              .toString(16)
              .padStart(2, '0')
              .toUpperCase()} · ${flipLabel(sprite)} · ${t(reuseKey)} · A=$${sprite.attributes
              .toString(16)
              .padStart(2, '0')
              .toUpperCase()}`;
          }
          if (sprite !== undefined) {
            details.textContent = `T${String(model.patternTable)} · P$${sprite.physicalTileIndex
              .toString(16)
              .padStart(3, '0')
              .toUpperCase()} · ${details.textContent}`;
          }
          cell.append(details);
          grid.append(cell);
        }
      }
      article.append(frameTitle, grid);
      animationSection.append(article);
    });
    section.append(animationSection);
  });
  return section;
}

function stat(label: string, value: string): HTMLDivElement {
  const item = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const definition = document.createElement('dd');
  definition.textContent = value;
  item.append(term, definition);
  return item;
}

function downloadButton(
  label: string,
  onClick: () => void,
  primary: boolean,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary
    ? 'button primary-button export-download-primary'
    : 'button secondary-button export-download-secondary';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createExports(options: AnimationEditorOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel animation-export-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('animationExportsTitle');
  section.append(heading);
  if (options.model === null) {
    const error = document.createElement('p');
    error.className = 'empty-message';
    error.textContent = t('animationMappingEmpty');
    section.append(error);
    return section;
  }
  const model = options.model;
  const exportedChr = padChrRom(model.finalChr);
  const statsHeading = document.createElement('h3');
  statsHeading.textContent = t('animationStatsTitle');
  const stats = document.createElement('dl');
  stats.className = 'animation-stats';
  stats.append(
    stat(t('animationBaseTiles'), String(model.chr.baseTileCount)),
    stat(
      t('animationReusedDestination'),
      String(model.chr.reusedDestinationTiles),
    ),
    stat(t('animationReusedImported'), String(model.chr.reusedImportedTiles)),
    stat(t('animationNewTiles'), String(model.chr.newTileCount)),
    stat(
      t('animationAppendStart'),
      `$${model.chr.appendedTileStart.toString(16).padStart(2, '0').toUpperCase()}`,
    ),
    stat(
      t('animationTotalChr'),
      `${String(model.chr.finalTileCount)} / ${String(model.chr.physicalCapacityTiles)} tiles`,
    ),
    stat(
      t('animationSpritePatternTableUsage', {
        table: model.chr.patternTable,
      }),
      `${String(model.chr.patternTableFinalTileCount)} / ${String(model.chr.patternTableCapacityTiles)} tiles`,
    ),
    stat(t('animationRemainingTiles'), String(model.chr.remainingTiles)),
    stat(t('animationFinalChrSize'), `${String(exportedChr.length)} bytes`),
  );
  const id = model.symbolBase;
  const c = generateCAnimationExport(model);
  const asm = generateCa65AnimationExport(model);
  const actions = document.createElement('div');
  actions.className = 'export-actions';
  actions.append(
    downloadButton(
      t('animationDownloadChr'),
      () => {
        options.onDownloadBytes(exportedChr, model.chr.output);
      },
      true,
    ),
    downloadButton(
      t('animationDownloadPalette'),
      () => {
        options.onDownloadBytes(
          encodeNesBackgroundPalettes(options.paletteSet),
          `${id}.pal`,
        );
      },
      false,
    ),
    downloadButton(
      t('animationDownloadJson'),
      () => {
        options.onDownloadText(serializeAnimationMetadata(model), `${id}.json`);
      },
      false,
    ),
    downloadButton(
      t('animationDownloadCHeader'),
      () => {
        options.onDownloadText(c.header, c.headerFileName);
      },
      false,
    ),
    downloadButton(
      t('animationDownloadCSource'),
      () => {
        options.onDownloadText(c.source, c.sourceFileName);
      },
      false,
    ),
    downloadButton(
      t('animationDownloadAsmInclude'),
      () => {
        options.onDownloadText(asm.include, asm.includeFileName);
      },
      false,
    ),
    downloadButton(
      t('animationDownloadAsmSource'),
      () => {
        options.onDownloadText(asm.source, asm.sourceFileName);
      },
      false,
    ),
  );
  const estimate = document.createElement('small');
  estimate.textContent = t('animationEstimatedRom', {
    bytes: c.estimatedRomBytes,
  });
  section.append(statsHeading, stats, actions, estimate);
  return section;
}

export function createAnimationEditor(
  options: AnimationEditorOptions,
): readonly HTMLElement[] {
  const configPanel = createConfiguration(options);
  configPanel.id = 'section-asset';
  const quantizationPanel = createAnimationQuantizationPanel(options);
  quantizationPanel.id = 'section-quantization';
  const palettePanel = createSpritePaletteEditor(options);
  palettePanel.id = 'section-palettes';
  const listPanel = createAnimationListPanel(options);
  listPanel.id = 'section-animations';
  const mappingPanel = createMapping(options);
  mappingPanel.id = 'section-mapping';
  const exportsPanel = createExports(options);
  exportsPanel.id = 'section-export';
  return [
    configPanel,
    quantizationPanel,
    palettePanel,
    listPanel,
    mappingPanel,
    exportsPanel,
  ];
}
