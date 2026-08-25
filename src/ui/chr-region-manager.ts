import {
  calculateChrRegionCapacity,
  doChrRegionsOverlap,
  formatTileIndexHex,
  formatTileRangeHex,
  generateChrRegionId,
  getChrRegionOverlapRange,
  parseChrTileIndex,
  sanitizeRegionColor,
  validateChrRegion,
  type ChrRegion,
  type ChrRegionKind,
  type ChrSlotClassification,
  type SpritePatternTable,
} from '../core/chr-pattern-table';
import { t } from '../i18n';

export interface ChrRegionManagerOptions {
  readonly chrRegions?: readonly ChrRegion[];
  readonly classifications?: readonly ChrSlotClassification[];
  readonly onUpdateChrRegions?: (regions: readonly ChrRegion[]) => void;
}

interface FormState {
  readonly isEditing: boolean;
  readonly regionId: string;
  name: string;
  kind: ChrRegionKind;
  patternTable: SpritePatternTable;
  startTileHex: string;
  endTileHex: string;
  color: string;
  hasColor: boolean;
  notes: string;
}

const DEFAULT_REGION_COLOR = '#38bdf8';
const DEFAULT_RESERVATION_COLOR = '#a855f7';

/**
 * Sorts CHR regions deterministically for display:
 * 1. Pattern Table (PT0, then PT1)
 * 2. startTile ascending
 * 3. endTile ascending
 * 4. name alphabetical
 * 5. id alphabetical
 */
export function sortChrRegionsForDisplay(
  regions: readonly ChrRegion[],
): readonly ChrRegion[] {
  return [...regions].sort((a, b) => {
    if (a.patternTable !== b.patternTable) {
      return a.patternTable - b.patternTable;
    }
    if (a.startTile !== b.startTile) {
      return a.startTile - b.startTile;
    }
    if (a.endTile !== b.endTile) {
      return a.endTile - b.endTile;
    }
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) {
      return nameCmp;
    }
    return a.id.localeCompare(b.id);
  });
}

export function createChrRegionManagerPanel(
  options: ChrRegionManagerOptions,
): HTMLElement {
  const container = document.createElement('section');
  container.id = 'section-chr-regions';
  container.className = 'chr-region-manager-section';
  container.setAttribute('aria-labelledby', 'chr-region-manager-heading');

  let currentRegions: readonly ChrRegion[] = options.chrRegions ?? [];
  let formState: FormState | null = null;

  const render = (): void => {
    container.replaceChildren();

    // 1. Header
    const header = document.createElement('div');
    header.className = 'chr-region-manager-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'chr-region-manager-title-group';

    const title = document.createElement('h3');
    title.id = 'chr-region-manager-heading';
    title.className = 'chr-region-manager-title';
    title.textContent = t('chrRegionManagerSectionTitle');

    const subtitle = document.createElement('span');
    subtitle.className = 'chr-region-manager-subtitle';
    subtitle.textContent = t('chrRegionManagerSectionSubtitle');

    titleGroup.append(title, subtitle);

    const headerControls = document.createElement('div');
    headerControls.className = 'chr-region-manager-header-controls';

    const countBadge = document.createElement('span');
    countBadge.className = 'status-badge chr-region-count-badge';
    countBadge.textContent = t('chrRegionManagerCountBadge', {
      count: currentRegions.length,
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary chr-region-add-btn';
    addBtn.textContent = t('chrRegionManagerAddAction');
    addBtn.addEventListener('click', () => {
      formState = {
        isEditing: false,
        regionId: generateChrRegionId(),
        name: '',
        kind: 'region',
        patternTable: 0,
        startTileHex: '$00',
        endTileHex: '$1F',
        color: DEFAULT_REGION_COLOR,
        hasColor: true,
        notes: '',
      };
      render();
      const nameInput = container.querySelector<HTMLInputElement>(
        '#chr-region-name-input',
      );
      nameInput?.focus();
    });

    headerControls.append(countBadge, addBtn);
    header.append(titleGroup, headerControls);
    container.append(header);

    // 2. Form (if active)
    if (formState !== null) {
      const formCard = renderForm(formState);
      container.append(formCard);
    }

    // 3. Regions Table / Empty State
    if (currentRegions.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'chr-region-manager-empty';
      emptyState.textContent = t('chrRegionManagerEmptyState');
      container.append(emptyState);
    } else {
      const tableWrapper = document.createElement('div');
      tableWrapper.className = 'table-responsive chr-region-table-wrapper';

      const table = document.createElement('table');
      table.className = 'table chr-region-table';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');

      const thColor = document.createElement('th');
      thColor.textContent = t('chrRegionManagerTableHeaderColor');
      thColor.style.width = '3rem';

      const thName = document.createElement('th');
      thName.textContent = t('chrRegionManagerTableHeaderName');

      const thKind = document.createElement('th');
      thKind.textContent = t('chrRegionManagerTableHeaderKind');

      const thTable = document.createElement('th');
      thTable.textContent = t('chrRegionManagerTableHeaderPatternTable');

      const thRange = document.createElement('th');
      thRange.textContent = t('chrRegionManagerTableHeaderRange');

      const thCapacity = document.createElement('th');
      thCapacity.textContent = t('chrRegionManagerTableHeaderCapacity');

      const thOccupancy = document.createElement('th');
      thOccupancy.textContent = t('chrRegionManagerTableHeaderOccupancy');

      const thActions = document.createElement('th');
      thActions.textContent = t('chrRegionManagerTableHeaderActions');
      thActions.style.textAlign = 'right';

      headerRow.append(
        thColor,
        thName,
        thKind,
        thTable,
        thRange,
        thCapacity,
        thOccupancy,
        thActions,
      );
      thead.append(headerRow);
      table.append(thead);

      const tbody = document.createElement('tbody');
      const sortedRegions = sortChrRegionsForDisplay(currentRegions);

      for (const region of sortedRegions) {
        const row = document.createElement('tr');
        row.setAttribute('data-region-id', region.id);

        const cap = calculateChrRegionCapacity(
          region,
          options.classifications ?? [],
        );
        const percent = Math.round((cap.occupiedTiles / cap.totalTiles) * 100);

        // Color
        const tdColor = document.createElement('td');
        const safeColor = sanitizeRegionColor(region.color);
        if (safeColor) {
          const swatch = document.createElement('span');
          swatch.className = 'chr-region-color-swatch';
          swatch.style.backgroundColor = safeColor;
          swatch.setAttribute('aria-hidden', 'true');
          tdColor.append(swatch);
        } else {
          tdColor.textContent = '—';
          tdColor.className = 'muted';
        }

        // Name
        const tdName = document.createElement('td');
        const strongName = document.createElement('strong');
        strongName.textContent = region.name;
        tdName.append(strongName);
        if (region.notes) {
          const notesSpan = document.createElement('div');
          notesSpan.className = 'muted text-sm';
          notesSpan.textContent = region.notes;
          tdName.append(notesSpan);
        }

        // Kind
        const tdKind = document.createElement('td');
        const kindBadge = document.createElement('span');
        kindBadge.className = `status-badge ${
          region.kind === 'reservation'
            ? 'chr-reservation-badge'
            : 'chr-region-badge'
        }`;
        kindBadge.textContent =
          region.kind === 'reservation'
            ? t('chrRegionManagerKindReservationShort')
            : t('chrRegionManagerKindRegionShort');
        tdKind.append(kindBadge);

        // Pattern Table
        const tdTable = document.createElement('td');
        tdTable.textContent = `PT${String(region.patternTable)}`;

        // Range
        const tdRange = document.createElement('td');
        tdRange.textContent = formatTileRangeHex(
          region.startTile,
          region.endTile,
        );

        // Capacity
        const tdCap = document.createElement('td');
        tdCap.textContent = t('chrRegionManagerCapacityFormat', {
          count: cap.totalTiles,
        });

        // Occupancy
        const tdOcc = document.createElement('td');
        tdOcc.textContent = t('chrRegionManagerOccupancyFormat', {
          occupied: cap.occupiedTiles,
          total: cap.totalTiles,
          percent,
        });

        // Actions
        const tdActions = document.createElement('td');
        tdActions.style.textAlign = 'right';
        tdActions.className = 'chr-region-row-actions';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn btn-sm btn-ghost chr-region-edit-btn';
        editBtn.textContent = t('chrRegionManagerActionEdit');
        editBtn.setAttribute(
          'aria-label',
          `${t('chrRegionManagerActionEdit')} ${region.name}`,
        );
        editBtn.addEventListener('click', () => {
          formState = {
            isEditing: true,
            regionId: region.id,
            name: region.name,
            kind: region.kind,
            patternTable: region.patternTable,
            startTileHex: formatTileIndexHex(region.startTile),
            endTileHex: formatTileIndexHex(region.endTile),
            color: region.color ?? DEFAULT_REGION_COLOR,
            hasColor: Boolean(region.color),
            notes: region.notes ?? '',
          };
          render();
          const nameInput = container.querySelector<HTMLInputElement>(
            '#chr-region-name-input',
          );
          nameInput?.focus();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className =
          'btn btn-sm btn-ghost btn-danger chr-region-delete-btn';
        deleteBtn.textContent = t('chrRegionManagerActionDelete');
        deleteBtn.setAttribute(
          'aria-label',
          `${t('chrRegionManagerActionDelete')} ${region.name}`,
        );
        deleteBtn.addEventListener('click', () => {
          const confirmMsg =
            region.kind === 'reservation'
              ? t('chrRegionManagerDeleteReservationConfirm', {
                  name: region.name,
                })
              : t('chrRegionManagerDeleteRegionConfirm', {
                  name: region.name,
                });
          if (
            typeof window !== 'undefined' &&
            typeof window.confirm === 'function'
          ) {
            if (!window.confirm(confirmMsg)) return;
          }

          const deletedIndex = sortedRegions.findIndex(
            (r) => r.id === region.id,
          );
          const updated = currentRegions.filter((r) => r.id !== region.id);
          currentRegions = updated;
          if (formState?.regionId === region.id) {
            formState = null;
          }
          options.onUpdateChrRegions?.(updated);
          render();

          // Restore focus after delete
          const remainingSorted = sortChrRegionsForDisplay(updated);
          if (remainingSorted.length > 0) {
            const nextTargetIndex = Math.min(
              deletedIndex,
              remainingSorted.length - 1,
            );
            const targetId = remainingSorted[nextTargetIndex]?.id;
            if (targetId) {
              const targetBtn = container.querySelector<HTMLButtonElement>(
                `[data-region-id="${targetId}"] .chr-region-edit-btn`,
              );
              targetBtn?.focus();
            }
          } else {
            const addBtnEl = container.querySelector<HTMLButtonElement>(
              '.chr-region-add-btn',
            );
            addBtnEl?.focus();
          }
        });

        tdActions.append(editBtn, deleteBtn);
        row.append(
          tdColor,
          tdName,
          tdKind,
          tdTable,
          tdRange,
          tdCap,
          tdOcc,
          tdActions,
        );
        tbody.append(row);
      }

      table.append(tbody);
      tableWrapper.append(table);
      container.append(tableWrapper);
    }
  };

  const renderForm = (state: FormState): HTMLElement => {
    const card = document.createElement('div');
    card.className = 'chr-region-form-card';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-labelledby', 'chr-region-form-title');

    const formHeader = document.createElement('div');
    formHeader.className = 'chr-region-form-header';

    const formTitle = document.createElement('h4');
    formTitle.id = 'chr-region-form-title';
    formTitle.className = 'chr-region-form-title';
    formTitle.textContent = state.isEditing
      ? t('chrRegionManagerFormEditTitle')
      : t('chrRegionManagerFormCreateTitle');

    formHeader.append(formTitle);
    card.append(formHeader);

    const form = document.createElement('form');
    form.className = 'chr-region-form';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
    });

    const formGrid = document.createElement('div');
    formGrid.className = 'chr-region-form-grid';

    // 1. Name
    const nameGroup = document.createElement('div');
    nameGroup.className = 'form-group chr-form-group-name';
    const nameLabel = document.createElement('label');
    nameLabel.htmlFor = 'chr-region-name-input';
    nameLabel.textContent = t('chrRegionManagerFieldName');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'chr-region-name-input';
    nameInput.className = 'form-control';
    nameInput.placeholder = t('chrRegionManagerFieldNamePlaceholder');
    nameInput.value = state.name;
    nameInput.required = true;
    nameInput.setAttribute('aria-describedby', 'chr-region-form-feedback');
    nameGroup.append(nameLabel, nameInput);

    // 2. Kind
    const kindGroup = document.createElement('div');
    kindGroup.className = 'form-group chr-form-group-kind';
    const kindLabel = document.createElement('label');
    kindLabel.htmlFor = 'chr-region-kind-select';
    kindLabel.textContent = t('chrRegionManagerFieldKind');
    const kindSelect = document.createElement('select');
    kindSelect.id = 'chr-region-kind-select';
    kindSelect.className = 'form-control';

    const optRegion = document.createElement('option');
    optRegion.value = 'region';
    optRegion.textContent = t('chrRegionManagerKindRegion');
    optRegion.selected = state.kind === 'region';

    const optReservation = document.createElement('option');
    optReservation.value = 'reservation';
    optReservation.textContent = t('chrRegionManagerKindReservation');
    optReservation.selected = state.kind === 'reservation';

    kindSelect.append(optRegion, optReservation);
    kindSelect.value = state.kind;
    kindGroup.append(kindLabel, kindSelect);

    // 3. Pattern Table
    const ptGroup = document.createElement('div');
    ptGroup.className = 'form-group chr-form-group-pt';
    const ptLabel = document.createElement('label');
    ptLabel.htmlFor = 'chr-region-pt-select';
    ptLabel.textContent = t('chrRegionManagerFieldPatternTable');
    const ptSelect = document.createElement('select');
    ptSelect.id = 'chr-region-pt-select';
    ptSelect.className = 'form-control';

    const optPt0 = document.createElement('option');
    optPt0.value = '0';
    optPt0.textContent = 'PT0 ($0000..$0FFF)';
    optPt0.selected = state.patternTable === 0;

    const optPt1 = document.createElement('option');
    optPt1.value = '1';
    optPt1.textContent = 'PT1 ($1000..$1FFF)';
    optPt1.selected = state.patternTable === 1;

    ptSelect.append(optPt0, optPt1);
    ptSelect.value = String(state.patternTable);
    ptGroup.append(ptLabel, ptSelect);

    // 4. Start Tile & Decimal Mirror
    const startGroup = document.createElement('div');
    startGroup.className = 'form-group chr-form-group-start';
    const startLabel = document.createElement('label');
    startLabel.htmlFor = 'chr-region-start-input';
    startLabel.textContent = t('chrRegionManagerFieldStart');

    const startInputRow = document.createElement('div');
    startInputRow.className = 'chr-hex-input-row';

    const startInput = document.createElement('input');
    startInput.type = 'text';
    startInput.id = 'chr-region-start-input';
    startInput.className = 'form-control chr-hex-input';
    startInput.placeholder = '$00';
    startInput.value = state.startTileHex;
    startInput.setAttribute('aria-describedby', 'chr-region-form-feedback');

    const startMirror = document.createElement('span');
    startMirror.className = 'chr-decimal-mirror muted';

    startInputRow.append(startInput, startMirror);
    startGroup.append(startLabel, startInputRow);

    // 5. End Tile & Decimal Mirror
    const endGroup = document.createElement('div');
    endGroup.className = 'form-group chr-form-group-end';
    const endLabel = document.createElement('label');
    endLabel.htmlFor = 'chr-region-end-input';
    endLabel.textContent = t('chrRegionManagerFieldEnd');

    const endInputRow = document.createElement('div');
    endInputRow.className = 'chr-hex-input-row';

    const endInput = document.createElement('input');
    endInput.type = 'text';
    endInput.id = 'chr-region-end-input';
    endInput.className = 'form-control chr-hex-input';
    endInput.placeholder = '$1F';
    endInput.value = state.endTileHex;
    endInput.setAttribute('aria-describedby', 'chr-region-form-feedback');

    const endMirror = document.createElement('span');
    endMirror.className = 'chr-decimal-mirror muted';

    endInputRow.append(endInput, endMirror);
    endGroup.append(endLabel, endInputRow);

    // 6. Color
    const colorGroup = document.createElement('div');
    colorGroup.className = 'form-group chr-form-group-color';
    const colorLabel = document.createElement('label');
    colorLabel.htmlFor = 'chr-region-color-input';
    colorLabel.textContent = t('chrRegionManagerFieldColor');

    const colorControlsRow = document.createElement('div');
    colorControlsRow.className = 'chr-color-input-row';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.id = 'chr-region-color-input';
    colorInput.className = 'form-control-color chr-color-picker';
    colorInput.value = state.color;

    const resetColorBtn = document.createElement('button');
    resetColorBtn.type = 'button';
    resetColorBtn.className = 'btn btn-sm btn-ghost chr-color-reset-btn';
    resetColorBtn.textContent = t('chrRegionManagerFieldColorReset');

    colorControlsRow.append(colorInput, resetColorBtn);
    colorGroup.append(colorLabel, colorControlsRow);

    // 7. Notes
    const notesGroup = document.createElement('div');
    notesGroup.className = 'form-group chr-form-group-notes';
    const notesLabel = document.createElement('label');
    notesLabel.htmlFor = 'chr-region-notes-input';
    notesLabel.textContent = t('chrRegionManagerFieldNotes');
    const notesInput = document.createElement('input');
    notesInput.type = 'text';
    notesInput.id = 'chr-region-notes-input';
    notesInput.className = 'form-control';
    notesInput.placeholder = t('chrRegionManagerFieldNotesPlaceholder');
    notesInput.value = state.notes;
    notesGroup.append(notesLabel, notesInput);

    formGrid.append(
      nameGroup,
      kindGroup,
      ptGroup,
      startGroup,
      endGroup,
      colorGroup,
      notesGroup,
    );
    form.append(formGrid);

    // 8. Feedback / Overlap Messages Container
    const feedbackBox = document.createElement('div');
    feedbackBox.id = 'chr-region-form-feedback';
    feedbackBox.className = 'chr-region-form-feedback';
    feedbackBox.setAttribute('aria-live', 'polite');

    // 9. Actions
    const formActions = document.createElement('div');
    formActions.className = 'chr-region-form-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.id = 'chr-region-save-btn';
    saveBtn.className = 'btn btn-primary chr-region-save-btn';
    saveBtn.textContent = t('chrRegionManagerActionSave');

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.id = 'chr-region-cancel-btn';
    cancelBtn.className = 'btn btn-secondary chr-region-cancel-btn';
    cancelBtn.textContent = t('chrRegionManagerActionCancel');

    formActions.append(cancelBtn, saveBtn);
    form.append(feedbackBox, formActions);
    card.append(form);

    // Live validation & mirror updater
    const updateFormValidation = (): void => {
      const parsedStart = parseChrTileIndex(startInput.value);
      const parsedEnd = parseChrTileIndex(endInput.value);

      startMirror.textContent =
        parsedStart !== null ? `(${String(parsedStart)})` : '—';
      endMirror.textContent =
        parsedEnd !== null ? `(${String(parsedEnd)})` : '—';

      feedbackBox.replaceChildren();

      const validationErrors: string[] = [];

      const trimmedName = nameInput.value.trim();
      const isNameValid = trimmedName.length > 0;
      nameInput.setAttribute('aria-invalid', String(!isNameValid));
      if (!isNameValid) {
        validationErrors.push(t('chrRegionManagerValNameRequired'));
      }

      const isStartValid = parsedStart !== null;
      startInput.setAttribute('aria-invalid', String(!isStartValid));
      if (!isStartValid) {
        validationErrors.push(t('chrRegionManagerValStartInvalid'));
      }

      const isEndValid = parsedEnd !== null;
      endInput.setAttribute('aria-invalid', String(!isEndValid));
      if (!isEndValid) {
        validationErrors.push(t('chrRegionManagerValEndInvalid'));
      }

      if (
        parsedStart !== null &&
        parsedEnd !== null &&
        parsedStart > parsedEnd
      ) {
        startInput.setAttribute('aria-invalid', 'true');
        endInput.setAttribute('aria-invalid', 'true');
        validationErrors.push(t('chrRegionManagerValStartGreaterThanEnd'));
      }

      const isValid = validationErrors.length === 0;
      saveBtn.disabled = !isValid;

      if (!isValid) {
        for (const err of validationErrors) {
          const errItem = document.createElement('div');
          errItem.className = 'alert alert-danger text-sm chr-region-val-error';
          errItem.textContent = err;
          feedbackBox.append(errItem);
        }
        return;
      }

      // If valid, test with validateChrRegion and check overlaps / warnings
      const candidateRegion: ChrRegion = {
        id: state.regionId,
        name: trimmedName,
        kind: kindSelect.value as ChrRegionKind,
        patternTable: Number(ptSelect.value) as SpritePatternTable,
        startTile: parsedStart ?? 0,
        endTile: parsedEnd ?? 0,
        ...(state.hasColor
          ? { color: sanitizeRegionColor(colorInput.value) }
          : {}),
        ...(notesInput.value.trim() ? { notes: notesInput.value.trim() } : {}),
      };

      const domainValidation = validateChrRegion(candidateRegion);
      if (!domainValidation.valid) {
        saveBtn.disabled = true;
        for (const error of domainValidation.errors) {
          const errItem = document.createElement('div');
          errItem.className = 'alert alert-danger text-sm chr-region-val-error';
          errItem.textContent = error.message;
          feedbackBox.append(errItem);
        }
        return;
      }

      // Check Overlaps with other regions
      const otherRegions = currentRegions.filter(
        (r) => r.id !== candidateRegion.id,
      );
      for (const other of otherRegions) {
        if (doChrRegionsOverlap(candidateRegion, other)) {
          const range = getChrRegionOverlapRange(candidateRegion, other);
          if (range) {
            const warnItem = document.createElement('div');
            warnItem.className =
              'alert alert-warning text-sm chr-region-val-warning';
            warnItem.textContent = t('chrRegionManagerOverlapWarning', {
              name: other.name,
              range: formatTileRangeHex(range[0], range[1]),
            });
            feedbackBox.append(warnItem);
          }
        }
      }

      // If reservation, check existing occupied slots
      if (candidateRegion.kind === 'reservation' && options.classifications) {
        const startPhys =
          candidateRegion.patternTable * 256 + candidateRegion.startTile;
        const endPhys =
          candidateRegion.patternTable * 256 + candidateRegion.endTile;
        let occupiedCount = 0;
        for (let i = startPhys; i <= endPhys; i += 1) {
          const occ = options.classifications[i]?.occupancy;
          if (occ === 'base' || occ === 'project') {
            occupiedCount += 1;
          }
        }
        if (occupiedCount > 0) {
          const occWarn = document.createElement('div');
          occWarn.className =
            'alert alert-info text-sm chr-region-val-occupied-warning';
          occWarn.textContent = t('chrRegionManagerOccupiedWarning', {
            count: occupiedCount,
            range: formatTileRangeHex(
              candidateRegion.startTile,
              candidateRegion.endTile,
            ),
          });
          feedbackBox.append(occWarn);
        }
      }
    };

    // Keyboard navigation inside form
    form.addEventListener('keydown', (e: Event) => {
      const keyboardEvent = e as KeyboardEvent;
      if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault();
        formState = null;
        render();
        const addBtnEl = container.querySelector<HTMLButtonElement>(
          '.chr-region-add-btn',
        );
        addBtnEl?.focus();
      } else if (keyboardEvent.key === 'Enter') {
        const target = keyboardEvent.target;
        if (target instanceof HTMLInputElement && target.type === 'text') {
          keyboardEvent.preventDefault();
          if (!saveBtn.disabled) {
            saveBtn.click();
          }
        }
      }
    });

    // Event listeners
    nameInput.addEventListener('input', () => {
      state.name = nameInput.value;
      updateFormValidation();
    });

    kindSelect.addEventListener('change', () => {
      state.kind = kindSelect.value as ChrRegionKind;
      if (!state.hasColor) {
        colorInput.value =
          state.kind === 'reservation'
            ? DEFAULT_RESERVATION_COLOR
            : DEFAULT_REGION_COLOR;
      }
      updateFormValidation();
    });

    ptSelect.addEventListener('change', () => {
      state.patternTable = Number(ptSelect.value) as SpritePatternTable;
      updateFormValidation();
    });

    startInput.addEventListener('input', () => {
      state.startTileHex = startInput.value;
      updateFormValidation();
    });

    endInput.addEventListener('input', () => {
      state.endTileHex = endInput.value;
      updateFormValidation();
    });

    colorInput.addEventListener('input', () => {
      state.color = colorInput.value;
      state.hasColor = true;
      updateFormValidation();
    });

    resetColorBtn.addEventListener('click', () => {
      state.hasColor = false;
      colorInput.value =
        state.kind === 'reservation'
          ? DEFAULT_RESERVATION_COLOR
          : DEFAULT_REGION_COLOR;
      updateFormValidation();
    });

    notesInput.addEventListener('input', () => {
      state.notes = notesInput.value;
    });

    cancelBtn.addEventListener('click', () => {
      formState = null;
      render();
      const addBtnEl = container.querySelector<HTMLButtonElement>(
        '.chr-region-add-btn',
      );
      addBtnEl?.focus();
    });

    saveBtn.addEventListener('click', () => {
      const parsedStart = parseChrTileIndex(startInput.value);
      const parsedEnd = parseChrTileIndex(endInput.value);
      const trimmedName = nameInput.value.trim();

      if (
        trimmedName.length === 0 ||
        parsedStart === null ||
        parsedEnd === null ||
        parsedStart > parsedEnd
      ) {
        return;
      }

      const finalRegion: ChrRegion = {
        id: state.regionId,
        name: trimmedName,
        kind: kindSelect.value as ChrRegionKind,
        patternTable: Number(ptSelect.value) as SpritePatternTable,
        startTile: parsedStart,
        endTile: parsedEnd,
        ...(state.hasColor
          ? { color: sanitizeRegionColor(colorInput.value) }
          : {}),
        ...(notesInput.value.trim() ? { notes: notesInput.value.trim() } : {}),
      };

      let updatedList: readonly ChrRegion[];
      if (state.isEditing) {
        updatedList = currentRegions.map((r) =>
          r.id === finalRegion.id ? finalRegion : r,
        );
      } else {
        updatedList = [...currentRegions, finalRegion];
      }

      currentRegions = updatedList;
      formState = null;
      options.onUpdateChrRegions?.(updatedList);
      render();

      // Restore focus to edited/created item
      const editBtn = container.querySelector<HTMLButtonElement>(
        `[data-region-id="${finalRegion.id}"] .chr-region-edit-btn`,
      );
      if (editBtn) {
        editBtn.focus();
      } else {
        const addBtnEl = container.querySelector<HTMLButtonElement>(
          '.chr-region-add-btn',
        );
        addBtnEl?.focus();
      }
    });

    updateFormValidation();
    return card;
  };

  render();
  return container;
}
