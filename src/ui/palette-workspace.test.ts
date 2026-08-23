import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultNesPaletteSet } from '../core/nes-palette';
import type { PaletteDefinition } from '../core/palette-manager';
import { createPaletteWorkspace } from './palette-workspace';
import type { AnimationItemSetting } from './types';

class MockElement {
  tagName: string;
  className = '';
  id = '';
  children: MockElement[] = [];
  attributes = new Map<string, string>();
  eventListeners = new Map<string, ((e?: unknown) => void)[]>();
  textContent = '';
  value = '';
  title = '';
  style: Record<string, string> = {};
  open = false;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
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

  dispatchEvent(event: { type: string }) {
    const handlers = this.eventListeners.get(event.type) ?? [];
    handlers.forEach((fn) => {
      fn();
    });
  }

  click() {
    const handlers = this.eventListeners.get('click') ?? [];
    handlers.forEach((fn) => {
      fn();
    });
  }

  append(...nodes: (MockElement | string)[]) {
    nodes.forEach((node) => {
      if (typeof node === 'string') {
        this.textContent += node;
      } else {
        this.children.push(node);
      }
    });
  }

  replaceChildren(...nodes: (MockElement | string)[]) {
    this.children = [];
    this.textContent = '';
    this.append(...nodes);
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const match = (el: MockElement): boolean => {
      if (selector.startsWith('.')) {
        return el.classList.contains(selector.slice(1));
      }
      if (selector.startsWith('#')) {
        return el.id === selector.slice(1);
      }
      return el.tagName.toLowerCase() === selector.toLowerCase();
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

describe('PaletteWorkspace component', () => {
  const samplePalettes: readonly PaletteDefinition[] = [
    {
      id: 'pal_hero',
      name: 'Hero Palette',
      colors: [0x0f, 0x00, 0x10, 0x30],
    },
    {
      id: 'pal_enemy',
      name: 'Enemy Palette',
      colors: [0x0f, 0x06, 0x16, 0x26],
    },
  ];

  const sampleSlots = ['pal_hero', 'pal_enemy', null, null] as const;

  const sampleAnimations: readonly AnimationItemSetting[] = [
    {
      id: 'anim_idle',
      name: 'idle',
      entity: 'Hero',
      source: null,
      paletteId: 'pal_hero',
      frameWidth: 16,
      frameHeight: 16,
      originX: 8,
      originY: 16,
      playback: 'loop',
      allowHorizontalFlip: true,
      allowVerticalFlip: false,
      defaultDuration: 8,
      frameIndices: [0, 1],
      frameDurations: [8, 8],
    },
  ];

  beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tagName: string) => new MockElement(tagName),
    };
    (
      globalThis as unknown as {
        window: { confirm: (msg?: string) => boolean };
      }
    ).window = {
      confirm: vi.fn().mockReturnValue(true),
    };
  });

  it('renders workspace sections with active slots, palette definitions, and export statistics', () => {
    const workspace = createPaletteWorkspace({
      palettes: samplePalettes,
      activeSpritePaletteSlots: sampleSlots,
      animations: sampleAnimations,
      paletteSet: createDefaultNesPaletteSet(),
      onCreatePalette: vi.fn(),
      onUpdatePaletteName: vi.fn(),
      onUpdatePaletteColor: vi.fn(),
      onDuplicatePalette: vi.fn(),
      onDeletePalette: vi.fn(),
      onUpdateActiveSlot: vi.fn(),
      onDownloadBytes: vi.fn(),
    });

    const mockWs = workspace as unknown as MockElement;
    expect(mockWs.classList.contains('palette-workspace')).toBe(true);

    const activeSlots = mockWs.querySelectorAll('.active-slot-card');
    expect(activeSlots.length).toBe(4);

    const defCards = mockWs.querySelectorAll('.palette-definition-card');
    expect(defCards.length).toBe(2);

    const stats = mockWs.querySelector('.palette-export-stats');
    expect(stats?.textContent).toContain('2');
  });

  it('triggers onCreatePalette when clicking the new palette button', () => {
    const onCreatePalette = vi.fn();
    const workspace = createPaletteWorkspace({
      palettes: samplePalettes,
      activeSpritePaletteSlots: sampleSlots,
      animations: sampleAnimations,
      paletteSet: createDefaultNesPaletteSet(),
      onCreatePalette,
      onUpdatePaletteName: vi.fn(),
      onUpdatePaletteColor: vi.fn(),
      onDuplicatePalette: vi.fn(),
      onDeletePalette: vi.fn(),
      onUpdateActiveSlot: vi.fn(),
    });

    const mockWs = workspace as unknown as MockElement;
    const newBtn = mockWs.querySelector('.primary-button');
    expect(newBtn).not.toBeNull();
    newBtn?.click();

    expect(onCreatePalette).toHaveBeenCalledTimes(1);
  });

  it('triggers onUpdatePaletteName when editing palette name', () => {
    const onUpdatePaletteName = vi.fn();
    const workspace = createPaletteWorkspace({
      palettes: samplePalettes,
      activeSpritePaletteSlots: sampleSlots,
      animations: sampleAnimations,
      paletteSet: createDefaultNesPaletteSet(),
      onCreatePalette: vi.fn(),
      onUpdatePaletteName,
      onUpdatePaletteColor: vi.fn(),
      onDuplicatePalette: vi.fn(),
      onDeletePalette: vi.fn(),
      onUpdateActiveSlot: vi.fn(),
    });

    const mockWs = workspace as unknown as MockElement;
    const nameInput = mockWs.querySelector('.palette-definition-name-input');
    expect(nameInput).not.toBeNull();
    if (nameInput) {
      nameInput.value = 'Main Hero Palette';
      nameInput.dispatchEvent({ type: 'change' });
    }

    expect(onUpdatePaletteName).toHaveBeenCalledWith(
      'pal_hero',
      'Main Hero Palette',
    );
  });

  it('triggers onDuplicatePalette and onDeletePalette with safety checks', () => {
    const onDuplicatePalette = vi.fn();
    const onDeletePalette = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const workspace = createPaletteWorkspace({
      palettes: samplePalettes,
      activeSpritePaletteSlots: sampleSlots,
      animations: sampleAnimations,
      paletteSet: createDefaultNesPaletteSet(),
      onCreatePalette: vi.fn(),
      onUpdatePaletteName: vi.fn(),
      onUpdatePaletteColor: vi.fn(),
      onDuplicatePalette,
      onDeletePalette,
      onUpdateActiveSlot: vi.fn(),
    });

    const mockWs = workspace as unknown as MockElement;
    const cards = mockWs.querySelectorAll('.palette-definition-card');
    const heroCard = cards[0];
    expect(heroCard).toBeDefined();

    const actionButtons = heroCard?.querySelectorAll('button') ?? [];
    // Colors (4 buttons) + Duplicate + Delete
    const dupBtn = actionButtons[4];
    const delBtn = actionButtons[5];

    expect(dupBtn).toBeDefined();
    dupBtn?.click();
    expect(onDuplicatePalette).toHaveBeenCalledWith('pal_hero');

    expect(delBtn).toBeDefined();
    delBtn?.click();
    // pal_hero is referenced by Slot 0 and Hero idle animation, so confirm is called
    expect(confirmSpy).toHaveBeenCalled();
    expect(onDeletePalette).toHaveBeenCalledWith('pal_hero');
  });

  it('triggers onDownloadBytes when clicking download palette button', () => {
    const onDownloadBytes = vi.fn();
    const workspace = createPaletteWorkspace({
      palettes: samplePalettes,
      activeSpritePaletteSlots: sampleSlots,
      animations: sampleAnimations,
      paletteSet: createDefaultNesPaletteSet(),
      onCreatePalette: vi.fn(),
      onUpdatePaletteName: vi.fn(),
      onUpdatePaletteColor: vi.fn(),
      onDuplicatePalette: vi.fn(),
      onDeletePalette: vi.fn(),
      onUpdateActiveSlot: vi.fn(),
      onDownloadBytes,
    });

    const mockWs = workspace as unknown as MockElement;
    const exportPanel = mockWs.querySelector('.palette-export-panel');
    expect(exportPanel).not.toBeNull();
    const downloadBtn = exportPanel?.querySelector('button');
    expect(downloadBtn).not.toBeNull();
    downloadBtn?.click();

    expect(onDownloadBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'project.pal',
    );
  });
});
