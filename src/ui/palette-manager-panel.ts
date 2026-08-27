import { NES_MASTER_PALETTE } from '../core/nes-palette';
import {
  findPaletteUsageReferences,
  formatPaletteDiagnosticMessage,
  type ActivePaletteSlots,
  type PaletteDefinition,
  type PaletteDiagnosticFact,
  type PaletteTarget,
  type PaletteUsageReference,
  type PaletteUsageSearchContext,
} from '../core/palette-manager';
import { t } from '../i18n';

export type PaletteLibraryFilter = 'all' | 'sprite' | 'background' | 'in-use';

export interface PaletteManagerPanelOptions {
  readonly palettes: readonly PaletteDefinition[];
  readonly universalBackgroundColor: number;
  readonly activeBackgroundSlots: ActivePaletteSlots;
  readonly activeSpriteSlots: ActivePaletteSlots;
  readonly usageContext: PaletteUsageSearchContext;
  readonly diagnostics: readonly PaletteDiagnosticFact[];
  readonly selectedPaletteId: string | null;
  readonly filter: PaletteLibraryFilter;
  readonly onCreatePalette: (name?: string) => void;
  readonly onUpdatePaletteName: (paletteId: string, name: string) => void;
  readonly onUpdatePaletteColor: (
    paletteId: string,
    colorSlotIndex: number,
    colorCode: number,
  ) => void;
  readonly onUpdatePaletteTarget: (
    paletteId: string,
    target: PaletteTarget,
  ) => void;
  readonly onUpdateUniversalBackgroundColor: (colorCode: number) => void;
  readonly onDuplicatePalette: (paletteId: string) => void;
  readonly onDeletePalette: (paletteId: string) => void;
  readonly onAssignBackgroundSlot: (
    slotIndex: 0 | 1 | 2 | 3,
    paletteId: string | null,
  ) => void;
  readonly onAssignSpriteSlot: (
    slotIndex: 0 | 1 | 2 | 3,
    paletteId: string | null,
  ) => void;
  readonly onSelectPalette: (paletteId: string | null) => void;
  readonly onFilterChange: (filter: PaletteLibraryFilter) => void;
}

interface MasterPaletteDialogController {
  readonly dialog: HTMLDialogElement;
  readonly openFor: (options: {
    readonly title: string;
    readonly currentCode: number;
    readonly onSelect: (code: number) => void;
    readonly returnFocus: HTMLElement;
  }) => void;
}

const SLOT_INDICES = [0, 1, 2, 3] as const;
const COLOR_INDICES = [0, 1, 2, 3] as const;

function hexadecimal(code: number): string {
  return `$${code.toString(16).toUpperCase().padStart(2, '0')}`;
}

function cssColor(code: number): string {
  const color = NES_MASTER_PALETTE[code] ?? { red: 0, green: 0, blue: 0 };
  return `rgb(${String(color.red)} ${String(color.green)} ${String(color.blue)})`;
}

function targetLabel(target: PaletteTarget | undefined): string {
  switch (target) {
    case 'sprite':
      return t('paletteManagerTargetSprite');
    case 'background':
      return t('paletteManagerTargetBackground');
    case 'shared':
    case undefined:
      return t('paletteManagerTargetShared');
  }
}

function diagnosticReferencesPalette(
  diagnostic: PaletteDiagnosticFact,
  paletteId: string,
): boolean {
  if ('paletteId' in diagnostic && diagnostic.paletteId === paletteId) {
    return true;
  }
  return (
    diagnostic.kind === 'slot-capacity-exceeded' &&
    diagnostic.distinctPaletteIds.includes(paletteId)
  );
}

function diagnosticSuggestion(diagnostic: PaletteDiagnosticFact): string {
  switch (diagnostic.kind) {
    case 'dangling-palette-reference':
      return t('paletteManagerSuggestionDangling');
    case 'unassigned-active-slot':
      return t('paletteManagerSuggestionUnassigned');
    case 'slot-capacity-exceeded':
      return t('paletteManagerSuggestionCapacity');
    case 'invalid-nes-color':
      return t('paletteManagerSuggestionInvalidColor');
    case 'inconsistent-universal-color':
      return t('paletteManagerSuggestionUniversal');
  }
}

export function createMasterPaletteDialog(): MasterPaletteDialogController {
  const dialog = document.createElement('dialog');
  dialog.className = 'nes-master-dialog';
  dialog.setAttribute('aria-labelledby', 'palette-master-dialog-title');

  const form = document.createElement('form');
  form.method = 'dialog';
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'nes-master-palette';
  const legend = document.createElement('legend');
  legend.id = 'palette-master-dialog-title';
  legend.textContent = t('nesMasterPaletteTitle');
  const target = document.createElement('p');
  target.className = 'nes-color-target';
  const grid = document.createElement('div');
  grid.className = 'nes-color-grid';
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', t('nesMasterPaletteTitle'));
  const closeButton = document.createElement('button');
  closeButton.type = 'submit';
  closeButton.className = 'button secondary-button';
  closeButton.textContent = t('nesMasterPaletteClose');

  let returnFocus: HTMLElement | null = null;
  let selectColor: ((code: number) => void) | null = null;

  dialog.addEventListener('close', () => {
    selectColor = null;
    const targetElement = returnFocus;
    returnFocus = null;
    targetElement?.focus();
  });

  const openFor: MasterPaletteDialogController['openFor'] = (options) => {
    target.textContent = `${options.title} (${hexadecimal(options.currentCode)})`;
    returnFocus = options.returnFocus;
    selectColor = options.onSelect;
    grid.replaceChildren();

    let selectedButton: HTMLButtonElement | null = null;
    NES_MASTER_PALETTE.forEach((_color, colorCode) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nes-color-button';
      button.style.backgroundColor = cssColor(colorCode);
      button.title = hexadecimal(colorCode);
      button.setAttribute('role', 'gridcell');
      button.setAttribute(
        'aria-label',
        t('nesColorButton', { code: hexadecimal(colorCode) }),
      );
      if (colorCode === options.currentCode) {
        button.setAttribute('aria-current', 'true');
        selectedButton = button;
      }
      button.addEventListener('click', () => {
        const callback = selectColor;
        dialog.close();
        callback?.(colorCode);
      });
      grid.append(button);
    });

    if (!dialog.open) {
      dialog.showModal();
    }
    queueMicrotask(() => selectedButton?.focus());
  };

  fieldset.append(legend, target, grid);
  form.append(fieldset, closeButton);
  dialog.append(form);
  return { dialog, openFor };
}

function createDeleteDialog(onDeletePalette: (paletteId: string) => void): {
  readonly dialog: HTMLDialogElement;
  readonly openFor: (
    palette: PaletteDefinition,
    references: readonly PaletteUsageReference[],
    trigger: HTMLElement,
  ) => void;
} {
  const dialog = document.createElement('dialog');
  dialog.className = 'palette-delete-dialog';
  dialog.setAttribute('aria-labelledby', 'palette-delete-dialog-title');
  dialog.setAttribute('aria-describedby', 'palette-delete-dialog-description');

  const form = document.createElement('form');
  form.method = 'dialog';
  const title = document.createElement('h3');
  title.id = 'palette-delete-dialog-title';
  const description = document.createElement('p');
  description.id = 'palette-delete-dialog-description';
  const usageList = document.createElement('ul');
  usageList.className = 'palette-delete-usage-list';
  const actions = document.createElement('div');
  actions.className = 'palette-dialog-actions';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'submit';
  cancelButton.className = 'button secondary-button';
  cancelButton.textContent = t('paletteManagerCancel');
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'button danger-button';
  deleteButton.textContent = t('paletteManagerDelete');
  actions.append(cancelButton, deleteButton);
  form.append(title, description, usageList, actions);
  dialog.append(form);

  let returnFocus: HTMLElement | null = null;
  let pendingPaletteId: string | null = null;
  let deletionAllowed = false;

  dialog.addEventListener('close', () => {
    const targetElement = returnFocus;
    returnFocus = null;
    pendingPaletteId = null;
    deletionAllowed = false;
    targetElement?.focus();
  });

  deleteButton.addEventListener('click', () => {
    if (!deletionAllowed || pendingPaletteId === null) return;
    const paletteId = pendingPaletteId;
    dialog.close();
    onDeletePalette(paletteId);
  });

  const openFor = (
    palette: PaletteDefinition,
    references: readonly PaletteUsageReference[],
    trigger: HTMLElement,
  ): void => {
    returnFocus = trigger;
    pendingPaletteId = palette.id;
    deletionAllowed = references.length === 0;
    title.textContent = t('paletteManagerDeleteDialogTitle', {
      name: palette.name,
    });
    description.textContent =
      references.length === 0
        ? t('paletteManagerDeleteUnusedDescription')
        : t('paletteManagerDeleteBlockedDescription', {
            count: references.length,
          });
    usageList.replaceChildren();
    for (const reference of references) {
      const item = document.createElement('li');
      const detail = reference.detail ? ` — ${reference.detail}` : '';
      item.textContent = `${reference.name}${detail}`;
      usageList.append(item);
    }
    usageList.hidden = references.length === 0;
    deleteButton.hidden = references.length > 0;
    deleteButton.disabled = references.length > 0;
    cancelButton.textContent =
      references.length === 0
        ? t('paletteManagerCancel')
        : t('paletteManagerClose');
    dialog.showModal();
    queueMicrotask(() => {
      cancelButton.focus();
    });
  };

  return { dialog, openFor };
}

function createResolvedSwatch(
  code: number,
  label: string,
  extraClass?: string,
): HTMLElement {
  const swatch = document.createElement('span');
  swatch.className = `active-slot-swatch${extraClass ? ` ${extraClass}` : ''}`;
  swatch.style.backgroundColor = cssColor(code);
  swatch.title = label;
  swatch.setAttribute('aria-label', label);
  return swatch;
}

function createHardwareBank(options: {
  readonly bank: 'background' | 'sprite';
  readonly palettes: readonly PaletteDefinition[];
  readonly slots: ActivePaletteSlots;
  readonly universalBackgroundColor: number;
  readonly diagnostics: readonly PaletteDiagnosticFact[];
  readonly onAssign: (
    slotIndex: 0 | 1 | 2 | 3,
    paletteId: string | null,
  ) => void;
}): HTMLElement {
  const section = document.createElement('section');
  section.className = `palette-hardware-bank palette-${options.bank}-bank`;

  const header = document.createElement('div');
  header.className = 'palette-bank-header';
  const heading = document.createElement('h3');
  heading.textContent =
    options.bank === 'background'
      ? t('paletteManagerBackgroundBankTitle')
      : t('paletteManagerSpriteBankTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent =
    options.bank === 'background'
      ? t('paletteManagerBackgroundBankHint')
      : t('paletteManagerSpriteBankHint');
  header.append(heading, hint);

  const grid = document.createElement('div');
  grid.className = 'active-slots-grid';
  for (const slotIndex of SLOT_INDICES) {
    const paletteId = options.slots[slotIndex];
    const palette = options.palettes.find((item) => item.id === paletteId);
    const card = document.createElement('article');
    card.className = 'active-slot-card';
    card.setAttribute('data-bank', options.bank);
    card.setAttribute('data-slot-index', String(slotIndex));

    const label = document.createElement('label');
    const selectId = `palette-${options.bank}-slot-${String(slotIndex)}`;
    label.className = 'active-slot-label';
    label.htmlFor = selectId;
    label.textContent = t('paletteManagerSlotLabel', { index: slotIndex });

    const select = document.createElement('select');
    select.id = selectId;
    select.className = 'active-slot-select';
    select.setAttribute(
      'aria-label',
      `${heading.textContent} — ${label.textContent}`,
    );
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = t('paletteManagerSlotEmpty');
    select.append(emptyOption);
    for (const definition of options.palettes) {
      const item = document.createElement('option');
      item.value = definition.id;
      item.textContent = `${definition.name} — ${targetLabel(definition.target)}`;
      item.selected = definition.id === paletteId;
      select.append(item);
    }
    if (paletteId !== null && palette === undefined) {
      const missing = document.createElement('option');
      missing.value = paletteId;
      missing.textContent = t('paletteManagerMissingPalette', {
        paletteId,
      });
      missing.selected = true;
      select.append(missing);
    }
    select.addEventListener('change', () => {
      const selectedId = select.value.trim();
      options.onAssign(slotIndex, selectedId === '' ? null : selectedId);
    });

    const swatches = document.createElement('div');
    swatches.className = 'active-slot-swatches';
    swatches.setAttribute('role', 'list');
    if (options.bank === 'background') {
      swatches.append(
        createResolvedSwatch(
          options.universalBackgroundColor,
          t('paletteManagerUniversalSwatchLabel', {
            code: hexadecimal(options.universalBackgroundColor),
          }),
          'is-universal-background',
        ),
      );
      for (const colorIndex of [1, 2, 3] as const) {
        const code = palette?.colors[colorIndex] ?? 0x0f;
        swatches.append(
          createResolvedSwatch(
            code,
            t('paletteManagerColorAriaLabel', {
              index: colorIndex,
              code: hexadecimal(code),
            }),
            palette ? undefined : 'is-empty-slot',
          ),
        );
      }
    } else {
      const transparent = document.createElement('span');
      transparent.className = 'active-slot-swatch is-transparent-slot';
      transparent.title = t('paletteManagerTransparent');
      transparent.setAttribute(
        'aria-label',
        t('paletteManagerTransparentAriaLabel'),
      );
      swatches.append(transparent);
      for (const colorIndex of [1, 2, 3] as const) {
        const code = palette?.colors[colorIndex] ?? 0x0f;
        swatches.append(
          createResolvedSwatch(
            code,
            t('paletteManagerColorAriaLabel', {
              index: colorIndex,
              code: hexadecimal(code),
            }),
            palette ? undefined : 'is-empty-slot',
          ),
        );
      }
    }

    const semanticNote = document.createElement('small');
    semanticNote.className = 'palette-slot-semantic-note';
    semanticNote.textContent =
      options.bank === 'background'
        ? t('paletteManagerUniversalBadge')
        : t('paletteManagerTransparent');

    const hasWarning = options.diagnostics.some(
      (fact) =>
        fact.severity === 'warning' &&
        paletteId !== null &&
        diagnosticReferencesPalette(fact, paletteId),
    );
    if (hasWarning) {
      const warning = document.createElement('span');
      warning.className = 'palette-slot-warning';
      warning.textContent = t('paletteManagerWarningBadge');
      card.append(label, select, swatches, semanticNote, warning);
    } else {
      card.append(label, select, swatches, semanticNote);
    }
    grid.append(card);
  }

  section.append(header, grid);
  return section;
}

function filterPalette(
  palette: PaletteDefinition,
  filter: PaletteLibraryFilter,
  references: readonly PaletteUsageReference[],
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'sprite':
      return palette.target !== 'background';
    case 'background':
      return palette.target !== 'sprite';
    case 'in-use':
      return references.length > 0;
  }
}

function createInspector(
  options: PaletteManagerPanelOptions,
  selectedPalette: PaletteDefinition | null,
  references: readonly PaletteUsageReference[],
): HTMLElement {
  const inspector = document.createElement('aside');
  inspector.className = 'palette-usage-inspector';
  inspector.setAttribute('aria-labelledby', 'palette-inspector-title');
  const heading = document.createElement('h3');
  heading.id = 'palette-inspector-title';
  heading.textContent = t('paletteManagerInspectorTitle');
  inspector.append(heading);

  if (selectedPalette === null) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = t('paletteManagerInspectorEmpty');
    inspector.append(empty);
    return inspector;
  }

  const name = document.createElement('strong');
  name.className = 'palette-inspector-name';
  name.setAttribute('data-palette-inspector-name', selectedPalette.id);
  name.textContent = selectedPalette.name;
  const id = document.createElement('code');
  id.className = 'palette-inspector-id';
  id.textContent = selectedPalette.id;

  const targetGroup = document.createElement('div');
  targetGroup.className = 'palette-inspector-field';
  const targetLabelElement = document.createElement('label');
  targetLabelElement.htmlFor = 'palette-inspector-target';
  targetLabelElement.textContent = t('paletteManagerInspectorTarget');
  const targetSelect = document.createElement('select');
  targetSelect.id = 'palette-inspector-target';
  targetSelect.className = 'active-slot-select palette-target-select';
  for (const target of ['shared', 'background', 'sprite'] as const) {
    const item = document.createElement('option');
    item.value = target;
    item.textContent = targetLabel(target);
    item.selected = (selectedPalette.target ?? 'shared') === target;
    targetSelect.append(item);
  }
  targetSelect.addEventListener('change', () => {
    const target = targetSelect.value;
    if (target === 'sprite' || target === 'background' || target === 'shared') {
      options.onUpdatePaletteTarget(selectedPalette.id, target);
    }
  });
  targetGroup.append(targetLabelElement, targetSelect);

  const bankHeading = document.createElement('h4');
  bankHeading.textContent = t('paletteManagerInspectorBanks');
  const bankList = document.createElement('ul');
  bankList.className = 'palette-inspector-list';
  const backgroundSlots = SLOT_INDICES.filter(
    (slot) => options.activeBackgroundSlots[slot] === selectedPalette.id,
  );
  const spriteSlots = SLOT_INDICES.filter(
    (slot) => options.activeSpriteSlots[slot] === selectedPalette.id,
  );
  if (backgroundSlots.length === 0 && spriteSlots.length === 0) {
    const item = document.createElement('li');
    item.textContent = t('paletteManagerInspectorNoSlots');
    bankList.append(item);
  } else {
    for (const slot of backgroundSlots) {
      const item = document.createElement('li');
      item.textContent = `${t('paletteBankBackground')} — ${t('paletteManagerSlotLabel', { index: slot })}`;
      bankList.append(item);
    }
    for (const slot of spriteSlots) {
      const item = document.createElement('li');
      item.textContent = `${t('paletteBankSprite')} — ${t('paletteManagerSlotLabel', { index: slot })}`;
      bankList.append(item);
    }
  }

  const usageHeading = document.createElement('h4');
  usageHeading.textContent = t('paletteManagerInspectorUsage');
  const usageList = document.createElement('ul');
  usageList.className = 'palette-inspector-list palette-inspector-usage-list';
  if (references.length === 0) {
    const item = document.createElement('li');
    item.textContent = t('paletteManagerInspectorNoUsage');
    usageList.append(item);
  } else {
    for (const reference of references) {
      const item = document.createElement('li');
      const type = document.createElement('strong');
      type.textContent = reference.type;
      const detail = reference.detail ? ` — ${reference.detail}` : '';
      item.append(type, `: ${reference.name}${detail}`);
      usageList.append(item);
    }
  }

  const relatedDiagnostics = options.diagnostics.filter((diagnostic) =>
    diagnosticReferencesPalette(diagnostic, selectedPalette.id),
  );
  const diagnosticsHeading = document.createElement('h4');
  diagnosticsHeading.textContent = t('paletteManagerInspectorDiagnostics');
  const diagnosticsList = document.createElement('ul');
  diagnosticsList.className =
    'palette-inspector-list palette-inspector-diagnostics-list';
  if (relatedDiagnostics.length === 0) {
    const item = document.createElement('li');
    item.textContent = t('paletteManagerInspectorNoDiagnostics');
    diagnosticsList.append(item);
  } else {
    for (const diagnostic of relatedDiagnostics) {
      const item = document.createElement('li');
      item.className = `palette-diagnostic palette-diagnostic-${diagnostic.severity}`;
      const severity = document.createElement('strong');
      severity.textContent =
        diagnostic.severity === 'error'
          ? t('paletteManagerSeverityError')
          : t('paletteManagerSeverityWarning');
      const message = document.createElement('span');
      message.textContent = formatPaletteDiagnosticMessage(diagnostic);
      const suggestion = document.createElement('small');
      suggestion.textContent = diagnosticSuggestion(diagnostic);
      item.append(severity, message, suggestion);
      diagnosticsList.append(item);
    }
  }

  inspector.append(
    name,
    id,
    targetGroup,
    bankHeading,
    bankList,
    usageHeading,
    usageList,
    diagnosticsHeading,
    diagnosticsList,
  );
  return inspector;
}

export function createPaletteManagerPanel(
  options: PaletteManagerPanelOptions,
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel palette-manager-panel';

  const masterDialog = createMasterPaletteDialog();
  const deleteDialog = createDeleteDialog(options.onDeletePalette);

  const header = document.createElement('header');
  header.className = 'palette-manager-header';
  const titleGroup = document.createElement('div');
  const heading = document.createElement('h2');
  heading.textContent = t('paletteManagerTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('paletteManagerHint');
  titleGroup.append(heading, hint);
  const newPaletteButton = document.createElement('button');
  newPaletteButton.type = 'button';
  newPaletteButton.className = 'button primary-button palette-new-button';
  newPaletteButton.textContent = t('paletteManagerNewPalette');
  newPaletteButton.addEventListener('click', () => {
    options.onCreatePalette();
  });
  header.append(titleGroup, newPaletteButton);

  const toolbar = document.createElement('div');
  toolbar.className = 'palette-toolbar';
  toolbar.setAttribute('aria-label', t('paletteManagerToolbarLabel'));

  const universalGroup = document.createElement('div');
  universalGroup.className = 'palette-universal-control';
  const universalText = document.createElement('div');
  const universalTitle = document.createElement('strong');
  universalTitle.textContent = t('paletteManagerUniversalTitle');
  const universalHint = document.createElement('small');
  universalHint.textContent = t('paletteManagerUniversalHint');
  universalText.append(universalTitle, universalHint);
  const universalButton = document.createElement('button');
  universalButton.type = 'button';
  universalButton.className = 'palette-universal-button';
  universalButton.setAttribute(
    'aria-label',
    t('paletteManagerEditUniversalAriaLabel', {
      code: hexadecimal(options.universalBackgroundColor),
    }),
  );
  universalButton.append(
    createResolvedSwatch(
      options.universalBackgroundColor,
      t('paletteManagerUniversalSwatchLabel', {
        code: hexadecimal(options.universalBackgroundColor),
      }),
      'is-universal-background',
    ),
  );
  const universalCode = document.createElement('code');
  universalCode.textContent = hexadecimal(options.universalBackgroundColor);
  universalButton.append(universalCode);
  universalButton.addEventListener('click', () => {
    masterDialog.openFor({
      title: t('paletteManagerUniversalTitle'),
      currentCode: options.universalBackgroundColor,
      onSelect: options.onUpdateUniversalBackgroundColor,
      returnFocus: universalButton,
    });
  });
  universalGroup.append(universalText, universalButton);

  const filterGroup = document.createElement('div');
  filterGroup.className = 'palette-filter-group';
  filterGroup.setAttribute('role', 'group');
  filterGroup.setAttribute('aria-label', t('paletteManagerFilterLabel'));
  const filters: readonly [PaletteLibraryFilter, string][] = [
    ['all', t('paletteManagerFilterAll')],
    ['sprite', t('paletteManagerFilterSprites')],
    ['background', t('paletteManagerFilterBackgrounds')],
    ['in-use', t('paletteManagerFilterInUse')],
  ];
  for (const [filter, label] of filters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button secondary-button palette-filter-button${options.filter === filter ? ' is-active' : ''}`;
    button.textContent = label;
    button.setAttribute('aria-pressed', String(options.filter === filter));
    button.setAttribute('data-filter', filter);
    button.addEventListener('click', () => {
      options.onFilterChange(filter);
    });
    filterGroup.append(button);
  }
  toolbar.append(universalGroup, filterGroup);

  const banks = document.createElement('div');
  banks.className = 'palette-banks';
  const backgroundBank = createHardwareBank({
    bank: 'background',
    palettes: options.palettes,
    slots: options.activeBackgroundSlots,
    universalBackgroundColor: options.universalBackgroundColor,
    diagnostics: options.diagnostics,
    onAssign: options.onAssignBackgroundSlot,
  });
  backgroundBank.id = 'section-background-palette-bank';
  const spriteBank = createHardwareBank({
    bank: 'sprite',
    palettes: options.palettes,
    slots: options.activeSpriteSlots,
    universalBackgroundColor: options.universalBackgroundColor,
    diagnostics: options.diagnostics,
    onAssign: options.onAssignSpriteSlot,
  });
  spriteBank.id = 'section-sprite-palette-bank';
  banks.append(backgroundBank, spriteBank);

  const content = document.createElement('div');
  content.className = 'palette-library-layout';
  const listSection = document.createElement('section');
  listSection.className = 'palette-definitions-section';
  listSection.id = 'section-palette-definitions';
  const listHeader = document.createElement('div');
  listHeader.className = 'palette-definitions-header';
  const listTitle = document.createElement('h3');
  listTitle.textContent = t('paletteManagerListTitle');
  const listHint = document.createElement('p');
  listHint.className = 'muted';
  listHint.textContent = t('paletteManagerListHint');
  listHeader.append(listTitle, listHint);

  const referencesByPalette = new Map<
    string,
    readonly PaletteUsageReference[]
  >();
  for (const palette of options.palettes) {
    referencesByPalette.set(
      palette.id,
      findPaletteUsageReferences(palette.id, options.usageContext),
    );
  }

  const filteredPalettes = options.palettes.filter((palette) =>
    filterPalette(
      palette,
      options.filter,
      referencesByPalette.get(palette.id) ?? [],
    ),
  );
  const list = document.createElement('div');
  list.className = 'palette-definitions-list';
  for (const palette of filteredPalettes) {
    const references = referencesByPalette.get(palette.id) ?? [];
    const selected = palette.id === options.selectedPaletteId;
    const card = document.createElement('article');
    card.className = `palette-definition-card${selected ? ' is-selected' : ''}`;
    card.setAttribute('data-palette-id', palette.id);
    card.setAttribute('aria-label', palette.name);
    let currentName = palette.name;

    const cardMeta = document.createElement('div');
    cardMeta.className = 'palette-definition-meta';
    const targetBadge = document.createElement('span');
    targetBadge.className = 'palette-target-badge';
    targetBadge.textContent = targetLabel(palette.target);
    const usageBadge = document.createElement('span');
    usageBadge.className = 'palette-usage-badge';
    usageBadge.textContent = t('paletteManagerUsageCount', {
      count: references.length,
    });
    cardMeta.append(targetBadge, usageBadge);

    const nameLabel = document.createElement('label');
    const nameId = `palette-name-${palette.id}`;
    nameLabel.className = 'visually-hidden';
    nameLabel.htmlFor = nameId;
    nameLabel.textContent = t('paletteManagerNameLabel', {
      name: palette.name,
    });
    const nameInput = document.createElement('input');
    nameInput.id = nameId;
    nameInput.type = 'text';
    nameInput.className = 'palette-definition-name-input';
    nameInput.value = palette.name;
    nameInput.placeholder = t('paletteManagerNamePlaceholder');
    nameInput.setAttribute('data-palette-name', palette.id);
    let cancelledNameEdit = false;
    const commitName = (): void => {
      if (cancelledNameEdit) {
        cancelledNameEdit = false;
        return;
      }
      const trimmed = nameInput.value.trim();
      if (trimmed === '') {
        nameInput.value = currentName;
      } else if (trimmed !== currentName) {
        options.onUpdatePaletteName(palette.id, trimmed);
        currentName = trimmed;
        card.setAttribute('aria-label', currentName);
        nameLabel.textContent = t('paletteManagerNameLabel', {
          name: currentName,
        });
        duplicateButton.setAttribute(
          'aria-label',
          `${t('paletteManagerDuplicate')} ${currentName}`,
        );
        deleteButton.setAttribute(
          'aria-label',
          `${t('paletteManagerDelete')} ${currentName}`,
        );
        const inspectorName = panel.querySelector(
          `[data-palette-inspector-name="${palette.id}"]`,
        );
        if (inspectorName !== null) inspectorName.textContent = currentName;
      }
    };
    nameInput.addEventListener('blur', commitName);
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        nameInput.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelledNameEdit = true;
        nameInput.value = currentName;
        nameInput.blur();
      }
    });

    const colors = document.createElement('div');
    colors.className = 'palette-definition-colors-row';
    colors.setAttribute('role', 'group');
    colors.setAttribute('aria-label', t('paletteManagerColorsLabel'));
    for (const colorIndex of COLOR_INDICES) {
      const code = palette.colors[colorIndex];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-color-swatch-btn';
      button.setAttribute(
        'data-palette-color',
        `${palette.id}:${String(colorIndex)}`,
      );
      button.setAttribute(
        'aria-label',
        t('paletteManagerColorAriaLabel', {
          index: colorIndex,
          code: hexadecimal(code),
        }),
      );
      const swatch = document.createElement('span');
      swatch.className = 'palette-color-swatch';
      swatch.style.backgroundColor = cssColor(code);
      swatch.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'palette-color-label';
      label.textContent = `${String(colorIndex)} · ${hexadecimal(code)}`;
      button.append(swatch, label);
      button.addEventListener('click', () => {
        masterDialog.openFor({
          title: `${currentName} · ${t('paletteManagerColorIndex', { index: colorIndex })}`,
          currentCode: code,
          onSelect: (newCode) => {
            options.onUpdatePaletteColor(palette.id, colorIndex, newCode);
          },
          returnFocus: button,
        });
      });
      colors.append(button);
    }

    const actions = document.createElement('div');
    actions.className = 'palette-definition-actions';
    const inspectButton = document.createElement('button');
    inspectButton.type = 'button';
    inspectButton.className = 'button secondary-button palette-inspect-button';
    inspectButton.textContent = selected
      ? t('paletteManagerSelected')
      : t('paletteManagerSelect');
    inspectButton.setAttribute('aria-pressed', String(selected));
    inspectButton.setAttribute('data-select-palette', palette.id);
    inspectButton.addEventListener('click', () => {
      options.onSelectPalette(palette.id);
    });
    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.className = 'button secondary-button';
    duplicateButton.textContent = t('paletteManagerDuplicate');
    duplicateButton.setAttribute(
      'aria-label',
      `${t('paletteManagerDuplicate')} ${palette.name}`,
    );
    duplicateButton.addEventListener('click', () => {
      options.onDuplicatePalette(palette.id);
    });
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'button secondary-button palette-delete-button';
    deleteButton.textContent = t('paletteManagerDelete');
    deleteButton.setAttribute(
      'aria-label',
      `${t('paletteManagerDelete')} ${palette.name}`,
    );
    deleteButton.addEventListener('click', () => {
      deleteDialog.openFor(
        { ...palette, name: currentName },
        references,
        deleteButton,
      );
    });
    actions.append(inspectButton, duplicateButton, deleteButton);

    card.append(nameLabel, nameInput, cardMeta, colors, actions);
    list.append(card);
  }
  if (filteredPalettes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'palette-library-empty muted';
    empty.textContent = t('paletteManagerFilterEmpty');
    list.append(empty);
  }
  listSection.append(listHeader, list);

  const selectedPalette =
    options.palettes.find(
      (palette) => palette.id === options.selectedPaletteId,
    ) ?? null;
  const selectedReferences =
    selectedPalette === null
      ? []
      : (referencesByPalette.get(selectedPalette.id) ?? []);
  content.append(
    listSection,
    createInspector(options, selectedPalette, selectedReferences),
  );

  panel.append(
    header,
    toolbar,
    banks,
    content,
    masterDialog.dialog,
    deleteDialog.dialog,
  );
  return panel;
}
