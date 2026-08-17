import { NES_MASTER_PALETTE } from '../core/nes-palette';
import {
  findPaletteUsageReferences,
  type PaletteDefinition,
} from '../core/palette-manager';
import { t } from '../i18n';
import type { AnimationItemSetting } from './types';

export interface PaletteManagerPanelOptions {
  readonly palettes: readonly PaletteDefinition[];
  readonly activeSpritePaletteSlots: readonly (string | null)[];
  readonly animations: readonly AnimationItemSetting[];
  readonly onCreatePalette: (name?: string) => void;
  readonly onUpdatePaletteName: (paletteId: string, name: string) => void;
  readonly onUpdatePaletteColor: (
    paletteId: string,
    colorSlotIndex: number,
    colorCode: number,
  ) => void;
  readonly onDuplicatePalette: (paletteId: string) => void;
  readonly onDeletePalette: (paletteId: string) => void;
  readonly onUpdateActiveSlot: (
    slotIndex: 0 | 1 | 2 | 3,
    paletteId: string | null,
  ) => void;
}

function hexadecimal(code: number): string {
  return `$${code.toString(16).toUpperCase().padStart(2, '0')}`;
}

function cssColor(code: number): string {
  const color = NES_MASTER_PALETTE[code] ?? { red: 0, green: 0, blue: 0 };
  return `rgb(${String(color.red)} ${String(color.green)} ${String(color.blue)})`;
}

function createMasterPaletteDialog(onSelectColor: (code: number) => void): {
  dialog: HTMLDialogElement;
  openFor: (titleText: string, currentCode: number) => void;
} {
  const dialog = document.createElement('dialog');
  dialog.className = 'nes-master-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'nes-master-palette';
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

  let activeCallback: ((code: number) => void) | null = null;

  const openFor = (titleText: string, currentCode: number): void => {
    target.textContent = `${titleText} (${hexadecimal(currentCode)})`;
    activeCallback = onSelectColor;
    grid.replaceChildren();
    NES_MASTER_PALETTE.forEach((_color, colorCode) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nes-color-button';
      button.style.backgroundColor = cssColor(colorCode);
      button.title = hexadecimal(colorCode);
      button.setAttribute(
        'aria-label',
        t('nesColorButton', { code: hexadecimal(colorCode) }),
      );
      button.addEventListener('click', () => {
        if (activeCallback) {
          activeCallback(colorCode);
        }
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

export function createPaletteManagerPanel(
  options: PaletteManagerPanelOptions,
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel palette-manager-panel';

  let currentColorCallback: ((code: number) => void) | null = null;
  const masterDialog = createMasterPaletteDialog((code) => {
    if (currentColorCallback) {
      currentColorCallback(code);
    }
  });

  // Panel Header
  const header = document.createElement('div');
  header.className = 'palette-manager-header';
  const titleGroup = document.createElement('div');
  const heading = document.createElement('h2');
  heading.textContent = t('paletteManagerTitle');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = t('paletteManagerHint');
  titleGroup.append(heading, hint);

  const btnNewPalette = document.createElement('button');
  btnNewPalette.type = 'button';
  btnNewPalette.className = 'button primary-button';
  btnNewPalette.textContent = t('paletteManagerNewPalette');
  btnNewPalette.addEventListener('click', () => {
    options.onCreatePalette();
  });

  header.append(titleGroup, btnNewPalette);
  panel.append(header);

  // Active Slots Section
  const slotsSection = document.createElement('section');
  slotsSection.className = 'active-slots-section';

  const slotsHeader = document.createElement('div');
  slotsHeader.className = 'active-slots-header';
  const slotsTitle = document.createElement('h3');
  slotsTitle.textContent = t('paletteManagerActiveSlotsTitle');
  const slotsHint = document.createElement('p');
  slotsHint.className = 'muted';
  slotsHint.textContent = t('paletteManagerActiveSlotsHint');
  slotsHeader.append(slotsTitle, slotsHint);
  slotsSection.append(slotsHeader);

  const slotsGrid = document.createElement('div');
  slotsGrid.className = 'active-slots-grid';

  const slotIndices: readonly (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];
  slotIndices.forEach((slotIndex) => {
    const slotCard = document.createElement('div');
    slotCard.className = 'active-slot-card';

    const slotLabel = document.createElement('strong');
    slotLabel.className = 'active-slot-label';
    slotLabel.textContent = t('paletteManagerSlotLabel', { index: slotIndex });

    const select = document.createElement('select');
    select.className = 'active-slot-select';

    const currentPaletteId = options.activeSpritePaletteSlots[slotIndex] ?? null;

    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = t('paletteManagerSlotEmpty');
    select.append(optNone);

    options.palettes.forEach((pal) => {
      const opt = document.createElement('option');
      opt.value = pal.id;
      opt.textContent = pal.name;
      if (pal.id === currentPaletteId) {
        opt.selected = true;
      }
      select.append(opt);
    });

    select.addEventListener('change', () => {
      const selectedId = select.value.trim() !== '' ? select.value.trim() : null;
      options.onUpdateActiveSlot(slotIndex, selectedId);
    });

    // Swatches preview of the slot
    const assignedPal = options.palettes.find((p) => p.id === currentPaletteId);
    const swatchesContainer = document.createElement('div');
    swatchesContainer.className = 'active-slot-swatches';

    [0, 1, 2, 3].forEach((cIdx) => {
      const swatch = document.createElement('span');
      swatch.className = 'active-slot-swatch';
      if (assignedPal) {
        const code = assignedPal.colors[cIdx as 0 | 1 | 2 | 3];
        swatch.style.backgroundColor = cssColor(code);
        swatch.title = `Color ${String(cIdx)}: ${hexadecimal(code)}`;
      } else {
        swatch.style.backgroundColor = '#111827';
      }
      if (cIdx === 0) {
        swatch.classList.add('is-transparent-slot');
      }
      swatchesContainer.append(swatch);
    });

    slotCard.append(slotLabel, select, swatchesContainer);
    slotsGrid.append(slotCard);
  });

  slotsSection.append(slotsGrid);
  panel.append(slotsSection);

  // Palette Definitions List
  const listSection = document.createElement('section');
  listSection.className = 'palette-definitions-section';

  const listHeader = document.createElement('div');
  listHeader.className = 'palette-definitions-header';
  const listTitle = document.createElement('h3');
  listTitle.textContent = t('paletteManagerListTitle');
  listHeader.append(listTitle);
  listSection.append(listHeader);

  const listContainer = document.createElement('div');
  listContainer.className = 'palette-definitions-list';

  options.palettes.forEach((palette) => {
    const card = document.createElement('div');
    card.className = 'palette-definition-card';

    // Palette Name
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'palette-definition-name-input';
    nameInput.value = palette.name;
    nameInput.placeholder = t('paletteManagerNamePlaceholder');
    nameInput.addEventListener('change', () => {
      const trimmed = nameInput.value.trim();
      if (trimmed !== '') {
        options.onUpdatePaletteName(palette.id, trimmed);
      }
    });

    // 4 Color Swatches
    const colorsRow = document.createElement('div');
    colorsRow.className = 'palette-definition-colors-row';

    [0, 1, 2, 3].forEach((colorIdx) => {
      const code = palette.colors[colorIdx as 0 | 1 | 2 | 3];

      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = 'palette-color-swatch-btn';

      const swatch = document.createElement('span');
      swatch.className = 'palette-color-swatch';
      swatch.style.backgroundColor = cssColor(code);

      const label = document.createElement('span');
      label.className = 'palette-color-label';
      label.textContent =
        colorIdx === 0
          ? `0 (BG): ${hexadecimal(code)}`
          : `${String(colorIdx)}: ${hexadecimal(code)}`;

      if (colorIdx === 0) {
        swatch.classList.add('is-transparent-sprite');
      }

      colorBtn.append(swatch, label);
      colorBtn.addEventListener('click', () => {
        currentColorCallback = (newCode: number) => {
          options.onUpdatePaletteColor(palette.id, colorIdx, newCode);
        };
        masterDialog.openFor(
          `${palette.name} · Color ${String(colorIdx)}${colorIdx === 0 ? ' (BG / Transparente)' : ''}`,
          code,
        );
      });

      colorsRow.append(colorBtn);
    });

    // Actions (Duplicate, Delete)
    const actions = document.createElement('div');
    actions.className = 'palette-definition-actions';

    const btnDup = document.createElement('button');
    btnDup.type = 'button';
    btnDup.className = 'button secondary-button';
    btnDup.textContent = t('paletteManagerDuplicate');
    btnDup.addEventListener('click', () => {
      options.onDuplicatePalette(palette.id);
    });

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'button secondary-button';
    btnDel.textContent = t('paletteManagerDelete');

    const refs = findPaletteUsageReferences(
      palette.id,
      options.animations,
      options.activeSpritePaletteSlots,
    );

    btnDel.addEventListener('click', () => {
      if (refs.length > 0) {
        const refList = refs
          .map((r) => `• [${r.type.toUpperCase()}] ${r.name}${r.detail ? ` (${r.detail})` : ''}`)
          .join('\n');
        const confirmMsg = `${t('paletteManagerDeleteConfirmUsed', { name: palette.name })}\n\n${refList}`;
        if (window.confirm(confirmMsg)) {
          options.onDeletePalette(palette.id);
        }
      } else {
        options.onDeletePalette(palette.id);
      }
    });

    actions.append(btnDup, btnDel);

    card.append(nameInput, colorsRow, actions);
    listContainer.append(card);
  });

  listSection.append(listContainer);
  panel.append(listSection);
  panel.append(masterDialog.dialog);

  return panel;
}
