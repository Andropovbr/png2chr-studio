import { t } from '../i18n';

export interface InspectorOptions {
  readonly title?: string;
  readonly content?: HTMLElement | null;
  readonly emptyMessage?: string;
  readonly onClose?: () => void;
}

export function createInspector(options: InspectorOptions = {}): HTMLElement {
  const panel = document.createElement('section');
  const hasContent = Boolean(options.content);
  panel.className = `panel inspector-panel${hasContent ? '' : ' is-empty'}`;
  panel.setAttribute('aria-label', options.title ?? t('inspectorLabel'));

  const header = document.createElement('div');
  header.className = 'inspector-header';

  const heading = document.createElement('h2');
  heading.className = 'inspector-title';
  heading.textContent = options.title ?? t('inspectorTitle');
  header.append(heading);

  if (options.onClose) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'inspector-close-btn';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close inspector');
    closeBtn.addEventListener('click', options.onClose);
    header.append(closeBtn);
  }

  panel.append(header);

  if (options.content) {
    panel.append(options.content);
  } else {
    const placeholder = document.createElement('p');
    placeholder.className = 'inspector-placeholder muted';
    placeholder.textContent = options.emptyMessage ?? t('inspectorEmpty');
    panel.append(placeholder);
  }

  return panel;
}
