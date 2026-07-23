import { t } from '../i18n';
import type { ProjectMode } from './types';

export function createImageInput(
  fileName: string | null,
  width: number | null,
  height: number | null,
  loading: boolean,
  mode: ProjectMode,
  onModeChange: (mode: ProjectMode) => void,
  onFile: (file: File) => void,
  onGeneratePlayfield: () => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel import-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('importTitle');

  const modeSelector = document.createElement('fieldset');
  modeSelector.className = 'mode-selector';
  const modeLegend = document.createElement('legend');
  modeLegend.textContent = t('imageModeLabel');
  modeSelector.append(modeLegend);
  const modes: readonly [ProjectMode, 'tilesetMode' | 'playfieldMode'][] = [
    ['tileset', 'tilesetMode'],
    ['playfield', 'playfieldMode'],
  ];
  modes.forEach(([value, labelKey]) => {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'image-mode';
    radio.value = value;
    radio.checked = mode === value;
    radio.addEventListener('change', () => {
      if (radio.checked) {
        onModeChange(value);
      }
    });
    const text = document.createElement('span');
    text.textContent = t(labelKey);
    label.append(radio, text);
    modeSelector.append(label);
  });
  const modeHint = document.createElement('small');
  modeHint.textContent =
    mode === 'playfield' ? t('playfieldModeHint') : t('tilesetModeHint');
  modeSelector.append(modeHint);

  const randomGenerator = document.createElement('div');
  randomGenerator.className = 'random-playfield-generator';
  const randomButton = document.createElement('button');
  randomButton.type = 'button';
  randomButton.className = 'button secondary-button';
  randomButton.textContent = t('generateRandomPlayfield');
  randomButton.disabled = loading;
  randomButton.addEventListener('click', onGeneratePlayfield);
  const randomHint = document.createElement('small');
  randomHint.textContent = t('randomPlayfieldHint');
  randomGenerator.append(randomButton, randomHint);

  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone';
  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'asset-input';
  input.accept =
    mode === 'playfield' ? 'image/png,.png' : 'image/png,.png,.chr';
  input.className = 'visually-hidden';

  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.className = 'button primary-button';
  label.textContent =
    mode === 'playfield' ? t('choosePng') : t('choosePngOrChr');
  const prompt = document.createElement('span');
  prompt.textContent =
    mode === 'playfield' ? t('dropPngPrompt') : t('dropPrompt');
  const privacy = document.createElement('small');
  privacy.textContent = t('processingLocal');

  const submitFile = (file: File | undefined): void => {
    if (file !== undefined) {
      onFile(file);
    }
  };
  input.addEventListener('change', () => {
    submitFile(input.files?.[0]);
  });
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('is-dragging');
  });
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
    submitFile(event.dataTransfer?.files[0]);
  });

  dropZone.append(input, label, prompt, privacy);
  section.append(heading, modeSelector);
  if (mode === 'playfield') {
    section.append(randomGenerator);
  }
  section.append(dropZone);

  if (fileName !== null) {
    const details = document.createElement('p');
    details.className = 'file-details';
    details.setAttribute('aria-live', 'polite');
    details.textContent = loading
      ? t('loadingImage', { name: fileName })
      : width !== null && height !== null
        ? t('fileDetails', { name: fileName, width, height })
        : fileName;
    section.append(details);
  }

  return section;
}
