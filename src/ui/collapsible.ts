export interface CollapsibleOptions {
  readonly id?: string;
  readonly panelClassName?: string;
  readonly title: string;
  readonly isCollapsed: boolean;
  readonly onToggle: () => void;
  readonly summary?: HTMLElement | string | null;
  readonly children?: readonly HTMLElement[];
}

export function createCollapsiblePanel(
  options: CollapsibleOptions,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel collapsible-panel';
  if (options.panelClassName !== undefined) {
    section.classList.add(options.panelClassName);
  }
  if (options.id !== undefined) {
    section.id = options.id;
  }
  section.classList.toggle('is-collapsed', options.isCollapsed);

  const header = document.createElement('div');
  header.className = 'collapsible-header';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'collapsible-toggle';
  toggleBtn.textContent = options.isCollapsed ? '▶' : '▼';
  toggleBtn.setAttribute('aria-expanded', String(!options.isCollapsed));
  toggleBtn.addEventListener('click', options.onToggle);

  const title = document.createElement('h2');
  title.className = 'collapsible-title';
  title.textContent = options.title;
  title.addEventListener('click', options.onToggle);

  header.append(toggleBtn, title);

  if (options.summary !== undefined && options.summary !== null) {
    const summary = document.createElement('div');
    summary.className = 'collapsible-summary';
    if (typeof options.summary === 'string') {
      const text = document.createElement('span');
      text.textContent = options.summary;
      summary.append(text);
    } else {
      summary.append(options.summary);
    }
    summary.addEventListener('click', options.onToggle);
    header.append(summary);
  }

  section.append(header);

  if (!options.isCollapsed) {
    const body = document.createElement('div');
    body.className = 'collapsible-body';
    body.append(...(options.children ?? []));
    section.append(body);
  }

  return section;
}
