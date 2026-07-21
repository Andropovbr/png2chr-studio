import { t } from '../i18n';

export function createImagePreview(image: ImageData | null): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel preview-panel';
  const heading = document.createElement('h2');
  heading.textContent = t('previewTitle');
  section.append(heading);

  if (image === null) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('previewEmpty');
    section.append(empty);
    return section;
  }

  const frame = document.createElement('div');
  frame.className = 'preview-frame checkerboard';
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('previewCanvasLabel'));
  canvas.getContext('2d')?.putImageData(image, 0, 0);
  frame.append(canvas);
  section.append(frame);
  return section;
}
