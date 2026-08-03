import {
  generateCAnimationExport,
  generateCa65AnimationExport,
  sanitizeCIdentifier,
  serializeAnimationMetadata,
} from '../core/animation-exporters';
import type {
  AnimationCategory,
  AnimationModelError,
  AnimationProjectModel,
  MetaspriteTile,
} from '../core/animation-model';
import {
  encodeNesBackgroundPalettes,
  NES_MASTER_PALETTE,
  type NesPaletteSet,
} from '../core/nes-palette';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { AnimationSettings } from './types';

interface AnimationEditorOptions {
  readonly image: ImageData | null;
  readonly settings: AnimationSettings;
  readonly model: AnimationProjectModel | null;
  readonly modelError: AnimationModelError | null;
  readonly paletteSet: NesPaletteSet;
  readonly paletteColorTarget: {
    readonly paletteIndex: number;
    readonly colorIndex: number;
  };
  readonly onSettingsChange: (settings: AnimationSettings) => void;
  readonly onFrameToggle: (frameIndex: number) => void;
  readonly onFrameMove: (
    category: AnimationCategory,
    frameIndex: number,
    direction: -1 | 1,
  ) => void;
  readonly onFrameDurationChange: (
    category: AnimationCategory,
    frameIndex: number,
    duration: number,
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
    case 'invalid-frame-duration':
      return 'animationErrorDuration';
    case 'invalid-origin':
      return 'animationErrorOrigin';
    case 'invalid-destination-chr':
    case 'destination-capacity-overflow':
      return 'animationErrorDestination';
    case 'chr-capacity-overflow':
    case 'tile-index-overflow':
      return 'animationErrorCapacity';
    default:
      return 'animationErrorGeneric';
  }
}

function cropCanvas(
  image: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context?.putImageData(image, -x, -y);
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

function createSpritePaletteEditor(
  options: AnimationEditorOptions,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel animation-palette-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('animationSpritePalettesTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('animationSpritePalettesHint');
  const palettes = document.createElement('div');
  palettes.className = 'animation-sprite-palettes';
  const selectedColorIndex = Math.max(
    1,
    Math.min(3, options.paletteColorTarget.colorIndex),
  );

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
      if (colorIndex === 0) {
        const transparent = document.createElement('span');
        transparent.className = 'animation-transparent-swatch';
        transparent.title = t('animationTransparentSlot');
        transparent.setAttribute(
          'aria-label',
          `${t('nesPaletteName', { index: paletteIndex })}, ${t('animationTransparentSlot')}`,
        );
        swatches.append(transparent);
        return;
      }
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

  const master = document.createElement('fieldset');
  master.className = 'nes-master-palette animation-sprite-master-palette';
  const masterLegend = document.createElement('legend');
  masterLegend.textContent = t('nesMasterPaletteTitle');
  const target = document.createElement('p');
  target.className = 'nes-color-target';
  const targetPalette = options.settings.spritePalette;
  const targetCode =
    options.paletteSet[targetPalette]?.[selectedColorIndex] ?? 0x0f;
  target.textContent = t('nesColorEditTarget', {
    palette: targetPalette,
    color: selectedColorIndex,
    code: hexadecimal(targetCode),
  });
  const colors = document.createElement('div');
  colors.className = 'nes-color-grid';
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
      options.onPaletteColorChange(
        targetPalette,
        selectedColorIndex,
        colorCode,
      );
    });
    colors.append(button);
  });
  master.append(masterLegend, target, colors);
  section.append(heading, hint, palettes, master);
  return section;
}

function createConfiguration(options: AnimationEditorOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel animation-config-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('animationEditorTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('animationEditorHint');

  const fields = document.createElement('div');
  fields.className = 'animation-fields';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'animation-field animation-name-field';
  const nameText = document.createElement('span');
  nameText.textContent = t('animationNameLabel');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = options.settings.name;
  nameInput.addEventListener('change', () => {
    options.onSettingsChange({ ...options.settings, name: nameInput.value });
  });
  nameLabel.append(nameText, nameInput);
  fields.append(
    nameLabel,
    numberInput(
      t('animationFrameWidthLabel'),
      options.settings.frameWidth,
      8,
      128,
      (frameWidth) => {
        options.onSettingsChange({ ...options.settings, frameWidth });
      },
    ),
    numberInput(
      t('animationFrameHeightLabel'),
      options.settings.frameHeight,
      8,
      128,
      (frameHeight) => {
        options.onSettingsChange({ ...options.settings, frameHeight });
      },
    ),
    numberInput(
      t(
        options.settings.selectionTarget === 'idle'
          ? 'animationIdleDuration'
          : 'animationMovementDuration',
      ),
      options.settings.selectionTarget === 'idle'
        ? options.settings.idleDuration
        : options.settings.movementDuration,
      1,
      255,
      (duration) => {
        options.onSettingsChange(
          options.settings.selectionTarget === 'idle'
            ? { ...options.settings, idleDuration: duration }
            : { ...options.settings, movementDuration: duration },
        );
      },
    ),
    numberInput(
      t('animationOriginX'),
      options.settings.originX,
      -128,
      127,
      (originX) => {
        options.onSettingsChange({ ...options.settings, originX });
      },
    ),
    numberInput(
      t('animationOriginY'),
      options.settings.originY,
      -128,
      127,
      (originY) => {
        options.onSettingsChange({ ...options.settings, originY });
      },
    ),
  );

  const target = document.createElement('fieldset');
  target.className = 'animation-target';
  const targetLegend = document.createElement('legend');
  targetLegend.textContent = t('animationSelectionTarget');
  target.append(targetLegend);
  const categories: readonly [AnimationCategory, TranslationKey][] = [
    ['idle', 'animationIdle'],
    ['movement', 'animationMovement'],
  ];
  categories.forEach(([category, labelKey]) => {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'animation-target';
    radio.checked = options.settings.selectionTarget === category;
    radio.addEventListener('change', () => {
      if (radio.checked) {
        options.onSettingsChange({
          ...options.settings,
          selectionTarget: category,
        });
      }
    });
    label.append(radio, t(labelKey));
    target.append(label);
  });

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

  section.append(
    heading,
    hint,
    target,
    fields,
    flipLabel,
    transparencyHint,
    destination,
  );
  return section;
}

function createFrameOrder(
  options: AnimationEditorOptions,
  category: AnimationCategory,
  frames: readonly number[],
  durations: readonly number[],
): HTMLElement {
  const group = document.createElement('section');
  group.className = 'animation-order-group';
  const heading = document.createElement('h3');
  heading.textContent = t(
    category === 'idle' ? 'animationIdle' : 'animationMovement',
  );
  group.append(heading);
  if (frames.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('animationNoFrames');
    group.append(empty);
    return group;
  }
  const list = document.createElement('ol');
  frames.forEach((frameIndex, orderIndex) => {
    const item = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = t('animationFrameLabel', { index: frameIndex });
    const duration = document.createElement('label');
    duration.className = 'animation-frame-duration';
    const durationText = document.createElement('span');
    durationText.textContent = t('animationFrameDurationLabel', {
      index: frameIndex,
    });
    const durationInput = document.createElement('input');
    durationInput.type = 'number';
    durationInput.min = '1';
    durationInput.max = '255';
    durationInput.step = '1';
    durationInput.value = String(
      durations[orderIndex] ??
        (category === 'idle'
          ? options.settings.idleDuration
          : options.settings.movementDuration),
    );
    let committedDuration = Number(durationInput.value);
    const commitDuration = (): void => {
      const nextDuration = Number(durationInput.value);
      if (nextDuration === committedDuration) return;
      committedDuration = nextDuration;
      options.onFrameDurationChange(category, frameIndex, nextDuration);
    };
    durationInput.addEventListener('change', commitDuration);
    durationInput.addEventListener('blur', commitDuration);
    duration.append(durationText, durationInput);
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
      options.onFrameMove(category, frameIndex, -1);
    });
    const later = document.createElement('button');
    later.type = 'button';
    later.textContent = '↓';
    later.disabled = orderIndex === frames.length - 1;
    later.setAttribute(
      'aria-label',
      t('animationMoveLater', { index: frameIndex }),
    );
    later.addEventListener('click', () => {
      options.onFrameMove(category, frameIndex, 1);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute(
      'aria-label',
      t('animationRemoveFrame', { index: frameIndex }),
    );
    remove.addEventListener('click', () => {
      options.onFrameToggle(frameIndex);
    });
    actions.append(earlier, later, remove);
    item.append(text, duration, actions);
    list.append(item);
  });
  group.append(list);
  return group;
}

function createFrameGrid(options: AnimationEditorOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel animation-frame-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('animationFrameGridTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('animationFrameGridHint');
  section.append(heading, hint);
  const { image, settings } = options;
  if (
    image === null ||
    settings.frameWidth <= 0 ||
    settings.frameHeight <= 0 ||
    image.width % settings.frameWidth !== 0 ||
    image.height % settings.frameHeight !== 0
  ) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent =
      image === null ? t('previewEmpty') : t('animationErrorFrameGrid');
    section.append(empty);
  } else {
    const columns = image.width / settings.frameWidth;
    const rows = image.height / settings.frameHeight;
    const grid = document.createElement('div');
    grid.className = 'animation-frame-grid';
    grid.style.gridTemplateColumns = `repeat(${String(Math.min(columns, 8))}, minmax(5rem, 1fr))`;
    for (let index = 0; index < columns * rows; index += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'animation-frame-button';
      const idleOrder = settings.idleFrames.indexOf(index);
      const movementOrder = settings.movementFrames.indexOf(index);
      const category =
        idleOrder >= 0 ? 'idle' : movementOrder >= 0 ? 'movement' : null;
      if (category !== null) button.dataset.category = category;
      const sourceX = (index % columns) * settings.frameWidth;
      const sourceY = Math.floor(index / columns) * settings.frameHeight;
      const canvas = cropCanvas(
        image,
        sourceX,
        sourceY,
        settings.frameWidth,
        settings.frameHeight,
      );
      const label = document.createElement('span');
      label.textContent = `${t('animationFrameLabel', { index })}${
        category === null
          ? ''
          : ` · ${t(category === 'idle' ? 'animationIdle' : 'animationMovement')} #${String((category === 'idle' ? idleOrder : movementOrder) + 1)}`
      }`;
      button.setAttribute('aria-pressed', String(category !== null));
      button.addEventListener('click', () => {
        options.onFrameToggle(index);
      });
      button.append(canvas, label);
      grid.append(button);
    }
    section.append(grid);
  }

  const orderHeading = document.createElement('h2');
  orderHeading.className = 'animation-order-title';
  orderHeading.textContent = t('animationSelectedFramesTitle');
  const orders = document.createElement('div');
  orders.className = 'animation-orders is-single';
  const activeCategory = settings.selectionTarget;
  orders.append(
    createFrameOrder(
      options,
      activeCategory,
      activeCategory === 'idle' ? settings.idleFrames : settings.movementFrames,
      activeCategory === 'idle'
        ? settings.idleFrameDurations
        : settings.movementFrameDurations,
    ),
  );
  section.append(orderHeading, orders);
  return section;
}

function createAnimationPreview(options: AnimationEditorOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel animation-preview-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('animationPreviewTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('animationPreviewHint');
  section.append(heading, hint);

  const { image, settings } = options;
  const category = settings.selectionTarget;
  const frames =
    category === 'idle' ? settings.idleFrames : settings.movementFrames;
  const durations =
    category === 'idle'
      ? settings.idleFrameDurations
      : settings.movementFrameDurations;
  const defaultDuration =
    category === 'idle' ? settings.idleDuration : settings.movementDuration;
  if (
    image === null ||
    frames.length === 0 ||
    settings.frameWidth <= 0 ||
    settings.frameHeight <= 0 ||
    image.width % settings.frameWidth !== 0 ||
    image.height % settings.frameHeight !== 0
  ) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('animationPreviewEmpty');
    section.append(empty);
    return section;
  }

  const frameColumns = image.width / settings.frameWidth;
  const stage = document.createElement('div');
  stage.className = 'animation-preview-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'animation-preview-canvas';
  canvas.width = settings.frameWidth;
  canvas.height = settings.frameHeight;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('animationPreviewTitle'));
  const meta = document.createElement('strong');
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
  stage.append(canvas, meta, controls);
  section.append(stage);

  let current = 0;
  let playing = true;
  let timer: number | null = null;
  const draw = (): void => {
    const sourceIndex = frames[current] ?? 0;
    const sourceX = (sourceIndex % frameColumns) * settings.frameWidth;
    const sourceY =
      Math.floor(sourceIndex / frameColumns) * settings.frameHeight;
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, canvas.width, canvas.height);
    context?.putImageData(image, -sourceX, -sourceY);
    const duration = durations[current] ?? defaultDuration;
    meta.textContent = t('animationPreviewCurrent', {
      animation: t(category === 'idle' ? 'animationIdle' : 'animationMovement'),
      index: sourceIndex,
      duration,
    });
    play.textContent = t(
      playing ? 'animationPreviewPause' : 'animationPreviewPlay',
    );
  };
  const schedule = (): void => {
    if (!playing) return;
    const duration = durations[current] ?? defaultDuration;
    timer = window.setTimeout(
      () => {
        if (!canvas.isConnected) return;
        current = (current + 1) % frames.length;
        draw();
        schedule();
      },
      (duration * 1000) / 60,
    );
  };
  const stopTimer = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  previous.addEventListener('click', () => {
    stopTimer();
    playing = false;
    current = (current - 1 + frames.length) % frames.length;
    draw();
  });
  next.addEventListener('click', () => {
    stopTimer();
    playing = false;
    current = (current + 1) % frames.length;
    draw();
  });
  play.addEventListener('click', () => {
    playing = !playing;
    stopTimer();
    draw();
    schedule();
  });
  draw();
  schedule();
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
  const heading = document.createElement('h2');
  heading.textContent = t('animationMappingTitle');
  section.append(heading);
  if (options.model === null || options.image === null) {
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
  const image = options.image;
  options.model.animations.forEach((animation) => {
    const animationSection = document.createElement('section');
    animationSection.className = 'animation-mapping-group';
    const title = document.createElement('h3');
    title.textContent = `${animation.name} · ${t(
      animation.category === 'idle' ? 'animationIdle' : 'animationMovement',
    )}`;
    animationSection.append(title);
    animation.frames.forEach((frame, frameOrder) => {
      const article = document.createElement('article');
      article.className = 'animation-frame-mapping';
      const frameTitle = document.createElement('h4');
      frameTitle.textContent = `${t('animationFrameLabel', {
        index: frame.sourceIndex,
      })} · #${String(frameOrder + 1)} · ${String(frame.duration)} ${t(
        'animationDurationUnit',
      )}`;
      const grid = document.createElement('div');
      grid.className = 'animation-tile-map';
      grid.style.gridTemplateColumns = `repeat(${String(animation.widthTiles)}, minmax(5.5rem, 1fr))`;
      for (let row = 0; row < animation.heightTiles; row += 1) {
        for (let column = 0; column < animation.widthTiles; column += 1) {
          const cell = document.createElement('div');
          cell.className = 'animation-tile-cell';
          cell.append(
            cropCanvas(
              image,
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

function downloadButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button primary-button';
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
    stat(t('animationFinalTiles'), String(model.chr.finalTileCount)),
    stat(t('animationRemainingTiles'), String(model.chr.remainingTiles)),
    stat(
      t('animationFinalChrSize'),
      `${String(model.chr.finalSizeBytes)} bytes`,
    ),
  );
  const id = sanitizeCIdentifier(model.name);
  const c = generateCAnimationExport(model);
  const asm = generateCa65AnimationExport(model);
  const actions = document.createElement('div');
  actions.className = 'export-actions';
  actions.append(
    downloadButton(t('animationDownloadChr'), () => {
      options.onDownloadBytes(model.finalChr, model.chr.output);
    }),
    downloadButton(t('animationDownloadPalette'), () => {
      options.onDownloadBytes(
        encodeNesBackgroundPalettes(options.paletteSet),
        `${id}_sprite.pal`,
      );
    }),
    downloadButton(t('animationDownloadJson'), () => {
      options.onDownloadText(
        serializeAnimationMetadata(model),
        `${id}_animation.json`,
      );
    }),
    downloadButton(t('animationDownloadCHeader'), () => {
      options.onDownloadText(c.header, c.headerFileName);
    }),
    downloadButton(t('animationDownloadCSource'), () => {
      options.onDownloadText(c.source, c.sourceFileName);
    }),
    downloadButton(t('animationDownloadAsmInclude'), () => {
      options.onDownloadText(asm.include, asm.includeFileName);
    }),
    downloadButton(t('animationDownloadAsmSource'), () => {
      options.onDownloadText(asm.source, asm.sourceFileName);
    }),
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
  return [
    createConfiguration(options),
    createSpritePaletteEditor(options),
    createFrameGrid(options),
    createAnimationPreview(options),
    createMapping(options),
    createExports(options),
  ];
}
