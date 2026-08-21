import { t } from '../i18n';

export interface InspectorOptions {
  readonly title?: string;
  readonly content?: HTMLElement | null;
  readonly emptyMessage?: string;
}

export function createInspector(options: InspectorOptions = {}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel inspector-panel';
  panel.setAttribute('aria-label', options.title ?? t('inspectorLabel'));

  const heading = document.createElement('h2');
  heading.className = 'inspector-title';
  heading.textContent = options.title ?? t('inspectorTitle');
  panel.append(heading);

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
