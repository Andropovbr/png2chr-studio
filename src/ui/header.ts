import { getLocale, setLocale, t, type Locale } from '../i18n';

export interface HeaderOptions {
  projectName?: string;
  isDirty?: boolean;
  onProjectNameChange?: (name: string) => void;
  onNewProject?: () => void;
  onOpenProject?: (file: File) => void;
  onSaveProject?: () => void;
  onSaveProjectAs?: () => void;
}

export function createHeader(options: HeaderOptions = {}): HTMLElement {
  const header = document.createElement('header');
  header.className = 'app-header';

  const branding = document.createElement('div');
  branding.className = 'app-branding';
  const heading = document.createElement('h1');
  heading.textContent = t('appTitle');
  const description = document.createElement('p');
  description.textContent = t('appDescription');
  branding.append(heading, description);

  const controls = document.createElement('div');
  controls.className = 'app-header-controls';

  if (options.onNewProject !== undefined || options.projectName !== undefined) {
    const projectGroup = document.createElement('div');
    projectGroup.className = 'project-control-group';

    const projectMeta = document.createElement('div');
    projectMeta.className = 'project-meta';

    const nameLabel = document.createElement('label');
    nameLabel.htmlFor = 'project-name-input';
    nameLabel.className = 'project-name-label';
    nameLabel.textContent = t('projectNameLabel');

    const inputRow = document.createElement('div');
    inputRow.className = 'project-name-input-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'project-name-input';
    nameInput.className = 'project-name-input';
    nameInput.value = options.projectName ?? t('defaultProjectName');
    nameInput.placeholder = t('defaultProjectName');
    nameInput.addEventListener('change', () => {
      const val = nameInput.value.trim();
      if (val && options.onProjectNameChange) {
        options.onProjectNameChange(val);
      }
    });

    const dirtyBadge = document.createElement('span');
    dirtyBadge.className = `project-dirty-badge${options.isDirty ? ' is-dirty' : ''}`;
    dirtyBadge.textContent = options.isDirty ? '*' : '';
    dirtyBadge.title = options.isDirty ? t('projectUnsavedBadge') : '';
    dirtyBadge.setAttribute(
      'aria-label',
      options.isDirty ? t('projectUnsavedBadge') : '',
    );

    inputRow.append(nameInput, dirtyBadge);
    projectMeta.append(nameLabel, inputRow);

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'project-actions';

    if (options.onNewProject) {
      const newBtn = document.createElement('button');
      newBtn.type = 'button';
      newBtn.id = 'btn-new-project';
      newBtn.className = 'button secondary-button project-btn';
      newBtn.textContent = t('newProject');
      newBtn.addEventListener('click', options.onNewProject);
      buttonGroup.append(newBtn);
    }

    if (options.onOpenProject) {
      const openInput = document.createElement('input');
      openInput.type = 'file';
      openInput.id = 'project-file-input';
      openInput.accept = '.p2c,.p2c.json,.json';
      openInput.className = 'visually-hidden';
      openInput.addEventListener('change', () => {
        const file = openInput.files?.[0];
        if (file && options.onOpenProject) {
          options.onOpenProject(file);
          openInput.value = '';
        }
      });

      const openLabel = document.createElement('label');
      openLabel.htmlFor = 'project-file-input';
      openLabel.id = 'btn-open-project';
      openLabel.className = 'button secondary-button project-btn';
      openLabel.textContent = t('openProject');

      buttonGroup.append(openInput, openLabel);
    }

    if (options.onSaveProject) {
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.id = 'btn-save-project';
      saveBtn.className = 'button primary-button project-btn';
      saveBtn.textContent = t('saveProject');
      saveBtn.addEventListener('click', options.onSaveProject);
      buttonGroup.append(saveBtn);
    }

    if (options.onSaveProjectAs) {
      const saveAsBtn = document.createElement('button');
      saveAsBtn.type = 'button';
      saveAsBtn.id = 'btn-save-project-as';
      saveAsBtn.className = 'button secondary-button project-btn';
      saveAsBtn.textContent = t('saveProjectAs');
      saveAsBtn.addEventListener('click', options.onSaveProjectAs);
      buttonGroup.append(saveAsBtn);
    }

    projectGroup.append(projectMeta, buttonGroup);
    controls.append(projectGroup);
  }

  const languageGroup = document.createElement('div');
  languageGroup.className = 'language-control';
  const label = document.createElement('label');
  label.htmlFor = 'language-select';
  label.textContent = t('languageLabel');
  const select = document.createElement('select');
  select.id = 'language-select';

  const localeOptions: readonly [Locale, string][] = [
    ['pt-BR', t('localePtBr')],
    ['en', t('localeEn')],
  ];
  localeOptions.forEach(([locale, text]) => {
    const option = document.createElement('option');
    option.value = locale;
    option.textContent = text;
    select.append(option);
  });
  select.value = getLocale();
  select.addEventListener('change', () => {
    setLocale(select.value === 'pt-BR' ? 'pt-BR' : 'en');
  });

  languageGroup.append(label, select);
  controls.append(languageGroup);

  header.append(branding, controls);
  return header;
}
