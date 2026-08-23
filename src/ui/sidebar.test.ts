import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSidebar } from './sidebar';

class MockElement {
  tagName: string;
  className = '';
  id = '';
  children: MockElement[] = [];
  attributes = new Map<string, string>();
  eventListeners = new Map<string, ((e?: unknown) => void)[]>();
  textContent = '';
  title = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get href() {
    return this.attributes.get('href') ?? '';
  }
  set href(val: string) {
    this.attributes.set('href', val);
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

describe('Sidebar component', () => {
  beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tagName: string) => new MockElement(tagName),
    };
  });

  it('renders workspace navigation buttons with correct active states and accessibility', () => {
    const onWorkspaceChange = vi.fn();
    const sidebar = createSidebar({
      activeWorkspace: 'playfield',
      fileName: null,
      onWorkspaceChange,
    });

    expect(sidebar.tagName.toLowerCase()).toBe('nav');
    expect(sidebar.getAttribute('aria-label')).toBeTruthy();

    const buttons = (sidebar as unknown as MockElement).querySelectorAll(
      '.sidebar-nav-item',
    );
    expect(buttons.length).toBe(4);

    const btn0 = buttons[0];
    const btn1 = buttons[1];
    const btn2 = buttons[2];
    const btn3 = buttons[3];
    expect(btn0).toBeDefined();
    expect(btn1).toBeDefined();
    expect(btn2).toBeDefined();
    expect(btn3).toBeDefined();
    if (!btn0 || !btn1 || !btn2 || !btn3) return;

    // Tileset
    expect(btn0.classList.contains('is-active')).toBe(false);
    expect(btn0.getAttribute('aria-pressed')).toBe('false');

    // Playfield (active)
    expect(btn1.classList.contains('is-active')).toBe(true);
    expect(btn1.getAttribute('aria-pressed')).toBe('true');

    // Animation
    expect(btn2.classList.contains('is-active')).toBe(false);
    expect(btn2.getAttribute('aria-pressed')).toBe('false');

    // Palette
    expect(btn3.classList.contains('is-active')).toBe(false);
    expect(btn3.getAttribute('aria-pressed')).toBe('false');

    // Click tileset button
    btn0.click();
    expect(onWorkspaceChange).toHaveBeenCalledWith('tileset');

    // Click animation button
    btn2.click();
    expect(onWorkspaceChange).toHaveBeenCalledWith('animation');

    // Click palette button
    btn3.click();
    expect(onWorkspaceChange).toHaveBeenCalledWith('palette');
  });

  it('renders section anchors for tileset / playfield modes', () => {
    const sidebar = createSidebar({
      activeWorkspace: 'tileset',
      fileName: 'level1.png',
    });

    const links = (sidebar as unknown as MockElement).querySelectorAll(
      '.sidebar-link',
    );
    const hrefs = links.map((link) => link.getAttribute('href'));

    expect(hrefs).toEqual([
      '#section-image',
      '#section-palettes',
      '#section-tiles',
      '#section-export',
    ]);
  });

  it('renders section anchors for animation mode', () => {
    const sidebar = createSidebar({
      activeWorkspace: 'animation',
      fileName: 'hero.png',
    });

    const links = (sidebar as unknown as MockElement).querySelectorAll(
      '.sidebar-link',
    );
    const hrefs = links.map((link) => link.getAttribute('href'));

    expect(hrefs).toEqual([
      '#section-asset',
      '#section-palettes',
      '#section-animations',
      '#section-scene-preview',
      '#section-mapping',
      '#section-export',
    ]);
  });

  it('renders section anchors for palette mode', () => {
    const sidebar = createSidebar({
      activeWorkspace: 'palette',
      fileName: null,
    });

    const links = (sidebar as unknown as MockElement).querySelectorAll(
      '.sidebar-link',
    );
    const hrefs = links.map((link) => link.getAttribute('href'));

    expect(hrefs).toEqual([
      '#section-palettes-intro',
      '#section-active-slots',
      '#section-palette-definitions',
      '#section-palette-export',
    ]);
  });

  it('renders filename and quantization segmented control when applicable', () => {
    const onQuantizationModeChange = vi.fn();
    const sidebar = createSidebar({
      activeWorkspace: 'tileset',
      fileName: 'character.png',
      quantizationMode: 'median-cut',
      onQuantizationModeChange,
    });

    const file = (sidebar as unknown as MockElement).querySelector(
      '.sidebar-file',
    );
    expect(file).not.toBeNull();
    expect(file?.textContent).toContain('character.png');

    const quantButtons = (sidebar as unknown as MockElement).querySelectorAll(
      '.segmented-button',
    );
    const qbtn0 = quantButtons[0];
    expect(qbtn0).toBeDefined();
    if (!qbtn0) return;

    // Click Nearest
    qbtn0.click();
    expect(onQuantizationModeChange).toHaveBeenCalledWith('nearest');
  });
});
