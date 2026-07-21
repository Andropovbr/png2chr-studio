import { t } from '../i18n';

export function createImageInput(
  fileName: string | null,
  width: number | null,
  height: number | null,
  loading: boolean,
  onFile: (file: File) => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel import-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('importTitle');

  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone';
  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'png-input';
  input.accept = 'image/png,.png';
  input.className = 'visually-hidden';

  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.className = 'button primary-button';
  label.textContent = t('choosePng');
  const prompt = document.createElement('span');
  prompt.textContent = t('dropPrompt');
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
  section.append(heading, dropZone);

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
