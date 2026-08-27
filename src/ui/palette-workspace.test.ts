import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ActivePaletteSlots,
  PaletteDefinition,
  PaletteDiagnosticFact,
} from '../core/palette-manager';
import {
  exportBackgroundPaletteBinary,
  exportFullPpuPaletteBinary,
  exportSpritePaletteBinary,
  generateCa65PaletteExport,
  generateCPaletteExport,
} from '../core/palette-exporters';
import {
  createPaletteWorkspace,
  type PaletteWorkspaceOptions,
} from './palette-workspace';

interface MockEvent {
  readonly type: string;
  readonly key?: string;
  preventDefault: () => void;
}

class MockElement {
  readonly tagName: string;
  className = '';
  id = '';
  children: MockElement[] = [];
  attributes = new Map<string, string>();
  eventListeners = new Map<string, ((event: MockEvent) => void)[]>();
  textContent = '';
  value = '';
  title = '';
  type = '';
  method = '';
  htmlFor = '';
  hidden = false;
  disabled = false;
  selected = false;
  open = false;
  style: Record<string, string> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get classList() {
    return {
      contains: (className: string) =>
        this.className.split(/\s+/).includes(className),
      add: (className: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.add(className);
        this.className = Array.from(classes).join(' ');
      },
      remove: (className: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.delete(className);
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

  addEventListener(event: string, handler: (event: MockEvent) => void) {
    const handlers = this.eventListeners.get(event) ?? [];
    handlers.push(handler);
    this.eventListeners.set(event, handlers);
  }

  dispatchEvent(event: Partial<MockEvent> & { readonly type: string }) {
    const completeEvent: MockEvent = {
      preventDefault: vi.fn(),
      ...event,
    };
    for (const handler of this.eventListeners.get(event.type) ?? []) {
      handler(completeEvent);
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  focus() {
    mockDocument.activeElement = this;
  }

  blur() {
    if (mockDocument.activeElement === this) {
      mockDocument.activeElement = null;
    }
    this.dispatchEvent({ type: 'blur' });
  }

  append(...nodes: (MockElement | string)[]) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this.textContent += node;
      } else {
        this.children.push(node);
      }
    }
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
    this.dispatchEvent({ type: 'close' });
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const match = (element: MockElement): boolean => {
      if (selector.startsWith('.')) {
        return element.classList.contains(selector.slice(1));
      }
      if (selector.startsWith('#')) {
        return element.id === selector.slice(1);
      }
      const attributeMatch = /^\[([^=]+)="([^"]+)"\]$/.exec(selector);
      if (attributeMatch) {
        return (
          element.getAttribute(attributeMatch[1] ?? '') === attributeMatch[2]
        );
      }
      return element.tagName.toLowerCase() === selector.toLowerCase();
    };

    const visit = (element: MockElement): void => {
      for (const child of element.children) {
        if (match(child)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

const mockDocument: {
  activeElement: MockElement | null;
  createElement: (tagName: string) => MockElement;
} = {
  activeElement: null,
  createElement: (tagName) => new MockElement(tagName),
};

const samplePalettes: readonly PaletteDefinition[] = [
  {
    id: 'pal_bg',
    name: 'Forest Background',
    colors: [0x00, 0x01, 0x11, 0x21],
    target: 'background',
  },
  {
    id: 'pal_sprite',
    name: 'Hero Sprite',
    colors: [0x0f, 0x06, 0x16, 0x26],
    target: 'sprite',
  },
  {
    id: 'pal_shared',
    name: 'Shared Effects',
    colors: [0x0f, 0x09, 0x19, 0x29],
    target: 'shared',
  },
  {
    id: 'pal_unused',
    name: 'Unused Background',
    colors: [0x0f, 0x02, 0x12, 0x22],
    target: 'background',
  },
  {
    id: 'pal_sprite_alt',
    name: 'Enemy Sprite',
    colors: [0x0f, 0x05, 0x15, 0x25],
    target: 'sprite',
  },
  {
    id: 'pal_shared_alt',
    name: 'Shared UI',
    colors: [0x0f, 0x0a, 0x1a, 0x2a],
  },
];

const backgroundSlots: ActivePaletteSlots = [
  'pal_bg',
  'pal_shared',
  null,
  null,
];
const spriteSlots: ActivePaletteSlots = ['pal_sprite', null, null, null];

const diagnostics: readonly PaletteDiagnosticFact[] = [
  {
    id: 'inconsistent-universal-color:pal_bg',
    code: 'inconsistent-universal-color',
    kind: 'inconsistent-universal-color',
    severity: 'warning',
    paletteId: 'pal_bg',
    paletteName: 'Forest Background',
    actualColor: 0x00,
    expectedColor: 0x0f,
  },
];

function createOptions(
  overrides: Partial<PaletteWorkspaceOptions> = {},
): PaletteWorkspaceOptions {
  return {
    palettes: samplePalettes,
    universalBackgroundColor: 0x0f,
    activeBackgroundSlots: backgroundSlots,
    activeSpriteSlots: spriteSlots,
    usageContext: {
      animations: [
        {
          id: 'anim_idle',
          name: 'idle',
          entity: 'Hero',
          paletteId: 'pal_sprite',
          framePaletteIds: ['pal_shared'],
        },
      ],
      activeBackgroundSlots: backgroundSlots,
      activeSpriteSlots: spriteSlots,
      sceneInstances: [
        {
          id: 'scene_hero',
          name: 'Hero in preview',
          entityId: 'Hero',
          paletteId: 'pal_sprite',
        },
      ],
    },
    diagnostics,
    selectedPaletteId: null,
    filter: 'all',
    onCreatePalette: vi.fn(),
    onUpdatePaletteName: vi.fn(),
    onUpdatePaletteColor: vi.fn(),
    onUpdatePaletteTarget: vi.fn(),
    onUpdateUniversalBackgroundColor: vi.fn(),
    onDuplicatePalette: vi.fn(),
    onDeletePalette: vi.fn(),
    onAssignBackgroundSlot: vi.fn(),
    onAssignSpriteSlot: vi.fn(),
    onSelectPalette: vi.fn(),
    onFilterChange: vi.fn(),
    ...overrides,
  };
}

describe('PaletteWorkspace component', () => {
  beforeEach(() => {
    mockDocument.activeElement = null;
    (globalThis as { document: unknown }).document = mockDocument;
  });

  it('renders independent Background and Sprite banks with exactly four physical slots each', () => {
    const workspace = createPaletteWorkspace(
      createOptions(),
    ) as unknown as MockElement;
    const backgroundBank = workspace.querySelector('.palette-background-bank');
    const spriteBank = workspace.querySelector('.palette-sprite-bank');

    expect(backgroundBank).not.toBeNull();
    expect(spriteBank).not.toBeNull();
    expect(backgroundBank?.querySelectorAll('.active-slot-card')).toHaveLength(
      4,
    );
    expect(spriteBank?.querySelectorAll('.active-slot-card')).toHaveLength(4);
    expect(backgroundBank?.querySelector('h3')?.textContent).toContain(
      '$3F00..$3F0F',
    );
    expect(spriteBank?.querySelector('h3')?.textContent).toContain(
      '$3F10..$3F1F',
    );
  });

  it('renders the effective universal background swatch and sprite transparency semantics', () => {
    const workspace = createPaletteWorkspace(
      createOptions(),
    ) as unknown as MockElement;
    const backgroundBank = workspace.querySelector('.palette-background-bank');
    const spriteBank = workspace.querySelector('.palette-sprite-bank');

    expect(
      backgroundBank?.querySelectorAll('.is-universal-background'),
    ).toHaveLength(4);
    expect(spriteBank?.querySelectorAll('.is-transparent-slot')).toHaveLength(
      4,
    );
    expect(
      spriteBank
        ?.querySelector('.is-transparent-slot')
        ?.getAttribute('aria-label'),
    ).toContain('Transparent');
  });

  it('renders a library larger than four definitions', () => {
    const workspace = createPaletteWorkspace(
      createOptions(),
    ) as unknown as MockElement;
    expect(workspace.querySelectorAll('.palette-definition-card')).toHaveLength(
      6,
    );
  });

  it('assigns Background Slot 2 without dispatching Sprite changes', () => {
    const onAssignBackgroundSlot = vi.fn();
    const onAssignSpriteSlot = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({ onAssignBackgroundSlot, onAssignSpriteSlot }),
    ) as unknown as MockElement;
    const backgroundSelects = workspace
      .querySelector('.palette-background-bank')
      ?.querySelectorAll('select');
    const slotTwo = backgroundSelects?.[2];
    expect(slotTwo).toBeDefined();
    if (slotTwo) {
      slotTwo.value = 'pal_unused';
      slotTwo.dispatchEvent({ type: 'change' });
    }

    expect(onAssignBackgroundSlot).toHaveBeenCalledWith(2, 'pal_unused');
    expect(onAssignSpriteSlot).not.toHaveBeenCalled();
  });

  it('assigns and clears Sprite Slot 2 without dispatching Background changes', () => {
    const onAssignBackgroundSlot = vi.fn();
    const onAssignSpriteSlot = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({ onAssignBackgroundSlot, onAssignSpriteSlot }),
    ) as unknown as MockElement;
    const spriteSelects = workspace
      .querySelector('.palette-sprite-bank')
      ?.querySelectorAll('select');
    const slotTwo = spriteSelects?.[2];
    expect(slotTwo).toBeDefined();
    if (slotTwo) {
      slotTwo.value = 'pal_sprite_alt';
      slotTwo.dispatchEvent({ type: 'change' });
      slotTwo.value = '';
      slotTwo.dispatchEvent({ type: 'change' });
    }

    expect(onAssignSpriteSlot).toHaveBeenNthCalledWith(1, 2, 'pal_sprite_alt');
    expect(onAssignSpriteSlot).toHaveBeenNthCalledWith(2, 2, null);
    expect(onAssignBackgroundSlot).not.toHaveBeenCalled();
  });

  it('creates a new logical palette through the toolbar callback', () => {
    const onCreatePalette = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({ onCreatePalette }),
    ) as unknown as MockElement;
    workspace.querySelector('.palette-new-button')?.click();
    expect(onCreatePalette).toHaveBeenCalledOnce();
  });

  it('commits rename consistently with Enter and cancels it with Escape', () => {
    const onUpdatePaletteName = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({ onUpdatePaletteName, selectedPaletteId: 'pal_bg' }),
    ) as unknown as MockElement;
    const inputs = workspace.querySelectorAll('.palette-definition-name-input');
    const first = inputs[0];
    const second = inputs[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first && second) {
      first.focus();
      first.value = 'Forest Day';
      first.dispatchEvent({ type: 'keydown', key: 'Enter' });
      second.focus();
      second.value = 'Do not save';
      second.dispatchEvent({ type: 'keydown', key: 'Escape' });
      expect(second.value).toBe('Hero Sprite');
    }

    expect(onUpdatePaletteName).toHaveBeenCalledOnce();
    expect(onUpdatePaletteName).toHaveBeenCalledWith('pal_bg', 'Forest Day');
    expect(
      workspace
        .querySelector('[data-palette-id="pal_bg"]')
        ?.getAttribute('aria-label'),
    ).toBe('Forest Day');
    expect(
      workspace.querySelector('.palette-inspector-name')?.textContent,
    ).toBe('Forest Day');
  });

  it('edits only the selected stored color through the shared master palette dialog', async () => {
    const onUpdatePaletteColor = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({ onUpdatePaletteColor }),
    ) as unknown as MockElement;
    const trigger = workspace.querySelector('.palette-color-swatch-btn');
    trigger?.focus();
    trigger?.click();
    await Promise.resolve();
    const dialog = workspace.querySelector('.nes-master-dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelectorAll('.nes-color-button')).toHaveLength(64);
    dialog?.querySelectorAll('.nes-color-button')[0x16]?.click();
    await Promise.resolve();

    expect(onUpdatePaletteColor).toHaveBeenCalledWith('pal_bg', 0, 0x16);
    expect(mockDocument.activeElement).toBe(trigger);
  });

  it('updates the canonical universal background color through the master dialog', () => {
    const onUpdateUniversalBackgroundColor = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({ onUpdateUniversalBackgroundColor }),
    ) as unknown as MockElement;
    workspace.querySelector('.palette-universal-button')?.click();
    workspace
      .querySelector('.nes-master-dialog')
      ?.querySelectorAll('.nes-color-button')[0x21]
      ?.click();
    expect(onUpdateUniversalBackgroundColor).toHaveBeenCalledWith(0x21);
  });

  it('duplicates a palette without involving slot assignment callbacks', () => {
    const onDuplicatePalette = vi.fn();
    const onAssignBackgroundSlot = vi.fn();
    const onAssignSpriteSlot = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({
        onDuplicatePalette,
        onAssignBackgroundSlot,
        onAssignSpriteSlot,
      }),
    ) as unknown as MockElement;
    const firstCard = workspace.querySelectorAll('.palette-definition-card')[0];
    firstCard
      ?.querySelectorAll('.palette-definition-actions')[0]
      ?.querySelectorAll('button')[1]
      ?.click();

    expect(onDuplicatePalette).toHaveBeenCalledWith('pal_bg');
    expect(onAssignBackgroundSlot).not.toHaveBeenCalled();
    expect(onAssignSpriteSlot).not.toHaveBeenCalled();
  });

  it('allows confirmed deletion when the palette has no usage references', async () => {
    const onDeletePalette = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({ onDeletePalette }),
    ) as unknown as MockElement;
    const unusedCard = workspace.querySelectorAll(
      '.palette-definition-card',
    )[3];
    const trigger = unusedCard?.querySelector('.palette-delete-button');
    trigger?.focus();
    trigger?.click();
    await Promise.resolve();
    const dialog = workspace.querySelector('.palette-delete-dialog');
    expect(dialog?.open).toBe(true);
    const destructive = dialog?.querySelector('.danger-button');
    expect(destructive?.hidden).toBe(false);
    destructive?.click();
    await Promise.resolve();

    expect(onDeletePalette).toHaveBeenCalledWith('pal_unused');
    expect(mockDocument.activeElement).toBe(trigger);
  });

  it('blocks deletion and lists references when the palette is in use', () => {
    const onDeletePalette = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({ onDeletePalette }),
    ) as unknown as MockElement;
    const usedCard = workspace.querySelectorAll('.palette-definition-card')[0];
    usedCard?.querySelector('.palette-delete-button')?.click();
    const dialog = workspace.querySelector('.palette-delete-dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector('.danger-button')?.hidden).toBe(true);
    expect(
      dialog?.querySelectorAll('.palette-delete-usage-list')[0]?.children
        .length,
    ).toBeGreaterThan(0);
    dialog?.querySelector('.danger-button')?.click();
    expect(onDeletePalette).not.toHaveBeenCalled();
  });

  it.each([
    ['all', 6],
    ['sprite', 4],
    ['background', 4],
    ['in-use', 3],
  ] as const)(
    'filters the library by %s using transient state',
    (filter, count) => {
      const workspace = createPaletteWorkspace(
        createOptions({ filter }),
      ) as unknown as MockElement;
      expect(
        workspace.querySelectorAll('.palette-definition-card'),
      ).toHaveLength(count);
    },
  );

  it('dispatches filter selection without changing project callbacks', () => {
    const onFilterChange = vi.fn();
    const onUpdatePaletteColor = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({ onFilterChange, onUpdatePaletteColor }),
    ) as unknown as MockElement;
    workspace.querySelectorAll('.palette-filter-button')[3]?.click();
    expect(onFilterChange).toHaveBeenCalledWith('in-use');
    expect(onUpdatePaletteColor).not.toHaveBeenCalled();
  });

  it('renders an empty inspector until a palette is selected', () => {
    const workspace = createPaletteWorkspace(
      createOptions(),
    ) as unknown as MockElement;
    const inspector = workspace.querySelector('.palette-usage-inspector');
    expect(inspector?.querySelector('.palette-inspector-name')).toBeNull();
    expect(inspector?.querySelector('p')?.textContent).toMatch(
      /Select|Selecione/,
    );
  });

  it('renders selected identity, hardware slots, usages, and core diagnostics', () => {
    const workspace = createPaletteWorkspace(
      createOptions({ selectedPaletteId: 'pal_bg' }),
    ) as unknown as MockElement;
    const inspector = workspace.querySelector('.palette-usage-inspector');
    expect(
      inspector?.querySelector('.palette-inspector-name')?.textContent,
    ).toBe('Forest Background');
    expect(inspector?.querySelector('.palette-inspector-id')?.textContent).toBe(
      'pal_bg',
    );
    expect(
      inspector?.querySelectorAll('.palette-inspector-usage-list')[0]?.children,
    ).toHaveLength(1);
    expect(inspector?.querySelectorAll('.palette-diagnostic')).toHaveLength(1);
  });

  it('updates target through the selected palette inspector', () => {
    const onUpdatePaletteTarget = vi.fn();
    const workspace = createPaletteWorkspace(
      createOptions({
        selectedPaletteId: 'pal_bg',
        onUpdatePaletteTarget,
      }),
    ) as unknown as MockElement;
    const targetSelect = workspace.querySelector('.palette-target-select');
    if (targetSelect) {
      targetSelect.value = 'shared';
      targetSelect.dispatchEvent({ type: 'change' });
    }
    expect(onUpdatePaletteTarget).toHaveBeenCalledWith('pal_bg', 'shared');
  });

  it('keeps long structured usage lists inside the semantic inspector list', () => {
    const animations = Array.from({ length: 12 }, (_, index) => ({
      id: `anim_${String(index)}`,
      name: `Animation ${String(index)}`,
      entity: `Entity ${String(index)}`,
      paletteId: 'pal_sprite',
    }));
    const workspace = createPaletteWorkspace(
      createOptions({
        selectedPaletteId: 'pal_sprite',
        usageContext: {
          animations,
          activeBackgroundSlots: backgroundSlots,
          activeSpriteSlots: spriteSlots,
        },
      }),
    ) as unknown as MockElement;
    const usageList = workspace.querySelector('.palette-inspector-usage-list');
    expect(usageList?.tagName).toBe('UL');
    expect(usageList?.children.length).toBe(25);
  });

  it('exposes labels, pressed state, dialogs, and safe initial dialog focus', async () => {
    const workspace = createPaletteWorkspace(
      createOptions(),
    ) as unknown as MockElement;
    const filter = workspace.querySelectorAll('.palette-filter-button')[0];
    expect(filter?.getAttribute('aria-pressed')).toBe('true');
    expect(
      workspace
        .querySelector('.palette-background-bank')
        ?.querySelector('select')
        ?.getAttribute('aria-label'),
    ).toContain('Slot 0');

    workspace
      .querySelectorAll('.palette-definition-card')[3]
      ?.querySelector('.palette-delete-button')
      ?.click();
    await Promise.resolve();
    const dialog = workspace.querySelector('.palette-delete-dialog');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(
      'palette-delete-dialog-title',
    );
    expect(mockDocument.activeElement?.textContent).toMatch(/Cancel|Cancelar/);
  });

  it('downloads every canonical binary, cc65, and ca65 palette artifact', () => {
    const onDownloadBytes = vi.fn();
    const onDownloadText = vi.fn();
    const options = createOptions({ onDownloadBytes, onDownloadText });
    const workspace = createPaletteWorkspace(options) as unknown as MockElement;
    const clickExport = (id: string): void => {
      workspace.querySelector(`[data-palette-export="${id}"]`)?.click();
    };
    [
      'background-pal',
      'sprite-pal',
      'full-pal',
      'c-header',
      'c-source',
      'asm-include',
      'asm-source',
    ].forEach(clickExport);

    const paletteState = {
      palettes: options.palettes,
      universalBackgroundColor: options.universalBackgroundColor,
      activeBackgroundSlots: options.activeBackgroundSlots,
      activeSpriteSlots: options.activeSpriteSlots,
    };
    expect(onDownloadBytes.mock.calls).toEqual([
      [exportBackgroundPaletteBinary(paletteState), 'project.pal'],
      [exportSpritePaletteBinary(paletteState), 'project_sprites.pal'],
      [exportFullPpuPaletteBinary(paletteState), 'project_ppu.pal'],
    ]);
    const c = generateCPaletteExport(paletteState, {
      symbolBase: 'project_palette',
    });
    const asm = generateCa65PaletteExport(paletteState, {
      symbolBase: 'project_palette',
    });
    expect(onDownloadText.mock.calls).toEqual([
      [c.header, c.headerFileName],
      [c.source, c.sourceFileName],
      [asm.include, asm.includeFileName],
      [asm.source, asm.sourceFileName],
    ]);
  });
});
