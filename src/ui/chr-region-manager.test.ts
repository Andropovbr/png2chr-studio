import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ChrRegion,
  ChrSlotClassification,
} from '../core/chr-pattern-table';
import { setLocale } from '../i18n';
import {
  createChrRegionManagerPanel,
  sortChrRegionsForDisplay,
} from './chr-region-manager';

class MockElement {
  tagName: string;
  className = '';
  id = '';
  children: MockElement[] = [];
  attributes = new Map<string, string>();
  eventListeners = new Map<string, ((e?: unknown) => void)[]>();
  _text = '';
  value = '';
  title = '';
  disabled = false;
  focus = vi.fn();
  scrollIntoView = vi.fn();
  style: Record<string, string> & {
    setProperty: (k: string, v: string) => void;
  };

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    const styleObj: Record<string, string> = {};
    Object.defineProperty(styleObj, 'setProperty', {
      value: (k: string, v: string) => {
        styleObj[k] = v;
      },
      writable: true,
      configurable: true,
    });
    this.style = styleObj as Record<string, string> & {
      setProperty: (k: string, v: string) => void;
    };
  }

  get textContent(): string {
    return this._text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this._text = val;
    this.children = [];
  }

  get classList() {
    return {
      contains: (cls: string) => this.className.split(/\s+/).includes(cls),
      add: (cls: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.add(cls);
        this.className = Array.from(classes).join(' ');
      },
      remove: (cls: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.delete(cls);
        this.className = Array.from(classes).join(' ');
      },
    };
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(event: string, handler: (e?: unknown) => void) {
    const list = this.eventListeners.get(event) ?? [];
    list.push(handler);
    this.eventListeners.set(event, list);
  }

  dispatchEvent(event: { type: string; [key: string]: unknown }) {
    const fullEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: this,
      ...event,
    };
    const handlers = this.eventListeners.get(event.type) ?? [];
    handlers.forEach((fn) => {
      fn(fullEvent);
    });
  }

  click() {
    const handlers = this.eventListeners.get('click') ?? [];
    const event = {
      type: 'click',
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
      target: this,
    };
    handlers.forEach((fn) => {
      fn(event);
    });
  }

  append(...nodes: (MockElement | string)[]) {
    nodes.forEach((node) => {
      if (typeof node === 'string') {
        this._text += node;
      } else {
        this.children.push(node);
      }
    });
  }

  replaceChildren(...nodes: (MockElement | string)[]) {
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1) {
      let currentSet: MockElement[] = [this];
      for (const part of parts) {
        const nextSet: MockElement[] = [];
        for (const el of currentSet) {
          nextSet.push(...el.querySelectorAll(part));
        }
        currentSet = nextSet;
      }
      return currentSet;
    }

    const singlePart = parts[0] ?? '';
    const results: MockElement[] = [];
    const match = (el: MockElement): boolean => {
      if (singlePart.includes('[')) {
        const attrMatch = /\[([^=\]]+)(?:=['"]?([^'"\]]+)['"]?)?\]/.exec(
          singlePart,
        );
        if (attrMatch) {
          const attr = attrMatch[1]?.trim();
          const val = attrMatch[2]?.trim();
          if (attr) {
            const hasAttr = el.attributes.has(attr);
            if (!hasAttr) return false;
            if (val !== undefined && el.attributes.get(attr) !== val) {
              return false;
            }
          }
        }
        const baseSelector = singlePart.split('[')[0]?.trim();
        if (!baseSelector) return true;
        if (baseSelector.startsWith('.')) {
          const classes = baseSelector.split('.').filter(Boolean);
          return classes.every((cls) => el.classList.contains(cls));
        }
        return el.tagName.toLowerCase() === baseSelector.toLowerCase();
      }
      if (singlePart.startsWith('.')) {
        const classes = singlePart.split('.').filter(Boolean);
        return classes.every((cls) => el.classList.contains(cls));
      }
      if (singlePart.startsWith('#')) {
        return el.id === singlePart.slice(1);
      }
      return el.tagName.toLowerCase() === singlePart.toLowerCase();
    };

    const traverse = (el: MockElement) => {
      for (const child of el.children) {
        if (match(child)) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

describe('ChrRegionManager component', () => {
  beforeEach(() => {
    setLocale('en');
    vi.stubGlobal('document', {
      createElement: (tag: string) => new MockElement(tag),
    });
    vi.stubGlobal('window', {
      confirm: vi.fn(() => true),
    });
  });

  it('renders empty state when no regions are configured and opens creation form on button click', () => {
    const onUpdate = vi.fn();
    const panel = createChrRegionManagerPanel({
      chrRegions: [],
      onUpdateChrRegions: onUpdate,
    });

    const mockPanel = panel as unknown as MockElement;
    expect(
      mockPanel.querySelector('.chr-region-manager-title')?.textContent,
    ).toBe('CHR Regions & Reservations');
    expect(mockPanel.querySelector('.chr-region-manager-empty')).not.toBeNull();
    expect(
      mockPanel.querySelector('.chr-region-count-badge')?.textContent,
    ).toBe('0 configured');

    const addBtn = mockPanel.querySelector('.chr-region-add-btn');
    expect(addBtn).not.toBeNull();
    addBtn?.click();

    // Form should now be rendered
    const formCard = mockPanel.querySelector('.chr-region-form-card');
    expect(formCard).not.toBeNull();
    expect(formCard?.querySelector('.chr-region-form-title')?.textContent).toBe(
      'New CHR Region / Reservation',
    );
  });

  it('sorts CHR regions deterministically by patternTable, startTile, endTile, name, id', () => {
    const r1: ChrRegion = {
      id: 'r-pt1-b',
      name: 'HUD',
      patternTable: 1,
      startTile: 0x80,
      endTile: 0xff,
      kind: 'region',
    };
    const r2: ChrRegion = {
      id: 'r-pt0-b',
      name: 'Enemies',
      patternTable: 0,
      startTile: 0x40,
      endTile: 0x7f,
      kind: 'region',
    };
    const r3: ChrRegion = {
      id: 'r-pt0-a',
      name: 'Player',
      patternTable: 0,
      startTile: 0x00,
      endTile: 0x1f,
      kind: 'region',
    };
    const r4: ChrRegion = {
      id: 'r-pt1-a',
      name: 'Font',
      patternTable: 1,
      startTile: 0x00,
      endTile: 0x3f,
      kind: 'reservation',
    };

    const sorted = sortChrRegionsForDisplay([r1, r2, r3, r4]);
    expect(sorted.map((r) => r.id)).toEqual([
      'r-pt0-a', // PT0 $00..$1F
      'r-pt0-b', // PT0 $40..$7F
      'r-pt1-a', // PT1 $00..$3F
      'r-pt1-b', // PT1 $80..$FF
    ]);
  });

  it('validates required fields, decimal mirrors, and disables Save button when invalid', () => {
    const panel = createChrRegionManagerPanel({
      chrRegions: [],
    });
    const mockPanel = panel as unknown as MockElement;

    // Open creation form
    mockPanel.querySelector('.chr-region-add-btn')?.click();

    const nameInput = mockPanel.querySelector('#chr-region-name-input');
    const startInput = mockPanel.querySelector('#chr-region-start-input');
    const endInput = mockPanel.querySelector('#chr-region-end-input');
    const saveBtn = mockPanel.querySelector('#chr-region-save-btn');

    // Initial state: name is empty -> save disabled
    expect(nameInput?.value).toBe('');
    expect(saveBtn?.disabled).toBe(true);

    // Provide name
    if (nameInput) nameInput.value = 'Player Sprites';
    nameInput?.dispatchEvent({ type: 'input' });

    // Now valid ($00 to $1F)
    expect(saveBtn?.disabled).toBe(false);

    // Check decimal mirrors
    const startMirror = mockPanel.querySelector(
      '.chr-form-group-start .chr-decimal-mirror',
    );
    const endMirror = mockPanel.querySelector(
      '.chr-form-group-end .chr-decimal-mirror',
    );
    expect(startMirror?.textContent).toBe('(0)');
    expect(endMirror?.textContent).toBe('(31)');

    // Type invalid hex in start input
    if (startInput) startInput.value = '$1G';
    startInput?.dispatchEvent({ type: 'input' });
    expect(saveBtn?.disabled).toBe(true);
    expect(startMirror?.textContent).toBe('—');
    expect(
      mockPanel.querySelector('.chr-region-val-error')?.textContent,
    ).toContain('Invalid start tile');

    // Fix start to $20 and make end $10 (start > end)
    if (startInput) startInput.value = '$20';
    startInput?.dispatchEvent({ type: 'input' });
    if (endInput) endInput.value = '$10';
    endInput?.dispatchEvent({ type: 'input' });

    expect(saveBtn?.disabled).toBe(true);
    expect(startMirror?.textContent).toBe('(32)');
    expect(endMirror?.textContent).toBe('(16)');
    expect(
      mockPanel.querySelector('.chr-region-val-error')?.textContent,
    ).toContain('Start tile cannot be greater than end tile');
  });

  it('renders table rows with color swatches, metadata, and occupancy percentages', () => {
    const reg1: ChrRegion = {
      id: 'reg-player',
      name: 'Player',
      patternTable: 0,
      startTile: 0,
      endTile: 15,
      kind: 'region',
      color: '#38bdf8',
      notes: 'Main protagonist animation tiles',
    };
    const res1: ChrRegion = {
      id: 'res-dynamic',
      name: 'Dynamic FX',
      patternTable: 1,
      startTile: 0x80,
      endTile: 0x8f,
      kind: 'reservation',
    };

    // Prepare classifications: 8 project tiles in PT0 $00..$07
    const classifications: ChrSlotClassification[] = [];
    for (let i = 0; i < 512; i += 1) {
      classifications.push({
        physicalIndex: i,
        localIndex: i % 256,
        patternTable: i < 256 ? 0 : 1,
        occupancy: i < 8 ? 'project' : 'empty',
      });
    }

    const panel = createChrRegionManagerPanel({
      chrRegions: [reg1, res1],
      classifications,
    });

    const mockPanel = panel as unknown as MockElement;
    expect(
      mockPanel.querySelector('.chr-region-count-badge')?.textContent,
    ).toBe('2 configured');

    const rows = mockPanel.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);

    // Row 1: Player
    const row1 = rows[0];
    expect(row1?.textContent).toContain('Player');
    expect(row1?.textContent).toContain('Main protagonist animation tiles');
    expect(row1?.textContent).toContain('PT0');
    expect(row1?.textContent).toContain('$00-$0F');
    expect(row1?.textContent).toContain('16 tiles');
    expect(row1?.textContent).toContain('8 / 16 tiles (50%)');
    const swatch1 = row1?.querySelector('.chr-region-color-swatch');
    expect(swatch1).not.toBeNull();
    expect(swatch1?.style.backgroundColor).toBe('#38bdf8');

    // Row 2: Dynamic FX
    const row2 = rows[1];
    expect(row2?.textContent).toContain('Dynamic FX');
    expect(row2?.textContent).toContain('PT1');
    expect(row2?.textContent).toContain('$80-$8F');
    expect(row2?.textContent).toContain('16 tiles');
    expect(row2?.textContent).toContain('0 / 16 tiles (0%)');
  });

  it('creates a new region with a generated stable ID and invokes onUpdateChrRegions with an immutable array', () => {
    const onUpdate = vi.fn();
    const panel = createChrRegionManagerPanel({
      chrRegions: [],
      onUpdateChrRegions: onUpdate,
    });

    const mockPanel = panel as unknown as MockElement;
    mockPanel.querySelector('.chr-region-add-btn')?.click();

    const nameInput = mockPanel.querySelector('#chr-region-name-input');
    const startInput = mockPanel.querySelector('#chr-region-start-input');
    const endInput = mockPanel.querySelector('#chr-region-end-input');
    const notesInput = mockPanel.querySelector('#chr-region-notes-input');

    if (nameInput) nameInput.value = 'Enemies';
    nameInput?.dispatchEvent({ type: 'input' });
    if (startInput) startInput.value = '$20';
    startInput?.dispatchEvent({ type: 'input' });
    if (endInput) endInput.value = '$3F';
    endInput?.dispatchEvent({ type: 'input' });
    if (notesInput) notesInput.value = 'Boss and minion sprites';
    notesInput?.dispatchEvent({ type: 'input' });

    const saveBtn = mockPanel.querySelector('#chr-region-save-btn');
    saveBtn?.click();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [updatedList] = onUpdate.mock.calls[0] as [ChrRegion[]];
    expect(updatedList.length).toBe(1);
    expect(updatedList[0]?.name).toBe('Enemies');
    expect(updatedList[0]?.startTile).toBe(0x20);
    expect(updatedList[0]?.endTile).toBe(0x3f);
    expect(updatedList[0]?.patternTable).toBe(0);
    expect(updatedList[0]?.kind).toBe('region');
    expect(updatedList[0]?.notes).toBe('Boss and minion sprites');
    expect(updatedList[0]?.id).toBeDefined();
    expect(typeof updatedList[0]?.id).toBe('string');
  });

  it('edits an existing region, preserving its exact immutable ID and updating only modified fields', () => {
    const initialRegion: ChrRegion = {
      id: 'permanent-reg-id-123',
      name: 'Player',
      patternTable: 0,
      startTile: 0,
      endTile: 15,
      kind: 'region',
      color: '#38bdf8',
    };

    const onUpdate = vi.fn();
    const panel = createChrRegionManagerPanel({
      chrRegions: [initialRegion],
      onUpdateChrRegions: onUpdate,
    });

    const mockPanel = panel as unknown as MockElement;
    const editBtn = mockPanel.querySelector('.chr-region-edit-btn');
    editBtn?.click();

    const formCard = mockPanel.querySelector('.chr-region-form-card');
    expect(formCard?.querySelector('.chr-region-form-title')?.textContent).toBe(
      'Edit CHR Region / Reservation',
    );

    const nameInput = mockPanel.querySelector('#chr-region-name-input');
    expect(nameInput?.value).toBe('Player');

    // Change name to "Hero" and range to $00-$1F
    if (nameInput) nameInput.value = 'Hero';
    nameInput?.dispatchEvent({ type: 'input' });
    const endInput = mockPanel.querySelector('#chr-region-end-input');
    if (endInput) endInput.value = '$1F';
    endInput?.dispatchEvent({ type: 'input' });

    mockPanel.querySelector('#chr-region-save-btn')?.click();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [updatedList] = onUpdate.mock.calls[0] as [ChrRegion[]];
    expect(updatedList.length).toBe(1);
    expect(updatedList[0]?.id).toBe('permanent-reg-id-123'); // ID PRESERVED!
    expect(updatedList[0]?.name).toBe('Hero');
    expect(updatedList[0]?.endTile).toBe(31);
  });

  it('displays contextual overlap warning when a new region overlaps an existing region without blocking save', () => {
    const existing: ChrRegion = {
      id: 'reg-enemies',
      name: 'Enemies',
      patternTable: 0,
      startTile: 0x20,
      endTile: 0x40,
      kind: 'region',
    };

    const onUpdate = vi.fn();
    const panel = createChrRegionManagerPanel({
      chrRegions: [existing],
      onUpdateChrRegions: onUpdate,
    });

    const mockPanel = panel as unknown as MockElement;
    mockPanel.querySelector('.chr-region-add-btn')?.click();

    const nameInput = mockPanel.querySelector('#chr-region-name-input');
    const startInput = mockPanel.querySelector('#chr-region-start-input');
    const endInput = mockPanel.querySelector('#chr-region-end-input');

    if (nameInput) nameInput.value = 'Bosses';
    nameInput?.dispatchEvent({ type: 'input' });
    if (startInput) startInput.value = '$30';
    startInput?.dispatchEvent({ type: 'input' });
    if (endInput) endInput.value = '$50';
    endInput?.dispatchEvent({ type: 'input' });

    // Warning should be displayed
    const warning = mockPanel.querySelector('.chr-region-val-warning');
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain(
      'Notice: Overlaps "Enemies" at $30-$40',
    );

    // Save button must remain enabled
    const saveBtn = mockPanel.querySelector('#chr-region-save-btn');
    expect(saveBtn?.disabled).toBe(false);

    saveBtn?.click();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('displays occupied reservation notice when a reservation covers occupied slots without blocking save', () => {
    const classifications: ChrSlotClassification[] = [];
    for (let i = 0; i < 512; i += 1) {
      classifications.push({
        physicalIndex: i,
        localIndex: i % 256,
        patternTable: i < 256 ? 0 : 1,
        occupancy: i >= 0x20 && i <= 0x27 ? 'base' : 'empty', // 8 base tiles at PT0:$20..$27
      });
    }

    const onUpdate = vi.fn();
    const panel = createChrRegionManagerPanel({
      chrRegions: [],
      classifications,
      onUpdateChrRegions: onUpdate,
    });

    const mockPanel = panel as unknown as MockElement;
    mockPanel.querySelector('.chr-region-add-btn')?.click();

    const nameInput = mockPanel.querySelector('#chr-region-name-input');
    const kindSelect = mockPanel.querySelector('#chr-region-kind-select');
    const startInput = mockPanel.querySelector('#chr-region-start-input');
    const endInput = mockPanel.querySelector('#chr-region-end-input');

    if (nameInput) nameInput.value = 'Runtime Buffer';
    nameInput?.dispatchEvent({ type: 'input' });
    if (kindSelect) kindSelect.value = 'reservation';
    kindSelect?.dispatchEvent({ type: 'change' });
    if (startInput) startInput.value = '$20';
    startInput?.dispatchEvent({ type: 'input' });
    if (endInput) endInput.value = '$3F';
    endInput?.dispatchEvent({ type: 'input' });

    const occNotice = mockPanel.querySelector(
      '.chr-region-val-occupied-warning',
    );
    expect(occNotice).not.toBeNull();
    expect(occNotice?.textContent).toContain(
      'Notice: This reservation covers 8 existing tiles at $20-$3F. Existing tiles will be preserved.',
    );

    const saveBtn = mockPanel.querySelector('#chr-region-save-btn');
    expect(saveBtn?.disabled).toBe(false);
  });

  it('deletes a region with specific region confirmation message and emits updated list', () => {
    const reg1: ChrRegion = {
      id: 'reg-1',
      name: 'Player',
      patternTable: 0,
      startTile: 0,
      endTile: 10,
      kind: 'region',
    };
    const reg2: ChrRegion = {
      id: 'reg-2',
      name: 'FX',
      patternTable: 1,
      startTile: 0,
      endTile: 10,
      kind: 'reservation',
    };

    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('window', { confirm: confirmSpy });

    const onUpdate = vi.fn();
    const panel = createChrRegionManagerPanel({
      chrRegions: [reg1, reg2],
      onUpdateChrRegions: onUpdate,
    });

    const mockPanel = panel as unknown as MockElement;
    const deleteBtns = mockPanel.querySelectorAll('.chr-region-delete-btn');
    expect(deleteBtns.length).toBe(2);

    deleteBtns[0]?.click();

    expect(confirmSpy).toHaveBeenCalledWith(
      'Remove organizational Region "Player"?',
    );
    expect(onUpdate).toHaveBeenCalledWith([reg2]);
  });

  it('deletes a reservation with specific reservation confirmation message', () => {
    const res1: ChrRegion = {
      id: 'res-fx',
      name: 'Runtime FX',
      patternTable: 0,
      startTile: 0x60,
      endTile: 0x6f,
      kind: 'reservation',
    };

    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('window', { confirm: confirmSpy });

    const onUpdate = vi.fn();
    const panel = createChrRegionManagerPanel({
      chrRegions: [res1],
      onUpdateChrRegions: onUpdate,
    });

    const mockPanel = panel as unknown as MockElement;
    const deleteBtn = mockPanel.querySelector('.chr-region-delete-btn');
    deleteBtn?.click();

    expect(confirmSpy).toHaveBeenCalledWith(
      'Remove Reservation "Runtime FX"?\n\nSlots previously protected from automatic allocation will become available again.\nExisting tiles will not be changed.',
    );
    expect(onUpdate).toHaveBeenCalledWith([]);
  });

  it('aborts delete when confirmation is declined', () => {
    const reg1: ChrRegion = {
      id: 'reg-1',
      name: 'Player',
      patternTable: 0,
      startTile: 0,
      endTile: 10,
      kind: 'region',
    };

    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('window', { confirm: confirmSpy });

    const onUpdate = vi.fn();
    const panel = createChrRegionManagerPanel({
      chrRegions: [reg1],
      onUpdateChrRegions: onUpdate,
    });

    const mockPanel = panel as unknown as MockElement;
    mockPanel.querySelector('.chr-region-delete-btn')?.click();

    expect(confirmSpy).toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('cancels form editing with button and Escape key without triggering updates', () => {
    const reg1: ChrRegion = {
      id: 'reg-1',
      name: 'Region 1',
      patternTable: 0,
      startTile: 0,
      endTile: 10,
      kind: 'region',
    };

    const onUpdate = vi.fn();
    const panel = createChrRegionManagerPanel({
      chrRegions: [reg1],
      onUpdateChrRegions: onUpdate,
    });

    const mockPanel = panel as unknown as MockElement;
    mockPanel.querySelector('.chr-region-edit-btn')?.click();

    expect(mockPanel.querySelector('.chr-region-form-card')).not.toBeNull();

    // Cancel via button
    mockPanel.querySelector('#chr-region-cancel-btn')?.click();

    expect(mockPanel.querySelector('.chr-region-form-card')).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();

    // Re-open and cancel via Escape key
    mockPanel.querySelector('.chr-region-edit-btn')?.click();
    expect(mockPanel.querySelector('.chr-region-form-card')).not.toBeNull();

    const form = mockPanel.querySelector('form');
    form?.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(mockPanel.querySelector('.chr-region-form-card')).toBeNull();
  });
});
